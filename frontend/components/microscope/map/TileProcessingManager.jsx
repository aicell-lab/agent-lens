import React from 'react';

/**
 * TileProcessingManager - Centralized tile processing with simplified workflow
 * 
 * This class handles:
 * 1. Single channel data loading
 * 2. Color mapping for different modes
 * 3. Contrast adjustment application
 * 4. Channel merging with additive blending
 * 5. Error handling for failed channels
 */
class TileProcessingManager {
  constructor() {
    this.defaultColors = {
      'BF LED matrix full': '#FFFFFF',
      'Fluorescence 405 nm Ex': '#8A2BE2', // Blue Violet
      'Fluorescence 488 nm Ex': '#00FF00', // Green
      'Fluorescence 561 nm Ex': '#FFFF00', // Yellow
      'Fluorescence 638 nm Ex': '#FF0000', // Red
      'Fluorescence 730 nm Ex': '#FF69B4', // Hot Pink
    };
  }

  /**
   * Main processing function - processes all enabled channels and merges them
   * @param {Array} enabledChannels - Array of channel objects with enabled state
   * @param {Object} tileRequest - Tile request parameters (centerX, centerY, width_mm, height_mm, etc.)
   * @param {string} mode - 'FREE_PAN' or 'HISTORICAL'
   * @param {Object} channelConfigs - Contrast settings for each channel
   * @param {Object} services - Service objects (microscopeControlService, artifactZarrLoader)
   * @param {Object} metadata - Additional metadata (zarrMetadata, etc.)
   * @returns {Promise<Object>} - Processed tile data with merged channels
   */
  async processTileChannels(enabledChannels, tileRequest, mode, channelConfigs, services, metadata = {}) {
    console.log(`🎨 TileProcessingManager: Processing ${enabledChannels.length} channels in ${mode} mode`);
    
    if (enabledChannels.length === 0) {
      console.warn('🎨 TileProcessingManager: No enabled channels, returning empty tile');
      return this.createEmptyTile(tileRequest);
    }

    // Process each channel individually
    const channelPromises = enabledChannels.map(channel => 
      this.processSingleChannel(channel, tileRequest, mode, channelConfigs, services, metadata)
    );

    // Wait for all channels to complete (including failed ones)
    const channelResults = await Promise.allSettled(channelPromises);
    
    // Extract successful results and log failures
    const successfulChannels = [];
    const failedChannels = [];
    
    channelResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        successfulChannels.push(result.value);
      } else {
        failedChannels.push(enabledChannels[index]);
        console.warn(`🎨 TileProcessingManager: Channel ${enabledChannels[index].label || enabledChannels[index]} failed:`, result.reason);
      }
    });

    if (successfulChannels.length === 0) {
      console.warn('🎨 TileProcessingManager: All channels failed, returning empty tile');
      return this.createEmptyTile(tileRequest);
    }

    // Merge all successful channels
    const mergedTile = await this.mergeChannels(successfulChannels, tileRequest);
    
    console.log(`🎨 TileProcessingManager: Successfully merged ${successfulChannels.length}/${enabledChannels.length} channels`);
    
    return mergedTile;
  }

  /**
   * Process a single channel - load data, apply color mapping, apply contrast
   * @param {Object|string} channel - Channel object or channel name
   * @param {Object} tileRequest - Tile request parameters
   * @param {string} mode - 'FREE_PAN' or 'HISTORICAL'
   * @param {Object} channelConfigs - Contrast settings
   * @param {Object} services - Service objects
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object|null>} - Processed channel data or null if failed
   */
  async processSingleChannel(channel, tileRequest, mode, channelConfigs, services, metadata) {
    try {
      console.log(`🔍 processSingleChannel received channel:`, typeof channel, channel);
      
      const channelName = typeof channel === 'string' ? channel : (channel.label || channel.channelName || channel.name);
      const channelConfig = channelConfigs[channelName] || { min: 0, max: 255 };
      
      console.log(`🎨 TileProcessingManager: Processing channel ${channelName} in ${mode} mode`);
      
      // Load channel data using appropriate service
      const channelData = await this.loadChannelData(channelName, tileRequest, mode, services, metadata);
      
      if (!channelData) {
        throw new Error(`Failed to load data for channel ${channelName}`);
      }

      // Apply color mapping
      const color = this.getChannelColor(channel, mode, metadata);
      
      // Apply contrast adjustment
      const processedData = await this.applyContrastAdjustment(channelData, channelConfig, color);
      
      return {
        channelName,
        data: processedData,
        color,
        config: channelConfig
      };
      
    } catch (error) {
      console.error(`🎨 TileProcessingManager: Error processing channel ${channel}:`, error);
      return null;
    }
  }

  /**
   * Load channel data using the appropriate service based on mode
   * @param {string} channelName - Name of the channel
   * @param {Object} tileRequest - Tile request parameters
   * @param {string} mode - 'FREE_PAN' or 'HISTORICAL'
   * @param {Object} services - Service objects
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<string|null>} - Base64 data URL or null if failed
   */
  async loadChannelData(channelName, tileRequest, mode, services, metadata) {
    const { microscopeControlService, artifactZarrLoader } = services;
    
    if (mode === 'FREE_PAN') {
      // Use microscope service for real-time data
      const result = await microscopeControlService.get_stitched_region(
        tileRequest.centerX,
        tileRequest.centerY,
        tileRequest.width_mm,
        tileRequest.height_mm,
        tileRequest.wellPlateType,
        tileRequest.scaleLevel,
        channelName, // Single channel only
        tileRequest.timepoint || 0,
        tileRequest.wellPaddingMm || 0,
        'base64'
      );
      
      if (result.success) {
        return `data:image/png;base64,${result.data}`;
      } else {
        throw new Error(`Microscope service failed: ${result.message || 'Unknown error'}`);
      }
      
    } else if (mode === 'HISTORICAL') {
      // Use artifact zarr loader for historical data
      const result = await artifactZarrLoader.getWellRegion(
        tileRequest.wellId,
        tileRequest.centerX,
        tileRequest.centerY,
        tileRequest.width_mm,
        tileRequest.height_mm,
        channelName,
        tileRequest.scaleLevel,
        tileRequest.timepoint || 0,
        tileRequest.datasetId,
        'base64'
      );
      
      if (result && result.success) {
        return `data:image/png;base64,${result.data}`;
      } else {
        throw new Error(`Artifact loader failed for channel ${channelName}`);
      }
    }
    
    throw new Error(`Unknown mode: ${mode}`);
  }

  /**
   * Get color for a channel based on mode and metadata
   * @param {Object|string} channel - Channel object or channel name
   * @param {string} mode - 'FREE_PAN' or 'HISTORICAL'
   * @param {Object} metadata - Additional metadata
   * @returns {string} - Hex color code
   */
  getChannelColor(channel, mode, metadata) {
    if (mode === 'HISTORICAL' && metadata.zarrMetadata) {
      // Extract color from zarr metadata
      const channelName = typeof channel === 'string' ? channel : channel.label || channel.channelName;
      const zarrChannel = metadata.zarrMetadata.activeChannels?.find(ch => ch.label === channelName);
      
      if (zarrChannel && zarrChannel.color) {
        return `#${zarrChannel.color}`;
      }
    }
    
    // Use hardcoded colors for FREE_PAN mode or fallback
    const channelName = typeof channel === 'string' ? channel : (channel.label || channel.channelName || channel.name);
    return this.defaultColors[channelName] || '#FFFFFF';
  }

  /**
   * Apply contrast adjustment to channel data
   * @param {string} dataUrl - Base64 data URL
   * @param {Object} config - Contrast configuration {min, max}
   * @param {string} color - Channel color for tinting
   * @returns {Promise<string>} - Processed data URL
   */
  async applyContrastAdjustment(dataUrl, config, color) {
    // Always apply color tinting, even if no contrast adjustment is needed
    // This ensures channels have their proper colors in multi-channel mode

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Draw the original image
        ctx.drawImage(img, 0, 0);
        
        // Get image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        // Apply contrast adjustment
        const min = config.min || 0;
        const max = config.max || 255;
        const range = max - min;
        
        // Parse color for tinting
        const colorRgb = this.hexToRgb(color);
        
        for (let i = 0; i < data.length; i += 4) {
          // Apply min/max contrast adjustment
          const adjustedR = range > 0 ? Math.max(0, Math.min(255, (data[i] - min) * 255 / range)) : data[i];
          const adjustedG = range > 0 ? Math.max(0, Math.min(255, (data[i + 1] - min) * 255 / range)) : data[i + 1];
          const adjustedB = range > 0 ? Math.max(0, Math.min(255, (data[i + 2] - min) * 255 / range)) : data[i + 2];
          
          // Apply color tinting (always apply, even if no contrast adjustment)
          data[i] = Math.min(255, adjustedR * colorRgb.r / 255);
          data[i + 1] = Math.min(255, adjustedG * colorRgb.g / 255);
          data[i + 2] = Math.min(255, adjustedB * colorRgb.b / 255);
          // Alpha channel remains unchanged
        }
        
        // Put the adjusted image data back
        ctx.putImageData(imageData, 0, 0);
        
        // Convert back to data URL
        const adjustedDataUrl = canvas.toDataURL('image/png');
        resolve(adjustedDataUrl);
      };
      
      img.onerror = () => {
        // If image loading fails, return original data URL
        resolve(dataUrl);
      };
      
      img.src = dataUrl;
    });
  }

  /**
   * Merge multiple channels using additive blending
   * @param {Array} channelDataArray - Array of processed channel data
   * @param {Object} tileRequest - Tile request parameters
   * @returns {Object} - Merged tile object
   */
  mergeChannels(channelDataArray, tileRequest) {
    if (channelDataArray.length === 1) {
      // Single channel - no merging needed
      return {
        data: channelDataArray[0].data,
        bounds: tileRequest.bounds,
        width_mm: tileRequest.width_mm,
        height_mm: tileRequest.height_mm,
        scale: tileRequest.scaleLevel,
        channel: channelDataArray[0].channelName,
        channelsUsed: [channelDataArray[0].channelName],
        isMerged: false
      };
    }

    // Multiple channels - merge using additive blending
    return new Promise((resolve) => {
      const firstChannel = channelDataArray[0];
      const img = new Image();
      
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Clear to black (important for additive blending)
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Start with first channel
        ctx.drawImage(img, 0, 0);
        
        // Add remaining channels using additive blending
        let processedChannels = 1;
        const totalChannels = channelDataArray.length;
        
        for (let i = 1; i < channelDataArray.length; i++) {
          const channelData = channelDataArray[i];
          const channelImg = new Image();
          
          channelImg.onload = () => {
            // Use additive blending mode (lighter = additive)
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(channelImg, 0, 0);
            
            processedChannels++;
            
            // Check if this is the last channel to process
            if (processedChannels === totalChannels) {
              // Reset composite operation
              ctx.globalCompositeOperation = 'source-over';
              
              // All channels processed, create final tile
              const mergedDataUrl = canvas.toDataURL('image/png');
              
              resolve({
                data: mergedDataUrl,
                bounds: tileRequest.bounds,
                width_mm: tileRequest.width_mm,
                height_mm: tileRequest.height_mm,
                scale: tileRequest.scaleLevel,
                channel: channelDataArray.map(ch => ch.channelName).sort().join(','),
                channelsUsed: channelDataArray.map(ch => ch.channelName),
                isMerged: true
              });
            }
          };
          
          channelImg.onerror = () => {
            console.warn(`Failed to load channel image for ${channelData.channelName}`);
            processedChannels++;
            
            // Check if this was the last channel to process
            if (processedChannels === totalChannels) {
              // Reset composite operation
              ctx.globalCompositeOperation = 'source-over';
              
              const mergedDataUrl = canvas.toDataURL('image/png');
              resolve({
                data: mergedDataUrl,
                bounds: tileRequest.bounds,
                width_mm: tileRequest.width_mm,
                height_mm: tileRequest.height_mm,
                scale: tileRequest.scaleLevel,
                channel: channelDataArray.map(ch => ch.channelName).sort().join(','),
                channelsUsed: channelDataArray.map(ch => ch.channelName),
                isMerged: true
              });
            }
          };
          
          channelImg.src = channelData.data;
        }
      };
      
      img.onerror = () => {
        console.error('Failed to load first channel image for merging');
        resolve(this.createEmptyTile(tileRequest));
      };
      
      img.src = firstChannel.data;
    });
  }

  /**
   * Create an empty tile when no channels are available
   * @param {Object} tileRequest - Tile request parameters
   * @returns {Object} - Empty tile object
   */
  createEmptyTile(tileRequest) {
    return {
      data: null,
      bounds: tileRequest.bounds,
      width_mm: tileRequest.width_mm,
      height_mm: tileRequest.height_mm,
      scale: tileRequest.scaleLevel,
      channel: 'none',
      channelsUsed: [],
      isMerged: false
    };
  }

  /**
   * Convert hex color to RGB object
   * @param {string} hex - Hex color code (e.g., '#FF0000')
   * @returns {Object} - RGB object {r, g, b}
   */
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 255, g: 255, b: 255 };
  }
}

// Export singleton instance
export default new TileProcessingManager();
