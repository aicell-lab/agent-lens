import React from 'react';
import './LayerPanel.css';

const LayerPanel = ({
  // Map Layers props
  visibleLayers,
  setVisibleLayers,
  
  // Experiments props
  isHistoricalDataMode,
  isSimulatedMicroscope,
  isLoadingExperiments,
  activeExperiment,
  experiments,
  setActiveExperimentHandler,
  setShowCreateExperimentDialog,
  removeExperiment,
  setExperimentToReset,
  setShowClearCanvasConfirmation,
  setExperimentToDelete,
  setShowDeleteConfirmation,
  
  // Multi-Channel props
  shouldUseMultiChannelLoading,
  mapViewMode,
  availableZarrChannels,
  zarrChannelConfigs,
  updateZarrChannelConfig,
  getEnabledZarrChannels,
  realMicroscopeChannelConfigs,
  updateRealMicroscopeChannelConfig,
  
  // Layout props
  isFovFittedMode = false
}) => {
  // Helper function to check if this is the last selected channel
  const isLastSelectedChannel = (channelName, isEnabled) => {
    if (isHistoricalDataMode || mapViewMode === 'FOV_FITTED') {
      // For zarr channels, check if this is the last enabled channel
      const enabledChannels = availableZarrChannels.filter(ch => zarrChannelConfigs[ch.label]?.enabled);
      return enabledChannels.length === 1 && enabledChannels[0].label === channelName && isEnabled;
    } else {
      // For real microscope channels, check if this is the last visible channel
      const visibleChannels = Object.entries(visibleLayers.channels).filter(([_, isVisible]) => isVisible);
      return visibleChannels.length === 1 && visibleChannels[0][0] === channelName && isEnabled;
    }
  };

  // Apply contrast adjustments to real microscope image data
  const applyRealMicroscopeContrastAdjustments = (imageDataUrl, channelsUsed) => {
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
        
        // Apply contrast adjustments for each channel
        for (let i = 0; i < data.length; i += 4) {
          // For each pixel, check if any of the visible channels need adjustment
          let hasAdjustment = false;
          let adjustedR = data[i];
          let adjustedG = data[i + 1];
          let adjustedB = data[i + 2];
          
          // Apply adjustments for each visible channel
          for (const channel of channelsUsed) {
            const config = realMicroscopeChannelConfigs[channel];
            if (config && (config.min !== 0 || config.max !== 255)) {
              hasAdjustment = true;
              
              // Apply min/max contrast adjustment
              const min = config.min || 0;
              const max = config.max || 255;
              const range = max - min;
              
              // Apply to each color channel
              adjustedR = range > 0 ? Math.max(0, Math.min(255, (adjustedR - min) * 255 / range)) : 0;
              adjustedG = range > 0 ? Math.max(0, Math.min(255, (adjustedG - min) * 255 / range)) : 0;
              adjustedB = range > 0 ? Math.max(0, Math.min(255, (adjustedB - min) * 255 / range)) : 0;
            }
          }
          
          if (hasAdjustment) {
            data[i] = adjustedR;
            data[i + 1] = adjustedG;
            data[i + 2] = adjustedB;
          }
        }
        
        // Put the adjusted image data back
        ctx.putImageData(imageData, 0, 0);
        
        // Convert back to data URL
        const adjustedDataUrl = canvas.toDataURL('image/png');
        resolve(adjustedDataUrl);
      };
      img.onerror = () => {
        // If image loading fails, return original data URL
        resolve(imageDataUrl);
      };
      img.src = imageDataUrl;
    });
  };

  // Enhanced update function that triggers canvas refresh for FREE_PAN mode
  const updateRealMicroscopeChannelConfigWithRefresh = (channelName, updates) => {
    console.log(`🎨 LayerPanel: Updating contrast settings for ${channelName}:`, updates);
    
    // Update the configuration
    updateRealMicroscopeChannelConfig(channelName, updates);
    
    // For FREE_PAN mode, trigger a canvas refresh to apply the new contrast settings
    if (!isHistoricalDataMode && !isSimulatedMicroscope && mapViewMode === 'FREE_PAN') {
      console.log(`🎨 LayerPanel: Contrast settings changed for ${channelName}, triggering canvas refresh`);
      console.log(`🎨 LayerPanel: Current conditions - isHistoricalDataMode: ${isHistoricalDataMode}, isSimulatedMicroscope: ${isSimulatedMicroscope}, mapViewMode: ${mapViewMode}`);
      
      // Store the contrast adjustment function globally for use in tile loading
      window.realMicroscopeContrastAdjustments = applyRealMicroscopeContrastAdjustments;
      
      // Trigger a canvas refresh by dispatching a custom event
      const event = new CustomEvent('contrastSettingsChanged', {
        detail: { channelName, updates }
      });
      console.log(`🎨 LayerPanel: Dispatching event:`, event);
      window.dispatchEvent(event);
    } else {
      console.log(`🎨 LayerPanel: Not dispatching event - conditions not met`);
    }
  };
  return (
    <div className={`layer-panel ${isFovFittedMode ? 'layer-panel--compact' : ''}`}>
      {/* Map Layers Section */}
      <div className="layer-section">
        <div className="layer-section__header">
          <i className="fas fa-layer-group"></i>
          Map Layers
        </div>
        <div className="layer-section__content">
          <div className="layer-options">
            <label className="layer-option">
              <input
                type="checkbox"
                checked={visibleLayers.wellPlate}
                onChange={(e) => setVisibleLayers(prev => ({ ...prev, wellPlate: e.target.checked }))}
              />
              <span>96-Well Plate Grid</span>
            </label>
            <label className="layer-option">
              <input
                type="checkbox"
                checked={visibleLayers.scanResults}
                onChange={(e) => setVisibleLayers(prev => ({ ...prev, scanResults: e.target.checked }))}
              />
              <span>Scan Results</span>
            </label>
          </div>
        </div>
      </div>

      {/* Experiments Management for Real Microscope */}
      {!isHistoricalDataMode && !isSimulatedMicroscope && (
        <div className="layer-section layer-section--experiments">
          <div className="layer-section__header">
            <i className="fas fa-flask"></i>
            Experiments
          </div>
          <div className="layer-section__content">
            {isLoadingExperiments ? (
              <div className="loading-text">Loading experiments...</div>
            ) : (
              <>
                {experiments.length > 0 && (
                  <div className="experiment-list">
                    <div className="experiment-list__label">Experiments:</div>
                    <div className="experiment-list__items">
                      {experiments.map((exp) => (
                        <div 
                          key={exp.name} 
                          className={`experiment-item ${exp.name === activeExperiment ? 'experiment-item--active' : ''}`}
                        >
                          <div 
                            className="experiment-item__content"
                            onClick={() => setActiveExperimentHandler(exp.name)}
                            title={`Click to activate experiment: ${exp.name}`}
                          >
                            <span className={exp.name === activeExperiment ? 'experiment-item__name--active' : 'experiment-item__name'}>
                              {exp.name}
                            </span>
                            {exp.name === activeExperiment && <i className="fas fa-check experiment-item__check"></i>}
                          </div>
                          <div className="experiment-item__actions">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExperimentToReset(exp.name);
                                setShowClearCanvasConfirmation(true);
                              }}
                              className="experiment-action-btn experiment-action-btn--reset"
                              title="Reset experiment data"
                            >
                              <i className="fas fa-undo"></i>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                // Prevent action if this is the active experiment
                                if (exp.name === activeExperiment) {
                                  console.log(`[LayerPanel] Delete button clicked for active experiment: ${exp.name} - action blocked`);
                                  return;
                                }
                                console.log(`[LayerPanel] Delete button clicked for experiment: ${exp.name}`);
                                console.log(`[LayerPanel] setExperimentToDelete function:`, typeof setExperimentToDelete);
                                console.log(`[LayerPanel] setShowDeleteConfirmation function:`, typeof setShowDeleteConfirmation);
                                setExperimentToDelete(exp.name);
                                setShowDeleteConfirmation(true);
                              }}
                              className={`experiment-action-btn experiment-action-btn--delete ${exp.name === activeExperiment ? 'experiment-action-btn--disabled' : ''}`}
                              title={exp.name === activeExperiment ? "Cannot delete active experiment" : "Delete experiment"}
                              disabled={exp.name === activeExperiment}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <button
                  onClick={() => setShowCreateExperimentDialog(true)}
                  className="create-experiment-btn"
                >
                  <i className="fas fa-plus"></i>
                  Create Experiment
                </button>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Multi-Channel Controls - Works for both Historical and Real Microscope */}
      {shouldUseMultiChannelLoading() && (
        <div className="layer-section layer-section--channels">
          <div className="layer-section__header">
            <i className="fas fa-palette"></i>
            Multi-Channel Controls
            <span className="channel-count">
              {isHistoricalDataMode || mapViewMode === 'FOV_FITTED' ? 
                `(${availableZarrChannels.length} channels)` : 
                `(${Object.values(visibleLayers.channels).filter(v => v).length} selected)`
              }
            </span>
          </div>
          <div className="layer-section__content">
            <div className="channel-controls">
              {/* Historical Mode: Use zarr channels */}
              {(isHistoricalDataMode || mapViewMode === 'FOV_FITTED') && availableZarrChannels.map((channel) => {
                const config = zarrChannelConfigs[channel.label] || {};
                const channelColor = `#${channel.color}`;
                const isEnabled = config.enabled || false;
                const isLastChannel = isLastSelectedChannel(channel.label, isEnabled);
                
                return (
                  <div key={channel.label} className="channel-item">
                    {/* Channel Header */}
                    <div className="channel-header">
                      <label className="channel-toggle">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          disabled={isLastChannel}
                          onChange={(e) => updateZarrChannelConfig(channel.label, { enabled: e.target.checked })}
                          title={isLastChannel ? "Cannot deselect the last remaining channel" : ""}
                        />
                        <div 
                          className="channel-color-indicator"
                          style={{ backgroundColor: channelColor }}
                        ></div>
                        <span className="channel-name">{channel.label}</span>
                        {isLastChannel && <span className="last-channel-indicator" title="Last selected channel">🔒</span>}
                      </label>
                      <span className="channel-index">Ch {channel.index}</span>
                    </div>
                    
                    {/* Contrast Controls */}
                    {config.enabled && (
                      <div className="contrast-controls">
                        <div className="contrast-slider">
                          <label className="contrast-label">Min:</label>
                          <input
                            type="range"
                            min="0"
                            max="255"
                            value={config.min || 0}
                            onChange={(e) => updateZarrChannelConfig(channel.label, { min: parseInt(e.target.value) })}
                            className="contrast-range"
                            style={{
                              background: `linear-gradient(to right, black 0%, ${channelColor} 100%)`
                            }}
                          />
                          <span className="contrast-value">{config.min || 0}</span>
                        </div>
                        
                        <div className="contrast-slider">
                          <label className="contrast-label">Max:</label>
                          <input
                            type="range"
                            min="0"
                            max="255"
                            value={config.max || 255}
                            onChange={(e) => updateZarrChannelConfig(channel.label, { max: parseInt(e.target.value) })}
                            className="contrast-range"
                            style={{
                              background: `linear-gradient(to right, black 0%, ${channelColor} 100%)`
                            }}
                          />
                          <span className="contrast-value">{config.max || 255}</span>
                        </div>
                        
                        {/* Quick Reset */}
                        <div className="contrast-reset">
                          <button
                            onClick={() => updateZarrChannelConfig(channel.label, { 
                              min: channel.window.start, 
                              max: channel.window.end 
                            })}
                            className="reset-btn"
                          >
                            Reset to defaults
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Real Microscope Mode: Use visibleLayers.channels */}
              {!isHistoricalDataMode && !isSimulatedMicroscope && mapViewMode !== 'FOV_FITTED' && 
               Object.entries(visibleLayers.channels).map(([channel, isVisible]) => {
                const config = realMicroscopeChannelConfigs[channel] || {};
                const isLastChannel = isLastSelectedChannel(channel, isVisible);
                
                return (
                  <div key={channel} className="channel-item">
                    {/* Channel Header */}
                    <div className="channel-header">
                      <label className="channel-toggle">
                        <input
                          type="checkbox"
                          checked={isVisible}
                          disabled={isLastChannel}
                          onChange={(e) => setVisibleLayers(prev => ({
                            ...prev,
                            channels: {
                              ...prev.channels,
                              [channel]: !isVisible
                            }
                          }))}
                          title={isLastChannel ? "Cannot deselect the last remaining channel" : ""}
                        />
                        <span className="channel-name">{channel}</span>
                        {isLastChannel && <span className="last-channel-indicator" title="Last selected channel">🔒</span>}
                      </label>
                    </div>
                    
                    {/* Contrast Controls */}
                    {isVisible && (
                      <div className="contrast-controls">
                        <div className="contrast-slider">
                          <label className="contrast-label">Min:</label>
                          <input
                            type="range"
                            min="0"
                            max="255"
                            value={config.min || 0}
                            onChange={(e) => updateRealMicroscopeChannelConfigWithRefresh(channel, { min: parseInt(e.target.value) })}
                            className="contrast-range"
                          />
                          <span className="contrast-value">{config.min || 0}</span>
                        </div>
                        
                        <div className="contrast-slider">
                          <label className="contrast-label">Max:</label>
                          <input
                            type="range"
                            min="0"
                            max="255"
                            value={config.max || 255}
                            onChange={(e) => updateRealMicroscopeChannelConfigWithRefresh(channel, { max: parseInt(e.target.value) })}
                            className="contrast-range"
                          />
                          <span className="contrast-value">{config.max || 255}</span>
                        </div>
                        
                        {/* Quick Reset */}
                        <div className="contrast-reset">
                          <button
                            onClick={() => updateRealMicroscopeChannelConfigWithRefresh(channel, { min: 0, max: 255 })}
                            className="reset-btn"
                          >
                            Reset to defaults
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            {/* Multi-Channel Info */}
            <div className="channel-info">
              <span className="channel-count-info">
                {(isHistoricalDataMode || mapViewMode === 'FOV_FITTED') ? 
                  `${getEnabledZarrChannels().length} of ${availableZarrChannels.length} channels enabled` :
                  `${Object.values(visibleLayers.channels).filter(v => v).length} channels selected`
                }
              </span>
              <span className="blending-mode">
                🟢 Additive Blending Mode
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LayerPanel;
