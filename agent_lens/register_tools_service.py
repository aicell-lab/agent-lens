"""
This module provides functionality for registering the agent-lens-tools service
that handles AI/ML operations including embeddings, segmentation, and cell analysis.
"""

import os
from typing import List, Optional, Dict, Any, Tuple
import numpy as np
import sys
import traceback
import asyncio
import base64
import uuid
from agent_lens.utils.chroma_storage import chroma_storage
from hypha_rpc.utils.schema import schema_function
from PIL import Image as PILImage
from io import BytesIO
import io

# Configure logging
from .log import setup_logging

logger = setup_logging("agent_lens_tools_service.log")

SERVER_URL = "https://hypha.aicell.io"

# Color map for multi-channel fluorescence composite visualization
COLOR_MAP = {
    "0": (1.0, 1.0, 1.0),  # BF: gray
    "1": (0.0, 0.0, 1.0),  # 405nm: blue
    "2": (0.0, 1.0, 0.0),  # 488nm: green
    "3": (1.0, 0.0, 0.0),  # 638nm: red
    "4": (1.0, 1.0, 0.0),  # 561nm: yellow
}

def overlay(
    image_channels: List[Optional[np.ndarray]], 
    color_map: Optional[Dict[str, Tuple[float, float, float]]] = None
) -> np.ndarray:
    """
    Create RGB composite from sparse channel list using additive color blending.
    
    Args:
        image_channels: List of channel arrays (can include None for missing channels)
        color_map: Optional custom color map indexed by channel number as string.
                  Format: {channel_idx_str: (R, G, B)} where RGB values are in 0.0-1.0 range.
                  If not provided, uses default COLOR_MAP.
    
    Returns:
        RGB composite image as uint8 array (H, W, 3)
    """
    first = next((ch for ch in image_channels if ch is not None), None)
    if first is None:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    
    H, W = first.shape[:2]
    
    rgb_composite = np.zeros((H, W, 3), dtype=np.float64)
    
    # Use custom color_map if provided, otherwise use default COLOR_MAP
    active_color_map = color_map if color_map is not None else COLOR_MAP
    
    for channel_idx_str, (r, g, b) in active_color_map.items():
        channel_idx = int(channel_idx_str)
        ch = image_channels[channel_idx] if channel_idx < len(image_channels) else None
        if ch is None:
            continue
        channel_data = ch.astype(np.float64)
        max_val = channel_data.max()
        if max_val > 0:
            channel_data = channel_data / max_val
        
        rgb_composite[:, :, 0] += channel_data * r
        rgb_composite[:, :, 1] += channel_data * g
        rgb_composite[:, :, 2] += channel_data * b
    
    if rgb_composite.max() > 0:
        rgb_composite = (rgb_composite / rgb_composite.max() * 255).astype(np.uint8)
    else:
        rgb_composite = rgb_composite.astype(np.uint8)
    
    return rgb_composite

