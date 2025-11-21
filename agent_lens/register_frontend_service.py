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
import asyncio
import base64
# Import similarity search utilities
from agent_lens.utils.weaviate_search import similarity_service, WEAVIATE_COLLECTION_NAME

# Configure logging
from .log import setup_logging

logger = setup_logging("agent_lens_frontend_service.log")


# -------------------- CLIP Embedding Helpers --------------------
# Lazy-load CLIP model for generating embeddings
# Note: CPU thread configuration is handled in weaviate_search.py
device = "cuda" if torch.cuda.is_available() else "cpu"
_clip_model = None
_clip_preprocess = None

# Log GPU information at module load
if torch.cuda.is_available():
    logger.info("✓ CUDA available - GPU will be used for CLIP model")
    logger.info(f"  CUDA Device: {torch.cuda.get_device_name(0)}")
    logger.info(f"  CUDA Version: {torch.version.cuda}")
    logger.info(f"  PyTorch Version: {torch.__version__}")
else:
    logger.warning("⚠ CUDA not available - CLIP model will use CPU (slower)")
    logger.warning("  Ensure Docker has GPU access configured (nvidia-container-toolkit)")

def _load_clip_model():
    """Load CLIP ViT-B/32 model lazily and cache it in memory."""
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        # Use CLIP_CACHE environment variable if set, otherwise use default
        clip_cache_dir = os.getenv("CLIP_CACHE")
        logger.info(f"Loading CLIP ViT-B/32 on {device}")
        if clip_cache_dir:
            logger.info(f"Using CLIP cache directory: {clip_cache_dir}")
            _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device, download_root=clip_cache_dir)
        else:
            logger.info("Using default CLIP cache directory")
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

