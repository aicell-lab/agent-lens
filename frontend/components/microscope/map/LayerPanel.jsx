import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './LayerPanel.css';
import DualRangeSlider from '../../DualRangeSlider';

const LayerPanel = ({
  // Map Layers props
  visibleLayers,
  setVisibleLayers,
  
  // Experiments props
  isSimulatedMicroscope,
  isLoadingExperiments,
  activeExperiment,
  experiments,
  setActiveExperimentHandler,
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
  updateRealMicroscopeChannelConfig,
  
  // Per-layer contrast settings
  updateLayerContrastSettings,
  getLayerContrastSettings,
  
  // Multi-Layer Experiments props
  visibleExperiments = [],
  setVisibleExperiments,
  
  // Experiment creation props
  microscopeControlService,
  createExperiment,
  showNotification,
  appendLog,
  
  // Incubator service for fetching sample info
  incubatorControlService,
  
  // Layout props
  isFovFittedMode = false,
  
  // Scan configuration props
  setShowScanConfig,
  setShowQuickScanConfig,
  
  // Browse data modal props
  setShowBrowseDataModal,
  
  // Historical data mode props
  isHistoricalDataMode,
  setIsHistoricalDataMode,
  
  // Layer management props
  layers,
  setLayers,
  expandedLayers,
  setExpandedLayers,
  
  
  // Microscope control props
  isControlPanelOpen,
  setIsControlPanelOpen,
  
  // Live video props
  isWebRtcActive,
  toggleWebRtcStream,
  currentOperation,
  microscopeBusy,
  
  // Historical dataset props
  selectedHistoricalDataset,
  
  // Layer activation props
  activeLayer,
  setActiveLayer
}) => {
  const [showLayerTypeDropdown, setShowLayerTypeDropdown] = useState(false);
  const [newLayerType, setNewLayerType] = useState('quick-scan');

  // Layer type definitions
  const layerTypes = [
    { id: 'quick-scan', name: 'Quick Scan', readonly: false, icon: 'fas fa-search' },
    { id: 'normal-scan', name: 'Normal Scan', readonly: false, icon: 'fas fa-search-plus' },
    { id: 'load-server', name: 'Browse Data', readonly: false, icon: 'fas fa-database' },
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
    }
    
    // Handle microscope control layer - stop live video when hidden
    if (layerId === 'microscope-control') {
      const layer = layers.find(l => l.id === layerId);
      if (layer && layer.visible && isWebRtcActive) {
        // Layer is currently visible and we're disabling it, stop live video
        console.log('[LayerPanel] Microscope control layer hidden, stopping live video');
        if (toggleWebRtcStream) {
          toggleWebRtcStream();
        }
      }
    }
    
    // Handle exiting historical data mode when Browse Data layer is disabled
    if (layerId !== 'well-plate' && layerId !== 'microscope-control') {
      const layer = layers.find(l => l.id === layerId);
      if (layer && layer.type === 'load-server' && isHistoricalDataMode) {
        // Check if we're disabling the layer (it was visible and now will be hidden)
        if (layer.visible) {
          // Layer is currently visible and we're disabling it, exit historical data mode
          if (setIsHistoricalDataMode) {
            setIsHistoricalDataMode(false);
          }
        }
      }
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

  const createLayer = async (layerType) => {
    const layerTypeConfig = layerTypes.find(lt => lt.id === layerType);
    if (!layerTypeConfig) {
      console.error(`[LayerPanel] Layer type not found: ${layerType}`);
      return;
    }

    console.log(`[LayerPanel] Creating layer of type: ${layerType}`);

    // Generate layer name based on type and sample ID
    let layerName;
    if (layerType === 'quick-scan' || layerType === 'normal-scan') {
      // Fetch sample information from incubator service
      let sampleId = null;
      
      if (incubatorControlService && !isSimulatedMicroscope) {
        try {
          const allSlotInfo = await incubatorControlService.get_slot_information();
          const loadedSample = allSlotInfo?.find(slot => 
            slot.location === 'microscope1' || slot.location === 'microscope2'
          );
          if (loadedSample?.name) {
            sampleId = loadedSample.name;
            console.log(`[LayerPanel] Found loaded sample: ${sampleId}`);
          }
        } catch (error) {
          console.log(`[LayerPanel] Failed to fetch incubator info:`, error);
        }
      }
      
      if (sampleId) {
        // Clean up the sample ID for better readability
        const cleanSampleId = sampleId.replace(/[^a-zA-Z0-9]/g, '_');
        // Add timestamp to make each layer unique (YYYYMMDD-HHMMSS format)
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 8) + '-' + 
                         now.toISOString().replace(/[-:T.]/g, '').slice(9, 15);
        layerName = `${cleanSampleId}_${layerType}_${timestamp}`;
        console.log(`[LayerPanel] Using sample ID for ${layerType}: ${sampleId} -> ${layerName}`);
      } else {
        // Fallback to generic naming if no sample ID found (YYYYMMDD-HHMMSS format)
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 8) + '-' + 
                         now.toISOString().replace(/[-:T.]/g, '').slice(9, 15);
        layerName = `sample_${layerType}_${timestamp}`;
        console.log(`[LayerPanel] No sample ID found for ${layerType}, using generic name: ${layerName}`);
      }
    } else {
      // Use default naming for other layer types
      layerName = `${layerTypeConfig.name} ${layers.length + 1}`;
    }

    // For scan layers, create an actual experiment in the backend and let microscope service handle the layer
    if ((layerType === 'quick-scan' || layerType === 'normal-scan') && !isSimulatedMicroscope && createExperiment) {
      try {
        await createExperiment(layerName);
        if (appendLog) {
          appendLog(`Created experiment for ${layerType}: ${layerName}`);
        }
        // Don't create a UI layer for scan types - let the microscope service experiments be the source of truth
        setShowLayerTypeDropdown(false);
        setNewLayerType('quick-scan');
        return;
      } catch (error) {
        console.error(`Failed to create experiment for ${layerType}:`, error);
        if (showNotification) {
          showNotification(`Failed to create experiment: ${error.message}`, 'error');
        }
        if (appendLog) {
          appendLog(`Failed to create experiment for ${layerType}: ${error.message}`);
        }
        return; // Don't create the layer if experiment creation failed
      }
    }

    // For non-scan layers, create the UI layer as before
    const newLayer = {
      id: `layer-${Date.now()}`,
      name: layerName,
      type: layerType,
      visible: true,
      channels: [],
      readonly: layerTypeConfig.readonly,
      createdAt: new Date().toISOString()
    };

    setLayers(prev => {
      const updatedLayers = [...prev, newLayer];
      console.log(`[LayerPanel] Added layer:`, newLayer);
      console.log(`[LayerPanel] Total layers now:`, updatedLayers.length);
      return updatedLayers;
    });
    setShowLayerTypeDropdown(false);
    setNewLayerType('quick-scan');
    
    // Auto-expand the layer if it's browse data so user can see the action buttons
    if (layerType === 'load-server') {
      console.log(`[LayerPanel] Auto-expanding layer: ${newLayer.id}`);
      setExpandedLayers(prev => ({
        ...prev,
        [newLayer.id]: true
      }));
    }
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

  // Handle layer activation - only for data layers (not well-plate or microscope-control)
  const handleLayerActivation = async (layerId, layerType) => {
    // Skip activation for well-plate and microscope-control layers
    if (layerType === 'plate-view' || layerType === 'microscope-control') {
      return;
    }
    
    // ALWAYS clear any existing active layer first to ensure only one layer is active
    if (activeLayer) {
      console.log(`[LayerPanel] Deactivating previous active layer: ${activeLayer}`);
    }
    
    // Set the active layer
    setActiveLayer(layerId);
    console.log(`[LayerPanel] Activated layer: ${layerId} (${layerType})`);
    
    // For real microscope experiments ONLY, also call setActiveExperimentHandler
    // Browse Data layers are remote data and don't need microscope experiment activation
    if (layerType === 'experiment' && setActiveExperimentHandler) {
      try {
        await setActiveExperimentHandler(layerId);
        console.log(`[LayerPanel] Set active experiment: ${layerId}`);
      } catch (error) {
        console.error(`[LayerPanel] Failed to set active experiment: ${error.message}`);
      }
    }
  };

  // Helper function to check if this is the last selected channel
  const isLastSelectedChannel = (channelName, isEnabled) => {
    if (isHistoricalDataMode || mapViewMode === 'FOV_FITTED') {
      // For zarr channels, check if this is the last enabled channel
      const enabledChannels = availableZarrChannels.filter(ch => zarrChannelConfigs[ch.label]?.enabled);
      return enabledChannels.length === 1 && enabledChannels[0].label === channelName && isEnabled;
    } else {
      // For real microscope channels, check if this is the last visible channel
      const visibleChannels = Object.entries(visibleLayers.channels).filter(([, isVisible]) => isVisible);
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
                  className={`layer-name ${activeLayer === layer.id ? 'layer-name--active' : ''}`}
                  onClick={() => {
                    // Handle layer activation on click
                    handleLayerActivation(layer.id, layer.type);
                    // Also toggle expansion
                    toggleLayerExpansion(layer.id);
                  }}
                  title={layer.type === 'plate-view' || layer.type === 'microscope-control' 
                    ? "Click to expand/collapse channels" 
                    : "Click to activate layer and expand/collapse channels"
                  }
                >
                  <i className={`fas fa-chevron-${expandedLayers[layer.id] ? 'down' : 'right'}`}></i>
                  {activeLayer === layer.id && (
                    <i className="fas fa-star active-indicator" title="Active layer"></i>
                  )}
                  <i className={`${layerTypeConfig?.icon || 'fas fa-layer-group'} layer-type-icon`}></i>
                  <span>
                    {layer.type === 'load-server' && selectedHistoricalDataset 
                      ? (selectedHistoricalDataset.manifest?.name || selectedHistoricalDataset.alias || selectedHistoricalDataset.id)
                      : layer.name
                    }
                  </span>
                  {layer.readonly && <span className="readonly-badge" title="Read-only layer">🔒</span>}
                  {/* Data source status indicator */}
                  {layer.visible && (
                    <span className="data-source-status" title="Currently providing data">
                      <i className="fas fa-circle" style={{color: '#10b981', fontSize: '8px'}}></i>
                    </span>
                  )}
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
                  {layer.type === 'microscope-control' && (
                    <div className="channel-item channel-item--microscope-control">
                      <span className="channel-name">
                        Hardware Control
                        {!layer.visible && <span className="ml-2 text-red-400">🔒 Hardware Locked</span>}
                      </span>
                      <div className="microscope-controls">
                        <button 
                          className="control-btn"
                          onClick={() => setIsControlPanelOpen(!isControlPanelOpen)}
                          title={isControlPanelOpen ? "Close Microscope Controls" : "Open Microscope Controls"}
                          disabled={!layer.visible}
                        >
                          <i className="fas fa-cogs mr-1"></i>
                          {isControlPanelOpen ? "Close Controls" : "Open Controls"}
                        </button>
                        <button 
                          className={`control-btn ${isWebRtcActive ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'}`}
                          onClick={toggleWebRtcStream}
                          title={isWebRtcActive ? "Stop Live Video" : "Start Live Video"}
                          disabled={!layer.visible || !microscopeControlService || currentOperation !== null || microscopeBusy}
                        >
                          <i className="fas fa-video mr-1"></i>
                          {isWebRtcActive ? "Stop Live" : "Start Live"}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Scan layer controls are now handled by microscope service experiments below */}
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
                      <span className="channel-name">
                        {selectedHistoricalDataset 
                          ? (selectedHistoricalDataset.manifest?.name || selectedHistoricalDataset.alias || selectedHistoricalDataset.id)
                          : 'Browse Data'
                        }
                      </span>
                      <div className="server-controls">
                        <button 
                          className="load-btn"
                          onClick={() => {
                            if (setShowBrowseDataModal) {
                              setShowBrowseDataModal(true);
                            }
                          }}
                        >
                          Browse Data
                        </button>
                      </div>
                      
                      {/* Annotation Sublayer */}
                      <div className="channel-item channel-item--annotation">
                        <div className="channel-header">
                          <button
                            className="channel-visibility-btn"
                            onClick={() => {
                              const newVisibility = !(layer.annotationVisible || false);
                              setLayers(prev => prev.map(l => 
                                l.id === layer.id 
                                  ? { ...l, annotationVisible: newVisibility }
                                  : l
                              ));
                              
                              // If enabling annotation layer, activate the parent layer and open annotation dropdown
                              if (newVisibility) {
                                setActiveLayer(layer.id);
                                // Trigger annotation activation through a custom event
                                const event = new CustomEvent('annotationLayerActivated', {
                                  detail: { layerId: layer.id, layerType: layer.type }
                                });
                                window.dispatchEvent(event);
                              } else {
                                // If disabling annotation layer, trigger deactivation event
                                const event = new CustomEvent('annotationLayerDeactivated', {
                                  detail: { layerId: layer.id, layerType: layer.type }
                                });
                                window.dispatchEvent(event);
                              }
                            }}
                            title={layer.annotationVisible ? "Hide annotation layer" : "Show annotation layer"}
                          >
                            <i className={`fas fa-eye${layer.annotationVisible ? '' : '-slash'}`}></i>
                          </button>
                          <span className="channel-name">
                            <i className="fas fa-draw-polygon mr-2 text-blue-400"></i>
                            Annotations
                          </span>
                          <span className="channel-color-indicator" style={{ backgroundColor: '#3B82F6' }}></span>
                        </div>
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
                                    <DualRangeSlider
                                      min={0}
                                      max={255}
                                      value={{ min: config.min || 0, max: config.max || 255 }}
                                      onChange={(newValue) => updateZarrChannelConfig(channel.label, newValue)}
                                      channelColor={channelColor}
                                      className="zarr-contrast-slider"
                                    />
                                    
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
        {!isSimulatedMicroscope && (
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
                      onClick={async () => {
                        // Clear any existing active layer first
                        if (activeLayer && activeLayer !== exp.name) {
                          console.log(`[LayerPanel] Deactivating previous active layer: ${activeLayer}`);
                        }
                        // Update our activeLayer state
                        setActiveLayer(exp.name);
                        // Call the experiment handler for real microscope experiments
                        await setActiveExperimentHandler(exp.name);
                      }}
                      title={isActive ? "Currently active experiment" : "Set as active experiment"}
                    >
                      <i className={`fas fa-star ${activeLayer === exp.name ? 'active-indicator' : ''}`}></i>
                    </button>
                    
                    <div 
                      className={`layer-name ${activeLayer === exp.name ? 'layer-name--active' : ''}`}
                      onClick={() => {
                        // Handle experiment activation on click
                        handleLayerActivation(exp.name, 'experiment');
                        // Also toggle expansion
                        toggleLayerExpansion(exp.name);
                      }}
                      title="Click to activate experiment and expand/collapse channels"
                    >
                      <i className={`fas fa-chevron-${expandedLayers[exp.name] ? 'down' : 'right'}`}></i>
                      <span>
                        {exp.name}
                      </span>
                      {/* Channel count for experiment layers with real microscope channels */}
                      {shouldUseMultiChannelLoading() && !isSimulatedMicroscope && mapViewMode !== 'FOV_FITTED' && (
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
                        <div className="scan-controls">
                          {/* Show Quick Scan button if layer name contains 'quick-scan' or no specific scan type */}
                          {(!exp.name.includes('normal-scan') || exp.name.includes('quick-scan')) && (
                            <button 
                              className="scan-btn"
                              onClick={() => {
                                if (isSimulatedMicroscope) return;
                                // Close normal scan panel if open
                                if (setShowScanConfig) setShowScanConfig(false);
                                // Open quick scan panel
                                if (setShowQuickScanConfig) setShowQuickScanConfig(true);
                              }}
                              disabled={isSimulatedMicroscope}
                              title="Start Quick Scan"
                            >
                              Quick Scan
                            </button>
                          )}
                          {/* Show Normal Scan button if layer name contains 'normal-scan' or no specific scan type */}
                          {(!exp.name.includes('quick-scan') || exp.name.includes('normal-scan')) && (
                            <button 
                              className="scan-btn"
                              onClick={() => {
                                if (isSimulatedMicroscope) return;
                                // Close quick scan panel if open
                                if (setShowQuickScanConfig) setShowQuickScanConfig(false);
                                // Open normal scan panel
                                if (setShowScanConfig) setShowScanConfig(true);
                              }}
                              disabled={isSimulatedMicroscope}
                              title="Configure and Start Normal Scan"
                            >
                              Normal Scan
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Annotation Sublayer for Experiments */}
                      <div className="channel-item channel-item--annotation">
                        <div className="channel-header">
                          <button
                            className="channel-visibility-btn"
                            onClick={() => {
                              const newVisibility = !(exp.annotationVisible || false);
                              // Update experiment annotation visibility (we'll need to track this in parent component)
                              const event = new CustomEvent('experimentAnnotationToggled', {
                                detail: { experimentName: exp.name, annotationVisible: newVisibility }
                              });
                              window.dispatchEvent(event);
                              
                              // If enabling annotation layer, activate the experiment and open annotation dropdown
                              if (newVisibility) {
                                setActiveLayer(exp.name);
                                // Trigger annotation activation through a custom event
                                const activationEvent = new CustomEvent('annotationLayerActivated', {
                                  detail: { layerId: exp.name, layerType: 'experiment' }
                                });
                                window.dispatchEvent(activationEvent);
                              } else {
                                // If disabling annotation layer, trigger deactivation event
                                const deactivationEvent = new CustomEvent('annotationLayerDeactivated', {
                                  detail: { layerId: exp.name, layerType: 'experiment' }
                                });
                                window.dispatchEvent(deactivationEvent);
                              }
                            }}
                            title={exp.annotationVisible ? "Hide annotation layer" : "Show annotation layer"}
                          >
                            <i className={`fas fa-eye${exp.annotationVisible ? '' : '-slash'}`}></i>
                          </button>
                          <span className="channel-name">
                            <i className="fas fa-draw-polygon mr-2 text-blue-400"></i>
                            Annotations
                          </span>
                          <span className="channel-color-indicator" style={{ backgroundColor: '#3B82F6' }}></span>
                        </div>
                      </div>
                      
                      {/* Real Microscope Channel Controls for this experiment */}
                      {!isSimulatedMicroscope && mapViewMode !== 'FOV_FITTED' && (
                        <div className="experiment-channels">
                          {Object.entries(visibleLayers.channels).map(([channel, isVisible]) => {
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
                                    {(() => {
                                      // Create unique layer ID for this experiment-channel combination
                                      const layerId = `${exp.name}-${channel}`;
                                      const layerContrast = getLayerContrastSettings(layerId);
                                      
                                      return (
                                        <>
                                          <DualRangeSlider
                                            min={0}
                                            max={255}
                                            value={{ min: layerContrast.min || 0, max: layerContrast.max || 255 }}
                                            onChange={(newValue) => {
                                              updateLayerContrastSettings(layerId, newValue);
                                              updateRealMicroscopeChannelConfigWithRefresh(channel, newValue);
                                            }}
                                            channelColor={channelColor}
                                            className="real-microscope-contrast-slider"
                                          />
                                          
                                          <div className="contrast-reset">
                                            <button
                                              onClick={() => {
                                                updateLayerContrastSettings(layerId, { min: 0, max: 255 });
                                                updateRealMicroscopeChannelConfigWithRefresh(channel, { min: 0, max: 255 });
                                              }}
                                              className="reset-btn"
                                            >
                                              Reset to defaults
                                            </button>
                                          </div>
                                        </>
                                      );
                                    })()}
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

    </div>
  );
};

LayerPanel.propTypes = {
  // Map Layers props
  visibleLayers: PropTypes.object.isRequired,
  setVisibleLayers: PropTypes.func.isRequired,
  
  // Experiments props
  isSimulatedMicroscope: PropTypes.bool,
  isLoadingExperiments: PropTypes.bool,
  activeExperiment: PropTypes.string,
  experiments: PropTypes.array,
  setActiveExperimentHandler: PropTypes.func,
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
  updateRealMicroscopeChannelConfig: PropTypes.func,
  
  // Per-layer contrast settings
  layerContrastSettings: PropTypes.object,
  updateLayerContrastSettings: PropTypes.func,
  getLayerContrastSettings: PropTypes.func,
  
  // Multi-Layer Experiments props
  visibleExperiments: PropTypes.array,
  setVisibleExperiments: PropTypes.func,
  
  // Experiment creation props
  microscopeControlService: PropTypes.object,
  createExperiment: PropTypes.func,
  showNotification: PropTypes.func,
  appendLog: PropTypes.func,
  
  // Incubator service for fetching sample info
  incubatorControlService: PropTypes.object,
  
  // Layout props
  isFovFittedMode: PropTypes.bool,
  
  // Scan configuration props
  showScanConfig: PropTypes.bool,
  setShowScanConfig: PropTypes.func,
  showQuickScanConfig: PropTypes.bool,
  setShowQuickScanConfig: PropTypes.func,
  
  // Browse data modal props
  setShowBrowseDataModal: PropTypes.func,
  
  // Historical data mode props
  isHistoricalDataMode: PropTypes.bool,
  setIsHistoricalDataMode: PropTypes.func,
  
  // Layer management props
  layers: PropTypes.array.isRequired,
  setLayers: PropTypes.func.isRequired,
  expandedLayers: PropTypes.object.isRequired,
  setExpandedLayers: PropTypes.func.isRequired,
  
  // Dropdown control props
  setIsLayerDropdownOpen: PropTypes.func,
  
  // Microscope control props
  isControlPanelOpen: PropTypes.bool,
  setIsControlPanelOpen: PropTypes.func,
  
  // Live video props
  isWebRtcActive: PropTypes.bool,
  toggleWebRtcStream: PropTypes.func,
  currentOperation: PropTypes.string,
  microscopeBusy: PropTypes.bool,
  
  // Historical dataset props
  selectedHistoricalDataset: PropTypes.object,
  
  // Layer activation props
  activeLayer: PropTypes.string,
  setActiveLayer: PropTypes.func
};

export default LayerPanel;
