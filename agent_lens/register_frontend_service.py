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
from agent_lens.utils.weaviate_search import similarity_service, WEAVIATE_COLLECTION_NAME
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
ZARR_DATASET_PATH = "/mnt/shared_documents/offline_stitch_20251201-u2os-full-plate_2025-12-01_17-00-56.154975/data.zarr"

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
        
        This endpoint uses optimized batch processing with parallel I/O for significantly faster
        embedding generation, especially when using GPU acceleration.
        
        Returns both embeddings for each image:
        - CLIP (512D) for image-text similarity
        - DINOv2 (768D) for image-image similarity
        
        Args:
            images_base64: List of base64-encoded image data strings
            
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
                    "count": N
                }
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

    def _process_single_cell(
        poly: Dict[str, Any],
        poly_index: int,
        image_data_np: np.ndarray,
        mask: np.ndarray,
        brightfield: np.ndarray,
        fixed_channel_order: List[str],
        background_bright_value: float,
    ) -> Tuple[int, Optional[Dict[str, Any]], Optional[str]]:
        """
        Process a single cell to extract metadata and generate cell image.
        This function is designed to be run in parallel threads.
        
        Args:
            poly: Cell polygon dict with "id", "polygons", and "bbox" keys
            poly_index: Original index of this polygon in the input list (for ordering)
            image_data_np: Image array of shape (H, W, C)
            mask: Instance mask array of shape (H, W) with cell IDs
            brightfield: Brightfield channel array of shape (H, W)
            fixed_channel_order: List of channel names
        
        Returns:
            Tuple of (poly_index, metadata_dict, cell_image_base64) or (poly_index, None, None) if failed
        """
        cell_id = poly.get("id")
        if cell_id is None:
            return (poly_index, None, None)
        
        try:
            # Initialize metadata dict
            metadata = {"cell_id": cell_id}
            
            # Create binary mask for this cell
            cell_mask = (mask == cell_id).astype(np.uint8)
            
            if np.sum(cell_mask) == 0:
                # Cell not found in mask, skip
                return (poly_index, None, None)
            
            # Get region properties
            props = regionprops(cell_mask)
            if len(props) == 0:
                return (poly_index, None, None)
            prop = props[0]
            
            # Extract bounding box
            min_row, min_col, max_row, max_col = prop.bbox
            
            # Extract cell image region with padding
            padding = 5
            H, W = image_data_np.shape[:2]
            y_min = max(0, min_row - padding)
            y_max = min(H, max_row + padding)
            x_min = max(0, min_col - padding)
            x_max = min(W, max_col + padding)
            
            # Extract only brightfield channel (channel 0) for cell image
            if image_data_np.ndim == 3:
                # Extract only channel 0 (brightfield)
                cell_image_region = image_data_np[y_min:y_max, x_min:x_max, 0].copy()
            else:
                # Already 2D, use as is
                cell_image_region = image_data_np[y_min:y_max, x_min:x_max].copy()
            
            # Crop cell mask to same region
            cell_mask_region = cell_mask[y_min:y_max, x_min:x_max]
            
            # Convert brightfield (grayscale) to RGB uint8 for embedding generation
            # Stack the single channel 3 times to create RGB (grayscale to RGB)
            cell_image_rgb = np.stack([cell_image_region] * 3, axis=-1)
            
            # Ensure uint8 (and compute matching uint8 background value)
            if cell_image_rgb.dtype != np.uint8:
                max_val = float(cell_image_rgb.max()) if cell_image_rgb.size else 0.0
                if max_val > 255:
                    scale = 255.0 / max_val
                    cell_image_rgb = (cell_image_rgb * scale).astype(np.uint8)
                    bg_u8 = int(np.clip(background_bright_value * scale, 0, 255))
                else:
                    cell_image_rgb = cell_image_rgb.astype(np.uint8)
                    bg_u8 = int(np.clip(background_bright_value, 0, 255))
            else:
                bg_u8 = int(np.clip(background_bright_value, 0, 255))
            
            # Apply cell mask to isolate the cell (fill outside-cell pixels with background bright value)
            cell_mask_3d = np.expand_dims(cell_mask_region.astype(bool), axis=2)
            cell_image_rgb = np.where(cell_mask_3d, cell_image_rgb, bg_u8).astype(np.uint8)
            
            # Convert to PIL Image and encode as base64 PNG
            cell_pil = PILImage.fromarray(cell_image_rgb, mode='RGB')
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
                    metadata["brightness"] = None
                    metadata["contrast"] = None
                    metadata["homogeneity"] = None
                    metadata["energy"] = None
                    metadata["correlation"] = None
                    
                    # Mean fluorescence intensity for each channel (set to None when no pixels)
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                metadata[field_name] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                else:
                    # Mean brightness
                    metadata["brightness"] = float(np.mean(cell_pixels))
                    
                    # Mean fluorescence intensity for each channel
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                channel_data = image_data_np[:, :, channel_idx]
                                channel_pixels = channel_data[cell_mask > 0]
                                
                                if len(channel_pixels) > 0 and channel_data.max() > 0:
                                    # Create sanitized field name (remove spaces, special chars)
                                    field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                    metadata[field_name] = float(np.mean(channel_pixels))
                                else:
                                    field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                                    metadata[field_name] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                    
                    # GLCM features if enough pixels
                    if len(cell_pixels) >= 4:
                        # Ensure uint8
                        if gray.dtype != np.uint8:
                            if gray.max() > 0:
                                gray = ((gray - gray.min()) / (gray.max() - gray.min()) * 255).astype(np.uint8)
                            else:
                                gray = gray.astype(np.uint8)
                        
                        # Mask background
                        cell_region = gray.copy()
                        cell_region[cell_mask == 0] = 0
                        
                        angles = [0, np.pi / 4, np.pi / 2, 3 * np.pi / 4]
                        glcm = graycomatrix(
                            cell_region,
                            distances=[1],
                            angles=angles,
                            levels=256,
                            symmetric=True,
                            normed=True
                        )
                        
                        contrast_vals = graycoprops(glcm, "contrast")[0]
                        homogeneity_vals = graycoprops(glcm, "homogeneity")[0]
                        energy_vals = graycoprops(glcm, "energy")[0]
                        correlation_vals = graycoprops(glcm, "correlation")[0]
                        
                        metadata["contrast"] = float(np.mean(contrast_vals))
                        metadata["homogeneity"] = float(np.mean(homogeneity_vals))
                        metadata["energy"] = float(np.mean(energy_vals))
                        metadata["correlation"] = float(np.mean(correlation_vals))
                    else:
                        metadata["contrast"] = None
                        metadata["homogeneity"] = None
                        metadata["energy"] = None
                        metadata["correlation"] = None
            except:
                metadata["brightness"] = None
                metadata["contrast"] = None
                metadata["homogeneity"] = None
                metadata["energy"] = None
                metadata["correlation"] = None
                
                # Mean fluorescence intensity for each channel (set to None on error)
                try:
                    if image_data_np.ndim == 3:
                        for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                            channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                            field_name = f"mean_intensity_{channel_name.replace(' ', '_').replace('-', '_')}"
                            metadata[field_name] = None
                except Exception as e:
                    # If fluorescence calculation fails, continue without it
                    pass
            
            # Add image to metadata (will add embedding_vector after batch processing)
            metadata["image"] = cell_image_base64
            
            return (poly_index, metadata, cell_image_base64)
            
        except Exception as e:
            # Skip this cell if processing fails
            print(f"Error processing cell {cell_id}: {e}")
            return (poly_index, None, None)


    # extract cell metadata
    async def build_cell_records(
        cell_polygons: List[Dict[str, Any]], 
        image_data_np: np.ndarray, 
        segmentation_mask: np.ndarray,
        max_workers: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Extract morphological and intensity/texture metadata for each cell.
        Also extracts single cell images, generates embeddings, and adds them to metadata.
        
        This function uses multithreading to process cells in parallel for improved performance.
        
        Args:
            cell_polygons: List of dicts with "id", "polygons", and "bbox" keys
            image_data_np: Image array of shape (H, W, C) - uses channel 0 (brightfield)
            segmentation_mask: Instance mask array of shape (H, W) with cell IDs
            max_workers: Maximum number of worker threads (default: None = auto-detect CPU count)
        
        Returns:
            List of metadata dictionaries, one per cell, with 'image', 'clip_embedding', and 'dino_embedding' fields
        """
        import concurrent.futures
        import os
        
        # Extract brightfield channel
        brightfield = image_data_np[:, :, 0] if image_data_np.ndim == 3 else image_data_np
        
        # Ensure mask is numpy array
        if isinstance(segmentation_mask, str):
            mask_bytes = base64.b64decode(segmentation_mask)
            mask_img = PILImage.open(io.BytesIO(mask_bytes))
            mask = np.array(mask_img).astype(np.uint32)
        else:
            mask = segmentation_mask.astype(np.uint32)
        
        # Compute a global background bright value from non-cell pixels (mask == 0)
        non_cell_pixels = brightfield[mask == 0]
        if non_cell_pixels.size == 0:
            raise ValueError("No non-cell pixels found (mask==0). Cannot compute background median.")
        background_bright_value = float(np.median(non_cell_pixels))
        
        if max_workers is None:
            max_workers = min(len(cell_polygons), os.cpu_count() or 4)
        
        # Step 1: Process cells in parallel using ThreadPoolExecutor
        # Prepare arguments for parallel processing
        process_args = [
            (poly, idx, image_data_np, mask, brightfield, fixed_channel_order, background_bright_value)
            for idx, poly in enumerate(cell_polygons)
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
                    for idx, embedding_data in enumerate(embeddings):
                        if idx < len(cell_indices):
                            result_idx = cell_indices[idx]
                            if result_idx < len(results):
                                if embedding_data is not None and embedding_data.get("success"):
                                    results[result_idx]["clip_embedding"] = embedding_data.get("clip_embedding", None)
                                    results[result_idx]["dino_embedding"] = embedding_data.get("dino_embedding", None)
                                else:
                                    results[result_idx]["clip_embedding"] = None
                                    results[result_idx]["dino_embedding"] = None
                        else:
                            print(f"Warning: Embedding index {idx} out of range for cell_indices")
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
        
        return results
            
    # Define hypha-rpc service method for interactive UMAP (HTML)
    @schema_function()
    async def make_umap_cluster_figure_interactive_rpc(
        all_cells: List[dict],
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        random_state: Optional[int] = None,
        n_jobs: Optional[int] = None,
        metadata_fields: Optional[List[str]] = None,
    ) -> dict:
        """
        Generate interactive UMAP visualization (Plotly HTML) with switchable coloring modes via hypha-rpc.
        
        This method performs UMAP dimensionality reduction followed by KMeans clustering.
        Users can switch between cluster coloring and metadata heatmaps using tab buttons.
        The number of clusters is automatically determined based on the sample size (between 2 and 10).
        
        Features:
        - Interactive zoom and pan
        - Hover to see cell details (ID, area, morphology, etc.) with cell image thumbnail
        - Tab buttons to switch between Cluster view and metadata heatmaps (turbo colormap)
        - Export as PNG/SVG
        - Color-coded clusters for easy identification
        
        This method runs UMAP computation in a thread pool to avoid blocking the asyncio event loop.
        For parallelism, set random_state=None and n_jobs=-1 (uses all CPU cores).
        
        Args:
            all_cells: List of cell dictionaries, each should have 'embedding_vector' key
            n_neighbors: Number of neighbors for UMAP (default: 15)
            min_dist: Minimum distance for UMAP (default: 0.1)
            random_state: Random state for reproducibility. If None, allows parallelism (default: None)
            n_jobs: Number of parallel jobs. -1 uses all CPU cores, None auto-selects based on random_state
            metadata_fields: List of metadata field names for heatmap tabs. If None, uses default fields
            
        Returns:
            dict: JSON object with success flag and HTML string of interactive visualization, or None if failed
        """
        try:
            if not all_cells or len(all_cells) == 0:
                return {
                    "success": False,
                    "error": "No cells provided",
                    "html": None
                }
            
            from agent_lens.utils.umap_analysis_utils import make_umap_cluster_figure_interactive
            
            # Run in thread pool to avoid blocking
            html = await asyncio.to_thread(
                make_umap_cluster_figure_interactive,
                all_cells=all_cells,
                n_neighbors=n_neighbors,
                min_dist=min_dist,
                random_state=random_state,
                metadata_fields=metadata_fields,
                n_jobs=n_jobs,
            )
            
            if html is None:
                return {
                    "success": False,
                    "error": "Failed to generate interactive UMAP figure (Plotly not available or too few cells)",
                    "html": None
                }
            
            return {
                "success": True,
                "html": html,
                "n_cells": len(all_cells)
            }
        except Exception as e:
            logger.error(f"Error generating interactive UMAP figure via RPC: {e}")
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
            "build_cell_records": build_cell_records,
            # Register RPC methods for UMAP clustering
            "make_umap_cluster_figure_interactive": make_umap_cluster_figure_interactive_rpc,
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
            
            # Check 2: Weaviate connection (similarity search)
            try:
                # Check if the default collection exists to verify Weaviate connection
                exists = await similarity_service.collection_exists(WEAVIATE_COLLECTION_NAME)
                health_status["checks"]["weaviate"] = "ok" if exists is not None else "error"
                if exists is None:
                    health_status["status"] = "degraded"
            except Exception as e:
                logger.warning(f"Weaviate health check failed: {e}")
                health_status["checks"]["weaviate"] = f"error: {str(e)}"
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
 