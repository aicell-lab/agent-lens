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
    this.directoryCache = new Map(); // Cache for directory listings
    this.activeRequests = new Set(); // Track active requests to prevent duplicates
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
  }

  /**
   * Get individual well region data
   * This is the primary method for historical data - handles single well requests
   * @param {string} wellId - Well ID (e.g., 'A2')
   * @param {number} centerX - Center X coordinate in mm (well-relative)
   * @param {number} centerY - Center Y coordinate in mm (well-relative)
   * @param {number} width_mm - Width in mm
   * @param {number} height_mm - Height in mm
   * @param {string} channel - Channel name
   * @param {number} scaleLevel - Scale level
   * @param {number} timepoint - Timepoint index
   * @param {string} datasetId - Dataset ID
   * @param {string} outputFormat - Output format ('base64', 'blob', 'array')
   * @returns {Promise<Object>} Well region data
   */
  async getWellRegion(
    wellId, centerX, centerY, width_mm, height_mm, channel, scaleLevel, 
    timepoint = 0, datasetId, outputFormat = 'base64'
  ) {
    try {
      console.log(`Well region request: well=${wellId}, center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ` +
                  `size=(${width_mm.toFixed(2)}x${height_mm.toFixed(2)}), ` +
                  `scale=${scaleLevel}, channel=${channel}`);

      // Check if well canvas exists
      const canvasExists = await this.checkCanvasExists(datasetId, wellId);
      if (!canvasExists) {
        console.warn(`Well canvas for ${wellId} does not exist`);
        return { success: false, message: `Well canvas for ${wellId} does not exist` };
      }

      // Get well canvas region using well-relative coordinates
      const region = await this.getWellCanvasRegion(
        centerX, centerY, width_mm, height_mm,
        channel, scaleLevel, timepoint, datasetId, wellId
      );
      
      if (!region) {
        console.warn(`Failed to get region from well ${wellId}`);
        return { success: false, message: `Failed to get region from well ${wellId}` };
      }
      
      console.log(`Retrieved well region from ${wellId}, size: ${region.width}x${region.height}`);
      
      // Convert to requested output format
      const outputData = await this.normalizeAndEncodeImage(region, null, outputFormat);
      
      return {
        success: true,
        data: outputData,
        metadata: {
          width: region.width,
          height: region.height,
          channel,
          scale: scaleLevel,
          timepoint,
          wellId,
          centerX,
          centerY,
          width_mm,
          height_mm
        }
      };

    } catch (error) {
      console.error(`Failed to get well region for ${wellId}:`, error);
      return { 
        success: false, 
        message: `Failed to load well ${wellId}: ${error.message}` 
      };
    }
  }

  /**
   * Get multiple well regions in parallel
   * @param {Array} wellRequests - Array of well request objects
   * @returns {Promise<Array>} Array of well region results
   */
  async getMultipleWellRegions(wellRequests) {
    try {
      console.log(`Loading ${wellRequests.length} well regions in parallel`);
      
      // Process all wells in parallel
      const wellPromises = wellRequests.map(async (request) => {
        const { wellId, centerX, centerY, width_mm, height_mm, channel, scaleLevel, timepoint, datasetId, outputFormat } = request;
        
        try {
          const result = await this.getWellRegion(
            wellId, centerX, centerY, width_mm, height_mm, channel, scaleLevel, 
            timepoint, datasetId, outputFormat
          );
          
          return {
            ...result,
            wellId,
            centerX,
            centerY,
            width_mm,
            height_mm
          };
        } catch (error) {
          console.error(`Error loading well ${wellId}:`, error);
          return {
            success: false,
            wellId,
            message: error.message
          };
        }
      });
      
      const results = await Promise.all(wellPromises);
      
      // Count successful results
      const successfulResults = results.filter(r => r.success);
      console.log(`Successfully loaded ${successfulResults.length}/${wellRequests.length} well regions`);
      
      return results;
      
    } catch (error) {
      console.error('Failed to load multiple well regions:', error);
      return wellRequests.map(request => ({
        success: false,
        wellId: request.wellId,
        message: error.message
      }));
    }
  }

  /**
   * Legacy function - kept for backward compatibility
   * This should be replaced by the new multi-well workflow in the frontend
   */
  async getHistoricalStitchedRegion(
    centerX, centerY, width_mm, height_mm, wellPlateType, scaleLevel, 
    channel, timepoint = 0, outputFormat = 'base64',
    datasetId
  ) {
    console.warn('getHistoricalStitchedRegion is deprecated. Use getWellRegion or getMultipleWellRegions instead.');
    
    // Simple fallback - just try to get a single well region
    try {
      const result = await this.getWellRegion(
        'A2', // Default well
        0, 0, // Well-relative coordinates
        width_mm, height_mm,
        channel, scaleLevel, timepoint, datasetId, outputFormat
      );
      
      if (result.success) {
        // Convert to legacy format
        return {
          success: true,
          data: result.data,
          metadata: {
            ...result.metadata,
            bounds: {
              topLeft: { x: centerX - width_mm/2, y: centerY - height_mm/2 },
              bottomRight: { x: centerX + width_mm/2, y: centerY + height_mm/2 }
            },
            region_mm: { width: width_mm, height: height_mm }
          }
        };
      }
      
      return result;
    } catch (error) {
      return { 
        success: false, 
        message: `Legacy method failed: ${error.message}` 
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
      
      // Check if the zip file exists by trying to access the zarr metadata
      const zarrBaseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      const zattrsUrl = `${zarrBaseUrl}.zattrs`;
      
      // Use a timeout to avoid hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      try {
        const response = await fetch(zattrsUrl, {
          method: 'GET',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (response.ok) {
          console.log(`✓ Well canvas for ${wellId} exists`);
          return true;
        } else {
          console.log(`✗ Well canvas for ${wellId} does not exist (${response.status})`);
          return false;
        }
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.log(`✗ Well canvas for ${wellId} check timed out`);
        } else {
          console.log(`✗ Well canvas for ${wellId} does not exist (${fetchError.message})`);
        }
        return false;
      }
    } catch (error) {
      console.error(`Error checking canvas existence for well ${wellId}:`, error);
      return false;
    }
  }



  /**
   * Get canvas region by channel name - JavaScript version of get_canvas_region_by_channel_name
   * This method receives ABSOLUTE stage coordinates (like Python get_canvas_region)
   */
  async getWellCanvasRegion(x_mm, y_mm, width_mm, height_mm, channelName, scale, timepoint, datasetId, wellId) {
    try {
      // Extract the correct dataset ID
      const correctDatasetId = this.extractDatasetId(datasetId);
      
      // Construct base URL for this well's zarr data
      const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      
      // Get metadata for this scale level
      const metadata = await this.fetchZarrMetadata(baseUrl, scale);
      if (!metadata) {
        throw new Error('Failed to fetch Zarr metadata');
      }

      // Map channel name to index
      const channelIndex = await this.getChannelIndex(baseUrl, channelName);
      if (channelIndex === null) {
        throw new Error(`Channel '${channelName}' not found`);
      }

      // Get pixel size from metadata (following the scale transformations)
      const pixelSizeUm = this.getPixelSizeFromMetadata(metadata, scale);
      if (!pixelSizeUm) {
        throw new Error('Could not determine pixel size from metadata');
      }

      console.log(`Using pixel size: ${pixelSizeUm} µm per pixel at scale ${scale}`);
      console.log(`Requested region: center=(${x_mm.toFixed(3)}, ${y_mm.toFixed(3)}) mm, size=${width_mm.toFixed(3)}x${height_mm.toFixed(3)} mm`);

      // Convert stage coordinates to pixel coordinates (using zarr coordinate system)
      const centerPixelCoords = this.stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata);
      console.log(`Converted to pixel coords: (${centerPixelCoords.x}, ${centerPixelCoords.y}) at scale ${scale}`);
      
      // Calculate pixel dimensions at the current scale level
      const scale_factor = Math.pow(4, scale);
      const width_px = Math.round(width_mm * 1000 / (pixelSizeUm * scale_factor));
      const height_px = Math.round(height_mm * 1000 / (pixelSizeUm * scale_factor));
      
      console.log(`Region: center=(${centerPixelCoords.x}, ${centerPixelCoords.y}) px, size=${width_px}x${height_px} px`);

      // Calculate bounds (following Python logic more closely)
      const { zarray } = metadata;
      const [, , , imageHeight, imageWidth] = zarray.shape;
      
      // Calculate start and end coordinates, ensuring they're within image bounds
      // If the center is outside the image, clamp it to the image bounds
      const clampedCenterX = Math.max(Math.floor(width_px / 2), Math.min(imageWidth - Math.floor(width_px / 2), centerPixelCoords.x));
      const clampedCenterY = Math.max(Math.floor(height_px / 2), Math.min(imageHeight - Math.floor(height_px / 2), centerPixelCoords.y));
      
      let x_start = Math.max(0, clampedCenterX - Math.floor(width_px / 2));
      let y_start = Math.max(0, clampedCenterY - Math.floor(height_px / 2));
      let x_end = Math.min(imageWidth, x_start + width_px);
      let y_end = Math.min(imageHeight, y_start + height_px);
      
      console.log(`Clamped center: (${clampedCenterX}, ${clampedCenterY}) from original (${centerPixelCoords.x}, ${centerPixelCoords.y})`);
      
      // Ensure we have a valid region
      if (x_start >= x_end || y_start >= y_end) {
        console.warn(`Invalid pixel region: x(${x_start}-${x_end}), y(${y_start}-${y_end}) for image size ${imageWidth}x${imageHeight} - returning empty region`);
        // Return a small empty canvas instead of throwing an error
        const emptyCanvas = document.createElement('canvas');
        emptyCanvas.width = 1;
        emptyCanvas.height = 1;
        return {
          width: 1,
          height: 1,
          canvas: emptyCanvas,
          loadedChunks: 0,
          totalChunks: 0
        };
      }

      console.log(`Pixel bounds: x(${x_start}-${x_end}), y(${y_start}-${y_end}), image size: ${imageWidth}x${imageHeight}`);

      // Calculate chunk coordinates for the region
      const chunks = this.calculateChunkCoordinatesFromPixels(
        x_start, y_start, x_end, y_end, timepoint, channelIndex, zarray
      );

      // Get available chunks and fetch the region
      const availableChunks = await this.getAvailableChunks(baseUrl, scale);
      if (!availableChunks) {
        throw new Error('Failed to get available chunks');
      }

      // Filter chunks to only available ones
      const availableChunkSet = new Set(availableChunks);
      const filteredChunks = chunks.filter(chunk => {
        return availableChunkSet.has(chunk.filename);
      });

      if (filteredChunks.length === 0) {
        throw new Error('No available chunks found for the requested region');
      }

      // Fetch and compose chunks into image
      const imageData = await this.composeImageFromChunks(
        baseUrl, filteredChunks, metadata, scale, x_start, y_start, x_end - x_start, y_end - y_start
      );

      return imageData;

    } catch (error) {
      console.error('Error in getWellCanvasRegion:', error);
      return null;
    }
  }

  /**
   * Get pixel size from OME-Zarr metadata
   */
  getPixelSizeFromMetadata(metadata, scaleLevel) {
    try {
      const { zattrs } = metadata;
      
      // Check for squid_canvas metadata first (custom format)
      if (zattrs.squid_canvas && zattrs.squid_canvas.pixel_size_xy_um) {
        const basePixelSize = zattrs.squid_canvas.pixel_size_xy_um;
        // Return base pixel size - scale factor will be applied elsewhere
        return basePixelSize;
      }

      // Fallback to OME-Zarr standard multiscales
      if (zattrs.multiscales && zattrs.multiscales.length > 0) {
        const multiscale = zattrs.multiscales[0];
        if (multiscale.datasets && multiscale.datasets[scaleLevel]) {
          const dataset = multiscale.datasets[scaleLevel];
          if (dataset.coordinateTransformations && dataset.coordinateTransformations.length > 0) {
            const transform = dataset.coordinateTransformations[0];
            if (transform.type === 'scale' && transform.scale && transform.scale.length >= 5) {
              // OME-Zarr scale array: [t, c, z, y, x] - we want the y/x scale
              const yScale = transform.scale[3]; // micrometers per pixel
              const xScale = transform.scale[4]; // micrometers per pixel
              // For scale level 0, this should be the base pixel size
              // For higher scales, the scale is already baked into the transform
              if (scaleLevel === 0) {
                return (yScale + xScale) / 2; // Average of x and y scales at base level
              } else {
                // For higher scale levels, divide by the scale factor to get base pixel size
                const scaleFactor = Math.pow(4, scaleLevel);
                return ((yScale + xScale) / 2) / scaleFactor;
              }
            }
          }
        }
      }
      
      // Fallback to default if no metadata found
      console.warn('Could not find pixel size in metadata, using default');
      return 0.311688; // Default base pixel size - scale factor will be applied elsewhere
      
    } catch (error) {
      console.error('Error extracting pixel size from metadata:', error);
      return null;
    }
  }

  /**
   * Convert stage coordinates to pixel coordinates for zarr data
   * Uses the zarr coordinate system directly (centered at 0,0)
   */
  stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata) {
    try {
      const { zarray } = metadata;
      
      // Get image dimensions
      const [, , , imageHeight, imageWidth] = zarray.shape;
      const centerX_px = imageWidth / 2;
      const centerY_px = imageHeight / 2;
      
      // Convert mm to pixels at the requested scale
      // Zarr coordinate system is centered at (0, 0) so we use coordinates directly
      const scale_factor = Math.pow(4, scale);
      const x_px = Math.floor(centerX_px + (x_mm * 1000) / (pixelSizeUm * scale_factor));
      const y_px = Math.floor(centerY_px + (y_mm * 1000) / (pixelSizeUm * scale_factor));
      
      console.log(`Converting zarr coords (${x_mm.toFixed(3)}, ${y_mm.toFixed(3)}) mm to pixels (${x_px}, ${y_px})`);
      
      return { x: x_px, y: y_px };

    } catch (error) {
      console.error('Error converting stage to pixel coordinates:', error);
      // Fallback to image center if conversion fails
      const { zarray } = metadata;
      const [, , , imageHeight, imageWidth] = zarray.shape;
      return { x: Math.floor(imageWidth / 2), y: Math.floor(imageHeight / 2) };
    }
  }

  /**
   * Calculate chunk coordinates from pixel bounds
   */
  calculateChunkCoordinatesFromPixels(x_start, y_start, x_end, y_end, timepoint, channelIndex, zarray) {
    const [, , , yChunk, xChunk] = zarray.chunks;
    
    const chunks = [];
    const tCoord = timepoint;
    const cCoord = channelIndex;
    const zCoord = 0; // Default to first Z slice
    
    // Calculate chunk range
    const startChunkX = Math.floor(x_start / xChunk);
    const endChunkX = Math.floor(x_end / xChunk);
    const startChunkY = Math.floor(y_start / yChunk);
    const endChunkY = Math.floor(y_end / yChunk);
    
    for (let y = startChunkY; y <= endChunkY; y++) {
      for (let x = startChunkX; x <= endChunkX; x++) {
        const chunkName = `${tCoord}.${cCoord}.${zCoord}.${y}.${x}`;
        chunks.push({
          coordinates: [tCoord, cCoord, zCoord, y, x],
          filename: chunkName,
          pixelBounds: {
            x_start: x * xChunk,
            y_start: y * yChunk,
            x_end: (x + 1) * xChunk,
            y_end: (y + 1) * yChunk
          }
        });
    }
    }
    
    return chunks;
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
   * Get list of available chunks for a specific scale level
   * @param {string} baseUrl - Base URL for zarr data
   * @param {number} scaleLevel - Scale level
   * @returns {Promise<Array<string>|null>} Array of available chunk filenames
   */
  async getAvailableChunks(baseUrl, scaleLevel) {
    const cacheKey = `${baseUrl}${scaleLevel}_dir`;
    
    // Check cache first
    if (this.directoryCache.has(cacheKey)) {
      return this.directoryCache.get(cacheKey);
    }

    try {
      const directoryUrl = `${baseUrl}${scaleLevel}/`;
      const response = await fetch(directoryUrl);
      
      if (!response.ok) {
        console.error(`Failed to fetch directory listing for scale ${scaleLevel}: ${response.status}`);
        return null;
      }
      
      const directoryData = await response.json();
      
      // Extract chunk filenames (files that match the pattern t.c.z.y.x)
      const chunkFiles = directoryData
        .filter(item => item.type === 'file' && item.name.match(/^\d+\.\d+\.\d+\.\d+\.\d+$/))
        .map(item => item.name);
      
      // Cache the directory listing
      this.directoryCache.set(cacheKey, chunkFiles);
      
      console.log(`Found ${chunkFiles.length} available chunks for scale ${scaleLevel}`);
      return chunkFiles;

    } catch (error) {
      console.error(`Error fetching directory listing for scale ${scaleLevel}:`, error);
      return null;
    }
  }

  /**
   * Compose image from multiple chunks
   * @param {string} baseUrl - Base URL for zarr data
   * @param {Array} chunks - Array of chunk coordinates (filtered to available chunks)
   * @param {Object} metadata - Zarr metadata
   * @param {number} scaleLevel - Scale level
   * @param {number} regionStartX - Start X pixel coordinate of region
   * @param {number} regionStartY - Start Y pixel coordinate of region
   * @param {number} regionWidth - Width of region in pixels
   * @param {number} regionHeight - Height of region in pixels
   * @returns {Promise<Object|null>} Composed image data
   */
  async composeImageFromChunks(baseUrl, chunks, metadata, scaleLevel, regionStartX, regionStartY, regionWidth, regionHeight) {
    try {
      const { zarray } = metadata;
      const [, , , yChunk, xChunk] = zarray.chunks;
      const dataType = zarray.dtype;
      
      // Use the specified region dimensions instead of calculating from chunks
      const totalWidth = regionWidth;
      const totalHeight = regionHeight;
      
      // Calculate chunk bounds for reference
      const minY = Math.min(...chunks.map(c => c.coordinates[3]));
      const maxY = Math.max(...chunks.map(c => c.coordinates[3]));
      const minX = Math.min(...chunks.map(c => c.coordinates[4]));
      const maxX = Math.max(...chunks.map(c => c.coordinates[4]));
      
      // Debug logging for stitching dimensions
      console.log(`Stitching ${chunks.length} chunks into ${totalWidth}x${totalHeight} image`);
      console.log(`Chunk range: X(${minX}-${maxX}), Y(${minY}-${maxY})`);
      console.log(`Chunk size: ${xChunk}x${yChunk}`);
      console.log(`Region start: (${regionStartX}, ${regionStartY})`);
      
      // Debug: Visualize chunk layout
      const layout = this.visualizeChunkLayout(chunks);
      console.log('Chunk layout:', layout.layout);
      console.log('Chunk grid:');
      layout.grid.forEach((row) => {
        console.log(`  ${row}`);
      });
      
      // Create canvas for composition
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      
      // Track successful chunk loads
      let loadedChunks = 0;
      const totalChunks = chunks.length;
      
      // Create array of chunk loading promises for parallel execution
      const chunkPromises = chunks.map(async (chunk) => {
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
            
            // Calculate position in composed image relative to region start
            const chunkAbsX = x * xChunk;
            const chunkAbsY = y * yChunk;
            const posX = chunkAbsX - regionStartX;
            const posY = chunkAbsY - regionStartY;
            
            // Only process if the chunk intersects with our region
            if (posX < totalWidth && posY < totalHeight && 
                posX + chunkCanvas.width > 0 && posY + chunkCanvas.height > 0) {
              
              // Calculate source and destination rectangles for partial chunks
              const srcX = Math.max(0, regionStartX - chunkAbsX);
              const srcY = Math.max(0, regionStartY - chunkAbsY);
              const srcWidth = Math.min(chunkCanvas.width - srcX, totalWidth - Math.max(0, posX));
              const srcHeight = Math.min(chunkCanvas.height - srcY, totalHeight - Math.max(0, posY));
              
              const destX = Math.max(0, posX);
              const destY = Math.max(0, posY);
            
              // Debug logging for chunk positioning
              console.log(`Placing chunk ${chunk.filename} at dest (${destX}, ${destY}) from src (${srcX}, ${srcY}) size ${srcWidth}x${srcHeight}`);
            
              return {
                chunkCanvas,
                destX,
                destY,
                srcX,
                srcY,
                srcWidth,
                srcHeight
              };
            }
          }
        }
        return null;
      });
      
      // Wait for all chunks to load in parallel
      const chunkResults = await Promise.all(chunkPromises);
      
      // Draw all loaded chunks onto the main canvas
      for (const result of chunkResults) {
        if (result) {
          const { chunkCanvas, destX, destY, srcX, srcY, srcWidth, srcHeight } = result;
          ctx.drawImage(chunkCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, srcWidth, srcHeight);
          loadedChunks++;
        }
      }
      
      console.log(`Successfully loaded ${loadedChunks}/${totalChunks} chunks for scale ${scaleLevel}`);
      
      return {
        width: totalWidth,
        height: totalHeight,
        canvas: canvas,
        loadedChunks,
        totalChunks
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

    // Check if this request is already in progress
    if (this.activeRequests.has(chunkUrl)) {
      // Wait for the existing request to complete
      while (this.activeRequests.has(chunkUrl)) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      // Check cache again after waiting
      if (this.chunkCache.has(cacheKey)) {
        return this.chunkCache.get(cacheKey);
      }
    }

    // Add to active requests
    this.activeRequests.add(chunkUrl);

    try {
      const response = await fetch(chunkUrl);
      if (!response.ok) {
        console.warn(`Chunk not found: ${chunkUrl} (${response.status})`);
        return null;
      }
      
      const chunkData = await response.arrayBuffer();
      
      // Cache the chunk data
      this.chunkCache.set(cacheKey, chunkData);
      
      return chunkData;

    } catch (error) {
      console.error(`Error fetching chunk ${chunkUrl}:`, error);
      return null;
    } finally {
      // Remove from active requests
      this.activeRequests.delete(chunkUrl);
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
    this.directoryCache.clear();
  }

  /**
   * Cancel all active requests
   */
  cancelActiveRequests() {
    this.activeRequests.clear();
  }

  /**
   * Get cache statistics for debugging
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      metadataCacheSize: this.metadataCache.size,
      chunkCacheSize: this.chunkCache.size,
      directoryCacheSize: this.directoryCache.size,
      activeRequests: this.activeRequests.size
    };
  }

  /**
   * Test directory listing for a specific dataset and scale level
   * This is useful for debugging and understanding available data
   * @param {string} datasetId - Dataset ID
   * @param {string} wellId - Well ID (e.g., 'A2')
   * @param {number} scaleLevel - Scale level to test
   * @returns {Promise<Object>} Directory listing information
   */
  async testDirectoryListing(datasetId, wellId, scaleLevel) {
    try {
      const correctDatasetId = this.extractDatasetId(datasetId);
      const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      
      console.log(`Testing directory listing for: ${baseUrl}${scaleLevel}/`);
      
      const availableChunks = await this.getAvailableChunks(baseUrl, scaleLevel);
      
      if (!availableChunks) {
        return {
          success: false,
          message: `Failed to get directory listing for scale ${scaleLevel}`,
          url: `${baseUrl}${scaleLevel}/`
        };
      }
      
      // Analyze chunk patterns
      const chunkAnalysis = this.analyzeChunkPatterns(availableChunks);
      
      return {
        success: true,
        scaleLevel,
        totalChunks: availableChunks.length,
        chunkAnalysis,
        sampleChunks: availableChunks.slice(0, 10), // First 10 chunks as examples
        url: `${baseUrl}${scaleLevel}/`
      };
      
    } catch (error) {
      console.error('Error testing directory listing:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Analyze chunk patterns to understand data structure
   * @param {Array<string>} chunks - Array of chunk filenames
   * @returns {Object} Analysis of chunk patterns
   */
  analyzeChunkPatterns(chunks) {
    if (chunks.length === 0) {
      return { message: 'No chunks found' };
    }
    
    // Parse chunk coordinates
    const parsedChunks = chunks.map(chunk => {
      const parts = chunk.split('.');
      if (parts.length === 5) {
        return {
          t: parseInt(parts[0]),
          c: parseInt(parts[1]),
          z: parseInt(parts[2]),
          y: parseInt(parts[3]),
          x: parseInt(parts[4])
        };
      }
      return null;
    }).filter(chunk => chunk !== null);
    
    if (parsedChunks.length === 0) {
      return { message: 'No valid chunk patterns found' };
    }
    
    // Find ranges
    const tValues = [...new Set(parsedChunks.map(c => c.t))].sort((a, b) => a - b);
    const cValues = [...new Set(parsedChunks.map(c => c.c))].sort((a, b) => a - b);
    const zValues = [...new Set(parsedChunks.map(c => c.z))].sort((a, b) => a - b);
    const yValues = [...new Set(parsedChunks.map(c => c.y))].sort((a, b) => a - b);
    const xValues = [...new Set(parsedChunks.map(c => c.x))].sort((a, b) => a - b);
    
    return {
      timepoints: tValues.length,
      channels: cValues.length,
      zSlices: zValues.length,
      yChunks: yValues.length,
      xChunks: xValues.length,
      tRange: { min: tValues[0], max: tValues[tValues.length - 1] },
      cRange: { min: cValues[0], max: cValues[cValues.length - 1] },
      zRange: { min: zValues[0], max: zValues[zValues.length - 1] },
      yRange: { min: yValues[0], max: yValues[yValues.length - 1] },
      xRange: { min: xValues[0], max: xValues[xValues.length - 1] }
    };
  }

  /**
   * Debug method to visualize chunk layout for a specific region
   * @param {Array} chunks - Array of chunk objects with coordinates
   * @returns {Object} Visualization of chunk layout
   */
  visualizeChunkLayout(chunks) {
    if (chunks.length === 0) {
      return { message: 'No chunks to visualize' };
    }
    
    // Extract coordinates
    const coordinates = chunks.map(chunk => chunk.coordinates);
    const minY = Math.min(...coordinates.map(c => c[3]));
    const maxY = Math.max(...coordinates.map(c => c[3]));
    const minX = Math.min(...coordinates.map(c => c[4]));
    const maxX = Math.max(...coordinates.map(c => c[4]));
    
    // Create a 2D grid representation
    const grid = [];
    for (let y = minY; y <= maxY; y++) {
      const row = [];
      for (let x = minX; x <= maxX; x++) {
        const chunk = chunks.find(c => c.coordinates[3] === y && c.coordinates[4] === x);
        row.push(chunk ? 'X' : ' ');
      }
      grid.push(row.join(''));
    }
    
    return {
      grid: grid,
      dimensions: {
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        minX, maxX, minY, maxY
      },
      chunkCount: chunks.length,
      layout: `Grid ${maxX - minX + 1}x${maxY - minY + 1} with ${chunks.length} chunks`
    };
  }

    /**
   * Discover available wells that intersect with the requested region
   * @param {string} datasetId - Dataset ID
   * @param {number} region_min_x - Minimum X coordinate of region
   * @param {number} region_max_x - Maximum X coordinate of region  
   * @param {number} region_min_y - Minimum Y coordinate of region
   * @param {number} region_max_y - Maximum Y coordinate of region
   * @returns {Promise<Array>} Array of available well information
   */
  async discoverAvailableWells(datasetId, region_min_x, region_max_x, region_min_y, region_max_y) {
    const availableWells = [];
    
    // First, try to get a list of available wells from the dataset
    // This is more efficient than checking every possible well
    const correctDatasetId = this.extractDatasetId(datasetId);
    const datasetUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/`;
    
    try {
      // Try to get directory listing to see what wells are available
      const response = await fetch(datasetUrl);
      console.log(`Directory listing response status: ${response.status}`);
      
      if (response.ok) {
        const directoryData = await response.json();
        console.log('Directory listing data:', directoryData);
        
        const wellFiles = directoryData
          .filter(item => item.type === 'file' && item.name.startsWith('well_') && item.name.endsWith('_96.zip'))
          .map(item => {
            // Extract well ID from filename (e.g., "well_A2_96.zip" -> "A2")
            const match = item.name.match(/well_([A-Z]\d+)_96\.zip/);
            return match ? match[1] : null;
          })
          .filter(wellId => wellId !== null);
        
        console.log(`Found ${wellFiles.length} available wells in dataset:`, wellFiles);
        
        // Check only the available wells
        for (const wellId of wellFiles) {
          try {
            const canvasExists = await this.checkCanvasExists(datasetId, wellId);
            if (canvasExists) {
              // Get zarr metadata to determine well boundaries
              const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
              const metadata = await this.fetchZarrMetadata(baseUrl, 0); // Use scale 0 for metadata
              
              if (metadata && metadata.zattrs.squid_canvas && metadata.zattrs.squid_canvas.stage_limits) {
                const stageLimits = metadata.zattrs.squid_canvas.stage_limits;
                
                // Well boundaries are defined by its stage limits
                const well_min_x = stageLimits.x_negative;
                const well_max_x = stageLimits.x_positive;
                const well_min_y = stageLimits.y_negative;
                const well_max_y = stageLimits.y_positive;
                
                console.log(`Well ${wellId} stage limits: (${well_min_x.toFixed(3)}, ${well_min_y.toFixed(3)}) to (${well_max_x.toFixed(3)}, ${well_max_y.toFixed(3)})`);
                console.log(`Requested region: (${region_min_x.toFixed(3)}, ${region_min_y.toFixed(3)}) to (${region_max_x.toFixed(3)}, ${region_max_y.toFixed(3)})`);
                
                // Check if this well intersects with the requested region
                const intersects = well_max_x >= region_min_x && well_min_x <= region_max_x &&
                                 well_max_y >= region_min_y && well_min_y <= region_max_y;
                
                console.log(`Well ${wellId} intersection check: ${intersects}`);
                
                if (intersects) {
                  availableWells.push({
                    wellId,
                    stageLimits,
                    metadata
                  });
                  
                  console.log(`Found intersecting well ${wellId} with bounds (${well_min_x.toFixed(3)}, ${well_min_y.toFixed(3)}) to (${well_max_x.toFixed(3)}, ${well_max_y.toFixed(3)})`);
                } else {
                  console.log(`Well ${wellId} does not intersect with requested region`);
                }
              } else {
                console.log(`Well ${wellId} missing stage limits in metadata`);
              }
            }
          } catch {
            // Well doesn't exist or can't be accessed, skip silently
            continue;
          }
        }
      } else {
        console.warn('Could not get directory listing, falling back to checking common wells');
        // Fallback: check only common wells that are likely to exist
        const commonWells = ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'];
        
        for (const wellId of commonWells) {
          try {
            const canvasExists = await this.checkCanvasExists(datasetId, wellId);
            if (canvasExists) {
              // Get zarr metadata to determine well boundaries
              const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
              const metadata = await this.fetchZarrMetadata(baseUrl, 0);
              
              if (metadata && metadata.zattrs.squid_canvas && metadata.zattrs.squid_canvas.stage_limits) {
                const stageLimits = metadata.zattrs.squid_canvas.stage_limits;
                
                const well_min_x = stageLimits.x_negative;
                const well_max_x = stageLimits.x_positive;
                const well_min_y = stageLimits.y_negative;
                const well_max_y = stageLimits.y_positive;
                
                console.log(`Fallback - Well ${wellId} stage limits: (${well_min_x.toFixed(3)}, ${well_min_y.toFixed(3)}) to (${well_max_x.toFixed(3)}, ${well_max_y.toFixed(3)})`);
                console.log(`Fallback - Requested region: (${region_min_x.toFixed(3)}, ${region_min_y.toFixed(3)}) to (${region_max_x.toFixed(3)}, ${region_max_y.toFixed(3)})`);
                
                const intersects = well_max_x >= region_min_x && well_min_x <= region_max_x &&
                                 well_max_y >= region_min_y && well_min_y <= region_max_y;
                
                console.log(`Fallback - Well ${wellId} intersection check: ${intersects}`);
                
                if (intersects) {
                  availableWells.push({
                    wellId,
                    stageLimits,
                    metadata
                  });
                  
                  console.log(`Found intersecting well ${wellId} with bounds (${well_min_x.toFixed(3)}, ${well_min_y.toFixed(3)}) to (${well_max_x.toFixed(3)}, ${well_max_y.toFixed(3)})`);
                } else {
                  console.log(`Fallback - Well ${wellId} does not intersect with requested region`);
                }
              } else {
                console.log(`Fallback - Well ${wellId} missing stage limits in metadata`);
              }
            }
          } catch {
            continue;
          }
        }
      }
    } catch (error) {
      console.error('Error discovering available wells:', error);
    }
    
    // If no wells found, add a debug fallback to include at least one well for testing
    if (availableWells.length === 0) {
      console.warn('No intersecting wells found - adding A2 as debug fallback');
      try {
        const canvasExists = await this.checkCanvasExists(datasetId, 'A2');
        if (canvasExists) {
          const correctDatasetId = this.extractDatasetId(datasetId);
          const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_A2_96.zip/~/data.zarr/`;
          const metadata = await this.fetchZarrMetadata(baseUrl, 0);
          
          if (metadata && metadata.zattrs.squid_canvas && metadata.zattrs.squid_canvas.stage_limits) {
            availableWells.push({
              wellId: 'A2',
              stageLimits: metadata.zattrs.squid_canvas.stage_limits,
              metadata
            });
            console.log('Added A2 as debug fallback well');
          }
        }
      } catch (fallbackError) {
        console.error('Debug fallback also failed:', fallbackError);
      }
    }
    
    return availableWells;
  }



  /**
   * Test method to verify the new workflow
   * @param {string} datasetId - Dataset ID to test
   * @returns {Promise<Object>} Test results
   */
  async testNewWorkflow(datasetId) {
    try {
      console.log(`Testing new workflow for dataset: ${datasetId}`);
      
      // Test single well request
      const testWellId = 'A2';
      const testResult = await this.getWellRegion(
        testWellId, 0, 0, 2.0, 2.0, 'BF LED matrix full', 0, 0, datasetId, 'base64'
      );
      
      return {
        success: true,
        singleWellTest: testResult,
        message: `Test completed for dataset ${datasetId}`
      };
      
    } catch (error) {
      console.error('Test workflow failed:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }
}

// Export the class
export default ArtifactZarrLoader; 