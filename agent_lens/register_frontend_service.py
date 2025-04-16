"""
This module provides functionality for registering a frontend service
that serves the frontend application.
"""

import os
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from agent_lens.artifact_manager import TileManager, AgentLensArtifactManager
from hypha_rpc import connect_to_server
import base64
import io
import httpx
import numpy as np
from PIL import Image
# Import scikit-image for more professional bioimage processing
from skimage import exposure, util, color

ARTIFACT_ALIAS = "microscopy-tiles-complete"
DEFAULT_CHANNEL = "BF_LED_matrix_full"
# Create a global TileManager instance
tile_manager = TileManager()

# Create a global AgentLensArtifactManager instance
artifact_manager_instance = AgentLensArtifactManager()

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.getenv("REEF_WORKSPACE_TOKEN")

async def get_artifact_manager():
    """Get a new connection to the artifact manager."""
    api = await connect_to_server(
        {"name": "test-client", "server_url": SERVER_URL, "token": WORKSPACE_TOKEN}
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
    frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
    dist_dir = os.path.join(frontend_dir, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/", response_class=HTMLResponse)
    async def root():
        return FileResponse(os.path.join(dist_dir, "index.html"))

    # New endpoint to serve tiles from the new TileManager
    @app.get("/tile")
    async def tile_endpoint(channel_name: str = DEFAULT_CHANNEL, z: int = 0, x: int = 0, y: int = 0):
        tile_b64 = await tile_manager.get_tile_base64(channel_name, z, x, y)
        return tile_b64

    # New endpoint to serve merged tiles from multiple channels
    @app.get("/merged-tiles")
    async def merged_tiles_endpoint(channels: str, z: int = 0, x: int = 0, y: int = 0, dataset_id: str = None, timepoint: str = None):
        """
        Endpoint to merge tiles from multiple channels.
        
        Args:
            channels (str): Comma-separated list of channel keys (e.g., "0,11,12")
            z (int): Zoom level
            x (int): X coordinate
            y (int): Y coordinate
            dataset_id (str, optional): Dataset ID for timepoint-specific tiles
            timepoint (str, optional): Timepoint for timepoint-specific tiles
        
        Returns:
            str: Base64 encoded merged tile image
        """
        channel_keys = [int(key) for key in channels.split(',') if key]
        
        if not channel_keys:
            # Return a blank tile if no channels are specified
            blank_image = Image.new("RGB", (tile_manager.tile_size, tile_manager.tile_size), color=(0, 0, 0))
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode('utf-8')
        
        # Define colors for each channel (RGB format)
        channel_colors = {
            0: None,  # Brightfield - grayscale, no color overlay
            11: (153, 85, 255),  # 405nm - violet
            12: (34, 255, 34),   # 488nm - green
            14: (255, 85, 85),   # 561nm - red-orange
            13: (255, 0, 0)      # 638nm - deep red
        }
        
        # Channel names mapping
        channel_names = {
            0: 'BF_LED_matrix_full',
            11: 'Fluorescence_405_nm_Ex', 
            12: 'Fluorescence_488_nm_Ex',
            14: 'Fluorescence_561_nm_Ex',
            13: 'Fluorescence_638_nm_Ex'
        }
        
        # Get tiles for each channel
        channel_tiles = []
        for channel_key in channel_keys:
            channel_name = channel_names.get(channel_key, DEFAULT_CHANNEL)
            
            try:
                if dataset_id and timepoint:
                    # Get tile for a specific timepoint
                    tile_data = await get_timepoint_tile_data(dataset_id, timepoint, channel_name, z, x, y)
                else:
                    # Get regular tile
                    tile_data = await tile_manager.get_tile_np_data(channel_name, z, x, y)
                
                # Ensure the tile data is properly shaped (check if empty/None)
                if tile_data is None or tile_data.size == 0:
                    # Create a blank tile if we couldn't get data
                    tile_data = np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)
                
                channel_tiles.append((tile_data, channel_key))
            except Exception as e:
                print(f"Error getting tile for channel {channel_name}: {e}")
                # Use blank tile on error
                blank_tile = np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)
                channel_tiles.append((blank_tile, channel_key))
        
        # Create an RGB image to merge the channels using scikit-image processing
        merged_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.float32)
        
        # Check if brightfield channel is included
        has_brightfield = 0 in [ch_key for _, ch_key in channel_tiles]
        
        for tile_data, channel_key in channel_tiles:
            if channel_key == 0:  # Brightfield
                # For brightfield, apply contrast stretching and use as base layer
                if len(tile_data.shape) == 2:
                    # Apply contrast enhancement via adaptive histogram equalization
                    bf_enhanced = exposure.equalize_adapthist(tile_data, clip_limit=0.03)
                    
                    # Create RGB by copying the enhanced grayscale data to all channels
                    bf_rgb = np.stack([bf_enhanced, bf_enhanced, bf_enhanced], axis=2)
                    merged_image = bf_rgb.copy()
            else:
                # For fluorescence channels, apply color overlay with enhanced contrast
                color = channel_colors.get(channel_key)
                if color and len(tile_data.shape) == 2:
                    # Apply contrast stretching to enhance signal-to-noise ratio
                    # Use percentiles to ignore extreme outliers
                    p2, p98 = np.percentile(tile_data, (2, 98))
                    fluorescence_enhanced = exposure.rescale_intensity(tile_data, in_range=(p2, p98))
                    
                    # Normalize to 0-1 range
                    normalized = util.img_as_float(fluorescence_enhanced)
                    
                    # Create color overlay
                    colored_channel = np.zeros_like(merged_image)
                    colored_channel[..., 0] = normalized * (color[0] / 255.0)  # R
                    colored_channel[..., 1] = normalized * (color[1] / 255.0)  # G
                    colored_channel[..., 2] = normalized * (color[2] / 255.0)  # B
                    
                    # Add to the merged image using maximum projection for best visibility
                    if has_brightfield:
                        # For brightfield background, use screen blending mode for better visibility
                        # Screen blend: 1 - (1-a)*(1-b)
                        merged_image = 1.0 - (1.0 - merged_image) * (1.0 - colored_channel)
                    else:
                        # For fluorescence only, use max projection
                        merged_image = np.maximum(merged_image, colored_channel)
        
        # Apply final dynamic range compression for better overall contrast
        if np.max(merged_image) > 0:  # Avoid division by zero
            # Convert to 8-bit for display
            merged_image = util.img_as_ubyte(merged_image)
        else:
            # Create blank image if all channels were empty
            merged_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.uint8)
        
        # Convert to PIL image and return as base64
        pil_image = Image.fromarray(merged_image)
        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode('utf-8')

    async def get_timepoint_tile_data(dataset_id, timepoint, channel_name, z, x, y):
        """Helper function to get tile data for a specific timepoint"""
        try:
            # Ensure the artifact manager is connected
            if artifact_manager_instance.server is None:
                _, artifact_manager_instance._svc = await get_artifact_manager()
            
            # Construct the full file path including timepoint directory
            file_path = f"{timepoint}/{channel_name}/scale{z}/{y}.{x}"
            
            # Get the file URL
            get_url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
            
            # Download the tile
            async with httpx.AsyncClient() as client:
                response = await client.get(get_url)
                if response.status_code == 200:
                    # Process the image data
                    try:
                        # For OME-Zarr tiles, we might need to decompress them
                        if tile_manager.compressor:
                            compressed_data = response.content
                            decompressed_data = tile_manager.compressor.decode(compressed_data)
                            tile_data = np.frombuffer(decompressed_data, dtype=np.uint8)
                            tile_data = tile_data.reshape((tile_manager.tile_size, tile_manager.tile_size))
                            return tile_data
                        else:
                            # If not compressed, convert directly to numpy array
                            image = Image.open(io.BytesIO(response.content))
                            if image.mode == 'L':  # Grayscale
                                return np.array(image)
                            else:  # Color image, convert to grayscale for consistency
                                gray_image = image.convert('L')
                                return np.array(gray_image)
                    except Exception as e:
                        print(f"Error processing timepoint tile: {e}")
                        return np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)
                else:
                    print(f"Failed to fetch timepoint tile: {response.status_code}")
                    return np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)
        except Exception as e:
            print(f"Error fetching timepoint tile data: {e}")
            import traceback
            print(traceback.format_exc())
            return np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)

    @app.get("/datasets")
    async def get_datasets():
        """
        Endpoint to fetch datasets from the artifact manager using the correct collection ID.

        Returns:
            list: A list of datasets (child artifacts).
        """
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Use the list method to get children of the specified artifact_id
            datasets = await artifact_manager_instance._svc.list(parent_id="reef-imaging/u2os-fucci-drug-treatment")
            # Format the response to match the expected keys in the frontend
            formatted_datasets = []
            for dataset in datasets:
                name = dataset.get("manifest", {}).get("name", dataset.get("alias", "Unknown"))
                formatted_datasets.append({"id": dataset.get("id"), "name": name})
            return formatted_datasets
        except Exception as e:
            print(f"Error fetching datasets: {e}")
            return []

    @app.get("/subfolders")
    async def get_subfolders(dataset_id: str, dir_path: str = None, offset: int = 0, limit: int = 20):
        """
        Endpoint to fetch contents (files and subfolders) from a specified directory within a dataset,
        with pagination support.

        Args:
            dataset_id (str): The ID of the dataset.
            dir_path (str, optional): The directory path within the dataset to list contents. Defaults to None for the root directory.
            offset (int, optional): Number of items to skip. Defaults to 0.
            limit (int, optional): Maximum number of items to return. Defaults to 20.

        Returns:
            dict: A dictionary containing paginated items and total count.
        """
        print(f"Fetching contents for dataset: {dataset_id}, dir_path: {dir_path}, offset: {offset}, limit: {limit}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get all files and directories in the current path
            all_items = await artifact_manager_instance._svc.list_files(dataset_id, dir_path=dir_path)
            print(f"All items, length: {len(all_items)}")
            
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
            
            print(f"Returning {len(paginated_items)} of {total_count} items (offset: {offset}, limit: {limit})")
            
            # Return both the items and the total count
            return {
                "items": paginated_items,
                "total": total_count,
                "offset": offset,
                "limit": limit
            }
        except Exception as e:
            print(f"Error fetching contents: {e}")
            import traceback
            print(traceback.format_exc())
            return {"items": [], "total": 0, "offset": offset, "limit": limit, "error": str(e)}

    @app.get("/file")
    async def get_file_url(dataset_id: str, file_path: str):
        """
        Endpoint to get a pre-signed URL for a file in a dataset.

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file within the dataset.

        Returns:
            dict: A dictionary containing the pre-signed URL for the file.
        """
        print(f"Getting file URL for dataset: {dataset_id}, file_path: {file_path}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get the pre-signed URL for the file
            url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
            return {"url": url}
        except Exception as e:
            print(f"Error getting file URL: {e}")
            import traceback
            print(traceback.format_exc())
            return {"error": str(e)}

    @app.get("/download")
    async def download_file(dataset_id: str, file_path: str):
        """
        Endpoint to download a file from a dataset.

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file within the dataset.

        Returns:
            Response: A redirect to the pre-signed URL for downloading the file.
        """
        print(f"Downloading file from dataset: {dataset_id}, file_path: {file_path}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get the pre-signed URL for the file
            url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=url)
        except Exception as e:
            print(f"Error downloading file: {e}")
            import traceback
            print(traceback.format_exc())
            from fastapi.responses import JSONResponse
            return JSONResponse(content={"error": str(e)}, status_code=404)

    @app.get("/setup-image-map")
    async def setup_image_map(dataset_name: str):
        """
        Endpoint to setup the image map access for a specific dataset.
        Checks if the corresponding dataset exists in the image-map gallery.

        Args:
            dataset_name (str): The name of the current dataset (e.g., "20250410-treatment").

        Returns:
            dict: A dictionary containing success status and message.
        """
        print(f"Setting up image map for dataset: {dataset_name}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        
        try:
            # Target gallery for image maps
            gallery_id = "reef-imaging/image-map-of-u2os-fucci-drug-treatment"
            # Expected dataset name pattern
            image_map_dataset = f"reef-imaging/image-map-{dataset_name}"
            
            # Check if the specific dataset exists in the gallery
            try:
                # List all datasets in the gallery
                datasets = await artifact_manager_instance._svc.list(parent_id=gallery_id)
                dataset_exists = any(dataset.get("id") == image_map_dataset for dataset in datasets)
                
                if dataset_exists:
                    print(f"Image map dataset found: {image_map_dataset}")
                    return {
                        "success": True, 
                        "message": f"Image map setup successful for {dataset_name}",
                        "dataset_id": image_map_dataset
                    }
                else:
                    print(f"Image map dataset not found: {image_map_dataset}")
                    return {"success": False, "message": f"Image map dataset not found: {image_map_dataset}"}
            except Exception as e:
                print(f"Error checking dataset: {e}")
                return {"success": False, "message": f"Error checking image map dataset: {str(e)}"}
        except Exception as e:
            print(f"Error setting up image map: {e}")
            import traceback
            print(traceback.format_exc())
            return {"success": False, "message": f"Error setting up image map: {str(e)}"}

    @app.get("/list-timepoints")
    async def list_timepoints(dataset_id: str):
        """
        Endpoint to list timepoints (subfolders) in an image map dataset.
        These timepoints are typically folders named by datetime.

        Args:
            dataset_id (str): The ID of the image map dataset.

        Returns:
            dict: A dictionary containing timepoints (subfolders) in the dataset.
        """
        print(f"Listing timepoints for dataset: {dataset_id}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        
        try:
            # List all files at the root level of the dataset (should be timepoint folders)
            files = await artifact_manager_instance._svc.list_files(dataset_id)
            
            # Filter for directories only and sort them (they should be in timestamp format)
            timepoints = [
                item for item in files 
                if item.get('type') == 'directory'
            ]
            
            # Sort timepoints chronologically (assuming they're in YYYY-MM-DD_HH-MM-SS format)
            timepoints.sort(key=lambda x: x.get('name', ''))
            
            return {
                "success": True,
                "timepoints": timepoints
            }
        except Exception as e:
            print(f"Error listing timepoints: {e}")
            import traceback
            print(traceback.format_exc())
            return {
                "success": False, 
                "message": f"Error listing timepoints: {str(e)}",
                "timepoints": []
            }

    @app.get("/tile-for-timepoint")
    async def tile_for_timepoint(dataset_id: str, timepoint: str, channel_name: str = DEFAULT_CHANNEL, z: int = 0, x: int = 0, y: int = 0):
        """
        Endpoint to serve tiles for a specific timepoint from an image map dataset.

        Args:
            dataset_id (str): The ID of the image map dataset.
            timepoint (str): The timepoint folder name (e.g., "2025-04-10_13-50-7").
            channel_name (str): The channel name.
            z (int): The zoom level.
            x (int): The x coordinate.
            y (int): The y coordinate.

        Returns:
            str: Base64 encoded tile image.
        """
        print(f"Fetching tile for timepoint: {timepoint}, z={z}, x={x}, y={y}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        
        try:
            # Construct the full file path including timepoint directory
            file_path = f"{timepoint}/{channel_name}/scale{z}/{y}.{x}"
            
            # Get the file URL
            get_url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
            
            # Download and process the tile
            async with httpx.AsyncClient() as client:
                response = await client.get(get_url)
                if response.status_code == 200:
                    # Process the image data
                    try:
                        # For OME-Zarr tiles, we might need to decompress them as in TileManager.get_tile_np_data
                        if tile_manager.compressor:
                            compressed_data = response.content
                            decompressed_data = tile_manager.compressor.decode(compressed_data)
                            tile_data = np.frombuffer(decompressed_data, dtype=np.uint8)
                            tile_data = tile_data.reshape((tile_manager.tile_size, tile_manager.tile_size))
                            
                            # Convert to PNG
                            image = Image.fromarray(tile_data)
                            buffer = io.BytesIO()
                            image.save(buffer, format="PNG")
                            
                            # Return as base64
                            return base64.b64encode(buffer.getvalue()).decode('utf-8')
                        else:
                            # If not compressed, return as is (already PNG)
                            return base64.b64encode(response.content).decode('utf-8')
                    except Exception as e:
                        print(f"Error processing tile: {e}")
                        # Return a blank tile
                        blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
                        buffer = io.BytesIO()
                        blank_image.save(buffer, format="PNG")
                        return base64.b64encode(buffer.getvalue()).decode('utf-8')
                else:
                    print(f"Failed to fetch tile: {response.status_code}")
                    blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
                    buffer = io.BytesIO()
                    blank_image.save(buffer, format="PNG")
                    return base64.b64encode(buffer.getvalue()).decode('utf-8')
        except Exception as e:
            print(f"Error fetching tile for timepoint: {e}")
            import traceback
            print(traceback.format_exc())
            blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
            return base64.b64encode(buffer.getvalue()).decode('utf-8')

    async def serve_fastapi(args):
        await app(args["scope"], args["receive"], args["send"])

    return serve_fastapi


async def setup_service(server, server_id="agent-lens"):
    """
    Set up the frontend service.

    Args:
        server (Server): The server instance.
    """
    # Ensure tile_manager is connected with the server (with proper token and so on)
    await tile_manager.connect()
    await server.register_service(
        {
            "id": server_id,
            "name": "Agent Lens",
            "type": "asgi",
            "serve": get_frontend_api(),
            "config": {"visibility": "public"},
        }
    )

    print("Frontend service registered successfully.")
