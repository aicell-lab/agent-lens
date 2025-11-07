/**
 * Segmentation Utils - Helper functions for microSAM automated segmentation
 * 
 * This module provides functions to interact with the microscope service's
 * segmentation API, including starting segmentation, monitoring progress,
 * and building channel configurations from UI state.
 */

/**
 * Start segmentation on an experiment with specified channel configurations
 * @param {Object} microscopeService - The microscope control service
 * @param {string} experimentName - Name of the experiment to segment
 * @param {Array} channelConfigs - Array of channel configuration objects
 * @returns {Promise<Object>} Result object with success status and details
 */
export const startSegmentation = async (microscopeService, experimentName, channelConfigs) => {
  try {
    if (!microscopeService) {
      throw new Error('Microscope service not available');
    }

    if (!experimentName) {
      throw new Error('Experiment name is required');
    }

    if (!channelConfigs || channelConfigs.length === 0) {
      throw new Error('At least one channel configuration is required');
    }

    console.log(`[SegmentationUtils] Starting segmentation for experiment: ${experimentName}`);
    console.log(`[SegmentationUtils] Channel configs:`, channelConfigs);

    const result = await microscopeService.segmentation_start(
      experimentName,
      null,  // wells_to_segment = null (auto-detect all wells)
      channelConfigs
    );

    console.log(`[SegmentationUtils] Segmentation start result:`, result);

    if (result && result.success !== false) {
      return {
        success: true,
        sourceExperiment: result.source_experiment,
        segmentationExperiment: result.segmentation_experiment,
        totalWells: result.total_wells,
        message: `Segmentation started for ${result.total_wells} wells`
      };
    } else {
      return {
        success: false,
        error: result?.message || 'Unknown error starting segmentation',
        message: `Failed to start segmentation: ${result?.message || 'Unknown error'}`
      };
    }
  } catch (error) {
    console.error(`[SegmentationUtils] Error starting segmentation:`, error);
    return {
      success: false,
      error: error.message,
      message: `Error starting segmentation: ${error.message}`
    };
  }
};

/**
 * Get current segmentation status
 * @param {Object} microscopeService - The microscope control service
 * @returns {Promise<Object>} Status object with current progress
 */
export const getSegmentationStatus = async (microscopeService) => {
  try {
    if (!microscopeService) {
      throw new Error('Microscope service not available');
    }

    const status = await microscopeService.segmentation_get_status();
    
    console.log(`[SegmentationUtils] Segmentation status:`, status);

    return {
      success: true,
      state: status.state,
      progress: status.progress,
      errorMessage: status.error_message,
      savedDataType: status.saved_data_type
    };
  } catch (error) {
    console.error(`[SegmentationUtils] Error getting segmentation status:`, error);
    return {
      success: false,
      error: error.message,
      state: 'error'
    };
  }
};

/**
 * Cancel running segmentation
 * @param {Object} microscopeService - The microscope control service
 * @returns {Promise<Object>} Result object with cancellation status
 */
export const cancelSegmentation = async (microscopeService) => {
  try {
    if (!microscopeService) {
      throw new Error('Microscope service not available');
    }

    console.log(`[SegmentationUtils] Cancelling segmentation...`);

    const result = await microscopeService.segmentation_cancel();
    
    console.log(`[SegmentationUtils] Segmentation cancel result:`, result);

    return {
      success: true,
      message: result.message || 'Segmentation cancelled successfully'
    };
  } catch (error) {
    console.error(`[SegmentationUtils] Error cancelling segmentation:`, error);
    return {
      success: false,
      error: error.message,
      message: `Error cancelling segmentation: ${error.message}`
    };
  }
};

/**
 * Build channel configurations from UI state
 * @param {Object} visibleChannels - Object with channel names as keys and visibility as values
 * @param {Function} getLayerContrastSettings - Function to get contrast settings for a layer
 * @param {string} experimentName - Name of the experiment
 * @returns {Array} Array of channel configuration objects
 */
