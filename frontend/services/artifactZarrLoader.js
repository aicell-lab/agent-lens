/**
 * Artifact Zarr Loader Service
 * 
 * This service handles loading OME-Zarr data from artifact manager for historical data viewing.
 * It provides functionality similar to microscopeControlService.get_stitched_region but for
 * pre-uploaded time-lapse data stored in the artifact manager.
 * 
 * OME-Zarr 0.4 specification: 5D array (T, C, Z, Y, X) with multi-scale pyramid
 */

class ArtifactZarrLoader {
  constructor() {
    this.metadataCache = new Map(); // Cache for zattrs and zarray metadata
    this.chunkCache = new Map(); // Cache for decoded chunks
    this.activeRequests = new Set(); // Track active requests to prevent duplicates
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
  }

  /**
   * Main function to get historical stitched region - similar to get_stitched_region
   * @param {number} centerX - Center X coordinate in mm (well-relative)
   * @param {number} centerY - Center Y coordinate in mm (well-relative) 
   * @param {number} width_mm - Width of region in mm
   * @param {number} height_mm - Height of region in mm
   * @param {string} wellPlateType - Well plate type ('96', '48', '24')
   * @param {number} scaleLevel - Zarr scale level (0-5)
   * @param {string} channel - Channel name (e.g., 'BF LED matrix full')
   * @param {number} timepoint - Time point index (default 0)
   * @param {string} outputFormat - Output format ('base64', 'blob', 'array')
   * @param {string} datasetId - Dataset ID from artifact manager
   * @param {string} wellId - Well ID (e.g., 'A2')
   * @returns {Promise<Object>} Result object with success flag and data
   */
  async getHistoricalStitchedRegion(
    centerX, centerY, width_mm, height_mm, wellPlateType, scaleLevel, 
    channel, timepoint = 0, outputFormat = 'base64',
    datasetId, wellId
  ) {
    try {
      // 1. Determine well from position (already provided as wellId)
      if (!wellId) {
        return { success: false, message: 'Well ID is required' };
      }

      // 2. Check if canvas exists for this well
      const canvasExists = await this.checkCanvasExists(datasetId, wellId);
      if (!canvasExists) {
        return { success: false, message: `No canvas data found for well ${wellId}` };
      }

      // 3. Get well-relative coordinates (centerX, centerY are already relative)
      const relativeCoords = {
        centerX: centerX || 0.0,
        centerY: centerY || 0.0,
        width_mm,
        height_mm
      };

      // 4. Call get_well_stitched_region with well-relative coordinates
      const result = await this.getWellStitchedRegion(
        relativeCoords, scaleLevel, channel, timepoint, outputFormat, datasetId, wellId
      );

      return result;

    } catch (error) {
      console.error('Failed to get historical stitched region:', error);
      return { 
        success: false, 
        message: `Failed to load historical data: ${error.message}` 
      };
    }
  }

  /**
   * Extract the correct dataset ID from a potentially slash-containing ID
   * @param {string} datasetId - Dataset ID that might contain slashes
   * @returns {string} The correct dataset ID (right side of last slash, or original if no slash)
   */
  extractDatasetId(datasetId) {
    if (datasetId.includes('/')) {
      return datasetId.split('/').pop();
    }
    return datasetId;
  }

  /**
   * Check if canvas (zip file) exists for the given well
   * @param {string} datasetId - Dataset ID
   * @param {string} wellId - Well ID (e.g., 'A2')
   * @returns {Promise<boolean>} True if canvas exists
   */
  async checkCanvasExists(datasetId, wellId) {
    try {
      // Extract the correct dataset ID
      const correctDatasetId = this.extractDatasetId(datasetId);
      
      // Instead of checking the zip file directly, check if the zarr metadata exists
      const zarrBaseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      const zattrsUrl = `${zarrBaseUrl}.zattrs`;
      
      // Try to fetch the zattrs file to check if the zarr data exists
      const response = await fetch(zattrsUrl);
      return response.ok;
    } catch (error) {
      console.error(`Error checking canvas existence for well ${wellId}:`, error);
      return false;
    }
  }

