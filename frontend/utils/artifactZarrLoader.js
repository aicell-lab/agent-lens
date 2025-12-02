/**
 * Artifact Zarr Loader Service - Simplified zarrita.js Implementation
 * 
 * Loads OME-Zarr data from the example-image-data.zarr endpoint using zarrita.js.
 * This is a simplified loader for the simulated microscope that loads a single
 * continuous image (no well structure).
 * 
 * OME-Zarr structure: 5D array (T, C, Z, Y, X) with multi-scale pyramid (6 levels: 0-5)
 */

import * as zarr from "zarrita";

// Hardcoded endpoint for the example zarr dataset
const ZARR_ENDPOINT = "https://hypha.aicell.io/agent-lens/apps/agent-lens/example-image-data.zarr";

// Hardcoded OME-Zarr structure (from .zattrs)
const ZARR_STRUCTURE = {
  scaleLevels: [0, 1, 2, 3, 4, 5],
  pixelSizeUm: 0.311688, // micrometers per pixel at scale 0
  shape: [20, 6, 1, 247296, 361984], // [T, C, Z, Y, X]
  chunks: [1, 1, 1, 256, 256],
  // Channel configuration from .zattrs omero.channels
  // Note: all channels have active: false in the original file
  channels: [
    { index: 0, label: 'BF LED matrix full', color: 'FFFFFF', active: false },
    { index: 1, label: 'Fluorescence 405 nm Ex', color: '0000FF', active: false },
    { index: 2, label: 'Fluorescence 488 nm Ex', color: '00FF00', active: false },
    { index: 3, label: 'Fluorescence 638 nm Ex', color: 'FF00FF', active: false },
    { index: 4, label: 'Fluorescence 561 nm Ex', color: 'FF0000', active: false },
    { index: 5, label: 'Fluorescence 730 nm Ex', color: '00FFFF', active: false }
  ],
  // Stage limits from .zattrs squid_canvas.stage_limits
  stageLimits: {
    xMin: 0.0,
    xMax: 120.0,
    yMin: 0.0,
    yMax: 86.0
  }
};

class ArtifactZarrLoader {
  constructor() {
    this.baseUrl = ZARR_ENDPOINT;
    this.arrayCache = new Map();
    this.structure = ZARR_STRUCTURE;
    
    // Use stage limits from .zattrs squid_canvas.stage_limits
    const limits = this.structure.stageLimits;
    this.imageExtent = {
      xMin: limits.xMin,
      xMax: limits.xMax,
      yMin: limits.yMin,
      yMax: limits.yMax,
      width: limits.xMax - limits.xMin,
      height: limits.yMax - limits.yMin
    };
    console.log(`📐 Example zarr image extent: X[${this.imageExtent.xMin.toFixed(1)}, ${this.imageExtent.xMax.toFixed(1)}]mm, Y[${this.imageExtent.yMin.toFixed(1)}, ${this.imageExtent.yMax.toFixed(1)}]mm`);
  }
  
  /**
   * Get image extent in mm (stage coordinates)
   */
  getImageExtent() {
    return this.imageExtent;
  }

  /**
   * Open zarr array at specified scale level
   */
  async openArray(scaleLevel = 0) {
    if (this.arrayCache.has(scaleLevel)) {
      return this.arrayCache.get(scaleLevel);
    }

    console.log(`📦 Opening zarr array at scale level ${scaleLevel}...`);
    const store = new zarr.FetchStore(`${this.baseUrl}/${scaleLevel}`);
    const arr = await zarr.open(store, { kind: "array" });
    console.log(`✅ Array opened: shape=${JSON.stringify(arr.shape)}`);
    
    this.arrayCache.set(scaleLevel, arr);
    return arr;
  }

  /**
   * Get pixel size at scale level (µm/pixel)
   */
  getPixelSize(scaleLevel = 0) {
    return this.structure.pixelSizeUm * Math.pow(4, scaleLevel);
  }

  /**
   * Get image dimensions at scale level
   */
  getImageDimensions(scaleLevel = 0) {
    const [t, c, z, y, x] = this.structure.shape;
    const factor = Math.pow(4, scaleLevel);
    return { t, c, z, y: Math.floor(y / factor), x: Math.floor(x / factor) };
  }

