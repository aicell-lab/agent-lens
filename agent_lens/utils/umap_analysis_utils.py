# make sure you have umap-learn installed:
# pip install umap-learn plotly

import numpy as np
import matplotlib.pyplot as plt
import io
import base64
import os
from typing import Optional, List, Dict
from umap import UMAP
from PIL import Image

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
        all_cells: List of cell dictionaries, each should have 'embedding' key
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
        if "embedding" in c:
            embeddings.append(np.array(c["embedding"], dtype=float))

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

    # --- Plot ---
    fig, ax = plt.subplots(figsize=(6, 5))
    ax.scatter(
        X_2d[:, 0],
        X_2d[:, 1],
        s=25,
        c="gray",
        alpha=0.7,
    )

    ax.set_title("UMAP clustering (cosine distance)")
    ax.set_xlabel("UMAP-1")
    ax.set_ylabel("UMAP-2")
    fig.tight_layout()

    return fig_to_base64(fig)


def make_umap_cluster_figure_interactive(
    all_cells: list,
    n_neighbors: int = 15,
    min_dist: float = 0.1,
    random_state: Optional[int] = None,
    n_jobs: Optional[int] = None,
) -> Optional[str]:
    """
    Interactive UMAP clustering visualization using Plotly.
    Returns HTML string that can be embedded in a webpage.
    
    Features:
    - Zoom and pan
    - Hover to see cell details (ID, area, etc.)
    - Click to select points
    - Export as PNG/SVG
    
    Args:
        all_cells: List of cell dictionaries with 'embedding' key (and optionally 'id', 'area', etc.)
        n_neighbors: Number of neighbors for UMAP (default: 15)
        min_dist: Minimum distance for UMAP (default: 0.1)
        random_state: Random state for reproducibility. If None, allows parallelism (default: None)
        n_jobs: Number of parallel jobs. -1 uses all CPU cores (default: None)
    
    Returns:
        HTML string of interactive Plotly figure, or None if failed
    """
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
        if "embedding" in c:
            embeddings.append(np.array(c["embedding"], dtype=float))
            
            # Extract all metadata
            metadata = c.get("metadata", {})
            
            # Resize image to 50x50 thumbnail if available
            image_b64_original = c.get("image_b64", None)
            image_b64_thumbnail = None
            if image_b64_original:
                image_b64_thumbnail = resize_image_base64(image_b64_original, size=(50, 50))
                if image_b64_thumbnail and idx == 0:
                    print(f"✓ Resized images to 50x50 thumbnails (original: {len(image_b64_original)/1024:.1f}KB → thumbnail: {len(image_b64_thumbnail)/1024:.1f}KB)")
            
            cell_info = {
                "index": idx,
                "id": c.get("id", f"cell_{idx}"),
                "image_b64": image_b64_thumbnail,  # Use resized thumbnail
                "well_row": c.get("well_row", "?"),
                "well_col": c.get("well_col", "?"),
                "field_index": c.get("field_index", "?"),
                "cell_index": c.get("cell_index", "?"),
                # Metadata fields
                "area": metadata.get("area", 0),
                "perimeter": metadata.get("perimeter", 0),
                "equivalent_diameter": metadata.get("equivalent_diameter", 0),
                "aspect_ratio": metadata.get("aspect_ratio", 0),
                "circularity": metadata.get("circularity", 0),
                "eccentricity": metadata.get("eccentricity", 0),
                "solidity": metadata.get("solidity", 0),
                "brightness": metadata.get("brightness", 0),
                "contrast": metadata.get("contrast", 0),
            }
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
    
    umap_model = UMAP(
        n_components=2,
        n_neighbors=min(n_neighbors, len(E) - 1),
        min_dist=min_dist,
        metric="cosine",
        random_state=random_state,
        n_jobs=n_jobs,
    )
    X_2d = umap_model.fit_transform(E)
    
    # --- Create interactive Plotly figure with rich hover info ---
    hover_text = []
    for i, cell in enumerate(cell_data):
        text = (
            f"<b>Cell ID:</b> {cell['id']}<br>"
            f"<b>Location:</b> Well {cell['well_row']}{cell['well_col']}, "
            f"Field {cell['field_index']}, Cell {cell['cell_index']}<br>"
            f"<br>"
            f"<b>Morphology:</b><br>"
            f"  Area: {cell['area']:.1f} px²<br>"
            f"  Perimeter: {cell['perimeter']:.1f} px<br>"
            f"  Diameter: {cell['equivalent_diameter']:.1f} px<br>"
            f"  Aspect Ratio: {cell['aspect_ratio']:.2f}<br>"
            f"  Circularity: {cell['circularity']:.3f}<br>"
            f"  Eccentricity: {cell['eccentricity']:.3f}<br>"
            f"  Solidity: {cell['solidity']:.3f}<br>"
            f"<br>"
            f"<b>Intensity:</b><br>"
            f"  Brightness: {cell['brightness']:.1f}<br>"
            f"  Contrast: {cell['contrast']:.1f}<br>"
            f"<br>"
            f"<b>UMAP Coordinates:</b><br>"
            f"  UMAP-1: {X_2d[i, 0]:.2f}<br>"
            f"  UMAP-2: {X_2d[i, 1]:.2f}"
        )
        hover_text.append(text)
    
    # Prepare customdata with all cell info including images
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
    
    fig = go.Figure(data=go.Scattergl(
        x=X_2d[:, 0],
        y=X_2d[:, 1],
        mode='markers',
        marker=dict(
            size=6,
            color='gray',
            opacity=0.7,
            line=dict(width=0.5, color='white')
        ),
        text=hover_text,
        hovertemplate='%{text}<extra></extra>',  # Use custom hover template
        customdata=customdata,
    ))
    
    fig.update_layout(
        title={
            'text': "Interactive UMAP Clustering (cosine distance)<br><sub>Hover over points to see cell details</sub>",
            'x': 0.5,
            'xanchor': 'center'
        },
        xaxis_title="UMAP-1",
        yaxis_title="UMAP-2",
        width=1000,
        height=700,
        hovermode='closest',
        template='plotly_white',
        # Enable modebar buttons
        modebar=dict(
            orientation='v',
            bgcolor='rgba(255,255,255,0.7)'
        ),
        # Add some padding
        margin=dict(l=50, r=50, t=80, b=50)
    )
    
    # Add custom JavaScript to show images on hover
    html = fig.to_html(include_plotlyjs='cdn', div_id='umap-plot')
    
    # Inject custom CSS and JavaScript for image display on hover
    custom_script = """
    <style>
    #cell-image-popup {
        position: fixed;
        display: none;
        z-index: 10000;
        background: white;
        border: 2px solid #333;
        border-radius: 8px;
        padding: 8px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        pointer-events: none;
    }
    #cell-image-popup img {
        width: 50px;
        height: 50px;
        display: block;
        border-radius: 4px;
        image-rendering: pixelated; /* Crisp pixel art rendering for small images */
        image-rendering: -moz-crisp-edges;
        image-rendering: crisp-edges;
    }
    #cell-image-popup .cell-info {
        margin-top: 8px;
        font-size: 11px;
        font-family: Arial, sans-serif;
        color: #333;
        line-height: 1.4;
    }
    #cell-image-popup .error {
        color: #999;
        font-style: italic;
    }
    </style>
    
    <div id="cell-image-popup">
        <img id="cell-image" src="" alt="Cell Image" style="display:none;">
        <div class="cell-info" id="cell-info"></div>
    </div>
    
    <script>
    (function() {
        // Wait for Plotly to be ready
        function initImagePopup() {
            var plot = document.getElementById('umap-plot');
            if (!plot) {
                console.error('UMAP plot element not found');
                return;
            }
            
            var popup = document.getElementById('cell-image-popup');
            var img = document.getElementById('cell-image');
            var info = document.getElementById('cell-info');
            
            if (!popup || !img || !info) {
                console.error('Popup elements not found');
                return;
            }
            
            console.log('Image popup initialized');
            
            plot.on('plotly_hover', function(data) {
                try {
                    var point = data.points[0];
                    console.log('Hover event:', point.customdata);
                    
                    if (point.customdata && point.customdata.length >= 7) {
                        var imageB64 = point.customdata[2];
                        var cellId = point.customdata[1];
                        var wellRow = point.customdata[3];
                        var wellCol = point.customdata[4];
                        var fieldIdx = point.customdata[5];
                        var cellIdx = point.customdata[6];
                        
                        // Update info text
                        info.innerHTML = '<b>' + cellId + '</b><br>Well ' + wellRow + wellCol + 
                                        ', Field ' + fieldIdx + ', Cell ' + cellIdx;
                        
                        // Show image if available
                        if (imageB64 && imageB64.length > 0) {
                            img.src = 'data:image/png;base64,' + imageB64;
                            img.style.display = 'block';
                            img.onerror = function() {
                                console.error('Failed to load image');
                                img.style.display = 'none';
                                info.innerHTML += '<br><span class="error">Image failed to load</span>';
                            };
                        } else {
                            img.style.display = 'none';
                            info.innerHTML += '<br><span class="error">No image available</span>';
                        }
                        
                        // Position popup
                        popup.style.display = 'block';
                        var x = data.event.pageX + 15;
                        var y = data.event.pageY + 15;
                        
                        // Keep popup on screen
                        if (x + 250 > window.innerWidth) {
                            x = data.event.pageX - 265;
                        }
                        if (y + 300 > window.innerHeight) {
                            y = data.event.pageY - 310;
                        }
                        
                        popup.style.left = x + 'px';
                        popup.style.top = y + 'px';
                    }
                } catch (e) {
                    console.error('Error in hover handler:', e);
                }
            });
            
            plot.on('plotly_unhover', function() {
                popup.style.display = 'none';
                img.style.display = 'none';
            });
        }
        
        // Try to initialize immediately or wait for DOMContentLoaded
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initImagePopup);
        } else {
            // DOM already loaded, wait a bit for Plotly to render
            setTimeout(initImagePopup, 100);
        }
    })();
    </script>
    """
    
    # Insert custom script before closing body tag
    html = html.replace('</body>', custom_script + '</body>')
    
    return html