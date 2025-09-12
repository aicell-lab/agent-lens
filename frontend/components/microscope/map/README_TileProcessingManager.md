# TileProcessingManager Implementation

## Overview

The `TileProcessingManager` is a centralized service that simplifies tile processing by eliminating complex channel detection logic and providing a consistent workflow for both FREE_PAN and HISTORICAL modes.

## Key Benefits

1. **Eliminates Bugs**: No more complex channel detection that breaks with single channels
2. **Consistent Behavior**: Same logic for all channels regardless of count
3. **Easier Debugging**: Clear, linear workflow
4. **Maintainable**: Centralized processing logic
5. **Flexible**: Easy to add new processing steps

## Architecture

### Core Functions

#### `processTileChannels(enabledChannels, tileRequest, mode, channelConfigs, services, metadata)`
Main processing function that:
1. Gets enabled channels
2. Processes each channel individually
3. Merges all channels using additive blending
4. Handles failures gracefully

#### `processSingleChannel(channel, tileRequest, mode, channelConfigs, services, metadata)`
Processes a single channel:
1. Loads channel data using appropriate service
2. Applies color mapping
3. Applies contrast adjustment
4. Returns processed channel data or null if failed

#### `mergeChannels(channelDataArray, tileRequest)`
Merges multiple channels using additive blending:
- Single channel: No merging needed
- Multiple channels: Uses canvas screen blending mode

### Data Flow

#### FREE_PAN Mode
```
1. Get enabled channels from visibleLayers.channels
2. For each channel:
   - Call get_stitched_region(channel) - single channel
   - Apply hardcoded color mapping
   - Apply contrast from realMicroscopeChannelConfigs
3. Merge all channels
```

#### HISTORICAL Mode
```
1. Get enabled channels from zarrChannelConfigs
2. For each channel:
   - Call artifactZarrLoader.getWellRegion(channel) - single channel
   - Extract color from zarr metadata
   - Apply contrast from zarrChannelConfigs
3. Merge all channels
```

## Integration Points

### MicroscopeMapDisplay.jsx Changes
- **Removed**: Complex channel detection logic (lines 3094-3103)
- **Removed**: Contrast adjustment logic (lines 3107-3115)
- **Replaced**: `get_stitched_region` call with single channel calls
- **Added**: Import and use `TileProcessingManager`

### LayerPanel.jsx Changes
- **Simplified**: `updateRealMicroscopeChannelConfigWithRefresh` function
- **Removed**: Complex `applyRealMicroscopeContrastAdjustments` function
- **Added**: Clean config export for `TileProcessingManager`

## Error Handling Strategy

- **Failed channel loading**: Return null, render as transparent in merge
- **Missing contrast config**: Use default values (min:0, max:255)
- **Missing color info**: Use fallback color (#FFFFFF)
- **No channels enabled**: Return empty tile

## Color Mapping

### FREE_PAN Mode
Uses hardcoded colors:
- `BF_LED_matrix_full`: #FFFFFF (White)
- `Fluorescence_405_nm_Ex`: #8A2BE2 (Blue Violet)
- `Fluorescence_488_nm_Ex`: #00FF00 (Green)
- `Fluorescence_561_nm_Ex`: #FFFF00 (Yellow)
- `Fluorescence_638_nm_Ex`: #FF0000 (Red)
- `Fluorescence_730_nm_Ex`: #FF69B4 (Hot Pink)

### HISTORICAL Mode
Extracts colors from zarr metadata:
- Uses `zarrMetadata.activeChannels[].color` if available
- Falls back to hardcoded colors if not available

## Usage Example

```javascript
// FREE_PAN mode
const enabledChannels = getSelectedChannels().map(channelName => ({
  label: channelName,
  channelName: channelName
}));

const tileRequest = {
  centerX, centerY, width_mm, height_mm,
  wellPlateType, scaleLevel, timepoint, wellPaddingMm, bounds
};

const services = {
  microscopeControlService,
  artifactZarrLoader: null
};

const processedTile = await TileProcessingManager.processTileChannels(
  enabledChannels,
  tileRequest,
  'FREE_PAN',
  realMicroscopeChannelConfigs,
  services
);
```

## Backward Compatibility

- Keeps existing API interfaces
- Maintains existing tile caching
- Preserves existing contrast adjustment UI
- No breaking changes to parent components

## Future Enhancements

1. **HISTORICAL Mode Integration**: Complete the historical mode implementation
2. **Performance Optimization**: Add caching for processed channels
3. **Advanced Blending**: Support different blending modes
4. **Real-time Updates**: WebSocket integration for live updates
5. **Memory Management**: Automatic cleanup of processed data