export const buildChannelConfigs = (visibleChannels, getLayerContrastSettings, experimentName) => {
  const channelConfigs = [];

  // Get all visible channels
  const visibleChannelNames = Object.keys(visibleChannels).filter(
    channel => visibleChannels[channel] === true
  );

  if (visibleChannelNames.length === 0) {
    console.warn(`[SegmentationUtils] No visible channels found for experiment: ${experimentName}`);
    return [];
  }

  // Build configuration for each visible channel
  visibleChannelNames.forEach(channelName => {
    // Create unique layer ID for this experiment-channel combination
    const layerId = `${experimentName}-${channelName}`;
    const layerContrast = getLayerContrastSettings(layerId);

    // Convert contrast values from 0-255 range to percentiles (0-100)
    const minPercentile = Math.round((layerContrast.min || 0) / 255 * 100);
    const maxPercentile = Math.round((layerContrast.max || 255) / 255 * 100);

    // Ensure percentiles are within valid range
    const clampedMinPercentile = Math.max(0, Math.min(100, minPercentile));
    const clampedMaxPercentile = Math.max(0, Math.min(100, maxPercentile));

    // Ensure min is less than max
    const finalMinPercentile = Math.min(clampedMinPercentile, clampedMaxPercentile);
    const finalMaxPercentile = Math.max(clampedMinPercentile, clampedMaxPercentile);

    const channelConfig = {
      channel: channelName,
      min_percentile: finalMinPercentile,
      max_percentile: finalMaxPercentile
    };

    channelConfigs.push(channelConfig);

    console.log(`[SegmentationUtils] Built config for channel ${channelName}:`, {
      layerId,
      originalContrast: { min: layerContrast.min, max: layerContrast.max },
      percentiles: { min: finalMinPercentile, max: finalMaxPercentile }
    });
  });

  console.log(`[SegmentationUtils] Built ${channelConfigs.length} channel configurations:`, channelConfigs);
  return channelConfigs;
};

/**
 * Format progress message for display
 * @param {Object} progress - Progress object from segmentation status
 * @returns {string} Formatted progress message
 */
export const formatProgressMessage = (progress) => {
  if (!progress) {
    return 'Processing...';
  }

  const { completed_wells, total_wells, current_well } = progress;
  
  if (completed_wells === total_wells) {
    return `Completed! Processed ${total_wells} wells`;
  }

  if (current_well) {
    return `Processing well ${current_well} (${completed_wells}/${total_wells})`;
  }

  return `Progress: ${completed_wells}/${total_wells} wells`;
};

/**
 * Format error message for display
 * @param {string} errorMessage - Error message from API
 * @param {string} experimentName - Name of the experiment
 * @returns {string} Formatted error message
 */
export const formatErrorMessage = (errorMessage, experimentName) => {
  if (!errorMessage) {
    return `Segmentation failed for experiment: ${experimentName}`;
  }

  return `Segmentation failed: ${errorMessage}`;
};

/**
 * Check if segmentation is currently running
 * @param {string} state - Current segmentation state
 * @returns {boolean} True if segmentation is running
 */
export const isSegmentationRunning = (state) => {
  return state === 'running';
};

/**
 * Check if segmentation is completed
 * @param {string} state - Current segmentation state
 * @returns {boolean} True if segmentation is completed
 */
export const isSegmentationCompleted = (state) => {
  return state === 'completed';
};

/**
 * Check if segmentation failed
 * @param {string} state - Current segmentation state
 * @returns {boolean} True if segmentation failed
 */
export const isSegmentationFailed = (state) => {
  return state === 'failed';
};

/**
 * Get segmentation experiment name from source experiment name
 * @param {string} sourceExperimentName - Name of the source experiment
 * @returns {string} Expected segmentation experiment name
 */
export const getSegmentationExperimentName = (sourceExperimentName) => {
  return `${sourceExperimentName}-segmentation`;
};

/**
 * Check if an experiment name is a segmentation experiment
 * @param {string} experimentName - Name of the experiment to check
 * @returns {boolean} True if this is a segmentation experiment
 */
export const isSegmentationExperiment = (experimentName) => {
  return experimentName && experimentName.endsWith('-segmentation');
};

