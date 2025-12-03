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
    
    // Coordinate offset to align zarr data with current microscope well plate position
    // This offset is SUBTRACTED from requested coordinates before fetching data
    // Example: If zarr well is at (27, 18) but microscope says (32, 20),
    //          set offset to (5, 2) so requests for (32, 20) fetch from (27, 18)
    this.coordinateOffset = { x: 0, y: 0 };
  }
  
  /**
   * Set coordinate offset to align zarr data with microscope well plate configuration
   * @param {number} dx - X offset in mm (microscope_x - zarr_x)
   * @param {number} dy - Y offset in mm (microscope_y - zarr_y)
   */
  setCoordinateOffset(dx, dy) {
    this.coordinateOffset = { x: dx, y: dy };
    console.log(`📍 Zarr coordinate offset set to: X=${dx.toFixed(2)}mm, Y=${dy.toFixed(2)}mm`);
  }
  
  /**
   * Get current coordinate offset
   */
  getCoordinateOffset() {
    return { ...this.coordinateOffset };
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
      console.log(`📥 Loading zarr metadata from ${this.baseUrl}/.zattrs`);
      
      const response = await fetch(`${this.baseUrl}/.zattrs`);
      if (!response.ok) {
        throw new Error(`Failed to fetch .zattrs: ${response.status} ${response.statusText}`);
      }
      
      const zattrs = await response.json();
      console.log(`✅ Loaded .zattrs metadata`);
      
      // Parse multiscales info
      const multiscales = zattrs.multiscales?.[0];
      if (!multiscales) {
        throw new Error('No multiscales found in .zattrs');
      }
      
      // Get scale levels
      const scaleLevels = multiscales.datasets.map((d, i) => i);
      
      // Get pixel size from first scale level's coordinate transformation
      const pixelSizeUm = multiscales.datasets[0]?.coordinateTransformations?.[0]?.scale?.[3] || 0.311688;
      
      // Parse squid_canvas info for stage limits
      const squidCanvas = zattrs.squid_canvas;
      if (!squidCanvas) {
        throw new Error('No squid_canvas found in .zattrs');
      }
      
      const stageLimits = squidCanvas.stage_limits;
      if (!stageLimits) {
        throw new Error('No stage_limits found in squid_canvas');
      }
      
      // Parse omero channels
      const omeroChannels = zattrs.omero?.channels || [];
      const channels = omeroChannels.map((ch, index) => ({
        index,
        label: ch.label,
        color: ch.color,
        active: ch.active,
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
        stageLimits: {
          xMin: stageLimits.x_negative,
          xMax: stageLimits.x_positive,
          yMin: stageLimits.y_negative,
          yMax: stageLimits.y_positive
        },
        // Store original mappings for channel lookups
        channelMapping: squidCanvas.channel_mapping || {},
        zarrIndexMapping: squidCanvas.zarr_index_mapping || {}
      };
      
      // Load wellplate offset from .zattrs if present
      // This allows the zarr data to specify the offset needed to align with microscope config
      const wellplateOffset = squidCanvas.wellplate_offset;
      if (wellplateOffset) {
        this.coordinateOffset = {
          x: wellplateOffset.x_mm || 0,
          y: wellplateOffset.y_mm || 0
        };
        console.log(`📍 Loaded wellplate offset from .zattrs: X=${this.coordinateOffset.x}mm, Y=${this.coordinateOffset.y}mm`);
      } else {
        console.log(`📍 No wellplate_offset in .zattrs, using default (0, 0)`);
      }
      
      // Calculate image extent from stage limits
      const limits = this.structure.stageLimits;
      this.imageExtent = {
        xMin: limits.xMin,
        xMax: limits.xMax,
        yMin: limits.yMin,
        yMax: limits.yMax,
        width: limits.xMax - limits.xMin,
        height: limits.yMax - limits.yMin
      };
      
      console.log(`📐 Zarr image extent (from .zattrs): X[${this.imageExtent.xMin}, ${this.imageExtent.xMax}]mm, Y[${this.imageExtent.yMin}, ${this.imageExtent.yMax}]mm`);
      console.log(`📊 Shape: ${JSON.stringify(this.structure.shape)}, Pixel size: ${this.structure.pixelSizeUm}µm`);
      console.log(`🎨 Channels: ${channels.map(c => c.label).join(', ')}`);
      
      this.initialized = true;
      
    } catch (error) {
      console.error(`❌ Failed to load zarr metadata: ${error.message}`);
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
   * Applies coordinate offset to align zarr data with microscope well plate
   */
  stageToPixel(x_mm, y_mm, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    if (!ext) return { x: 0, y: 0 };
    
    // Apply coordinate offset: subtract offset to convert microscope coords to zarr coords
    // Example: microscope requests (32, 20), offset is (5, 2), zarr coords are (27, 18)
    const adjusted_x = x_mm - this.coordinateOffset.x;
    const adjusted_y = y_mm - this.coordinateOffset.y;
    
    // Map adjusted stage coordinates to pixel coordinates
    const x_px = Math.round((adjusted_x - ext.xMin) / (ext.xMax - ext.xMin) * dims.x);
    const y_px = Math.round((adjusted_y - ext.yMin) / (ext.yMax - ext.yMin) * dims.y);
    
    return { x: x_px, y: y_px };
  }

  /**
   * Convert pixel coordinates to stage coordinates (mm)
   * Applies coordinate offset to report in microscope coordinate system
   */
  pixelToStage(x_px, y_px, scaleLevel = 0) {
    const dims = this.getImageDimensions(scaleLevel);
    const ext = this.imageExtent;
    
    if (!ext) return { x: 0, y: 0 };
    
    // Map pixel coordinates to zarr stage coordinates
    const zarr_x = ext.xMin + (x_px / dims.x) * (ext.xMax - ext.xMin);
    const zarr_y = ext.yMin + (y_px / dims.y) * (ext.yMax - ext.yMin);
    
    // Apply coordinate offset: add offset to convert zarr coords to microscope coords
    const x_mm = zarr_x + this.coordinateOffset.x;
    const y_mm = zarr_y + this.coordinateOffset.y;
    
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
    return {
      activeChannels: this.structure.channels.map((ch, idx) => ({
        index: ch.index,
        label: ch.label,
        active: idx === 0 ? true : ch.active, // First channel active by default
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
