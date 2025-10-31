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
    
    // 🚀 DATASET-LEVEL CACHE: Simple cache for zattrs per dataset
    this.datasetZattrsCache = new Map(); // Cache for dataset-level zattrs
    this.currentDatasetId = null; // Track current dataset for cache invalidation
    
    this.requestPromises = new Map(); // Cache for pending requests to avoid duplicates
    
    // 🚀 REQUEST CANCELLATION: Track and manage cancellable requests
    this.requestControllers = new Map(); // Map of request ID to AbortController
    this.requestIds = new Map(); // Map of URL to request ID for tracking
    this.nextRequestId = 1; // Counter for unique request IDs
    
    // 🚀 PERFORMANCE OPTIMIZATION: Add memory management
    this.maxCacheSize = 2000; // Limit cache size to prevent memory bloat
    this.lastCleanup = Date.now();
    this.cleanupInterval = 30000; // Clean up every 30 seconds
    
    // 🚀 BATCH REQUEST MANAGEMENT: Control concurrent requests
    this.maxConcurrentRequests = 5; // Limit concurrent chunk requests
    this.requestQueue = []; // Queue for pending requests
    this.activeRequestCount = 0; // Track active request count
    this.batchRequests = new Map(); // Map batchId to Set of requestIds
    this.cancelledBatches = new Set(); // Track cancelled batches to prevent callback execution
  }

  /**
   * Generate a unique request ID for tracking and cancellation
   * @returns {string} Unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${this.nextRequestId++}`;
  }

  /**
   * Cancel a specific request by ID
   * @param {string} requestId - Request ID to cancel
   * @returns {boolean} True if request was cancelled
   */
  cancelRequest(requestId) {
    const controller = this.requestControllers.get(requestId);
    if (controller) {
      controller.abort();
      this.requestControllers.delete(requestId);
      console.log(`🚫 Cancelled request: ${requestId}`);
      return true;
    }
    return false;
  }

  /**
   * Cancel all active requests
   * @returns {number} Number of requests cancelled
   */
  cancelAllRequests() {
    let cancelledCount = 0;
    
    // Mark all batches as cancelled to prevent callbacks from firing
    for (const [batchId, ] of this.batchRequests) {
      this.cancelledBatches.add(batchId);
      console.log(`🚫 Marking batch ${batchId} as cancelled`);
    }
    
    // Abort all active requests
    for (const [, controller] of this.requestControllers) {
      controller.abort();
      cancelledCount++;
    }
    
    // Clear request queue to prevent queued requests from starting
    const queuedCount = this.requestQueue.length;
    this.requestQueue.length = 0; // Clear the queue
    
    // Reset active request count
    this.activeRequestCount = 0;
    
    this.requestControllers.clear();
    this.requestIds.clear();
    this.requestPromises.clear(); // Also clear promises to prevent duplicate requests
    this.batchRequests.clear(); // Clear batch tracking
    
    console.log(`🚫 Cancelled all ${cancelledCount} active requests and ${queuedCount} queued requests`);
    return cancelledCount + queuedCount;
  }

  /**
   * Check if a batch has been cancelled
   * @param {string} batchId - Batch ID to check
   * @returns {boolean} True if batch is cancelled
   */
  isBatchCancelled(batchId) {
    return this.cancelledBatches.has(batchId);
  }

  /**
   * Cancel all requests for a specific batch
   * @param {string} batchId - Batch request ID to cancel
   * @returns {number} Number of requests cancelled
   */
  cancelBatchRequests(batchId) {
    let cancelledCount = 0;
    const batchRequests = Array.from(this.requestControllers.keys())
      .filter(requestId => requestId.startsWith(batchId));
    
    for (const requestId of batchRequests) {
      const controller = this.requestControllers.get(requestId);
      if (controller) {
        controller.abort();
        this.requestControllers.delete(requestId);
        cancelledCount++;
      }
    }
    console.log(`🚫 Cancelled ${cancelledCount} requests for batch: ${batchId}`);
    return cancelledCount;
  }

  /**
   * 🚀 BATCHED FETCH: Controlled concurrent requests with queuing
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @param {string} requestId - Optional request ID for cancellation
   * @returns {Promise<Response>} Fetch response (CLONED for concurrent usage)
   */
  async managedFetch(url, options = {}, requestId = null) {
    // Generate request ID if not provided
    const reqId = requestId || this.generateRequestId();
    
    // Check if this exact request is already in progress
    if (this.requestPromises.has(url)) {
      const sharedResponse = await this.requestPromises.get(url);
      // CRITICAL FIX: Clone the response to prevent "body stream already read" errors
      // Each consumer gets their own copy of the response body
      return sharedResponse.clone();
    }

    // Create AbortController for this request
    const controller = new AbortController();
    this.requestControllers.set(reqId, controller);
    this.requestIds.set(url, reqId);

    // Create the fetch promise with non-blocking queue control
    const fetchPromise = (async () => {
      // Use Promise-based queue instead of blocking while loop
      await this.waitForAvailableSlot(controller);
      
      // Final check before proceeding
      if (controller.signal.aborted) {
        throw new DOMException('Request was cancelled before starting', 'AbortError');
      }
      
      this.activeRequestCount++;
      
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        return response;
      } catch (error) {
        if (error.name === 'AbortError') {
          console.log(`🚫 Request aborted: ${url}`);
          throw error;
        }
        // Gracefully handle 404s and other errors
        console.warn(`Request failed for ${url}: ${error.message}`);
        return new Response(null, { status: 404, statusText: 'Not Found' });
      } finally {
        this.activeRequestCount--;
        this.requestPromises.delete(url);
        this.requestControllers.delete(reqId);
        this.requestIds.delete(url);
        // Process next queued request
        this.processQueue();
      }
    })();

    // Cache the promise to avoid duplicate requests
    this.requestPromises.set(url, fetchPromise);
    
    return fetchPromise;
  }

  /**
   * Wait for available request slot using Promise-based queue instead of blocking loop
   * @param {AbortController} controller - Abort controller for cancellation
   * @returns {Promise<void>}
   */
  async waitForAvailableSlot(controller) {
    return new Promise((resolve, reject) => {
      // If slot is available, resolve immediately
      if (this.activeRequestCount < this.maxConcurrentRequests) {
        resolve();
        return;
      }

      // Add to queue instead of blocking
      const queueItem = {
        resolve,
        reject,
        controller
      };
      
      this.requestQueue.push(queueItem);
      
      // Set up cancellation handler
      const abortHandler = () => {
        // Remove from queue if still queued
        const index = this.requestQueue.indexOf(queueItem);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
        }
        reject(new DOMException('Request was cancelled while waiting in queue', 'AbortError'));
      };
      
      controller.signal.addEventListener('abort', abortHandler, { once: true });
    });
  }

  /**
   * Process the next queued request
   */
  processQueue() {
    if (this.requestQueue.length > 0 && this.activeRequestCount < this.maxConcurrentRequests) {
      const nextRequest = this.requestQueue.shift();
      if (nextRequest && !nextRequest.controller.signal.aborted) {
        nextRequest.resolve();
      } else if (nextRequest) {
        // Request was cancelled, process next one
        this.processQueue();
      }
    }
  }

  /**
   * Get multi-channel well region data with additive blending
   * @param {string} wellId - Well ID (e.g., 'A2')
   * @param {number} centerX - Center X coordinate in mm (well-relative)
   * @param {number} centerY - Center Y coordinate in mm (well-relative)
   * @param {number} width_mm - Width in mm
   * @param {number} height_mm - Height in mm
   * @param {Array} channelConfigs - Array of {channelName, enabled, min, max, color} objects
   * @param {number} scaleLevel - Scale level
   * @param {number} timepoint - Timepoint index
   * @param {string} datasetId - Dataset ID
   * @param {string} outputFormat - Output format ('base64', 'blob', 'array')
   * @returns {Promise<Object>} Multi-channel composite well region data
   */
  async getMultiChannelWellRegion(
    wellId, centerX, centerY, width_mm, height_mm, channelConfigs, scaleLevel,
    timepoint = 0, datasetId, onChunkProgress = null, outputFormat = 'base64'
  ) {
    try {
      console.log(`🎨 Multi-channel well region request: well=${wellId}, channels=${channelConfigs.length}`);
      console.log(`🎨 Channel configs:`, channelConfigs.map(c => ({ 
        name: c.channelName, 
        enabled: c.enabled, 
        min: c.min, 
        max: c.max, 
        color: c.color 
      })));
      
      // Filter to only enabled channels
      const enabledChannels = channelConfigs.filter(config => config.enabled);
      if (enabledChannels.length === 0) {
        console.warn('No enabled channels for multi-channel request');
        return { success: false, message: 'No enabled channels' };
      }
      
      console.log(`🎨 Enabled channels:`, enabledChannels.map(c => ({ 
        name: c.channelName, 
        min: c.min, 
        max: c.max, 
        color: c.color 
      })));
      
      // 🚀 REAL-TIME MERGED UPDATES: Track loaded channels and provide progressive merging
      const loadedChannels = new Map(); // channelName -> { config, canvas, width, height, actualBounds, actualStageBounds }
      let compositeCanvas = null;
      let compositeCtx = null;
      
      // Track actual chunk progress across all channels
      let totalChunksLoaded = 0;
      let totalChunksExpected = 0;
      const channelChunkProgress = new Map(); // channelName -> { loaded, total }
      
      // Helper function to create/update composite canvas with current loaded channels
      const updateCompositeCanvas = () => {
        if (loadedChannels.size === 0) return null;
        
        // Use the first loaded channel as reference for dimensions
        const firstChannel = Array.from(loadedChannels.values())[0];
        const compositeWidth = firstChannel.width;
        const compositeHeight = firstChannel.height;
        
        // Create or reuse composite canvas
        if (!compositeCanvas || compositeCanvas.width !== compositeWidth || compositeCanvas.height !== compositeHeight) {
          compositeCanvas = document.createElement('canvas');
          compositeCanvas.width = compositeWidth;
          compositeCanvas.height = compositeHeight;
          compositeCtx = compositeCanvas.getContext('2d');
        }
        
        // Clear to transparent (important for proper alpha blending)
        compositeCtx.clearRect(0, 0, compositeWidth, compositeHeight);
        
        // Apply additive blending for each loaded channel
        for (const [, channelData] of loadedChannels) {
          const { config, canvas } = channelData;
          
          // Apply contrast adjustment and channel color
          const adjustedCanvas = this.applyChannelAdjustments(canvas, config);
          
          // Additive blend with existing composite (preserves alpha)
          compositeCtx.globalCompositeOperation = 'lighter'; // Additive blending
          compositeCtx.drawImage(adjustedCanvas, 0, 0);
        }
        
        // Reset composite operation
        compositeCtx.globalCompositeOperation = 'source-over';
        
        return compositeCanvas;
      };
      
      // Load each channel with real-time merging updates
      const channelPromises = enabledChannels.map(async (config) => {
        try {
          const channelRegion = await this.getWellCanvasRegionRealTime(
            centerX, centerY, width_mm, height_mm,
            config.channelName, scaleLevel, timepoint, datasetId, wellId,
            (loadedChunks, totalChunks, partialCanvas) => {
              // Store the partial canvas for this channel
              if (partialCanvas) {
                loadedChannels.set(config.channelName, {
                  config,
                  canvas: partialCanvas,
                  width: partialCanvas.width,
                  height: partialCanvas.height,
                  actualBounds: null, // Will be updated when complete
                  actualStageBounds: null
                });
                
                // Update chunk progress tracking for this channel
                const previousProgress = channelChunkProgress.get(config.channelName) || { loaded: 0, total: 0 };
                const previousLoaded = previousProgress.loaded;
                const previousTotal = previousProgress.total;
                
                // Update total expected chunks if this is the first time we see this channel's total
                if (previousTotal === 0 && totalChunks > 0) {
                  totalChunksExpected += totalChunks;
                }
                
                // Update total loaded chunks (subtract previous progress and add new progress)
                totalChunksLoaded = totalChunksLoaded - previousLoaded + loadedChunks;
                
                // Store current progress for this channel
                channelChunkProgress.set(config.channelName, { loaded: loadedChunks, total: totalChunks });
                
                // 🚀 REAL-TIME MERGED UPDATE: Create merged composite and send progress update
                const mergedCanvas = updateCompositeCanvas();
                if (mergedCanvas && onChunkProgress) {
                  // Report actual chunk progress across all channels
                  onChunkProgress(totalChunksLoaded, totalChunksExpected, mergedCanvas, config.channelName);
                }
              }
            }
          );
          
          if (!channelRegion) {
            console.warn(`Channel ${config.channelName} not available for well ${wellId}`);
            return null;
          }
          
          // Store the complete channel data
          loadedChannels.set(config.channelName, {
            config,
            canvas: channelRegion.canvas,
            width: channelRegion.width,
            height: channelRegion.height,
            actualBounds: channelRegion.actualBounds,
            actualStageBounds: channelRegion.actualStageBounds
          });
          
          // Update final chunk progress for this channel
          const finalProgress = channelChunkProgress.get(config.channelName) || { loaded: 0, total: 0 };
          totalChunksLoaded = totalChunksLoaded - finalProgress.loaded + finalProgress.total;
          
          // 🚀 REAL-TIME MERGED UPDATE: Send progress update with merged result
          const mergedCanvas = updateCompositeCanvas();
          if (mergedCanvas && onChunkProgress) {
            onChunkProgress(totalChunksLoaded, totalChunksExpected, mergedCanvas, config.channelName);
          }
          
          return {
            config,
            canvas: channelRegion.canvas,
            width: channelRegion.width,
            height: channelRegion.height,
            actualBounds: channelRegion.actualBounds,
            actualStageBounds: channelRegion.actualStageBounds
          };
        } catch (error) {
          console.warn(`Failed to load channel ${config.channelName}:`, error);
          return null;
        }
      });
      
      // Use Promise.allSettled to handle partial channel failures gracefully
      const channelResults = await Promise.allSettled(channelPromises);
      const validResults = [];
      const failedChannels = [];
      
      channelResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value !== null) {
          validResults.push(result.value);
        } else {
          const channelName = enabledChannels[index].channelName;
          failedChannels.push(channelName);
          console.warn(`Channel ${channelName} failed to load for well ${wellId}:`, 
                      result.status === 'rejected' ? result.reason : 'No data available');
        }
      });
      
      if (validResults.length === 0) {
        console.warn(`No valid channels loaded for well ${wellId} (${failedChannels.length} failed)`);
        return { success: false, message: `No valid channels for well ${wellId}` };
      }
      
      console.log(`✅ Multi-channel well ${wellId}: ${validResults.length}/${enabledChannels.length} channels loaded successfully`);
      if (failedChannels.length > 0) {
        console.log(`⚠️ Failed channels: ${failedChannels.join(', ')}`);
      }
      
      // Create final composite canvas with all loaded channels
      const finalCompositeCanvas = updateCompositeCanvas();
      if (!finalCompositeCanvas) {
        console.warn(`Failed to create final composite canvas for well ${wellId}`);
        return { success: false, message: `Failed to create composite for well ${wellId}` };
      }
      
      console.log(`✅ Multi-channel composite created: ${validResults.length} channels, ${finalCompositeCanvas.width}x${finalCompositeCanvas.height}px`);
      
      // Convert to requested output format
      const outputData = await this.normalizeAndEncodeImage({ canvas: finalCompositeCanvas }, null, outputFormat);
      
      return {
        success: true,
        data: outputData,
        metadata: {
          width: finalCompositeCanvas.width,
          height: finalCompositeCanvas.height,
          channelsUsed: validResults.map(r => r.config.channelName),
          scale: scaleLevel,
          timepoint,
          wellId,
          centerX,
          centerY,
          width_mm,
          height_mm,
          actualBounds: validResults[0].actualBounds,
          actualStageBounds: validResults[0].actualStageBounds,
          isMultiChannel: true
        }
      };
      
    } catch (error) {
      console.warn(`Multi-channel well ${wellId} failed: ${error.message}`);
      return { 
        success: false, 
        message: `Multi-channel well ${wellId} not available` 
      };
    }
  }

  /**
   * Apply channel-specific adjustments (contrast, color, min/max) with alpha preservation
   * @param {HTMLCanvasElement} sourceCanvas - Source channel canvas
   * @param {Object} config - Channel configuration {channelName, enabled, min, max, color}
   * @returns {HTMLCanvasElement} Adjusted canvas with proper alpha masking
   */
  applyChannelAdjustments(sourceCanvas, config) {
    const adjustedCanvas = document.createElement('canvas');
    adjustedCanvas.width = sourceCanvas.width;
    adjustedCanvas.height = sourceCanvas.height;
    const adjustedCtx = adjustedCanvas.getContext('2d');
    
    // Get source image data
    const sourceCtx = sourceCanvas.getContext('2d');
    const sourceImageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
    const sourceData = sourceImageData.data;
    
    // Create adjusted image data
    const adjustedImageData = adjustedCtx.createImageData(sourceCanvas.width, sourceCanvas.height);
    const adjustedData = adjustedImageData.data;
    
    // Parse channel color (hex string like "FFFFFF" or "00FF00")
    const color = config.color || 'FFFFFF';
    const r = parseInt(color.substr(0, 2), 16) / 255;
    const g = parseInt(color.substr(2, 2), 16) / 255;
    const b = parseInt(color.substr(4, 2), 16) / 255;
    
    // Apply min/max contrast and channel color
    const min = config.min || 0;
    const max = config.max || 255;
    const range = max - min;
    
    for (let i = 0; i < sourceData.length; i += 4) {
      // Get grayscale value and alpha
      const gray = sourceData[i]; // Red channel as grayscale
      const alpha = sourceData[i + 3]; // Alpha channel
      
      // Only process pixels that have data (alpha > 0)
      if (alpha > 0) {
        // Apply contrast adjustment
        let adjustedGray = range > 0 ? Math.max(0, Math.min(255, (gray - min) * 255 / range)) : 0;
        
        // Apply channel color
        adjustedData[i] = adjustedGray * r;     // Red
        adjustedData[i + 1] = adjustedGray * g; // Green
        adjustedData[i + 2] = adjustedGray * b; // Blue
        adjustedData[i + 3] = alpha;            // Alpha (preserve original alpha)
      } else {
        // Transparent pixel - keep it transparent
        adjustedData[i] = 0;     // Red
        adjustedData[i + 1] = 0; // Green
        adjustedData[i + 2] = 0; // Blue
        adjustedData[i + 3] = 0; // Alpha (transparent)
      }
    }
    
    // Put adjusted data back to canvas
    adjustedCtx.putImageData(adjustedImageData, 0, 0);
    
    return adjustedCanvas;
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
      console.log(`🚀 MAXIMUM SPEED: Well region request: well=${wellId}, center=(${centerX.toFixed(2)}, ${centerY.toFixed(2)}), ` +
                  `size=(${width_mm.toFixed(2)}x${height_mm.toFixed(2)}), ` +
                  `scale=${scaleLevel}, channel=${channel}`);

      // NO WAITING - just try to get the region directly!
      const region = await this.getWellCanvasRegion(
        centerX, centerY, width_mm, height_mm,
        channel, scaleLevel, timepoint, datasetId, wellId
      );
      
      if (!region) {
        console.warn(`Well ${wellId} not available (404 or no data)`);
        return { success: false, message: `Well ${wellId} not available` };
      }
      
      console.log(`✅ Retrieved well region from ${wellId}, size: ${region.width}x${region.height}`);
      
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
          height_mm,
          // CRITICAL: Return the actual extracted bounds for accurate positioning
          actualBounds: region.actualBounds || null,
          actualStageBounds: region.actualStageBounds || null
        }
      };

    } catch (error) {
      console.warn(`Well ${wellId} failed: ${error.message}`);
      return { 
        success: false, 
        message: `Well ${wellId} not available` 
      };
    }
  }

  /**
   * 🚀 MAXIMUM SPEED: Get multiple well regions - fire ALL requests simultaneously!
   * @param {Array} wellRequests - Array of well request objects
   * @returns {Promise<Array>} Array of well region results
   */
  async getMultipleWellRegions(wellRequests) {
    try {
      console.log(`🚀 MAXIMUM SPEED: Firing ${wellRequests.length} well requests simultaneously!`);
      
      // Fire ALL well requests simultaneously - NO WAITING!
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
          console.warn(`Well ${wellId} failed: ${error.message}`);
          return {
            success: false,
            wellId,
            message: `Well ${wellId} not available`
          };
        }
      });
      
      const results = await Promise.all(wellPromises);
      
      // Count successful results
      const successfulResults = results.filter(r => r.success);
      console.log(`✅ Successfully loaded ${successfulResults.length}/${wellRequests.length} well regions`);
      
      return results;
      
    } catch (error) {
      console.warn(`Multiple well regions failed: ${error.message}`);
      return wellRequests.map(request => ({
        success: false,
        wellId: request.wellId,
        message: `Well ${request.wellId} not available`
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
   * 🚀 REAL-TIME CHUNK LOADING: Load chunks progressively with live updates
   * This method provides real-time feedback as chunks become available
   * @param {Array} wellRequests - Array of well request objects
   * @param {Function} onChunkProgress - Callback for chunk loading progress (wellId, loadedChunks, totalChunks, partialCanvas)
   * @param {Function} onWellComplete - Callback when a well is fully loaded (wellId, finalResult)
   * @param {string} batchId - Optional batch ID for cancellation
   * @returns {Promise<Array>} Array of final well region results
   */
  async getMultipleWellRegionsRealTime(wellRequests, onChunkProgress, onWellComplete, batchId = null) {
    const requestBatchId = batchId || `well_batch_${Date.now()}_${Math.random()}`;
    
    // Register this batch
    this.batchRequests.set(requestBatchId, new Set());
    // Clear from cancelled set in case it was previously cancelled
    this.cancelledBatches.delete(requestBatchId);
    
    // 🚀 PERFORMANCE OPTIMIZATION: Run memory cleanup before starting new batch
    this.cleanupMemory();
    
    try {
      console.log(`🚀 REAL-TIME: Starting progressive loading for ${wellRequests.length} wells (Batch: ${requestBatchId})`);
      
      // Fire ALL well requests simultaneously with real-time updates
      const wellPromises = wellRequests.map(async (request, index) => {
        const { wellId, centerX, centerY, width_mm, height_mm, channel, scaleLevel, timepoint, datasetId, outputFormat } = request;
        const wellRequestId = `${requestBatchId}_well_${index}`;
        
        try {
          const result = await this.getWellCanvasRegionRealTime(
            centerX, centerY, width_mm, height_mm,
            channel, scaleLevel, timepoint, datasetId, wellId,
            (loadedChunks, totalChunks, partialCanvas) => {
              // 🚫 CHECK CANCELLATION: Don't call callbacks if this batch has been cancelled
              if (this.isBatchCancelled(requestBatchId)) {
                console.log(`🚫 Skipping callback for cancelled batch ${requestBatchId} (well ${wellId})`);
                return;
              }
              
              // Call progress callback for real-time updates
              if (onChunkProgress) {
                onChunkProgress(wellId, loadedChunks, totalChunks, partialCanvas);
              }
            },
            wellRequestId
          );
          
          if (!result) {
            console.warn(`Well ${wellId} not available (404, no data, or channel not found)`);
            return {
              success: false,
              wellId,
              message: `Well ${wellId} not available or channel not found`
            };
          }
          
          // Convert to requested output format
          const outputData = await this.normalizeAndEncodeImage(result, null, outputFormat);
          
          const finalResult = {
            success: true,
            data: outputData,
            metadata: {
              width: result.width,
              height: result.height,
              channel,
              scale: scaleLevel,
              timepoint,
              wellId,
              centerX,
              centerY,
              width_mm,
              height_mm,
              actualBounds: result.actualBounds || null,
              actualStageBounds: result.actualStageBounds || null
            },
            wellId,
            centerX,
            centerY,
            width_mm,
            height_mm
          };
          
          // Call completion callback
          // 🚫 CHECK CANCELLATION: Don't call completion callback if batch was cancelled
          if (onWellComplete && !this.isBatchCancelled(requestBatchId)) {
            onWellComplete(wellId, finalResult);
          } else if (this.isBatchCancelled(requestBatchId)) {
            console.log(`🚫 Skipping completion callback for cancelled batch ${requestBatchId} (well ${wellId})`);
          }
          
          return finalResult;
          
        } catch (error) {
          if (error.name === 'AbortError') {
            console.log(`🚫 Well ${wellId} loading aborted`);
            return {
              success: false,
              wellId,
              message: `Well ${wellId} loading cancelled`
            };
          }
          console.warn(`Well ${wellId} failed: ${error.message}`);
          return {
            success: false,
            wellId,
            message: `Well ${wellId} not available`
          };
        }
      });
      
      const results = await Promise.all(wellPromises);
      
      // Count successful results
      const successfulResults = results.filter(r => r.success);
      console.log(`✅ REAL-TIME: Completed loading ${successfulResults.length}/${wellRequests.length} well regions`);
      
      return results;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Batch well loading aborted: ${requestBatchId}`);
        return wellRequests.map(request => ({
          success: false,
          wellId: request.wellId,
          message: `Well ${request.wellId} loading cancelled`
        }));
      }
      console.warn(`Real-time multiple well regions failed: ${error.message}`);
      return wellRequests.map(request => ({
        success: false,
        wellId: request.wellId,
        message: `Well ${request.wellId} not available`
      }));
    } finally {
      // Cleanup complete
    }
  }

  /**
   * 🚀 REAL-TIME CHUNK LOADING with cancellation support
   * Returns both the promise and a cancellation function
   * @param {Array} wellRequests - Array of well request objects
   * @param {Function} onChunkProgress - Callback for chunk loading progress
   * @param {Function} onWellComplete - Callback when a well is fully loaded
   * @param {boolean} useMultiChannel - Whether to use multi-channel loading
   * @param {Array} channelConfigs - Array of channel configurations for multi-channel mode
   * @returns {Object} { promise, cancel } - Promise and cancellation function
   */
  getMultipleWellRegionsRealTimeCancellable(wellRequests, onChunkProgress, onWellComplete, useMultiChannel = false, channelConfigs = []) {
    const batchId = `cancellable_batch_${Date.now()}_${Math.random()}`;
    
    let promise;
    if (useMultiChannel && channelConfigs.length > 0) {
      console.log(`🎨 Using multi-channel real-time loading with ${channelConfigs.length} channels`);
      promise = this.getMultipleWellRegionsMultiChannelRealTime(wellRequests, channelConfigs, onChunkProgress, onWellComplete, batchId);
    } else {
      console.log(`📡 Using single-channel real-time loading`);
      promise = this.getMultipleWellRegionsRealTime(wellRequests, onChunkProgress, onWellComplete, batchId);
    }
    
    const cancel = () => {
      console.log(`🚫 Cancelling batch: ${batchId}`);
      return this.cancelBatchRequests(batchId);
    };
    
    return { promise, cancel };
  }

  /**
   * 🎨 MULTI-CHANNEL REAL-TIME: Load multiple wells with multi-channel support
   * @param {Array} wellRequests - Array of well request objects
   * @param {Array} channelConfigs - Array of channel configurations
   * @param {Function} onChunkProgress - Callback for chunk loading progress
   * @param {Function} onWellComplete - Callback when a well is fully loaded
   * @param {string} batchId - Batch ID for cancellation
   * @returns {Promise<Array>} Array of well region results
   */
  async getMultipleWellRegionsMultiChannelRealTime(wellRequests, channelConfigs, onChunkProgress, onWellComplete, batchId = null) {
    const requestBatchId = batchId || `multi_channel_batch_${Date.now()}_${Math.random()}`;
    
    // Register this batch
    this.batchRequests.set(requestBatchId, new Set());
    // Clear from cancelled set in case it was previously cancelled
    this.cancelledBatches.delete(requestBatchId);
    
    this.cleanupMemory();
    
    try {
      console.log(`🎨 MULTI-CHANNEL REAL-TIME: Starting progressive loading for ${wellRequests.length} wells with ${channelConfigs.length} channels (batch: ${requestBatchId})`);
      
      // Process each well with multi-channel support
      const wellPromises = wellRequests.map(async (request) => {
        const { wellId, centerX, centerY, width_mm, height_mm, scaleLevel, timepoint, datasetId, outputFormat } = request;
        
        try {
          const result = await this.getMultiChannelWellRegion(
            wellId, centerX, centerY, width_mm, height_mm,
            channelConfigs, scaleLevel, timepoint, datasetId,
            (loadedChunks, totalChunks, partialCanvas) => {
              // 🚫 CHECK CANCELLATION: Don't call callbacks if this batch has been cancelled
              if (this.isBatchCancelled(requestBatchId)) {
                console.log(`🚫 Skipping callback for cancelled batch ${requestBatchId} (well ${wellId})`);
                return;
              }
              
              // 🚀 REAL-TIME MERGED UPDATES: Forward merged progress updates for this specific well
              if (onChunkProgress) {
                onChunkProgress(wellId, loadedChunks, totalChunks, partialCanvas);
              }
            }, outputFormat
          );
          
          if (!result || !result.success) {
            console.warn(`Multi-channel well ${wellId} not available`);
            return {
              success: false,
              wellId,
              message: `Multi-channel well ${wellId} not available`
            };
          }
          
          const finalResult = {
            ...result,
            wellId,
            centerX,
            centerY,
            width_mm,
            height_mm
          };
          
          // Call completion callback - no need for progress simulation since we have real progress
          // 🚫 CHECK CANCELLATION: Don't call completion callback if batch was cancelled
          if (onWellComplete && !this.isBatchCancelled(requestBatchId)) {
            onWellComplete(wellId, finalResult);
          } else if (this.isBatchCancelled(requestBatchId)) {
            console.log(`🚫 Skipping completion callback for cancelled batch ${requestBatchId} (well ${wellId})`);
          }
          
          return finalResult;
          
        } catch (error) {
          if (error.name === 'AbortError') {
            console.log(`🚫 Multi-channel well ${wellId} loading aborted`);
            return {
              success: false,
              wellId,
              message: `Multi-channel well ${wellId} loading cancelled`
            };
          }
          console.warn(`Multi-channel well ${wellId} failed: ${error.message}`);
          return {
            success: false,
            wellId,
            message: `Multi-channel well ${wellId} not available`
          };
        }
      });
      
      const results = await Promise.all(wellPromises);
      
      const successfulResults = results.filter(r => r.success);
      console.log(`✅ MULTI-CHANNEL REAL-TIME: Completed loading ${successfulResults.length}/${wellRequests.length} well regions`);
      
      return results;
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Multi-channel batch well loading aborted: ${requestBatchId}`);
        return wellRequests.map(request => ({
          success: false,
          wellId: request.wellId,
          message: `Multi-channel well ${request.wellId} loading cancelled`
        }));
      }
      console.warn(`Multi-channel real-time loading failed: ${error.message}`);
      return wellRequests.map(request => ({
        success: false,
        wellId: request.wellId,
        message: `Multi-channel well ${request.wellId} not available`
      }));
    } finally {
      // Cleanup complete
    }
  }

  /**
   * Extract the correct dataset ID from a potentially nested path
   * @param {string} datasetId - Dataset ID that might contain slashes
   * @returns {string} Clean dataset ID
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
        const response = await this.managedFetch(zattrsUrl, {
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
      
      // 🚀 SIMPLE CACHE: Clear dataset cache if dataset changed
      if (this.currentDatasetId !== correctDatasetId) {
        console.log(`🔄 Dataset changed from ${this.currentDatasetId} to ${correctDatasetId}, clearing zattrs cache`);
        this.datasetZattrsCache.clear();
        this.currentDatasetId = correctDatasetId;
      }
      
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

      console.log(`🔬 Well canvas region: center=(${x_mm.toFixed(2)}, ${y_mm.toFixed(2)})mm, size=${width_mm.toFixed(1)}×${height_mm.toFixed(1)}mm, pixelSize=${pixelSizeUm}µm/px @ scale${scale}`);

      // Convert stage coordinates to pixel coordinates (using zarr coordinate system)
      const centerPixelCoords = this.stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata);
      // Calculate pixel dimensions at the current scale level
      const scale_factor = Math.pow(4, scale);
      const width_px = Math.round(width_mm * 1000 / (pixelSizeUm * scale_factor));
      const height_px = Math.round(height_mm * 1000 / (pixelSizeUm * scale_factor));
      
      console.log(`📏 Region: center=(${centerPixelCoords.x}, ${centerPixelCoords.y})px, size=${width_px}×${height_px}px`);

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

      // CRITICAL: Calculate actual stage bounds from extracted pixel bounds
      if (imageData && imageData.actualBounds) {
        const { actualBounds } = imageData;
        const scale_factor = Math.pow(4, scale);
        
        // Convert pixel bounds back to stage coordinates
        const centerX_px = imageWidth / 2;
        const centerY_px = imageHeight / 2;
        
        const actualStartX_mm = ((actualBounds.startX - centerX_px) * pixelSizeUm * scale_factor) / 1000;
        const actualStartY_mm = ((actualBounds.startY - centerY_px) * pixelSizeUm * scale_factor) / 1000;
        const actualEndX_mm = ((actualBounds.endX - centerX_px) * pixelSizeUm * scale_factor) / 1000;
        const actualEndY_mm = ((actualBounds.endY - centerY_px) * pixelSizeUm * scale_factor) / 1000;
        
        console.log(`🎯 Actual extracted region: stage(${actualStartX_mm.toFixed(2)}, ${actualStartY_mm.toFixed(2)}) to (${actualEndX_mm.toFixed(2)}, ${actualEndY_mm.toFixed(2)}) mm`);
        
        // Add actual stage bounds to return data
        imageData.actualStageBounds = {
          startX: actualStartX_mm,
          startY: actualStartY_mm,
          endX: actualEndX_mm,
          endY: actualEndY_mm,
          width: actualEndX_mm - actualStartX_mm,
          height: actualEndY_mm - actualStartY_mm
        };
      }

      return imageData;

    } catch (error) {
      console.warn(`Well canvas region failed: ${error.message}`);
      return null;
    }
  }

  /**
   * 🚀 REAL-TIME: Get well canvas region with progressive chunk loading
   * Provides live updates as chunks become available
   */
  async getWellCanvasRegionRealTime(x_mm, y_mm, width_mm, height_mm, channelName, scale, timepoint, datasetId, wellId, onChunkProgress, batchId = null) {
    const wellRequestId = batchId || `well_${wellId}_${Date.now()}`;
    
    // 🚀 PERFORMANCE OPTIMIZATION: Run memory cleanup periodically
    this.cleanupMemory();
    
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
        console.warn(`Channel '${channelName}' not found - returning null for graceful handling`);
        return null; // Return null instead of throwing to allow graceful handling
      }

      // Get pixel size from metadata (following the scale transformations)
      const pixelSizeUm = this.getPixelSizeFromMetadata(metadata, scale);
      if (!pixelSizeUm) {
        throw new Error('Could not determine pixel size from metadata');
      }

      console.log(`🔬 REAL-TIME: Well canvas region: center=(${x_mm.toFixed(2)}, ${y_mm.toFixed(2)})mm, size=${width_mm.toFixed(1)}×${height_mm.toFixed(1)}mm, pixelSize=${pixelSizeUm}µm/px @ scale${scale}`);

      // Convert stage coordinates to pixel coordinates (using zarr coordinate system)
      const centerPixelCoords = this.stageToPixelCoords(x_mm, y_mm, scale, pixelSizeUm, metadata);
      // Calculate pixel dimensions at the current scale level
      const scale_factor = Math.pow(4, scale);
      const width_px = Math.round(width_mm * 1000 / (pixelSizeUm * scale_factor));
      const height_px = Math.round(height_mm * 1000 / (pixelSizeUm * scale_factor));
      
      console.log(`📏 REAL-TIME: Region: center=(${centerPixelCoords.x}, ${centerPixelCoords.y})px, size=${width_px}×${height_px}px`);

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

      // REAL-TIME: Compose chunks progressively with live updates
      const imageData = await this.composeImageFromChunksRealTime(
        baseUrl, filteredChunks, metadata, scale, x_start, y_start, x_end - x_start, y_end - y_start,
        onChunkProgress, wellRequestId
      );

      // CRITICAL: Calculate actual stage bounds from extracted pixel bounds
      if (imageData && imageData.actualBounds) {
        const { actualBounds } = imageData;
        const scale_factor = Math.pow(4, scale);
        
        // Convert pixel bounds back to stage coordinates
        const centerX_px = imageWidth / 2;
        const centerY_px = imageHeight / 2;
        
        const actualStartX_mm = ((actualBounds.startX - centerX_px) * pixelSizeUm * scale_factor) / 1000;
        const actualStartY_mm = ((actualBounds.startY - centerY_px) * pixelSizeUm * scale_factor) / 1000;
        const actualEndX_mm = ((actualBounds.endX - centerX_px) * pixelSizeUm * scale_factor) / 1000;
        const actualEndY_mm = ((actualBounds.endY - centerY_px) * pixelSizeUm * scale_factor) / 1000;
        
        console.log(`🎯 Actual extracted region: stage(${actualStartX_mm.toFixed(2)}, ${actualStartY_mm.toFixed(2)}) to (${actualEndX_mm.toFixed(2)}, ${actualEndY_mm.toFixed(2)}) mm`);
        
        // Add actual stage bounds to return data
        imageData.actualStageBounds = {
          startX: actualStartX_mm,
          startY: actualStartY_mm,
          endX: actualEndX_mm,
          endY: actualEndY_mm,
          width: actualEndX_mm - actualStartX_mm,
          height: actualEndY_mm - actualStartY_mm
        };
      }

      return imageData;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Well ${wellId} canvas region loading aborted`);
        throw error;
      }
      console.warn(`Real-time well canvas region failed: ${error.message}`);
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
      
      // IMPROVED: Use more precise rounding to avoid positioning errors
      // Round to nearest integer instead of always flooring, which can cause systematic offset
      const x_px = Math.round(centerX_px + (x_mm * 1000) / (pixelSizeUm * scale_factor));
      const y_px = Math.round(centerY_px + (y_mm * 1000) / (pixelSizeUm * scale_factor));
      
      console.log(`📐 Coords: (${x_mm.toFixed(2)}, ${y_mm.toFixed(2)})mm → (${x_px}, ${y_px})px`);
      
      return { x: x_px, y: y_px };

    } catch (error) {
      console.error('Error converting stage to pixel coordinates:', error);
      // Fallback to image center if conversion fails
      const { zarray } = metadata;
      const [, , , imageHeight, imageWidth] = zarray.shape;
      return { x: Math.round(imageWidth / 2), y: Math.round(imageHeight / 2) };
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
    
    // Sort chunks by distance from viewport center (center-out loading)
    const viewportCenterX = (x_start + x_end) / 2;
    const viewportCenterY = (y_start + y_end) / 2;
    
    chunks.sort((a, b) => {
      const aCenterX = (a.pixelBounds.x_start + a.pixelBounds.x_end) / 2;
      const aCenterY = (a.pixelBounds.y_start + a.pixelBounds.y_end) / 2;
      const bCenterX = (b.pixelBounds.x_start + b.pixelBounds.x_end) / 2;
      const bCenterY = (b.pixelBounds.y_start + b.pixelBounds.y_end) / 2;
      
      const distA = Math.sqrt(Math.pow(aCenterX - viewportCenterX, 2) + Math.pow(aCenterY - viewportCenterY, 2));
      const distB = Math.sqrt(Math.pow(bCenterX - viewportCenterX, 2) + Math.pow(bCenterY - viewportCenterY, 2));
      
      return distA - distB;
    });
    
    return chunks;
  }

  /**
   * Fetch Zarr metadata (zattrs and zarray) in parallel
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
      // 🚀 IMPROVED CACHE: Use promise-based caching for zattrs to prevent concurrent parsing
      const zattrsUrl = `${baseUrl}.zattrs`;
      const zattrsCacheKey = zattrsUrl;
      const zattrsPromiseCacheKey = `${zattrsCacheKey}_parse_promise`;
      
      let zattrs;
      if (this.datasetZattrsCache.has(zattrsCacheKey)) {
        console.log(`📋 Using cached zattrs for ${zattrsUrl}`);
        zattrs = this.datasetZattrsCache.get(zattrsCacheKey);
      } else if (this.requestPromises.has(zattrsPromiseCacheKey)) {
        console.log(`⏳ Waiting for concurrent zattrs parsing (fetchZarrMetadata): ${zattrsUrl}`);
        zattrs = await this.requestPromises.get(zattrsPromiseCacheKey);
      } else {
        console.log(`📥 Fetching zattrs for ${zattrsUrl}`);
        
        const parsePromise = (async () => {
          const zattrsResponse = await this.managedFetch(zattrsUrl);
          if (!zattrsResponse.ok) {
            throw new Error(`Failed to fetch zattrs: ${zattrsResponse.status}`);
          }
          const parsedZattrs = await zattrsResponse.json();
          this.datasetZattrsCache.set(zattrsCacheKey, parsedZattrs);
          console.log(`✅ Cached zattrs for ${zattrsUrl}`);
          return parsedZattrs;
        })();
        
        this.requestPromises.set(zattrsPromiseCacheKey, parsePromise);
        try {
          zattrs = await parsePromise;
        } finally {
          this.requestPromises.delete(zattrsPromiseCacheKey);
        }
      }
      
      // Fetch zarray
      const zarrayResponse = await this.managedFetch(`${baseUrl}${scaleLevel}/.zarray`);

      if (!zarrayResponse.ok) {
        throw new Error(`Failed to fetch zarray for scale ${scaleLevel}: ${zarrayResponse.status}`);
      }

      // Parse zarray JSON response
      const zarray = await zarrayResponse.json();

      const metadata = { zattrs, zarray, scaleLevel };
      
      // Cache the metadata
      this.metadataCache.set(cacheKey, metadata);
      
      return metadata;

    } catch (error) {
      console.warn(`Zarr metadata not available for scale ${scaleLevel}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get active channels from zattrs metadata
   * @param {string} baseUrl - Base URL for zarr data
   * @returns {Promise<Array|null>} Array of active channel objects with metadata
   */
  async getActiveChannelsFromZattrs(baseUrl) {
    try {
      const zattrsUrl = `${baseUrl}.zattrs`;
      const zattrsCacheKey = zattrsUrl;
      const zattrsPromiseCacheKey = `${zattrsCacheKey}_parse_promise`;
      
      let zattrs;
      if (this.datasetZattrsCache.has(zattrsCacheKey)) {
        console.log(`📋 Using cached zattrs for active channels: ${zattrsUrl}`);
        zattrs = this.datasetZattrsCache.get(zattrsCacheKey);
      } else if (this.requestPromises.has(zattrsPromiseCacheKey)) {
        console.log(`⏳ Waiting for concurrent zattrs parsing (active channels): ${zattrsUrl}`);
        zattrs = await this.requestPromises.get(zattrsPromiseCacheKey);
      } else {
        console.log(`📥 Fetching zattrs for active channels: ${zattrsUrl}`);
        
        const parsePromise = (async () => {
          const response = await this.managedFetch(zattrsUrl);
          if (!response.ok) {
            throw new Error(`Failed to fetch zattrs: ${response.status}`);
          }
          const parsedZattrs = await response.json();
          this.datasetZattrsCache.set(zattrsCacheKey, parsedZattrs);
          console.log(`✅ Cached zattrs for active channels: ${zattrsUrl}`);
          return parsedZattrs;
        })();
        
        this.requestPromises.set(zattrsPromiseCacheKey, parsePromise);
        try {
          zattrs = await parsePromise;
        } finally {
          this.requestPromises.delete(zattrsPromiseCacheKey);
        }
      }
      
      if (!zattrs.omero || !zattrs.omero.channels) {
        console.warn('No omero channels found in zattrs');
        return null;
      }
      
      // Extract active channels with all metadata
      const activeChannels = zattrs.omero.channels
        .map((channel, index) => ({
          index,
          label: channel.label,
          active: channel.active,
          color: channel.color,
          window: channel.window,
          coefficient: channel.coefficient || 1.0,
          family: channel.family || 'linear'
        }))
        .filter(channel => channel.active === true);
      
      console.log(`🎨 Found ${activeChannels.length} active channels:`, activeChannels.map(ch => `${ch.label} (index: ${ch.index}, color: #${ch.color})`));
      
      // Also include channel mapping for index lookups
      const channelMapping = zattrs.squid_canvas?.channel_mapping || {};
      const zarrIndexMapping = zattrs.squid_canvas?.zarr_index_mapping || {};
      
      return {
        activeChannels,
        channelMapping,
        zarrIndexMapping,
        totalChannels: zattrs.omero.channels.length
      };
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Active channels request aborted`);
        throw error;
      }
      console.error('Error getting active channels from zattrs:', error);
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
      // 🚀 IMPROVED CACHE: Use the existing getActiveChannelsFromZattrs method to avoid duplicate parsing
      const channelMetadata = await this.getActiveChannelsFromZattrs(baseUrl);
      if (!channelMetadata) {
        return null;
      }
      
      // Check squid_canvas channel mapping first
      if (channelMetadata.channelMapping && channelMetadata.channelMapping[channelName] !== undefined) {
        return channelMetadata.channelMapping[channelName];
      }
      
      // Check active channels by label
      const channel = channelMetadata.activeChannels.find(ch => ch.label === channelName);
      if (channel) {
        return channel.index;
      }
      
      // Fallback to check all channels (not just active ones)
      const zattrsUrl = `${baseUrl}.zattrs`;
      const zattrsCacheKey = zattrsUrl;
      
      let zattrs;
      if (this.datasetZattrsCache.has(zattrsCacheKey)) {
        console.log(`📋 Using cached zattrs for channel index lookup: ${zattrsUrl}`);
        zattrs = this.datasetZattrsCache.get(zattrsCacheKey);
      } else {
        // This should rarely happen since getActiveChannelsFromZattrs should have cached it
        console.log(`📥 Fetching zattrs for channel index lookup: ${zattrsUrl}`);
        
        // Create a unique cache key for the JSON parsing promise to prevent concurrent parsing
        const jsonCacheKey = `${zattrsCacheKey}_json_promise`;
        if (this.requestPromises.has(jsonCacheKey)) {
          console.log(`⏳ Waiting for concurrent zattrs parsing: ${zattrsUrl}`);
          zattrs = await this.requestPromises.get(jsonCacheKey);
        } else {
          const jsonPromise = (async () => {
            const response = await this.managedFetch(zattrsUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch zattrs: ${response.status}`);
            }
            const parsedZattrs = await response.json();
            this.datasetZattrsCache.set(zattrsCacheKey, parsedZattrs);
            console.log(`✅ Cached zattrs from fallback: ${zattrsUrl}`);
            return parsedZattrs;
          })();
          
          this.requestPromises.set(jsonCacheKey, jsonPromise);
          try {
            zattrs = await jsonPromise;
          } finally {
            this.requestPromises.delete(jsonCacheKey);
          }
        }
      }
      
      // Final fallback: check all channels in the cached zattrs
      if (zattrs.omero && zattrs.omero.channels) {
        const channelIndex = zattrs.omero.channels.findIndex(
          ch => ch.label === channelName
        );
        if (channelIndex !== -1) {
          return channelIndex;
        }
      }
      
      // 🚫 IMPROVED: Handle common channel name variations as last resort
      const channelNameMap = {
        'BF_LED_matrix_full': 0,
        'Fluorescence_405_nm_Ex': 11,
        'Fluorescence_488_nm_Ex': 12,
        'Fluorescence_561_nm_Ex': 14,
        'Fluorescence_638_nm_Ex': 13
      };
      
      if (channelNameMap[channelName] !== undefined) {
        console.log(`📋 Using fallback channel mapping: ${channelName} → ${channelNameMap[channelName]}`);
        return channelNameMap[channelName];
      }
      
      return null;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Channel index request aborted for ${channelName}`);
        throw error; // Re-throw AbortError to be handled by caller
      }
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
      const response = await this.managedFetch(directoryUrl);
      
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
      console.warn(`Directory listing not available for scale ${scaleLevel}: ${error.message}`);
      return null;
    }
  }

  /**
   * Compose image from multiple chunks with optimized parallel loading
   * PRIORITY LOADING: Cached chunks first, then network chunks
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
      
      console.log(`🧩 Stitching: ${chunks.length} chunks → ${totalWidth}×${totalHeight}px`);
      
      // Create canvas for composition
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      
      // 🚀 PHASE 1: Separate cached vs non-cached chunks
      const cachedChunks = [];
      const networkChunks = [];
      
      for (const chunk of chunks) {
        const [t, c, z, y, x] = chunk.coordinates;
        const chunkUrl = `${baseUrl}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
        const cacheKey = `${chunkUrl}_${dataType}`;
        
        if (this.chunkCache.has(cacheKey)) {
          cachedChunks.push(chunk);
        } else {
          networkChunks.push(chunk);
        }
      }
      
      console.log(`📊 Cache split: ${cachedChunks.length} cached, ${networkChunks.length} network`);
      
      // Helper function to process a chunk
      const processChunk = async (chunk) => {
        const [t, c, z, y, x] = chunk.coordinates;
        const chunkUrl = `${baseUrl}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
        
        const chunkData = await this.fetchZarrChunk(chunkUrl, dataType);
        if (!chunkData) return null;
        
        try {
          const imageData = this.decodeChunk(chunkData, [yChunk, xChunk], dataType);
          
          if (imageData) {
            const chunkCanvas = document.createElement('canvas');
            chunkCanvas.width = imageData.width;
            chunkCanvas.height = imageData.height;
            const chunkCtx = chunkCanvas.getContext('2d');
            chunkCtx.putImageData(imageData, 0, 0);
            
            const chunkAbsX = x * xChunk;
            const chunkAbsY = y * yChunk;
            const posX = chunkAbsX - regionStartX;
            const posY = chunkAbsY - regionStartY;
            
            if (posX < totalWidth && posY < totalHeight && 
                posX + chunkCanvas.width > 0 && posY + chunkCanvas.height > 0) {
              
              const srcX = Math.max(0, regionStartX - chunkAbsX);
              const srcY = Math.max(0, regionStartY - chunkAbsY);
              const srcWidth = Math.min(chunkCanvas.width - srcX, totalWidth - Math.max(0, posX));
              const srcHeight = Math.min(chunkCanvas.height - srcY, totalHeight - Math.max(0, posY));
              
              const destX = Math.max(0, posX);
              const destY = Math.max(0, posY);
            
              return {
                chunkCanvas,
                destX,
                destY,
                srcX,
                srcY,
                srcWidth,
                srcHeight,
                chunkId: chunk.filename
              };
            }
          }
        } catch (error) {
          console.warn(`Error processing chunk ${chunk.filename}:`, error);
        }
        
        return null;
      };
      
      // 🚀 PHASE 2: Load cached chunks immediately (synchronous from cache)
      const cachedResults = await Promise.all(cachedChunks.map(processChunk));
      
      // Draw cached chunks immediately
      let loadedChunks = 0;
      for (const result of cachedResults) {
        if (result) {
          const { chunkCanvas, destX, destY, srcX, srcY, srcWidth, srcHeight } = result;
          ctx.drawImage(chunkCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, srcWidth, srcHeight);
          loadedChunks++;
        }
      }
      
      console.log(`✅ Loaded ${loadedChunks} cached chunks immediately`);
      
      // 🚀 PHASE 3: Load network chunks in parallel
      if (networkChunks.length > 0) {
        const networkResults = await Promise.all(networkChunks.map(processChunk));
        
        // Draw network chunks
        for (const result of networkResults) {
          if (result) {
            const { chunkCanvas, destX, destY, srcX, srcY, srcWidth, srcHeight } = result;
            ctx.drawImage(chunkCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, srcWidth, srcHeight);
            loadedChunks++;
          }
        }
        
        console.log(`✅ Loaded ${networkChunks.length} network chunks`);
      }
      
      const totalChunks = chunks.length;
      console.log(`✅ Successfully loaded ${loadedChunks}/${totalChunks} chunks for scale ${scaleLevel}`);
      
      return {
        width: totalWidth,
        height: totalHeight,
        canvas: canvas,
        loadedChunks,
        totalChunks,
        // CRITICAL: Return actual extracted bounds for accurate positioning
        actualBounds: {
          startX: regionStartX,
          startY: regionStartY,
          endX: regionStartX + regionWidth,
          endY: regionStartY + regionHeight,
          width: regionWidth,
          height: regionHeight
        }
      };

    } catch (error) {
      console.error('Error composing image from chunks:', error);
      return null;
    }
  }

  /**
   * 🚀 REAL-TIME: Compose image from chunks with progressive updates
   * PRIORITY LOADING: Cached chunks first, then network chunks with real-time feedback
   */
  async composeImageFromChunksRealTime(baseUrl, chunks, metadata, scaleLevel, regionStartX, regionStartY, regionWidth, regionHeight, onChunkProgress, batchId = null) {
    const chunkBatchId = batchId || `chunk_batch_${Date.now()}`;
    
    try {
      const { zarray } = metadata;
      const [, , , yChunk, xChunk] = zarray.chunks;
      const dataType = zarray.dtype;
      
      // Use the specified region dimensions instead of calculating from chunks
      const totalWidth = regionWidth;
      const totalHeight = regionHeight;
      
      console.log(`🧩 REAL-TIME: Stitching: ${chunks.length} chunks → ${totalWidth}×${totalHeight}px (Batch: ${chunkBatchId})`);
      
      // Create canvas for composition
      const canvas = document.createElement('canvas');
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      const ctx = canvas.getContext('2d');
      
      // 🚀 PHASE 1: Separate cached vs non-cached chunks
      const cachedChunks = [];
      const networkChunks = [];
      
      for (const chunk of chunks) {
        const [t, c, z, y, x] = chunk.coordinates;
        const chunkUrl = `${baseUrl}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
        const cacheKey = `${chunkUrl}_${dataType}`;
        
        if (this.chunkCache.has(cacheKey)) {
          cachedChunks.push(chunk);
        } else {
          networkChunks.push(chunk);
        }
      }
      
      console.log(`📊 REAL-TIME Cache split: ${cachedChunks.length} cached, ${networkChunks.length} network`);
      
      let loadedChunks = 0;
      const totalChunks = chunks.length;
      
      // 🚀 PERFORMANCE OPTIMIZATION: Throttle progress updates to reduce CPU usage
      let lastProgressUpdate = 0;
      const PROGRESS_UPDATE_INTERVAL = 100; // Only update progress every 100ms
      
      // Helper function to process a chunk and return canvas data
      const processChunk = async (chunk, chunkIndex) => {
        const [, , , y, x] = chunk.coordinates;
        
        try {
          const chunkUrl = `${baseUrl}${scaleLevel}/${chunk.coordinates.join('.')}`;
          const chunkRequestId = `${chunkBatchId}_chunk_${chunkIndex}`;
          const chunkData = await this.fetchZarrChunk(chunkUrl, dataType, chunkRequestId);
          
          if (!chunkData) return null;
          
          const imageData = this.decodeChunk(chunkData, [yChunk, xChunk], dataType);
          
          if (imageData) {
            const chunkCanvas = document.createElement('canvas');
            chunkCanvas.width = imageData.width;
            chunkCanvas.height = imageData.height;
            const chunkCtx = chunkCanvas.getContext('2d');
            chunkCtx.putImageData(imageData, 0, 0);
            
            const chunkAbsX = x * xChunk;
            const chunkAbsY = y * yChunk;
            const posX = chunkAbsX - regionStartX;
            const posY = chunkAbsY - regionStartY;
            
            if (posX < totalWidth && posY < totalHeight && 
                posX + chunkCanvas.width > 0 && posY + chunkCanvas.height > 0) {
              
              const srcX = Math.max(0, regionStartX - chunkAbsX);
              const srcY = Math.max(0, regionStartY - chunkAbsY);
              const srcWidth = Math.min(chunkCanvas.width - srcX, totalWidth - Math.max(0, posX));
              const srcHeight = Math.min(chunkCanvas.height - srcY, totalHeight - Math.max(0, posY));
              
              const destX = Math.max(0, posX);
              const destY = Math.max(0, posY);
              
              return {
                chunkCanvas,
                destX,
                destY,
                srcX,
                srcY,
                srcWidth,
                srcHeight,
                chunkId: chunk.filename
              };
            }
          }
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          console.warn(`Error processing chunk ${chunk.filename}:`, error);
        }
        
        return null;
      };
      
      // 🚀 PHASE 2: Load cached chunks in parallel (fast from RAM)
      const cachedResults = await Promise.all(cachedChunks.map((chunk, i) => processChunk(chunk, i)));
      
      // Draw cached chunks immediately
      for (const result of cachedResults) {
        if (result) {
          const { chunkCanvas, destX, destY, srcX, srcY, srcWidth, srcHeight } = result;
          ctx.drawImage(chunkCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, srcWidth, srcHeight);
          loadedChunks++;
          
          // Clean up
          chunkCanvas.width = 0;
          chunkCanvas.height = 0;
        }
      }
      
      console.log(`✅ REAL-TIME: Loaded ${loadedChunks} cached chunks immediately`);
      
      // Send progress update after cached chunks
      if (onChunkProgress && loadedChunks > 0) {
        const partialCanvas = document.createElement('canvas');
        partialCanvas.width = totalWidth;
        partialCanvas.height = totalHeight;
        const partialCtx = partialCanvas.getContext('2d');
        partialCtx.drawImage(canvas, 0, 0);
        
        onChunkProgress(loadedChunks, totalChunks, partialCanvas);
        lastProgressUpdate = Date.now();
        
        // DON'T clean up partial canvas - caller may store reference to it
      }
      
      // 🚀 PHASE 3: Load network chunks progressively with real-time updates
      for (let i = 0; i < networkChunks.length; i++) {
        const result = await processChunk(networkChunks[i], cachedChunks.length + i);
        
        if (result) {
          const { chunkCanvas, destX, destY, srcX, srcY, srcWidth, srcHeight } = result;
          ctx.drawImage(chunkCanvas, srcX, srcY, srcWidth, srcHeight, destX, destY, srcWidth, srcHeight);
          loadedChunks++;
          
          // Clean up
          chunkCanvas.width = 0;
          chunkCanvas.height = 0;
          
          // Send progress update for network chunks
          const now = Date.now();
          if (onChunkProgress && (now - lastProgressUpdate > PROGRESS_UPDATE_INTERVAL || i === networkChunks.length - 1)) {
            const partialCanvas = document.createElement('canvas');
            partialCanvas.width = totalWidth;
            partialCanvas.height = totalHeight;
            const partialCtx = partialCanvas.getContext('2d');
            partialCtx.drawImage(canvas, 0, 0);
            
            onChunkProgress(loadedChunks, totalChunks, partialCanvas);
            lastProgressUpdate = now;
            
          // DON'T clean up partial canvas - caller may store reference to it
        }
        }
      }
      
      console.log(`✅ REAL-TIME: Successfully loaded ${loadedChunks}/${totalChunks} chunks for scale ${scaleLevel}`);
      
      return {
        width: totalWidth,
        height: totalHeight,
        canvas: canvas,
        loadedChunks,
        totalChunks,
        // CRITICAL: Return actual extracted bounds for accurate positioning
        actualBounds: {
          startX: regionStartX,
          startY: regionStartY,
          endX: regionStartX + regionWidth,
          endY: regionStartY + regionHeight,
          width: regionWidth,
          height: regionHeight
        }
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Chunk composition aborted: ${chunkBatchId}`);
        throw error;
      }
      console.error('Error composing image from chunks (real-time):', error);
      return null;
    }
  }

  /**
   * Fetch individual zarr chunk
   * @param {string} chunkUrl - URL for the chunk
   * @param {string} dataType - Data type (uint8, uint16, etc.)
   * @returns {Promise<ArrayBuffer|null>} Chunk data
   */
  async fetchZarrChunk(chunkUrl, dataType, requestId = null) {
    const cacheKey = `${chunkUrl}_${dataType}`;
    
          // Check cache first
      if (this.chunkCache.has(cacheKey)) {
        console.log(`✅ CACHE HIT: ${chunkUrl} (${this.chunkCache.size} cached chunks)`);
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
      const response = await this.managedFetch(chunkUrl, {}, requestId);
      if (!response.ok) {
        console.warn(`Chunk not found: ${chunkUrl} (${response.status})`);
        return null;
      }
      
      const chunkData = await response.arrayBuffer();
      
      // Cache the chunk data
      this.chunkCache.set(cacheKey, chunkData);
      console.log(`💾 CACHE MISS → CACHED: ${chunkUrl} (${this.chunkCache.size} cached chunks)`);
      
      return chunkData;

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log(`🚫 Chunk fetch aborted: ${chunkUrl}`);
        throw error;
      }
      console.error(`Error fetching chunk ${chunkUrl}:`, error);
      return null;
    } finally {
      // Remove from active requests
      this.activeRequests.delete(chunkUrl);
    }
  }

  /**
   * Decode chunk data to ImageData with alpha masking
   * @param {ArrayBuffer} chunkData - Raw chunk data
   * @param {Array} chunkShape - Chunk dimensions [height, width]
   * @param {string} dataType - Data type
   * @returns {ImageData|null} Decoded image data with proper alpha masking
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
      
      // Define thresholds for alpha masking
      const minThreshold = dataType === 'uint8' || dataType === '|u1' ? 1 : 10; // Minimum value to consider as data
      const maxValue = dataType === 'uint8' || dataType === '|u1' ? 255 : 65535;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const srcIndex = y * width + x;
          const dstIndex = (y * width + x) * 4;
          
          // Get pixel value and normalize
          const value = array[srcIndex];
          let normalizedValue;
          let alpha = 0; // Default to transparent
          
          // Check if pixel has meaningful data
          if (value >= minThreshold) {
            if (dataType === 'uint8' || dataType === '|u1') {
              normalizedValue = value;
              alpha = 255; // Fully opaque for valid data
            } else {
              // 16-bit data needs normalization
              normalizedValue = Math.floor((value / maxValue) * 255);
              alpha = 255; // Fully opaque for valid data
            }
          } else {
            // No data or very low value - make transparent
            normalizedValue = 0;
            alpha = 0; // Transparent
          }
          
          // Create grayscale image with alpha masking (R=G=B=value, A=alpha)
          pixels[dstIndex] = normalizedValue;     // R
          pixels[dstIndex + 1] = normalizedValue; // G
          pixels[dstIndex + 2] = normalizedValue; // B
          pixels[dstIndex + 3] = alpha;           // A (0 = transparent, 255 = opaque)
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
    this.requestPromises.clear();
    // 🚀 DATASET CACHE: Also clear dataset-level caches
    this.datasetZattrsCache.clear();
    this.currentDatasetId = null;
    // 🚫 BATCH TRACKING: Clear cancelled batches tracking
    this.cancelledBatches.clear();
    this.batchRequests.clear();
  }
  
  /**
   * 🚀 PERFORMANCE OPTIMIZATION: Memory cleanup to prevent bloat
   */
  cleanupMemory() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return; // Not time for cleanup yet
    }
    
    // Clean up old cache entries
    const maxAge = 10 * 60 * 1000; // 10 minutes
    let cleanedCount = 0;
    
    // Clean metadata cache
    for (const [key, value] of this.metadataCache) {
      if (now - value.timestamp > maxAge) {
        this.metadataCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Clean chunk cache (most memory intensive)
    for (const [key, value] of this.chunkCache) {
      if (now - value.timestamp > maxAge) {
        this.chunkCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Clean directory cache
    for (const [key, value] of this.directoryCache) {
      if (now - value.timestamp > maxAge) {
        this.directoryCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Limit cache sizes
    if (this.metadataCache.size > this.maxCacheSize) {
      const entries = Array.from(this.metadataCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
      toRemove.forEach(([key]) => this.metadataCache.delete(key));
      cleanedCount += toRemove.length;
    }
    
    if (this.chunkCache.size > this.maxCacheSize) {
      const entries = Array.from(this.chunkCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, entries.length - this.maxCacheSize);
      toRemove.forEach(([key]) => this.chunkCache.delete(key));
      cleanedCount += toRemove.length;
    }
    
    this.lastCleanup = now;
    if (cleanedCount > 0) {
      console.log(`🧹 Memory cleanup: removed ${cleanedCount} old cache entries`);
    }
  }

  /**
   * Cancel all active requests
   */
  cancelActiveRequests() {
    this.activeRequests.clear();
    this.requestPromises.clear();
    this.activeRequestCount = 0;
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
      // 🚀 DATASET CACHE: Include dataset-level cache stats
      datasetZattrsCacheSize: this.datasetZattrsCache.size,
      currentDatasetId: this.currentDatasetId,
      activeRequests: this.activeRequests.size,
      activeRequestCount: this.activeRequestCount,
      maxConcurrentRequests: this.maxConcurrentRequests,
      pendingRequestPromises: this.requestPromises.size
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
    const datasetUrl = `${this.baseUrl}/${correctDatasetId}`;
    
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
   * Get list of available wells from dataset files endpoint
   * @param {string} datasetId - Dataset ID
   * @returns {Promise<Array<string>>} Array of available well IDs
   */
  async getAvailableWells(datasetId) {
    const correctDatasetId = this.extractDatasetId(datasetId);
    const filesUrl = `${this.baseUrl}/${correctDatasetId}/files/`;
    
    try {
      console.log(`🔍 Getting available wells from: ${filesUrl}`);
      const response = await this.managedFetch(filesUrl);
      
      if (!response.ok) {
        console.warn(`Failed to get dataset files: ${response.status}`);
        return [];
      }
      
      const filesData = await response.json();
      
      // Extract well IDs from file names
      if (Array.isArray(filesData)) {
        const availableWells = filesData
          .filter(file => file.type === 'file' && file.name.startsWith('well_') && file.name.endsWith('_96.zip'))
          .map(file => {
            // Extract well ID from filename (e.g., "well_A2_96.zip" -> "A2")
            const match = file.name.match(/well_([A-Z]\d+)_96\.zip/);
            return match ? match[1] : null;
          })
          .filter(wellId => wellId !== null);
        
        console.log(`✅ Found ${availableWells.length} available wells:`, availableWells);
        return availableWells;
      }
      
      console.warn('No files data found in response');
      return [];
      
    } catch (error) {
      console.warn(`Failed to get available wells: ${error.message}`);
      return [];
    }
  }

  /**
   * Get visible wells for a given region using well plate config (frontend provides config)
   * @param {Array} allWells - Array of well info objects (id, centerX, centerY, radius, wellMinX, wellMaxX, wellMinY, wellMaxY)
   * @param {number} regionMinX
   * @param {number} regionMaxX
   * @param {number} regionMinY
   * @param {number} regionMaxY
   * @returns {Array} Array of visible well info
   */
  getVisibleWellsInRegion(allWells, regionMinX, regionMaxX, regionMinY, regionMaxY) {
    return allWells.filter(well => {
      // Well is visible if its center is inside the region, or region overlaps well bounds
      const centerInside = (
        well.centerX >= regionMinX && well.centerX <= regionMaxX &&
        well.centerY >= regionMinY && well.centerY <= regionMaxY
      );
      const overlaps = (
        well.wellMaxX >= regionMinX && well.wellMinX <= regionMaxX &&
        well.wellMaxY >= regionMinY && well.wellMinY <= regionMaxY
      );
      return centerInside || overlaps;
    });
  }

  /**
   * For a given well, check which chunks are available for a region
   * @param {string} datasetId
   * @param {string} wellId
   * @param {number} scaleLevel
   * @param {number} x_start
   * @param {number} y_start
   * @param {number} x_end
   * @param {number} y_end
   * @param {number} timepoint
   * @param {number} channelIndex
   * @returns {Promise<Array>} Array of available chunk objects
   */
  async getAvailableChunksForRegion(datasetId, wellId, scaleLevel, x_start, y_start, x_end, y_end, timepoint, channelIndex) {
    const correctDatasetId = this.extractDatasetId(datasetId);
    const baseUrl = `${this.baseUrl}/${correctDatasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
    
    console.log(`🔍 Checking chunks for well ${wellId} scale ${scaleLevel}:`);
    console.log(`   Region: (${x_start}, ${y_start}) to (${x_end}, ${y_end})`);
    console.log(`   Base URL: ${baseUrl}`);
    
    const metadata = await this.fetchZarrMetadata(baseUrl, scaleLevel);
    if (!metadata) {
      console.log(`❌ No metadata available for well ${wellId} scale ${scaleLevel}`);
      return [];
    }
    
    const { zarray } = metadata;
    console.log(`   Image shape: ${zarray.shape}`);
    console.log(`   Chunk size: ${zarray.chunks}`);
    
    // Calculate chunk coordinates for the region
    const chunks = this.calculateChunkCoordinatesFromPixels(
      x_start, y_start, x_end, y_end, timepoint, channelIndex, zarray
    );
    
    console.log(`   Calculated ${chunks.length} chunk coordinates:`);
    chunks.forEach(chunk => {
      console.log(`     ${chunk.filename}: (${chunk.coordinates.join(', ')})`);
    });
    
    // Get available chunks
    const availableChunks = await this.getAvailableChunks(baseUrl, scaleLevel);
    if (!availableChunks) {
      console.log(`❌ No available chunks found for well ${wellId} scale ${scaleLevel}`);
      return [];
    }
    
    console.log(`   Found ${availableChunks.length} available chunks`);
    if (availableChunks.length <= 10) {
      availableChunks.forEach(chunk => console.log(`     ${chunk}`));
    } else {
      console.log(`     First 5: ${availableChunks.slice(0, 5).join(', ')}`);
      console.log(`     Last 5: ${availableChunks.slice(-5).join(', ')}`);
    }
    
    const availableChunkSet = new Set(availableChunks);
    const matchingChunks = chunks.filter(chunk => availableChunkSet.has(chunk.filename));
    
    console.log(`   Matching chunks: ${matchingChunks.length}/${chunks.length}`);
    matchingChunks.forEach(chunk => {
      console.log(`     ✅ ${chunk.filename}`);
    });
    
    return matchingChunks;
  }

  /**
   * Test method to verify cancellation functionality
   * @returns {Object} Test results
   */
  testCancellation() {
    console.log('🧪 Testing cancellation functionality...');
    
    // Test request ID generation
    const requestId1 = this.generateRequestId();
    const requestId2 = this.generateRequestId();
    console.log(`Generated request IDs: ${requestId1}, ${requestId2}`);
    
    // Test cancellation of non-existent request
    const cancelled1 = this.cancelRequest('non_existent');
    console.log(`Cancelled non-existent request: ${cancelled1}`);
    
    // Test batch cancellation
    const cancelled2 = this.cancelBatchRequests('non_existent_batch');
    console.log(`Cancelled non-existent batch: ${cancelled2}`);
    
    // Test all requests cancellation
    const cancelled3 = this.cancelAllRequests();
    console.log(`Cancelled all requests: ${cancelled3}`);
    
    return {
      requestIdGeneration: requestId1 !== requestId2,
      nonExistentCancellation: !cancelled1,
      batchCancellation: cancelled2 === 0,
      allRequestsCancellation: cancelled3 >= 0
    };
  }
}

// Export the class
export default ArtifactZarrLoader; 