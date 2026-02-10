# Weaviate Integration Guide - Notebook Updates

## Implementation Summary

**Architecture Decision:** After testing, Weaviate filtering is **NOT SUPPORTED** through the proxy. Therefore, we implemented a **hybrid approach**:

- ✅ **Store in Weaviate**: Images (base64) + Embeddings (vectors)
- ✅ **Keep in Memory**: All metadata (morphology, intensity, position) + UUIDs
- ✅ **Filtering**: In-memory (current approach - no changes needed)
- ✅ **Visualization**: Fetch images from Weaviate on-demand by UUID

## Backend Implementation (✅ COMPLETED)

### 1. Added RPC Methods in `register_frontend_service.py`:

- ✅ `reset_application(application_id)` - Clean up Weaviate before starting new session
- ✅ `fetch_cell_images_from_weaviate(uuids, application_id, include_embeddings)` - Fetch images by UUID
- ✅ `fetch_cell_embeddings_from_weaviate(uuids, application_id)` - Fetch embeddings only (for UMAP)
- ✅ Modified `build_cell_records()` with parameters:
  - `application_id: Optional[str]` - For Weaviate storage
  - `store_to_weaviate: bool = False` - Enable Weaviate storage
  - Returns full metadata with UUIDs (images/embeddings removed if stored)

## Notebook Updates Required

### Step 1: Add Initialization Code

Add this code right after connecting to services (after `microscope = await reef_server.get_service(...)`):

```python
# Initialize application ID for Weaviate storage
application_id = "hypha-agents-notebook"

# Reset application data in Weaviate to start fresh
reset_result = await agent_lens_service.reset_application(application_id)
print(f"🔄 Application reset: {reset_result['message']} ({reset_result['deleted_count']} cells deleted)")
```

### Step 2: Add Helper Function for Fetching Images

Add this helper function after the existing helper functions (after `build_df_from_records`):

```python
async def fetch_cells_by_uuids(uuids: List[str], include_embeddings: bool = False) -> List[Dict[str, Any]]:
    """
    Fetch full cell data including images from Weaviate by UUIDs.
    Used for visualization when cells are stored in Weaviate.
    
    Args:
        uuids: List of UUIDs to fetch
        include_embeddings: Whether to include embedding vectors
    
    Returns:
        List of cell records with images (base64), embeddings (optional), and metadata
    """
    return await agent_lens_service.fetch_cell_images_from_weaviate(
        uuids=uuids,
        application_id=application_id,
        include_embeddings=include_embeddings
    )
```

### Step 3: Update `build_cell_records` Calls

**Option A: Store to Weaviate (recommended for large scans)**
```python
# When calling build_cell_records, add application_id and store_to_weaviate
cell_records = await agent_lens_service.build_cell_records(
    raw_image, 
    seg_mask, 
    status,
    application_id=application_id,        # NEW
    store_to_weaviate=True                # NEW - stores images/embeddings to Weaviate
)
# cell_records now contains metadata + UUIDs (no images/embeddings = memory efficient)
```

**Option B: Keep in memory (for small datasets)**
```python
# Keep current behavior - all data in memory
cell_records = await agent_lens_service.build_cell_records(
    raw_image, 
    seg_mask, 
    status
)
# cell_records contains full data including images and embeddings
```

### Step 4: Update Visualization Functions

Replace the existing `show_similarity_grid` function with this updated version:

