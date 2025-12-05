# make sure you have umap-learn and scikit-learn installed:
# pip install umap-learn scikit-learn plotly

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
import io
import base64
import os
from typing import Optional, List, Dict
from umap import UMAP
from PIL import Image
from sklearn.cluster import KMeans

try:
    import plotly.graph_objects as go
    import plotly.express as px
    PLOTLY_AVAILABLE = True
except ImportError:
    PLOTLY_AVAILABLE = False


def fig_to_base64(fig) -> str:
    """
    Convert a matplotlib figure to base64 PNG string.
    
    Args:
        fig: matplotlib figure object
    
    Returns:
        Base64-encoded PNG string
    """
    buf = io.BytesIO()
    fig.savefig(buf, format='png', dpi=100, bbox_inches='tight')
    buf.seek(0)
    img_base64 = base64.b64encode(buf.read()).decode('utf-8')
    plt.close(fig)  # Close figure to free memory
    return img_base64


def resize_image_base64(image_b64: str, size: tuple = (50, 50)) -> Optional[str]:
    """
    Resize a base64-encoded image to a thumbnail.
    
    Args:
        image_b64: Base64-encoded image string (without data URI prefix)
        size: Target size as (width, height) tuple (default: 50x50)
    
    Returns:
        Base64-encoded resized image, or None if failed
    """
    try:
        # Decode base64 to bytes
        image_bytes = base64.b64decode(image_b64)
        
        # Open image with PIL
        img = Image.open(io.BytesIO(image_bytes))
        
        # Resize with high-quality resampling
        # Use LANCZOS for Pillow >= 10.0, ANTIALIAS for older versions
        try:
            resample = Image.Resampling.LANCZOS
        except AttributeError:
            resample = Image.LANCZOS
        
        img.thumbnail(size, resample)
        
        # Convert back to base64
        buf = io.BytesIO()
        img.save(buf, format='PNG', optimize=True)
        buf.seek(0)
        resized_b64 = base64.b64encode(buf.read()).decode('utf-8')
        
        return resized_b64
    except Exception as e:
        print(f"⚠️ Failed to resize image: {e}")
        return None


def make_umap_cluster_figure_base64(
    all_cells: list,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    random_state: Optional[int] = None,
    n_jobs: Optional[int] = 10,
) -> Optional[str]:
    """
    Pure UMAP clustering of ALL cell embeddings (cosine metric).
    Uses all provided cells without filtering.
    
    Note: If random_state is set, UMAP will use single-threaded execution.
    For parallelism, set random_state=None and n_jobs=-1 (uses all CPU cores).

    Args:
        all_cells: List of cell dictionaries, each should have 'embedding_vector' key
        n_neighbors: Number of neighbors for UMAP (default: 15)
        min_dist: Minimum distance for UMAP (default: 0.1)
        random_state: Random state for reproducibility. If None, allows parallelism (default: None)
        n_jobs: Number of parallel jobs. -1 uses all CPU cores, None uses 1 (default: None)

    Returns:
        base64 PNG string of the cluster plot, or None.
    """
    if not all_cells:
        return None

    # --- Collect embeddings only ---
    embeddings = []
    for c in all_cells:
        if "embedding_vector" in c:
            embeddings.append(np.array(c["embedding_vector"], dtype=float))

    if len(embeddings) < 5:
        print("⚠️ Too few cells with embeddings → clustering skipped.")
        return None

    E = np.vstack(embeddings)   # (N, D)

    # --- Normalize (optional but good for cosine) ---
    norms = np.linalg.norm(E, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    E = E / norms

    # --- UMAP embedding (cosine metric) ---
    # Set n_jobs: -1 for all cores if random_state is None, otherwise use 1
    # (UMAP forces single-threaded when random_state is set)
    if n_jobs is None:
        n_jobs = -1 if random_state is None else 1
    
    umap_model = UMAP(
        n_components=2,
        n_neighbors=min(n_neighbors, len(E) - 1),
        min_dist=min_dist,
        metric="cosine",
        random_state=random_state,
        n_jobs=n_jobs,
    )
    X_2d = umap_model.fit_transform(E)

    # --- Clustering on 2D UMAP coordinates ---
    # Determine number of clusters (use sqrt of sample size, but between 2 and 10)
    n_samples = len(X_2d)
    n_clusters = max(2, min(10, int(np.sqrt(n_samples / 2))))
    
    kmeans = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=10)
    cluster_labels = kmeans.fit_predict(X_2d)

    # --- Plot with cluster colors ---
    fig, ax = plt.subplots(figsize=(6, 5))
    
    # Use a colormap to assign different colors to each cluster
    # Normalize cluster labels to [0, 1] range for colormap
    norm = Normalize(vmin=0, vmax=n_clusters - 1)
    cmap = plt.cm.tab10
    colors = cmap(norm(cluster_labels))
    
    ax.scatter(
        X_2d[:, 0],
        X_2d[:, 1],
        s=25,
        c=colors,
        alpha=0.7,
        edgecolors='white',
        linewidths=0.5,
    )

    ax.set_title(f"UMAP clustering (cosine distance, {n_clusters} clusters)")
    ax.set_xlabel("UMAP-1")
    ax.set_ylabel("UMAP-2")
    fig.tight_layout()

    return fig_to_base64(fig)


