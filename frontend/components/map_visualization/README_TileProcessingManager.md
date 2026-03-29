# TileProcessingManager Implementation

## Overview

The `TileProcessingManager` is a centralized service that simplifies tile processing by eliminating complex channel detection logic and providing a consistent workflow for both live map data and historical (HISTORICAL) data.

**Important Note**: Ideally, all tiles should be loaded and processed in `TileProcessingManager.jsx`. However, when browsing historical data, the contrast adjustment and channel merging processing is currently handled in `artifactZarrLoader.js` due to performance considerations. This will be refactored in the future to consolidate all processing logic in the TileProcessingManager.

## Core Logic

### Main Processing Workflow
1. **Get enabled channels** from configuration
2. **Process each channel individually**:
   - Load data using appropriate service (microscope vs artifact loader)
   - Apply color mapping
   - Apply contrast adjustment
3. **Merge all channels** using additive blending
4. **Handle failures gracefully** (failed channels render as transparent)

### Data Flow

#### Live Map Data
```
enabledChannels → processSingleChannel() → mergeChannels() → finalTile
```

#### Historical Data
```
enabledChannels → artifactZarrLoader.getWellRegion() → mergeChannels() → finalTile
```

### Key Functions
- `processTileChannels()` - Main entry point
- `processSingleChannel()` - Individual channel processing
- `mergeChannels()` - Additive blending of multiple channels
- `loadChannelData()` - Service-specific data loading
- `applyContrastAdjustment()` - Contrast and color tinting