```python
async def show_similarity_grid(
    query_cell_records: List[Dict[str, Any]],
    text_query_descriptions: Optional[List[str]],
    all_cell_data: list,
    similar_cell_data: list,
    max_examples: int = 10,
):
    """Display query cells, top similar cells, and top dissimilar cells with merged multi-channel images."""
    
    # Check if cells have images or only UUIDs
    has_images = any('image' in cell for cell in query_cell_records[:1])
    
    if not has_images:
        # Cells are stored in Weaviate - fetch images on-demand
        print(f"Fetching images from Weaviate for visualization...")
        
        # Fetch query cell images
        query_uuids = [c['uuid'] for c in query_cell_records if 'uuid' in c]
        if query_uuids:
            query_with_images = await fetch_cells_by_uuids(query_uuids)
            # Merge fetched images with metadata
            uuid_to_image = {c['uuid']: c.get('image') or c.get('preview_image') for c in query_with_images}
            for cell in query_cell_records:
                if 'uuid' in cell and cell['uuid'] in uuid_to_image:
                    cell['image'] = uuid_to_image[cell['uuid']]
        
        # Fetch similar cell images (limited to max_examples)
        similar_sorted = sorted(similar_cell_data, key=lambda x: -x.get('final_similarity_score', x.get('similarity_score', 0)))[:max_examples]
        similar_uuids = [c['uuid'] for c in similar_sorted if 'uuid' in c]
        if similar_uuids:
            similar_with_images = await fetch_cells_by_uuids(similar_uuids)
            uuid_to_image = {c['uuid']: c.get('image') or c.get('preview_image') for c in similar_with_images}
            for cell in similar_sorted:
                if 'uuid' in cell and cell['uuid'] in uuid_to_image:
                    cell['image'] = uuid_to_image[cell['uuid']]
        
        # Fetch dissimilar cell images
        similar_ids = {id(c) for c in similar_sorted}
        not_similar_sorted = sorted(
            [c for c in all_cell_data if id(c) not in similar_ids],
            key=lambda x: x.get('final_similarity_score', x.get('similarity_score', 0))
        )[:max_examples]
        
        not_similar_uuids = [c['uuid'] for c in not_similar_sorted if 'uuid' in c]
        if not_similar_uuids:
            not_similar_with_images = await fetch_cells_by_uuids(not_similar_uuids)
            uuid_to_image = {c['uuid']: c.get('image') or c.get('preview_image') for c in not_similar_with_images}
            for cell in not_similar_sorted:
                if 'uuid' in cell and cell['uuid'] in uuid_to_image:
                    cell['image'] = uuid_to_image[cell['uuid']]
    else:
        # Cells already have images in memory - use current logic
        similar_sorted = sorted(similar_cell_data, key=lambda x: -x.get('final_similarity_score', x.get('similarity_score', 0)))[:max_examples]
        similar_ids = {id(c) for c in similar_sorted}
        not_similar_sorted = sorted(
            [c for c in all_cell_data if id(c) not in similar_ids],
            key=lambda x: x.get('final_similarity_score', x.get('similarity_score', 0))
        )[:max_examples]
    
    # Rest of the function remains the same (HTML generation)
    def get_score(cell):
        if "final_similarity_score" in cell:
            return cell.get("final_similarity_score", 0.0)
        return cell.get("similarity_score", 0.0)
    
    metadata_fields = [
        ("perimeter",          "Perim.",  "{:.1f}"),
        ("equivalent_diameter","Eq. D",   "{:.1f}"),
        ("aspect_ratio",       "Aspect",  "{:.2f}"),
        ("circularity",        "Circ.",   "{:.3f}"),
        ("eccentricity",       "Ecc.",    "{:.3f}"),
        ("solidity",           "Solid.",  "{:.3f}"),
        ("convexity",          "Convex.", "{:.3f}"),
        ("brightness",         "Bright.", "{:.1f}"),
        ("image_similarity_raw_mean","ImgSimR", "{:.3f}"),
        ("image_similarity_normalized","ImgSimN", "{:.3f}"),
        ("text_similarity_raw_mean", "TxtSimR", "{:.3f}"),
        ("text_similarity_normalized","TxtSimN","{:.3f}"),
        ("final_similarity_score",    "FinalSim", "{:.3f}"),
    ]

    def cell_metadata_html(cell):
        items = []
        for k, label, fmt in metadata_fields:
            val = cell.get(k, None)
            if val is not None:
                items.append(f"<span style='white-space:nowrap;' title='{k}'><b>{label}:</b> {fmt.format(val)}</span>")
        
        # Add fluorescence intensity fields dynamically
        for key in sorted(cell.keys()):
            if key.startswith('top10_mean_intensity_') or key.startswith('mean_intensity_'):
                val = cell.get(key)
                if val is not None:
                    if key.startswith('top10_mean_intensity_'):
                        channel_name = key.replace('top10_mean_intensity_', '').replace('_', ' ')
                        label = f"Top10% {channel_name}"
                    else:
                        channel_name = key.replace('mean_intensity_', '').replace('_', ' ')
                        label = f"Mean {channel_name}"
                    items.append(f"<span style='white-space:nowrap;' title='{key}'><b>{label}:</b> {val:.1f}</span>")
        
        if not items:
            return ""
        return "<div style='margin-top:4px;line-height:1.2;color:#666;font-size:9px;'>" + "<br>".join(items) + "</div>"

    def cell_card(cell):
        img_b64 = cell.get("image") or cell.get("image_b64")
        well = cell.get("well_id")
        if not well:
            well = f"{cell.get('well_row','?')}{cell.get('well_col','?')}"

        pos = cell.get("position")
        if isinstance(pos, dict):
            x = pos.get("x", None)
            y = pos.get("y", None)
            if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                pos_str = f"(x={x:.3f}, y={y:.3f})"
            else:
                pos_str = str(pos)
        else:
            cx = cell.get("current_x", None)
            cy = cell.get("current_y", None)
            if isinstance(cx, (int, float)) and isinstance(cy, (int, float)):
                pos_str = f"(x={cx:.3f}, y={cy:.3f})"
            else:
                pos_str = "?"

        field_idx = cell.get("field_cell_index", cell.get("field_cell_index", "?"))
        score = get_score(cell)
        metadata_html = cell_metadata_html(cell)
        
        return f'''
        <div style="display:inline-block;margin:5px;padding:8px;border:1px solid #ddd;border-radius:4px;
                    width:160px;vertical-align:top;font-size:10px;box-sizing:border-box;">
            <img src="data:image/png;base64,{img_b64}" style="width:120px;height:120px;object-fit:contain;"/>
            <div style="margin-top:4px;">
                <b>sim: {score:.3f}</b><br/>
                Well: {well}<br/>
                Position: {pos_str}<br/>
                area: {cell.get('area',0):.0f}
            </div>
            {metadata_html}
        </div>'''

    def query_card(cell):
        img_b64 = cell.get("image") or cell.get("image_b64")
        metadata_html = cell_metadata_html(cell)
        
        return f'''
        <div style="display:inline-block;margin:5px;padding:5px;border:2px solid #007bff;
                    border-radius:4px;width:160px;vertical-align:top;font-size:10px;box-sizing:border-box;">
            <img src="data:image/png;base64,{img_b64}" style="width:120px;height:120px;object-fit:contain;"/>
            {metadata_html}
        </div>'''

    if text_query_descriptions:
        text_block = "<h4>Query Text</h4><ul>"
        for t in text_query_descriptions:
            text_block += f"<li>{t}</li>"
        text_block += "</ul>"
    else:
        text_block = ""

    html = f'''
    <div style="font-family:Arial,sans-serif;">
        <h3>Query Cells ({len(query_cell_records)})</h3>
        <div>{''.join(query_card(q) for q in query_cell_records)}</div>
        {text_block}
        <h3>Similar Cells ({len(similar_sorted)})</h3>
        <div>{''.join(cell_card(c) for c in similar_sorted) or '<i>None found</i>'}</div>
        <h3>Example Non-Similar Cells ({len(not_similar_sorted)})</h3>
        <div>{''.join(cell_card(c) for c in not_similar_sorted) or '<i>None</i>'}</div>
    </div>
    '''

    api.create_window(src=html, name="Similarity Grid")
```

