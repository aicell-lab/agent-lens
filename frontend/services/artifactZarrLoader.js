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
   * Main function to get historical stitched region - JavaScript version of get_stitched_region
   * Follows the same logic as the Python implementation
   */
  async getHistoricalStitchedRegion(
    centerX, centerY, width_mm, height_mm, wellPlateType, scaleLevel, 
    channel, timepoint = 0, outputFormat = 'base64',
    datasetId, wellId, wellPlateConfig = null
  ) {
    try {
      console.log(`Historical stitched region request: center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ` +
                  `size=(${width_mm.toFixed(2)}x${height_mm.toFixed(2)}), ` +
                  `scale=${scaleLevel}, channel=${channel}, well=${wellId}`);

      // Calculate the bounding box of the requested region (following Python logic)
      const half_width = width_mm / 2.0;
      const half_height = height_mm / 2.0;
      
      const region_min_x = centerX - half_width;
      const region_max_x = centerX + half_width;
      const region_min_y = centerY - half_height;
      const region_max_y = centerY + half_height;

      console.log(`Region bounds: (${region_min_x.toFixed(2)}-${region_max_x.toFixed(2)}, ` +
                  `${region_min_y.toFixed(2)}-${region_max_y.toFixed(2)})`);

      // Get well plate format configuration - use passed config or fallback to hardcoded
      const config = wellPlateConfig || this.getWellPlateConfig(wellPlateType);
      
      // Add missing properties to the config if they don't exist
      if (!config.max_rows || !config.max_cols) {
        const layout = this.getWellPlateLayout(wellPlateType);
        config.max_rows = layout.rows.length;
        config.max_cols = layout.cols.length;
      }
      
      console.log('Well plate config:', config);
      console.log('Requested region center:', centerX, centerY);
      console.log('Requested region size:', width_mm, height_mm);
      
      // For now, simulate the well offset - in practice this should come from configuration
      const x_offset = 0; // CONFIG.WELLPLATE_OFFSET_X_MM equivalent
      const y_offset = 0; // CONFIG.WELLPLATE_OFFSET_Y_MM equivalent

      // Find all wells that intersect with the requested region
      const wells_to_query = [];
      const well_regions = [];

      for (let row_idx = 0; row_idx < config.max_rows; row_idx++) {
        for (let col_idx = 0; col_idx < config.max_cols; col_idx++) {
          // Calculate well center position - handle both uppercase and lowercase property names
          const a1_x = config.A1_X_MM || config.a1_x_mm;
          const a1_y = config.A1_Y_MM || config.a1_y_mm;
          const well_spacing = config.WELL_SPACING_MM || config.well_spacing_mm;
          const well_size = config.WELL_SIZE_MM || config.well_size_mm;
          
          const well_center_x = a1_x + x_offset + col_idx * well_spacing;
          const well_center_y = a1_y + y_offset + row_idx * well_spacing;
          
          // Calculate well boundaries with padding (using default 1.0mm like Python)
          const well_radius = well_size / 2.0;
          const well_padding_mm = 1.0; // Default padding
          const padded_radius = well_radius + well_padding_mm;
          
          const well_min_x = well_center_x - padded_radius;
          const well_max_x = well_center_x + padded_radius;
          const well_min_y = well_center_y - padded_radius;
          const well_max_y = well_center_y + padded_radius;
          
          // Debug: Log well A1 and A2 positions to see if they're correct
          if (row_idx === 0 && (col_idx === 0 || col_idx === 1)) {
            const well_row = String.fromCharCode(65 + row_idx);
            const well_column = col_idx + 1;
            const wellId = `${well_row}${well_column}`;
            console.log(`Well ${wellId}: center=(${well_center_x.toFixed(2)}, ${well_center_y.toFixed(2)}), bounds=(${well_min_x.toFixed(2)}-${well_max_x.toFixed(2)}, ${well_min_y.toFixed(2)}-${well_max_y.toFixed(2)})`);
          }
          
          // Check if this well intersects with the requested region
          if (well_max_x >= region_min_x && well_min_x <= region_max_x &&
              well_max_y >= region_min_y && well_min_y <= region_max_y) {
            
            const well_row = String.fromCharCode(65 + row_idx); // A, B, C...
            const well_column = col_idx + 1;
            const wellIdCalculated = `${well_row}${well_column}`;
            
            // Calculate the intersection region in well-relative coordinates
            const intersection_min_x = Math.max(region_min_x, well_min_x);
            const intersection_max_x = Math.min(region_max_x, well_max_x);
            const intersection_min_y = Math.max(region_min_y, well_min_y);
            const intersection_max_y = Math.min(region_max_y, well_max_y);
            
            // Convert to well-relative coordinates
            const well_rel_center_x = ((intersection_min_x + intersection_max_x) / 2.0) - well_center_x;
            const well_rel_center_y = ((intersection_min_y + intersection_max_y) / 2.0) - well_center_y;
            const well_rel_width = intersection_max_x - intersection_min_x;
            const well_rel_height = intersection_max_y - intersection_min_y;
            
            wells_to_query.push([well_row, well_column]);
            well_regions.push({
              well_row,
              well_column,
              wellId: wellIdCalculated,
              well_center_x,
              well_center_y,
              well_rel_center_x,
              well_rel_center_y,
              well_rel_width,
              well_rel_height,
              abs_min_x: intersection_min_x,
              abs_max_x: intersection_max_x,
              abs_min_y: intersection_min_y,
              abs_max_y: intersection_max_y
            });
          }
        }
      }

      if (wells_to_query.length === 0) {
        console.warn('No wells found that intersect with requested region');
        return { success: false, message: 'No wells found that intersect with requested region' };
      }

      console.log(`Found ${wells_to_query.length} wells that intersect with requested region:`, wells_to_query);

      // If only one well, get the region directly (following Python logic)
      if (wells_to_query.length === 1) {
        const well_info = well_regions[0];
        
        // Check if the well canvas exists
        const canvasExists = await this.checkCanvasExists(datasetId, well_info.wellId);
      if (!canvasExists) {
          console.warn(`Well canvas for ${well_info.wellId} does not exist`);
          return { success: false, message: `Well canvas for ${well_info.wellId} does not exist` };
      }

        // Get well canvas region using absolute stage coordinates (like Python get_canvas_region)
        const region = await this.getWellCanvasRegion(
          well_info.abs_min_x + (well_info.abs_max_x - well_info.abs_min_x) / 2, // Center X in absolute coordinates
          well_info.abs_min_y + (well_info.abs_max_y - well_info.abs_min_y) / 2, // Center Y in absolute coordinates
          well_info.abs_max_x - well_info.abs_min_x, // Width in absolute coordinates
          well_info.abs_max_y - well_info.abs_min_y, // Height in absolute coordinates
          channel, scaleLevel, timepoint, datasetId, well_info.wellId
        );
        
        if (!region) {
          console.warn(`Failed to get region from well ${well_info.wellId}`);
          return { success: false, message: `Failed to get region from well ${well_info.wellId}` };
        }
        
        console.log(`Retrieved single-well region from ${well_info.wellId}, size: ${region.width}x${region.height}`);
        
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
            wellId: well_info.wellId,
            // Return absolute stage coordinates for proper tile positioning
            bounds: {
              topLeft: { x: well_info.abs_min_x, y: well_info.abs_min_y },
              bottomRight: { x: well_info.abs_max_x, y: well_info.abs_max_y }
            },
            region_mm: { width: well_info.abs_max_x - well_info.abs_min_x, height: well_info.abs_max_y - well_info.abs_min_y }
          }
        };
      }

      // Multiple wells - need to stitch them together (following Python logic)
      console.log(`Stitching regions from ${wells_to_query.length} wells`);
      
      // For multi-well stitching, we need to implement the full stitching logic
      // This is more complex and would require additional implementation
      // For now, return an error indicating multi-well stitching is not yet implemented
      return { 
        success: false, 
        message: `Multi-well stitching not yet implemented (${wells_to_query.length} wells required)` 
      };

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
   * Get well plate layout (rows and columns)
   */
  getWellPlateLayout(wellPlateType) {
    const layouts = {
      '6': { rows: ['A', 'B'], cols: [1, 2, 3] },
      '12': { rows: ['A', 'B', 'C'], cols: [1, 2, 3, 4] },
      '24': { rows: ['A', 'B', 'C', 'D'], cols: [1, 2, 3, 4, 5, 6] },
      '48': { rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: [1, 2, 3, 4, 5, 6, 7, 8] },
      '96': { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], cols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
      '384': { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'], cols: Array.from({length: 24}, (_, i) => i + 1) }
    };
    return layouts[wellPlateType] || layouts['96'];
  }

  /**
   * Get well plate configuration based on type
   */
  getWellPlateConfig(wellPlateType) {
    const configs = {
      '6': {
        max_rows: 2, max_cols: 3,
        A1_X_MM: -18.0, A1_Y_MM: -12.0, // Example values - should come from actual config
        WELL_SPACING_MM: 18.0, WELL_SIZE_MM: 16.0
      },
      '12': {
        max_rows: 3, max_cols: 4,
        A1_X_MM: -27.0, A1_Y_MM: -18.0,
        WELL_SPACING_MM: 18.0, WELL_SIZE_MM: 16.0
      },
      '24': {
        max_rows: 4, max_cols: 6,
        A1_X_MM: -45.0, A1_Y_MM: -27.0,
        WELL_SPACING_MM: 18.0, WELL_SIZE_MM: 16.0
      },
      '96': {
        max_rows: 8, max_cols: 12,
        A1_X_MM: -99.0, A1_Y_MM: -63.0,
        WELL_SPACING_MM: 18.0, WELL_SIZE_MM: 16.0
      },
      '384': {
        max_rows: 16, max_cols: 24,
        A1_X_MM: -207.0, A1_Y_MM: -135.0,
        WELL_SPACING_MM: 18.0, WELL_SIZE_MM: 16.0
      }
    };
    
    return configs[wellPlateType] || configs['96']; // Default to 96-well
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

      // Convert ABSOLUTE stage coordinates to pixel coordinates (following Python logic)
      const centerPixelCoords = this.stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata);
      
      // Calculate pixel dimensions
      const scale_factor = Math.pow(4, scale);
      const width_px = Math.round(width_mm * 1000 / (pixelSizeUm * scale_factor));
      const height_px = Math.round(height_mm * 1000 / (pixelSizeUm * scale_factor));
      
      console.log(`Region: center=(${centerPixelCoords.x}, ${centerPixelCoords.y}) px, size=${width_px}x${height_px} px`);

      // Calculate bounds
      const { zarray } = metadata;
      const [, , , imageHeight, imageWidth] = zarray.shape;
      
      const x_start = Math.max(0, centerPixelCoords.x - Math.floor(width_px / 2));
      const x_end = Math.min(imageWidth, x_start + width_px);
      const y_start = Math.max(0, centerPixelCoords.y - Math.floor(height_px / 2));
      const y_end = Math.min(imageHeight, y_start + height_px);

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
        // Apply scale factor
        const scaleFactor = Math.pow(4, scaleLevel);
        return basePixelSize * scaleFactor;
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
              return (yScale + xScale) / 2; // Average of x and y scales
            }
          }
        }
      }
      
      // Fallback to default if no metadata found
      console.warn('Could not find pixel size in metadata, using default');
      return 0.311688 * Math.pow(4, scaleLevel); // Default from example metadata
      
    } catch (error) {
      console.error('Error extracting pixel size from metadata:', error);
      return null;
    }
  }

  /**
   * Convert stage coordinates to pixel coordinates - JavaScript version of stage_to_pixel_coords
   */
  stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata) {
    try {
      // Get stage limits from metadata
      const { zattrs } = metadata;
      let stageLimits = {
        x_negative: -4.105, // Default values
        y_negative: -4.105
      };
      
      if (zattrs.squid_canvas && zattrs.squid_canvas.stage_limits) {
        stageLimits = zattrs.squid_canvas.stage_limits;
      }
      
      // Offset to make all coordinates positive (following Python logic)
      const x_offset_mm = -stageLimits.x_negative;
      const y_offset_mm = -stageLimits.y_negative;
      
      // Convert to pixels at scale 0
      const x_px = Math.floor((x_mm + x_offset_mm) * 1000 / pixelSizeUm);
      const y_px = Math.floor((y_mm + y_offset_mm) * 1000 / pixelSizeUm);
      
      return { x: x_px, y: y_px };

    } catch (error) {
      console.error('Error converting stage to pixel coordinates:', error);
      return { x: 0, y: 0 };
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
}

// Export the class
export default ArtifactZarrLoader; 