  /**
   * Convert stage coordinates (mm) to pixel coordinates
   * Stage coordinates use the limits from .zattrs (0 to 120mm X, 0 to 86mm Y)
   */
  stageToPixel(x_mm, y_mm, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    // Map stage coordinates to pixel coordinates
    // Stage (0,0) is at pixel (0,0), stage (xMax, yMax) is at pixel (dims.x, dims.y)
    const x_px = Math.round((x_mm - ext.xMin) / (ext.xMax - ext.xMin) * dims.x);
    const y_px = Math.round((y_mm - ext.yMin) / (ext.yMax - ext.yMin) * dims.y);
    
    return { x: x_px, y: y_px };
  }

  /**
   * Convert pixel coordinates to stage coordinates (mm)
   */
  pixelToStage(x_px, y_px, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    // Map pixel coordinates back to stage coordinates
    const x_mm = ext.xMin + (x_px / dims.x) * (ext.xMax - ext.xMin);
    const y_mm = ext.yMin + (y_px / dims.y) * (ext.yMax - ext.yMin);
    
    return { x: x_mm, y: y_mm };
  }

  /**
   * Load a region from the zarr dataset
   * @param {number} centerX_mm - Center X in mm (stage coordinates)
   * @param {number} centerY_mm - Center Y in mm (stage coordinates)
   * @param {number} width_mm - Width in mm
   * @param {number} height_mm - Height in mm
   * @param {Array} channelConfigs - Array of {channelName, enabled, min, max, color}
   * @param {number} scaleLevel - Scale level (0-5)
   * @param {number} timepoint - Timepoint index
   * @param {Function} onProgress - Progress callback (loaded, total, canvas)
   * @returns {Promise<Object>} Result with canvas and bounds
   */
  async loadRegion(centerX_mm, centerY_mm, width_mm, height_mm, channelConfigs, scaleLevel = 0, timepoint = 0, onProgress = null) {
    try {
      const dims = this.getImageDimensions(scaleLevel);
      const pixelSize = this.getPixelSize(scaleLevel);
      
      // Check if requested region is within image bounds
      const ext = this.imageExtent;
      if (centerX_mm < ext.xMin || centerX_mm > ext.xMax || centerY_mm < ext.yMin || centerY_mm > ext.yMax) {
        console.warn(`⚠️ Requested center (${centerX_mm.toFixed(1)}, ${centerY_mm.toFixed(1)})mm is outside image bounds [${ext.xMin.toFixed(1)}, ${ext.xMax.toFixed(1)}] × [${ext.yMin.toFixed(1)}, ${ext.yMax.toFixed(1)}]mm`);
      }
      
      // Convert to pixels
      const center = this.stageToPixel(centerX_mm, centerY_mm, scaleLevel);
      const widthPx = Math.round((width_mm * 1000) / pixelSize);
      const heightPx = Math.round((height_mm * 1000) / pixelSize);
      
      // Calculate bounds (clamped to image)
      let xStart = Math.max(0, center.x - Math.floor(widthPx / 2));
      let yStart = Math.max(0, center.y - Math.floor(heightPx / 2));
      let xEnd = Math.min(dims.x, xStart + widthPx);
      let yEnd = Math.min(dims.y, yStart + heightPx);
      
      if (xStart >= xEnd || yStart >= yEnd) {
        console.warn(`Region completely outside image bounds`);
        return null;
      }
      
      const regionWidth = xEnd - xStart;
      const regionHeight = yEnd - yStart;
      
      // Log if region was clamped significantly
      const requestedArea = widthPx * heightPx;
      const actualArea = regionWidth * regionHeight;
      if (actualArea < requestedArea * 0.5) {
        console.warn(`⚠️ Region clamped significantly: requested ${widthPx}×${heightPx}px, got ${regionWidth}×${regionHeight}px (${(actualArea/requestedArea*100).toFixed(0)}%)`);
      }
      
      console.log(`📖 Loading region: scale=${scaleLevel}, pixels=[${xStart}:${xEnd}, ${yStart}:${yEnd}] (${regionWidth}×${regionHeight}px)`);
      
      // Get enabled channels
      const enabledChannels = (channelConfigs || []).filter(c => c.enabled);
      if (enabledChannels.length === 0) {
        // Default to first channel if none enabled
        enabledChannels.push({ channelName: 'BF_LED_matrix_full', enabled: true, min: 0, max: 255, color: 'FFFFFF' });
      }
      
      // Create composite canvas
      const canvas = document.createElement('canvas');
      canvas.width = regionWidth;
      canvas.height = regionHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, regionWidth, regionHeight);
      
      // Open array
      const arr = await this.openArray(scaleLevel);
      
      let loadedChannels = 0;
      const totalChannels = enabledChannels.length;
      
      // Load each channel
      for (const config of enabledChannels) {
        try {
          const channelIndex = this.getChannelIndex(config.channelName);
          
          // Read region from zarr
          const region = await zarr.get(arr, [
            timepoint,
            channelIndex,
            0, // z=0
            zarr.slice(yStart, yEnd),
            zarr.slice(xStart, xEnd)
          ]);
          
          // Apply color and blend
          const channelCanvas = this.applyChannelColor(region, config);
          ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(channelCanvas, 0, 0);
          
          loadedChannels++;
          
          if (onProgress) {
            const progressCanvas = document.createElement('canvas');
            progressCanvas.width = regionWidth;
            progressCanvas.height = regionHeight;
            progressCanvas.getContext('2d').drawImage(canvas, 0, 0);
            onProgress(loadedChannels, totalChannels, progressCanvas);
          }
          
        } catch (error) {
          console.warn(`Failed to load channel ${config.channelName}: ${error.message}`);
        }
      }
      
      ctx.globalCompositeOperation = 'source-over';
      
      // Calculate actual stage bounds
      const topLeft = this.pixelToStage(xStart, yStart, scaleLevel);
      const bottomRight = this.pixelToStage(xEnd, yEnd, scaleLevel);
      
      return {
        success: true,
        canvas,
        data: canvas.toDataURL('image/png').split(',')[1],
        width: regionWidth,
        height: regionHeight,
        bounds: {
          topLeft: { x: topLeft.x, y: topLeft.y },
          bottomRight: { x: bottomRight.x, y: bottomRight.y }
        },
        width_mm: bottomRight.x - topLeft.x,
        height_mm: bottomRight.y - topLeft.y,
        metadata: {
          scaleLevel,
          timepoint,
          channelsUsed: enabledChannels.map(c => c.channelName)
        }
      };
      
    } catch (error) {
      console.error(`Failed to load region: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Get channel index from name
   */
  getChannelIndex(channelName) {
    const channel = this.structure.channels.find(c => c.label === channelName);
    return channel ? channel.index : 0;
  }

  /**
   * Apply channel color to region data
   */
  applyChannelColor(region, config) {
    const [height, width] = region.shape;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(width, height);
    const pixels = imageData.data;
    
    // Parse color
    const color = config.color || 'FFFFFF';
    const r = parseInt(color.substr(0, 2), 16) / 255;
    const g = parseInt(color.substr(2, 2), 16) / 255;
    const b = parseInt(color.substr(4, 2), 16) / 255;
    
    // Contrast
    const min = config.min || 0;
    const max = config.max || 255;
    const range = max - min;
    
    for (let i = 0; i < region.data.length; i++) {
      const value = region.data[i];
      const normalized = range > 0 ? Math.max(0, Math.min(255, (value - min) * 255 / range)) : 0;
      const idx = i * 4;
      pixels[idx] = normalized * r;
      pixels[idx + 1] = normalized * g;
      pixels[idx + 2] = normalized * b;
      pixels[idx + 3] = value > 0 ? 255 : 0;
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas;
  }

  // ============================================================================
  // Compatibility methods for MicroscopeMapDisplay.jsx
  // ============================================================================

  /**
   * Main entry point for loading tiles (compatibility with existing code)
   */
  getMultipleWellRegionsRealTimeCancellable(wellRequests, onChunkProgress, onWellComplete, useMultiChannel = false, channelConfigs = []) {
    let cancelled = false;
    
    const promise = (async () => {
      const results = [];
      
      for (const request of wellRequests) {
        if (cancelled) {
          results.push({ success: false, wellId: request.wellId, message: 'Cancelled' });
          continue;
        }
        
        const result = await this.loadRegion(
          request.centerX,
          request.centerY,
          request.width_mm,
          request.height_mm,
          useMultiChannel ? channelConfigs : [{ channelName: request.channel || 'BF_LED_matrix_full', enabled: true, min: 0, max: 255, color: 'FFFFFF' }],
          request.scaleLevel,
          request.timepoint || 0,
          (loaded, total, canvas) => {
            if (!cancelled && onChunkProgress) {
              onChunkProgress(request.wellId, loaded, total, canvas);
            }
          }
        );
        
        if (result && result.success) {
          // Add compatibility fields
          result.wellId = request.wellId;
          result.centerX = request.centerX;
          result.centerY = request.centerY;
          result.metadata = {
            ...result.metadata,
            actualStageBounds: {
              startX: result.bounds.topLeft.x,
              startY: result.bounds.topLeft.y,
              endX: result.bounds.bottomRight.x,
              endY: result.bounds.bottomRight.y,
              width: result.width_mm,
              height: result.height_mm
            },
            width_mm: result.width_mm,
            height_mm: result.height_mm
          };
        }
        
        results.push(result || { success: false, wellId: request.wellId, message: 'No data' });
        
        if (!cancelled && onWellComplete && result) {
          onWellComplete(request.wellId, result);
        }
      }
      
      return results;
    })();
    
    return {
      promise,
      cancel: () => { cancelled = true; return 1; }
    };
  }


  extractDatasetId(datasetId) {
    return datasetId;
  }

  async getActiveChannelsFromZattrs() {
    // Return channels with their actual active status from .zattrs
    // Note: In this dataset, all channels have active: false
    // We'll return the first channel (BF) as active by default so something loads
    return {
      activeChannels: this.structure.channels.map((ch, idx) => ({
        index: ch.index,
        label: ch.label,
        active: idx === 0, // Only first channel (BF) active by default
        color: ch.color,
        window: { start: 0, end: 255 },
        coefficient: 1.0,
        family: 'linear'
      })),
      channelMapping: {
        'BF LED matrix full': 0,
        'Fluorescence 405 nm Ex': 1,
        'Fluorescence 488 nm Ex': 2,
        'Fluorescence 638 nm Ex': 3,
        'Fluorescence 561 nm Ex': 4,
        'Fluorescence 730 nm Ex': 5
      },
      zarrIndexMapping: {
        0: 'BF LED matrix full',
        1: 'Fluorescence 405 nm Ex',
        2: 'Fluorescence 488 nm Ex',
        3: 'Fluorescence 638 nm Ex',
        4: 'Fluorescence 561 nm Ex',
        5: 'Fluorescence 730 nm Ex'
      },
      totalChannels: this.structure.channels.length
    };
  }

  async getAvailableChunks() {
    return ['available'];
  }

  async fetchZarrMetadata(baseUrl, scaleLevel) {
    const dims = this.getImageDimensions(scaleLevel);
    return {
      zattrs: { squid_canvas: { pixel_size_xy_um: this.structure.pixelSizeUm } },
      zarray: { shape: [this.structure.shape[0], this.structure.shape[1], this.structure.shape[2], dims.y, dims.x], chunks: this.structure.chunks },
      scaleLevel
    };
  }

  getPixelSizeFromMetadata(metadata, scaleLevel) {
    return this.getPixelSize(scaleLevel);
  }

  stageToPixelCoords(x_mm, y_mm, scaleLevel) {
    return this.stageToPixel(x_mm, y_mm, scaleLevel);
  }

  async getAvailableChunksForRegion() {
    return ['available'];
  }

  getVisibleWellsInRegion(allWells) {
    return allWells;
  }

  cancelAllRequests() {
    return 0;
  }

  cancelActiveRequests() {}

  clearCaches() {
    this.arrayCache.clear();
  }

  getCacheStats() {
    return { arrayCacheSize: this.arrayCache.size };
  }
}

export default ArtifactZarrLoader;
