// Shared Microscope Control Agent Configuration
// Source: hypha-agents-notebooks/agent-lens-hpa-analysis.ipynb (cell 0)
// Microscope ID and service IDs are injected at load time by agentConfigLoader.js

export const systemCellCode = `# Imports and Connection
import os
import sys
import json

import micropip
await micropip.install(["hypha-rpc", "httpx"])
await micropip.install('seaborn')
import asyncio
from hypha_rpc import connect_to_server
import httpx
import time
from IPython.display import display, HTML
from IPython.display import Image as IPythonImage
from typing import Union, Optional, Tuple, Sequence, List, Dict, Any
from io import BytesIO
import io
import numpy as np
import base64
from skimage.measure import regionprops
from skimage import exposure
from PIL import Image as PILImage
import math

workspace_token = ""  # Set your workspace token here

# Connect to Hypha server
reef_server = await connect_to_server({
    "server_url": "https://hypha.aicell.io",
    "token": workspace_token,
    "workspace": "reef-imaging",
    "ping_interval": None
})

# Get services
segmentation_service = await reef_server.get_service("reef-imaging/cell-segmenter")
agent_lens_service = await reef_server.get_service("AGENT_LENS_SERVICE_PLACEHOLDER")

# Microscope configuration
microscope_id = "MICROSCOPE_ID_PLACEHOLDER"
microscope = await reef_server.get_service(microscope_id)


# Reset ChromaDB vector database for fresh start
application_id = "hypha-agents-notebook"
reset_result = await agent_lens_service.reset_application(application_id)

# Cell 4: Core Helper Functions
# Channel canonical names
fixed_channel_order = [
    'BF_LED_matrix_full',
    'Fluorescence_405_nm_Ex',
    'Fluorescence_488_nm_Ex',
    'Fluorescence_638_nm_Ex',
    'Fluorescence_561_nm_Ex',
    'Fluorescence_730_nm_Ex'
]

color_map = {
    "0": (1.0, 1.0, 1.0),  # BF: gray
    "1": (0.0, 0.0, 1.0),  # 405nm: blue
    "2": (0.0, 1.0, 0.0),  # 488nm: green
    "3": (1.0, 1.0, 0.0),  # 638nm: yellow
    "4": (1.0, 0.0, 0.0),  # 561nm: red
}

async def snap_image(channel_config: List[Dict[str, Any]]) -> List[Optional[np.ndarray]]:
    """Snap multi-channel images and return list of channels. Missing channels are None."""
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
    
    return channels


def overlay(image_channels: List[Optional[np.ndarray]], color_map) -> np.ndarray:
    """Create RGB composite from sparse channel list using additive color blending."""
    first = next((ch for ch in image_channels if ch is not None), None)
    if first is None:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    
    H, W = first.shape[:2]
    
    rgb_composite = np.zeros((H, W, 3), dtype=np.float64)
    
    for channel_idx_str, (r, g, b) in color_map.items():
        channel_idx = int(channel_idx_str)  # Convert string key to integer
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


def percentile_normalize(
    image_data: List[Optional[np.ndarray]],
    lower_percentile: float = 1.0,
    upper_percentile: float = 99.0,
    output_dtype: type = np.uint8,
) -> List[Optional[np.ndarray]]:
    """Apply percentile normalization to all non-empty channels. Returns same list shape."""
    normalized: List[Optional[np.ndarray]] = []
    
    if output_dtype == np.uint8:
        output_min, output_max = 0, 255
    elif output_dtype == np.uint16:
        output_min, output_max = 0, 65535
    else:
        output_min, output_max = 0.0, 1.0
    
    for ch in image_data:
        if ch is None:
            normalized.append(None)
            continue
        
        channel = ch
        if channel.max() > 0:
            p_low = np.percentile(channel, lower_percentile)
            p_high = np.percentile(channel, upper_percentile)
            clipped = np.clip(channel, p_low, p_high)
            if p_high > p_low:
                norm = (clipped - p_low) / (p_high - p_low) * (output_max - output_min) + output_min
            else:
                norm = np.full_like(channel, output_min, dtype=np.float64)
        else:
            norm = np.zeros_like(channel, dtype=np.float64)
        
        normalized.append(norm.astype(output_dtype))
    
    return normalized

async def segment_image(image_data, scale: int = 5) -> np.ndarray:
    """
    Segment cells from image: BF (channel 0) if present; otherwise use overlay(image_channels, color_map) composite.
    Accepts:
      - image_data as np.ndarray (H,W,C) or (H,W)
      - or list/tuple of channels (can include None)
      - scale: downscaling factor for segmentation (default 5). Set to 1 or None to disable downscaling.
    """
    # ---- convert to channel list (preserve indices incl. None) ----
    if isinstance(image_data, (list, tuple)):
        chans = list(image_data)
    else:
        arr = np.asarray(image_data)
        if arr.ndim == 2:
            chans = [arr]
        else:
            chans = [arr[:, :, i] for i in range(arr.shape[2])]

    # ---- pick segmentation input (RGB, do NOT convert to grayscale) ----
    bf = chans[0] if len(chans) > 0 else None
    if bf is not None and np.nanstd(bf) > 1e-6:
        # Use BF image (single channel): promote to 3-channel grayscale RGB if needed
        if bf.dtype != np.uint8:
            g = bf.astype(np.float32)
            g = (g - np.nanmin(g)) / (np.nanmax(g) - np.nanmin(g) + 1e-12) * 255.0
            gray_u8 = np.clip(g, 0, 255).astype(np.uint8)
        else:
            gray_u8 = bf
        input_rgb = np.stack([gray_u8] * 3, axis=-1)
    else:
        # Use overlay (already RGB)
        input_rgb = overlay(chans, color_map)  # (H,W,3) uint8

    H, W = input_rgb.shape[:2]

    # ---- downscale ----
    if scale and scale > 1:
        pil_img = PILImage.fromarray(input_rgb, "RGB").resize((max(1, W // scale), max(1, H // scale)), PILImage.BILINEAR)
    else:
        pil_img = PILImage.fromarray(input_rgb, "RGB")

    # ---- encode + segment ----
    buf = BytesIO()
    pil_img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    res = await segmentation_service.segment_all(b64)
    mask_small = res["mask"] if isinstance(res, dict) else res

    # ---- upscale mask ----
    if scale and scale > 1:
        mask = np.array(
            PILImage.fromarray(np.array(mask_small, np.uint16)).resize((W, H), PILImage.NEAREST)
        )
    else:
        mask = np.array(mask_small)

    return mask

async def wait_for_snap_segment_extract(agent_lens_service, poll_interval=30):
    """
    Helper function to poll snap_segment_extract status until completion.
    Returns:
        List of cell records, or empty list if idle/error
    """
    
    print('Waiting for all snap+segment+extract jobs to finish...')
    start_time = time.time()
    
    while True:
        await asyncio.sleep(3)  # Small delay before first check
        status = await agent_lens_service.poll_snap_segment_extract_status()
        
        if status['status'] == 'idle':
            print("No work in progress")
            return []
            
        elif status['status'] == 'running':
            queue_info = status['queue_sizes']
            workers_busy = status.get('workers_busy', {})
            results_so_far = status['results_count']
            elapsed = time.time() - start_time
            
            # Show worker status
            worker_status = []
            if workers_busy.get('snap_worker', False):
                worker_status.append("snap:BUSY")
            if workers_busy.get('segment_build_workers', False):
                worker_status.append("seg/build:BUSY")
            worker_str = ", ".join(worker_status) if worker_status else "all idle"
            
            print(f"[{elapsed:.1f}s] Processing... "
                  f"queues[snap:{queue_info['snap_queue']}, "
                  f"seg:{queue_info['segment_queue']}, "
                  f"build:{queue_info['build_queue']}], "
                  f"workers[{worker_str}], "
                  f"results:{results_so_far}")
            await asyncio.sleep(poll_interval)
            
        elif status['status'] == 'succeed':
            elapsed = time.time() - start_time
            print(f"✓ Complete in {elapsed:.1f}s! Got {len(status['result'])} cell records")
            return status['result']
            
        elif status['status'] == 'error':
            print(f"✗ Error occurred: {status.get('error', 'Unknown error')}")
            return []

def np_to_base64_png(arr: np.ndarray, normalize: bool = True) -> str:
    """Convert numpy array to base64 PNG string for HTML display."""
    if normalize and arr.max() > 0:
        arr = (arr / arr.max() * 255).astype(np.uint8)
    elif arr.dtype != np.uint8:
        arr = arr.astype(np.uint8)
    pil_img = PILImage.fromarray(arr)
    buf = io.BytesIO()
    pil_img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def make_stage_offsets(
    grid_size: int,
    step_mm: float = 1.0
) -> List[Tuple[float, float]]:
    """Generate (dx, dy) offsets for grid scan, sorted by distance from center. step_mm is the distance between fov centers, don't change if user didn't specify."""
    origin = (grid_size - 1) / 2.0
    positions = [
        ((i - origin) * step_mm, (j - origin) * step_mm)
        for i in range(grid_size)
        for j in range(grid_size)
    ]
    positions.sort(key=lambda pos: (pos[0]**2 + pos[1]**2))
    return positions

# Filter Conversion Utilities
def convert_filters_to_chromadb_where(
    relative_config: Optional[Dict[str, float]] = None,
    range_config: Optional[Dict[str, Dict[str, float]]] = None,
    query_cell_records: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """
    Convert old-style filter configs to ChromaDB where clause.
    
    Args:
        relative_config: Relative tolerances (e.g., {"size_tolerance": 0.4, "circularity_tol": 0.15})
        range_config: Absolute ranges (e.g., {"area": {"min": 200, "max": 3000}})
        query_cell_records: Query cells for computing relative filter means
    
    Returns:
        ChromaDB where clause dict, or None if no filters
    """
    conditions = []
    
    # Convert range_config (absolute filters)
    if range_config:
        for field, rule in range_config.items():
            field_conditions = []
            if "min" in rule and rule["min"] is not None:
                field_conditions.append({field: {"$gte": float(rule["min"])}})
            if "max" in rule and rule["max"] is not None:
                field_conditions.append({field: {"$lte": float(rule["max"])}})
            
            if len(field_conditions) == 1:
                conditions.append(field_conditions[0])
            elif len(field_conditions) > 1:
                conditions.append({"$and": field_conditions})
    
    # Convert relative_config (relative to query mean)
    if relative_config and query_cell_records:
        import numpy as np
        
        # Map config keys to field names and tolerance types
        filter_mappings = {
            "size_tolerance": ("area", True),  # relative
            "brightness_tol": ("brightness", False),  # absolute
            "circularity_tol": ("circularity", False),
            "aspect_ratio_tol": ("aspect_ratio", False),
            "eccentricity_tol": ("eccentricity", False),
            "solidity_tol": ("solidity", False),
        }
        
        for tol_key, (field_name, is_relative) in filter_mappings.items():
            tolerance = relative_config.get(tol_key)
            if tolerance is None:
                continue
            
            # Compute query mean
            vals = []
            for q in query_cell_records:
                v = q.get(field_name)
                if v is not None:
                    vals.append(float(v))
            
            if not vals:
                continue
            
            query_mean = float(np.mean(vals))
            
            if is_relative:
                # Relative tolerance: mean * (1 ± tolerance)
                min_val = query_mean * (1 - tolerance)
                max_val = query_mean * (1 + tolerance)
            else:
                # Absolute tolerance: mean ± tolerance
                min_val = query_mean - tolerance
                max_val = query_mean + tolerance
            
            conditions.append({
                "$and": [
                    {field_name: {"$gte": min_val}},
                    {field_name: {"$lte": max_val}}
                ]
            })
    
    # Combine all conditions
    if len(conditions) == 0:
        return None
    elif len(conditions) == 1:
        return conditions[0]
    else:
        return {"$and": conditions}


async def similarity_search_with_filters(
    query_cell_records: List[Dict[str, Any]],
    relative_config: Optional[Dict[str, float]] = None,
    range_config: Optional[Dict[str, Dict[str, float]]] = None,
    similarity_config: Optional[Dict[str, Any]] = None,
    application_id: str = "hypha-agents-notebook",
    n_results: int = 100
) -> List[Dict[str, Any]]:
    """
    Similarity search with backward-compatible filter format.
        
    Args:
        query_cell_records: Query cells to search for
        relative_config: Relative tolerances (e.g., {"size_tolerance": 0.4})
        range_config: Absolute ranges (e.g., {"area": {"min": 200, "max": 3000}})
        similarity_config: Similarity thresholds (e.g., {"final_score_threshold": 0.7})
        application_id: Vector Database application ID
        n_results: Maximum number of results
    
    Returns:
        List of similar cells with metadata and images
    """
    # Extract query UUIDs
    query_uuids = [cell["uuid"] for cell in query_cell_records if "uuid" in cell]
    
    if not query_uuids:
        print("Warning: No UUIDs found in query cells")
        return []
    
    # Convert filters to Vector Database where clause
    where_clause = convert_filters_to_chromadb_where(
        relative_config=relative_config,
        range_config=range_config,
        query_cell_records=query_cell_records
    )
    
    # Extract similarity threshold
    similarity_threshold = None
    if similarity_config:
        similarity_threshold = similarity_config.get("final_score_threshold")
    
    # Perform server-side similarity search
    similar_cells = await agent_lens_service.similarity_search_cells(
        query_cell_uuids=query_uuids,
        application_id=application_id,
        n_results=n_results,
        metadata_filters=where_clause,
        similarity_threshold=similarity_threshold
    )
    
    return similar_cells


#  Visualization Functions
def show_similarity_results(
    query_cell_records: List[Dict[str, Any]],
    similar_cells: List[Dict[str, Any]],
    max_examples: int = 20
):
    """Display similar cells from vector database search results. The first of similar_cells is the query cell. This function is only for similarity search results, not for general cell visualization, you should create new html visualization for other purposes."""
    
    metadata_fields = [
        ("area", "Area", "{:.1f}"),
        ("circularity", "Circ.", "{:.3f}"),
        ("similarity_score", "Sim.", "{:.3f}"),
        ("distance", "Dist.", "{:.3f}"),
    ]
    
    def cell_metadata_html(cell):
        items = []
        for k, label, fmt in metadata_fields:
            val = cell.get(k, None)
            if val is not None:
                try:
                    items.append(f"<span style='white-space:nowrap;' title='{k}'><b>{label}:</b> {fmt.format(val)}</span>")
                except:
                    pass
        
        for key in sorted(cell.keys()):
            if key.startswith('top10_mean_intensity_'):
                val = cell.get(key)
                if val is not None:
                    try:
                        channel_name = key.replace('top10_mean_intensity_', '').replace('_', ' ')
                        label = f"Top10% {channel_name}"
                        items.append(f"<span style='white-space:nowrap;' title='{key}'><b>{label}:</b> {val:.1f}</span>")
                    except:
                        pass
        
        if not items:
            return ""
        return "<div style='margin-top:4px;line-height:1.2;color:#666;font-size:9px;'>" + "<br>".join(items) + "</div>"
    
    def cell_card(cell, is_query=False):
        # Handle different image formats
        img_b64 = cell.get("image")
        if not img_b64:
            img_b64 = cell.get("image_b64")
        
        # If image is not base64 string, it might be empty or None
        if not img_b64 or not isinstance(img_b64, str):
            img_b64 = ""  # Will show broken image icon
        
        uuid = cell.get("uuid", "?")
        well = cell.get("well_id", "?")
        
        border_style = "2px solid #007bff" if is_query else "1px solid #ddd"
        metadata_html = cell_metadata_html(cell)
        
        # Show placeholder if no image
        if img_b64:
            img_html = f'<img src="data:image/png;base64,{img_b64}" style="width:120px;height:120px;object-fit:contain;"/>'
        else:
            img_html = '<div style="width:120px;height:120px;background:#f0f0f0;display:flex;align-items:center;justify-content:center;color:#999;font-size:10px;">No Image</div>'
        
        # Safe UUID display
        uuid_display = uuid[:8] if isinstance(uuid, str) and len(uuid) >= 8 else str(uuid)
        
        return f'''
        <div style="display:inline-block;margin:5px;padding:8px;border:{border_style};border-radius:4px;
                    width:160px;vertical-align:top;font-size:10px;box-sizing:border-box;">
            {img_html}
            <div style="margin-top:4px;">
                Well: {well}<br/>
                UUID: {uuid_display}...
            </div>
            {metadata_html}
        </div>'''
    
    # Assume first entry of similar_cells is the query cell, rest are actual similar cells
    if not similar_cells:
        html = "<div style='color:#999;'>No results found.</div>"
    else:
        query_cell = similar_cells[0]
        similar_sorted = sorted(similar_cells[1:], key=lambda x: -x.get("similarity_score", 0))[:max_examples]
        html = f'''
        <div style="font-family:Arial,sans-serif;">
            <h3>Query Cell</h3>
            <div>{cell_card(query_cell, is_query=True)}</div>
            <h3>Similar Cells ({len(similar_sorted)} shown, {max(0, len(similar_cells)-1)} total)</h3>
            <div>{''.join(cell_card(c) for c in similar_sorted) or '<i>None found</i>'}</div>
        </div>
        '''
    
    asyncio.ensure_future(api.create_window(src=html, name="Similarity Search Results"))

async def visualize_cells_interactive(
    original_image: List[Optional[np.ndarray]],
    segmentation_mask: Any,  # NOW: Accepts np.ndarray OR List[np.ndarray]
    cell_records: Optional[List[Dict[str, Any]]] = None
):
    """Create interactive HTML visualization with colored masks and hover tooltips showing cell metadata."""

    import random
    uid = f"viz_{random.randint(0,999999)}"
    mask_alpha = 0.3
    
    # NEW: Parse mask input - support multi-mask mode
    if isinstance(segmentation_mask, (list, tuple)):
        cell_mask_input = segmentation_mask[0]
        nucleus_mask_input = segmentation_mask[1] if len(segmentation_mask) > 1 else None
    else:
        cell_mask_input = segmentation_mask
        nucleus_mask_input = None
    
    # Ensure mask is numpy array
    if isinstance(cell_mask_input, str):
        mask_bytes = base64.b64decode(cell_mask_input)
        mask_img = PILImage.open(io.BytesIO(mask_bytes))
        segmentation_mask = np.array(mask_img)
    else:
        segmentation_mask = cell_mask_input
    
    # NEW: Convert nucleus mask if provided
    nucleus_mask = None
    if nucleus_mask_input is not None:
        if isinstance(nucleus_mask_input, str):
            mask_bytes = base64.b64decode(nucleus_mask_input)
            mask_img = PILImage.open(io.BytesIO(mask_bytes))
            nucleus_mask = np.array(mask_img)
        else:
            nucleus_mask = nucleus_mask_input
    
    # Determine image dimensions
    first = next((ch for ch in original_image if ch is not None), None)
    if first is None:
        raise ValueError("original_image has no valid channels")
    H, W = first.shape[:2]
    C = len(original_image)

    
    mask = segmentation_mask.astype(np.uint32)
    unique_ids = np.unique(mask[mask > 0])
    n_instances = len(unique_ids)
    
    # Use glasbey colormap - try colorcet first, fallback to tab20
    try:
        import colorcet
        colormap = colorcet.cm['glasbey']
    except (ImportError, KeyError):
        try:
            await micropip.install(["colorcet"])
            import colorcet
            colormap = colorcet.cm['glasbey']
        except:
            import matplotlib.colormaps as cmaps
            colormap = cmaps['tab20']
    
    # Create colored mask (RGBA)
    colored_mask = np.zeros((H, W, 4), dtype=np.uint8)
    for idx, instance_id in enumerate(unique_ids):
        if instance_id == 0:
            continue
        color_value = idx / max(n_instances - 1, 1) if n_instances > 1 else 0
        color_rgba = colormap(color_value)
        color_rgb = tuple(int(c * 255) for c in color_rgba[:3])
        colored_mask[mask == instance_id] = [*color_rgb, int(255 * mask_alpha)]
    
    # Convert mask to base64 PNG (much faster than JSON)
    mask_png = np_to_base64_png(colored_mask, normalize=False)
    
    # NEW: Create nucleus mask overlay if provided (cyan color)
    nucleus_png = None
    if nucleus_mask is not None:
        nucleus_mask = nucleus_mask.astype(np.uint32)
        nucleus_unique_ids = np.unique(nucleus_mask[nucleus_mask > 0])
        colored_nucleus_mask = np.zeros((H, W, 4), dtype=np.uint8)
        for nuc_id in nucleus_unique_ids:
            if nuc_id == 0:
                continue
            # Cyan color for nucleus boundaries with higher alpha
            colored_nucleus_mask[nucleus_mask == nuc_id] = [0, 255, 255, int(255 * 0.6)]
        nucleus_png = np_to_base64_png(colored_nucleus_mask, normalize=False)
    
    # Channel names and colors
    try:
        channel_names = fixed_channel_order[:C]
    except NameError:
        channel_names = [f'Channel {i}' for i in range(C)]
    
    # Short names for buttons
    channel_short_names = ['BF', '405', '488', '638', '561', '730']
    
    
    # Pre-render each channel as PNG (MUCH FASTER than .tolist())
    channel_images_b64 = {}
    available_channels = []
    
    for ch_idx in range(C):
        ch = original_image[ch_idx]
        if ch is None:
            continue
        if ch.max() == 0:
            continue
        available_channels.append(ch_idx)
        if ch.max() > 255:
            norm = (ch.astype(np.float64) / ch.max() * 255).astype(np.uint8)
        else:
            norm = ch.astype(np.uint8)
        if str(ch_idx) in color_map:
            r, g, b = color_map[str(ch_idx)]
            rgb_ch = np.stack([
                (norm * r).astype(np.uint8),
                (norm * g).astype(np.uint8),
                (norm * b).astype(np.uint8)
            ], axis=-1)
        else:
            rgb_ch = np.stack([norm, norm, norm], axis=-1)
        channel_images_b64[ch_idx] = np_to_base64_png(rgb_ch, normalize=False)

    
    # Build cell metadata lookup for hover (use index as cell identity)
    cell_meta_js = {}
    if cell_records:
        # Map directly from cell_records index to unique_ids
        for idx, cell in enumerate(cell_records):
            if idx < len(unique_ids):
                instance_id = unique_ids[idx]
                cell_meta_js[int(instance_id)] = {
                    "index": idx,
                    **{k: v for k, v in cell.items() 
                    if k not in ["image", "clip_embedding", "dino_embedding"]}
                }
    
    # Downsample mask for JS (every 4th pixel) - only small data now
    step = 4
    mask_small = mask[::step, ::step].tolist()
    
    # Build channel buttons HTML
    channel_buttons_html = ""
    for ch_idx in available_channels:
        short_name = channel_short_names[ch_idx] if ch_idx < len(channel_short_names) else f'Ch{ch_idx}'
        bg_color = "#007bff"  # All channels start active
        channel_buttons_html += f'''
            <button id="{uid}_ch{ch_idx}" onclick="toggleChannel({ch_idx})" 
                    style="padding:4px 12px;margin-right:4px;background:{bg_color};color:#fff;border:none;border-radius:3px;cursor:pointer;">
                {short_name}
            </button>
        '''
    
    # Build channel images object for JavaScript
    channel_imgs_js = {ch_idx: f"data:image/png;base64,{img_b64}" 
                       for ch_idx, img_b64 in channel_images_b64.items()}
    
    # Default: all channels active
    initial_active = available_channels
    
    html = f'''
    <div id="{uid}" style="font-family:Arial,sans-serif;">
        <div style="margin-bottom:8px;">
            {channel_buttons_html}
            <button id="{uid}_on" onclick="toggleMask(true)" 
                    style="padding:4px 12px;margin-right:4px;background:#007bff;color:#fff;border:none;border-radius:3px;cursor:pointer;">
                Mask ON
            </button>
            <button id="{uid}_off" onclick="toggleMask(false)" 
                    style="padding:4px 12px;background:#6c757d;color:#fff;border:none;border-radius:3px;cursor:pointer;">
                Mask OFF
            </button>
            {f"""
            <button id="{uid}_nuc_on" onclick="toggleNucleus(true)" 
                    style="padding:4px 12px;margin-left:8px;background:#17a2b8;color:#fff;border:none;border-radius:3px;cursor:pointer;">
                Nuclei ON
            </button>
            <button id="{uid}_nuc_off" onclick="toggleNucleus(false)" 
                    style="padding:4px 12px;background:#6c757d;color:#fff;border:none;border-radius:3px;cursor:pointer;">
                Nuclei OFF
            </button>
            """ if nucleus_png else ''}
        </div>
        <div style="position:relative;display:inline-block;">
            <canvas id="{uid}_canvas" width="{W}" height="{H}" style="max-width:500px;display:block;"></canvas>
            <div id="{uid}_tip" style="display:none;position:absolute;background:rgba(0,0,0,0.8);color:#fff;padding:6px 10px;border-radius:4px;font-size:11px;pointer-events:none;white-space:pre;z-index:10;"></div>
        </div>
    </div>
    <script>
    (function() {{
        const canvas = document.getElementById("{uid}_canvas");
        const ctx = canvas.getContext("2d");
        const tip = document.getElementById("{uid}_tip");
        const btnOn = document.getElementById("{uid}_on");
        const btnOff = document.getElementById("{uid}_off");
        const meta = {json.dumps(cell_meta_js)};
        const mask = {json.dumps(mask_small)};
        const step = {step};
        const W = {W};
        const H = {H};
        const hasNucleus = {json.dumps(nucleus_png is not None)};
        
        // Load channel images
        const channelImagesData = {json.dumps(channel_imgs_js)};
        const channelImages = {{}};
        const maskImg = new Image();
        const nucleusImg = hasNucleus ? new Image() : null;
        let imagesLoaded = 0;
        const totalImages = Object.keys(channelImagesData).length + 1 + (hasNucleus ? 1 : 0);
        
        // Load mask image
        maskImg.onload = () => {{
            imagesLoaded++;
            if (imagesLoaded === totalImages) updateImage();
        }};
        maskImg.src = "data:image/png;base64,{mask_png}";
        
        // Load nucleus image if available
        if (hasNucleus) {{
            nucleusImg.onload = () => {{
                imagesLoaded++;
                if (imagesLoaded === totalImages) updateImage();
            }};
            nucleusImg.src = "data:image/png;base64,{nucleus_png if nucleus_png else ''}";
        }}
        
        // Load channel images
        for (const [chIdx, imgSrc] of Object.entries(channelImagesData)) {{
            const img = new Image();
            img.onload = () => {{
                imagesLoaded++;
                if (imagesLoaded === totalImages) updateImage();
            }};
            img.src = imgSrc;
            channelImages[chIdx] = img;
        }}
        
        let activeChannels = {json.dumps(initial_active)};
        let showMask = true;
        let showNucleus = hasNucleus;
        
        window.toggleChannel = function(channelIdx) {{
            const idx = activeChannels.indexOf(channelIdx);
            if (idx === -1) {{
                activeChannels.push(channelIdx);
            }} else {{
                activeChannels.splice(idx, 1);
            }}
            updateImage();
            
            const btn = document.getElementById("{uid}_ch" + channelIdx);
            if (btn) {{
                btn.style.background = (idx === -1) ? "#007bff" : "#6c757d";
            }}
        }};
        
        window.toggleMask = function(on) {{
            showMask = on;
            updateImage();
            btnOn.style.background = on ? "#007bff" : "#6c757d";
            btnOff.style.background = on ? "#6c757d" : "#007bff";
        }};
        
        if (hasNucleus) {{
            const btnNucOn = document.getElementById("{uid}_nuc_on");
            const btnNucOff = document.getElementById("{uid}_nuc_off");
            
            window.toggleNucleus = function(on) {{
                showNucleus = on;
                updateImage();
                btnNucOn.style.background = on ? "#17a2b8" : "#6c757d";
                btnNucOff.style.background = on ? "#6c757d" : "#17a2b8";
            }};
        }}
        
        function updateImage() {{
            // Clear canvas
            ctx.clearRect(0, 0, W, H);
            
            // Use 'lighter' blend mode for additive compositing (GPU-accelerated!)
            ctx.globalCompositeOperation = 'lighter';
            
            // Draw all active channels with additive blending
            for (const chIdx of activeChannels) {{
                const img = channelImages[chIdx];
                if (img && img.complete) {{
                    ctx.drawImage(img, 0, 0, W, H);
                }}
            }}
            
            // Draw mask overlay
            if (showMask && maskImg.complete) {{
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(maskImg, 0, 0, W, H);
            }}
            
            // Draw nucleus overlay
            if (hasNucleus && showNucleus && nucleusImg && nucleusImg.complete) {{
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(nucleusImg, 0, 0, W, H);
            }}
        }}
        
        canvas.onmousemove = (e) => {{
        const rect = canvas.getBoundingClientRect();
        const scaleX = W / rect.width;
        const scaleY = H / rect.height;
        const x = Math.floor((e.clientX - rect.left) * scaleX);
        const y = Math.floor((e.clientY - rect.top) * scaleY);
        const mx = Math.floor(x / step), my = Math.floor(y / step);
        if (my >= 0 && my < mask.length && mx >= 0 && mx < mask[0].length) {{
            const id = mask[my][mx];
            if (id > 0 && meta[id]) {{
                const m = meta[id];
                let txt = \`Cell \${{m.index}}\`;
                
                // Morphological features
                if (m.area != null) txt += \`\\\\nArea: \${{m.area.toFixed(1)}}\`;
                if (m.perimeter != null) txt += \`\\\\nPerimeter: \${{m.perimeter.toFixed(1)}}\`;
                if (m.equivalent_diameter != null) txt += \`\\\\nEq Diameter: \${{m.equivalent_diameter.toFixed(2)}}\`;
                if (m.bbox_width != null) txt += \`\\\\nBBox W: \${{m.bbox_width.toFixed(1)}}\`;
                if (m.bbox_height != null) txt += \`\\\\nBBox H: \${{m.bbox_height.toFixed(1)}}\`;
                if (m.aspect_ratio != null) txt += \`\\\\nAspect Ratio: \${{m.aspect_ratio.toFixed(3)}}\`;
                if (m.circularity != null) txt += \`\\\\nCircularity: \${{m.circularity.toFixed(3)}}\`;
                if (m.eccentricity != null) txt += \`\\\\nEccentricity: \${{m.eccentricity.toFixed(3)}}\`;
                if (m.solidity != null) txt += \`\\\\nSolidity: \${{m.solidity.toFixed(3)}}\`;
                if (m.convexity != null) txt += \`\\\\nConvexity: \${{m.convexity.toFixed(3)}}\`;
                
                // Texture features
                if (m.brightness != null) txt += \`\\\\nBrightness: \${{m.brightness.toFixed(3)}}\`;
                
                // Fluorescence intensity features - show ALL available fields
                for (const key in m) {{
                    // Cell intensities
                    if (key.startsWith('mean_intensity_') && key.endsWith('_cell') && m[key] != null) {{
                        const channelName = key.replace('mean_intensity_', '').replace('_cell', '').replace(/_/g, ' ');
                        txt += \`\\\\n\${{channelName}} (cell): \${{m[key].toFixed(1)}}\`;
                    }}
                    // Nucleus intensities
                    if (key.startsWith('mean_intensity_') && key.endsWith('_nucleus') && m[key] != null) {{
                        const channelName = key.replace('mean_intensity_', '').replace('_nucleus', '').replace(/_/g, ' ');
                        txt += \`\\\\n\${{channelName}} (nuc): \${{m[key].toFixed(1)}}\`;
                    }}
                    // Cytosol intensities
                    if (key.startsWith('mean_intensity_') && key.endsWith('_cytosol') && m[key] != null) {{
                        const channelName = key.replace('mean_intensity_', '').replace('_cytosol', '').replace(/_/g, ' ');
                        txt += \`\\\\n\${{channelName}} (cyto): \${{m[key].toFixed(1)}}\`;
                    }}
                    // Ratios
                    if (key.startsWith('ratio_') && key.endsWith('_nuc_cyto') && m[key] != null) {{
                        const channelName = key.replace('ratio_', '').replace('_nuc_cyto', '').replace(/_/g, ' ');
                        txt += \`\\\\n\${{channelName}} (N/C): \${{m[key].toFixed(2)}}\`;
                    }}
                    // Top10 intensities (backward compatible)
                    if (key.startsWith('top10_mean_intensity_') && m[key] != null) {{
                        const channelName = key.replace('top10_mean_intensity_', '').replace(/_/g, ' ');
                        txt += \`\\\\nTop 10% \${{channelName}}: \${{m[key].toFixed(1)}}\`;
                    }}
                }}
                
                tip.textContent = txt;
                tip.style.display = "block";
                tip.style.left = (e.clientX - rect.left + 10) + "px";
                tip.style.top = (e.clientY - rect.top + 10) + "px";
                return;
            }}
        }}
        tip.style.display = "none";
    }};
    canvas.onmouseleave = () => {{ tip.style.display = "none"; }};
    }})();
    </script>
    '''
    asyncio.ensure_future(api.create_window(src=html, name="Image Segmentation"))

import pandas as pd
import matplotlib.pyplot as plt

def show_matplotlib_fig(fig, name: str, dpi: int = 200, max_width: str = "100%") -> None:
    """Display matplotlib figure via asyncio.ensure_future(api.create_window()). DO NOT use plt.show()."""
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight")
    plt.close(fig)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    asyncio.ensure_future(api.create_window(
        src=(
            f'<div style="text-align:center;">'
            f'<img src="data:image/png;base64,{b64}" style="max-width:{max_width};"/>'
            f"</div>"
        ),
        name=name
    ))

# System Prompts, Workflow Templates, and Utility Functions

# Build DataFrame utility
def build_df_from_records(
    records: List[Dict],
    *,
    distance_key: str = "distance_from_center",
    well_id_key: str = "well_id",
    fallback_well_from_position: bool = True,
    exclude_keys: Optional[List[str]] = None,
) -> pd.DataFrame:
    """Convert cell_records to DataFrame with ALL available data fields."""
    default_exclude = {
        "image",
        "clip_embedding",
        "dino_embedding",
    }
    
    if exclude_keys:
        default_exclude.update(exclude_keys)
    
    def _safe_float(v):
        try:
            if v is None:
                return np.nan
            return float(v)
        except Exception:
            return np.nan
    
    def _safe_value(v):
        if v is None:
            return None
        if isinstance(v, (int, float, str, bool)):
            return v
        if isinstance(v, dict):
            return str(v)
        if isinstance(v, (list, tuple)):
            if len(v) < 10:
                return str(v)
            return None
        return str(v)

    rows = []
    for idx, c in enumerate(records):
        pos = c.get("position", {}) or {}

        wid = c.get(well_id_key, None)
        if (wid is None) and fallback_well_from_position:
            wr = pos.get("well_row", None)
            wc = pos.get("well_col", None)
            if (wr is not None) and (wc is not None):
                wid = f"{wr}{wc}"
        if wid is None:
            wid = "well_1"

        d = _safe_float(c.get(distance_key, np.nan))

        row = {
            "cell_index": idx,
            "well_id": wid,
            "distance_mm": d,
        }
        
        if pos:
            for pos_key, pos_val in pos.items():
                if isinstance(pos_val, (int, float)):
                    row[pos_key] = _safe_float(pos_val)
                else:
                    row[pos_key] = pos_val

        for key, value in c.items():
            if key in default_exclude:
                continue
            if key == "position":
                continue
            if key == well_id_key and key in row:
                continue
            
            if any(substring in key.lower() for substring in [
                "intensity", "area", "perimeter", "diameter", "width", "height",
                "ratio", "circularity", "eccentricity", "solidity", "convexity",
                "brightness", "contrast", "homogeneity", "energy", "correlation",
                "similarity", "score", "distance", "index"
            ]):
                row[key] = _safe_float(value)
            else:
                row[key] = _safe_value(value)

        rows.append(row)

    df = pd.DataFrame(rows)

    if distance_key in df.columns or "distance_mm" in df.columns:
        df = df[np.isfinite(df["distance_mm"])].copy()

    return df


# System Prompts
SYSTEM_PROMPT_1 = """
You are an AI microscope-control agent for Agent-Lens with Vector Database integration.

PRIMARY ROLE
- Drive the microscope: navigate to wells, autofocus, move to positions (FoVs), snap images (BF + fluorescence), and run scans.
- Do on-the-fly analysis: segmentation, single-cell metadata extraction, similarity search, basic plotting/visualization as requested.
- variable 'microscope' is the microscope object, 'agent_lens_service' is the agent lens service object. Other variables are defined in the environment already(color_map, fixed_channel_order, microscope_id, etc).

STRICT OUTPUT RULES
- Respond with ONLY executable Python code for this Jupyter notebook (no prose).
- Respond with direct code, do not wrap code in functions or classes.
- Any figure/image output MUST be displayed using asyncio.ensure_future(api.create_window(src=html, name=name)) or pre-defined display functions.
- DO NOT use 'await api.create_window()' - it will block execution.
- DO NOT rely on plt.show() or Display().
- For microscope actions, use the provided async tools (await microscope.* / await snap_image / await segment_image / await agent_lens_service.build_cell_records / etc).
- Write a linear, top-to-bottom notebook script. DO NOT define new functions or classes unless necessary.
- Minimize stdout. Do NOT print large objects (images/arrays, full records lists, full tool schemas, full microscope status dicts).
- Only print short progress messages (1 line) and small scalar summaries.

WORKING STYLE
- Default to minimal steps that answer the user's request.
- Reuse existing variables and helper functions already defined in the notebook.
- If a request depends on missing prerequisites, create the needed data first, then proceed.

DATA CONVENTIONS
- color_map is a dict of channel number to RGB tuple (0-255, 0-255, 0-255)
- - default 
color_map = {
    "0": (1.0, 1.0, 1.0),  # BF: gray
    "1": (0.0, 0.0, 1.0),  # 405nm: blue
    "2": (0.0, 1.0, 0.0),  # 488nm: green
    "3": (1.0, 1.0, 0.0),  # 638nm: yellow
    "4": (1.0, 0.0, 0.0),  # 561nm: red
}
You can re-define 'color_map' variable based on user instructions
- raw_image is multi-channel, list of numpy arrays for different channel.
- raw_image and norm_image are always the same shape and channels order. 0: BF, 1: 405nm, 2: 488nm, 3: 638nm, 4: 561nm
- cell_records are lists of dicts with fields:
  - uuid: Unique cell identifier
  - image: merged composite image (50x50). Note: This is empty, you need to use 'agent_lens_service.fetch_cell_data()' to get complete cell data, which includes the image.
  - morphology: area, aspect_ratio, circularity, solidity, eccentricity...
  - position info: 'position[x]', 'position[y]', 'distance_from_center', 'well_id'
  - optional image crops: 'image' (merged composite)
  - cell_records intensity features:
    * Single mask mode: mean_intensity_<channel>_cell, top10_mean_intensity_<channel>
    * Multi-mask mode (when nucleus mask provided):
        - mean_intensity_<channel>_cell
        - mean_intensity_<channel>_nucleus  
        - mean_intensity_<channel>_cytosol
        - ratio_<channel>_nuc_cyto (nucleus-to-cytosol ratio)

VECTOR DATABASE SIMILARITY SEARCH
- Use similarity_search_with_filters() for backward-compatible filtering
- Or use agent_lens_service.similarity_search_cells() directly for vector database native search
- Supports native metadata filtering using vector database where clause syntax
- Returns cells with similarity_score (0-1, higher is more similar)

ANALYSIS CAPABILITIES YOU MUST SUPPORT (WHEN ASKED)
- Quick inspection: show raw/normalized images; show segmentation overlay; interactive cell viewer (visualize_cells_interactive).
- Similarity search: user selects query cell(s) from cell_records; run similarity_search_with_filters or similarity_search_cells; show_similarity_results.
- Spatial analysis: plot cell density, morphology metrics, or custom classifications vs distance from well center.
- Custom cell classification: user can define subpopulations based on any combination of intensity/morphology features.
- Multi-well statistics: aggregate metrics across wells with mean±SEM error bars.
- Intensity metric policy: When gating by fluorescence, compute both mean and top10 metrics if available.

DISPLAY REQUIREMENT
- Any matplotlib figure must be encoded to html and shown via api.create_window(src=html, name=name). # no await

DEFAULT SAFETY / HYGIENE
- Validate required keys/columns before use; if missing, fall back gracefully.
- Close matplotlib figures after saving/encoding.
"""
print(SYSTEM_PROMPT_1)

print("---")
print(f"The microscope has the following channels: {fixed_channel_order}")
print("---")
# Print available tools
print("\\n" + "="*80)
print("AVAILABLE FUNCTIONS:")
print("="*80)
#print micrscope schema_tool decorator
microscope_tools = [json.dumps(tool.__schema__, indent=2) for tool in microscope.values() if callable(tool)]
print(f"This microscope has the following tools: {microscope_tools}")

agent_lens_tools = [json.dumps(tool.__schema__, indent=2) for tool in agent_lens_service.values() if callable(tool)]
print(f"Agent Lens service has the following tools: {agent_lens_tools}")

def print_tool_doc(func):
    print("---")
    print(f"Function: {func.__name__}")
    print(func.__doc__)
    print("---")


print_tool_doc(snap_image)
print_tool_doc(percentile_normalize)
print_tool_doc(overlay)
print_tool_doc(segment_image)
print_tool_doc(make_stage_offsets)
print_tool_doc(similarity_search_with_filters)
print_tool_doc(show_similarity_results)
print_tool_doc(show_matplotlib_fig)
print_tool_doc(build_df_from_records)
print_tool_doc(wait_for_snap_segment_extract)

# Workflow Templates
SYSTEM_PROMPT_2 = """
WORKFLOW TEMPLATES

----------------------------------------------------------------------
0) TAKE A LOOK (Navigate → Focus → Snap → Segment → View)
----------------------------------------------------------------------

await microscope.navigate_to_well('B', 2, well_plate_type='96')
await microscope.reflection_autofocus()

# If user asked for Brightfield, 488nm, 561nm channels
channel_config = [
  {"channel": "BF_LED_matrix_full", "exposure_time": 10, "intensity": 20},
  {"channel": "Fluorescence_488_nm_Ex", "exposure_time": 100, "intensity": 60},
  {"channel": "Fluorescence_561_nm_Ex", "exposure_time": 100, "intensity": 60},
]

raw_image = await snap_image(channel_config)
norm_image = percentile_normalize(raw_image) # The channels order is always the same as fixed_channel_order
seg_mask = await segment_image(norm_image, scale = 5)

# If nucleus channel is available, segment nuclei
# nucleus_mask = await segment_image(norm_image[1])  # If user told you 405nm channel is for nucleus, 405nm is always the SECOND channel of 'fixed_channel_order' and 'norm_image', will not changed by channel_config

status = await microscope.get_status()
cell_records = await agent_lens_service.build_cell_records(
    raw_image, seg_mask, status, application_id="hypha-agents-notebook", color_map=color_map
)
# If nucleus channel is available, segment nuclei
# cell_records = await agent_lens_service.build_cell_records(
#     raw_image, 
#     [cell_mask, nucleus_mask],  # Pass as list for multi-mask mode
#     status, 
#     application_id="hypha-agents-notebook",
#     color_map=color_map
# )

await visualize_cells_interactive(
  original_image=norm_image,
  segmentation_mask=seg_mask,
  cell_records=cell_records,
)
# If nucleus channel is available, visualize nuclei also
# await visualize_cells_interactive(
#   original_image=norm_image,
#   segmentation_mask=[cell_mask, nucleus_mask],
#   cell_records=cell_records,
# )

print(f"Found {len(cell_records)} cells")

----------------------------------------------------------------------
1) FIND SIMILAR CELLS (Backward-Co
patible API)
----------------------------------------------------------------------

# Extract query cell
query_cell_indices = [81]
query_cell_records = [cell_records[i] for i in query_cell_indices if i < len(cell_records)]

# Old-style filter configuration (backward compatible)
relative_config = {
    "size_tolerance": 0.4,
    "circularity_tol": 0.15,
    "eccentricity_tol": 0.15,
    "solidity_tol": 0.1,
    "aspect_ratio_tol": 0.3,
}

range_config = {} # Default is empty, no range filtering
# Example if range is needed
# range_config = {"top10_mean_intensity_Fluorescence_488_nm_Ex_cell": {"min": 15}}



similarity_config = {
    "final_score_threshold": 0.7,
}

# Use backward-compatible function
similar_cells = await similarity_search_with_filters(
    query_cell_records=query_cell_records,
    relative_config=relative_config,
    range_config=range_config,
    similarity_config=similarity_config,
    n_results=100
)

print(f"Found {len(similar_cells)} similar cells")
show_similarity_results(query_cell_records, similar_cells, max_examples=20)

----------------------------------------------------------------------
1b) FIND SIMILAR CELLS (Direct Vector Database API)
----------------------------------------------------------------------

# Extract query UUIDs
query_uuids = [cell["uuid"] for cell in query_cell_records]

# Direct Vector Database where clause
similar_cells = await agent_lens_service.similarity_search_cells(
    query_cell_uuids=query_uuids,
    application_id="hypha-agents-notebook",
    n_results=100,
    metadata_filters={
        "$and": [
            {"area": {"$gt": 200, "$lt": 3000}},
            {"circularity": {"$gte": 0.7}},
            {"top10_mean_intensity_Fluorescence_488_nm_Ex_cell": {"$gte": 15}}
        ]
    },
    similarity_threshold=0.7
)

show_similarity_results(query_cell_records, similar_cells, max_examples=20)

----------------------------------------------------------------------
2) SCAN WITH SIMILARITY SEARCH
----------------------------------------------------------------------

rows = ("B", "C", "D")
cols = tuple(range(2, 5))
wells = [f"{row}{col}" for row in rows for col in cols]

grid_size = 3
well_offsets = make_stage_offsets(grid_size=grid_size, step_mm=1.0)

channel_config = [
    {"channel": "Fluorescence_488_nm_Ex", "exposure_time": 100, "intensity": 60},
    {"channel": "Fluorescence_561_nm_Ex", "exposure_time": 100, "intensity": 60},
    {"channel": "BF_LED_matrix_full", "exposure_time": 10, "intensity": 20},

]

all_cell_records = []
resp = await agent_lens_service.snap_segment_extract_put_queue(
    microscope_id=microscope_id,
    channel_config=channel_config,
    application_id=application_id,
    scale=5,
    wells=wells,
    well_offset=well_offset,
    well_plate_type="96",
    nucleus_channel_name="Fluorescence_405_nm_Ex", # If user TOLD you 405nm channel is for nucleus, otherwise None
    color_map=color_map,
)
print(f"Queued {len(wells)} wells with {len(well_offset)} positions each")
print(f"Total FoVs: {len(wells) * len(well_offset)} (queue size={resp['queue_size']})")
print(f"Queuing took {time.time()-t0:.2f}s")

# Wait for all jobs to complete
print('Waiting for all snap+segment+extract jobs to finish...')
result_cell_records = await wait_for_snap_segment_extract(agent_lens_service)
all_cell_records.extend(result_cell_records)

print(f'Total cells extracted: {len(all_cell_records)}')

# Now search for similar cells
similar_cells = await similarity_search_with_filters(
    query_cell_records=query_cell_records,
    relative_config=relative_config,
    range_config=range_config,
    similarity_config=similarity_config,
    n_results=100
)

show_similarity_results(query_cell_records, similar_cells, max_examples=20)

----------------------------------------------------------------------
3) SPATIAL ANALYSIS
----------------------------------------------------------------------

df = build_df_from_records(all_scanned_cell_records)
metric = "area"

bin_w = 0.25
bins = np.arange(0, df["distance_mm"].max() + bin_w, bin_w)
bin_centers = 0.5 * (bins[:-1] + bins[1:])

df["r_bin"] = pd.cut(df["distance_mm"], bins=bins, include_lowest=True)

per_well = (
  df.groupby(["well_id", "r_bin"])[metric]
    .mean()
    .unstack("r_bin")
)

mean_curve = per_well.mean(axis=0).to_numpy()
sem_curve = per_well.sem(axis=0, ddof=1).to_numpy()

fig, ax = plt.subplots(figsize=(5, 4))
ax.errorbar(bin_centers, mean_curve, yerr=sem_curve, marker="o", linewidth=2, capsize=2)
ax.set_xlabel("Distance from well center (mm)")
ax.set_ylabel(metric)
ax.grid(True, alpha=0.25, linestyle="--")
show_matplotlib_fig(fig, name="Spatial Analysis")

REMINDER
- Use show_matplotlib_fig(fig, name=name) to display plots
- Use build_df_from_records() for DataFrame creation
- Use similarity_search_with_filters() for backward compatibility
"""


print(SYSTEM_PROMPT_2)

print("\\n" + "="*80)
print("✓ All functions and templates loaded!")
print("✓ Ready for AI agent control")
print("="*80)`;
