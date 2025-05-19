"""
This module provides functionality for registering a frontend service
that serves the frontend application.
"""

import os
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from agent_lens.artifact_manager import ZarrTileManager, AgentLensArtifactManager
from hypha_rpc import connect_to_server
import base64
import io
import httpx
import numpy as np
from PIL import Image
# Import scikit-image for more professional bioimage processing
from skimage import exposure, util, color
import sys
import asyncio
from fastapi.middleware.gzip import GZipMiddleware
import hashlib
import time
from starlette.requests import ClientDisconnect  # Import at the top of the function or module
from starlette.responses import Response as StarletteResponse # Import for 499 response

# Configure logging
import logging
import logging.handlers
def setup_logging(log_file="agent_lens_frontend_service.log", max_bytes=100000, backup_count=3):
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)

    # Rotating file handler
    file_handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger

logger = setup_logging()


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
    # Add compression middleware to reduce bandwidth
    app.add_middleware(GZipMiddleware, minimum_size=500)
    
    frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
    dist_dir = os.path.join(frontend_dir, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    # Add middleware for monitoring server-side bandwidth usage
    @app.middleware("http")
    async def monitoring_middleware(request: Request, call_next):
        from starlette.requests import ClientDisconnect
        from starlette.responses import Response as StarletteResponse # Import for 499 response

        start_time = time.time()
        request_size = 0
        response = None
        try:
            body = await request.body()
            request_size = len(body)
            response = await call_next(request)
            process_time = time.time() - start_time
            response.headers["X-Process-Time"] = f"{process_time:.4f}"
            if not response.headers.get("Cache-Control") and request.url.path.startswith(("/assets", "/public")):
                response.headers["Cache-Control"] = "public, max-age=86400"
            if request.url.path.startswith(("/tile", "/merged-tiles", "/tile-for-timepoint")):
                path_parts = request.url.path.split("?")[0].split("/")
                endpoint = path_parts[-1] if path_parts else "unknown"
                logger.info(
                    f"METRICS: endpoint={endpoint} method={request.method} "
                    f"path={request.url.path} processing_time={process_time:.4f}s "
                    f"request_size={request_size} response_status={response.status_code}"
                )
            return response
        except ClientDisconnect:
            logger.warning(f"Client disconnected for {request.url.path}.")
            if response is None: # Disconnect happened before call_next() completed or even started
                # Return a 499 Client Closed Request response
                return StarletteResponse(status_code=499)
            # If response was already formed (e.g. disconnect during sending), return it.
            # Starlette will handle the inability to send if the client is gone.
            return response 
        except Exception as e:
            logger.error(f"Error in monitoring_middleware: {e}", exc_info=True)
            raise

    @app.get("/", response_class=HTMLResponse)
    async def root():
        return FileResponse(os.path.join(dist_dir, "index.html"))

    # Updated endpoint to serve tiles using ZarrTileManager
    @app.get("/tile")
    async def tile_endpoint(
        channel_name: str = DEFAULT_CHANNEL, 
        z: int = 0, 
        x: int = 0, 
        y: int = 0,
        dataset_id: str = DEFAULT_TIMELAPSE_DATASET_ALIAS, # Now expects specific time-lapse dataset alias
        # timestamp: str = "2025-04-29_16-38-27", # Timestamp no longer used to find data, dataset_id is specific
        # New parameters for image processing settings
        contrast_settings: str = None,
        brightness_settings: str = None,
        threshold_settings: str = None,
        color_settings: str = None,
        priority: int = 10,  # Default priority (lower is higher priority)
        # Add compression quality control
        compression_quality: int = None  # Default compression quality will be used if not specified
    ):
        """
        Endpoint to serve tiles with customizable image processing settings.
        Now uses Zarr-based tile access for better performance.
        
        Args:
            channel_name (str): The channel name to retrieve
            z (int): Zoom level (maps to scale, e.g., Zarr scaleN)
            x (int): X coordinate
            y (int): Y coordinate
            dataset_id (str): The specific time-lapse dataset alias.
            # timestamp (str) parameter removed as dataset_id is now specific.
            contrast_settings (str, optional): JSON string with contrast settings
            brightness_settings (str, optional): JSON string with brightness settings
            threshold_settings (str, optional): JSON string with min/max threshold settings
            color_settings (str, optional): JSON string with color settings
            priority (int, optional): Priority level for tile loading (lower is higher priority)
            compression_quality (int, optional): WebP/PNG compression quality (1-100, lower=smaller)
        
        Returns:
            str: Base64 encoded tile image
        """
        import json
        
        try:
            start_time = time.time()
            request_id = hashlib.md5(f"{time.time()}-{channel_name}-{x}-{y}".encode()).hexdigest()[:8]
            
            # Ensure dataset_id is just the alias
            processed_dataset_alias = dataset_id.split('/')[-1]

            # Queue the tile request with the specified priority
            # The `timestamp` argument for `request_tile` is now for context/logging, not path.
            await tile_manager.request_tile(processed_dataset_alias, None, channel_name, z, x, y, priority)
            
            # Get the raw tile data as numpy array using ZarrTileManager
            # The `timestamp` argument for `get_tile_np_data` is also for context/logging.
            tile_data = await tile_manager.get_tile_np_data(processed_dataset_alias, channel_name, z, x, y)
            
            # If tile_data is None, return an empty response to let the client handle it
            if tile_data is None:
                logger.info(f"No tile data available for {dataset_id}:{channel_name}:{z}:{x}:{y}")
                # Create an empty response with status 204 (No Content)
                response = Response(status_code=204)
                response.headers["X-Empty-Tile"] = "true"
                return response
            
            # Parse settings from JSON strings if provided
            try:
                contrast_dict = json.loads(contrast_settings) if contrast_settings else {}
                brightness_dict = json.loads(brightness_settings) if brightness_settings else {}
                threshold_dict = json.loads(threshold_settings) if threshold_settings else {}
                color_dict = json.loads(color_settings) if color_settings else {}
            except json.JSONDecodeError as e:
                logger.error(f"Error parsing settings JSON: {e}")
                contrast_dict = {}
                brightness_dict = {}
                threshold_dict = {}
                color_dict = {}
            
            # Channel mapping to keys
            channel_key = None
            for key, name in {
                '0': 'BF_LED_matrix_full',
                '11': 'Fluorescence_405_nm_Ex', 
                '12': 'Fluorescence_488_nm_Ex',
                '14': 'Fluorescence_561_nm_Ex',
                '13': 'Fluorescence_638_nm_Ex'
            }.items():
                if name == channel_name:
                    channel_key = key
                    break
            
            # If channel key is found and we have custom settings, apply processing
            if channel_key and tile_data is not None and len(tile_data.shape) == 2:
                # Check if any non-default settings are provided
                has_custom_settings = False
                
                if channel_key in contrast_dict and float(contrast_dict[channel_key]) != 0:
                    has_custom_settings = True
                if channel_key in brightness_dict and float(brightness_dict[channel_key]) != 1.0:
                    has_custom_settings = True
                if channel_key in threshold_dict:
                    has_custom_settings = True
                if channel_key in color_dict and channel_key != '0':
                    has_custom_settings = True
                
                # If using default settings, return original image without normalization
                if not has_custom_settings:
                    # For grayscale, just use the original image
                    pil_image = Image.fromarray(tile_data)
                else:
                    # Get channel-specific settings with defaults
                    contrast = float(contrast_dict.get(channel_key, 0))  # Default CLAHE clip limit
                    brightness = float(brightness_dict.get(channel_key, 1.0))  # Default brightness multiplier
                    
                    # Ensure brightness is within safe range (0.5-2.0)
                    safe_brightness = max(0.5, min(2.0, brightness))
                    
                    # Apply brightness adjustment to original data first (simple scaling)
                    # This preserves original image characteristics
                    adjusted = tile_data.astype(np.float32) * safe_brightness
                    adjusted = np.clip(adjusted, 0, 255).astype(np.uint8)
                    
                    # Apply contrast enhancement only if specifically requested
                    if contrast > 0:  # Only apply when contrast value is positive
                        # Threshold settings (percentiles by default)
                        threshold_min = float(threshold_dict.get(channel_key, {}).get("min", 2))
                        threshold_max = float(threshold_dict.get(channel_key, {}).get("max", 98))
                        
                        # FIXED: Use fixed intensity values instead of per-tile percentiles
                        # This ensures consistent contrast across tiles
                        if channel_key in threshold_dict:
                            # Calculate fixed intensity values across the range based on contrast
                            # Reduced from 3.0 to 1.5 to make contrast effect more subtle
                            contrast_scale = float(contrast) * 1.5
                            
                            # Calculate fixed intensity range for consistency
                            # Make the range more conservative
                            input_range_min = max(0, 96 - (96 * contrast_scale))
                            input_range_max = min(255, 160 + (96 * contrast_scale))
                            
                            # Apply linear contrast stretch with fixed values to ensure consistency
                            enhanced = exposure.rescale_intensity(
                                adjusted, 
                                in_range=(input_range_min, input_range_max),
                                out_range=(0, 255)
                            )
                        else:
                            enhanced = adjusted
                        
                        # Only apply CLAHE if specifically requested with higher values
                        if float(contrast) > 0.05:
                            # Reduce the CLAHE clip limit to minimize tile boundary issues
                            safe_contrast = min(0.03, float(contrast))
                            
                            # Apply CLAHE with conservative settings
                            enhanced = exposure.equalize_adapthist(
                                enhanced, 
                                clip_limit=safe_contrast,
                                kernel_size=128  # Larger kernel helps with consistency
                            )
                            # Ensure proper uint8 conversion after CLAHE
                            enhanced = util.img_as_ubyte(enhanced)
                        else:
                            # Make sure enhanced is uint8 when not using CLAHE
                            if not isinstance(enhanced, np.ndarray) or enhanced.dtype != np.uint8:
                                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                    else:
                        enhanced = adjusted
                    
                    # If a color is specified for fluorescence channels
                    if channel_key != '0' and channel_key in color_dict:
                        color_tuple = tuple(color_dict[channel_key])
                        
                        # Create an RGB image using float32 for calculations
                        rgb_image_float = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.float32)
                        
                        # Make sure enhanced is uint8 for consistent processing
                        if enhanced.dtype != np.uint8:
                            enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                        
                        # Convert to float for color multiplication
                        enhanced_float = enhanced.astype(np.float32) / 255.0
                        
                        # Apply the color to each channel - using the enhanced_float image
                        rgb_image_float[..., 0] = enhanced_float * (color_tuple[0] / 255.0)  # R
                        rgb_image_float[..., 1] = enhanced_float * (color_tuple[1] / 255.0)  # G
                        rgb_image_float[..., 2] = enhanced_float * (color_tuple[2] / 255.0)  # B
                        
                        # Scale back to 0-255 range, clip to ensure valid values, then cast to uint8
                        rgb_image = np.clip(rgb_image_float * 255.0, 0, 255).astype(np.uint8)
                        
                        # Convert to PIL image
                        pil_image = Image.fromarray(rgb_image)
                    else:
                        # For grayscale, just use the enhanced image (ensuring it's uint8)
                        if enhanced.dtype != np.uint8:
                            enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                        pil_image = Image.fromarray(enhanced)
            else:
                # If no processing applied, convert directly to PIL image
                pil_image = Image.fromarray(tile_data)
            
            # Cache key for ETag (use multiple criteria to avoid conflicts)
            cache_tag = f"{dataset_id}:{channel_name}:{z}:{x}:{y}"
            if contrast_settings:
                cache_tag += f":{hashlib.md5(contrast_settings.encode()).hexdigest()[:6]}"
            if brightness_settings:
                cache_tag += f":{hashlib.md5(brightness_settings.encode()).hexdigest()[:6]}"
            
            # Generate ETag based on multiple factors
            etag = hashlib.md5(cache_tag.encode()).hexdigest()
            
            # Determine compression quality
            # Lower zoom levels (overviews) can use lower quality
            # Higher zoom levels (details) need higher quality
            if compression_quality is None:
                if z <= 1:  # More detailed zoom levels
                    quality = 80
                elif z == 2:  # Medium zoom
                    quality = 70
                else:  # Overview zoom levels
                    quality = 60
            else:
                # Clamp user-specified quality between 30-100
                quality = max(30, min(100, compression_quality))
            
            # Convert to base64
            buffer = io.BytesIO()
            pil_image.save(buffer, format="PNG", compress_level=3, optimize=True)
            img_bytes = buffer.getvalue()
            
            # Calculate compression ratio for logging
            raw_size = pil_image.width * pil_image.height * (3 if len(pil_image.getbands()) >= 3 else 1)
            compression_ratio = len(img_bytes) / raw_size if raw_size > 0 else 0
            
            # Log request processing stats
            processing_time = time.time() - start_time
            logger.info(
                f"TILE[{request_id}]: dataset={dataset_id} channel={channel_name} z={z} x={x} y={y} "
                f"size={len(img_bytes)/1024:.1f}KB raw_size={raw_size/1024:.1f}KB "
                f"ratio={compression_ratio:.2f} time={processing_time:.4f}s"
            )
            
            # Generate cache key and ETag
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=3600"
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "png"
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Processing-Time"] = f"{processing_time:.4f}"
            # Add quality information for client-side awareness
            response.headers["X-Image-Quality"] = f"{quality}"
            return response
            
        except Exception as e:
            logger.error(f"Error in tile_endpoint: {e}")
            blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG", compress_level=3)
            img_bytes = buffer.getvalue()
            
            # Generate cache key and ETag
            etag = hashlib.md5(img_bytes).hexdigest()
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=60"  # Short cache for error responses
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "png"
            response.headers["X-Error"] = str(e)[:100]  # Include truncated error message
            return response

    # Updated endpoint to serve merged tiles
    @app.get("/merged-tiles")
    async def merged_tiles_endpoint(
        channels: str, 
        z: int = 0, 
        x: int = 0, 
        y: int = 0, 
        dataset_id: str = DEFAULT_TIMELAPSE_DATASET_ALIAS, # Expects specific time-lapse dataset alias
        # timepoint: str = "2025-04-29_16-38-27", # timepoint (old timestamp) now covered by dataset_id
        # New parameters for image processing settings
        contrast_settings: str = None,
        brightness_settings: str = None,
        threshold_settings: str = None,
        color_settings: str = None,
        priority: int = 10,  # Default priority (lower is higher priority)
        # Add compression quality control
        compression_quality: int = None  # Default compression quality will be used if not specified
    ):
        """
        Endpoint to merge tiles from multiple channels with customizable image processing settings.
        Now uses Zarr-based tile access for better performance.
        
        Args:
            channels (str): Comma-separated list of channel keys (e.g., "0,11,12")
            z (int): Zoom level
            x (int): X coordinate
            y (int): Y coordinate
            dataset_id (str, optional): Specific time-lapse Dataset ID (alias)
            # timepoint (str, optional) parameter removed.
            contrast_settings (str, optional): JSON string with contrast settings for each channel
            brightness_settings (str, optional): JSON string with brightness settings for each channel
            threshold_settings (str, optional): JSON string with min/max threshold settings for each channel
            color_settings (str, optional): JSON string with color settings for each channel
            priority (int, optional): Priority level for tile loading (lower is higher priority)
            compression_quality (int, optional): WebP/PNG compression quality (1-100, lower=smaller)
        
        Returns:
            str: Base64 encoded merged tile image
        """
        import json
        
        channel_keys = [int(key) for key in channels.split(',') if key]
        
        if not channel_keys:
            # Return an empty response if no channels are specified
            response = Response(status_code=204)
            response.headers["X-Empty-Tile"] = "true"
            return response
        
        # Default channel colors (RGB format)
        default_channel_colors = {
            0: None,  # Brightfield - grayscale, no color overlay
            11: (153, 85, 255),  # 405nm - violet
            12: (34, 255, 34),   # 488nm - green
            14: (255, 85, 85),   # 561nm - red-orange 
            13: (255, 0, 0)      # 638nm - deep red
        }
        
        # Parse settings from JSON strings if provided
        try:
            contrast_dict = json.loads(contrast_settings) if contrast_settings else {}
            brightness_dict = json.loads(brightness_settings) if brightness_settings else {}
            threshold_dict = json.loads(threshold_settings) if threshold_settings else {}
            color_dict = json.loads(color_settings) if color_settings else {}
        except json.JSONDecodeError as e:
            logger.error(f"Error parsing settings JSON: {e}")
            contrast_dict = {}
            brightness_dict = {}
            threshold_dict = {}
            color_dict = {}
        
        # Check if any custom settings are provided
        has_custom_settings = False
        for channel_key in channel_keys:
            channel_key_str = str(channel_key)
            if channel_key_str in contrast_dict and float(contrast_dict[channel_key_str]) != 0:
                has_custom_settings = True
            if channel_key_str in brightness_dict and brightness_dict[channel_key_str] != 1.0:
                has_custom_settings = True
            if channel_key_str in threshold_dict:
                has_custom_settings = True
            # Color is expected for fluorescence channels, so only consider it non-default if changed
            if channel_key != 0 and channel_key_str in color_dict and tuple(color_dict[channel_key_str]) != default_channel_colors.get(channel_key):
                has_custom_settings = True
        
        # Channel names mapping
        channel_names = {
            0: 'BF_LED_matrix_full',
            11: 'Fluorescence_405_nm_Ex', 
            12: 'Fluorescence_488_nm_Ex',
            14: 'Fluorescence_561_nm_Ex',
            13: 'Fluorescence_638_nm_Ex'
        }
        
        # Ensure dataset_id is just the alias
        processed_dataset_alias = dataset_id.split('/')[-1]

        # Get tiles for each channel using ZarrTileManager
        channel_tiles = []
        missing_tiles = 0
        
        for channel_key in channel_keys:
            channel_name = channel_names.get(channel_key, DEFAULT_CHANNEL)
            
            try:
                # Queue the tile request with the specified priority
                # The `timestamp` argument for `request_tile` is for context/logging.
                await tile_manager.request_tile(processed_dataset_alias, None, channel_name, z, x, y, priority)
                
                # Get tile from Zarr store - ZarrTileManager will handle URL expiration internally
                # The `timestamp` argument for `get_tile_np_data` is for context/logging.
                tile_data = await tile_manager.get_tile_np_data(processed_dataset_alias, channel_name, z, x, y)
                
                # Skip tile if it's None (not available)
                if tile_data is None:
                    missing_tiles += 1
                    continue
                
                # Ensure the tile data is properly shaped (check if empty/None)
                if tile_data.size == 0:
                    # Skip this channel if we couldn't get data
                    missing_tiles += 1
                    continue
                
                channel_tiles.append((tile_data, channel_key))
            except Exception as e:
                logger.error(f"Error getting tile for channel {channel_name}: {e}")
                missing_tiles += 1
        
        # If all tiles are missing, return empty response
        if missing_tiles == len(channel_keys) or not channel_tiles:
            logger.info(f"No tiles available for any channels at {dataset_id}:{channels}:{z}:{x}:{y}")
            response = Response(status_code=204)
            response.headers["X-Empty-Tile"] = "true"
            return response
        
        # Custom settings path:
        final_merged_image_float = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.float32)
        base_is_set = False

        # Pass 1: Process Brightfield (if selected)
        bf_tile_data_tuple = None
        for tile_data_loop, key_in_loop in channel_tiles:
            if key_in_loop == 0: # Brightfield channel key
                bf_tile_data_tuple = (tile_data_loop, key_in_loop)
                break
        
        if bf_tile_data_tuple:
            tile_data, channel_key = bf_tile_data_tuple # Should be 0
            channel_key_str = str(channel_key)
            
            # Get BF settings
            contrast_bf = float(contrast_dict.get(channel_key_str, 0))
            brightness_bf = float(brightness_dict.get(channel_key_str, 1.0))
            safe_brightness_bf = max(0.5, min(2.0, brightness_bf))

            # Apply brightness to BF
            adjusted_bf = tile_data.astype(np.float32) * safe_brightness_bf
            adjusted_bf_uint8 = np.clip(adjusted_bf, 0, 255).astype(np.uint8)
            
            processed_bf_uint8 = adjusted_bf_uint8 # Start with brightness-adjusted

            if float(contrast_bf) > 0:
                threshold_min_bf = float(threshold_dict.get(channel_key_str, {}).get("min", 2))
                threshold_max_bf = float(threshold_dict.get(channel_key_str, {}).get("max", 98))
                
                rescaled_bf_uint8 = adjusted_bf_uint8
                if channel_key_str in threshold_dict: # Apply rescale only if threshold settings are present for the channel
                    contrast_scale_val = float(contrast_bf) * 1.5
                    input_min_val = max(0, 96 - (96 * contrast_scale_val))
                    input_max_val = min(255, 160 + (96 * contrast_scale_val))
                    rescaled_bf_uint8 = exposure.rescale_intensity(
                        adjusted_bf_uint8, 
                        in_range=(input_min_val, input_max_val),
                        out_range=(0, 255)
                    ).astype(np.uint8)
                
                processed_bf_uint8 = rescaled_bf_uint8
                if float(contrast_bf) > 0.05: # Apply CLAHE only if contrast is high enough
                    safe_clahe_contrast_bf = min(0.03, float(contrast_bf))
                    clahe_output_bf = exposure.equalize_adapthist(
                        rescaled_bf_uint8, 
                        clip_limit=safe_clahe_contrast_bf,
                        kernel_size=128 
                    )
                    processed_bf_uint8 = util.img_as_ubyte(clahe_output_bf)

            # Convert final processed BF to float [0,1] and make it RGB
            processed_bf_float = processed_bf_uint8.astype(np.float32) / 255.0
            final_merged_image_float = np.stack([processed_bf_float] * 3, axis=-1)
            base_is_set = True

        # Pass 2: Process and blend/add Fluorescence channels
        for tile_data, channel_key in channel_tiles:
            if channel_key == 0: # Skip brightfield, already processed
                continue

            channel_key_str = str(channel_key)
            
            # Get fluorescence settings
            contrast_fluoro = float(contrast_dict.get(channel_key_str, 0))
            brightness_fluoro = float(brightness_dict.get(channel_key_str, 1.0))
            safe_brightness_fluoro = max(0.5, min(2.0, brightness_fluoro))
            
            # Color settings (RGB tuple)
            color_fluoro = tuple(color_dict.get(channel_key_str, default_channel_colors.get(channel_key)))
            if not color_fluoro: continue 

            # Apply brightness to fluorescence
            adjusted_fluoro = tile_data.astype(np.float32) * safe_brightness_fluoro
            adjusted_fluoro_uint8 = np.clip(adjusted_fluoro, 0, 255).astype(np.uint8)

            processed_fluoro_uint8 = adjusted_fluoro_uint8

            if float(contrast_fluoro) > 0:
                threshold_min_fluoro = float(threshold_dict.get(channel_key_str, {}).get("min", 2))
                threshold_max_fluoro = float(threshold_dict.get(channel_key_str, {}).get("max", 98))

                rescaled_fluoro_uint8 = adjusted_fluoro_uint8
                if channel_key_str in threshold_dict:
                    contrast_scale_val_f = float(contrast_fluoro) * 1.5
                    input_min_val_f = max(0, 96 - (96 * contrast_scale_val_f))
                    input_max_val_f = min(255, 160 + (96 * contrast_scale_val_f))
                    rescaled_fluoro_uint8 = exposure.rescale_intensity(
                        adjusted_fluoro_uint8,
                        in_range=(input_min_val_f, input_max_val_f),
                        out_range=(0, 255)
                    ).astype(np.uint8)
                
                processed_fluoro_uint8 = rescaled_fluoro_uint8
                if float(contrast_fluoro) > 0.05:
                    safe_clahe_contrast_fluoro = min(0.03, float(contrast_fluoro))
                    clahe_output_fluoro = exposure.equalize_adapthist(
                        rescaled_fluoro_uint8,
                        clip_limit=safe_clahe_contrast_fluoro,
                        kernel_size=128
                    )
                    processed_fluoro_uint8 = util.img_as_ubyte(clahe_output_fluoro)
            
            # Create colored layer (float 0-1)
            processed_fluoro_float_norm = processed_fluoro_uint8.astype(np.float32) / 255.0
            current_colored_layer_float = np.zeros_like(final_merged_image_float)
            current_colored_layer_float[..., 0] = processed_fluoro_float_norm * (color_fluoro[0] / 255.0)
            current_colored_layer_float[..., 1] = processed_fluoro_float_norm * (color_fluoro[1] / 255.0)
            current_colored_layer_float[..., 2] = processed_fluoro_float_norm * (color_fluoro[2] / 255.0)

            if base_is_set: # Blend with existing base (BF or prior fluorescence)
                # Screen blend: 1 - (1-a)*(1-b)
                final_merged_image_float = 1.0 - (1.0 - final_merged_image_float) * (1.0 - current_colored_layer_float)
            else: # This is the first layer, and it's a fluorescence channel
                # Max projection (or direct assignment if final_merged_image_float is black)
                final_merged_image_float = np.maximum(final_merged_image_float, current_colored_layer_float) 
                base_is_set = True 
        
        # Convert final floating point image to uint8
        if np.max(final_merged_image_float) > 0:
            final_merged_image_float = np.clip(final_merged_image_float, 0, 1.0) # Ensure 0-1 range before scaling
            merged_image = (final_merged_image_float * 255).astype(np.uint8)
        else:
            merged_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.uint8)
        
        # Determine compression quality based on zoom level
        # Lower zoom levels (overviews) can use lower quality
        # Higher zoom levels (details) need higher quality
        if compression_quality is None:
            if z <= 1:  # More detailed zoom levels 
                quality = 80
            elif z == 2:  # Medium zoom
                quality = 70
            else:  # Overview zoom levels
                quality = 60
        else:
            # Clamp user-specified quality between 30-100
            quality = max(30, min(100, compression_quality))

        # Create cache key for ETag
        cache_tag = f"{dataset_id}:{channels}:{z}:{x}:{y}"
        if contrast_settings:
            cache_tag += f":{hashlib.md5(contrast_settings.encode()).hexdigest()[:6]}"
        if brightness_settings:
            cache_tag += f":{hashlib.md5(brightness_settings.encode()).hexdigest()[:6]}"
        
        # Generate ETag
        etag = hashlib.md5(cache_tag.encode()).hexdigest()
        
        # Convert to PIL image and return as base64
        pil_image = Image.fromarray(merged_image)
        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG", compress_level=3, optimize=True)
        img_bytes = buffer.getvalue()
        
        # Calculate compression ratio
        raw_size = pil_image.width * pil_image.height * 3  # Always RGB for merged
        compression_ratio = len(img_bytes) / raw_size if raw_size > 0 else 0
        
        # Log processing stats
        logger.info(
            f"MERGED[{channels}]: z={z} x={x} y={y} size={len(img_bytes)/1024:.1f}KB " 
            f"ratio={compression_ratio:.2f} quality={quality}"
        )
        
        # Generate cache key and ETag
        base64_data = base64.b64encode(img_bytes).decode('utf-8')
        
        # Create response with caching headers
        response = Response(content=base64_data)
        response.headers["Cache-Control"] = "public, max-age=3600"
        response.headers["ETag"] = etag
        # Add image format header to help client know how to decode
        response.headers["X-Image-Format"] = "png"
        # Add quality information for client-side awareness
        response.headers["X-Image-Quality"] = f"{quality}"
        return response

    # Updated helper function using ZarrTileManager
    async def get_timepoint_tile_data(dataset_id, timepoint, channel_name, z, x, y):
        """Helper function to get tile data for a specific timepoint using Zarr.
           'timepoint' here is effectively the dataset_id for the specific time-lapse.
        """
        # Ensure timepoint (which is dataset_alias) is just the alias
        processed_timepoint_alias = timepoint.split('/')[-1]
        try:
            # The `timestamp` arg to get_tile_np_data is for context, dataset_id is the key.
            # Here, `timepoint` (which is a dataset_alias) is passed as `dataset_id`
            return await tile_manager.get_tile_np_data(processed_timepoint_alias, channel_name, z, x, y)
        except Exception as e:
            logger.error(f"Error fetching timepoint tile data: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return np.zeros((tile_manager.tile_size, tile_manager.tile_size), dtype=np.uint8)

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

    @app.get("/setup-image-map")
    async def setup_image_map(dataset_id: str):
        """
        Endpoint to "select" a specific time-lapse dataset for viewing.
        The dataset_id is the ALIAS of the time-lapse dataset.
        It verifies the dataset (identified by its alias) is accessible and appears to be a Zarr-like structure.
        Args:
            dataset_id (str): The ALIAS of the time-lapse dataset to use.
        Returns:
            dict: A dictionary containing success status and message.
        """
        logger.info(f"Setting up image map for time-lapse dataset (alias): {dataset_id}")
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        
        try:
            workspace = artifact_manager_instance.server.config.workspace
            full_hypha_dataset_id = f"{workspace}/{dataset_id}"
            logger.info(f"Verifying dataset access for full Hypha ID: {full_hypha_dataset_id}")

            # Check for the presence of a root .zgroup file to confirm it's Zarr-like
            root_zgroup_path = ".zgroup"
            try:
                # Use the artifact_manager's get_file, which is now used by ZarrTileManager too
                # Note: This get_file uses workspace and alias.
                zgroup_content = await artifact_manager_instance.get_file(workspace, dataset_id, root_zgroup_path)
                if zgroup_content:
                    logger.info(f"Root .zgroup found for {dataset_id}. Looks like a valid Zarr dataset.")
                    # Further check: list a few files/folders (e.g., channel names)
                    # This list_files uses the full Hypha ID.
                    contents = await artifact_manager_instance._svc.list_files(full_hypha_dataset_id, dir_path=None)
                    num_channels_or_scales = len([item for item in contents if item.get('type') == 'directory'])
                    
                    return {
                        "success": True, 
                        "message": f"Time-lapse dataset {dataset_id} verified for image map viewing.",
                        "dataset_id": dataset_id, # Return the alias
                        "top_level_dirs_count": num_channels_or_scales
                    }
                else:
                    logger.warning(f"Root .zgroup not found or empty for {dataset_id}.")
                    return {"success": False, "message": f"Dataset {dataset_id} does not appear to be a valid Zarr dataset (missing .zgroup)."}
            except Exception as e_check:
                logger.error(f"Error verifying dataset {dataset_id}: {e_check}")
                import traceback
                logger.error(traceback.format_exc())
                return {"success": False, "message": f"Error verifying dataset {dataset_id}: {str(e_check)}"}
        except Exception as e:
            logger.error(f"Error setting up image map: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {"success": False, "message": f"Error setting up image map: {str(e)}"}

    @app.get("/list-timepoints")
    async def list_timepoints(dataset_id: str):
        """
        DEPRECATED in favor of /datasets if each timepoint is a dataset.
        If a single dataset_id (alias) can still contain multiple internal "timepoints" (e.g. as top-level folders
        that are NOT channels), this MIGHT still be relevant.
        For now, assuming dataset_id refers to a single time-lapse, so this might list sub-structures if any.
        Given the new structure, this endpoint might be repurposed to list channels within a selected time-lapse dataset.
        Or, it's truly deprecated if /datasets lists all time-lapse datasets.

        Let's assume for now it lists top-level directories (channels) within the given time-lapse dataset_alias.
        Args:
            dataset_id (str): The ALIAS of the time-lapse dataset.
        Returns:
            dict: A dictionary containing top-level directories (expected to be channels).
        """
        logger.info(f"Listing top-level structures (expected channels) for dataset (alias): {dataset_id}")
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        
        try:
            workspace = artifact_manager_instance.server.config.workspace
            full_hypha_dataset_id = f"{workspace}/{dataset_id}"
            
            files = await artifact_manager_instance._svc.list_files(full_hypha_dataset_id)
            
            top_level_dirs = [
                item for item in files 
                if item.get('type') == 'directory'
            ]
            top_level_dirs.sort(key=lambda x: x.get('name', '')) # Sort by name
            
            logger.info(f"Found {len(top_level_dirs)} top-level directories (channels?) in {dataset_id}")
            return {
                "success": True,
                "directories": top_level_dirs # Renamed from "timepoints"
            }
        except Exception as e:
            logger.error(f"Error listing timepoints: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "success": False, 
                "message": f"Error listing timepoints: {str(e)}",
                "timepoints": []
            }

    @app.get("/tile-for-timepoint")
    async def tile_for_timepoint(
        dataset_id: str, 
        # timepoint: str, # This is now represented by dataset_id itself
        channel_name: str = DEFAULT_CHANNEL, 
        z: int = 0, 
        x: int = 0, 
        y: int = 0,
        # New parameters for image processing settings
        contrast_settings: str = None,
        brightness_settings: str = None,
        threshold_settings: str = None,
        color_settings: str = None,
        priority: int = 10  # Default priority (lower is higher priority)
    ):
        """
        Endpoint to serve tiles for a specific time-lapse dataset.
        The 'timepoint' concept is now embedded in `dataset_id`.

        Args:
            dataset_id (str): The ALIAS of the image map dataset (which is a specific time-lapse).
            # timepoint (str) parameter removed.
            channel_name (str): The channel name.
            z (int): The zoom level.
            x (int): The x coordinate.
            y (int): The y coordinate.
            contrast_settings (str, optional): JSON string with contrast settings
            brightness_settings (str, optional): JSON string with brightness settings
            threshold_settings (str, optional): JSON string with min/max threshold settings
            color_settings (str, optional): JSON string with color settings
            priority (int, optional): Priority level for tile loading (lower is higher priority)

        Returns:
            str: Base64 encoded tile image.
        """
        import json
        
        logger.info(f"Fetching tile for dataset: {dataset_id}, channel: {channel_name}, z={z}, x={x}, y={y}")
        
        try:
            # Ensure dataset_id is just the alias
            processed_dataset_alias = dataset_id.split('/')[-1]

            # Queue the tile request. The 'timestamp' field in request_tile is for context.
            # dataset_id here is the time-lapse dataset alias.
            await tile_manager.request_tile(processed_dataset_alias, None, channel_name, z, x, y, priority)
            
            # Get the tile data. 'timestamp' field in get_tile_np_data is for context.
            tile_data = await tile_manager.get_tile_np_data(processed_dataset_alias, channel_name, z, x, y)
            
            # If no tile data is available, return an empty response
            if tile_data is None:
                logger.info(f"No tile data available for {dataset_id}:{channel_name}:{z}:{x}:{y}")
                response = Response(status_code=204)
                response.headers["X-Empty-Tile"] = "true"
                return response
            
            # Parse settings from JSON strings if provided
            try:
                contrast_dict = json.loads(contrast_settings) if contrast_settings else {}
                brightness_dict = json.loads(brightness_settings) if brightness_settings else {}
                threshold_dict = json.loads(threshold_settings) if threshold_settings else {}
                color_dict = json.loads(color_settings) if color_settings else {}
            except json.JSONDecodeError as e:
                logger.error(f"Error parsing settings JSON: {e}")
                contrast_dict = {}
                brightness_dict = {}
                threshold_dict = {}
                color_dict = {}
            
            # Channel mapping to keys
            channel_key = None
            for key, name in {
                '0': 'BF_LED_matrix_full',
                '11': 'Fluorescence_405_nm_Ex', 
                '12': 'Fluorescence_488_nm_Ex',
                '14': 'Fluorescence_561_nm_Ex',
                '13': 'Fluorescence_638_nm_Ex'
            }.items():
                if name == channel_name:
                    channel_key = key
                    break
            
            # If channel key is found, check if custom settings are applied
            if channel_key and tile_data is not None and len(tile_data.shape) == 2:
                # Check if any non-default settings are provided
                has_custom_settings = False
                
                if channel_key in contrast_dict and float(contrast_dict[channel_key]) != 0:
                    has_custom_settings = True
                if channel_key in brightness_dict and float(brightness_dict[channel_key]) != 1.0:
                    has_custom_settings = True
                if channel_key in threshold_dict:
                    has_custom_settings = True
                if channel_key in color_dict and channel_key != '0':
                    has_custom_settings = True
                
                # If using default settings, return original image without normalization
                if not has_custom_settings:
                    # For grayscale, just use the original image
                    pil_image = Image.fromarray(tile_data)
                else:
                    # Get channel-specific settings with defaults
                    contrast = float(contrast_dict.get(channel_key, 0))  # Default CLAHE clip limit
                    brightness = float(brightness_dict.get(channel_key, 1.0))  # Default brightness multiplier
                    
                    # Ensure brightness is within safe range (0.5-2.0)
                    safe_brightness = max(0.5, min(2.0, brightness))
                    
                    # Apply brightness adjustment to original data first (simple scaling)
                    # This preserves original image characteristics
                    adjusted = tile_data.astype(np.float32) * safe_brightness
                    adjusted = np.clip(adjusted, 0, 255).astype(np.uint8)
                    
                    # Apply contrast enhancement only if specifically requested
                    if contrast > 0:  # Only apply when contrast value is positive
                        # Threshold settings (percentiles by default)
                        threshold_min = float(threshold_dict.get(channel_key, {}).get("min", 2))
                        threshold_max = float(threshold_dict.get(channel_key, {}).get("max", 98))
                        
                        # FIXED: Use fixed intensity values instead of per-tile percentiles
                        # This ensures consistent contrast across tiles
                        if channel_key in threshold_dict:
                            # Calculate fixed intensity values across the range based on contrast
                            # Reduced from 3.0 to 1.5 to make contrast effect more subtle
                            contrast_scale = float(contrast) * 1.5
                            
                            # Calculate fixed intensity range for consistency
                            # Make the range more conservative
                            input_range_min = max(0, 96 - (96 * contrast_scale))
                            input_range_max = min(255, 160 + (96 * contrast_scale))
                            
                            # Apply linear contrast stretch with fixed values to ensure consistency
                            enhanced = exposure.rescale_intensity(
                                adjusted, 
                                in_range=(input_range_min, input_range_max),
                                out_range=(0, 255)
                            )
                        else:
                            enhanced = adjusted
                        
                        # Only apply CLAHE if specifically requested with higher values
                        if float(contrast) > 0.05:
                            # Reduce the CLAHE clip limit to minimize tile boundary issues
                            safe_contrast = min(0.03, float(contrast))
                            
                            # Apply CLAHE with conservative settings
                            enhanced = exposure.equalize_adapthist(
                                enhanced, 
                                clip_limit=safe_contrast,
                                kernel_size=128  # Larger kernel helps with consistency
                            )
                            # Ensure proper uint8 conversion after CLAHE
                            enhanced = util.img_as_ubyte(enhanced)
                        else:
                            # Make sure enhanced is uint8 when not using CLAHE
                            if not isinstance(enhanced, np.ndarray) or enhanced.dtype != np.uint8:
                                enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                    else:
                        enhanced = adjusted
                    
                    # If a color is specified for fluorescence channels
                    if channel_key != '0' and channel_key in color_dict:
                        color_tuple = tuple(color_dict[channel_key])
                        
                        # Create an RGB image using float32 for calculations
                        rgb_image_float = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.float32)
                        
                        # Make sure enhanced is uint8 for consistent processing
                        if enhanced.dtype != np.uint8:
                            enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                        
                        # Convert to float for color multiplication
                        enhanced_float = enhanced.astype(np.float32) / 255.0
                        
                        # Apply the color to each channel - using the enhanced_float image
                        rgb_image_float[..., 0] = enhanced_float * (color_tuple[0] / 255.0)  # R
                        rgb_image_float[..., 1] = enhanced_float * (color_tuple[1] / 255.0)  # G
                        rgb_image_float[..., 2] = enhanced_float * (color_tuple[2] / 255.0)  # B
                        
                        # Scale back to 0-255 range, clip to ensure valid values, then cast to uint8
                        rgb_image = np.clip(rgb_image_float * 255.0, 0, 255).astype(np.uint8)
                        
                        # Convert to PIL image
                        pil_image = Image.fromarray(rgb_image)
                    else:
                        # For grayscale, just use the enhanced image (ensuring it's uint8)
                        if enhanced.dtype != np.uint8:
                            enhanced = np.clip(enhanced, 0, 255).astype(np.uint8)
                        pil_image = Image.fromarray(enhanced)
            else:
                # If no processing applied, convert directly to PIL image
                pil_image = Image.fromarray(tile_data)
            
            # Convert to base64
            buffer = io.BytesIO()
            pil_image.save(buffer, format="PNG", compress_level=3, optimize=True)
            img_bytes = buffer.getvalue()
            
            # Generate cache key and ETag
            etag = hashlib.md5(img_bytes).hexdigest()
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=3600"
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "png"
            return response
                
        except Exception as e:
            logger.error(f"Error fetching tile for timepoint: {e}")
            import traceback
            logger.error(traceback.format_exc())
            blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG", compress_level=3)
            img_bytes = buffer.getvalue()
            
            # Generate cache key and ETag
            etag = hashlib.md5(img_bytes).hexdigest()
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=3600"
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "png"
            return response

    @app.get("/setup-gallery-map")
    async def setup_gallery_map(gallery_id: str):
        """
        Endpoint to "select" a specific gallery of time-lapse datasets for map viewing.
        This verifies the gallery (identified by its ID) is accessible and contains datasets.
        
        Args:
            gallery_id (str): The ID of the gallery containing time-lapse datasets.
            
        Returns:
            dict: A dictionary containing success status and message.
        """
        logger.info(f"Setting up image map gallery: {gallery_id}")
        if artifact_manager_instance.server is None:
            server_for_am, svc_for_am = await get_artifact_manager()
            await artifact_manager_instance.connect_server(server_for_am)
        
        try:
            # Fetch datasets from the gallery to verify it exists and contains datasets
            logger.info(f"Verifying gallery and fetching datasets: {gallery_id}")
            
            time_lapse_datasets = await artifact_manager_instance._svc.list(parent_id=gallery_id)
            
            if not time_lapse_datasets or len(time_lapse_datasets) == 0:
                logger.warning(f"Gallery {gallery_id} contains no datasets.")
                return {
                    "success": False,
                    "message": f"Gallery {gallery_id} exists but contains no time-lapse datasets."
                }
            
            # Gallery exists and contains datasets
            dataset_count = len(time_lapse_datasets)
            logger.info(f"Gallery {gallery_id} successfully verified with {dataset_count} datasets.")
            
            return {
                "success": True,
                "message": f"Gallery contains {dataset_count} time-lapse datasets ready for map viewing",
                "gallery_id": gallery_id,
                "dataset_count": dataset_count
            }
            
        except Exception as e:
            logger.error(f"Error setting up gallery map: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return {
                "success": False,
                "message": f"Error setting up gallery map: {str(e)}"
            }

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
    
    # Only register service health probes when not running locally and not in VSCode connect-server mode
    # Docker mode should register probes
    if not is_local and (is_docker or not is_connect_server):
        await register_service_probes(server, server_id)

    # Store the cleanup function in the server's config
    server.config["cleanup"] = tile_manager.close
 