/**
 * Get source experiment name from segmentation experiment name
 * @param {string} segmentationExperimentName - Name of the segmentation experiment
 * @returns {string} Source experiment name
 */
export const getSourceExperimentName = (segmentationExperimentName) => {
  if (!isSegmentationExperiment(segmentationExperimentName)) {
    return segmentationExperimentName;
  }
  
  return segmentationExperimentName.replace('-segmentation', '');
};

/**
 * Fetch polygons from completed segmentation
 * @param {Object} microscopeService - The microscope control service
 * @param {string} sourceExperimentName - Name of the source experiment (not the segmentation experiment)
 * @param {string} wellId - Optional well identifier to filter results
 * @returns {Promise<Object>} Result object with polygons array
 */
export const fetchSegmentationPolygons = async (microscopeService, sourceExperimentName, wellId = null) => {
  try {
    if (!microscopeService) {
      throw new Error('Microscope service not available');
    }

    if (!sourceExperimentName) {
      throw new Error('Source experiment name is required');
    }

    console.log(`[SegmentationUtils] Fetching polygons for source experiment: ${sourceExperimentName}`);

    const result = await microscopeService.segmentation_get_polygons(
      sourceExperimentName,
      wellId
    );

    console.log(`[SegmentationUtils] Fetch polygons result:`, result);

    if (result && result.success) {
      return {
        success: true,
        polygons: result.polygons || [],
        totalCount: result.total_count || 0,
        experimentName: result.experiment_name
      };
    } else {
      return {
        success: false,
        error: result?.message || 'Unknown error fetching polygons',
        polygons: [],
        totalCount: 0
      };
    }
  } catch (error) {
    console.error(`[SegmentationUtils] Error fetching polygons:`, error);
    return {
      success: false,
      error: error.message,
      polygons: [],
      totalCount: 0
    };
  }
};

/**
 * Parse WKT polygon string to array of points
 * @param {string} polygonWkt - WKT polygon string
 * @returns {Array<{x: number, y: number}>} Array of coordinate points
 */
export const parseWktPolygon = (polygonWkt) => {
  if (!polygonWkt || typeof polygonWkt !== 'string') {
    return [];
  }
  
  try {
    // Extract coordinates from WKT format: POLYGON((x1 y1, x2 y2, ...))
    const match = polygonWkt.match(/POLYGON\(\(([^)]+)\)\)/);
    if (match && match[1]) {
      const coordPairs = match[1].split(',').map(pair => pair.trim());
      return coordPairs.map(pair => {
        const [x, y] = pair.split(' ').map(coord => parseFloat(coord));
        return { x, y };
      }).filter(point => !isNaN(point.x) && !isNaN(point.y));
    }
  } catch (error) {
    console.error('[SegmentationUtils] Error parsing WKT polygon:', error);
  }
  
  return [];
};

/**
 * Convert well-relative coordinates to stage coordinates
 * @param {number} wellRelativeX - Well-relative X coordinate (mm)
 * @param {number} wellRelativeY - Well-relative Y coordinate (mm)
 * @param {Object} wellInfo - Well information with centerX and centerY
 * @returns {{x: number, y: number}} Stage coordinates
 */
export const wellRelativeToStageCoords = (wellRelativeX, wellRelativeY, wellInfo) => {
  return {
    x: wellInfo.centerX + wellRelativeX,
    y: wellInfo.centerY + wellRelativeY
  };
};

/**
 * Process single polygon: extract image, generate embedding, create preview
 * @param {Object} polygon - Polygon object with well_id and polygon_wkt
 * @param {string} sourceExperimentName - Name of the source experiment
 * @param {Object} wellInfo - Well information object
 * @param {Object} services - Object containing microscopeControlService and artifactZarrLoader
 * @param {Object} channelConfigs - Channel configurations from experiment
 * @param {Array} enabledChannels - Array of enabled channels
 * @param {number} index - Index of this polygon in the batch
 * @returns {Promise<Object>} Processed annotation data with embeddings
 */
