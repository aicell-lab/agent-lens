/**
 * Artifact Zarr Loader Service - Simplified zarrita.js Implementation
 * 
 * Loads OME-Zarr data from the example-image-data.zarr endpoint using zarrita.js.
 * This is a simplified loader for the simulated microscope that loads a single
 * continuous image (no well structure).
 * 
 * OME-Zarr structure: 5D array (T, C, Z, Y, X) with multi-scale pyramid (6 levels: 0-5)
 * 
 * NOTE: All metadata is loaded dynamically from the zarr's .zattrs file - no hardcoding!
 */

import * as zarr from "zarrita";

// Endpoint for the example zarr dataset
const ZARR_ENDPOINT = "https://hypha.aicell.io/agent-lens/apps/agent-lens/example-image-data.zarr";

class ArtifactZarrLoader {
  constructor() {
    this.baseUrl = ZARR_ENDPOINT;
    this.arrayCache = new Map();
    
    // These will be populated by init() from .zattrs
    this.structure = null;
    this.imageExtent = null;
    this.initialized = false;
    this.initPromise = null;
    
  }
  
  /**
   * Initialize the loader by fetching metadata from .zattrs
   * This must be called before using the loader
   */
  async init() {
    if (this.initialized) {
      return this;
    }
    
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = this._loadMetadata();
    await this.initPromise;
    return this;
  }
  
  /**
   * Load metadata from the zarr's .zattrs file
   */
  async _loadMetadata() {
    try {
      const response = await fetch(`${this.baseUrl}/.zattrs`);
      if (!response.ok) {
        throw new Error(`Failed to fetch .zattrs: ${response.status} ${response.statusText}`);
      }
      
      const zattrs = await response.json();
      
      // Parse multiscales info
      const multiscales = zattrs.multiscales?.[0];
      if (!multiscales) {
        throw new Error('No multiscales found in .zattrs');
      }
      
      // Get scale levels
      const scaleLevels = multiscales.datasets.map((d, i) => i);
      
      // Get pixel size from first scale level's coordinate transformation
      const pixelSizeUm = multiscales.datasets[0]?.coordinateTransformations?.[0]?.scale?.[3] || 0.311688;
      
      // Parse squid_canvas info for canvas dimensions
      const squidCanvas = zattrs.squid_canvas;
      if (!squidCanvas) {
        throw new Error('No squid_canvas found in .zattrs');
      }
      
      // Get canvas dimensions (default: 120mm x 80mm)
      const canvasWidthMm = squidCanvas.canvas_width_mm ?? 120;
      const canvasHeightMm = squidCanvas.canvas_height_mm ?? 80;
      
      // Parse omero channels
      const omeroChannels = zattrs.omero?.channels || [];
      
      const channels = omeroChannels.map((ch, index) => ({
        index,
        label: ch.label,
        color: ch.color,
        // Zarr uses 'activate' field, map it to 'active' for consistency
        active: ch.activate ?? ch.active ?? false,
        window: ch.window || { start: 0, end: 255 }
      }));
      
      // Also need to load .zarray to get shape and chunks
      const zarrayResponse = await fetch(`${this.baseUrl}/0/.zarray`);
      if (!zarrayResponse.ok) {
        throw new Error(`Failed to fetch .zarray: ${zarrayResponse.status}`);
      }
      const zarray = await zarrayResponse.json();
      
      // Build the structure object (dynamically loaded, not hardcoded!)
      this.structure = {
        scaleLevels,
        pixelSizeUm,
        shape: zarray.shape,  // [T, C, Z, Y, X]
        chunks: zarray.chunks,
        channels,
        canvasWidthMm,
        canvasHeightMm,
        // Store original mappings for channel lookups
        channelMapping: squidCanvas.channel_mapping || {},
        zarrIndexMapping: squidCanvas.zarr_index_mapping || {}
      };
      
      // Calculate image extent from canvas dimensions (canvas starts at 0, 0)
      this.imageExtent = {
        xMin: 0,
        xMax: canvasWidthMm,
        yMin: 0,
        yMax: canvasHeightMm,
        width: canvasWidthMm,
        height: canvasHeightMm
      };
      
      // Summary log
      const activeChannels = channels.filter(c => c.active).map(c => c.label);
      console.log(`✅ Zarr initialized: ${canvasWidthMm}×${canvasHeightMm}mm, ${channels.length} channels (${activeChannels.length} active), ${scaleLevels.length} scale levels`);
      
      this.initialized = true;
      
    } catch (error) {
      console.error(`❌ Failed to load zarr metadata: ${error.message}`);
      console.error(`❌ Error stack:`, error.stack);
      throw error;
    }
  }
  
