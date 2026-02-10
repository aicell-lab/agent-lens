"""
This module provides functionality for registering a frontend service
that serves the frontend application.
"""

import os
from typing import List, Optional
from pathlib import Path
from fastapi import FastAPI
from fastapi import UploadFile, File, HTTPException, Form, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from agent_lens.utils.artifact_manager import AgentLensArtifactManager
from hypha_rpc import connect_to_server
from hypha_rpc.utils.schema import schema_function
from skimage.feature import graycomatrix, graycoprops

import numpy as np
import sys
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.cors import CORSMiddleware
import uuid
import traceback
import asyncio
import base64
# Import similarity search utilities
from agent_lens.utils.chroma_storage import chroma_storage
from PIL import Image as PILImage
from io import BytesIO
from typing import Dict, Any, Tuple, List
from skimage.feature import graycomatrix, graycoprops
from skimage.measure import regionprops

import math
import io
# Configure logging
from .log import setup_logging

logger = setup_logging("agent_lens_frontend_service.log")

DEFAULT_CHANNEL = "BF_LED_matrix_full"

# Create a global AgentLensArtifactManager instance
artifact_manager_instance = AgentLensArtifactManager()

# Global state for current active application (for similarity search)
current_application_id = None

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.getenv("WORKSPACE_TOKEN")

# OME-Zarr dataset path for streaming
ZARR_DATASET_PATH = "/mnt/shared_documents/20251215-illumination-calibrated/data.zarr"

async def get_artifact_manager():
    """Get a new connection to the artifact manager."""
    api = await connect_to_server(
        {"client_id": f"test-client-{uuid.uuid4()}", "server_url": SERVER_URL, "token": WORKSPACE_TOKEN}
    )
    artifact_manager = await api.get_service("public/artifact-manager")
    return api, artifact_manager

def validate_zarr_path(file_path: str) -> Path:
    """
    Validate and resolve a file path within the zarr dataset directory.
    
    Args:
        file_path: Relative path within the zarr dataset
        
    Returns:
        Path: Resolved absolute path to the file
        
    Raises:
        HTTPException: If path is invalid or outside zarr directory
    """
    # Resolve the base zarr directory
    zarr_base = Path(ZARR_DATASET_PATH).resolve()
    
    # Normalize the requested file path (remove leading slashes, handle ..)
    normalized_path = file_path.lstrip('/')
    if not normalized_path:
        # Root path - serve .zgroup if it exists
        normalized_path = ".zgroup"
    
    # Resolve the full path
    requested_path = (zarr_base / normalized_path).resolve()
    
    # Security check: ensure the resolved path is within the zarr directory
    try:
        requested_path.relative_to(zarr_base)
    except ValueError:
        # Path is outside the zarr directory - security violation
        raise HTTPException(
            status_code=403,
            detail=f"Access denied: Path outside zarr dataset directory"
        )
    
    return requested_path