export const processSegmentationPolygon = async (
  polygon, 
  sourceExperimentName, 
  wellInfo, 
  services, 
  channelConfigs, 
  enabledChannels,
  index
) => {
  try {
    // Parse WKT to get points
    const wellRelativePoints = parseWktPolygon(polygon.polygon_wkt);
    if (wellRelativePoints.length < 3) {
      throw new Error('Invalid polygon - needs at least 3 points');
    }

    // Convert to stage coordinates
    const stagePoints = wellRelativePoints.map(point => 
      wellRelativeToStageCoords(point.x, point.y, wellInfo)
    );

    // Create annotation object for extraction
    const annotation = {
      id: `${sourceExperimentName}_cell_${index}`,
      type: 'polygon',
      points: stagePoints,
      description: `Cell from ${sourceExperimentName} well ${polygon.well_id}`,
      timestamp: Date.now()
    };

    // Extract image using advanced extraction (from source experiment)
    const { extractAnnotationImageRegionAdvanced } = await import('./annotationEmbeddingService');
    
    const imageBlob = await extractAnnotationImageRegionAdvanced(
      annotation,
      wellInfo,
      'FREE_PAN', // Mode for experiment layers
      services,
      channelConfigs,
      enabledChannels,
      { sourceExperiment: sourceExperimentName }
    );

    // Convert to data URL for preview generation
    const extractedImageDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(imageBlob);
    });

    // Generate embeddings
    const { generateImageEmbedding, generateTextEmbedding } = await import('./annotationEmbeddingService');
    
    const [imageEmbedding, textEmbedding] = await Promise.all([
      generateImageEmbedding(imageBlob),
      generateTextEmbedding(annotation.description)
    ]);

    // Generate 50x50 preview
    const { generatePreviewFromDataUrl } = await import('./previewImageUtils');
    const previewImage = await generatePreviewFromDataUrl(extractedImageDataUrl);

    // Prepare metadata
    const metadata = {
      annotation_id: annotation.id,
      well_id: polygon.well_id,
      annotation_type: 'polygon',
      timestamp: new Date().toISOString(),
      polygon_wkt: polygon.polygon_wkt,
      source: 'segmentation'
    };

    return {
      success: true,
      annotation: annotation,
      metadata: metadata,
      embeddings: {
        imageEmbedding,
        textEmbedding,
        extractedImageDataUrl
      },
      previewImage: previewImage
    };

  } catch (error) {
    console.error(`[SegmentationUtils] Error processing polygon ${index}:`, error);
    return {
      success: false,
      error: error.message,
      polygonIndex: index,
      wellId: polygon.well_id
    };
  }
};

/**
 * Extract image regions in batch using get_stitched_regions_batch
 * @param {Array} regions - Array of region specification objects
 * @param {Object} microscopeControlService - Microscope control service
 * @returns {Promise<Object>} Result with success flag, results array, and count
 */
export const batchExtractRegions = async (regions, microscopeControlService) => {
  try {
    if (!microscopeControlService || !microscopeControlService.get_stitched_regions_batch) {
      throw new Error('Microscope control service with get_stitched_regions_batch method is required');
    }

    if (!regions || regions.length === 0) {
      return {
        success: true,
        results: [],
        count: 0
      };
    }

    console.log(`[SegmentationUtils] Batch extracting ${regions.length} regions`);
    
    const result = await microscopeControlService.get_stitched_regions_batch(regions);
    
    if (result && result.success) {
      console.log(`[SegmentationUtils] Batch extraction complete: ${result.count} regions processed`);
      return result;
    } else {
      throw new Error(result?.message || 'Batch extraction failed');
    }
  } catch (error) {
    console.error('[SegmentationUtils] Error in batch region extraction:', error);
    throw error;
  }
};

/**
 * Batch process all polygons with progress tracking using batch operations
 * @param {Array} polygons - Array of polygon objects
 * @param {string} sourceExperimentName - Name of the source experiment
 * @param {Object} services - Object containing microscopeControlService and artifactZarrLoader
 * @param {Object} channelConfigs - Channel configurations from experiment
 * @param {Array} enabledChannels - Array of enabled channels
 * @param {Function} onProgress - Callback function for progress updates (current, total, successful, failed)
 * @param {Function} getWellInfoById - Function to get well information by well ID
 * @param {number} batchSize - Batch size for processing (default: 30)
 * @param {Function} shouldCancel - Optional function that returns true if processing should be cancelled
 * @returns {Promise<Object>} Result with processed annotations and statistics
 */
