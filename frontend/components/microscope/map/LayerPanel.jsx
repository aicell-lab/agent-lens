import React, { useState } from 'react';
import PropTypes from 'prop-types';
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
  
  // Multi-Layer Experiments props
  visibleExperiments = [],
  setVisibleExperiments,
  
  // Layout props
  isFovFittedMode = false
}) => {
  // State for layer management
  const [layers, setLayers] = useState([
    {
      id: 'well-plate',
      name: '96-Well Plate Grid',
      type: 'plate-view',
      visible: visibleLayers.wellPlate,
      channels: [],
      readonly: true
    },
    {
      id: 'scan-results',
      name: 'Scan Results',
      type: 'plate-view', 
      visible: visibleLayers.scanResults,
      channels: [],
      readonly: true
    }
  ]);
  
  const [expandedLayers, setExpandedLayers] = useState({});
  const [showLayerTypeDropdown, setShowLayerTypeDropdown] = useState(false);
  const [newLayerType, setNewLayerType] = useState('plate-view');

  // Layer type definitions
  const layerTypes = [
    { id: 'plate-view', name: 'Plate View (96-well etc.)', readonly: true, icon: 'fas fa-th' },
    { id: 'quick-scan', name: 'Quick Scan', readonly: false, icon: 'fas fa-search' },
    { id: 'normal-scan', name: 'Normal Scan', readonly: false, icon: 'fas fa-search-plus' },
    { id: 'live-view', name: 'Live View / Snap', readonly: false, icon: 'fas fa-camera' },
    { id: 'load-server', name: 'Load from Server', readonly: true, icon: 'fas fa-download' }
  ];

  // Helper functions for layer management
  const toggleLayerVisibility = (layerId) => {
    setLayers(prev => prev.map(layer => 
      layer.id === layerId 
        ? { ...layer, visible: !layer.visible }
        : layer
    ));
    
    // Update the parent component's visibleLayers state
    if (layerId === 'well-plate') {
      setVisibleLayers(prev => ({ ...prev, wellPlate: !prev.wellPlate }));
    } else if (layerId === 'scan-results') {
      setVisibleLayers(prev => ({ ...prev, scanResults: !prev.scanResults }));
    }
  };

  const toggleLayerExpansion = (layerId) => {
    setExpandedLayers(prev => ({
      ...prev,
      [layerId]: !prev[layerId]
    }));
  };

  const addNewLayer = () => {
    setShowLayerTypeDropdown(true);
  };

  const createLayer = (layerType) => {
    const layerTypeConfig = layerTypes.find(lt => lt.id === layerType);
    if (!layerTypeConfig) return;

    const newLayer = {
      id: `layer-${Date.now()}`,
      name: `${layerTypeConfig.name} ${layers.length + 1}`,
      type: layerType,
      visible: true,
      channels: [],
      readonly: layerTypeConfig.readonly,
      createdAt: new Date().toISOString()
    };

    setLayers(prev => [...prev, newLayer]);
    setShowLayerTypeDropdown(false);
    setNewLayerType('plate-view');
  };

  const snapImage = (layerId) => {
    // This would integrate with the microscope service to capture an image
    console.log(`Snapping image for layer: ${layerId}`);
    // TODO: Implement actual image capture logic
    // This could trigger a camera capture and store the result in the layer
  };

  const deleteLayer = (layerId) => {
    setLayers(prev => prev.filter(layer => layer.id !== layerId));
  };

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

  // Note: Contrast adjustments are now handled by TileProcessingManager
  // This function is kept for backward compatibility but is no longer used

  // Simplified update function - TileProcessingManager handles contrast adjustments automatically
  const updateRealMicroscopeChannelConfigWithRefresh = (channelName, updates) => {
    console.log(`🎨 LayerPanel: Updating contrast settings for ${channelName}:`, updates);
    
    // Update the configuration
    updateRealMicroscopeChannelConfig(channelName, updates);
    
    // For FREE_PAN mode, trigger a canvas refresh to apply the new contrast settings
    if (!isHistoricalDataMode && !isSimulatedMicroscope && mapViewMode === 'FREE_PAN') {
      console.log(`🎨 LayerPanel: Contrast settings changed for ${channelName}, triggering canvas refresh`);
      
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
      {/* Layer List Header */}
      <div className="layer-panel__header">
        <i className="fas fa-layer-group"></i>
        <span>Layers</span>
        <div className="header-actions">
          {showLayerTypeDropdown && (
            <div className="layer-type-dropdown">
              <select 
                value={newLayerType} 
                onChange={(e) => setNewLayerType(e.target.value)}
                className="layer-type-select"
              >
                {layerTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              <button 
                className="confirm-layer-btn"
                onClick={() => createLayer(newLayerType)}
                title="Create Layer"
              >
                <i className="fas fa-check"></i>
              </button>
              <button 
                className="cancel-layer-btn"
                onClick={() => setShowLayerTypeDropdown(false)}
                title="Cancel"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          )}
          <button 
            className="add-layer-btn"
            onClick={addNewLayer}
            title="Add New Layer"
            disabled={showLayerTypeDropdown}
          >
            <i className="fas fa-plus"></i>
          </button>
        </div>
      </div>

      {/* Layer List */}
      <div className="layer-list">
        {/* Map Layers */}
        {layers.map((layer) => {
          const layerTypeConfig = layerTypes.find(lt => lt.id === layer.type);
          return (
            <div key={layer.id} className={`layer-item layer-item--${layer.type}`}>
              <div className="layer-item__header">
                <button
                  className="layer-visibility-btn"
                  onClick={() => toggleLayerVisibility(layer.id)}
                  title={layer.visible ? "Hide layer" : "Show layer"}
                >
                  <i className={`fas fa-eye${layer.visible ? '' : '-slash'}`}></i>
                </button>
                
                <div 
                  className="layer-name"
                  onClick={() => toggleLayerExpansion(layer.id)}
                  title="Click to expand/collapse channels"
                >
                  <i className={`fas fa-chevron-${expandedLayers[layer.id] ? 'down' : 'right'}`}></i>
                  <i className={`${layerTypeConfig?.icon || 'fas fa-layer-group'} layer-type-icon`}></i>
                  <span>{layer.name}</span>
                  {layer.readonly && <span className="readonly-badge" title="Read-only layer">🔒</span>}
                  {/* Channel count for server layers with multi-channel data */}
                  {layer.type === 'load-server' && shouldUseMultiChannelLoading() && (isHistoricalDataMode || mapViewMode === 'FOV_FITTED') && (
                    <span className="channel-count">({availableZarrChannels.length})</span>
                  )}
                </div>

                <div className="layer-actions">
                  {layer.type === 'live-view' && !layer.readonly && (
                    <button
                      onClick={() => snapImage(layer.id)}
                      className="layer-action-btn layer-action-btn--snap"
                      title="Snap image"
                    >
                      <i className="fas fa-camera"></i>
                    </button>
                  )}
                  {!layer.readonly && (
                    <button
                      onClick={() => deleteLayer(layer.id)}
                      className="layer-action-btn layer-action-btn--delete"
                      title="Delete layer"
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  )}
                </div>
              </div>

              {/* Channels (collapsed by default) */}
              {expandedLayers[layer.id] && (
                <div className="layer-channels">
                  {layer.type === 'plate-view' && (
                    <div className="channel-item channel-item--overlay">
                      <span className="channel-name">Plate Overlay</span>
                    </div>
                  )}
                  {layer.type === 'quick-scan' && (
                    <div className="channel-item channel-item--scan">
                      <span className="channel-name">Quick Scan Data</span>
                      <div className="scan-controls">
                        <button className="scan-btn">Start Scan</button>
                      </div>
                    </div>
                  )}
                  {layer.type === 'normal-scan' && (
                    <div className="channel-item channel-item--scan">
                      <span className="channel-name">Normal Scan Data</span>
                      <div className="scan-controls">
                        <button className="scan-btn">Configure & Start</button>
                      </div>
                    </div>
                  )}
                  {layer.type === 'live-view' && (
                    <div className="channel-item channel-item--live">
                      <span className="channel-name">Live View</span>
                      <div className="live-controls">
                        <button className="live-btn">Start Live View</button>
                        <button className="snap-btn" onClick={() => snapImage(layer.id)}>Snap Image</button>
                      </div>
                    </div>
                  )}
                  {layer.type === 'load-server' && (
                    <div className="channel-item channel-item--server">
                      <span className="channel-name">Server Data</span>
                      <div className="server-controls">
                        <button className="load-btn">Browse & Load</button>
                      </div>
                      
                      {/* Multi-Channel Controls for Historical Data */}
                      {shouldUseMultiChannelLoading() && (isHistoricalDataMode || mapViewMode === 'FOV_FITTED') && (
                        <div className="server-channels">
                          {availableZarrChannels.map((channel) => {
                            const config = zarrChannelConfigs[channel.label] || {};
                            const channelColor = `#${channel.color}`;
                            const isEnabled = config.enabled || false;
                            const isLastChannel = isLastSelectedChannel(channel.label, isEnabled);
                            
                            return (
                              <div key={channel.label} className="channel-item">
                                <div className="channel-header">
                                  <label className="channel-toggle">
                                    <input
                                      type="checkbox"
                                      checked={isEnabled}
                                      disabled={isLastChannel}
                                      onChange={(e) => updateZarrChannelConfig(channel.label, { enabled: e.target.checked })}
                                      title={isLastChannel ? "Cannot deselect the last remaining channel" : ""}
                                    />
                                    <span className="channel-name">{channel.label}</span>
                                    <span 
                                      className="channel-color-indicator" 
                                      style={{ backgroundColor: channelColor }}
                                      title={`Channel color: ${channelColor}`}
                                    ></span>
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
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Experiments as Layers (for Real Microscope) */}
        {!isHistoricalDataMode && !isSimulatedMicroscope && (
          <>
            {isLoadingExperiments ? (
              <div className="loading-text">Loading experiments...</div>
            ) : (
              experiments.map((exp) => {
                const isVisible = visibleExperiments.includes(exp.name);
                const isActive = exp.name === activeExperiment;
                return (
                <div key={exp.name} className="layer-item layer-item--experiment">
                  <div className="layer-item__header">
                    <button
                      className="layer-visibility-btn"
                      onClick={() => {
                        if (isVisible) {
                          // Hide experiment
                          setVisibleExperiments(prev => prev.filter(name => name !== exp.name));
                        } else {
                          // Show experiment
                          setVisibleExperiments(prev => [...prev, exp.name]);
                        }
                      }}
                      title={isVisible ? "Hide experiment" : "Show experiment"}
                    >
                      <i className={`fas fa-${isVisible ? 'eye' : 'eye-slash'}`}></i>
                    </button>
                    
                    <button
                      className="layer-active-btn"
                      onClick={() => setActiveExperimentHandler(exp.name)}
                      title={isActive ? "Currently active experiment" : "Set as active experiment"}
                    >
                      <i className={`fas fa-${isActive ? 'star' : 'star'} ${isActive ? 'active-indicator' : ''}`}></i>
                    </button>
                    
                    <div 
                      className="layer-name"
                      onClick={() => toggleLayerExpansion(exp.name)}
                      title="Click to expand/collapse channels"
                    >
                      <i className={`fas fa-chevron-${expandedLayers[exp.name] ? 'down' : 'right'}`}></i>
                      <span className={exp.name === activeExperiment ? 'layer-name--active' : ''}>
                        {exp.name}
                      </span>
                      {/* Channel count for experiment layers with real microscope channels */}
                      {shouldUseMultiChannelLoading() && !isHistoricalDataMode && !isSimulatedMicroscope && mapViewMode !== 'FOV_FITTED' && (
                        <span className="channel-count">({Object.values(visibleLayers.channels).filter(v => v).length})</span>
                      )}
                    </div>

                    <div className="layer-actions">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setExperimentToReset(exp.name);
                          setShowClearCanvasConfirmation(true);
                        }}
                        className="layer-action-btn layer-action-btn--reset"
                        title="Reset experiment data"
                      >
                        <i className="fas fa-undo"></i>
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (exp.name === activeExperiment) return;
                          setExperimentToDelete(exp.name);
                          setShowDeleteConfirmation(true);
                        }}
                        className={`layer-action-btn layer-action-btn--delete ${exp.name === activeExperiment ? 'layer-action-btn--disabled' : ''}`}
                        title={exp.name === activeExperiment ? "Cannot delete active experiment" : "Delete experiment"}
                        disabled={exp.name === activeExperiment}
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>

                  {/* Experiment Channels */}
                  {expandedLayers[exp.name] && (
                    <div className="layer-channels">
                      <div className="channel-item channel-item--experiment">
                        <span className="channel-name">Experiment Data</span>
                      </div>
                      
                      {/* Real Microscope Channel Controls for this experiment */}
                      {shouldUseMultiChannelLoading() && !isHistoricalDataMode && !isSimulatedMicroscope && mapViewMode !== 'FOV_FITTED' && (
                        <div className="experiment-channels">
                          {Object.entries(visibleLayers.channels).map(([channel, isVisible]) => {
                            const config = realMicroscopeChannelConfigs[channel] || {};
                            const isLastChannel = isLastSelectedChannel(channel, isVisible);
                            
                            const defaultColors = {
                              'BF LED matrix full': '#FFFFFF',
                              'Fluorescence 405 nm Ex': '#8A2BE2',
                              'Fluorescence 488 nm Ex': '#00FF00',
                              'Fluorescence 561 nm Ex': '#FFFF00',
                              'Fluorescence 638 nm Ex': '#FF0000',
                              'Fluorescence 730 nm Ex': '#FF69B4',
                            };
                            const channelColor = defaultColors[channel] || '#FFFFFF';
                            
                            return (
                              <div key={channel} className="channel-item">
                                <div className="channel-header">
                                  <label className="channel-toggle">
                                    <input
                                      type="checkbox"
                                      checked={isVisible}
                                      disabled={isLastChannel}
                                      onChange={() => setVisibleLayers(prev => ({
                                        ...prev,
                                        channels: {
                                          ...prev.channels,
                                          [channel]: !isVisible
                                        }
                                      }))}
                                      title={isLastChannel ? "Cannot deselect the last remaining channel" : ""}
                                    />
                                    <span className="channel-name">{channel}</span>
                                    <span 
                                      className="channel-color-indicator" 
                                      style={{ backgroundColor: channelColor }}
                                      title={`Channel color: ${channelColor}`}
                                    ></span>
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
                      )}
                    </div>
                  )}
                </div>
                );
              })
            )}
          </>
        )}

      </div>

      {/* Layer Info Footer */}
      <div className="layer-panel__footer">
        <span className="blending-mode">
          🟢 Additive Blending Mode
        </span>
      </div>
    </div>
  );
};

LayerPanel.propTypes = {
  // Map Layers props
  visibleLayers: PropTypes.object.isRequired,
  setVisibleLayers: PropTypes.func.isRequired,
  
  // Experiments props
  isHistoricalDataMode: PropTypes.bool,
  isSimulatedMicroscope: PropTypes.bool,
  isLoadingExperiments: PropTypes.bool,
  activeExperiment: PropTypes.string,
  experiments: PropTypes.array,
  setActiveExperimentHandler: PropTypes.func,
  setShowCreateExperimentDialog: PropTypes.func,
  removeExperiment: PropTypes.func,
  setExperimentToReset: PropTypes.func,
  setShowClearCanvasConfirmation: PropTypes.func,
  setExperimentToDelete: PropTypes.func,
  setShowDeleteConfirmation: PropTypes.func,
  
  // Multi-Channel props
  shouldUseMultiChannelLoading: PropTypes.func,
  mapViewMode: PropTypes.string,
  availableZarrChannels: PropTypes.array,
  zarrChannelConfigs: PropTypes.object,
  updateZarrChannelConfig: PropTypes.func,
  getEnabledZarrChannels: PropTypes.func,
  realMicroscopeChannelConfigs: PropTypes.object,
  updateRealMicroscopeChannelConfig: PropTypes.func,
  
  // Multi-Layer Experiments props
  visibleExperiments: PropTypes.array,
  setVisibleExperiments: PropTypes.func,
  
  // Layout props
  isFovFittedMode: PropTypes.bool
};

export default LayerPanel;