  /**
   * Ensure the loader is initialized before using
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.init();
    }
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
    await this.ensureInitialized();
    
    if (this.arrayCache.has(scaleLevel)) {
      return this.arrayCache.get(scaleLevel);
    }

    const store = new zarr.FetchStore(`${this.baseUrl}/${scaleLevel}`);
    const arr = await zarr.open(store, { kind: "array" });
    
    this.arrayCache.set(scaleLevel, arr);
    return arr;
  }

  /**
   * Get pixel size at scale level (µm/pixel)
   */
  getPixelSize(scaleLevel = 0) {
    if (!this.structure) return 0.311688 * Math.pow(4, scaleLevel);
    return this.structure.pixelSizeUm * Math.pow(4, scaleLevel);
  }

  /**
   * Get image dimensions at scale level
   */
  getImageDimensions(scaleLevel = 0) {
    if (!this.structure) return { t: 1, c: 1, z: 1, y: 1000, x: 1000 };
    const [t, c, z, y, x] = this.structure.shape;
    const factor = Math.pow(4, scaleLevel);
    return { t, c, z, y: Math.floor(y / factor), x: Math.floor(x / factor) };
  }

  /**
   * Convert stage coordinates (mm) to pixel coordinates
   * Canvas starts at (0, 0)
   */
  stageToPixel(x_mm, y_mm, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    if (!ext) return { x: 0, y: 0 };
    
    // Map stage coordinates to pixel coordinates (canvas starts at 0, 0)
    const x_px = Math.round((x_mm / ext.width) * dims.x);
    const y_px = Math.round((y_mm / ext.height) * dims.y);
    
    return { x: x_px, y: y_px };
  }

  /**
   * Convert pixel coordinates to stage coordinates (mm)
   * Canvas starts at (0, 0)
   */
  pixelToStage(x_px, y_px, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    if (!ext) return { x: 0, y: 0 };
    
    // Map pixel coordinates to stage coordinates (canvas starts at 0, 0)
    const x_mm = (x_px / dims.x) * ext.width;
    const y_mm = (y_px / dims.y) * ext.height;
    
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
    await this.ensureInitialized();
    
    try {
      const dims = this.getImageDimensions(scaleLevel);
      const pixelSize = this.getPixelSize(scaleLevel);
      
      // Check if requested region is within image bounds
      const ext = this.imageExtent;
      
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
    if (!this.structure) return 0;
    
    // First try the channel mapping from squid_canvas
    if (this.structure.channelMapping && this.structure.channelMapping[channelName] !== undefined) {
      return this.structure.channelMapping[channelName];
    }
    
    // Fall back to finding by label
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
      await this.ensureInitialized();
      
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
    await this.ensureInitialized();
    
    // Return channels with their actual active status from .zattrs
    // Use the 'active' field that was parsed from 'activate' in zarr metadata
    return {
      activeChannels: this.structure.channels.map((ch, idx) => ({
        index: ch.index,
        label: ch.label,
        active: ch.active, // Use the parsed active status from zarr (mapped from 'activate')
        color: ch.color,
        window: ch.window || { start: 0, end: 255 },
        coefficient: 1.0,
        family: 'linear'
      })),
      channelMapping: this.structure.channelMapping,
      zarrIndexMapping: this.structure.zarrIndexMapping,
      totalChannels: this.structure.channels.length
    };
  }

  async getAvailableChunks() {
    return ['available'];
  }

  async fetchZarrMetadata(baseUrl, scaleLevel) {
    await this.ensureInitialized();
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