  /**
   * Get stitched region from well data using well-relative coordinates
   * @param {Object} relativeCoords - Well-relative coordinates
   * @param {number} scaleLevel - Zarr scale level
   * @param {string} channel - Channel name
   * @param {number} timepoint - Time point index
   * @param {string} outputFormat - Output format
   * @param {string} datasetId - Dataset ID
   * @param {string} wellId - Well ID
   * @returns {Promise<Object>} Result with image data
   */
  async getWellStitchedRegion(relativeCoords, scaleLevel, channel, timepoint, outputFormat, datasetId, wellId) {
    try {
      // Extract the correct dataset ID
      const correctDatasetId = this.extractDatasetId(datasetId);
      
      // Construct base URL for this well's zarr data
      const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      
      // Get metadata for this scale level
      const metadata = await this.fetchZarrMetadata(baseUrl, scaleLevel);
      if (!metadata) {
        return { success: false, message: 'Failed to fetch Zarr metadata' };
      }

      // Map channel name to index
      const channelIndex = await this.getChannelIndex(baseUrl, channel);
      if (channelIndex === null) {
        return { success: false, message: `Channel '${channel}' not found` };
      }

      // Calculate chunk coordinates for the requested region
      const chunks = this.calculateChunkCoordinates(
        relativeCoords, metadata, timepoint, channelIndex, scaleLevel
      );

      // Fetch and compose chunks into image
      const imageData = await this.composeImageFromChunks(
        baseUrl, chunks, metadata, scaleLevel
      );

      if (!imageData) {
        return { success: false, message: 'Failed to compose image from chunks' };
      }

      // Convert to requested output format
      const outputData = await this.normalizeAndEncodeImage(
        imageData, metadata, outputFormat
      );

      return {
        success: true,
        data: outputData,
        metadata: {
          width: imageData.width,
          height: imageData.height,
          channel,
          scale: scaleLevel,
          timepoint,
          wellId
        }
      };

    } catch (error) {
      console.error('Error in getWellStitchedRegion:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Fetch Zarr metadata (zattrs and zarray)
   * @param {string} baseUrl - Base URL for zarr data
   * @param {number} scaleLevel - Scale level
   * @returns {Promise<Object|null>} Metadata object
   */
  async fetchZarrMetadata(baseUrl, scaleLevel) {
    const cacheKey = `${baseUrl}${scaleLevel}`;
    
    // Check cache first
    if (this.metadataCache.has(cacheKey)) {
      return this.metadataCache.get(cacheKey);
    }

    try {
      // Fetch zattrs (contains channel mapping and other metadata)
      const zattrsUrl = `${baseUrl}.zattrs`;
      const zattrsResponse = await fetch(zattrsUrl);
      if (!zattrsResponse.ok) {
        throw new Error(`Failed to fetch zattrs: ${zattrsResponse.status}`);
      }
      const zattrs = await zattrsResponse.json();

      // Fetch zarray for the specific scale level
      const zarrayUrl = `${baseUrl}${scaleLevel}/.zarray`;
      const zarrayResponse = await fetch(zarrayUrl);
      if (!zarrayResponse.ok) {
        throw new Error(`Failed to fetch zarray for scale ${scaleLevel}: ${zarrayResponse.status}`);
      }
      const zarray = await zarrayResponse.json();

      const metadata = { zattrs, zarray, scaleLevel };
      
      // Cache the metadata
      this.metadataCache.set(cacheKey, metadata);
      
      return metadata;

    } catch (error) {
      console.error(`Error fetching Zarr metadata for scale ${scaleLevel}:`, error);
      return null;
    }
  }

  /**
   * Get channel index from channel name
   * @param {string} baseUrl - Base URL for zarr data
   * @param {string} channelName - Channel name
   * @returns {Promise<number|null>} Channel index or null if not found
   */
  async getChannelIndex(baseUrl, channelName) {
    try {
      // Get zattrs to find channel mapping
      const zattrsUrl = `${baseUrl}.zattrs`;
      const response = await fetch(zattrsUrl);
      if (!response.ok) {
        return null;
      }
      
      const zattrs = await response.json();
      
      // Check squid_canvas channel mapping first
      if (zattrs.squid_canvas && zattrs.squid_canvas.channel_mapping) {
        const channelIndex = zattrs.squid_canvas.channel_mapping[channelName];
        if (channelIndex !== undefined) {
          return channelIndex;
        }
      }
      
      // Fallback to omero channels
      if (zattrs.omero && zattrs.omero.channels) {
        const channelIndex = zattrs.omero.channels.findIndex(
          ch => ch.label === channelName
        );
        if (channelIndex !== -1) {
          return channelIndex;
        }
      }
      
      return null;

    } catch (error) {
      console.error('Error getting channel index:', error);
      return null;
    }
  }

  /**
   * Calculate chunk coordinates for the requested region
   * @param {Object} relativeCoords - Well-relative coordinates
   * @param {Object} metadata - Zarr metadata
   * @param {number} timepoint - Time point index
   * @param {number} channelIndex - Channel index
   * @returns {Array} Array of chunk coordinates
   */
  calculateChunkCoordinates(relativeCoords, metadata, timepoint, channelIndex) {
    const { zarray } = metadata;
    const [, , , ySize, xSize] = zarray.shape;
    const [, , , yChunk, xChunk] = zarray.chunks;
    
    // Convert mm coordinates to pixel coordinates
    // This is a simplified conversion - in practice, you'd need pixel size from metadata
    const pixelSizeMm = 0.000325; // Default pixel size, should come from metadata
    const startX = Math.floor((relativeCoords.centerX - relativeCoords.width_mm / 2) / pixelSizeMm);
    const startY = Math.floor((relativeCoords.centerY - relativeCoords.height_mm / 2) / pixelSizeMm);
    const endX = Math.floor((relativeCoords.centerX + relativeCoords.width_mm / 2) / pixelSizeMm);
    const endY = Math.floor((relativeCoords.centerY + relativeCoords.height_mm / 2) / pixelSizeMm);
    
    // Clamp to image boundaries
    const clampedStartX = Math.max(0, startX);
    const clampedStartY = Math.max(0, startY);
    const clampedEndX = Math.min(xSize - 1, endX);
    const clampedEndY = Math.min(ySize - 1, endY);
    
    // Calculate chunk coordinates
    const chunks = [];
    const tCoord = timepoint;
    const cCoord = channelIndex;
    const zCoord = 0; // Default to first Z slice
    
    for (let y = Math.floor(clampedStartY / yChunk); y <= Math.floor(clampedEndY / yChunk); y++) {
      for (let x = Math.floor(clampedStartX / xChunk); x <= Math.floor(clampedEndX / xChunk); x++) {
        chunks.push({
          coordinates: [tCoord, cCoord, zCoord, y, x],
          filename: `chunk_t${tCoord}_c${cCoord}_z${zCoord}_y${y}_x${x}`
        });
      }
    }
    
    return chunks;
  }

  /**
   * Compose image from multiple chunks
   * @param {string} baseUrl - Base URL for zarr data
   * @param {Array} chunks - Array of chunk coordinates
   * @param {Object} metadata - Zarr metadata
   * @param {number} scaleLevel - Scale level
   * @returns {Promise<Object|null>} Composed image data
   */
  async composeImageFromChunks(baseUrl, chunks, metadata, scaleLevel) {
    try {
      const { zarray } = metadata;
      const [, , , yChunk, xChunk] = zarray.chunks;
      const dataType = zarray.dtype;
      
      // Calculate total image dimensions from chunks
      const minY = Math.min(...chunks.map(c => c.coordinates[3]));
      const maxY = Math.max(...chunks.map(c => c.coordinates[3]));
      const minX = Math.min(...chunks.map(c => c.coordinates[4]));
      const maxX = Math.max(...chunks.map(c => c.coordinates[4]));
      
      const totalHeight = (maxY - minY + 1) * yChunk;
      const totalWidth = (maxX - minX + 1) * xChunk;
      
      // Create canvas for composition
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      
      // Fetch and place each chunk
      for (const chunk of chunks) {
        const [t, c, z, y, x] = chunk.coordinates;
        const chunkUrl = `${baseUrl}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
        
        const chunkData = await this.fetchZarrChunk(chunkUrl, dataType);
        if (chunkData) {
          // Convert chunk data to ImageData
          const imageData = this.decodeChunk(chunkData, [yChunk, xChunk], dataType);
          if (imageData) {
            // Create temporary canvas for this chunk
            const chunkCanvas = document.createElement('canvas');
            chunkCanvas.width = imageData.width;
            chunkCanvas.height = imageData.height;
            const chunkCtx = chunkCanvas.getContext('2d');
            
            // Put image data on chunk canvas
            chunkCtx.putImageData(imageData, 0, 0);
            
            // Calculate position in composed image
            const posX = (y - minY) * yChunk;
            const posY = (x - minX) * xChunk;
            
            // Draw chunk onto main canvas
            ctx.drawImage(chunkCanvas, posX, posY);
          }
        }
      }
      
      return {
        width: totalWidth,
        height: totalHeight,
        canvas: canvas
      };

    } catch (error) {
      console.error('Error composing image from chunks:', error);
      return null;
    }
  }

  /**
   * Fetch individual zarr chunk
   * @param {string} chunkUrl - URL for the chunk
   * @param {string} dataType - Data type (uint8, uint16, etc.)
   * @returns {Promise<ArrayBuffer|null>} Chunk data
   */
  async fetchZarrChunk(chunkUrl, dataType) {
    const cacheKey = `${chunkUrl}_${dataType}`;
    
    // Check cache first
    if (this.chunkCache.has(cacheKey)) {
      return this.chunkCache.get(cacheKey);
    }

    try {
      const response = await fetch(chunkUrl);
      if (!response.ok) {
        return null;
      }
      
      const chunkData = await response.arrayBuffer();
      
      // Cache the chunk data
      this.chunkCache.set(cacheKey, chunkData);
      
      return chunkData;

    } catch (error) {
      console.error(`Error fetching chunk ${chunkUrl}:`, error);
      return null;
    }
  }

  /**
   * Decode chunk data to ImageData
   * @param {ArrayBuffer} chunkData - Raw chunk data
   * @param {Array} chunkShape - Chunk dimensions [height, width]
   * @param {string} dataType - Data type
   * @returns {ImageData|null} Decoded image data
   */
  decodeChunk(chunkData, chunkShape, dataType) {
    try {
      const [height, width] = chunkShape;
      
             // Convert ArrayBuffer to appropriate data type
       let array;
       if (dataType === 'uint8' || dataType === '|u1') {
         array = new Uint8Array(chunkData);
       } else if (dataType === 'uint16' || dataType === '|u2') {
         array = new Uint16Array(chunkData);
       } else {
         throw new Error(`Unsupported data type: ${dataType}`);
       }
      
      // Create ImageData
      const imageData = new ImageData(width, height);
      const pixels = imageData.data;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIndex = y * width + x;
          const dstIndex = (y * width + x) * 4;
          
          // Get pixel value and normalize
          const value = array[srcIndex];
          let normalizedValue;
          
          if (dataType === 'uint8' || dataType === '|u1') {
            normalizedValue = value;
          } else {
            // 16-bit data needs normalization
            normalizedValue = Math.floor((value / 65535) * 255);
          }
          
          // Create grayscale image (R=G=B=value, A=255)
          pixels[dstIndex] = normalizedValue;     // R
          pixels[dstIndex + 1] = normalizedValue; // G
          pixels[dstIndex + 2] = normalizedValue; // B
          pixels[dstIndex + 3] = 255;             // A
        }
      }
      
      return imageData;

    } catch (error) {
      console.error('Error decoding chunk:', error);
      return null;
    }
  }

  /**
   * Normalize and encode image to requested format
   * @param {Object} imageData - Image data object with canvas
   * @param {Object} metadata - Zarr metadata
   * @param {string} outputFormat - Output format
   * @returns {Promise<string|Blob|Array>} Encoded data
   */
  async normalizeAndEncodeImage(imageData, metadata, outputFormat) {
    try {
      const { canvas } = imageData;
      
      if (outputFormat === 'base64') {
        return canvas.toDataURL('image/png').split(',')[1]; // Remove data URL prefix
      } else if (outputFormat === 'blob') {
        return new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/png');
        });
      } else if (outputFormat === 'array') {
        const ctx = canvas.getContext('2d');
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
      } else {
        throw new Error(`Unsupported output format: ${outputFormat}`);
      }

    } catch (error) {
      console.error('Error encoding image:', error);
      return null;
    }
  }

  /**
   * Clear caches to free memory
   */
  clearCaches() {
    this.metadataCache.clear();
    this.chunkCache.clear();
  }

  /**
   * Cancel all active requests
   */
  cancelActiveRequests() {
    this.activeRequests.clear();
  }
}

// Export the class
export default ArtifactZarrLoader; 