async def preload_embedding_models():
    """
    Preload CLIP and DINOv2 models for faster startup.
    This is called during service initialization.
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


async def setup_service(server, server_id="agent-lens-tools"):
    """
    Set up the agent-lens-tools service.
    
    Args:
        server (Server): The Hypha server instance.
        server_id (str): Service identifier.
    """
    # Get command line arguments
    cmd_args = " ".join(sys.argv)
    
    # Check if we're in connect-server mode and not in docker mode
    is_connect_server = "connect-server" in cmd_args
    is_docker = "--docker" in cmd_args
    
    # Use 'agent-lens-tools-test' as service_id only when using connect-server in VSCode (not in docker)
    if is_connect_server and not is_docker:
        server_id = "agent-lens-tools-test"
    
    # Preload embedding models for faster startup
    logger.info("Preloading embedding models...")
    await preload_embedding_models()
    
    # Get API server for microscope connections
    api_server = server
    
    # Connect to Cellpose segmentation service
    segmentation_service = await api_server.get_service("agent-lens/cell-segmenter")
    logger.info("Connected to Cellpose segmentation service.")

    # Background queues: segmentation -> build_cell_records
    segment_queue: asyncio.Queue = asyncio.Queue()
    build_queue: asyncio.Queue = asyncio.Queue()
    segment_and_extract_results: List[List[Dict[str, Any]]] = []
    segment_and_extract_idle = asyncio.Event()
    segment_and_extract_idle.set()
    
    # Background queue for snap (server-side acquisition)
    snap_queue: asyncio.Queue = asyncio.Queue()
    snap_worker_busy = asyncio.Event()
    snap_worker_busy.clear()  # Initially not busy
    microscope_service_cache: Dict[str, Any] = {}

    # Helper function for segmentation
    async def _segment_image_from_channel(channel_data: np.ndarray, scale: int = 8) -> np.ndarray:
        """
        Segment from a single channel or RGB composite.
        
        Args:
            channel_data: 2D numpy array (H, W) for grayscale or 3D array (H, W, 3) for RGB
            scale: Downscaling factor for segmentation
            
        Returns:
            Segmentation mask with same dimensions as input
        """
        if channel_data is None:
            raise ValueError("Channel data is None")
        
        # Ensure contiguous array
        channel_data = np.ascontiguousarray(channel_data)
        original_shape = channel_data.shape[:2]  # Store (H, W) for later upscaling
        
        # Convert to uint8 if needed
        if channel_data.dtype != np.uint8:
            max_val = channel_data.max()
            if max_val > 255:
                channel_data = (channel_data / max_val * 255).astype(np.uint8)
            else:
                channel_data = channel_data.astype(np.uint8)
        
        # Create PIL image (automatically detects grayscale vs RGB from array shape)
        pil_image = PILImage.fromarray(channel_data)
        
        # Downscale if needed
        if scale > 1:
            new_size = (original_shape[1] // scale, original_shape[0] // scale)  # PIL uses (W, H)
            pil_image = pil_image.resize(new_size, PILImage.BILINEAR)
        
        # Convert to PNG base64 for segmentation service
        buffer = BytesIO()
        pil_image.save(buffer, format="PNG")
        image_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        
        # Run segmentation
        segmentation_result = await segmentation_service.segment_all(image_base64)
        mask = segmentation_result["mask"] if isinstance(segmentation_result, dict) else segmentation_result
        
        # Upscale mask back to original size if needed
        if scale > 1:
            mask_np = np.array(mask, dtype=np.uint16)
            mask_pil = PILImage.fromarray(mask_np)
            mask_upscaled = mask_pil.resize((original_shape[1], original_shape[0]), PILImage.NEAREST)
            return np.array(mask_upscaled)
        
        return np.array(mask)

    async def _segment_image_from_bf(
        image_data: Any,
        scale: int = 8,
        color_map: Optional[Dict[str, Tuple[float, float, float]]] = None,
    ) -> np.ndarray:
        """
        Segment cells from image: BF (channel 0) if present and valid; otherwise use overlay composite.
        Accepts:
          - image_data as np.ndarray (H,W,C) or (H,W)
          - or list/tuple of channels (can include None)
          - color_map: Optional custom color map for overlay composite
        """
        # Convert to channel list (preserve indices including None)
        if isinstance(image_data, (list, tuple)):
            chans = list(image_data)
        else:
            arr = np.asarray(image_data)
            if arr.ndim == 2:
                chans = [arr]
            else:
                chans = [arr[:, :, i] for i in range(arr.shape[2])]
        
        # Try to use brightfield (channel 0) if valid
        bf = chans[0] if len(chans) > 0 else None
        if bf is not None and np.nanstd(bf) > 1e-6:
            # Brightfield is valid, use it as grayscale
            gray_u8 = bf
            if gray_u8.dtype != np.uint8:
                g = gray_u8.astype(np.float32)
                g = (g - np.nanmin(g)) / (np.nanmax(g) - np.nanmin(g) + 1e-12) * 255.0
                gray_u8 = np.clip(g, 0, 255).astype(np.uint8)
            segment_input = gray_u8
        else:
            # Brightfield is None or has no variation, use RGB overlay composite
            # RGB is better for Cellpose with fluorescence data (preserves multi-channel info)
            logger.info("Brightfield channel unavailable or has no variation, using RGB overlay composite for segmentation")
            rgb_composite = overlay(chans, color_map=color_map)  # (H,W,3) uint8
            segment_input = rgb_composite  # Send RGB directly to Cellpose
        
        # Delegate to generic channel segmentation function
        return await _segment_image_from_channel(segment_input, scale=scale)

    # Background worker functions
    async def _segment_worker():
        """Background worker to segment images and enqueue for build."""
        while True:
            job = await segment_queue.get()
            segment_and_extract_idle.clear()
            try:
                image_data = job["image_data"]
                microscope_status = job.get("microscope_status")
                application_id = job.get("application_id", "hypha-agents-notebook")
                scale = job.get("scale", 8)
                nucleus_channel_idx = job.get("nucleus_channel_idx")
                color_map = job.get("color_map")
                
                # Always segment cells from BF (channel 0)
                cell_mask = await _segment_image_from_bf(image_data, scale=scale, color_map=color_map)
                
                # Optionally segment nuclei from specified channel
                if nucleus_channel_idx is not None:
                    # Extract nucleus channel
                    if isinstance(image_data, (list, tuple)):
                        nucleus_channel = image_data[nucleus_channel_idx] if nucleus_channel_idx < len(image_data) else None
                    elif isinstance(image_data, np.ndarray) and image_data.ndim == 3:
                        nucleus_channel = image_data[:, :, nucleus_channel_idx] if nucleus_channel_idx < image_data.shape[2] else None
                    else:
                        nucleus_channel = None
                    
                    if nucleus_channel is not None and nucleus_channel.max() > 0:
                        # Segment nucleus channel
                        nucleus_mask = await _segment_image_from_channel(nucleus_channel, scale=scale)
                        # Pass as list: [cell_mask, nucleus_mask]
                        segmentation_mask = [cell_mask, nucleus_mask]
                    else:
                        # Nucleus channel empty or invalid, fall back to cell mask only
                        print(f"Warning: Nucleus channel {nucleus_channel_idx} is empty or invalid, using cell mask only")
                        segmentation_mask = cell_mask
                else:
                    # No nucleus segmentation requested
                    segmentation_mask = cell_mask
                
                await build_queue.put(
                    {
                        "image_data": image_data,
                        "segmentation_mask": segmentation_mask,
                        "microscope_status": microscope_status,
                        "application_id": application_id,
                        "color_map": color_map,
                    }
                )
            except Exception as e:
                logger.error(f"segment worker failed: {e}", exc_info=True)
            finally:
                segment_queue.task_done()
                if segment_queue.empty() and build_queue.empty():
                    segment_and_extract_idle.set()

    async def _build_worker():
        """Background worker to run build_cell_records."""
        while True:
            job = await build_queue.get()
            segment_and_extract_idle.clear()
            try:
                records = await build_cell_records(
                    image_data_np=job["image_data"],
                    segmentation_mask=job["segmentation_mask"],
                    microscope_status=job.get("microscope_status"),
                    application_id=job.get("application_id", "hypha-agents-notebook"),
                    color_map=job.get("color_map"),
                )
                segment_and_extract_results.extend(records)
            except Exception as e:
                logger.error(f"build worker failed: {e}", exc_info=True)
            finally:
                build_queue.task_done()
                if segment_queue.empty() and build_queue.empty():
                    segment_and_extract_idle.set()

    # Start background workers
    asyncio.create_task(_segment_worker())
    asyncio.create_task(_build_worker())
    
    # Fixed channel order for microscopy
    fixed_channel_order = ['BF_LED_matrix_full', 'Fluorescence_405_nm_Ex', 'Fluorescence_488_nm_Ex', 'Fluorescence_638_nm_Ex', 'Fluorescence_561_nm_Ex', 'Fluorescence_730_nm_Ex']

    def _channel_name_to_key(channel_name: str) -> str:
        """Convert a full channel name to a short metadata key.

        Examples:
            'BF_LED_matrix_full'     -> 'BF'
            'Fluorescence_405_nm_Ex' -> '405'
        """
        if channel_name == 'BF_LED_matrix_full':
            return 'BF'
        if channel_name.startswith('Fluorescence_') and '_nm_Ex' in channel_name:
            return channel_name.split('_')[1]  # e.g. '405'
        return channel_name.replace(' ', '_').replace('-', '_')

    # Standard microscopy channel colors (matching frontend CHANNEL_COLORS)
    CHANNEL_COLOR_MAP = {
        'BF_LED_matrix_full': (255, 255, 255),      # White
        'Fluorescence_405_nm_Ex': (0, 0, 255),      # Blue (DAPI)
        'Fluorescence_488_nm_Ex': (0, 255, 0),      # Green (FITC/GFP)
        'Fluorescence_561_nm_Ex': (255, 0, 0),      # Red (TRITC/mCherry)
        'Fluorescence_638_nm_Ex': (255, 0, 255),    # Magenta (Cy5)
        'Fluorescence_730_nm_Ex': (0, 255, 255),    # Cyan (far-red/NIR)
    }
    
    async def _snap_segment_extract_worker():
        """Background worker to move stage, snap images, then enqueue for segment+extract."""
        while True:
            job = await snap_queue.get()
            snap_worker_busy.set()  # Mark as busy
            try:
                microscope_id = job["microscope_id"]
                channel_config = job["channel_config"]
                application_id = job.get("application_id", "hypha-agents-notebook")
                scale = job.get("scale", 8)
                positions = job.get("positions")
                wells = job.get("wells")
                well_offset = job.get("well_offset")
                well_plate_type = job.get("well_plate_type", "96")
                nucleus_channel_idx = job.get("nucleus_channel_idx")
                color_map = job.get("color_map")
                
                microscope = microscope_service_cache.get(microscope_id)
                if microscope is None:
                    microscope = await api_server.get_service(microscope_id)
                    microscope_service_cache[microscope_id] = microscope
                
                # Determine which mode to use
                if wells is not None:
                    # NEW MODE: Well grid scanning
                    # Parse well IDs and navigate to each well, then apply offsets
                    for well_id in wells:
                        # Parse well_id (e.g., "A1" -> row="A", col=1)
                        row = well_id[0]  # First character is the row letter
                        col = int(well_id[1:])  # Remaining characters are the column number
                        
                        # Navigate to the well center
                        await microscope.navigate_to_well(
                            row=row, 
                            col=col, 
                            well_plate_type=well_plate_type
                        )
                        
                        # Autofocus at well center
                        await microscope.reflection_autofocus()
                        
                        # Get base position for this well
                        status = await microscope.get_status()
                        base_x = status["current_x"]
                        base_y = status["current_y"]
                        base_z = status["current_z"]
                        
                        # Scan grid positions within this well
                        for offset in well_offset:
                            if isinstance(offset, dict):
                                dx = offset.get("dx", 0)
                                dy = offset.get("dy", 0)
                            else:
                                # Hypha-RPC may deserialize Dict[str, float] as a list [dx, dy]
                                dx = offset[0] if len(offset) > 0 else 0
                                dy = offset[1] if len(offset) > 1 else 0
                            target_x = base_x + dx
                            target_y = base_y + dy
                            
                            # Move to grid position (only if offset is non-zero)
                            if dx != 0 or dy != 0:
                                await microscope.move_to_position(
                                    x=target_x,
                                    y=target_y,
                                    z=base_z
                                )
                            
                            # Snap channels into sparse list
                            channel_to_idx = {ch: idx for idx, ch in enumerate(fixed_channel_order)}
                            channels: List[Optional[np.ndarray]] = [None] * len(fixed_channel_order)
                            
                            for config in channel_config:
                                channel_name = config["channel"]
                                channel_idx = channel_to_idx[channel_name]
                                exposure_time = config["exposure_time"]
                                intensity = config["intensity"]
                                
                                image_np = await microscope.snap(
                                    channel=channel_name,
                                    exposure_time=exposure_time,
                                    intensity=intensity,
                                    return_array=True
                                )
                                channels[channel_idx] = image_np
                            
                            # Get current status for metadata
                            status = await microscope.get_status()
                            
                            # Enqueue for segmentation + extraction
                            await segment_queue.put(
                                {
                                    "image_data": channels,
                                    "microscope_status": status,
                                    "application_id": application_id,
                                    "scale": scale,
                                    "nucleus_channel_idx": nucleus_channel_idx,
                                    "color_map": color_map,
                                }
                            )
                else:
                    # LEGACY MODE: Absolute position list
                    # Default: single snap at current position
                    if not positions:
                        positions = [None]
                    
                    for pos in positions:
                        if pos is not None:
                            await microscope.move_to_position(
                                x=pos["x"],
                                y=pos["y"],
                                z=pos.get("z")
                            )
                        # Autofocus
                        await microscope.reflection_autofocus()
                        # Snap channels into sparse list
                        channel_to_idx = {ch: idx for idx, ch in enumerate(fixed_channel_order)}
                        channels: List[Optional[np.ndarray]] = [None] * len(fixed_channel_order)
                        
                        for config in channel_config:
                            channel_name = config["channel"]
                            channel_idx = channel_to_idx[channel_name]
                            exposure_time = config["exposure_time"]
                            intensity = config["intensity"]
                            
                            image_np = await microscope.snap(
                                channel=channel_name,
                                exposure_time=exposure_time,
                                intensity=intensity,
                                return_array=True
                            )
                            channels[channel_idx] = image_np
                        
                        status = await microscope.get_status()
                        # Enqueue for segmentation + extraction
                        await segment_queue.put(
                            {
                                "image_data": channels,
                                "microscope_status": status,
                                "application_id": application_id,
                                "scale": scale,
                                "nucleus_channel_idx": nucleus_channel_idx,
                                "color_map": color_map,
                            }
                        )
            except Exception as e:
                logger.error(f"snap_segment_extract worker failed: {e}", exc_info=True)
            finally:
                snap_queue.task_done()
                snap_worker_busy.clear()  # Mark as not busy
    
    # Start snap+segment+extract worker
    asyncio.create_task(_snap_segment_extract_worker())

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

    # Helper function to resize and pad cell images
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

    def _convert_mask_to_array(mask_input: Any) -> Optional[np.ndarray]:
        """
        Convert mask input (base64 string or array) to numpy array.
        
        Args:
            mask_input: Mask as base64 string, numpy array, or None
            
        Returns:
            Numpy array with dtype uint32, or None if input is None
        """
        if mask_input is None:
            return None
        if isinstance(mask_input, str):
            mask_bytes = base64.b64decode(mask_input)
            mask_img = PILImage.open(io.BytesIO(mask_bytes))
            return np.array(mask_img).astype(np.uint32)
        else:
            return mask_input.astype(np.uint32)

    def _process_single_cell(
        prop: Any,  # RegionProperties object from skimage.measure.regionprops
        poly_index: int,
        image_data_np: np.ndarray,
        mask: np.ndarray,
        nucleus_mask: Optional[np.ndarray],  # NEW: Optional nucleus mask
        brightfield: np.ndarray,
        fixed_channel_order: List[str],
        background_bright_value: float,
        background_fluorescence: Dict[int, float],
        position_info: Optional[Dict[str, Any]] = None,
        color_map: Optional[Dict[int, Tuple[int, int, int]]] = None,
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
            
            # Extract nucleus and cytosol masks if nucleus_mask is provided
            if nucleus_mask is not None:
                nucleus_region = (nucleus_mask == mask_label).astype(np.uint8)
                # Cytosol = cell - nucleus
                cytosol_region = np.maximum(cell_mask - nucleus_region, 0).astype(np.uint8)
            else:
                nucleus_region = None
                cytosol_region = None
            
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
            channel_images = {}  # channel_idx -> uint8 RGB array for per-channel thumbnail storage

            # Process brightfield (channel 0) - only if it has signal
            if image_data_np.ndim == 3:
                bf_channel = image_data_np[:, :, 0]
            else:
                bf_channel = image_data_np
            
            # Check if brightfield channel has signal (not None and not all zeros)
            has_brightfield = bf_channel is not None and np.any(bf_channel > 0)
            
            if has_brightfield:
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
                if color_map is not None and 0 in color_map:
                    # Use custom color map for channel 0 (brightfield)
                    bf_color = color_map[0]
                else:
                    # Use default color map
                    bf_color = CHANNEL_COLOR_MAP.get('BF_LED_matrix_full', (255, 255, 255))
                
                bf_rgb = _apply_channel_color_and_mask_brightfield(
                    bf_region, 
                    cell_mask_region, 
                    bf_color, 
                    bg_value=background_bright_value
                )
                channels_to_merge.append(bf_rgb.astype(np.float32))
                channel_images[0] = bf_rgb

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
                    
                    # Get channel color (use custom color_map if provided, otherwise use default)
                    if color_map is not None and channel_idx in color_map:
                        # Use custom color map for this channel
                        channel_color = color_map[channel_idx]
                    else:
                        # Use default color map based on channel name
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
                    channel_images[channel_idx] = channel_rgb

            # Check if we have any channels to merge
            if len(channels_to_merge) == 0:
                # No channels available (neither brightfield nor fluorescence), skip this cell
                print(f"Warning: Cell at index {poly_index} has no valid channels, skipping")
                return (poly_index, None, None)
            
            # Merge channels using additive blending
            if len(channels_to_merge) > 1:
                merged_rgb = np.clip(np.sum(channels_to_merge, axis=0), 0, 255).astype(np.uint8)
            else:
                merged_rgb = channels_to_merge[0].astype(np.uint8)

            # Resize and pad merged image to 224x224 (use appropriate padding)
            # Use background_bright_value for padding (will be 0 if no brightfield)
            merged_rgb = resize_and_pad_to_square_rgb(merged_rgb, out_size=224, pad_value=background_bright_value)

            # 224x224 image: used only for embedding model input
            cell_pil_224 = PILImage.fromarray(merged_rgb, mode='RGB')
            buffer_224 = BytesIO()
            cell_pil_224.save(buffer_224, format='PNG')
            embedding_image_bytes = buffer_224.getvalue()

            # 100x100 thumbnail: saved to ChromaDB (much smaller, faster insert)
            merged_rgb_thumbnail = np.array(
                cell_pil_224.resize((100, 100), PILImage.Resampling.LANCZOS),
                dtype=np.uint8
            )
            thumb_pil = PILImage.fromarray(merged_rgb_thumbnail, mode='RGB')
            buffer_thumb = BytesIO()
            thumb_pil.save(buffer_thumb, format='PNG')
            thumbnail_base64 = base64.b64encode(buffer_thumb.getvalue()).decode('utf-8')

            # Generate per-channel 100x100 thumbnail images for individual channel storage
            channel_thumbnail_base64 = {}  # channel short name -> base64 string
            for ch_idx, ch_rgb in channel_images.items():
                ch_name = fixed_channel_order[ch_idx] if ch_idx < len(fixed_channel_order) else f"channel_{ch_idx}"
                ch_key = _channel_name_to_key(ch_name)
                ch_pad_value = background_bright_value if ch_idx == 0 else 0
                ch_resized = resize_and_pad_to_square_rgb(ch_rgb.astype(np.uint8), out_size=100, pad_value=ch_pad_value)
                ch_pil = PILImage.fromarray(ch_resized, mode='RGB')
                ch_buffer = BytesIO()
                ch_pil.save(ch_buffer, format='PNG')
                channel_thumbnail_base64[ch_key] = base64.b64encode(ch_buffer.getvalue()).decode('utf-8')

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
                    # No cell pixels - set all intensity features to None
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                sanitized_name = channel_name.replace(' ', '_').replace('-', '_')
                                
                                # Set all region-wise intensities to None
                                metadata[f"mean_intensity_{sanitized_name}_cell"] = None
                                metadata[f"top10_mean_intensity_{sanitized_name}"] = None
                                
                                if nucleus_region is not None:
                                    metadata[f"mean_intensity_{sanitized_name}_nucleus"] = None
                                if cytosol_region is not None:
                                    metadata[f"mean_intensity_{sanitized_name}_cytosol"] = None
                                if nucleus_region is not None and cytosol_region is not None:
                                    metadata[f"ratio_{sanitized_name}_nuc_cyto"] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                else:
                    # Compute region-wise intensities for each channel
                    try:
                        if image_data_np.ndim == 3:
                            for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                                channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                                sanitized_name = channel_name.replace(' ', '_').replace('-', '_')
                                channel_data = image_data_np[:, :, channel_idx]
                                
                                # Skip channels with no signal
                                if channel_data.max() == 0:
                                    metadata[f"mean_intensity_{sanitized_name}_cell"] = None
                                    metadata[f"top10_mean_intensity_{sanitized_name}"] = None
                                    if nucleus_region is not None:
                                        metadata[f"mean_intensity_{sanitized_name}_nucleus"] = None
                                    if cytosol_region is not None:
                                        metadata[f"mean_intensity_{sanitized_name}_cytosol"] = None
                                    if nucleus_region is not None and cytosol_region is not None:
                                        metadata[f"ratio_{sanitized_name}_nuc_cyto"] = None
                                    continue
                                
                                bg_value = background_fluorescence.get(channel_idx, 0.0)
                                
                                # Cell intensity
                                cell_pixels = channel_data[cell_mask > 0]
                                if len(cell_pixels) > 0:
                                    cell_pixels_corrected = np.maximum(cell_pixels - bg_value, 0.0)
                                    metadata[f"mean_intensity_{sanitized_name}_cell"] = float(np.mean(cell_pixels_corrected))
                                    
                                    # Top 10% brightest pixels mean (kept for backward compatibility)
                                    top_10_percent_count = max(1, int(np.ceil(len(cell_pixels_corrected) * 0.1)))
                                    sorted_pixels = np.sort(cell_pixels_corrected)
                                    top_10_pixels = sorted_pixels[-top_10_percent_count:]
                                    metadata[f"top10_mean_intensity_{sanitized_name}"] = float(np.mean(top_10_pixels))
                                else:
                                    metadata[f"mean_intensity_{sanitized_name}_cell"] = None
                                    metadata[f"top10_mean_intensity_{sanitized_name}"] = None
                                
                                # Nucleus intensity (if available)
                                if nucleus_region is not None:
                                    nucleus_pixels = channel_data[nucleus_region > 0]
                                    if len(nucleus_pixels) > 0:
                                        nucleus_pixels_corrected = np.maximum(nucleus_pixels - bg_value, 0.0)
                                        metadata[f"mean_intensity_{sanitized_name}_nucleus"] = float(np.mean(nucleus_pixels_corrected))
                                    else:
                                        metadata[f"mean_intensity_{sanitized_name}_nucleus"] = None
                                
                                # Cytosol intensity (if available)
                                if cytosol_region is not None:
                                    cytosol_pixels = channel_data[cytosol_region > 0]
                                    if len(cytosol_pixels) > 0:
                                        cytosol_pixels_corrected = np.maximum(cytosol_pixels - bg_value, 0.0)
                                        metadata[f"mean_intensity_{sanitized_name}_cytosol"] = float(np.mean(cytosol_pixels_corrected))
                                    else:
                                        metadata[f"mean_intensity_{sanitized_name}_cytosol"] = None
                                
                                # Compute nucleus-to-cytosol ratio
                                if nucleus_region is not None and cytosol_region is not None:
                                    nuc_intensity = metadata.get(f"mean_intensity_{sanitized_name}_nucleus")
                                    cyto_intensity = metadata.get(f"mean_intensity_{sanitized_name}_cytosol")
                                    
                                    if nuc_intensity is not None and cyto_intensity is not None and cyto_intensity > 0:
                                        metadata[f"ratio_{sanitized_name}_nuc_cyto"] = float(nuc_intensity / cyto_intensity)
                                    else:
                                        metadata[f"ratio_{sanitized_name}_nuc_cyto"] = None
                    except Exception as e:
                        # If fluorescence calculation fails, continue without it
                        pass
                    

            except:
                # Set all intensity features to None on error
                try:
                    if image_data_np.ndim == 3:
                        for channel_idx in range(1, min(6, image_data_np.shape[2])):  # Channels 1-5 (skip brightfield)
                            channel_name = fixed_channel_order[channel_idx] if channel_idx < len(fixed_channel_order) else f"channel_{channel_idx}"
                            sanitized_name = channel_name.replace(' ', '_').replace('-', '_')
                            
                            metadata[f"mean_intensity_{sanitized_name}_cell"] = None
                            metadata[f"top10_mean_intensity_{sanitized_name}"] = None
                            
                            if nucleus_region is not None:
                                metadata[f"mean_intensity_{sanitized_name}_nucleus"] = None
                            if cytosol_region is not None:
                                metadata[f"mean_intensity_{sanitized_name}_cytosol"] = None
                            if nucleus_region is not None and cytosol_region is not None:
                                metadata[f"ratio_{sanitized_name}_nuc_cyto"] = None
                except Exception as e:
                    # If fluorescence calculation fails, continue without it
                    pass
            
            # Add 50x50 thumbnail to metadata (stored in ChromaDB; 224x224 used only for embedding)
            metadata["image"] = thumbnail_base64

            # Add per-channel 50x50 thumbnails to metadata (keyed by short channel name)
            for ch_key, ch_b64 in channel_thumbnail_base64.items():
                metadata[f"channel_{ch_key}_image"] = ch_b64

            return (poly_index, metadata, embedding_image_bytes)
            
        except Exception as e:
            # Skip this cell if processing fails
            print(f"Error processing cell at index {poly_index}: {e}")
            return (poly_index, None, None)

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
    async def generate_image_embeddings_batch_rpc(
        images_base64: Optional[List[str]] = None,
        images_bytes: Optional[List[bytes]] = None,
        embedding_types: Optional[List[str]] = None,
    ) -> dict:
        """
        Generate CLIP and/or DINOv2 image embeddings for multiple images in batch via hypha-rpc.
        By default only DINOv2 embeddings are generated. Pass embedding_types to choose.

        Args:
            images_base64: List of base64-encoded image strings.
            images_bytes: Optional list of raw image bytes (PNG/JPEG/etc).
                          If provided, images_base64 can be omitted.
            embedding_types: Which embeddings to generate: ["clip"], ["dino"], or ["clip", "dino"].
                             Default None means ["dino"] only.

        Returns:
            JSON object with success flag, results array (one dict per image with embedding keys
            and dimension fields), and count.
        """
        if embedding_types is None:
            embedding_types = ["dino"]
        try:
            if (not images_base64 or len(images_base64) == 0) and (not images_bytes or len(images_bytes) == 0):
                raise ValueError("At least one image is required")

            # Decode all base64 or numpy image data
            image_bytes_list = []
            valid_indices = []
            
            if images_bytes and len(images_bytes) > 0:
                for idx, image_bytes in enumerate(images_bytes):
                    if image_bytes:
                        image_bytes_list.append(image_bytes)
                        valid_indices.append(idx)
            else:
                for idx, image_base64 in enumerate(images_base64 or []):
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
            embeddings = await generate_image_embeddings_batch(
                image_bytes_list, embedding_types=embedding_types
            )
            
            # Map results back to original order
            results = [None] * (len(images_bytes) if images_bytes and len(images_bytes) > 0 else len(images_base64 or []))
            for valid_idx, embedding_dict in zip(valid_indices, embeddings):
                if embedding_dict is not None:
                    clip_emb = embedding_dict.get("clip_embedding")
                    dino_emb = embedding_dict.get("dino_embedding")
                    results[valid_idx] = {
                        "success": True,
                        "clip_embedding": clip_emb,
                        "clip_dimension": len(clip_emb) if clip_emb else 0,
                        "dino_embedding": dino_emb,
                        "dino_dimension": len(dino_emb) if dino_emb else 0,
                    }
            
            return {
                "success": True,
                "results": results,
                "count": len(results)
            }
        except Exception as e:
            logger.error(f"Error generating image embeddings batch via RPC: {e}")
            logger.error(traceback.format_exc())
            raise


    @schema_function()
    async def snap_segment_extract_put_queue(
        microscope_id: str,
        channel_config: List[Dict[str, Any]],
        application_id: str = "hypha-agents-notebook",
        scale: int = 8,
        positions: Optional[List[Dict[str, float]]] = None,
        wells: Optional[List[str]] = None,
        well_offset: Optional[List[Dict[str, float]]] = None,
        well_plate_type: str = "96",
        nucleus_channel_name: Optional[str] = None,
        color_map: Optional[Dict[str, tuple]] = None,
    ) -> dict:
        """
        Enqueue a job to snap image(s), segment, and extract cell records.
        
        Args:
            microscope_id: Microscope service ID
            channel_config: List of channel configurations for imaging
            application_id: Application identifier for Vector Database storage
            scale: Downscaling factor for segmentation (default: 8)
            positions: (Position mode) Optional list of absolute stage positions to visit.
                      Each position is a dict with keys: x, y, and optionally z.
            wells: (Well grid mode) List of well IDs to scan (e.g., ["A1", "B2", "C3"]).
                  Must be provided together with `well_offset`.
            well_offset: (Well grid mode) List of relative (dx, dy) offsets in mm to create 
                        a grid scan pattern within each well. For example:
                        [{"dx": 0, "dy": 0}, {"dx": 0.5, "dy": 0}, {"dx": 0, "dy": 0.5}]
                        will scan 3 positions per well.
            well_plate_type: Well plate format, e.g., "96", "48", "24" (default: "96")
            nucleus_channel_name: Optional channel name for nucleus segmentation (e.g., "Fluorescence_405_nm_Ex" for DAPI).
                                 If None, only segments cells from BF or fluorescence composite.
                                 If specified, segments both:
                                 - Cell mask from BF (if available) or fluorescence composite
                                 - Nucleus mask from the specified channel
            color_map: Optional custom color map indexed by channel number as string (0=BF, 1-5=fluorescence).
        
        Returns:
            dict with success flag and queue size
        """
        # Validate mutually exclusive modes
        if wells is not None and positions is not None:
            raise ValueError("Cannot use both 'wells' and 'positions' modes simultaneously. Choose one.")
        
        if wells is not None and well_offset is None:
            raise ValueError("When using 'wells' mode, 'well_offset' must be provided.")
        
        # Convert nucleus channel name to index
        nucleus_channel_idx = None
        if nucleus_channel_name is not None:
            try:
                nucleus_channel_idx = fixed_channel_order.index(nucleus_channel_name)
            except ValueError:
                raise ValueError(
                    f"Invalid nucleus_channel_name '{nucleus_channel_name}'. "
                    f"Must be one of: {fixed_channel_order}"
                )
        
        await snap_queue.put(
            {
                "microscope_id": microscope_id,
                "channel_config": channel_config,
                "application_id": application_id,
                "scale": scale,
                "positions": positions,
                "wells": wells,
                "well_offset": well_offset,
                "well_plate_type": well_plate_type,
                "nucleus_channel_idx": nucleus_channel_idx,
                "color_map": color_map,
            }
        )
        return {
            "success": True,
            "queued": True,
            "queue_size": snap_queue.qsize(),
        }

    @schema_function()
    async def poll_snap_segment_extract_status() -> Dict[str, Any]:
        """
        Poll the status of snap, segment, and extract queues without blocking.
        
        Returns:
            Dictionary with status information:
            - If not started: {'status': 'idle'}
            - If running: {'status': 'running', 'queue_sizes': {...}, 'results_count': int}
            - If error: {'status': 'error', 'error': str} (currently errors are logged but not tracked)
            - If succeed: {'status': 'succeed', 'result': [...]}
        """
        # Check if queues are empty
        snap_empty = snap_queue.empty()
        segment_empty = segment_queue.empty()
        build_empty = build_queue.empty()
        
        # Check if we have any results
        has_results = len(segment_and_extract_results) > 0
        
        # Check if workers are busy
        snap_busy = snap_worker_busy.is_set()
        segment_build_idle = segment_and_extract_idle.is_set()
        
        # Determine status
        # We're running if ANY queue has items OR any worker is busy
        all_queues_empty = snap_empty and segment_empty and build_empty
        all_workers_idle = not snap_busy and segment_build_idle
        
        if not all_queues_empty or not all_workers_idle:
            # Processing in progress
            return {
                "status": "running",
                "queue_sizes": {
                    "snap_queue": snap_queue.qsize(),
                    "segment_queue": segment_queue.qsize(),
                    "build_queue": build_queue.qsize()
                },
                "workers_busy": {
                    "snap_worker": snap_busy,
                    "segment_build_workers": not segment_build_idle
                },
                "results_count": len(segment_and_extract_results)
            }
        
        # All queues are empty AND all workers are idle
        if has_results:
            # Processing complete with results
            results = list(segment_and_extract_results)
            segment_and_extract_results.clear()
            return {
                "status": "succeed",
                "result": results
            }
        else:
            # No work has been queued or all results have been retrieved
            return {
                "status": "idle"
            }
    
    @schema_function()
    async def build_cell_records(
        image_data_np: Any, 
        segmentation_mask: Any,
        microscope_status: Optional[Dict[str, Any]] = None,
        application_id: str = 'hypha-agents-notebook',
        color_map: Optional[Dict[str, tuple]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Extract cell metadata, crops, and embeddings from segmentation results.
        Automatically stores images and DINO embeddings to Vector Database for memory efficiency.
        
        Args:
            image_data_np: Multi-channel microscopy image (H, W, C) or single-channel (H, W).
                           Also accepts a list/tuple of per-channel arrays where missing channels are None.
            segmentation_mask: Integer mask where each unique non-zero value represents a cell. Can be a single mask (np.ndarray) or a list of masks [cell_mask, nucleus_mask].
            microscope_status: Optional microscope position info for spatial metadata
            application_id: Application identifier for Vector Database storage (default: 'hypha-agents-notebook')
            color_map: Optional custom color map indexed by channel number as string (0=BF, 1-5=fluorescence).
                      Format: {channel_idx_str: (R, G, B)} where RGB values are in 0.0-1.0 range. If not provided, uses default.

        Returns:
            List of metadata dictionaries, one per cell, with the following fields:
            
            Geometry & Shape (in memory + Vector Database):
            - uuid: Vector Database object UUID for retrieving images/embeddings later
            - image: Base64-encoded 50x50 PNG of the merged (composite) cell image
            - channel_BF_image: Base64-encoded 50x50 PNG of the brightfield channel (if available)
            - channel_405_image, channel_488_image, channel_561_image, channel_638_image: Base64-encoded 50x50 PNG per fluorescence channel (only channels with signal)
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
            When single mask is provided:
            - mean_intensity_<channel_name>_cell: mean intensity of the whole cell
            - top10_mean_intensity_<channel_name>: mean intensity of the top 10% brightest pixels
            
            When nucleus mask is provided (multi-mask mode):
            - mean_intensity_<channel_name>_cell: mean intensity of the whole cell
            - mean_intensity_<channel_name>_nucleus: mean intensity of the nucleus region
            - mean_intensity_<channel_name>_cytosol: mean intensity of the cytosol region (cell - nucleus)
            - ratio_<channel_name>_nuc_cyto: nucleus-to-cytosol intensity ratio
            - top10_mean_intensity_<channel_name>: mean intensity of the top 10% brightest pixels (whole cell)
            
            Spatial Position (in memory only, if microscope_status provided):
            - position: {"x": float, "y": float} - absolute cell position in mm
            - well_id: well identifier (e.g., "A1", "B2")
            - distance_from_center: distance from the center of the well in mm
        """

        import concurrent.futures
        import os
        from skimage.measure import label, regionprops
        
        # Accept sparse channel list: [np.ndarray | None, ...]
        if isinstance(image_data_np, (list, tuple)):
            channels = list(image_data_np)
            first = next((ch for ch in channels if ch is not None), None)
            if first is None:
                raise ValueError("image_data_np list has no valid channels")
            if not isinstance(first, np.ndarray):
                first = np.array(first)
            H, W = first.shape[:2]
            dtype = first.dtype
            dense = np.zeros((H, W, len(channels)), dtype=dtype)
            for idx, ch in enumerate(channels):
                if ch is None:
                    continue
                if not isinstance(ch, np.ndarray):
                    ch = np.array(ch)
                if ch.ndim == 3:
                    ch = ch[:, :, 0]
                dense[:, :, idx] = ch
            image_data_np = dense

        # Parse segmentation_mask input - can be single mask or list of masks
        if isinstance(segmentation_mask, (list, tuple)):
            if len(segmentation_mask) < 1:
                raise ValueError("segmentation_mask list must contain at least one mask")
            cell_mask_input = segmentation_mask[0]
            nucleus_mask_input = segmentation_mask[1] if len(segmentation_mask) > 1 else None
        else:
            cell_mask_input = segmentation_mask
            nucleus_mask_input = None
        
        # Convert masks to numpy arrays (handles base64 strings and arrays)
        mask = _convert_mask_to_array(cell_mask_input)
        nucleus_mask = _convert_mask_to_array(nucleus_mask_input) if nucleus_mask_input is not None else None
        
        # Extract region properties once from labeled mask
        # This directly processes the instance mask where each object has a unique ID
        props = regionprops(mask)
        
        # Early return if no cells to process
        if len(props) == 0:
            print("No cells found in segmentation mask - returning empty list")
            return []
        
        # Polygon extraction is not needed for feature extraction (regionprops is sufficient)
        print(f"Extracting metadata for {len(props)} cells from segmentation mask...")
        
        # Extract brightfield channel (if available)
        brightfield = image_data_np[:, :, 0] if image_data_np.ndim == 3 else image_data_np
        
        # Check if brightfield has signal
        has_brightfield = brightfield is not None and np.any(brightfield > 0)
        
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
        
        # Compute brightfield background only if brightfield has signal
        if has_brightfield:
            non_cell_pixels = brightfield[background_mask]
            
            if non_cell_pixels.size == 0:
                raise ValueError("No non-cell pixels found (mask==0). Cannot compute background median.")
            background_bright_value = int(np.median(non_cell_pixels))
        else:
            # No brightfield signal, use black (0) as background
            background_bright_value = 0
        
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
        
        # Convert custom color_map from 0-1 range to 0-255 range if provided
        # Also convert string keys to integers (msgpack requires string keys for serialization)
        color_map_255 = None
        if color_map is not None:
            color_map_255 = {}
            for channel_idx_str, rgb_tuple in color_map.items():
                # Convert string key to integer (e.g., "0" -> 0, "1" -> 1)
                channel_idx = int(channel_idx_str)
                # Convert from 0-1 range to 0-255 range
                color_map_255[channel_idx] = (
                    int(rgb_tuple[0] * 255),
                    int(rgb_tuple[1] * 255),
                    int(rgb_tuple[2] * 255)
                )
        
        # Set max_workers for parallel processing (use all available CPUs)
        max_workers = min(len(props), os.cpu_count() or 4)
        
        # Pass regionprops directly to avoid recomputation
        # Step 1: Process cells in parallel using ThreadPoolExecutor
        # Prepare arguments for parallel processing
        process_args = [
            (prop, idx, image_data_np, mask, nucleus_mask, brightfield, fixed_channel_order, background_bright_value, background_fluorescence, position_info, color_map_255)
            for idx, prop in enumerate(props)
        ]
        
        # Process cells in parallel
        results_with_indices = []
        cell_images_bytes = []
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
                    poly_index, metadata, cell_image_bytes = await asyncio_future
                    if metadata is not None:
                        results_with_indices.append((poly_index, metadata))
                        if cell_image_bytes is not None:
                            cell_images_bytes.append(cell_image_bytes)
                            cell_indices.append(len(results_with_indices) - 1)
                except Exception as e:
                    original_index = future_to_index.get(asyncio_future, "unknown")
                    print(f"Error processing cell at index {original_index}: {e}")
        
        # Sort results by original polygon index to maintain order
        results_with_indices.sort(key=lambda x: x[0])
        results = [metadata for _, metadata in results_with_indices]
        
        # Step 2: Generate embeddings in batch via RPC service
        if len(cell_images_bytes) > 0:
            try:
                print(f"Generating embeddings for {len(cell_images_bytes)} cell images...")
                embedding_result = await generate_image_embeddings_batch_rpc(
                    images_bytes=cell_images_bytes
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
                            results[result_idx]["dino_embedding"] = None
                            continue
                        
                        # Handle successful embeddings
                        if embedding_data.get("success"):
                            results[result_idx]["dino_embedding"] = embedding_data.get("dino_embedding", None)
                        else:
                            # Embedding generation failed for this image
                            results[result_idx]["dino_embedding"] = None
                else:
                    print(f"Warning: Embedding generation failed or returned no results")
                    # Set all embeddings to None
                    for result in results:
                        if "dino_embedding" not in result:
                            result["dino_embedding"] = None
            except Exception as e:
                print(f"Error generating embeddings: {e}")
                # Set all embeddings to None on error
                for result in results:
                    if "dino_embedding" not in result:
                        result["dino_embedding"] = None
        else:
            # No images to process
            for result in results:
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
            
            # Batch insert in a thread so the event loop is not blocked (ChromaDB + SQLite I/O is slow)
            insert_result = await asyncio.to_thread(
                chroma_storage.insert_cells,
                application_id=application_id,
                cells=cells_to_insert
            )
            
            print(f"✅ Stored {insert_result['inserted_count']} cells to ChromaDB")
            
            # Remove images and embeddings from results to save memory
            for cell in results:
                cell.pop("image", None)
                cell.pop("dino_embedding", None)
            
        except Exception as e:
            print(f"Warning: Failed to store cells to ChromaDB: {e}")
            logger.warning(f"Failed to store cells to ChromaDB: {e}")
            # Continue without ChromaDB storage - return full records
        
        return results
    @schema_function()
    async def make_umap_cluster_figure_interactive_rpc(
        application_id: str = "hypha-agents-notebook",
        n_neighbors: int = 15,
        min_dist: float = 0.1,
        random_state: Optional[int] = None,
        n_jobs: int = -1,
        metadata_fields: Optional[List[str]] = None,
    ) -> dict:
        """
        Generate interactive UMAP visualization (Plotly HTML) by extracting data from ChromaDB.
        
        Args:
            application_id: ChromaDB collection name
            n_neighbors: Number of neighbors for UMAP
            min_dist: Minimum distance for UMAP
            random_state: Random state for reproducibility
            n_jobs: Number of parallel jobs
            metadata_fields: Metadata fields for heatmap tabs
            
        Returns:
            dict with success flag, HTML string, cluster labels, and UUIDs
        """
        try:
            # Fetch all cells from ChromaDB
            logger.info(f"Fetching all cells from ChromaDB collection '{application_id}'...")
            
            all_cells = await asyncio.to_thread(
                chroma_storage.get_all_cells,
                application_id=application_id,
                include_embeddings=True
            )
            
            if not all_cells or len(all_cells) == 0:
                return {
                    "success": False,
                    "error": f"No cells found in ChromaDB collection '{application_id}'",
                    "html": None,
                    "cluster_labels": None
                }
            
            logger.info(f"Retrieved {len(all_cells)} cells from ChromaDB")
            
            # Generate UMAP visualization
            from agent_lens.utils.umap_analysis_utils import (
                make_umap_cluster_figure_interactive,
                PLOTLY_AVAILABLE
            )
            
            logger.info(f"Starting UMAP visualization for {len(all_cells)} cells with n_jobs={n_jobs}")
            
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
                cells_with_embeddings = sum(1 for c in all_cells 
                                           if c.get("dino_embedding") or c.get("clip_embedding") or c.get("embedding_vector"))
                
                if not PLOTLY_AVAILABLE:
                    error_msg = "Plotly is not available. Install with: pip install plotly"
                elif cells_with_embeddings < 5:
                    error_msg = f"Too few cells with embeddings ({cells_with_embeddings}/{len(all_cells)})"
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
                "uuids": result["uuids"],
                "n_cells": len(all_cells),
                "n_clusters": len(set(result["cluster_labels"]))
            }
        except Exception as e:
            logger.error(f"Error generating interactive UMAP figure via RPC: {e}")
            logger.error(traceback.format_exc())
            raise

    @schema_function()
    async def fetch_cell_data(
        uuids: List[str],
        application_id: str
    ) -> List[Dict[str, Any]]:
        """
        Fetch complete cell data from ChromaDB by UUIDs (batch operation).

        Args:
            uuids: List of cell UUIDs
            application_id: Application ID

        Returns:
            List of cell data dicts with uuid, image, dino_embedding, and metadata
        """
        try:
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(
                None,
                lambda: chroma_storage.fetch_by_uuids(
                    application_id=application_id,
                    uuids=uuids,
                    include_embeddings=True
                )
            )
            return results

        except Exception as e:
            logger.error(f"Failed to fetch cell data from ChromaDB: {e}")
            return [{"uuid": uuid, "error": str(e)} for uuid in uuids]

    @schema_function()
    async def similarity_search_cells(
        query_cell_uuids: List[str],
        application_id: str = "hypha-agents-notebook",
        n_results: int = 100,
        metadata_filters: Optional[Dict[str, Any]] = None,
        similarity_threshold: Optional[float] = None
    ) -> List[Dict[str, Any]]:
        """
        Server-side similarity search using ChromaDB native vector search.
        
        Args:
            query_cell_uuids: List of query cell UUIDs
            application_id: Application ID
            n_results: Maximum number of results per query
            metadata_filters: ChromaDB where clause for filtering
            similarity_threshold: Optional cosine similarity threshold
        
        Returns:
            List of similar cells with metadata, images, and similarity scores
        """
        try:
            # Fetch query cell embeddings
            query_cells = chroma_storage.fetch_by_uuids(
                application_id=application_id,
                uuids=query_cell_uuids,
                include_embeddings=True
            )
            
            if not query_cells:
                logger.warning(f"No query cells found for UUIDs: {query_cell_uuids}")
                return []
            
            # Extract embeddings
            query_embeddings = []
            for cell in query_cells:
                emb = cell.get("dino_embedding")
                if emb is not None:
                    query_embeddings.append(emb)
            
            if not query_embeddings:
                logger.warning(f"No embeddings found for query cells: {query_cell_uuids}")
                return []
            
            # Average query embeddings if multiple queries
            if len(query_embeddings) > 1:
                query_embedding = np.mean(query_embeddings, axis=0).tolist()
                logger.info(f"Averaged {len(query_embeddings)} query embeddings")
            else:
                query_embedding = query_embeddings[0]
            
            # Perform similarity search
            search_results = chroma_storage.similarity_search(
                application_id=application_id,
                query_embedding=query_embedding,
                n_results=n_results,
                where_filter=metadata_filters
            )
            
            # Convert results to cell dictionaries
            similar_cells = []
            ids = search_results.get("ids", [[]])[0]
            distances = search_results.get("distances", [[]])[0]
            metadatas = search_results.get("metadatas", [[]])[0]
            documents = search_results.get("documents", [[]])[0]
            
            for i, cell_uuid in enumerate(ids):
                # Convert distance to similarity score
                distance = distances[i] if i < len(distances) else 1.0
                similarity = 1.0 - (distance ** 2 / 2.0)
                similarity = max(0.0, min(1.0, similarity))
                
                # Apply similarity threshold
                if similarity_threshold is not None and similarity < similarity_threshold:
                    continue
                
                # Build cell dictionary
                cell = {
                    "uuid": cell_uuid,
                    "image": documents[i] if i < len(documents) else "",
                    "similarity_score": float(similarity),
                    "distance": float(distance)
                }
                
                # Add metadata
                if i < len(metadatas):
                    cell.update(metadatas[i])
                
                similar_cells.append(cell)
            
            logger.info(f"Similarity search returned {len(similar_cells)} cells")
            
            return similar_cells
            
        except Exception as e:
            logger.error(f"Similarity search failed: {e}", exc_info=True)
            return []
    
    @schema_function()
    async def reset_application(application_id: str = "hypha-agents-notebook") -> dict:
        """
        Delete all cell annotations for an application from ChromaDB.
        
        Returns:
            dict with success flag, deleted_count, application_id, and message
        """
        try:
            result = await asyncio.to_thread(
                chroma_storage.reset_application, application_id
            )
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
    
    # Register the service with RPC methods only (no ASGI)
    await server.register_service({
        "id": server_id,
        "name": "Agent Lens Tools",
        "type": "generic",
        "config": {"visibility": "public"},
        # Register all RPC methods
        "generate_image_embeddings_batch": generate_image_embeddings_batch_rpc,
        "build_cell_records": build_cell_records,
        "snap_segment_extract_put_queue": snap_segment_extract_put_queue,
        "poll_snap_segment_extract_status": poll_snap_segment_extract_status,
        "make_umap_cluster_figure_interactive": make_umap_cluster_figure_interactive_rpc,
        "reset_application": reset_application,
        "fetch_cell_data": fetch_cell_data,
        "similarity_search_cells": similarity_search_cells
    })
    
    logger.info(f"Tools service registered successfully with ID: {server_id}")
    
    # Register health probes if running in Docker mode
    if is_docker:
        await register_tools_health_probes(server, server_id, segmentation_service, segment_queue, build_queue, snap_queue)