def get_frontend_api():
    """
    Create the FastAPI application for serving the frontend.

    Returns:
        function: The FastAPI application.
    """
    app = FastAPI()
    
    # Add CORS middleware to allow cross-origin requests (e.g., from vizarr)
    # This must be added before other middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins
        allow_credentials=False,  # Set to False when using allow_origins=["*"]
        allow_methods=["GET", "OPTIONS"],  # Allow GET and OPTIONS for CORS preflight
        allow_headers=["Range"],  # Allow Range header for HTTP Range requests
        expose_headers=["Content-Length", "Content-Range"],  # Expose headers needed by zarr clients
    )
    
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
        """Generate both CLIP and DINOv2 image embeddings from an uploaded image.
        
        Returns both embeddings:
        - CLIP (512D) for image-text similarity
        - DINOv2 (768D) for image-image similarity

        Returns a JSON object with both embedding arrays.
        """
        try:
            if not image.content_type or not image.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Uploaded file must be an image")
            image_bytes = await image.read()
            if not image_bytes:
                raise HTTPException(status_code=400, detail="Empty image upload")
            from agent_lens.utils.embedding_generator import generate_image_embedding
            embeddings = await generate_image_embedding(image_bytes)
            return {
                "clip_embedding": embeddings["clip_embedding"],
                "clip_dimension": len(embeddings["clip_embedding"]),
                "dino_embedding": embeddings["dino_embedding"],
                "dino_dimension": len(embeddings["dino_embedding"])
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error generating image embedding: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/embedding/image-batch")
    async def generate_image_embedding_batch(images: List[UploadFile] = File(...)):
        """Generate both CLIP and DINOv2 image embeddings from multiple uploaded images in batch.
        
        This endpoint uses optimized batch processing with parallel I/O for significantly faster
        embedding generation, especially when using GPU acceleration.
        
        Returns both embeddings for each image:
        - CLIP (512D) for image-text similarity
        - DINOv2 (768D) for image-image similarity

        Args:
            images: List of image files to process

        Returns:
            dict: JSON object with success flag, results array, and count
                {
                    "success": True,
                    "results": [
                        {
                            "success": True,
                            "clip_embedding": [...],
                            "clip_dimension": 512,
                            "dino_embedding": [...],
                            "dino_dimension": 768
                        },
                        None,  # if failed
                        {...}
                    ],
                    "count": 3
                }
        """
        try:
            if not images or len(images) == 0:
                raise HTTPException(status_code=400, detail="At least one image is required")
            
            from agent_lens.utils.embedding_generator import generate_image_embeddings_batch
            
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
            for valid_idx, embedding_dict in zip(valid_indices, embeddings):
                if embedding_dict is not None:
                    results[valid_idx] = {
                        "success": True,
                        "clip_embedding": embedding_dict["clip_embedding"],
                        "clip_dimension": len(embedding_dict["clip_embedding"]) if embedding_dict["clip_embedding"] else 0,
                        "dino_embedding": embedding_dict["dino_embedding"],
                        "dino_dimension": len(embedding_dict["dino_embedding"]) if embedding_dict["dino_embedding"] else 0
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
            
            from agent_lens.utils.embedding_generator import generate_text_embedding
            embedding = await generate_text_embedding(text.strip())
            return {
                "success": True,
                "clip_embedding": embedding, 
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

    @app.get("/example-image-data.zarr")
    @app.options("/example-image-data.zarr")
    async def stream_zarr_root(request: Request):
        """
        Handle root zarr endpoint - serves .zgroup file.
        """
        return await stream_zarr_file(".zgroup", request)
    
    @app.get("/example-image-data.zarr/{file_path:path}")
    @app.options("/example-image-data.zarr/{file_path:path}")
    async def stream_zarr_file(file_path: str, request: Request):
        """
        Stream OME-Zarr dataset files from local filesystem.
        
        This endpoint serves zarr metadata files (.zgroup, .zarray, .zattrs) and chunk files
        with HTTP Range request support and CORS headers for compatibility with vizarr
        and other zarr viewers.
        
        Args:
            file_path: Relative path within the zarr dataset (e.g., ".zgroup", "0/.zarray", "0/0/0/0/0")
            request: FastAPI request object for handling OPTIONS and Range requests
            
        Returns:
            FileResponse: File content with appropriate headers
        """
        # Handle OPTIONS request for CORS preflight
        if request.method == "OPTIONS":
            return Response(
                status_code=200,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Range",
                    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
                }
            )
        
        try:
            # Validate and resolve the file path
            resolved_path = validate_zarr_path(file_path)
            
            # Check if file exists
            if not resolved_path.exists():
                raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
            
            # Determine content type based on file extension
            content_type = "application/octet-stream"  # Default for chunk files
            if resolved_path.suffix in [".zgroup", ".zarray", ".zattrs"]:
                content_type = "application/json"
            
            # Create FileResponse with Range request support
            # FastAPI's FileResponse automatically handles HTTP Range requests
            response = FileResponse(
                path=str(resolved_path),
                media_type=content_type,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Range",
                    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
                }
            )
            
            logger.debug(f"Serving zarr file: {file_path} (content-type: {content_type})")
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error streaming zarr file {file_path}: {e}")
            logger.error(traceback.format_exc())
            raise HTTPException(status_code=500, detail=str(e))

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
        collection_name: str = WEAVIATE_COLLECTION_NAME,
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
    async def check_collection_exists(collection_name: str = WEAVIATE_COLLECTION_NAME):
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


async def preload_embedding_models():
    """
    Preload embedding models during service startup to avoid delays during first use.
    Uses the shared embedding models from weaviate_search.py.
    """
    logger.info("Preloading embedding models for faster startup...")
    
    try:
        # Preload CLIP model (shared with similarity service)
        logger.info("Loading CLIP model...")
        from agent_lens.utils.embedding_generator import _load_clip_model
        _load_clip_model()
        # Preload DINOv2 model (shared with similarity service)
        logger.info("Loading DINOv2 model...")
        from agent_lens.utils.embedding_generator import _load_dinov2_model
        _load_dinov2_model()
        logger.info("✓ Embedding models loaded successfully - similarity search will be faster!")
        
    except Exception as e:
        logger.warning(f"Failed to preload embedding models: {e}")
        logger.warning("Embedding models will be loaded on first use (may cause delays)")

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
    
    # Preload embedding models for faster startup
    logger.info("Preloading embedding models...")
    await preload_embedding_models()
    
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
    @schema_function()
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
            
            from agent_lens.utils.embedding_generator import generate_text_embedding
            embedding = await generate_text_embedding(text.strip())
            return {
                "success": True,
                "clip_embedding": embedding,
                "dimension": len(embedding),
                "text": text.strip()
            }
        except Exception as e:
            logger.error(f"Error generating text embedding via RPC: {e}")
            logger.error(traceback.format_exc())
            raise
    
    # Define simple hypha-rpc service method for batch image embedding generation
    @schema_function()
    async def generate_image_embeddings_batch_rpc(images_base64: List[str]) -> dict:
        """
        Generate both CLIP and DINOv2 image embeddings for multiple images in batch via hypha-rpc.
        Returns json object with success flag, results array, and count.
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
            
            from agent_lens.utils.embedding_generator import generate_image_embeddings_batch
            embeddings = await generate_image_embeddings_batch(image_bytes_list)
            
            # Map results back to original order
            results = [None] * len(images_base64)
            for valid_idx, embedding_dict in zip(valid_indices, embeddings):
                if embedding_dict is not None:
                    results[valid_idx] = {
                        "success": True,
                        "clip_embedding": embedding_dict["clip_embedding"],
                        "clip_dimension": len(embedding_dict["clip_embedding"]) if embedding_dict["clip_embedding"] else 0,
                        "dino_embedding": embedding_dict["dino_embedding"],
                        "dino_dimension": len(embedding_dict["dino_embedding"]) if embedding_dict["dino_embedding"] else 0
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
    
        
    # Helper function to process a single cell (runs in parallel threads)
    fixed_channel_order = ['BF_LED_matrix_full', 'Fluorescence_405_nm_Ex', 'Fluorescence_488_nm_Ex', 'Fluorescence_638_nm_Ex', 'Fluorescence_561_nm_Ex', 'Fluorescence_730_nm_Ex']

    # Standard microscopy channel colors (matching frontend CHANNEL_COLORS)
    CHANNEL_COLOR_MAP = {
        'BF_LED_matrix_full': (255, 255, 255),      # White
        'Fluorescence_405_nm_Ex': (0, 0, 255),      # Blue (DAPI)
        'Fluorescence_488_nm_Ex': (0, 255, 0),      # Green (FITC/GFP)
        'Fluorescence_561_nm_Ex': (255, 0, 0),      # Red (TRITC/mCherry)
        'Fluorescence_638_nm_Ex': (255, 0, 255),    # Magenta (Cy5)
        'Fluorescence_730_nm_Ex': (0, 255, 255),    # Cyan (far-red/NIR)
    }

    def resize_and_pad_to_square_rgb(cell_rgb_u8: np.ndarray, out_size: int, pad_value: int) -> np.ndarray:
        """
        Resize and pad cell image to a square for consistent embedding.
        
        This ensures all cells have the same input size (224x224 for CLIP or DINOv2),
        preventing the embedding generator from doing variable cropping that can change
        the embedding based on the original crop's aspect ratio.
        
        Args:
            cell_rgb_u8: (H,W,3) uint8 RGB image
            out_size: Target square size (e.g., 224 for CLIP or DINOv2)
            pad_value: Padding value 0..255 (typically background brightness)
            
        Returns:
            (out_size, out_size, 3) uint8 RGB image
        """
        assert cell_rgb_u8.dtype == np.uint8 and cell_rgb_u8.ndim == 3 and cell_rgb_u8.shape[2] == 3

        pil = PILImage.fromarray(cell_rgb_u8, mode="RGB")
        w, h = pil.size

        # Scale so the whole crop fits inside out_size
        scale = out_size / max(w, h)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))

        pil = pil.resize((new_w, new_h), PILImage.Resampling.LANCZOS)

        canvas = PILImage.new("RGB", (out_size, out_size), color=(pad_value, pad_value, pad_value))
        canvas.paste(pil, ((out_size - new_w)//2, (out_size - new_h)//2))

        return np.array(canvas, dtype=np.uint8)

    def _apply_channel_color_and_mask_brightfield(
        channel_region: np.ndarray,
        cell_mask_region: np.ndarray,
        channel_color: Tuple[int, int, int],
        bg_value: float = 0.0
    ) -> np.ndarray:
        """
        Apply channel-specific color tinting and cell mask for BRIGHTFIELD channel.
        For brightfield: cells keep original intensity, non-cell areas filled with bg_value.
        
        Args:
            channel_region: 2D grayscale brightfield data
            cell_mask_region: 2D binary mask for the cell
            channel_color: RGB tuple (0-255) for channel color
            bg_value: Background value to fill non-cell areas
        
        Returns:
            RGB uint8 array with color-tinted, masked brightfield data
        """
        # Convert to uint8 if needed (no background subtraction for brightfield)
        if channel_region.dtype == np.uint16:
            channel_region = (channel_region / 256).astype(np.uint8)
        else:
            channel_region = channel_region.astype(np.uint8)
        
        # Apply color tinting (multiply grayscale by channel RGB color)
        channel_rgb = np.zeros((*channel_region.shape, 3), dtype=np.float32)
        channel_rgb[:, :, 0] = channel_region * (channel_color[0] / 255.0)
        channel_rgb[:, :, 1] = channel_region * (channel_color[1] / 255.0)
        channel_rgb[:, :, 2] = channel_region * (channel_color[2] / 255.0)
        
        # Create background RGB (fill value for non-cell areas)
        bg_rgb = np.array([bg_value * (channel_color[0] / 255.0),
                           bg_value * (channel_color[1] / 255.0),
                           bg_value * (channel_color[2] / 255.0)], dtype=np.float32)
        
        # Apply cell mask: cell pixels keep their value, non-cell pixels get bg_value
        cell_mask_3d = np.expand_dims(cell_mask_region.astype(bool), axis=2)
        channel_rgb = np.where(cell_mask_3d, channel_rgb, bg_rgb)
        
        return channel_rgb.astype(np.uint8)
    
    def _apply_channel_color_and_mask(
        channel_region: np.ndarray,
        cell_mask_region: np.ndarray,
        channel_color: Tuple[int, int, int],
        bg_value: float = 0.0
    ) -> np.ndarray:
        """
        Apply channel-specific color tinting and cell mask to a single channel.
        Returns RGB uint8 array with background-subtracted, color-tinted channel data.
        
        Args:
            channel_region: 2D grayscale channel data
            cell_mask_region: 2D binary mask for the cell
            channel_color: RGB tuple (0-255) for channel color
            bg_value: Background value to subtract
        
        Returns:
            RGB uint8 array with color-tinted, masked channel data
        """
        # Background subtraction
        if channel_region.dtype == np.uint16:
            channel_region = np.maximum(channel_region.astype(np.float32) - bg_value, 0.0)
            channel_region = (channel_region / 256).astype(np.uint8)
        else:
            channel_region = np.maximum(channel_region.astype(np.float32) - bg_value, 0.0)
            channel_region = channel_region.astype(np.uint8)
        
        # Apply color tinting (multiply grayscale by channel RGB color)
        channel_rgb = np.zeros((*channel_region.shape, 3), dtype=np.float32)
        channel_rgb[:, :, 0] = channel_region * (channel_color[0] / 255.0)
        channel_rgb[:, :, 1] = channel_region * (channel_color[1] / 255.0)
        channel_rgb[:, :, 2] = channel_region * (channel_color[2] / 255.0)
        
        # Apply cell mask (set non-cell pixels to black)
        cell_mask_3d = np.expand_dims(cell_mask_region.astype(bool), axis=2)
        channel_rgb = np.where(cell_mask_3d, channel_rgb, 0.0)
        
        return channel_rgb.astype(np.uint8)

    def _process_single_cell(
        prop: Any,  # RegionProperties object from skimage.measure.regionprops
        poly_index: int,
        image_data_np: np.ndarray,
        mask: np.ndarray,
        brightfield: np.ndarray,
        fixed_channel_order: List[str],
        background_bright_value: float,
        background_fluorescence: Dict[int, float],
        position_info: Optional[Dict[str, Any]] = None,
    ) -> Tuple[int, Optional[Dict[str, Any]], Optional[str]]:
        """
        Process a single cell to extract metadata and generate cell image.
        This function is designed to be run in parallel threads.
        
        """
        # Get mask label from the property object
        mask_label = prop.label
        if mask_label is None:
            return (poly_index, None, None)
        
        try:
            # Initialize metadata dict (cell identity is given by list order/index)
            metadata = {}
            
            # Use prop directly without creating binary mask or calling regionprops again
            # Create binary mask for this cell (only needed for image cropping)
            cell_mask = (mask == mask_label).astype(np.uint8)
            
            if prop.area == 0:
                # Cell not found in mask, skip
                return (poly_index, None, None)
            
            # Extract bounding box and expand it by a fixed factor (e.g., 1.3x) centered on the cell
            min_row, min_col, max_row, max_col = prop.bbox

            H, W = image_data_np.shape[:2]
            scale = 1.3  # expansion factor for bounding box (consistent for every cell)

            # Center of bbox (in pixels)
            cy = (min_row + max_row) / 2.0
            cx = (min_col + max_col) / 2.0

            # Calculate absolute position if position_info is available
            if position_info is not None:
                # Get image dimensions
                image_height, image_width = image_data_np.shape[:2]
                
                # Calculate image center in pixels
                image_center_x_px = image_width / 2.0
                image_center_y_px = image_height / 2.0
                
                # Calculate cell offset from image center (in pixels)
                # X-axis: positive direction is left to right
                # Y-axis: positive direction is top to bottom
                offset_x_px = cx - image_center_x_px
                offset_y_px = cy - image_center_y_px
                
                # Convert pixel offset to mm
                pixel_size = position_info['pixel_size_xy']/1000.0 # um to mm
                offset_x_mm = offset_x_px * pixel_size
                offset_y_mm = offset_y_px * pixel_size
                
                # Calculate absolute cell position (mm)
                cell_x_mm = position_info['current_x'] + offset_x_mm
                cell_y_mm = position_info['current_y'] + offset_y_mm
                
                # Calculate cell distance from well center using actual well center coordinates
                if position_info['well_center_x'] is not None and position_info['well_center_y'] is not None:
                    # Calculate exact Euclidean distance from cell to well center
                    dx = cell_x_mm - position_info['well_center_x']
                    dy = cell_y_mm - position_info['well_center_y']
                    cell_distance_from_well = np.sqrt(dx**2 + dy**2)
                else:
                    cell_distance_from_well = None
                
                # Add position metadata
                metadata['position'] = {
                    'x': float(cell_x_mm),
                    'y': float(cell_y_mm)
                }
                metadata['distance_from_center'] = float(cell_distance_from_well) if cell_distance_from_well is not None else None
                metadata['well_id'] = position_info['well_id']
            else:
                # No position info available
                metadata['position'] = None
                metadata['distance_from_center'] = None
                metadata['well_id'] = None

            # Original height/width
            bbox_h = max_row - min_row
            bbox_w = max_col - min_col

            # Expanded dimensions
            new_h = int(np.round(bbox_h * scale))
            new_w = int(np.round(bbox_w * scale))

            # Calculate new coordinates, keep within image bounds
            y_min = int(np.clip(cy - new_h / 2.0, 0, H))
            y_max = int(np.clip(cy + new_h / 2.0, 0, H))
            x_min = int(np.clip(cx - new_w / 2.0, 0, W))
            x_max = int(np.clip(cx + new_w / 2.0, 0, W))

            # Crop masks to same region
            cell_mask_region = cell_mask[y_min:y_max, x_min:x_max]  # Target cell mask
            mask_region = mask[y_min:y_max, x_min:x_max]  # Full mask with all cell IDs
            
            # Extract and merge all available channels with proper colors
            channels_to_merge = []

            # Process brightfield (channel 0)
            if image_data_np.ndim == 3:
                bf_region = image_data_np[y_min:y_max, x_min:x_max, 0].copy()
            else:
                bf_region = image_data_np[y_min:y_max, x_min:x_max].copy()

            # Apply percentile normalization to brightfield (1-99%)
            if bf_region.size > 0:
                p_low = np.percentile(bf_region, 1.0)
                p_high = np.percentile(bf_region, 99.0)
                bf_region = np.clip(bf_region, p_low, p_high)
                if p_high > p_low:
                    bf_region = ((bf_region - p_low) / (p_high - p_low) * 255.0).astype(np.uint8)
                else:
                    bf_region = np.full_like(bf_region, 128, dtype=np.uint8)
            else:
                bf_region = bf_region.astype(np.uint8)
                
            # Get brightfield color and apply mask
            # NOTE: Brightfield uses special processing - cells keep original intensity,
            # non-cell areas filled with background_bright_value (not black)
            bf_color = CHANNEL_COLOR_MAP.get('BF_LED_matrix_full', (255, 255, 255))
            bf_rgb = _apply_channel_color_and_mask_brightfield(
                bf_region, 
                cell_mask_region, 
                bf_color, 
                bg_value=background_bright_value
            )
            channels_to_merge.append(bf_rgb.astype(np.float32))

            # Process fluorescent channels (1-5) if available
            if image_data_np.ndim == 3 and image_data_np.shape[2] > 1:
                for channel_idx in range(1, min(6, image_data_np.shape[2])):
                    channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                    
                    # Only process channels with signal
                    channel_data = image_data_np[:, :, channel_idx]
                    if channel_data.max() == 0:
                        continue
                    
                    # Extract channel region
                    channel_region = channel_data[y_min:y_max, x_min:x_max].copy()
                    
                    # Get channel color
                    channel_color = CHANNEL_COLOR_MAP.get(channel_name, (255, 255, 255))
                    
                    # Get background value
                    bg_value = background_fluorescence.get(channel_idx, 0.0)
                    
                    # Apply color and mask
                    channel_rgb = _apply_channel_color_and_mask(
                        channel_region,
                        cell_mask_region,
                        channel_color,
                        bg_value=bg_value
                    )
                    
                    channels_to_merge.append(channel_rgb.astype(np.float32))

            # Merge channels using additive blending
            if len(channels_to_merge) > 1:
                merged_rgb = np.clip(np.sum(channels_to_merge, axis=0), 0, 255).astype(np.uint8)
            else:
                merged_rgb = channels_to_merge[0].astype(np.uint8)

            # Resize and pad merged image to 224x224 (use black padding for multi-channel)
            merged_rgb = resize_and_pad_to_square_rgb(merged_rgb, out_size=224, pad_value=background_bright_value)

            # Convert to PIL Image and encode as base64 PNG
            cell_pil = PILImage.fromarray(merged_rgb, mode='RGB')
            buffer = BytesIO()
            cell_pil.save(buffer, format='PNG')
            cell_image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
            
            # Morphological features
            try:
                metadata["area"] = float(prop.area)
            except:
                metadata["area"] = None
            
            try:
                metadata["perimeter"] = float(prop.perimeter)
            except:
                metadata["perimeter"] = None
            
            try:
                metadata["equivalent_diameter"] = float(prop.equivalent_diameter)
            except:
                metadata["equivalent_diameter"] = None
            
            try:
                metadata["bbox_width"] = float(max_col - min_col)
                metadata["bbox_height"] = float(max_row - min_row)
            except:
                metadata["bbox_width"] = None
                metadata["bbox_height"] = None
            
            try:
                if prop.minor_axis_length > 0:
                    metadata["aspect_ratio"] = float(prop.major_axis_length / prop.minor_axis_length)
                else:
                    metadata["aspect_ratio"] = None
            except:
                metadata["aspect_ratio"] = None
            
            try:
                if metadata["perimeter"] is not None and metadata["perimeter"] > 0 and metadata["area"] is not None:
                    metadata["circularity"] = float(4 * math.pi * metadata["area"] / (metadata["perimeter"] ** 2))
                else:
                    metadata["circularity"] = None
            except:
                metadata["circularity"] = None
            
            try:
                metadata["eccentricity"] = float(prop.eccentricity)
            except:
                metadata["eccentricity"] = None
            
            try:
                metadata["solidity"] = float(prop.solidity)
            except:
                metadata["solidity"] = None
            
            try:
                if metadata["perimeter"] is not None and metadata["perimeter"] > 0:
                    convex_perimeter = float(prop.perimeter_crofton)
                    metadata["convexity"] = float(convex_perimeter / metadata["perimeter"])
                else:
                    metadata["convexity"] = None
            except:
                metadata["convexity"] = None
            
            # Intensity/texture features
            try:
                # Convert to grayscale if needed
                if brightfield.ndim == 3:
                    if brightfield.shape[2] == 3:
                        gray = 0.299 * brightfield[:, :, 0] + 0.587 * brightfield[:, :, 1] + 0.114 * brightfield[:, :, 2]
                    else:
                        gray = brightfield[:, :, 0]
                else:
                    gray = brightfield.copy()
                
                # Extract cell pixels
                cell_pixels = gray[cell_mask > 0]
                
                if len(cell_pixels) == 0:
                    # Mean fluorescence intensity for each channel (set to None when no pixels)
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                metadata[field_name] = None
                                # Also set top20_mean to None
                                top10_field_name = f"top10_mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                metadata[top10_field_name] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                else:
                    
                    # Mean fluorescence intensity for each channel
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                channel_data = image_data_np[:, :, channel_idx]
                                channel_pixels = channel_data[cell_mask > 0]
                                
                                if len(channel_pixels) > 0 and channel_data.max() > 0:
                                    # Get background value for this channel
                                    bg_value = background_fluorescence.get(channel_idx, 0.0)
                                    
                                    # Subtract background and clip to zero
                                    channel_pixels_corrected = np.maximum(channel_pixels - bg_value, 0.0)
                                    
                                    # Create sanitized field name (remove spaces, special chars)
                                    field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                    metadata[field_name] = float(np.mean(channel_pixels_corrected))
                                    
                                    # Top 10% brightest pixels mean (approximates nuclear intensity)
                                    # Apply background subtraction before sorting
                                    if len(channel_pixels_corrected) > 0:
                                        # Calculate how many pixels represent top 10%
                                        top_10_percent_count = max(1, int(np.ceil(len(channel_pixels_corrected) * 0.1)))
                                        # Sort and take top 10% brightest pixels
                                        sorted_pixels = np.sort(channel_pixels_corrected)
                                        top_10_pixels = sorted_pixels[-top_10_percent_count:]
                                        top10_mean = float(np.mean(top_10_pixels))
                                        
                                        # Store as top10_mean_intensity_{channel_name}
                                        top10_field_name = f"top10_mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                        metadata[top10_field_name] = top10_mean
                                    else:
                                        top10_field_name = f"top10_mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                        metadata[top10_field_name] = None
                                else:
                                    field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                    metadata[field_name] = None
                                    # Also set top10_mean to None
                                    top10_field_name = f"top10_mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                    metadata[top10_field_name] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                    

            except:
                
                # Mean fluorescence intensity for each channel (set to None on error)
                try:
                    if image_data_np.ndim == 3:
                        for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                            channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                            field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                            metadata[field_name] = None
                            # Also set top10_mean to None on error
                            top10_field_name = f"top10_mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                            metadata[top10_field_name] = None
                except Exception as e:
                    # If fluorescence calculation fails, continue without it
                    pass
            
            # Add merged multi-channel image to metadata (will add embeddings after batch processing)
            metadata["image"] = cell_image_base64
            
            return (poly_index, metadata, cell_image_base64)
            
        except Exception as e:
            # Skip this cell if processing fails
            print(f"Error processing cell at index {poly_index}: {e}")
            return (poly_index, None, None)


    # extract cell metadata
    async def build_cell_records(
        image_data_np: np.ndarray, 
        segmentation_mask: np.ndarray,
        microscope_status: Optional[Dict[str, Any]] = None,
        application_id: str = 'hypha-agents-notebook',
    ) -> List[Dict[str, Any]]:
        """
        Extract cell metadata, crops, and embeddings from segmentation results.
        Automatically stores images and DINO embeddings to Weaviate for memory efficiency.
        
        Args:
            image_data_np: Multi-channel microscopy image (H, W, C) or single-channel (H, W)
            segmentation_mask: Integer mask where each unique non-zero value represents a cell
            microscope_status: Optional microscope position info for spatial metadata
            application_id: Application identifier for Weaviate storage (default: 'hypha-agents-notebook')
        
        Returns:
            List of metadata dictionaries, one per cell, with the following fields:
            
            Geometry & Shape (in memory + Weaviate):
            - area: area of the cell in pixels
            - perimeter: perimeter of the cell in pixels
            - equivalent_diameter: equivalent diameter of the cell in pixels
            - bbox_width: width of the bounding box in pixels
            - bbox_height: height of the bounding box in pixels
            - aspect_ratio: aspect ratio of the cell
            - circularity: circularity of the cell
            - eccentricity: eccentricity of the cell
            - solidity: solidity of the cell
            - convexity: convexity of the cell
            
            Intensity Features (in memory only):
            - mean_intensity_<channel_name>: mean intensity of the cell for the given channel
            - top10_mean_intensity_<channel_name>: mean intensity of the top 10% brightest pixels
            
            Spatial Position (in memory only, if microscope_status provided):
            - position: {"x": float, "y": float} - absolute cell position in mm
            - well_id: well identifier (e.g., "A1", "B2")
            - distance_from_center: distance from the center of the well in mm
            
            Weaviate Storage (stored in Weaviate, UUID returned):
            - uuid: Weaviate object UUID for retrieving images/embeddings later
            - Images (base64 PNG) stored in Weaviate, NOT in returned records
            - DINO embeddings stored in Weaviate, NOT in returned records
            
        Note: This function stores images and embeddings to ChromaDB automatically,
              reducing memory usage by ~250x. Use fetch_cell_images()
              to retrieve images when needed for visualization.
        """

        import concurrent.futures
        import os
        from skimage.measure import label, regionprops, find_contours, approximate_polygon
        
        # Ensure mask is numpy array and convert to labeled format if needed
        if isinstance(segmentation_mask, str):
            mask_bytes = base64.b64decode(segmentation_mask)
            mask_img = PILImage.open(io.BytesIO(mask_bytes))
            mask = np.array(mask_img).astype(np.uint32)
        else:
            mask = segmentation_mask.astype(np.uint32)
        
        # Extract region properties once from labeled mask
        # This directly processes the instance mask where each object has a unique ID
        props = regionprops(mask)
        
        # Early return if no cells to process
        if len(props) == 0:
            print("No cells found in segmentation mask - returning empty list")
            return []
        
        # Simple cell list with just IDs (no polygon extraction)
        # Polygon extraction removed since contours are not used in metadata
        cell_polygons = [{"id": int(prop.label)} for prop in props]
        
        print(f"Extracting metadata for {len(cell_polygons)} cells from segmentation mask...")
        
        # Extract brightfield channel
        brightfield = image_data_np[:, :, 0] if image_data_np.ndim == 3 else image_data_np
        
        # Extract position information if microscope_status is provided
        position_info = None
        if microscope_status is not None:
            # Extract well center coordinates from nested structure: current_well_location -> well_center_coordinates
            current_well_location = microscope_status.get('current_well_location', {})
            well_center_coords = current_well_location.get('well_center_coordinates', {}) if isinstance(current_well_location, dict) else {}
            
            # Extract well_id from current_well_location
            well_id = current_well_location.get('well_id') if isinstance(current_well_location, dict) else None
            
            position_info = {
                'current_x': microscope_status.get('current_x'),  # Image center X (mm)
                'current_y': microscope_status.get('current_y'),  # Image center Y (mm)
                'pixel_size_xy': microscope_status.get('pixel_size_xy'),  # Pixel size (um)
                'well_center_x': well_center_coords.get('x_mm') if isinstance(well_center_coords, dict) else None,  # Well center X (mm)
                'well_center_y': well_center_coords.get('y_mm') if isinstance(well_center_coords, dict) else None,  # Well center Y (mm)
                'well_id': well_id,  # Well identifier (e.g., "A1", "B2")
            }
            # Validate that all required fields are present
            if None in [position_info['current_x'], position_info['current_y'], position_info['pixel_size_xy']]:
                position_info = None  # Incomplete data, disable position calculation
        
        # Vectorized background computation
        # Compute background mask once and reuse for all channels
        background_mask = (mask == 0)
        non_cell_pixels = brightfield[background_mask]
        
        if non_cell_pixels.size == 0:
            raise ValueError("No non-cell pixels found (mask==0). Cannot compute background median.")
        background_bright_value = int(np.median(non_cell_pixels))
        
        # Compute background values for fluorescent channels (channels 1-5)
        # Only process channels that actually have signal in image_data_np
        background_fluorescence = {}
        if image_data_np.ndim == 3:
            num_channels = image_data_np.shape[2]
            for channel_idx in range(1, min(6, num_channels)):  # Skip channel 0 (brightfield)
                channel_data = image_data_np[:, :, channel_idx]
                
                # Only compute background if channel has signal (max > 0)
                if channel_data.max() > 0:
                    # Reuse background_mask instead of creating new mask
                    non_cell_pixels_channel = channel_data[background_mask]
                    if non_cell_pixels_channel.size > 0:
                        background_fluorescence[channel_idx] = float(np.median(non_cell_pixels_channel))
                    else:
                        # No non-cell pixels available, use 0 as fallback
                        background_fluorescence[channel_idx] = 0.0
                else:
                    # Channel has no signal, skip background computation
                    background_fluorescence[channel_idx] = 0.0
        
        # Set max_workers for parallel processing (use all available CPUs)
        max_workers = min(len(cell_polygons), os.cpu_count() or 4)
        
        # Pass regionprops directly to avoid recomputation
        # Step 1: Process cells in parallel using ThreadPoolExecutor
        # Prepare arguments for parallel processing
        process_args = [
            (prop, idx, image_data_np, mask, brightfield, fixed_channel_order, background_bright_value, background_fluorescence, position_info)
            for idx, prop in enumerate(props)
        ]
        
        # Process cells in parallel
        results_with_indices = []
        cell_images_base64 = []
        cell_indices = []
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            # Submit all tasks and convert to asyncio futures to avoid blocking the event loop
            async_futures = []
            future_to_index = {}
            
            for args in process_args:
                thread_future = executor.submit(_process_single_cell, *args)
                # Convert concurrent.futures.Future to asyncio.Future to avoid blocking
                asyncio_future = asyncio.wrap_future(thread_future)
                async_futures.append(asyncio_future)
                future_to_index[asyncio_future] = args[1]
            
            # Collect results as they complete (non-blocking with asyncio)
            for asyncio_future in asyncio.as_completed(async_futures):
                try:
                    poly_index, metadata, cell_image_base64 = await asyncio_future
                    if metadata is not None:
                        results_with_indices.append((poly_index, metadata))
                        if cell_image_base64 is not None:
                            cell_images_base64.append(cell_image_base64)
                            cell_indices.append(len(results_with_indices) - 1)
                except Exception as e:
                    original_index = future_to_index.get(asyncio_future, "unknown")
                    print(f"Error processing cell at index {original_index}: {e}")
        
        # Sort results by original polygon index to maintain order
        results_with_indices.sort(key=lambda x: x[0])
        results = [metadata for _, metadata in results_with_indices]
        
        # Step 2: Generate embeddings in batch via RPC service
        if len(cell_images_base64) > 0:
            try:
                print(f"Generating embeddings for {len(cell_images_base64)} cell images...")
                embedding_result = await generate_image_embeddings_batch_rpc(
                    cell_images_base64
                )
                
                if embedding_result and embedding_result.get("success"):
                    embeddings = embedding_result.get("results", [])
                    
                    # Step 3: Map embeddings back to results
                    # embeddings[idx] corresponds to cell_images_base64[idx]
                    # cell_indices[idx] tells us which result index that image belongs to
                    if len(embeddings) != len(cell_indices):
                        print(f"Warning: Mismatch between embeddings count ({len(embeddings)}) and cell_indices count ({len(cell_indices)})")
                    
                    for idx, embedding_data in enumerate(embeddings):
                        if idx >= len(cell_indices):
                            print(f"Warning: Embedding index {idx} out of range for cell_indices (len={len(cell_indices)})")
                            continue
                        
                        result_idx = cell_indices[idx]
                        if result_idx >= len(results):
                            print(f"Warning: Result index {result_idx} out of range for results (len={len(results)})")
                            continue
                        
                        # Handle None embeddings (failed decoding or processing)
                        if embedding_data is None:
                            results[result_idx]["clip_embedding"] = None
                            results[result_idx]["dino_embedding"] = None
                            continue
                        
                        # Handle successful embeddings
                        if embedding_data.get("success"):
                            results[result_idx]["clip_embedding"] = embedding_data.get("clip_embedding", None)
                            results[result_idx]["dino_embedding"] = embedding_data.get("dino_embedding", None)
                        else:
                            # Embedding generation failed for this image
                            results[result_idx]["clip_embedding"] = None
                            results[result_idx]["dino_embedding"] = None
                else:
                    print(f"Warning: Embedding generation failed or returned no results")
                    # Set all embeddings to None
                    for result in results:
                        if "clip_embedding" not in result:
                            result["clip_embedding"] = None
                        if "dino_embedding" not in result:
                            result["dino_embedding"] = None
            except Exception as e:
                print(f"Error generating embeddings: {e}")
                # Set all embeddings to None on error
                for result in results:
                    if "clip_embedding" not in result:
                        result["clip_embedding"] = None
                    if "dino_embedding" not in result:
                        result["dino_embedding"] = None
        else:
            # No images to process
            for result in results:
                result["clip_embedding"] = None
                result["dino_embedding"] = None
        

        try:
            print(f"Storing {len(results)} cells to ChromaDB (application: {application_id})...")
            
            # Prepare cells for batch insertion
            cells_to_insert = []
            for idx, cell in enumerate(results):
                # Check for DINO embedding
                if not cell.get("dino_embedding"):
                    print(f"Warning: Cell {idx} has no dino_embedding, skipping")
                    continue
                
                # Generate unique UUID and image_id
                cell["uuid"] = str(uuid.uuid4())
                cell["image_id"] = f"{application_id}_cell_{idx}_{uuid.uuid4().hex[:8]}"
                cells_to_insert.append(cell)
            
            # Batch insert (single operation!)
            insert_result = chroma_storage.insert_cells(
                application_id=application_id,
                cells=cells_to_insert
            )
            
            print(f"✅ Stored {insert_result['inserted_count']} cells to ChromaDB")
            
            # Remove images and embeddings from results to save memory
            for cell in results:
                cell.pop("image", None)
                cell.pop("clip_embedding", None)
                cell.pop("dino_embedding", None)
            
        except Exception as e:
            print(f"Warning: Failed to store cells to ChromaDB: {e}")
            logger.warning(f"Failed to store cells to ChromaDB: {e}")
            # Continue without ChromaDB storage - return full records
        
        return results
            
    # Define hypha-rpc service method for interactive UMAP (HTML)
    @schema_function()
    async def make_umap_cluster_figure_interactive_rpc(
        all_cells: List[dict],
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        random_state: Optional[int] = None,
        n_jobs: int = -1,
        metadata_fields: Optional[List[str]] = None,
    ) -> dict:
        """
        Generate interactive UMAP visualization (Plotly HTML) with switchable coloring modes via hypha-rpc.
        Args:
            all_cells: List of cell dictionaries with embeddings and optional metadata
            n_neighbors: Number of neighbors for UMAP (default: 15)
            min_dist: Minimum distance for UMAP (default: 0.1)
        Returns:
            dict: JSON object with success flag, HTML string of interactive visualization, and cluster labels.
            example return:
            {
                "success": True,
                "html": "<html>...</html>",
                "cluster_labels": [0, 1, 2, 3, 4],
                "n_cells": 100,
                "n_clusters": 5
            }
        """
        try:
            if not all_cells or len(all_cells) == 0:
                return {
                    "success": False,
                    "error": "No cells provided",
                    "html": None,
                    "cluster_labels": None
                }
            
            from agent_lens.utils.umap_analysis_utils import (
                make_umap_cluster_figure_interactive,
                PLOTLY_AVAILABLE
            )
            
            logger.info(f"Starting UMAP visualization for {len(all_cells)} cells with n_jobs={n_jobs}")
            
            # Run in thread pool to avoid blocking
            result = await asyncio.to_thread(
                make_umap_cluster_figure_interactive,
                all_cells=all_cells,
                n_neighbors=n_neighbors,
                min_dist=min_dist,
                random_state=random_state,
                metadata_fields=metadata_fields,
                n_jobs=n_jobs,
            )
            
            if result is None:
                # Provide more specific error message
                cells_with_embeddings = sum(1 for c in all_cells 
                                           if c.get("dino_embedding") or c.get("clip_embedding") or c.get("embedding_vector"))
                
                if not PLOTLY_AVAILABLE:
                    error_msg = "Plotly is not available. Install with: pip install plotly"
                elif cells_with_embeddings < 5:
                    error_msg = f"Too few cells with embeddings ({cells_with_embeddings}/{len(all_cells)}). Need at least 5 cells with dino_embedding, clip_embedding, or embedding_vector."
                else:
                    error_msg = "Failed to generate interactive UMAP figure (unknown error)"
                
                return {
                    "success": False,
                    "error": error_msg,
                    "html": None,
                    "cluster_labels": None,
                    "cells_with_embeddings": cells_with_embeddings,
                    "total_cells": len(all_cells)
                }
            
            return {
                "success": True,
                "html": result["html"],
                "cluster_labels": result["cluster_labels"],
                "n_cells": len(all_cells),
                "n_clusters": len(set(result["cluster_labels"]))
            }
        except Exception as e:
            logger.error(f"Error generating interactive UMAP figure via RPC: {e}")
            logger.error(traceback.format_exc())
            raise
    
    # Define hypha-rpc service method for fetching cell images from ChromaDB
    @schema_function()
    async def fetch_cell_images(
        uuids: List[str],
        application_id: str,
        include_embeddings: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Fetch cell images from ChromaDB by UUIDs (batch operation).
        
        Args:
            uuids: List of cell UUIDs
            application_id: Application ID
            include_embeddings: Whether to include DINO embedding vector
            
        Returns:
            List of dicts with 'uuid', 'image', metadata, and optionally 'dino_embedding'
        """
        try:
            # Single batch fetch operation!
            results = chroma_storage.fetch_by_uuids(
                application_id=application_id,
                uuids=uuids,
                include_embeddings=include_embeddings
            )
            return results
            
        except Exception as e:
            logger.error(f"Failed to fetch cells from ChromaDB: {e}")
            return [{"uuid": uuid, "error": str(e)} for uuid in uuids]
    
    # Define hypha-rpc service method for fetching cell embeddings only
    @schema_function()
    async def fetch_cell_embeddings(
        uuids: List[str],
        application_id: str
    ) -> List[Dict[str, Any]]:
        """
        Fetch only DINO embeddings for cells (for UMAP clustering).
        No images - bandwidth efficient.
        
        Args:
            uuids: List of cell UUIDs
            application_id: Application ID
            
        Returns:
            List of dicts with 'uuid' and 'dino_embedding'
        """
        try:
            # Batch fetch with embeddings
            results = chroma_storage.fetch_by_uuids(
                application_id=application_id,
                uuids=uuids,
                include_embeddings=True
            )
            
            # Remove images to save bandwidth
            for cell in results:
                cell.pop("image", None)
            
            return results
            
        except Exception as e:
            logger.error(f"Failed to fetch embeddings from ChromaDB: {e}")
            return [{"uuid": uuid, "error": str(e)} for uuid in uuids]
    
    # Define hypha-rpc service method for resetting application data
    @schema_function()
    async def reset_application(application_id: str) -> dict:
        """
        Delete all cell annotations for a specific application from ChromaDB.
        Used to clean up before starting a new notebook session.
        
        Args:
            application_id: Application ID to reset (e.g., "hypha-agents-notebook")
            
        Returns:
            dict: {
                "success": bool,
                "deleted_count": int,
                "application_id": str,
                "message": str
            }
        """
        try:
            result = chroma_storage.reset_application(application_id)
            logger.info(f"Reset application '{application_id}': {result['message']}")
            return result
            
        except Exception as e:
            logger.error(f"Failed to reset application '{application_id}': {e}")
            return {
                "success": False,
                "deleted_count": 0,
                "application_id": application_id,
                "message": f"Error: {str(e)}"
            }
    
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
            "build_cell_records": build_cell_records,
            # Register RPC methods for UMAP clustering
            "make_umap_cluster_figure_interactive": make_umap_cluster_figure_interactive_rpc,
            # Register RPC methods for ChromaDB data management
            "reset_application": reset_application,
            "fetch_cell_images": fetch_cell_images,
            "fetch_cell_embeddings": fetch_cell_embeddings,
            # Backward compatibility (deprecated, use new names)
            "fetch_cell_images_from_weaviate": fetch_cell_images,
            "fetch_cell_embeddings_from_weaviate": fetch_cell_embeddings,
        }
    )

    logger.info(f"Frontend service registered successfully with ID: {server_id}")

    # Register health probes if running in Docker mode
    if is_docker:
        logger.info("Docker mode detected - registering health probes...")
        
        def check_readiness():
            """Check if the service is ready to accept requests."""
            return {"status": "ok", "service": server_id}
        
        async def check_liveness():
            """
            Check if the service is alive and all critical connections are working.
            This checks:
            1. Artifact manager connection (for microscope galleries)
            2. Weaviate connection (for similarity search)
            """
            health_status = {
                "status": "ok",
                "service": server_id,
                "checks": {}
            }
            
            # Check 1: Artifact manager connection
            try:
                # Try to list microscope galleries to verify artifact manager is working
                result = await artifact_manager_instance.list_microscope_galleries(microscope_service_id="microscope-squid-1")
                if result and not result.get("error"):
                    health_status["checks"]["artifact_manager"] = "ok"
                else:
                    health_status["checks"]["artifact_manager"] = "degraded"
                    health_status["status"] = "degraded"
            except Exception as e:
                logger.warning(f"Artifact manager health check failed: {e}")
                health_status["checks"]["artifact_manager"] = f"error: {str(e)}"
                health_status["status"] = "degraded"
            
            # Check 2: ChromaDB connection (cell storage)
            try:
                # Check if ChromaDB is accessible by listing collections
                collections = chroma_storage.list_collections()
                health_status["checks"]["chromadb"] = "ok"
            except Exception as e:
                logger.warning(f"ChromaDB health check failed: {e}")
                health_status["checks"]["chromadb"] = f"error: {str(e)}"
                health_status["status"] = "degraded"
            
            return health_status
        
        # Register probes for the service
        await server.register_probes({
            "readiness": check_readiness,
            "liveness": check_liveness,
        })
        
        logger.info(f"Health probes registered at workspace: {server.config.workspace}")
        logger.info(f"Liveness probe URL: {SERVER_URL}/{server.config.workspace}/services/probes/liveness")
        logger.info(f"Readiness probe URL: {SERVER_URL}/{server.config.workspace}/services/probes/readiness")
    else:
        logger.info("Not in Docker mode - skipping health probe registration")

    # Store the cleanup function in the server's config
    # Note: No specific cleanup needed since artifact_manager_instance is global
 