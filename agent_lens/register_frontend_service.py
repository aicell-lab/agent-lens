"""
This module provides functionality for registering a frontend service
that serves the frontend application.
"""

import os
from fastapi import FastAPI
from fastapi import UploadFile, File, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from agent_lens.artifact_manager import ZarrTileManager, AgentLensArtifactManager
from hypha_rpc import connect_to_server
import base64
import io
import numpy as np
from PIL import Image
# CLIP and Torch for embeddings
import clip
import torch
# Import scikit-image for more professional bioimage processing
from skimage import exposure, util
import sys
from fastapi.middleware.gzip import GZipMiddleware
import hashlib
import time
import uuid

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

async def _generate_image_embedding(image_bytes: bytes) -> np.ndarray:
    """Generate a unit-normalized CLIP embedding for an image."""
    model, preprocess = _load_clip_model()
    image_tensor = None
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = image.convert("RGB")
            image.thumbnail((224, 224), Image.Resampling.LANCZOS)
            image_tensor = preprocess(image).unsqueeze(0).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image_tensor).cpu().numpy()

        embedding = _normalize_features(image_features)[0].astype(np.float32)
        return embedding
    finally:
        if image_tensor is not None:
            del image_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

# Fixed the ARTIFACT_ALIAS to prevent duplication of 'agent-lens'
# ARTIFACT_ALIAS = "agent-lens/20250506-scan-time-lapse-2025-05-06_16-56-52"  // This was the OLD default image map.
# Now, dataset_id will be the specific time-lapse dataset alias, e.g., "20250506-scan-time-lapse-YYYY-MM-DD_HH-MM-SS"
# For local/fallback testing, we might need a default time-lapse dataset alias if the frontend doesn't provide one.
DEFAULT_TIMELAPSE_DATASET_ALIAS = "20250506-scan-time-lapse-2025-05-06_16-56-52" # Placeholder: JUST the alias
DEFAULT_CHANNEL = "BF_LED_matrix_full"

# Create a global ZarrTileManager instance
tile_manager = ZarrTileManager()

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

    @app.post("/embedding")
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
            embedding = await _generate_image_embedding(image_bytes)
            return {"model": "ViT-B/32", "embedding": embedding.tolist()}
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error generating embedding: {e}")
            import traceback
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
            import traceback
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
            import traceback
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
            import traceback
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
            import traceback
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
            import traceback
            logger.error(traceback.format_exc())
            from fastapi.responses import JSONResponse
            return JSONResponse(content={"error": str(e)}, status_code=404)

    #########################################################################################
    # These endpoints are used by new microscope map display
    #########################################################################################
    @app.get("/list-microscope-galleries")
    async def list_microscope_galleries_endpoint(microscope_service_id: str):
        """
        Endpoint to list all galleries (collections) for a given microscope's service ID.
        Returns a list of gallery info dicts.
        """
        try:
            result = await artifact_manager_instance.list_microscope_galleries(microscope_service_id)
            return result
        except Exception as e:
            logger.error(f"Error in /list-microscope-galleries: {e}")
            import traceback
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
            import traceback
            logger.error(traceback.format_exc())
            return {"success": False, "error": str(e)}

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
        # Minimal check: ensure tile_manager can attempt a connection
        # and that its artifact_manager is not None after connection attempt.
        try:
            if not tile_manager.artifact_manager:
                logger.info("Tile manager not connected, attempting connection for health check...")
                await tile_manager.connect(workspace_token=WORKSPACE_TOKEN, server_url=SERVER_URL)
            
            if not tile_manager.artifact_manager:
                raise RuntimeError("ZarrTileManager failed to connect to artifact manager service.")

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
            import traceback
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
    
    # Ensure tile_manager is connected with the server (with proper token and so on)
    connection_success = await tile_manager.connect(workspace_token=WORKSPACE_TOKEN, server_url=SERVER_URL)
    if not connection_success:
        logger.warning("Warning: Failed to connect ZarrTileManager to artifact manager service.")
        logger.warning("The tile endpoints may not function correctly.")
    else:
        logger.info("ZarrTileManager connected successfully to artifact manager service.")
    
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
    server.config["cleanup"] = tile_manager.close
 