async def register_tools_health_probes(server, server_id, segmentation_service, segment_queue, build_queue, snap_queue):
    """Register health probes for the tools service."""
    
    def check_readiness():
        """Check if tools service is ready."""
        return {"status": "ok", "service": server_id}
    
    async def check_liveness():
        """
        Check if tools service is alive.
        Checks:
        1. ChromaDB connection (cell storage)
        2. Background workers are running
        3. Segmentation service connection
        """
        health_status = {
            "status": "ok",
            "service": server_id,
            "checks": {}
        }
        
        # Check ChromaDB
        try:
            collections = chroma_storage.list_collections()
            health_status["checks"]["chromadb"] = "ok"
        except Exception as e:
            logger.warning(f"ChromaDB health check failed: {e}")
            health_status["checks"]["chromadb"] = f"error: {str(e)}"
            health_status["status"] = "degraded"
        
        # Check segmentation service
        try:
            await segmentation_service.ping()
            health_status["checks"]["segmentation_service"] = "ok"
        except Exception as e:
            logger.warning(f"Segmentation service health check failed: {e}")
            health_status["checks"]["segmentation_service"] = f"error: {str(e)}"
            health_status["status"] = "degraded"
        
        # Check background queues
        health_status["checks"]["queues"] = {
            "segment_queue": segment_queue.qsize(),
            "build_queue": build_queue.qsize(),
            "snap_queue": snap_queue.qsize()
        }
        
        return health_status
    
    await server.register_probes({
        "readiness": check_readiness,
        "liveness": check_liveness,
    })
    
    logger.info(f"Tools health probes registered")
    logger.info(f"Liveness: {SERVER_URL}/{server.config.workspace}/services/{server_id}/probes/liveness")
    logger.info(f"Readiness: {SERVER_URL}/{server.config.workspace}/services/{server_id}/probes/readiness")