export const batchProcessSegmentationPolygons = async (
  polygons,
  sourceExperimentName,
  services,
  channelConfigs,
  enabledChannels,
  onProgress,
  getWellInfoById,
  batchSize = 30,
  shouldCancel = null
) => {
  const processedAnnotations = [];
  const failedPolygons = [];
  let successfulCount = 0;
  let failedCount = 0;

  console.log(`[SegmentationUtils] Starting batch processing of ${polygons.length} polygons with batch size ${batchSize}`);

  // Process polygons in batches
  for (let batchStart = 0; batchStart < polygons.length; batchStart += batchSize) {
    // Check for cancellation at the start of each batch
    if (shouldCancel && shouldCancel()) {
      console.log(`[SegmentationUtils] Processing cancelled by user at batch ${Math.floor(batchStart / batchSize) + 1}`);
      throw new Error('Processing cancelled by user');
    }

    const batchEnd = Math.min(batchStart + batchSize, polygons.length);
    const batch = polygons.slice(batchStart, batchEnd);
    
    console.log(`[SegmentationUtils] Processing batch ${Math.floor(batchStart / batchSize) + 1} (polygons ${batchStart + 1}-${batchEnd})`);

    // Prepare batch data: reuse logic from processSegmentationPolygon
    const batchData = [];
    const regions = [];

    for (let i = 0; i < batch.length; i++) {
      const polygon = batch[i];
      const globalIndex = batchStart + i;
      
      try {
        const wellInfo = getWellInfoById(polygon.well_id);
        if (!wellInfo) {
          failedCount++;
          failedPolygons.push({ index: globalIndex, wellId: polygon.well_id, error: 'Well info not found' });
          continue;
        }

        // Reuse polygon preparation logic
        const wellRelativePoints = parseWktPolygon(polygon.polygon_wkt);
        if (wellRelativePoints.length < 3) {
          throw new Error('Invalid polygon - needs at least 3 points');
        }

        const stagePoints = wellRelativePoints.map(point => 
          wellRelativeToStageCoords(point.x, point.y, wellInfo)
        );

        const annotation = {
          id: `${sourceExperimentName}_cell_${globalIndex}`,
          type: 'polygon',
          points: stagePoints,
          description: `Cell from ${sourceExperimentName} well ${polygon.well_id}`,
          timestamp: Date.now()
        };

        // Calculate bounding box for region extraction
        const xValues = stagePoints.map(p => p.x);
        const yValues = stagePoints.map(p => p.y);
        const width = Math.max(...xValues) - Math.min(...xValues);
        const height = Math.max(...yValues) - Math.min(...yValues);
        const centerX = (Math.min(...xValues) + Math.max(...xValues)) / 2;
        const centerY = (Math.min(...yValues) + Math.max(...yValues)) / 2;

        const channelName = enabledChannels.length > 0 
          ? (enabledChannels[0].label || enabledChannels[0].channelName || enabledChannels[0].name || 'BF LED matrix full')
          : 'BF LED matrix full';

        regions.push({
          center_x_mm: centerX,
          center_y_mm: centerY,
          width_mm: Math.max(width, 0.1),
          height_mm: Math.max(height, 0.1),
          well_plate_type: wellInfo.wellPlateType || '96',
          scale_level: 0,
          channel_name: channelName,
          timepoint: 0,
          well_padding_mm: 0,
          experiment_name: sourceExperimentName
        });

        batchData.push({ polygon, annotation, wellInfo, globalIndex });

      } catch (error) {
        failedCount++;
        failedPolygons.push({ index: globalIndex, wellId: polygon.well_id, error: error.message });
      }
    }

    if (regions.length === 0) {
      if (onProgress) onProgress(batchEnd, polygons.length, successfulCount, failedCount);
      continue;
    }

    try {
      // Batch extract regions
      const extractionResult = await batchExtractRegions(regions, services.microscopeControlService);
      if (!extractionResult.success || !extractionResult.results) {
        throw new Error('Batch region extraction failed');
      }

      // Convert extraction results to blobs
      const imageBlobs = [];
      const validBatchData = [];

      for (let i = 0; i < extractionResult.results.length; i++) {
        const extractionData = extractionResult.results[i];
        if (!extractionData?.success || !extractionData.data) {
          failedCount++;
          failedPolygons.push({ 
            index: batchData[i].globalIndex, 
            wellId: batchData[i].polygon.well_id, 
            error: 'Region extraction failed' 
          });
          continue;
        }

        // Convert base64 to blob
        try {
          let base64Data = extractionData.data.replace(/^data:image\/\w+;base64,/, '');
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let j = 0; j < binaryString.length; j++) {
            bytes[j] = binaryString.charCodeAt(j);
          }
          imageBlobs.push(new Blob([bytes], { type: 'image/png' }));
          validBatchData.push(batchData[i]);
        } catch (error) {
          failedCount++;
          failedPolygons.push({ 
            index: batchData[i].globalIndex, 
            wellId: batchData[i].polygon.well_id, 
            error: 'Failed to convert extracted image' 
          });
        }
      }

      if (imageBlobs.length === 0) {
        if (onProgress) onProgress(batchEnd, polygons.length, successfulCount, failedCount);
        continue;
      }

      // Batch generate embeddings
      const { generateImageEmbeddingBatch, generateTextEmbedding } = await import('./annotationEmbeddingService');
      const { generatePreviewFromDataUrl } = await import('./previewImageUtils');

      const imageEmbeddings = await generateImageEmbeddingBatch(imageBlobs);
      const textEmbeddings = await Promise.all(
        validBatchData.map(d => generateTextEmbedding(d.annotation.description))
      );

      // Process results - reuse metadata/preview logic from processSegmentationPolygon
      for (let i = 0; i < validBatchData.length; i++) {
        const data = validBatchData[i];
        const imageEmbedding = imageEmbeddings[i];

        if (!imageEmbedding) {
          failedCount++;
          failedPolygons.push({ 
            index: data.globalIndex, 
            wellId: data.polygon.well_id, 
            error: 'Image embedding generation failed' 
          });
          continue;
        }

        // Generate preview
        let previewImage = null;
        try {
          const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(imageBlobs[i]);
          });
          previewImage = await generatePreviewFromDataUrl(dataUrl);
        } catch (error) {
          console.warn(`[SegmentationUtils] Failed to generate preview:`, error);
        }

        // Reuse metadata structure from processSegmentationPolygon
        const metadata = {
          annotation_id: data.annotation.id,
          well_id: data.polygon.well_id,
          annotation_type: 'polygon',
          timestamp: new Date().toISOString(),
          polygon_wkt: data.polygon.polygon_wkt,
          source: 'segmentation'
        };

        processedAnnotations.push({
          success: true,
          annotation: data.annotation,
          metadata: metadata,
          embeddings: {
            imageEmbedding,
            textEmbedding: textEmbeddings[i],
            extractedImageDataUrl: null
          },
          previewImage: previewImage
        });

        successfulCount++;
      }

    } catch (error) {
      console.error(`[SegmentationUtils] Error processing batch:`, error);
      for (let i = 0; i < batch.length; i++) {
        const globalIndex = batchStart + i;
        if (!failedPolygons.find(f => f.index === globalIndex)) {
          failedCount++;
          failedPolygons.push({ index: globalIndex, wellId: batch[i].well_id, error: error.message });
        }
      }
    }

    if (onProgress) {
      onProgress(batchEnd, polygons.length, successfulCount, failedCount);
    }
  }

  console.log(`[SegmentationUtils] Batch processing complete: ${successfulCount} successful, ${failedCount} failed`);

  return {
    success: true,
    processedAnnotations,
    failedPolygons,
    successfulCount,
    failedCount,
    totalCount: polygons.length
  };
};

