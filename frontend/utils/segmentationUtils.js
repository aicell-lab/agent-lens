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

