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
# See if we have WebP support in PIL
WEBP_SUPPORT = True
try:
    test_img = Image.new('RGB', (16, 16))
    test_buffer = io.BytesIO()
    test_img.save(test_buffer, format="WEBP")
except Exception:
    WEBP_SUPPORT = False
    print("WebP support not available in PIL, falling back to PNG")

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
ARTIFACT_ALIAS = "agent-lens/image-map-20250429-treatment-zip"  # Removed duplicate prefix
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
        # Record start time and initial metrics
        start_time = time.time()
        
        # Track the approximate request size
        request_size = 0
        body = await request.body()
        request_size = len(body)
        
        # Execute the request handler
        response = await call_next(request)
        
        # Calculate processing time
        process_time = time.time() - start_time
        
        # Add processing time header to help with debugging
        response.headers["X-Process-Time"] = f"{process_time:.4f}"
        
        # Add standard cache control headers to all responses
        if not response.headers.get("Cache-Control") and request.url.path.startswith(("/assets", "/public")):
            response.headers["Cache-Control"] = "public, max-age=86400"  # 24 hours for static assets
        
        # For specific API endpoints, add metrics logging
        if request.url.path.startswith(("/tile", "/merged-tiles", "/tile-for-timepoint")):
            path_parts = request.url.path.split("?")[0].split("/")
            endpoint = path_parts[-1] if path_parts else "unknown"
            
            # Log metrics for monitoring
            logger.info(
                f"METRICS: endpoint={endpoint} method={request.method} "
                f"path={request.url.path} processing_time={process_time:.4f}s "
                f"request_size={request_size} response_status={response.status_code}"
            )
        
        return response

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
        dataset_id: str = ARTIFACT_ALIAS,
        timestamp: str = "2025-04-29_16-38-27",  # Default timestamp folder
        # New parameters for image processing settings
        contrast_settings: str = None,
        brightness_settings: str = None,
        threshold_settings: str = None,
        color_settings: str = None,
        priority: int = 10  # Default priority (lower is higher priority)
    ):
        """
        Endpoint to serve tiles with customizable image processing settings.
        Now uses Zarr-based tile access for better performance.
        
        Args:
            channel_name (str): The channel name to retrieve
            z (int): Zoom level
            x (int): X coordinate
            y (int): Y coordinate
            dataset_id (str): The dataset ID (defaults to global ARTIFACT_ALIAS)
            timestamp (str): The timestamp folder name (defaults to "2025-04-29_16-38-27")
            contrast_settings (str, optional): JSON string with contrast settings
            brightness_settings (str, optional): JSON string with brightness settings
            threshold_settings (str, optional): JSON string with min/max threshold settings
            color_settings (str, optional): JSON string with color settings
            priority (int, optional): Priority level for tile loading (lower is higher priority)
        
        Returns:
            str: Base64 encoded tile image
        """
        import json
        
        try:
            start_time = time.time()
            request_id = hashlib.md5(f"{time.time()}-{channel_name}-{x}-{y}".encode()).hexdigest()[:8]
            
            # Queue the tile request with the specified priority
            # This allows the frontend to prioritize visible tiles
            await tile_manager.request_tile(dataset_id, timestamp, channel_name, z, x, y, priority)
            
            # Get the raw tile data as numpy array using ZarrTileManager
            # ZarrTileManager will handle URL expiration internally
            tile_data = await tile_manager.get_tile_np_data(dataset_id, timestamp, channel_name, z, x, y)
            
            # If tile_data is None, return an empty response to let the client handle it
            if tile_data is None:
                logger.info(f"No tile data available for {dataset_id}:{timestamp}:{channel_name}:{z}:{x}:{y}")
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
                        
                        # Apply thresholds using custom percentiles, but only if thresholds are set
                        if channel_key in threshold_dict:
                            p_min, p_max = np.percentile(adjusted, (threshold_min, threshold_max))
                            enhanced = exposure.rescale_intensity(adjusted, in_range=(p_min, p_max))
                        else:
                            enhanced = adjusted
                        
                        # Ensure contrast is within safe range (0-0.1)
                        safe_contrast = min(0.1, contrast)
                        
                        # Apply contrast adjustment using CLAHE
                        enhanced = exposure.equalize_adapthist(enhanced, clip_limit=safe_contrast)
                        enhanced = util.img_as_ubyte(enhanced)
                    else:
                        enhanced = adjusted
                    
                    # If a color is specified for fluorescence channels
                    if channel_key != '0' and channel_key in color_dict:
                        color = tuple(color_dict[channel_key])
                        
                        # Create an RGB image
                        rgb_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.uint8)
                        
                        # Apply the color to each channel - using the enhanced image
                        rgb_image[..., 0] = enhanced * (color[0] / 255.0)  # R
                        rgb_image[..., 1] = enhanced * (color[1] / 255.0)  # G
                        rgb_image[..., 2] = enhanced * (color[2] / 255.0)  # B
                        
                        # Convert to PIL image
                        pil_image = Image.fromarray(rgb_image)
                    else:
                        # For grayscale, just use the enhanced image
                        pil_image = Image.fromarray(enhanced)
            else:
                # If no processing applied, convert directly to PIL image
                pil_image = Image.fromarray(tile_data)
            
            # Cache key for ETag (use multiple criteria to avoid conflicts)
            cache_tag = f"{dataset_id}:{timestamp}:{channel_name}:{z}:{x}:{y}"
            if contrast_settings:
                cache_tag += f":{hashlib.md5(contrast_settings.encode()).hexdigest()[:6]}"
            if brightness_settings:
                cache_tag += f":{hashlib.md5(brightness_settings.encode()).hexdigest()[:6]}"
            
            # Generate ETag based on multiple factors
            etag = hashlib.md5(cache_tag.encode()).hexdigest()
            
            # Convert to base64
            buffer = io.BytesIO()
            if WEBP_SUPPORT:
                pil_image.save(buffer, format="WEBP", quality=85)
            else:
                pil_image.save(buffer, format="PNG", optimize=True)
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
            response.headers["X-Image-Format"] = "webp" if WEBP_SUPPORT else "png"
            response.headers["X-Request-ID"] = request_id
            response.headers["X-Processing-Time"] = f"{processing_time:.4f}"
            return response
            
        except Exception as e:
            logger.error(f"Error in tile_endpoint: {e}")
            blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
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
        dataset_id: str = ARTIFACT_ALIAS, 
        timepoint: str = "2025-04-29_16-38-27",
        # New parameters for image processing settings
        contrast_settings: str = None,
        brightness_settings: str = None,
        threshold_settings: str = None,
        color_settings: str = None,
        priority: int = 10  # Default priority (lower is higher priority)
    ):
        """
        Endpoint to merge tiles from multiple channels with customizable image processing settings.
        Now uses Zarr-based tile access for better performance.
        
        Args:
            channels (str): Comma-separated list of channel keys (e.g., "0,11,12")
            z (int): Zoom level
            x (int): X coordinate
            y (int): Y coordinate
            dataset_id (str, optional): Dataset ID
            timepoint (str, optional): Timepoint/timestamp folder name
            contrast_settings (str, optional): JSON string with contrast settings for each channel
            brightness_settings (str, optional): JSON string with brightness settings for each channel
            threshold_settings (str, optional): JSON string with min/max threshold settings for each channel
            color_settings (str, optional): JSON string with color settings for each channel
            priority (int, optional): Priority level for tile loading (lower is higher priority)
        
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
        
        # Get tiles for each channel using ZarrTileManager
        channel_tiles = []
        missing_tiles = 0
        
        for channel_key in channel_keys:
            channel_name = channel_names.get(channel_key, DEFAULT_CHANNEL)
            
            try:
                # Queue the tile request with the specified priority
                # This allows the frontend to prioritize visible tiles
                await tile_manager.request_tile(dataset_id, timepoint, channel_name, z, x, y, priority)
                
                # Get tile from Zarr store - ZarrTileManager will handle URL expiration internally
                tile_data = await tile_manager.get_tile_np_data(dataset_id, timepoint, channel_name, z, x, y)
                
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
            logger.info(f"No tiles available for any channels at {dataset_id}:{timepoint}:{channels}:{z}:{x}:{y}")
            response = Response(status_code=204)
            response.headers["X-Empty-Tile"] = "true"
            return response
        
        # Create an RGB image to merge the channels
        merged_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.float32)
        
        # Check if brightfield channel is included
        has_brightfield = 0 in [ch_key for _, ch_key in channel_tiles]
        
        # If using default settings and has brightfield, start with that
        if not has_custom_settings and has_brightfield:
            # Find the brightfield data
            for tile_data, channel_key in channel_tiles:
                if channel_key == 0:
                    # Create RGB by copying the original grayscale data to all channels
                    bf_data = tile_data.astype(np.float32) / 255.0  # Normalize to 0-1
                    merged_image = np.stack([bf_data, bf_data, bf_data], axis=2)
            
            # Add original fluorescence channels with default colors
            for tile_data, channel_key in channel_tiles:
                if channel_key != 0:  # Skip brightfield
                    color = default_channel_colors.get(channel_key)
                    if color:
                        # Normalize the data
                        normalized = tile_data.astype(np.float32) / 255.0
                        
                        # Create color overlay
                        colored_channel = np.zeros_like(merged_image)
                        colored_channel[..., 0] = normalized * (color[0] / 255.0)  # R
                        colored_channel[..., 1] = normalized * (color[1] / 255.0)  # G
                        colored_channel[..., 2] = normalized * (color[2] / 255.0)  # B
                        
                        # Screen blend mode for better visibility
                        merged_image = 1.0 - (1.0 - merged_image) * (1.0 - colored_channel)
            logger.info(f"Merged image, all channels: {channel_tiles}")
            # Convert back to 8-bit for display
            merged_image = util.img_as_ubyte(merged_image)
        else:
            # Apply custom settings to each channel
            for tile_data, channel_key in channel_tiles:
                # Apply image processing based on settings for this channel
                channel_key_str = str(channel_key)
                
                # Get channel-specific settings with defaults
                contrast = float(contrast_dict.get(channel_key_str, 0))  # Default CLAHE clip limit
                brightness = float(brightness_dict.get(channel_key_str, 1.0))  # Default brightness multiplier
                
                # Ensure values are within safe ranges
                safe_contrast = max(0.01, min(0.06, contrast))
                safe_brightness = max(0.5, min(2.0, brightness))
                
                # Apply brightness adjustment first (to original values)
                adjusted = tile_data.astype(np.float32) * safe_brightness
                adjusted = np.clip(adjusted, 0, 255).astype(np.uint8)
                
                # Threshold settings (percentiles by default)
                threshold_min = float(threshold_dict.get(channel_key_str, {}).get("min", 2))
                threshold_max = float(threshold_dict.get(channel_key_str, {}).get("max", 98))
                
                # Color settings (RGB tuple)
                if channel_key_str in color_dict:
                    color = tuple(color_dict[channel_key_str])
                else:
                    color = default_channel_colors.get(channel_key)
                
                if channel_key == 0:  # Brightfield
                    # For brightfield, apply contrast stretching and use as base layer
                    if len(tile_data.shape) == 2:
                        # Apply contrast enhancement only if requested
                        if float(contrast) > 0:  # Only apply when contrast value is positive
                            # If custom thresholds provided
                            if channel_key_str in threshold_dict:
                                p_min, p_max = np.percentile(adjusted, (threshold_min, threshold_max))
                                enhanced = exposure.rescale_intensity(adjusted, in_range=(p_min, p_max))
                            else:
                                enhanced = adjusted
                            
                            # Apply CLAHE
                            # Ensure contrast is within safe range (0-0.1)
                            safe_contrast = min(0.1, float(contrast))
                            bf_enhanced = exposure.equalize_adapthist(enhanced, clip_limit=safe_contrast)
                        else:
                            # Just normalize to 0-1 for the RGB merge
                            bf_enhanced = adjusted.astype(np.float32) / 255.0
                        
                        # Create RGB by copying the enhanced grayscale data to all channels
                        if float(contrast) > 0:  # Only apply when contrast value is positive
                            # Convert to 0-1 if CLAHE was applied
                            bf_enhanced = util.img_as_float(bf_enhanced)
                        
                        # Create an RGB version
                        bf_rgb = np.stack([bf_enhanced, bf_enhanced, bf_enhanced], axis=2)
                        merged_image = bf_rgb.copy()
                else:
                    # For fluorescence channels, apply color overlay with enhanced contrast
                    if color and len(tile_data.shape) == 2:
                        # Apply contrast enhancement only if requested
                        if float(contrast) > 0:  # Only apply when contrast value is positive
                            # Apply thresholds using custom percentiles if provided
                            if channel_key_str in threshold_dict:
                                p_min, p_max = np.percentile(adjusted, (threshold_min, threshold_max))
                                fluorescence_enhanced = exposure.rescale_intensity(adjusted, in_range=(p_min, p_max))
                            else:
                                fluorescence_enhanced = adjusted
                            
                            # Apply CLAHE
                            # Ensure contrast is within safe range (0-0.1)
                            safe_contrast = min(0.1, float(contrast))
                            enhanced = exposure.equalize_adapthist(fluorescence_enhanced, clip_limit=safe_contrast)
                            enhanced = util.img_as_ubyte(enhanced)
                        else:
                            # Just normalize to 0-1 for coloring
                            normalized = adjusted.astype(np.float32) / 255.0
                        
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
        if WEBP_SUPPORT:
            pil_image.save(buffer, format="WEBP", quality=85)
        else:
            pil_image.save(buffer, format="PNG", optimize=True)
        img_bytes = buffer.getvalue()
        
        # Generate cache key and ETag
        etag = hashlib.md5(img_bytes).hexdigest()
        base64_data = base64.b64encode(img_bytes).decode('utf-8')
        
        # Create response with caching headers
        response = Response(content=base64_data)
        response.headers["Cache-Control"] = "public, max-age=3600"
        response.headers["ETag"] = etag
        # Add image format header to help client know how to decode
        response.headers["X-Image-Format"] = "webp" if WEBP_SUPPORT else "png"
        return response

    # Updated helper function using ZarrTileManager
    async def get_timepoint_tile_data(dataset_id, timepoint, channel_name, z, x, y):
        """Helper function to get tile data for a specific timepoint using Zarr"""
        try:
            return await tile_manager.get_tile_np_data(dataset_id, timepoint, channel_name, z, x, y)
        except Exception as e:
            logger.error(f"Error fetching timepoint tile data: {e}")
            import traceback
            logger.error(traceback.format_exc())
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
            gallery_id = "agent-lens/image-map-of-u2os-fucci-drug-treatment-zip"
            logger.info(f"Fetching datasets from gallery: {gallery_id}")
            datasets = await artifact_manager_instance._svc.list(parent_id=gallery_id)
            
            # Log the response for debugging
            logger.info(f"Gallery response received, datasets found: {len(datasets) if datasets else 0}")
            
            # Format the response to match the expected keys in the frontend
            formatted_datasets = []
            for dataset in datasets:
                name = dataset.get("manifest", {}).get("name", dataset.get("alias", "Unknown"))
                dataset_id = dataset.get("id")
                logger.info(f"Dataset found: {name} ({dataset_id})")
                formatted_datasets.append({"id": dataset_id, "name": name})
            return formatted_datasets
        except Exception as e:
            logger.error(f"Error fetching datasets: {e}")
            import traceback
            logger.error(traceback.format_exc())
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
        logger.info(f"Fetching contents for dataset: {dataset_id}, dir_path: {dir_path}, offset: {offset}, limit: {limit}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get all files and directories in the current path
            all_items = await artifact_manager_instance._svc.list_files(dataset_id, dir_path=dir_path)
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

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file within the dataset.

        Returns:
            dict: A dictionary containing the pre-signed URL for the file.
        """
        logger.info(f"Getting file URL for dataset: {dataset_id}, file_path: {file_path}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get the pre-signed URL for the file
            url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
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

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file within the dataset.

        Returns:
            Response: A redirect to the pre-signed URL for downloading the file.
        """
        logger.info(f"Downloading file from dataset: {dataset_id}, file_path: {file_path}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        try:
            # Get the pre-signed URL for the file
            url = await artifact_manager_instance._svc.get_file(dataset_id, file_path)
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
        Endpoint to setup the image map access for a specific dataset.
        The dataset is already an image map dataset, so we just need to verify it exists.

        Args:
            dataset_id (str): The ID of the dataset to use as an image map.

        Returns:
            dict: A dictionary containing success status and message.
        """
        logger.info(f"Setting up image map for dataset: {dataset_id}")
        # Ensure the artifact manager is connected
        if artifact_manager_instance.server is None:
            _, artifact_manager_instance._svc = await get_artifact_manager()
        
        try:
            # Check if the dataset exists
            try:
                # List files to verify the dataset exists and is accessible
                logger.info(f"Verifying dataset access: {dataset_id}")
                files = await artifact_manager_instance._svc.list_files(dataset_id)
                
                if files is not None:
                    logger.info(f"Image map dataset found: {dataset_id} with {len(files)} files")
                    # Also check for timestamp folders which should exist in the dataset
                    timepoints = [file for file in files if file.get('type') == 'directory']
                    if timepoints:
                        logger.info(f"Found {len(timepoints)} timepoints in dataset: {[tp.get('name') for tp in timepoints]}")
                    else:
                        logger.info(f"Warning: No timepoints (directories) found in dataset: {dataset_id}")
                    
                    return {
                        "success": True, 
                        "message": f"Image map setup successful for {dataset_id}",
                        "dataset_id": dataset_id,
                        "timepoints": len(timepoints) if timepoints else 0
                    }
                else:
                    logger.info(f"Image map dataset not found: {dataset_id}")
                    return {"success": False, "message": f"Image map dataset not found: {dataset_id}"}
            except Exception as e:
                logger.error(f"Error checking dataset: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return {"success": False, "message": f"Error checking image map dataset: {str(e)}"}
        except Exception as e:
            logger.error(f"Error setting up image map: {e}")
            import traceback
            logger.error(traceback.format_exc())
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
        logger.info(f"Listing timepoints for dataset: {dataset_id}")
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
        timepoint: str, 
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
        Endpoint to serve tiles for a specific timepoint from an image map dataset with customizable processing.
        Now uses Zarr-based tile access for better performance.

        Args:
            dataset_id (str): The ID of the image map dataset.
            timepoint (str): The timepoint folder name (e.g., "2025-04-29_16-38-27").
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
        
        logger.info(f"Fetching tile for timepoint: {timepoint}, z={z}, x={x}, y={y}")
        
        try:
            # Queue the tile request with the specified priority
            # This allows the frontend to prioritize visible tiles
            await tile_manager.request_tile(dataset_id, timepoint, channel_name, z, x, y, priority)
            
            # Get the tile data using ZarrTileManager - URL expiration handled internally
            tile_data = await tile_manager.get_tile_np_data(dataset_id, timepoint, channel_name, z, x, y)
            
            # If no tile data is available, return an empty response
            if tile_data is None:
                logger.info(f"No tile data available for {dataset_id}:{timepoint}:{channel_name}:{z}:{x}:{y}")
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
                        
                        # Apply thresholds using custom percentiles, but only if thresholds are set
                        if channel_key in threshold_dict:
                            p_min, p_max = np.percentile(adjusted, (threshold_min, threshold_max))
                            enhanced = exposure.rescale_intensity(adjusted, in_range=(p_min, p_max))
                        else:
                            enhanced = adjusted
                        
                        # Ensure contrast is within safe range (0-0.1)
                        safe_contrast = min(0.1, contrast)
                        
                        # Apply contrast adjustment using CLAHE
                        enhanced = exposure.equalize_adapthist(enhanced, clip_limit=safe_contrast)
                        enhanced = util.img_as_ubyte(enhanced)
                    else:
                        enhanced = adjusted
                    
                    # If a color is specified for fluorescence channels
                    if channel_key != '0' and channel_key in color_dict:
                        color = tuple(color_dict[channel_key])
                        
                        # Create an RGB image
                        rgb_image = np.zeros((tile_manager.tile_size, tile_manager.tile_size, 3), dtype=np.uint8)
                        
                        # Apply the color to each channel - using the enhanced image
                        rgb_image[..., 0] = enhanced * (color[0] / 255.0)  # R
                        rgb_image[..., 1] = enhanced * (color[1] / 255.0)  # G
                        rgb_image[..., 2] = enhanced * (color[2] / 255.0)  # B
                        
                        # Convert to PIL image
                        pil_image = Image.fromarray(rgb_image)
                    else:
                        # For grayscale, just use the enhanced image
                        pil_image = Image.fromarray(enhanced)
            else:
                # If no processing applied, convert directly to PIL image
                pil_image = Image.fromarray(tile_data)
            
            # Convert to base64
            buffer = io.BytesIO()
            if WEBP_SUPPORT:
                pil_image.save(buffer, format="WEBP", quality=85)
            else:
                pil_image.save(buffer, format="PNG", optimize=True)
            img_bytes = buffer.getvalue()
            
            # Generate cache key and ETag
            etag = hashlib.md5(img_bytes).hexdigest()
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=3600"
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "webp" if WEBP_SUPPORT else "png"
            return response
                
        except Exception as e:
            logger.error(f"Error fetching tile for timepoint: {e}")
            import traceback
            logger.error(traceback.format_exc())
            blank_image = Image.new("L", (tile_manager.tile_size, tile_manager.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
            img_bytes = buffer.getvalue()
            
            # Generate cache key and ETag
            etag = hashlib.md5(img_bytes).hexdigest()
            base64_data = base64.b64encode(img_bytes).decode('utf-8')
            
            # Create response with caching headers
            response = Response(content=base64_data)
            response.headers["Cache-Control"] = "public, max-age=3600"
            response.headers["ETag"] = etag
            # Add image format header to help client know how to decode
            response.headers["X-Image-Format"] = "webp" if WEBP_SUPPORT else "png"
            return response

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
        try:
            # Check artifact manager connection
            if artifact_manager_instance.server is None:
                api_server, artifact_manager = await get_artifact_manager()
                await artifact_manager_instance.connect_server(api_server)
                logger.info("Connected to artifact manager for health check")
            
            # Test artifact manager functionality by listing a gallery
            # Using a known gallery ID from the application
            gallery_id = "agent-lens/microscopy-data"
            datasets = await artifact_manager_instance._svc.list(parent_id=gallery_id)
            
            if datasets is None:
                raise RuntimeError(f"Failed to list datasets from gallery {gallery_id}")
            
            # Check if we got any datasets back (should be a list, even if empty)
            if not isinstance(datasets, list):
                raise RuntimeError(f"Unexpected response format from artifact manager: {type(datasets)}")
            
            # Also check ZarrTileManager connection status
            if not tile_manager.artifact_manager or not tile_manager.artifact_manager_server:
                raise RuntimeError("ZarrTileManager is not properly connected")
            
            # Use the new test_zarr_access method to verify Zarr file access
            try:
                # Set a timeout for the test to prevent the health check from hanging
                test_result = await asyncio.wait_for(
                    tile_manager.test_zarr_access(), 
                    timeout=50  # 50 second timeout
                )
                
                if not test_result.get("success", False):
                    error_msg = test_result.get("message", "Unknown error")
                    logger.error(f"Zarr access test failed: {error_msg}")
                    raise RuntimeError(f"Zarr access test failed: {error_msg}")
                else:
                    # Log successful test with some stats
                    stats = test_result.get("chunk_stats", {})
                    non_zero = stats.get("non_zero_count", 0)
                    total = stats.get("total_size", 1)
                    logger.info(f"Zarr access test succeeded. Non-zero values: {non_zero}/{total} ({(non_zero/total)*100:.1f}%)")
            except asyncio.TimeoutError:
                logger.error("Zarr access test timed out after 30 seconds")
                raise RuntimeError("Zarr access test timed out")
            except Exception as zarr_error:
                logger.error(f"Zarr access test failed: {zarr_error}")
                raise RuntimeError(f"Zarr access test failed: {str(zarr_error)}")
            
            logger.info("All services are healthy")
            return {"status": "ok", "message": "All services are healthy"}
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
    # Always use "agent-lens" as the service ID for consistency with frontend
    # DO NOT modify server_id here to keep frontend compatibility
    
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
    is_local = "--port" in " ".join(sys.argv) or "start-server" in " ".join(sys.argv)
    
    # Only register service health probes when not running locally
    if not is_local:
        await register_service_probes(server, server_id)

    # Store the cleanup function in the server's config
    server.config["cleanup"] = tile_manager.close
 