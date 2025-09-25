"""
This module provides functionality for registering a frontend service
that serves the frontend application.
"""

import os
from typing import List
from fastapi import FastAPI
from fastapi import UploadFile, File, HTTPException, Form
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from agent_lens.utils.artifact_manager import AgentLensArtifactManager
from hypha_rpc import connect_to_server
import numpy as np
# CLIP and Torch for embeddings
import clip
import torch
import sys
from fastapi.middleware.gzip import GZipMiddleware
import uuid
import traceback
# Import similarity search utilities
from agent_lens.utils.weaviate_search import similarity_service

# Configure logging
from .log import setup_logging

logger = setup_logging("agent_lens_frontend_service.log")


# -------------------- CLIP Embedding Helpers --------------------
# Lazy-load CLIP model for generating embeddings
device = "cuda" if torch.cuda.is_available() else "cpu"
_clip_model = None
_clip_preprocess = None

def _load_clip_model():
    """Load CLIP ViT-B/32 model lazily and cache it in memory."""
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        logger.info(f"Loading CLIP ViT-B/32 on {device}")
        _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device)
        logger.info("CLIP model loaded")
    return _clip_model, _clip_preprocess

def _normalize_features(features: np.ndarray) -> np.ndarray:
    """L2-normalize feature vectors."""
    if features.ndim == 1:
        features = np.expand_dims(features, axis=0)
    norm = np.linalg.norm(features, axis=1, keepdims=True)
    return features / (norm + 1e-12)


DEFAULT_CHANNEL = "BF_LED_matrix_full"

# Create a global AgentLensArtifactManager instance
artifact_manager_instance = AgentLensArtifactManager()

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.getenv("WORKSPACE_TOKEN")

async def get_artifact_manager():
    """Get a new connection to the artifact manager."""
    api = await connect_to_server(
        {"client_id": f"test-client-{uuid.uuid4()}", "server_url": SERVER_URL, "token": WORKSPACE_TOKEN}
    )
    artifact_manager = await api.get_service("public/artifact-manager")
    return api, artifact_manager