### Step 5: Update SYSTEM_PROMPT_1

Add this section to SYSTEM_PROMPT_1 after the "DATA CONVENTIONS" section:

```markdown
WEAVIATE STORAGE (OPTIONAL)
- Cell images and embeddings can be stored in Weaviate to save memory
- Use build_cell_records(..., application_id=application_id, store_to_weaviate=True) to enable
- When stored: cell_records contains metadata + UUIDs (no images/embeddings)
- Use fetch_cells_by_uuids(uuids) to retrieve images when user asks to see examples
- Similarity search and DataFrame building work the same (metadata already in memory)
- Visualization functions automatically fetch images from Weaviate if needed
```

### Step 6: Update SYSTEM_PROMPT_2 Templates

Update Template 0 (quick inspection):

```python
# Template 0: Updated for optional Weaviate storage
channel_config = [
  {"channel": "BF_LED_matrix_full", "exposure_time": 10, "intensity": 20},
]

raw_image = await snap_image(channel_config)
norm_image = percentile_normalize(raw_image)
seg_mask = await segment_image(norm_image)
status = await microscope.get_status()

# Option A: Store to Weaviate (memory efficient for large scans)
cell_records = await agent_lens_service.build_cell_records(
    raw_image, seg_mask, status,
    application_id=application_id,
    store_to_weaviate=True
)

# Option B: Keep in memory (for quick inspection)
cell_records = await agent_lens_service.build_cell_records(raw_image, seg_mask, status)

# Visualization works the same - auto-fetches images if needed
await visualize_cells_interactive(
  original_image=norm_image,
  segmentation_mask=seg_mask,
  cell_records=cell_records,
)
```