# Default metadata fields for heatmap visualization tabs
DEFAULT_METADATA_FIELDS = [
    'area', 'perimeter', 'equivalent_diameter',
    'aspect_ratio', 'circularity', 'eccentricity', 'solidity', 'convexity',
    'brightness', 'contrast', 'homogeneity', 'energy', 'correlation'
]


def make_umap_cluster_figure_interactive(
    all_cells: list,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    random_state: Optional[int] = None,
    n_jobs: Optional[int] = None,
    metadata_fields: Optional[List[str]] = None,
) -> Optional[str]:
    """
    Interactive UMAP visualization using Plotly with switchable coloring modes.
    Returns HTML string that can be embedded in a webpage.
    
    This function performs UMAP dimensionality reduction followed by KMeans clustering.
    Users can switch between cluster coloring and metadata heatmaps using tab buttons.
    
    Features:
    - Zoom and pan
    - Hover to see cell details (ID, area, etc.) with cell image thumbnail
    - Tab buttons to switch between Cluster view and metadata heatmaps
    - Turbo colormap for metadata heatmaps with colorbar
    - Export as PNG/SVG
    
    Args:
        all_cells: List of cell dictionaries with 'embedding_vector' key (and optionally 'id', 'area', etc.)
        n_neighbors: Number of neighbors for UMAP (default: 15)
        min_dist: Minimum distance for UMAP (default: 0.1)
        random_state: Random state for reproducibility. If None, allows parallelism (default: None)
        n_jobs: Number of parallel jobs. -1 uses all CPU cores (default: None)
        metadata_fields: List of metadata field names for heatmap tabs. If None, uses DEFAULT_METADATA_FIELDS
    
    Returns:
        HTML string of interactive Plotly figure with tab controls, or None if failed
    """
    # Use default metadata fields if not provided
    if metadata_fields is None:
        metadata_fields = DEFAULT_METADATA_FIELDS
    if not PLOTLY_AVAILABLE:
        print("⚠️ Plotly not available. Install with: pip install plotly")
        return None
    
    if not all_cells:
        return None
    
    # --- Collect embeddings and metadata ---
    embeddings = []
    cell_data = []
    
    print(f"🔄 Processing {len(all_cells)} cells...")
    for idx, c in enumerate(all_cells):
        if "embedding_vector" in c:
            embeddings.append(np.array(c["embedding_vector"], dtype=float))
            
            # Extract all metadata - check both direct fields and nested 'metadata' dict
            # First try direct access (new format), then try nested 'metadata' dict (old format)
            def get_field(field_name):
                """Get field value from cell, checking both direct and nested metadata."""
                if field_name in c and c[field_name] is not None:
                    return c[field_name]
                metadata = c.get("metadata", {})
                if metadata and field_name in metadata:
                    return metadata[field_name]
                return None
            
            # Resize image to 50x50 thumbnail if available
            image_b64_original = c.get("image", None)
            image_b64_thumbnail = None
            if image_b64_original:
                image_b64_thumbnail = resize_image_base64(image_b64_original, size=(50, 50))
                if image_b64_thumbnail and idx == 0:
                    print(f"✓ Resized images to 50x50 thumbnails (original: {len(image_b64_original)/1024:.1f}KB → thumbnail: {len(image_b64_thumbnail)/1024:.1f}KB)")
            
            # Handle None values explicitly
            well_row = c.get("well_row")
            well_col = c.get("well_col")
            field_index = c.get("field_index")
            cell_index = c.get("cell_index") or c.get("field_cell_index")
            
            cell_info = {
                "index": idx,
                "id": c.get("id") or c.get("cell_id") or f"cell_{idx}",
                "image_b64": image_b64_thumbnail,
                "well_row": well_row if well_row is not None else "?",
                "well_col": well_col if well_col is not None else "?",
                "field_index": field_index if field_index is not None else "?",
                "cell_index": cell_index if cell_index is not None else "?",
            }
            
            # Extract all metadata fields
            for field in metadata_fields:
                val = get_field(field)
                try:
                    cell_info[field] = float(val) if val is not None else 0.0
                except (TypeError, ValueError):
                    cell_info[field] = 0.0
            
            # Extract fluorescence intensity fields (mean_intensity_*)
            for key in c:
                if key.startswith('mean_intensity_'):
                    val = c.get(key)
                    try:
                        cell_info[key] = float(val) if val is not None else None
                    except (TypeError, ValueError):
                        cell_info[key] = None
            # Also check nested metadata for fluorescence fields
            metadata = c.get("metadata", {})
            if metadata:
                for key in metadata:
                    if key.startswith('mean_intensity_'):
                        val = metadata.get(key)
                        try:
                            cell_info[key] = float(val) if val is not None else None
                        except (TypeError, ValueError):
                            cell_info[key] = None
            
            cell_data.append(cell_info)
    
    if len(embeddings) < 5:
        print("⚠️ Too few cells with embeddings → clustering skipped.")
        return None
    
    E = np.vstack(embeddings)   # (N, D)
    
    # --- Normalize ---
    norms = np.linalg.norm(E, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    E = E / norms
    
    # --- UMAP embedding ---
    if n_jobs is None:
        n_jobs = -1 if random_state is None else 1
    
    print(f"🔄 Computing UMAP embedding...")
    umap_model = UMAP(
        n_components=2,
        n_neighbors=min(n_neighbors, len(E) - 1),
        min_dist=min_dist,
        metric="cosine",
        random_state=random_state,
        n_jobs=n_jobs,
    )
    X_2d = umap_model.fit_transform(E)
    
    # --- Clustering on 2D UMAP coordinates ---
    n_samples = len(X_2d)
    n_clusters = max(2, min(10, int(np.sqrt(n_samples / 2))))
    
    print(f"🔄 Computing {n_clusters} clusters...")
    kmeans = KMeans(n_clusters=n_clusters, random_state=random_state, n_init=10)
    cluster_labels = kmeans.fit_predict(X_2d)
    
    # --- Helper functions ---
    def safe_str(val, default="?"):
        if val is None:
            return str(default)
        try:
            result = str(val)
            return result if result else str(default)
        except (TypeError, ValueError):
            return str(default)
    
    def safe_float(val, default=0.0, fmt=".1f"):
        if val is None:
            return "N/A"
        try:
            return f"{float(val):{fmt}}"
        except (TypeError, ValueError):
            return "N/A"
    
    # --- Build hover text ---
    hover_text = []
    for i, cell in enumerate(cell_data):
        well_row_str = safe_str(cell.get('well_row'))
        well_col_str = safe_str(cell.get('well_col'))
        field_index_str = safe_str(cell.get('field_index'))
        cell_index_str = safe_str(cell.get('cell_index'))
        
        # Build fluorescence intensity lines dynamically
        fluo_lines = ""
        for key in cell:
            if key.startswith('mean_intensity_') and cell.get(key) is not None:
                channel_name = key.replace('mean_intensity_', '').replace('_', ' ')
                # Shorten channel names for display
                if 'Fluorescence' in channel_name:
                    channel_name = channel_name.replace('Fluorescence ', '').replace(' nm Ex', 'nm')
                fluo_lines += f"  {channel_name}: {safe_float(cell.get(key), None, '.1f')}<br>"
        
        text = (
            f"<span style='font-size:9px;'>"
            f"<b>Well {well_row_str}{well_col_str}, Field {field_index_str}, Cell {cell_index_str}</b><br>"
            f"<br>"
            f"<b>Morphology:</b><br>"
            f"  Area: {safe_float(cell.get('area'), 0.0, '.1f')} px²<br>"
            f"  Perimeter: {safe_float(cell.get('perimeter'), 0.0, '.1f')} px<br>"
            f"  Diameter: {safe_float(cell.get('equivalent_diameter'), 0.0, '.1f')} px<br>"
            f"  BBox: {safe_float(cell.get('bbox_width'), 0.0, '.0f')}×{safe_float(cell.get('bbox_height'), 0.0, '.0f')} px<br>"
            f"  Aspect: {safe_float(cell.get('aspect_ratio'), 0.0, '.2f')}<br>"
            f"  Circ: {safe_float(cell.get('circularity'), 0.0, '.3f')}, Ecc: {safe_float(cell.get('eccentricity'), 0.0, '.3f')}<br>"
            f"  Solid: {safe_float(cell.get('solidity'), 0.0, '.3f')}, Conv: {safe_float(cell.get('convexity'), 0.0, '.3f')}<br>"
            f"<br>"
            f"<b>Texture:</b><br>"
            f"  Bright: {safe_float(cell.get('brightness'), None, '.1f')}, Contr: {safe_float(cell.get('contrast'), None, '.1f')}<br>"
            f"  Homog: {safe_float(cell.get('homogeneity'), None, '.3f')}, Energy: {safe_float(cell.get('energy'), None, '.3f')}<br>"
            f"  Corr: {safe_float(cell.get('correlation'), None, '.3f')}<br>"
        )
        
        # Add fluorescence section if available
        if fluo_lines:
            text += f"<br><b>Fluorescence:</b><br>{fluo_lines}"
        
        text += (
            f"<br>"
            f"<b>UMAP:</b> ({X_2d[i, 0]:.2f}, {X_2d[i, 1]:.2f})"
            f"</span>"
        )
        hover_text.append(text)
    
    # --- Prepare customdata ---
    customdata = []
    for cell in cell_data:
        customdata.append([
            cell['index'],
            cell['id'],
            cell['image_b64'] if cell['image_b64'] else '',
            cell['well_row'],
            cell['well_col'],
            cell['field_index'],
            cell['cell_index']
        ])
    
    # --- Generate cluster colors ---
    try:
        import plotly.colors as pc
        colors_list = pc.qualitative.Set3[:n_clusters] if n_clusters <= 12 else pc.qualitative.Set3
    except (ImportError, AttributeError):
        colors_list = px.colors.qualitative.Set3[:n_clusters] if n_clusters <= 12 else px.colors.qualitative.Set3
    
    cluster_colors = [colors_list[label % len(colors_list)] for label in cluster_labels]
    
    # --- Pre-compute metadata color arrays for JavaScript ---
    # We'll pass normalized values (0-1) and compute turbo colors in JS
    metadata_arrays = {}
    metadata_ranges = {}
    
    for field in metadata_fields:
        values = np.array([cell.get(field, 0.0) for cell in cell_data])
        vmin, vmax = float(np.min(values)), float(np.max(values))
        if vmax == vmin:
            vmax = vmin + 1e-6  # Avoid division by zero
        # Normalize to 0-1
        normalized = ((values - vmin) / (vmax - vmin)).tolist()
        metadata_arrays[field] = normalized
        metadata_ranges[field] = {"min": vmin, "max": vmax}
    
    # --- Create Plotly figure ---
    fig = go.Figure(data=go.Scattergl(
        x=X_2d[:, 0],
        y=X_2d[:, 1],
        mode='markers',
        marker=dict(
            size=6,
            color=cluster_colors,
            opacity=0.7,
            line=dict(width=0.5, color='white')
        ),
        text=hover_text,
        hovertemplate='%{text}<extra></extra>',
        customdata=customdata,
    ))
    
    fig.update_layout(
        title={
            'text': f"UMAP Visualization ({n_clusters} clusters, {n_samples} cells)<br><sub>Use tabs to switch coloring mode</sub>",
            'x': 0.5,
            'xanchor': 'center',
            'font': {'size': 12}
        },
        xaxis_title="UMAP-1",
        yaxis_title="UMAP-2",
        width=770,
        height=525,
        hovermode='closest',
        template='plotly_white',
        modebar=dict(orientation='v', bgcolor='rgba(255,255,255,0.7)'),
        margin=dict(l=40, r=100, t=80, b=40),  # Extra right margin for colorbar
        hoverlabel=dict(
            font=dict(size=9, family='Arial, sans-serif'),
            bgcolor='rgba(255,255,255,0.95)',
            bordercolor='#333'
        )
    )
    
    # --- Generate HTML ---
    html = fig.to_html(include_plotlyjs='cdn', div_id='umap-plot')
    
    # --- Inject custom CSS, JavaScript, and tab controls ---
    import json
    
    # Convert data to JSON for JavaScript
    cluster_colors_json = json.dumps(cluster_colors)
    metadata_arrays_json = json.dumps(metadata_arrays)
    metadata_ranges_json = json.dumps(metadata_ranges)
    metadata_fields_json = json.dumps(metadata_fields)
    
    # Generate tab buttons dynamically from metadata_fields
    def get_display_name(field_name: str) -> str:
        """Convert field_name to a human-readable display name."""
        # Special cases for common fields
        special_names = {
            'equivalent_diameter': 'Diameter',
            'aspect_ratio': 'Aspect Ratio',
        }
        if field_name in special_names:
            return special_names[field_name]
        # Default: capitalize and replace underscores
        return field_name.replace('_', ' ').title()
    
    # Build tab buttons HTML
    tab_buttons = ['<button class="color-tab active" data-mode="cluster">Embedding Vector Cluster</button>']
    for field in metadata_fields:
        display_name = get_display_name(field)
        tab_buttons.append(f'<button class="color-tab" data-mode="{field}">{display_name}</button>')
    tab_buttons_html = '\n        '.join(tab_buttons)
    
    custom_script = f"""
    <style>
    /* Tab bar styling */
    #color-mode-tabs {{
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 8px;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 8px;
        max-width: 770px;
    }}
    
    .color-tab {{
        padding: 4px 10px;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 11px;
        font-family: Arial, sans-serif;
        transition: all 0.2s;
    }}
    
    .color-tab:hover {{
        background: #e9ecef;
    }}
    
    .color-tab.active {{
        background: #0d6efd;
        color: white;
        border-color: #0d6efd;
    }}
    
    /* Colorbar styling - inline display to prevent clipping */
    #colorbar-container {{
        display: none;
        flex-direction: row;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: #f8f9fa;
        border-radius: 6px;
        margin-top: 8px;
        max-width: 770px;
    }}
    
    #colorbar-title {{
        font-size: 11px;
        font-weight: bold;
        font-family: Arial, sans-serif;
        min-width: 80px;
    }}
    
    #colorbar-gradient {{
        width: 200px;
        height: 16px;
        background: linear-gradient(to right, 
            #30123b, #4662d7, #35aac3, #6cce5a, #faba39, #f66b19, #d93806, #7a0403);
        border: 1px solid #ccc;
        border-radius: 2px;
        flex-shrink: 0;
    }}
    
    #colorbar-labels {{
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        width: 200px;
        font-size: 9px;
        font-family: Arial, sans-serif;
        margin-top: 2px;
    }}
    
    #colorbar-inner {{
        display: flex;
        flex-direction: column;
    }}
    
    /* Cell image popup with thumbnail */
    #cell-image-popup {{
        position: fixed;
        display: none;
        z-index: 10000;
        background: white;
        border: 2px solid #333;
        border-radius: 6px;
        padding: 6px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        pointer-events: none;
    }}
    
    #cell-image-popup img {{
        width: 50px;
        height: 50px;
        display: block;
        border-radius: 3px;
        image-rendering: pixelated;
        border: 1px solid #ddd;
    }}
    
    #cell-image-popup .cell-info {{
        margin-top: 4px;
        font-size: 9px;
        font-family: Arial, sans-serif;
        color: #333;
        max-width: 80px;
        text-align: center;
    }}
    
    .umap-container {{
        display: flex;
        flex-direction: column;
        max-width: 770px;
    }}
    
    /* Smaller hover tooltip font */
    .plotly .hoverlayer .hovertext text {{
        font-size: 9px !important;
    }}
    </style>
    
    <!-- Tab controls -->
    <div id="color-mode-tabs">
        {tab_buttons_html}
    </div>
    
    <!-- Colorbar for heatmap modes - horizontal inline layout -->
    <div id="colorbar-container">
        <div id="colorbar-title">Value</div>
        <div id="colorbar-inner">
            <div id="colorbar-gradient"></div>
            <div id="colorbar-labels">
                <span id="colorbar-min">0.0</span>
                <span id="colorbar-mid">0.5</span>
                <span id="colorbar-max">1.0</span>
            </div>
        </div>
    </div>
    
    <!-- Cell image popup -->
    <div id="cell-image-popup">
        <img id="cell-image" src="" alt="Cell Image" style="display:none;">
        <div class="cell-info" id="cell-info"></div>
    </div>
    
    <script>
    (function() {{
        // Data from Python
        var clusterColors = {cluster_colors_json};
        var metadataArrays = {metadata_arrays_json};
        var metadataRanges = {metadata_ranges_json};
        var metadataFields = {metadata_fields_json};
        
        // Turbo colormap (approximate, 8 key colors)
        var turboColors = [
            [48, 18, 59],    // Dark blue
            [70, 98, 215],   // Blue
            [53, 170, 195],  // Cyan
            [108, 206, 90],  // Green
            [250, 186, 57],  // Yellow
            [246, 107, 25],  // Orange
            [217, 56, 6],    // Red-orange
            [122, 4, 3]      // Dark red
        ];
        
        function interpolateTurbo(t) {{
            // t is 0-1, interpolate through turbo colormap
            t = Math.max(0, Math.min(1, t));
            var idx = t * (turboColors.length - 1);
            var lower = Math.floor(idx);
            var upper = Math.ceil(idx);
            var frac = idx - lower;
            
            if (lower === upper) {{
                return 'rgb(' + turboColors[lower].join(',') + ')';
            }}
            
            var r = Math.round(turboColors[lower][0] * (1 - frac) + turboColors[upper][0] * frac);
            var g = Math.round(turboColors[lower][1] * (1 - frac) + turboColors[upper][1] * frac);
            var b = Math.round(turboColors[lower][2] * (1 - frac) + turboColors[upper][2] * frac);
            
            return 'rgb(' + r + ',' + g + ',' + b + ')';
        }}
        
        function getMetadataColors(fieldName) {{
            var normalized = metadataArrays[fieldName];
            if (!normalized) return clusterColors;
            
            return normalized.map(function(val) {{
                return interpolateTurbo(val);
            }});
        }}
        
        function updateColorbar(fieldName, show) {{
            var container = document.getElementById('colorbar-container');
            if (!show) {{
                container.style.display = 'none';
                return;
            }}
            
            container.style.display = 'flex';
            var range = metadataRanges[fieldName];
            
            // Format field name for display
            var displayName = fieldName.replace(/_/g, ' ').replace(/\\b\\w/g, function(l) {{ return l.toUpperCase(); }});
            document.getElementById('colorbar-title').textContent = displayName + ':';
            document.getElementById('colorbar-min').textContent = range.min.toFixed(2);
            document.getElementById('colorbar-mid').textContent = ((range.min + range.max) / 2).toFixed(2);
            document.getElementById('colorbar-max').textContent = range.max.toFixed(2);
        }}
        
        function initTabs() {{
            var plot = document.getElementById('umap-plot');
            var tabs = document.querySelectorAll('.color-tab');
            
            tabs.forEach(function(tab) {{
                tab.addEventListener('click', function() {{
                    // Update active state
                    tabs.forEach(function(t) {{ t.classList.remove('active'); }});
                    tab.classList.add('active');
                    
                    var mode = tab.getAttribute('data-mode');
                    var newColors;
                    
                    if (mode === 'cluster') {{
                        newColors = clusterColors;
                        updateColorbar(null, false);
                    }} else {{
                        newColors = getMetadataColors(mode);
                        updateColorbar(mode, true);
                    }}
                    
                    // Update plot colors
                    Plotly.restyle(plot, {{'marker.color': [newColors]}});
                }});
            }});
        }}
        
        function initImagePopup() {{
            var plot = document.getElementById('umap-plot');
            var popup = document.getElementById('cell-image-popup');
            var img = document.getElementById('cell-image');
            var info = document.getElementById('cell-info');
            
            if (!plot || !popup) return;
            
            plot.on('plotly_hover', function(data) {{
                try {{
                    var point = data.points[0];
                    if (point.customdata && point.customdata.length >= 7) {{
                        var cellIndex = point.customdata[0];
                        var cellId = point.customdata[1];
                        var imageB64 = point.customdata[2];
                        var wellRow = point.customdata[3];
                        var wellCol = point.customdata[4];
                        var fieldIdx = point.customdata[5];
                        var cellIdx = point.customdata[6];
                        
                        // Build info text
                        var infoText = '<b>' + wellRow + wellCol + '-F' + fieldIdx + '-C' + cellIdx + '</b>';
                        info.innerHTML = infoText;
                        
                        // Show 50x50 thumbnail if available
                        if (imageB64 && imageB64.length > 0) {{
                            img.src = 'data:image/png;base64,' + imageB64;
                            img.style.display = 'block';
                            img.title = 'Cell ' + cellIdx + ' (50×50 thumbnail)';
                        }} else {{
                            img.style.display = 'none';
                        }}
                        
                        popup.style.display = 'block';
                        
                        // Position thumbnail on LEFT side of cursor to avoid covering metadata tooltip
                        var popupWidth = 80;  // approximate popup width
                        var x = data.event.pageX - popupWidth - 15;  // Left of cursor
                        var y = data.event.pageY - 30;  // Slightly above cursor
                        
                        // Keep popup on screen - if too far left, move to right side
                        if (x < 10) x = data.event.pageX + 15;
                        if (y < 10) y = 10;
                        if (y + 100 > window.innerHeight) y = window.innerHeight - 110;
                        
                        popup.style.left = x + 'px';
                        popup.style.top = y + 'px';
                    }}
                }} catch (e) {{
                    console.error('Hover error:', e);
                }}
            }});
            
            plot.on('plotly_unhover', function() {{
                popup.style.display = 'none';
                img.style.display = 'none';
            }});
        }}
        
        // Initialize when ready
        if (document.readyState === 'loading') {{
            document.addEventListener('DOMContentLoaded', function() {{
                setTimeout(function() {{
                    initTabs();
                    initImagePopup();
                }}, 100);
            }});
        }} else {{
            setTimeout(function() {{
                initTabs();
                initImagePopup();
            }}, 100);
        }}
    }})();
    </script>
    """
    
    # Insert custom elements before the plot div
    html = html.replace('<div id="umap-plot"', custom_script + '<div id="umap-plot"')
    
    print(f"✓ Generated interactive UMAP with {len(metadata_fields)} metadata color modes")
    
    return html