def get_frontend_api():
    """
    Create the FastAPI application for serving the frontend.

    Returns:
        function: The FastAPI application.
    """
    app = FastAPI()
    # Add compression middleware to reduce bandwidth
    app.add_middleware(GZipMiddleware, minimum_size=500)
    
    frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
    dist_dir = os.path.join(frontend_dir, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")


    @app.get("/", response_class=HTMLResponse)
    async def root():
        return FileResponse(os.path.join(dist_dir, "index.html"))

    @app.post("/embedding/image")
    async def generate_image_embedding(image: UploadFile = File(...)):
        """Generate a CLIP image embedding from an uploaded image.

        Returns a JSON object with a 512-d float array.
        """
        try:
            if not image.content_type or not image.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Uploaded file must be an image")
            image_bytes = await image.read()
            if not image_bytes:
                raise HTTPException(status_code=400, detail="Empty image upload")
            from agent_lens.utils.weaviate_search import generate_image_embedding
            embedding = await generate_image_embedding(image_bytes)
            return {"model": "ViT-B/32", "embedding": embedding, "dimension": len(embedding)}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error generating image embedding: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/embedding/text")
    async def generate_text_embedding_endpoint(text: str):
        """Generate a CLIP text embedding from a text input.

        Args:
            text (str): Text input to generate embedding for
            
        Returns:
            dict: JSON object with embedding vector and metadata
        """
        try:
            if not text or not text.strip():
                raise HTTPException(status_code=400, detail="Text input cannot be empty")
            
            from agent_lens.utils.weaviate_search import generate_text_embedding
            embedding = await generate_text_embedding(text.strip())
            return {
                "model": "ViT-B/32", 
                "embedding": embedding, 
                "dimension": len(embedding),
                "text": text.strip()
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error generating text embedding: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/datasets")
    async def get_datasets(gallery_id: str = None):
        """
        Endpoint to fetch a list of available time-lapse datasets (scan datasets).
        These are children of a main "gallery" or "project" collection.

        Args:
            gallery_id (str, optional): The ID of the gallery to fetch datasets from.
                If not provided, returns an empty list.

        Returns:
            list: A list of datasets (each representing a time-lapse scan).
        """
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            # Ensure a connection with token if not already established
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        
        try:
            if not gallery_id:
                logger.warning("No gallery_id provided to /datasets endpoint")
                return []
                
            logger.info(f"Fetching time-lapse datasets from gallery: {gallery_id}")
            
            # List children of this gallery_id. Each child is a time-lapse dataset.
            time_lapse_datasets = await artifact_manager_instance._svc.list(parent_id=gallery_id)
            
            logger.info(f"Gallery response received, datasets found: {len(time_lapse_datasets) if time_lapse_datasets else 0}")
            
            formatted_datasets = []
            if time_lapse_datasets:
                for dataset_item in time_lapse_datasets:
                    full_id = dataset_item.get("id") # e.g., "agent-lens/20250506-scan-..."
                    display_name = dataset_item.get("manifest", {}).get("name", dataset_item.get("alias", full_id))
                    
                    if full_id:
                         # Extract the alias part if workspace is prefixed
                        alias_part = full_id
                        if full_id.startswith(f"{artifact_manager_instance.server.config.workspace}/"):
                             alias_part = full_id.split('/', 1)[1]
                        
                        logger.info(f"Time-lapse dataset found: {display_name} (alias for API: {alias_part}, full_id: {full_id})")
                        formatted_datasets.append({"id": alias_part, "name": display_name, "full_hypha_id": full_id})
            return formatted_datasets
        except Exception as e:
            logger.error(f"Error fetching datasets: {e}")
            logger.error(traceback.format_exc())
            return []

    @app.get("/gallery-info")
    async def get_gallery_info(gallery_id: str):
        """
        Endpoint to fetch information about a specific gallery.
        
        Args:
            gallery_id (str): The ID of the gallery to get information for.
            
        Returns:
            dict: Gallery information including name from manifest.
        """
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        
        try:
            logger.info(f"Fetching gallery info for: {gallery_id}")
            
            # Try to get the gallery information directly
            try:
                gallery_info = await artifact_manager_instance._svc.get(gallery_id)
                if gallery_info:
                    # Extract display name using the same pattern as datasets
                    display_name = gallery_info.get("manifest", {}).get("name", gallery_info.get("alias", gallery_id))
                    logger.info(f"Gallery info found: {display_name} for {gallery_id}")
                    return {
                        "id": gallery_id,
                        "name": display_name,
                        "manifest": gallery_info.get("manifest", {}),
                        "alias": gallery_info.get("alias", gallery_id)
                    }
            except Exception as get_error:
                logger.warning(f"Could not get gallery info directly: {get_error}")
            
            # Fallback: try to list the gallery to see if it exists
            try:
                gallery_contents = await artifact_manager_instance._svc.list(parent_id=gallery_id)
                if gallery_contents is not None:
                    # Gallery exists but we couldn't get its manifest
                    # Use the gallery ID parts as fallback name
                    fallback_name = gallery_id.split('/')[-1] if '/' in gallery_id else gallery_id
                    logger.info(f"Gallery exists but no manifest info available, using fallback name: {fallback_name}")
                    return {
                        "id": gallery_id,
                        "name": fallback_name,
                        "manifest": {},
                        "alias": fallback_name
                    }
            except Exception as list_error:
                logger.error(f"Gallery {gallery_id} does not seem to exist: {list_error}")
            
            # Gallery not found
            return {
                "error": f"Gallery {gallery_id} not found",
                "id": gallery_id,
                "name": gallery_id.split('/')[-1] if '/' in gallery_id else gallery_id
            }
            
        except Exception as e:
            logger.error(f"Error fetching gallery info: {e}")
            logger.error(traceback.format_exc())
            return {
                "error": str(e),
                "id": gallery_id,
                "name": gallery_id.split('/')[-1] if '/' in gallery_id else gallery_id
            }

    @app.get("/subfolders")
    async def get_subfolders(dataset_id: str, dir_path: str = None, offset: int = 0, limit: int = 20):
        """
        Endpoint to fetch contents (files and subfolders) from a specified directory within a time-lapse dataset.
        The dataset_id is the ALIAS of the time-lapse dataset.
        This is mainly for browsing raw data if needed, not directly for Zarr tile rendering.
        """
        logger.info(f"Fetching contents for dataset (alias): {dataset_id}, dir_path: {dir_path}, offset: {offset}, limit: {limit}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am) # Connect artifact_manager_instance
        try:
            # Construct the full hypha artifact ID using the workspace and the dataset_id (alias)
            workspace = artifact_manager_instance.server.config.workspace # Should be "agent-lens"
            full_hypha_dataset_id = f"{workspace}/{dataset_id}"
            
            logger.info(f"Listing files for full Hypha ID: {full_hypha_dataset_id}, dir_path: {dir_path}")
            all_items = await artifact_manager_instance._svc.list_files(full_hypha_dataset_id, dir_path=dir_path)
            logger.info(f"All items, length: {len(all_items)}")
            
            # Sort: directories first, then files, both alphabetically
            directories = [item for item in all_items if item.get('type') == 'directory']
            directories.sort(key=lambda x: x.get('name', ''))
            
            files = [item for item in all_items if item.get('type') == 'file']
            files.sort(key=lambda x: x.get('name', ''))
            
            # Combine the sorted lists
            sorted_items = directories + files
            
            # Apply pagination
            total_count = len(sorted_items)
            paginated_items = sorted_items[offset:offset + limit] if offset < total_count else []
            
            logger.info(f"Returning {len(paginated_items)} of {total_count} items (offset: {offset}, limit: {limit})")
            
            # Return both the items and the total count
            return {
                "items": paginated_items,
                "total": total_count,
                "offset": offset,
                "limit": limit
            }
        except Exception as e:
            logger.error(f"Error fetching contents: {e}")
            logger.error(traceback.format_exc())
            return {"items": [], "total": 0, "offset": offset, "limit": limit, "error": str(e)}

    @app.get("/file")
    async def get_file_url(dataset_id: str, file_path: str):
        """
        Endpoint to get a pre-signed URL for a file in a dataset.
        dataset_id is the ALIAS of the time-lapse dataset.
        """
        logger.info(f"Getting file URL for dataset (alias): {dataset_id}, file_path: {file_path}")
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        try:
            workspace = artifact_manager_instance.server.config.workspace
            full_hypha_dataset_id = f"{workspace}/{dataset_id}"
            logger.info(f"Getting file URL for full Hypha ID: {full_hypha_dataset_id}, file_path: {file_path}")
            url = await artifact_manager_instance._svc.get_file(full_hypha_dataset_id, file_path)
            return {"url": url}
        except Exception as e:
            logger.error(f"Error getting file URL: {e}")
            logger.error(traceback.format_exc())
            return {"error": str(e)}

    @app.get("/download")
    async def download_file(dataset_id: str, file_path: str):
        """
        Endpoint to download a file from a dataset.
        dataset_id is the ALIAS of the time-lapse dataset.
        """
        logger.info(f"Downloading file from dataset (alias): {dataset_id}, file_path: {file_path}")
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        try:
            workspace = artifact_manager_instance.server.config.workspace
            full_hypha_dataset_id = f"{workspace}/{dataset_id}"
            logger.info(f"Downloading file from full Hypha ID: {full_hypha_dataset_id}, file_path: {file_path}")
            url = await artifact_manager_instance._svc.get_file(full_hypha_dataset_id, file_path)
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=url)
        except Exception as e:
            logger.error(f"Error downloading file: {e}")
            logger.error(traceback.format_exc())
            from fastapi.responses import JSONResponse
            return JSONResponse(content={"error": str(e)}, status_code=404)

    #########################################################################################
    # These endpoints are used by new microscope map display
    #########################################################################################
    @app.get("/list-microscope-galleries")
    async def list_microscope_galleries_endpoint(microscope_service_id: str = None):
        """
        Endpoint to list all galleries (collections) from all microscopes.
        Returns a list of gallery info dicts from all microscopes.
        """
        try:
            result = await artifact_manager_instance.list_microscope_galleries(microscope_service_id)
            return result
        except Exception as e:
            logger.error(f"Error in /list-microscope-galleries: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}

    @app.get("/list-gallery-datasets")
    async def list_gallery_datasets_endpoint(
        gallery_id: str = None,
        microscope_service_id: str = None,
        experiment_id: str = None
    ):
        """
        Endpoint to list all datasets in a gallery (collection).
        You can specify the gallery by its artifact ID, or provide microscope_service_id and/or experiment_id to find the gallery.
        Returns a list of datasets in the gallery.
        """
        try:
            result = await artifact_manager_instance.list_gallery_datasets(
                gallery_id=gallery_id,
                microscope_service_id=microscope_service_id,
                experiment_id=experiment_id
            )
            return result
        except Exception as e:
            logger.error(f"Error in /list-gallery-datasets: {e}")
            logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}

    #########################################################################################
    # Similarity Search Endpoints
    #########################################################################################
    
    @app.post("/similarity/collections")
    async def create_similarity_collection(
        collection_name: str,
        description: str = "Microscopy images collection",
        application_id: str = None
    ):
        """
        Create a new collection for similarity search.
        
        Args:
            collection_name (str): Name of the collection to create
            description (str): Description of the collection
            application_id (str, optional): Application ID. If not provided, generates one.
            
        Returns:
            dict: Result of collection creation
        """
        try:
            # Ensure similarity service is connected
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            # Generate application ID if not provided
            if not application_id:
                application_id = f"app_{uuid.uuid4().hex[:8]}"
            
            # Create collection
            collection_result = await similarity_service.create_collection(collection_name, description)
            
            # Create application for the collection
            app_result = await similarity_service.create_application(
                collection_name, application_id, f"Application for {description}"
            )
            
            return {
                "success": True,
                "collection_name": collection_name,
                "application_id": application_id,
                "collection_result": collection_result,
                "application_result": app_result
            }
            
        except Exception as e:
            logger.error(f"Error creating similarity collection: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/similarity/collections")
    async def list_similarity_collections():
        """
        List all available similarity search collections.
        
        Returns:
            dict: List of collections
        """
        try:
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            collections = await similarity_service.list_collections()
            return {"success": True, "collections": collections}
            
        except Exception as e:
            logger.error(f"Error listing similarity collections: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.delete("/similarity/collections/{collection_name}")
    async def delete_similarity_collection(collection_name: str):
        """
        Delete a similarity search collection.
        
        Args:
            collection_name (str): Name of the collection to delete
            
        Returns:
            dict: Result of deletion
        """
        try:
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            result = await similarity_service.delete_collection(collection_name)
            return {"success": True, "result": result}
            
        except Exception as e:
            logger.error(f"Error deleting similarity collection: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/insert")
    async def insert_image_for_similarity(
        collection_name: str,
        application_id: str,
        image_id: str,
        description: str,
        metadata: str = "{}",
        dataset_id: str = None,
        file_path: str = None,
        image: UploadFile = File(None),
        preview_image: str = Form(None),  # Preview image from FormData
        # NEW: Accept pre-generated image embedding from request body
        image_embedding: str = Form(None)   # JSON string of image embedding vector from FormData
    ):
        """
        Insert an image into a similarity search collection.
        
        Args:
            collection_name (str): Name of the collection
            application_id (str): Application ID
            image_id (str): Unique identifier for the image
            description (str): Text description of the image
            metadata (str): JSON string of metadata
            dataset_id (str, optional): Dataset ID
            file_path (str, optional): File path
            image (UploadFile, optional): Image file to generate embedding from
            
        Returns:
            dict: Result of insertion
        """
        try:
            
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            # Convert collection name to valid Weaviate class name (no hyphens, starts with uppercase)
            # Split by hyphens and capitalize each word, then join
            words = collection_name.split('-')
            valid_collection_name = ''.join(word.capitalize() for word in words)
            
            # Ensure it starts with uppercase letter
            if not valid_collection_name[0].isupper():
                valid_collection_name = 'A' + valid_collection_name[1:]
            
            # Check if collection exists, create if it doesn't
            try:
                collection_exists = await similarity_service.collection_exists(valid_collection_name)
                if not collection_exists:
                    logger.info(f"Collection {valid_collection_name} does not exist, creating it...")
                    collection_result = await similarity_service.create_collection(valid_collection_name, f"Collection for {collection_name}")
                    logger.info(f"Successfully created collection {valid_collection_name}: {collection_result}")
                else:
                    logger.info(f"Collection {valid_collection_name} already exists")
            except Exception as e:
                logger.error(f"Failed to check/create collection {valid_collection_name}: {e}")
                raise HTTPException(status_code=500, detail=f"Failed to create collection {valid_collection_name}: {str(e)}")
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            # Check if application exists, create if it doesn't
            try:
                app_exists = await similarity_service.application_exists(valid_collection_name, clean_application_id)
                if not app_exists:
                    logger.info(f"Application {clean_application_id} does not exist in collection {valid_collection_name}, creating it...")
                    app_result = await similarity_service.create_application(
                        collection_name=valid_collection_name,
                        application_id=clean_application_id,
                        description=f"Application for dataset {clean_application_id}"
                    )
                    logger.info(f"Successfully created application {clean_application_id}: {app_result}")
                else:
                    logger.info(f"Application {clean_application_id} already exists in collection {valid_collection_name}")
            except Exception as e:
                logger.error(f"Failed to check/create application {clean_application_id}: {e}")
                # Don't continue if we can't create the application
                raise HTTPException(status_code=500, detail=f"Failed to create application {clean_application_id}: {str(e)}")
            
            # Parse metadata
            import json
            try:
                metadata_dict = json.loads(metadata) if metadata else {}
            except json.JSONDecodeError:
                metadata_dict = {"raw_metadata": metadata}
            
            # Use pre-generated image embedding if provided, otherwise generate from uploaded image
            vector = None
            
            # Priority 1: Use pre-generated image embedding if available
            if image_embedding:
                try:
                    import json
                    vector = json.loads(image_embedding)
                    logger.info(f"Using pre-generated image embedding for {image_id}")
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse image_embedding JSON: {e}")
                    vector = None
            
            # Priority 2: Generate from uploaded image if no pre-generated embedding
            if vector is None and image and image.content_type and image.content_type.startswith("image/"):
                image_bytes = await image.read()
                if image_bytes:
                    vector = await generate_image_embedding(image_bytes)
                    logger.info(f"Generated image embedding from uploaded image for {image_id}")
            
            # If no vector available, raise an error
            if vector is None:
                raise HTTPException(status_code=400, detail="No image embedding available. Provide either image_embedding parameter or upload an image file.")
            
            result = await similarity_service.insert_image(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
                image_id=image_id,
                description=description,
                metadata=metadata_dict,
                dataset_id=dataset_id,
                file_path=file_path,
                vector=vector,
                preview_image=preview_image
            )
            
            return {"success": True, "result": result}
            
        except Exception as e:
            logger.error(f"Error inserting image for similarity: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/search/text")
    async def search_similar_by_text(
        collection_name: str,
        application_id: str,
        query_text: str,
        limit: int = 10
    ):
        """
        Search for similar images using text query.
        
        Args:
            collection_name (str): Name of the collection to search
            application_id (str): Application ID
            query_text (str): Text query for similarity search
            limit (int): Maximum number of results to return
            
        Returns:
            dict: Search results
        """
        try:
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            results = await similarity_service.search_by_text(
                collection_name=collection_name,
                application_id=application_id,
                query_text=query_text,
                limit=limit
            )
            
            return {"success": True, "results": results, "query": query_text, "count": len(results)}
            
        except Exception as e:
            logger.error(f"Error searching by text: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/search/image")
    async def search_similar_by_image(
        collection_name: str,
        application_id: str,
        image: UploadFile = File(...),
        limit: int = 10
    ):
        """
        Search for similar images using image query.
        
        Args:
            collection_name (str): Name of the collection to search
            application_id (str): Application ID
            image (UploadFile): Image file for similarity search
            limit (int): Maximum number of results to return
            
        Returns:
            dict: Search results
        """
        try:
            if not image.content_type or not image.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Uploaded file must be an image")
            
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            image_bytes = await image.read()
            if not image_bytes:
                raise HTTPException(status_code=400, detail="Empty image upload")
            
            results = await similarity_service.search_by_image(
                collection_name=collection_name,
                application_id=application_id,
                image_bytes=image_bytes,
                limit=limit
            )
            
            return {"success": True, "results": results, "count": len(results)}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error searching by image: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/search/vector")
    async def search_similar_by_vector(
        collection_name: str,
        application_id: str,
        query_vector: List[float],
        limit: int = 10,
        include_vector: bool = False
    ):
        """
        Search for similar images using vector query.
        
        Args:
            collection_name (str): Name of the collection to search
            application_id (str): Application ID
            query_vector (List[float]): Vector for similarity search
            limit (int): Maximum number of results to return
            include_vector (bool): Whether to include vectors in results
            
        Returns:
            dict: Search results
        """
        try:
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            # Convert collection name to valid Weaviate class name
            words = collection_name.split('-')
            valid_collection_name = ''.join(word.capitalize() for word in words)
            if not valid_collection_name[0].isupper():
                valid_collection_name = 'A' + valid_collection_name[1:]
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            results = await similarity_service.search_similar_images(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
                query_vector=query_vector,
                limit=limit,
                include_vector=include_vector
            )
            
            return {"success": True, "results": results, "count": len(results)}
            
        except Exception as e:
            logger.error(f"Error searching by vector: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/similarity/collections/{collection_name}/exists")
    async def check_collection_exists(collection_name: str):
        """
        Check if a collection exists.
        
        Args:
            collection_name (str): Name of the collection to check
            
        Returns:
            dict: Whether the collection exists
        """
        try:
            if not await similarity_service.ensure_connected():
                raise HTTPException(status_code=500, detail="Failed to connect to similarity search service")
            
            exists = await similarity_service.collection_exists(collection_name)
            return {"success": True, "exists": exists, "collection_name": collection_name}
            
        except Exception as e:
            logger.error(f"Error checking collection existence: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    async def serve_fastapi(args):
        await app(args["scope"], args["receive"], args["send"])

    return serve_fastapi


async def register_service_probes(server, server_id="agent-lens"):
    """
    Register readiness and liveness probes for Kubernetes health checks.
    
    Args:
        server (Server): The server instance.
        server_id (str): The ID of the service.
    """
    # Register probes on the server
    await _register_probes(server, server_id)

async def _register_probes(server, probe_service_id):
    """
    Internal function to register probes on a given server.
    
    Args:
        server (Server): The server to register probes on.
        probe_service_id (str): The ID to use for probe registrations.
    """
    async def is_service_healthy():
        logger.info("Checking service health")
        # Minimal check: ensure artifact_manager can attempt a connection
        # and that it's properly initialized after connection attempt.
        try:
            # Try to list the default gallery to ensure it's accessible
            default_gallery_id = "agent-lens/20250506-scan-time-lapse-gallery"
            logger.info(f"Health check: Attempting to list default gallery: {default_gallery_id}")
            
            try:
                # Use the artifact_manager to list the gallery contents
                if not artifact_manager_instance.server:
                    logger.info("Artifact manager not connected, connecting for health check...")
                    server_for_am, svc_for_am = await get_artifact_manager()
                    await artifact_manager_instance.connect_server(server_for_am)
                
                gallery_contents = await artifact_manager_instance._svc.list(parent_id=default_gallery_id)
                
                if not gallery_contents:
                    logger.warning(f"Health check: Default gallery '{default_gallery_id}' exists but is empty.")
                    # This is not a critical error if the gallery exists but is empty
                else:
                    logger.info(f"Health check: Successfully listed default gallery with {len(gallery_contents)} items.")
            except Exception as gallery_error:
                logger.error(f"Health check: Failed to list gallery '{default_gallery_id}': {gallery_error}")
                raise RuntimeError(f"Failed to list default gallery: {gallery_error}")

            logger.info("Service appears healthy (TileManager connection established and gallery accessible).")
            return {"status": "ok", "message": "Service healthy"}

        except Exception as e:
            logger.error(f"Health check failed: {str(e)}")
            logger.error(traceback.format_exc())
            raise RuntimeError(f"Service health check failed: {str(e)}")
    
    logger.info(f"Registering health probes for Kubernetes with ID: {probe_service_id}")
    await server.register_probes({
        f"readiness-{probe_service_id}": is_service_healthy,
        f"liveness-{probe_service_id}": is_service_healthy
    })
    logger.info("Health probes registered successfully")

async def setup_service(server, server_id="agent-lens"):
    """
    Set up the frontend service.

    Args:
        server (Server): The server instance.
    """
    # Get command line arguments
    cmd_args = " ".join(sys.argv)
    
    # Check if we're in connect-server mode and not in docker mode
    is_connect_server = "connect-server" in cmd_args
    is_docker = "--docker" in cmd_args
    
    # Use 'agent-lens-test' as service_id only when using connect-server in VSCode (not in docker)
    if is_connect_server and not is_docker:
        server_id = "agent-lens-test"
    
    # Ensure artifact_manager_instance is connected
    if artifact_manager_instance.server is None:
        try:
            api_server, artifact_manager = await get_artifact_manager()
            await artifact_manager_instance.connect_server(api_server)
            logger.info("AgentLensArtifactManager connected successfully.")
        except Exception as e:
            logger.warning(f"Warning: Failed to connect AgentLensArtifactManager: {e}")
            logger.warning("Some endpoints may not function correctly.")
    
    # Register the service
    await server.register_service(
        {
            "id": server_id,
            "name": "Agent Lens",
            "type": "asgi",
            "serve": get_frontend_api(),
            "config": {"visibility": "public"},
        }
    )

    logger.info(f"Frontend service registered successfully with ID: {server_id}")

    # Check if we're running locally
    is_local = "--port" in cmd_args or "start-server" in cmd_args
    
    # Check if we're running in test mode
    is_test_mode = (
        "pytest" in cmd_args or 
        "test" in cmd_args or 
        server_id.startswith("test-") or 
        any("test" in arg.lower() for arg in sys.argv)
    )
    
    # Only register service health probes when not running locally, not in test mode, and not in VSCode connect-server mode
    # Docker mode should register probes
    if not is_local and not is_test_mode and (is_docker or not is_connect_server):
        await register_service_probes(server, server_id)
    elif is_test_mode:
        logger.info(f"Skipping health probe registration for test service: {server_id}")

    # Store the cleanup function in the server's config
    # Note: No specific cleanup needed since artifact_manager_instance is global
 