# Global state for current active application (for similarity search)
current_application_id = None

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
    
    # Mount agent-configs directory for serving agent configuration files
    agent_configs_dir = os.path.join(dist_dir, "agent-configs")
    if os.path.exists(agent_configs_dir):
        app.mount("/agent-configs", StaticFiles(directory=agent_configs_dir), name="agent-configs")
    
    # Mount pypi directory for serving Python wheel files for Pyodide
    pypi_dir = os.path.join(dist_dir, "pypi")
    if os.path.exists(pypi_dir):
        app.mount("/pypi", StaticFiles(directory=pypi_dir), name="pypi")


    @app.get("/", response_class=HTMLResponse)
    async def root():
        return FileResponse(os.path.join(dist_dir, "index.html"))
    
    @app.get("/web-python-kernel.mjs")
    async def web_python_kernel():
        """Serve the web-python-kernel module."""
        return FileResponse(
            os.path.join(dist_dir, "web-python-kernel.mjs"),
            media_type="application/javascript"
        )
    
    @app.get("/kernel.worker.js")
    async def kernel_worker():
        """Serve the kernel worker script."""
        return FileResponse(
            os.path.join(dist_dir, "kernel.worker.js"),
            media_type="application/javascript"
        )

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

    @app.post("/embedding/image-batch")
    async def generate_image_embedding_batch(images: List[UploadFile] = File(...)):
        """Generate CLIP image embeddings from multiple uploaded images in batch.
        
        This endpoint uses optimized batch processing with parallel I/O for significantly faster
        embedding generation, especially when using GPU acceleration.

        Args:
            images: List of image files to process

        Returns:
            dict: JSON object with success flag, results array, and count
                {
                    "success": True,
                    "results": [
                        {"success": True, "embedding": [...], "dimension": 512, "model": "ViT-B/32"},
                        None,  # if failed
                        {"success": True, "embedding": [...], "dimension": 512, "model": "ViT-B/32"},
                    ],
                    "count": 3
                }
        """
        try:
            if not images or len(images) == 0:
                raise HTTPException(status_code=400, detail="At least one image is required")
            
            from agent_lens.utils.weaviate_search import generate_image_embeddings_batch
            
            # Parallel image reading for faster I/O
            async def read_image(idx: int, image: UploadFile):
                """Read a single image file asynchronously."""
                try:
                    if not image.content_type or not image.content_type.startswith("image/"):
                        return None, idx
                    
                    image_bytes = await image.read()
                    if not image_bytes:
                        return None, idx
                    
                    return image_bytes, idx
                except Exception as e:
                    logger.warning(f"Error reading image {image.filename}: {e}")
                    return None, idx
            
            # Read all images in parallel (much faster than sequential!)
            read_tasks = [read_image(idx, image) for idx, image in enumerate(images)]
            read_results = await asyncio.gather(*read_tasks)
            
            # Filter valid images and track indices
            image_bytes_list = []
            valid_indices = []
            
            for image_bytes, idx in read_results:
                if image_bytes is not None:
                    image_bytes_list.append(image_bytes)
                    valid_indices.append(idx)
            
            if not image_bytes_list:
                raise HTTPException(status_code=400, detail="No valid images found in upload")
            
            # Process all images in a single batch (much faster!)
            embeddings = await generate_image_embeddings_batch(image_bytes_list)
            
            # Map results back to original order
            results = [None] * len(images)
            for valid_idx, embedding in zip(valid_indices, embeddings):
                if embedding is not None:
                    results[valid_idx] = {
                        "success": True,
                        "embedding": embedding,
                        "dimension": len(embedding),
                        "model": "ViT-B/32"
                    }
                # else: results[valid_idx] remains None
            
            return {
                "success": True,
                "results": results,
                "count": len(results)
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error generating batch image embeddings: {e}")
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
            # Check if similarity service is available
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection - never create new collections
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Generate application ID if not provided
            if not application_id:
                application_id = f"app_{uuid.uuid4().hex[:8]}"
            
            # Check if collection already exists
            collection_exists = await similarity_service.collection_exists(valid_collection_name)
            
            if not collection_exists:
                # Create collection with the transformed name
                try:
                    collection_result = await similarity_service.create_collection(valid_collection_name, description)
                except Exception as e:
                    if "already exists" in str(e) or "class already exists" in str(e):
                        logger.info(f"Collection {valid_collection_name} already exists - using existing collection")
                        collection_result = {"message": "Collection already exists"}
                    else:
                        raise
            else:
                logger.info(f"Collection {valid_collection_name} already exists - using existing collection")
                collection_result = {"message": "Collection already exists"}
            
            # Create application for the collection
            app_result = await similarity_service.create_application(
                valid_collection_name, application_id, f"Application for {description}"
            )
            
            # Set as current application
            global current_application_id
            current_application_id = application_id
            logger.info(f"Set current application to: {application_id}")
            
            return {
                "success": True,
                "collection_name": valid_collection_name,  # Return the transformed name
                "original_name": collection_name,  # Also return original for reference
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
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            collections = await similarity_service.list_collections()
            return {"success": True, "collections": collections}
            
        except Exception as e:
            logger.error(f"Error listing similarity collections: {e}")
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
            
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
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

    @app.post("/similarity/insert-many")
    async def insert_many_images_for_similarity(
        collection_name: str,
        application_id: str,
        objects_json: str = Form(...)  # JSON string of objects array
    ):
        """
        Insert multiple images into a similarity search collection using batch insertion.
        
        Args:
            collection_name (str): Name of the collection (will be overridden to use Agentlens)
            application_id (str): Application ID
            objects_json (str): JSON string containing array of objects, each with:
                - image_id: Unique identifier
                - description: Text description
                - metadata: Dict of metadata
                - dataset_id: Optional dataset ID
                - vector: Image embedding vector (required)
                - preview_image: Optional base64 preview image
        
        Returns:
            dict: Result of batch insertion with uuids
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            # Parse JSON string to list of objects
            import json
            try:
                objects_list = json.loads(objects_json)
            except json.JSONDecodeError as e:
                raise HTTPException(status_code=400, detail=f"Invalid JSON in objects_json: {str(e)}")
            
            if not isinstance(objects_list, list):
                raise HTTPException(status_code=400, detail="objects_json must be a JSON array")
            
            if len(objects_list) == 0:
                raise HTTPException(status_code=400, detail="objects array cannot be empty")
            
            # Validate that all objects have required fields
            for i, obj in enumerate(objects_list):
                if not isinstance(obj, dict):
                    raise HTTPException(status_code=400, detail=f"Object at index {i} must be a dictionary")
                if "image_id" not in obj:
                    raise HTTPException(status_code=400, detail=f"Object at index {i} missing required field 'image_id'")
                if "vector" not in obj:
                    raise HTTPException(status_code=400, detail=f"Object at index {i} missing required field 'vector'")
                if not isinstance(obj["vector"], list):
                    raise HTTPException(status_code=400, detail=f"Object at index {i} field 'vector' must be a list")
            
            # Prepare objects for insertion (ensure dataset_id is set)
            for obj in objects_list:
                if "dataset_id" not in obj or not obj["dataset_id"]:
                    obj["dataset_id"] = clean_application_id
            
            # Use batch insertion
            result = await similarity_service.insert_many_images(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
                objects=objects_list
            )
            
            logger.info(f"Successfully batch inserted {len(objects_list)} images into collection: {valid_collection_name}")
            return {"success": True, "result": result, "count": len(objects_list)}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error batch inserting images for similarity: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/similarity/current-application")
    async def get_current_application():
        """
        Get the currently active application ID.
        
        Returns:
            dict: Current application information
        """
        global current_application_id
        return {
            "success": True,
            "application_id": current_application_id,
            "collection_name": WEAVIATE_COLLECTION_NAME
        }

    @app.post("/similarity/current-application")
    async def set_current_application(application_id: str):
        """
        Set the currently active application ID.
        
        Args:
            application_id (str): Application ID to set as current
            
        Returns:
            dict: Confirmation of the set operation
        """
        global current_application_id
        current_application_id = application_id
        logger.info(f"Set current application to: {application_id}")
        return {
            "success": True,
            "application_id": current_application_id,
            "collection_name": WEAVIATE_COLLECTION_NAME
        }

    @app.post("/similarity/search/text")
    async def search_similar_by_text(
        query_text: str,
        application_id: str = None,
        limit: int = 10
    ):
        """
        Search for similar images using text query.
        Supports uuid: prefix for UUID-based search.
        
        Args:
            query_text (str): Text query for similarity search, or "uuid: <uuid>" for UUID search
            application_id (str, optional): Application ID. If not provided, uses current active application
            limit (int): Maximum number of results to return
            
        Returns:
            dict: Search results
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Use global application_id if not provided
            global current_application_id
            if application_id is None:
                if current_application_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="No application_id provided and no active application set. Please set an active application first."
                    )
                application_id = current_application_id
                logger.info(f"Using current application: {application_id}")
            
            # Always use the existing 'Agentlens' collection - never create new collections
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            # Check if query_text starts with "uuid:" prefix
            query_text_stripped = query_text.strip()
            if query_text_stripped.startswith("uuid:"):
                # Extract the UUID (everything after "uuid:")
                object_uuid = query_text_stripped[len("uuid:"):].strip()
                
                if not object_uuid:
                    raise HTTPException(status_code=400, detail="UUID cannot be empty after 'uuid:' prefix")
                
                logger.info(f"Performing UUID based search for UUID: {object_uuid}")
                
                # Use UUID based search
                results = await similarity_service.search_by_uuid(
                    collection_name=valid_collection_name,
                    application_id=clean_application_id,
                    object_uuid=object_uuid,
                    limit=limit,
                    include_vector=False
                )
                
                return {
                    "success": True,
                    "results": results,
                    "query": query_text,
                    "query_type": "uuid",
                    "uuid": object_uuid,
                    "count": len(results)
                }
            else:
                # Regular text search
                results = await similarity_service.search_by_text(
                    collection_name=valid_collection_name,
                    application_id=clean_application_id,
                    query_text=query_text,
                    limit=limit
                )
                
                return {
                    "success": True,
                    "results": results,
                    "query": query_text,
                    "query_type": "text",
                    "count": len(results)
                }
            
        except HTTPException:
            raise
        except ValueError as e:
            # Handle case where image_id is not found
            logger.error(f"Image ID search error: {e}")
            raise HTTPException(status_code=404, detail=str(e))
        except Exception as e:
            logger.error(f"Error searching by text: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/search/image")
    async def search_similar_by_image(
        image: UploadFile = File(...),
        application_id: str = None,
        limit: int = 10
    ):
        """
        Search for similar images using image query.
        
        Args:
            image (UploadFile): Image file for similarity search
            application_id (str, optional): Application ID. If not provided, uses current active application
            limit (int): Maximum number of results to return
            
        Returns:
            dict: Search results
        """
        try:
            if not image.content_type or not image.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Uploaded file must be an image")
            
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Use global application_id if not provided
            global current_application_id
            if application_id is None:
                if current_application_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="No application_id provided and no active application set. Please set an active application first."
                    )
                application_id = current_application_id
                logger.info(f"Using current application: {application_id}")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            image_bytes = await image.read()
            if not image_bytes:
                raise HTTPException(status_code=400, detail="Empty image upload")
            
            results = await similarity_service.search_by_image(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
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
        query_vector: List[float],
        application_id: str = None,
        limit: int = 10,
        include_vector: bool = False
    ):
        """
        Search for similar images using vector query.
        
        Args:
            query_vector (List[float]): Vector for similarity search
            application_id (str, optional): Application ID. If not provided, uses current active application
            limit (int): Maximum number of results to return
            include_vector (bool): Whether to include vectors in results
            
        Returns:
            dict: Search results
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Use global application_id if not provided
            global current_application_id
            if application_id is None:
                if current_application_id is None:
                    raise HTTPException(
                        status_code=400,
                        detail="No application_id provided and no active application set. Please set an active application first."
                    )
                application_id = current_application_id
                logger.info(f"Using current application: {application_id}")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
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

    @app.delete("/similarity/applications/delete")
    async def delete_similarity_application(
        collection_name: str,
        application_id: str
    ):
        """
        Delete an application and all its associated data from a collection.
        
        Args:
            collection_name (str): Name of the collection
            application_id (str): Application ID to delete
            
        Returns:
            dict: Deletion result
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            # Delete the application
            result = await similarity_service.weaviate_service.applications.delete(
                collection_name=valid_collection_name,
                application_id=clean_application_id
            )
            
            # Clear current application if it was deleted
            global current_application_id
            if current_application_id == clean_application_id:
                current_application_id = None
                logger.info("Cleared current application (was deleted)")
            
            logger.info(f"Deleted application '{clean_application_id}' from collection '{valid_collection_name}'")
            return {"success": True, "result": result}
            
        except Exception as e:
            error_str = str(e)
            # If application doesn't exist, return success instead of error
            if "does not exist" in error_str.lower():
                logger.info(f"Application does not exist: {error_str}")
                return {"success": True, "result": {"message": "Application does not exist"}}
            
            logger.error(f"Error deleting application: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/similarity/fetch-all")
    async def fetch_all_annotations(
        collection_name: str,
        application_id: str,
        limit: int = 10000,
        include_vector: bool = False,
        use_prefix_match: bool = True
    ):
        """
        Fetch all annotations from a collection for a given application.
        
        Args:
            collection_name (str): Name of the collection
            application_id (str): Application ID (dataset or experiment name) - used as prefix if use_prefix_match=True
            limit (int): Maximum number of annotations to return
            include_vector (bool): Whether to include vectors in results
            use_prefix_match (bool): If True, match all annotations where application_id starts with the given prefix.
                                     Defaults to True to show all annotations for multiple annotation applications.
            
        Returns:
            dict: All annotations in the collection
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part (last part after slash)
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            results = await similarity_service.fetch_all_annotations(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
                limit=limit,
                include_vector=include_vector,
                use_prefix_match=use_prefix_match
            )
            
            match_type = f"prefix '{clean_application_id}*'" if use_prefix_match else f"exact '{clean_application_id}'"
            logger.info(f"Fetched {len(results)} annotations for application {match_type}")
            return {"success": True, "annotations": results, "total": len(results)}
            
        except Exception as e:
            logger.error(f"Error fetching all annotations: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/similarity/update")
    async def update_similarity_object(
        collection_name: str,
        application_id: str,
        uuid: str,
        properties: dict
    ):
        """
        Update a similarity search object's properties.
        
        Args:
            collection_name (str): Name of the collection
            application_id (str): Application ID
            uuid (str): UUID of the object to update
            properties (dict): Dictionary of properties to update
            
        Returns:
            dict: Update result
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Extract just the dataset ID part
            clean_application_id = application_id.split('/')[-1] if '/' in application_id else application_id
            
            result = await similarity_service.update_object(
                collection_name=valid_collection_name,
                application_id=clean_application_id,
                object_uuid=uuid,
                properties=properties
            )
            
            logger.info(f"Updated similarity search object {uuid} in collection {valid_collection_name}")
            return {"success": True, "result": result}
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error updating similarity search object: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/similarity/list-applications")
    async def list_annotation_applications(
        collection_name: str,
        prefix: str = None,
        limit: int = 1000
    ):
        """
        List all annotation applications in a collection, optionally filtered by prefix.
        
        Args:
            collection_name (str): Name of the collection
            prefix (str): Optional prefix to filter application IDs
            limit (int): Maximum number of annotations to scan
            
        Returns:
            dict: List of annotation applications with counts
        """
        try:
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            # Always use the existing 'Agentlens' collection
            valid_collection_name = WEAVIATE_COLLECTION_NAME
            
            # Clean prefix - extract just the dataset ID part (last part after slash)
            clean_prefix = prefix.split('/')[-1] if prefix and '/' in prefix else prefix
            
            applications = await similarity_service.list_annotation_applications(
                collection_name=valid_collection_name,
                prefix=clean_prefix,
                limit=limit
            )
            
            return {"success": True, "applications": applications, "total": len(applications)}
            
        except Exception as e:
            logger.error(f"Error listing annotation applications: {e}")
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
            try:
                if not await similarity_service.ensure_connected():
                    raise HTTPException(status_code=503, detail="Similarity search service is not available")
            except Exception as e:
                logger.warning(f"Similarity service not available: {e}")
                raise HTTPException(status_code=503, detail="Similarity search service is not available")
            
            exists = await similarity_service.collection_exists(collection_name)
            return {"success": True, "exists": exists, "collection_name": collection_name}
            
        except Exception as e:
            logger.error(f"Error checking collection existence: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    async def serve_fastapi(args):
        await app(args["scope"], args["receive"], args["send"])

    return serve_fastapi


async def preload_clip_model():
    """
    Preload CLIP model during service startup to avoid delays during first use.
    This function loads both the CLIP model and the similarity service CLIP model.
    """
    logger.info("Preloading CLIP models for faster startup...")
    
    try:
        # Preload CLIP model for frontend service
        logger.info("Loading CLIP model for frontend service...")
        _load_clip_model()
        logger.info("✓ Frontend CLIP model loaded successfully")
        
        # Preload CLIP model for similarity service
        logger.info("Loading CLIP model for similarity service...")
        from agent_lens.utils.weaviate_search import _load_clip_model as load_similarity_clip
        load_similarity_clip()
        logger.info("✓ Similarity service CLIP model loaded successfully")
        
        logger.info("All CLIP models preloaded successfully - similarity search will be faster!")
        
    except Exception as e:
        logger.warning(f"Failed to preload CLIP models: {e}")
        logger.warning("CLIP will be loaded on first use (may cause delays)")

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
    
    # Preload CLIP models for faster startup (especially important in Docker)
    # Also preload in development if CLIP_PRELOAD environment variable is set
    should_preload = is_docker or os.getenv("CLIP_PRELOAD", "").lower() in ("true", "1", "yes")
    
    if should_preload:
        if is_docker:
            logger.info("Docker mode detected - preloading CLIP models...")
        else:
            logger.info("CLIP_PRELOAD environment variable set - preloading CLIP models...")
        await preload_clip_model()
    else:
        logger.info("CLIP models will be loaded on first use (set CLIP_PRELOAD=true to preload)")
    
    # Ensure artifact_manager_instance is connected
    if artifact_manager_instance.server is None:
        try:
            api_server, artifact_manager = await get_artifact_manager()
            await artifact_manager_instance.connect_server(api_server)
            logger.info("AgentLensArtifactManager connected successfully.")
        except Exception as e:
            logger.warning(f"Warning: Failed to connect AgentLensArtifactManager: {e}")
            logger.warning("Some endpoints may not function correctly.")
    
    # Define simple hypha-rpc service method for text embedding generation
    async def generate_text_embedding_rpc(text: str) -> dict:
        """
        Generate a CLIP text embedding via hypha-rpc.
        
        Args:
            text: Text input to generate embedding for
            
        Returns:
            dict: JSON object with embedding vector and metadata
        """
        try:
            if not text or not text.strip():
                raise ValueError("Text input cannot be empty")
            
            from agent_lens.utils.weaviate_search import generate_text_embedding
            embedding = await generate_text_embedding(text.strip())
            return {
                "model": "ViT-B/32",
                "embedding": embedding,
                "dimension": len(embedding),
                "text": text.strip()
            }
        except Exception as e:
            logger.error(f"Error generating text embedding via RPC: {e}")
            logger.error(traceback.format_exc())
            raise
    
    # Define simple hypha-rpc service method for batch image embedding generation
    async def generate_image_embeddings_batch_rpc(images_base64: List[str]) -> dict:
        """
        Generate CLIP image embeddings for multiple images in batch via hypha-rpc.
        
        This endpoint uses optimized batch processing with parallel I/O for significantly faster
        embedding generation, especially when using GPU acceleration.
        
        Args:
            images_base64: List of base64-encoded image data strings
            
        Returns:
            dict: JSON object with success flag, results array, and count
        """
        try:
            if not images_base64 or len(images_base64) == 0:
                raise ValueError("At least one image is required")
            
            # Decode all base64 image data
            image_bytes_list = []
            valid_indices = []
            
            for idx, image_base64 in enumerate(images_base64):
                try:
                    image_bytes = base64.b64decode(image_base64)
                    if image_bytes:
                        image_bytes_list.append(image_bytes)
                        valid_indices.append(idx)
                except Exception as e:
                    logger.warning(f"Failed to decode image at index {idx}: {e}")
            
            if not image_bytes_list:
                raise ValueError("No valid images found in request")
            
            from agent_lens.utils.weaviate_search import generate_image_embeddings_batch
            embeddings = await generate_image_embeddings_batch(image_bytes_list)
            
            # Map results back to original order
            results = [None] * len(images_base64)
            for valid_idx, embedding in zip(valid_indices, embeddings):
                if embedding is not None:
                    results[valid_idx] = {
                        "success": True,
                        "embedding": embedding,
                        "dimension": len(embedding),
                        "model": "ViT-B/32"
                    }
            
            return {
                "success": True,
                "results": results,
                "count": len(results)
            }
        except Exception as e:
            logger.error(f"Error generating batch image embeddings via RPC: {e}")
            logger.error(traceback.format_exc())
            raise
    
    # Register the service with both ASGI and RPC methods
    await server.register_service(
        {
            "id": server_id,
            "name": "Agent Lens",
            "type": "asgi",
            "serve": get_frontend_api(),
            "config": {"visibility": "public"},
            # Register RPC methods for embedding generation
            "generate_text_embedding": generate_text_embedding_rpc,
            "generate_image_embeddings_batch": generate_image_embeddings_batch_rpc,
        }
    )

    logger.info(f"Frontend service registered successfully with ID: {server_id}")

    # Store the cleanup function in the server's config
    # Note: No specific cleanup needed since artifact_manager_instance is global
 