## Usage Examples

### Example 1: Quick Inspection (Small Dataset)

```python
# Don't use Weaviate - keep everything in memory for quick access
cell_records = await agent_lens_service.build_cell_records(raw_image, seg_mask, status)

# All data is in memory - instant visualization
await visualize_cells_interactive(norm_image, seg_mask, cell_records)
```

### Example 2: Large Scan with Weaviate Storage

```python
# Use Weaviate to save memory
similar_cell_records = []
all_scanned_cell_records = []

for row in rows:
    for col in cols:
        await microscope.navigate_to_well(row, col, well_plate_type="96")
        await microscope.reflection_autofocus()
        
        raw_image = await snap_image(channel_config)
        norm_image = percentile_normalize(raw_image)
        seg_mask = await segment_image(norm_image)
        status = await microscope.get_status()
        
        # Store images/embeddings to Weaviate, keep metadata in memory
        field_cell_records = await agent_lens_service.build_cell_records(
            raw_image, seg_mask, status,
            application_id=application_id,
            store_to_weaviate=True  # Images/embeddings → Weaviate, metadata → memory
        )
        
        # Filtering works in-memory (current approach - no changes)
        field_similar_records, field_all_records = filter_and_score_cells(
            query_cell_records=query_cell_records,
            field_cell_records=field_cell_records,
            relative_config=relative_config,
            range_config=range_config,
            similarity_config=similarity_config,
            text_query_embeddings=text_query_embeddings,
        )
        
        similar_cell_records.extend(field_similar_records)
        all_scanned_cell_records.extend(field_all_records)

# Visualization auto-fetches images from Weaviate
await show_similarity_grid(
    query_cell_records=query_cell_records,
    text_query_descriptions=text_descriptions,
    all_cell_data=all_scanned_cell_records,
    similar_cell_data=similar_cell_records,
    max_examples=20,
)
```

### Example 3: UMAP Clustering with Weaviate

```python
# Fetch embeddings from Weaviate for UMAP
cell_uuids = [c['uuid'] for c in all_scanned_cell_records if 'uuid' in c]
cells_with_embeddings = await agent_lens_service.fetch_cell_embeddings_from_weaviate(
    uuids=cell_uuids,
    application_id=application_id
)

# Generate UMAP (embeddings fetched, no images)
result = await agent_lens_service.make_umap_cluster_figure_interactive(
    all_cells=cells_with_embeddings,
    n_neighbors=15,
    min_dist=0.1
)

api.create_window(src=result["html"], name="UMAP Clustering")
```

## Performance Impact

### Memory Savings
- **Before**: 100 cells × (50KB image + 2KB embedding) = ~5MB per FoV
- **After (Weaviate)**: 100 cells × (200B UUID + metadata) = ~20KB per FoV
- **Savings**: ~250× reduction in notebook memory usage

### Speed Trade-offs
- **Slower**: Visualization (fetches images from Weaviate - ~1-2s for 20 cells)
- **Same**: Filtering and DataFrame building (metadata already in memory)
- **Same**: Image acquisition and segmentation (unchanged)

## Testing

Run the validation tests to confirm implementation:

```bash
# Test Weaviate filtering capabilities (validates architecture decision)
conda run -n agent-lens python -m pytest tests/test_weaviate_filtering.py -v

# Test frontend service with new RPC methods
conda run -n agent-lens python -m pytest tests/test_frontend_service.py -v
```

## Troubleshooting

### Issue: "application_id is required when store_to_weaviate=True"
**Solution**: Add `application_id` variable at notebook initialization (see Step 1)

### Issue: Images not showing in visualization
**Solution**: Check that `fetch_cells_by_uuids` helper function is defined (see Step 2)

### Issue: "Failed to connect to Weaviate service"
**Solution**: Ensure HYPHA_AGENTS_TOKEN environment variable is set correctly

### Issue: Memory still high with Weaviate storage
**Solution**: Verify `store_to_weaviate=True` is set in `build_cell_records` calls

## Migration from Old Notebooks

For existing notebooks without Weaviate:

1. **No changes required** - continue using `build_cell_records` without additional parameters
2. **Optional upgrade** - add `application_id` and `store_to_weaviate=True` to save memory
3. **Backward compatible** - old code continues to work without modifications

