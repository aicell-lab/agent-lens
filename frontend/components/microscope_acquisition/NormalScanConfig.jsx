import React from 'react';
import { useValidatedNumberInput, getInputValidationClasses } from '../../utils';
import './NormalScanConfig.css';

const NormalScanConfig = ({
  // State props
  showScanConfig,
  setShowScanConfig,
  scanParameters,
  setScanParameters,
  isScanInProgress,
  setIsScanInProgress,
  activeExperiment,
  wellPaddingMm,
  wellPlateType,
  selectedWells,
  setSelectedWells,
  isRectangleSelection,
  setIsRectangleSelection,
  rectangleStart,
  setRectangleStart,
  rectangleEnd,
  setRectangleEnd,
  dragSelectedWell,
  setDragSelectedWell,
  gridSelectedCells,
  setGridSelectedCells,
  gridDragStart,
  setGridDragStart,
  gridDragEnd,
  setGridDragEnd,
  isGridDragging,
  setIsGridDragging,
  visibleLayers,
  setVisibleLayers,
  refreshScanResults,
  
  // Service props
  microscopeControlService,
  appendLog,
  showNotification,
  isWebRtcActive,
  toggleWebRtcStream,
  setMicroscopeBusy,
  setCurrentOperation,
  
  // Input validation hooks
  startXInput,
  startYInput,
  nxInput,
  nyInput,
  dxInput,
  dyInput,
  
  // Helper functions
  getWellPlateGridLabels,
  getWellIdFromIndex,
  loadCurrentMicroscopeSettings
}) => {
  if (!showScanConfig) return null;

  const handleGridCellMouseDown = (rowIdx, colIdx) => {
    if (isScanInProgress) return;
    setGridDragStart({ row: rowIdx, col: colIdx });
    setGridDragEnd({ row: rowIdx, col: colIdx });
    setIsGridDragging(true);
  };

  const handleGridCellMouseEnter = (rowIdx, colIdx) => {
    if (isScanInProgress || !isGridDragging) return;
    setGridDragEnd({ row: rowIdx, col: colIdx });
  };

  const handleMouseUp = () => {
    if (!isGridDragging) return;
    
    const start = gridDragStart;
    const end = gridDragEnd;
    
    if (start && end) {
      const minRow = Math.min(start.row, end.row);
      const maxRow = Math.max(start.row, end.row);
      const minCol = Math.min(start.col, end.col);
      const maxCol = Math.max(start.col, end.col);
      
      const newSelectedCells = {};
      const newSelectedWells = [];
      
      for (let row = minRow; row <= maxRow; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const cellKey = `${row}-${col}`;
          newSelectedCells[cellKey] = true;
          const wellId = getWellIdFromIndex(row, col);
          if (wellId && !newSelectedWells.includes(wellId)) {
            newSelectedWells.push(wellId);
          }
        }
      }
      
      setGridSelectedCells(newSelectedCells);
      setSelectedWells(newSelectedWells);
    }
    
    setIsGridDragging(false);
    setGridDragStart(null);
    setGridDragEnd(null);
  };

  // Add event listeners for mouse up
  React.useEffect(() => {
    if (isGridDragging) {
      document.addEventListener('mouseup', handleMouseUp);
      return () => document.removeEventListener('mouseup', handleMouseUp);
    }
  }, [isGridDragging, gridDragStart, gridDragEnd]);

  return (
    <div className="normal-scan-config-panel">
      <div className="normal-scan-config-header">
        <h3 className="normal-scan-config-title">
          <i className="fas fa-search mr-2"></i>
          Scan Configuration
        </h3>
        <button
          onClick={() => {
            setShowScanConfig(false);
            setIsRectangleSelection(false);
            setRectangleStart(null);
            setRectangleEnd(null);
            setDragSelectedWell(null);
            // Clean up grid drawing states
            setGridDragStart(null);
            setGridDragEnd(null);
            setIsGridDragging(false);
          }}
          className="normal-scan-config-close"
          title="Close"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      <div className="normal-scan-config-content">
        {/* Multi-well Selection Grid UI */}
        <div className="scan-well-plate-grid-container">
          <div className="flex flex-col w-full items-center">
            <div className="flex w-full items-center mb-1">
              <span className="text-xs text-gray-300 mr-2">Selected: {selectedWells.length}</span>
              <button
                onClick={() => setSelectedWells([])}
                className="ml-auto px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                title="Clear all well selections"
                disabled={selectedWells.length === 0}
              >
                <i className="fas fa-refresh mr-1"></i>Refresh
              </button>
            </div>
            <div className="scan-well-plate-grid">
              <div className="scan-grid-col-labels">
                <div></div>
                {getWellPlateGridLabels().cols.map((label, colIdx) => (
                  <div key={`col-${label}`} className="scan-grid-label">{label}</div>
                ))}
              </div>
              {getWellPlateGridLabels().rows.map((rowLabel, rowIdx) => (
                <div key={`row-${rowIdx}`} className="scan-grid-row">
                  <div className="scan-grid-label">{rowLabel}</div>
                  {getWellPlateGridLabels().cols.map((colLabel, colIdx) => {
                    const wellId = getWellIdFromIndex(rowIdx, colIdx);
                    const isSelected = selectedWells.includes(wellId);
                    const isDragSelected = gridSelectedCells[`${rowIdx}-${colIdx}`];
                    return (
                      <div
                        key={`cell-${rowIdx}-${colIdx}`}
                        className={`scan-grid-cell${isSelected || isDragSelected ? ' selected' : ''}`}
                        onMouseDown={() => handleGridCellMouseDown(rowIdx, colIdx)}
                        onMouseEnter={() => handleGridCellMouseEnter(rowIdx, colIdx)}
                        style={{ userSelect: 'none' }}
                      >
                        {/* Optionally show wellId or leave blank for cleaner look */}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="normal-scan-config-sections">
          {/* Position Configuration */}
          <div className="normal-scan-config-section">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-crosshairs mr-1"></i>
              Position Configuration
            </div>
            <div className="normal-scan-config-row">
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">Start X (mm)</label>
                <input
                  type="number"
                  value={startXInput.inputValue}
                  onChange={startXInput.handleInputChange}
                  onKeyDown={startXInput.handleKeyDown}
                  onBlur={startXInput.handleBlur}
                  className={getInputValidationClasses(
                    startXInput.isValid,
                    startXInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  step="0.1"
                  disabled={isScanInProgress}
                  placeholder="X position"
                />
              </div>
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">Start Y (mm)</label>
                <input
                  type="number"
                  value={startYInput.inputValue}
                  onChange={startYInput.handleInputChange}
                  onKeyDown={startYInput.handleKeyDown}
                  onBlur={startYInput.handleBlur}
                  className={getInputValidationClasses(
                    startYInput.isValid,
                    startYInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  step="0.1"
                  disabled={isScanInProgress}
                  placeholder="Y position"
                />
              </div>
            </div>
          </div>

          {/* Grid Configuration */}
          <div className="normal-scan-config-section">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-th mr-1"></i>
              Grid Configuration
            </div>
            <div className="normal-scan-config-row">
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">Nx (positions)</label>
                <input
                  type="number"
                  value={nxInput.inputValue}
                  onChange={nxInput.handleInputChange}
                  onKeyDown={nxInput.handleKeyDown}
                  onBlur={nxInput.handleBlur}
                  className={getInputValidationClasses(
                    nxInput.isValid,
                    nxInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  min="1"
                  disabled={isScanInProgress}
                  placeholder="Nx"
                />
              </div>
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">Ny (positions)</label>
                <input
                  type="number"
                  value={nyInput.inputValue}
                  onChange={nyInput.handleInputChange}
                  onKeyDown={nyInput.handleKeyDown}
                  onBlur={nyInput.handleBlur}
                  className={getInputValidationClasses(
                    nyInput.isValid,
                    nyInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  min="1"
                  disabled={isScanInProgress}
                  placeholder="Ny"
                />
              </div>
            </div>
            <div className="normal-scan-config-row">
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">dX (mm)</label>
                <input
                  type="number"
                  value={dxInput.inputValue}
                  onChange={dxInput.handleInputChange}
                  onKeyDown={dxInput.handleKeyDown}
                  onBlur={dxInput.handleBlur}
                  className={getInputValidationClasses(
                    dxInput.isValid,
                    dxInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  step="0.1"
                  min="0.1"
                  disabled={isScanInProgress}
                  placeholder="dX step"
                />
              </div>
              <div className="normal-scan-config-input-group">
                <label className="normal-scan-config-label">dY (mm)</label>
                <input
                  type="number"
                  value={dyInput.inputValue}
                  onChange={dyInput.handleInputChange}
                  onKeyDown={dyInput.handleKeyDown}
                  onBlur={dyInput.handleBlur}
                  className={getInputValidationClasses(
                    dyInput.isValid,
                    dyInput.hasUnsavedChanges,
                    "normal-scan-config-input"
                  )}
                  step="0.1"
                  min="0.1"
                  disabled={isScanInProgress}
                  placeholder="dY step"
                />
              </div>
            </div>
          </div>

          {/* Illumination Channels */}
          <div className="normal-scan-config-section normal-scan-config-section--highlighted">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-lightbulb mr-1"></i>
              Illumination Channels
            </div>
            <div className="normal-scan-config-channels-controls">
              <button
                onClick={() => {
                  if (isScanInProgress) return;
                  loadCurrentMicroscopeSettings();
                }}
                className="normal-scan-config-button normal-scan-config-button--secondary"
                disabled={isScanInProgress || !microscopeControlService}
                title="Load current microscope settings"
              >
                <i className="fas fa-download mr-1"></i>
                Load Current
              </button>
              <button
                onClick={() => {
                  if (isScanInProgress) return;
                  // Find a channel that's not already in use
                  const availableChannels = [
                    'BF LED matrix full',
                    'Fluorescence 405 nm Ex',
                    'Fluorescence 488 nm Ex',
                    'Fluorescence 561 nm Ex',
                    'Fluorescence 638 nm Ex',
                    'Fluorescence 730 nm Ex'
                  ];
                  const usedChannels = scanParameters.illumination_settings.map(s => s.channel);
                  const nextChannel = availableChannels.find(c => !usedChannels.includes(c)) || 'BF LED matrix full';
                  
                  setScanParameters(prev => ({
                    ...prev,
                    illumination_settings: [
                      ...prev.illumination_settings,
                      {
                        channel: nextChannel,
                        intensity: 50,
                        exposure_time: 100
                      }
                    ]
                  }));
                }}
                className="normal-scan-config-button normal-scan-config-button--secondary"
                disabled={isScanInProgress || scanParameters.illumination_settings.length >= 6}
                title="Add channel"
              >
                <i className="fas fa-plus mr-1"></i>
                Add Channel
              </button>
            </div>
            
            <div className="normal-scan-config-channels-list">
              {scanParameters.illumination_settings.map((setting, index) => (
                <div key={index} className="normal-scan-config-channel-item">
                  <div className="normal-scan-config-channel-header">
                    <span className="normal-scan-config-channel-label">Channel {index + 1}</span>
                    <button
                      onClick={() => {
                        if (isScanInProgress || scanParameters.illumination_settings.length <= 1) return;
                        setScanParameters(prev => ({
                          ...prev,
                          illumination_settings: prev.illumination_settings.filter((_, i) => i !== index)
                        }));
                      }}
                      className="normal-scan-config-button normal-scan-config-button--danger"
                      disabled={isScanInProgress || scanParameters.illumination_settings.length <= 1}
                      title="Remove channel"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  
                  <div className="normal-scan-config-channel-settings">
                    <div className="normal-scan-config-channel-select-container">
                      <select
                        value={setting.channel}
                        onChange={(e) => {
                          if (isScanInProgress) return;
                          setScanParameters(prev => ({
                            ...prev,
                            illumination_settings: prev.illumination_settings.map((s, i) => 
                              i === index ? { ...s, channel: e.target.value } : s
                            )
                          }));
                        }}
                        className={`normal-scan-config-select ${
                          scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1 
                            ? 'normal-scan-config-select--warning' 
                            : ''
                        }`}
                        disabled={isScanInProgress}
                      >
                        <option value="BF LED matrix full">BF LED matrix full</option>
                        <option value="Fluorescence 405 nm Ex">Fluorescence 405 nm Ex</option>
                        <option value="Fluorescence 488 nm Ex">Fluorescence 488 nm Ex</option>
                        <option value="Fluorescence 561 nm Ex">Fluorescence 561 nm Ex</option>
                        <option value="Fluorescence 638 nm Ex">Fluorescence 638 nm Ex</option>
                        <option value="Fluorescence 730 nm Ex">Fluorescence 730 nm Ex</option>
                      </select>
                      {scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1 && (
                        <div className="normal-scan-config-warning-icon">
                          <i className="fas fa-exclamation-triangle" title="Duplicate channel detected"></i>
                        </div>
                      )}
                    </div>
                    
                    <div className="normal-scan-config-row">
                      <div className="normal-scan-config-input-group">
                        <input
                          type="number"
                          value={setting.intensity}
                          onChange={(e) => {
                            if (isScanInProgress) return;
                            const value = parseInt(e.target.value) || 0;
                            if (value >= 1 && value <= 100) {
                              setScanParameters(prev => ({
                                ...prev,
                                illumination_settings: prev.illumination_settings.map((s, i) => 
                                  i === index ? { ...s, intensity: value } : s
                                )
                              }));
                            }
                          }}
                          className="normal-scan-config-input"
                          min="1"
                          max="100"
                          disabled={isScanInProgress}
                          placeholder="Intensity %"
                        />
                      </div>
                      <div className="normal-scan-config-input-group">
                        <input
                          type="number"
                          value={setting.exposure_time}
                          onChange={(e) => {
                            if (isScanInProgress) return;
                            const value = parseInt(e.target.value) || 0;
                            if (value >= 1 && value <= 1000) {
                              setScanParameters(prev => ({
                                ...prev,
                                illumination_settings: prev.illumination_settings.map((s, i) => 
                                  i === index ? { ...s, exposure_time: value } : s
                                )
                              }));
                            }
                          }}
                          className="normal-scan-config-input"
                          min="1"
                          max="1000"
                          disabled={isScanInProgress}
                          placeholder="Exposure ms"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            {scanParameters.illumination_settings.length > 1 && (
              <div className="normal-scan-config-info-box">
                <div className="normal-scan-config-info-header">
                  <i className="fas fa-info-circle mr-1"></i>
                  Multi-channel Acquisition
                </div>
                <div className="normal-scan-config-info-content">
                  Channels: {scanParameters.illumination_settings.map(s => 
                    s.channel.replace('Fluorescence ', '').replace(' Ex', '').replace('BF LED matrix full', 'BF')
                  ).join(', ')}
                </div>
                {scanParameters.illumination_settings.some((setting, index) => 
                  scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1
                ) && (
                  <div className="normal-scan-config-warning">
                    <i className="fas fa-exclamation-triangle mr-1"></i>
                    Warning: Duplicate channels detected
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Autofocus Options */}
          <div className="normal-scan-config-section">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-bullseye mr-1"></i>
              Autofocus Options
            </div>
            <div className="normal-scan-config-checkbox-group">
              <label className="normal-scan-config-checkbox">
                <input
                  type="checkbox"
                  checked={scanParameters.do_contrast_autofocus}
                  onChange={(e) => setScanParameters(prev => ({ ...prev, do_contrast_autofocus: e.target.checked }))}
                  disabled={isScanInProgress}
                />
                <span>Contrast AF</span>
              </label>
              <label className="normal-scan-config-checkbox">
                <input
                  type="checkbox"
                  checked={scanParameters.do_reflection_af}
                  onChange={(e) => setScanParameters(prev => ({ ...prev, do_reflection_af: e.target.checked }))}
                  disabled={isScanInProgress}
                />
                <span>Reflection AF</span>
              </label>
            </div>
          </div>

          {/* Upload Settings */}
          <div className="normal-scan-config-section">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-cloud-upload-alt mr-1"></i>
              Upload Settings
            </div>
            <label className="normal-scan-config-checkbox">
              <input
                type="checkbox"
                checked={scanParameters.uploading}
                onChange={(e) => setScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                disabled={isScanInProgress}
              />
              <span>Upload after scanning</span>
              <i className="fas fa-question-circle normal-scan-config-help" title="Enable background upload of scan data to artifact manager during scanning"></i>
            </label>
          </div>

          {/* Scan Info */}
          <div className="normal-scan-config-section normal-scan-config-section--info">
            <div className="normal-scan-config-section-header">
              <i className="fas fa-info-circle mr-1"></i>
              Scan Information
            </div>
            <div className="normal-scan-config-info-list">
              <div>Total scan area: {(scanParameters.Nx * scanParameters.dx_mm).toFixed(1)} × {(scanParameters.Ny * scanParameters.dy_mm).toFixed(1)} mm</div>
              <div>Total positions: {scanParameters.Nx * scanParameters.Ny}</div>
              <div>Channels: {scanParameters.illumination_settings.length}</div>
              <div>Total images: {scanParameters.Nx * scanParameters.Ny * scanParameters.illumination_settings.length}</div>
              <div>End position: ({(scanParameters.start_x_mm + (scanParameters.Nx-1) * scanParameters.dx_mm).toFixed(1)}, {(scanParameters.start_y_mm + (scanParameters.Ny-1) * scanParameters.dy_mm).toFixed(1)}) mm</div>
            </div>
          </div>

          {/* Rectangle Selection Info */}
          {isRectangleSelection && (
            <div className="normal-scan-config-info-box normal-scan-config-info-box--highlight">
              <i className="fas fa-vector-square mr-1"></i>
              Drag on the map to select scan area. Current settings will be used as defaults.
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="normal-scan-config-actions">
          <button
            onClick={() => {
              if (isScanInProgress) return;
              if (isRectangleSelection) {
                // Stop rectangle selection
                setIsRectangleSelection(false);
                setRectangleStart(null);
                setRectangleEnd(null);
                setDragSelectedWell(null);
              } else {
                // Start rectangle selection - clear any existing selection first
                setRectangleStart(null);
                setRectangleEnd(null);
                setDragSelectedWell(null);
                setIsRectangleSelection(true);
              }
            }}
            className={`normal-scan-config-button ${
              isRectangleSelection ? 'normal-scan-config-button--active' : 'normal-scan-config-button--secondary'
            }`}
            disabled={isScanInProgress}
          >
            <i className="fas fa-vector-square mr-1"></i>
            {isRectangleSelection ? 'Stop Selection' : 'Select Area'}
          </button>
          <button
            onClick={async () => {
              if (!microscopeControlService) return;
              
              if (isScanInProgress) {
                // Stop scan logic using new unified API
                try {
                  if (appendLog) appendLog('Cancelling scan...');
                  
                  const result = await microscopeControlService.scan_cancel();
                  
                  if (result.success) {
                    if (showNotification) showNotification('Scan cancelled successfully', 'success');
                    if (appendLog) appendLog('Scan cancelled - operation interrupted');
                    // Note: scan state will be updated by status polling, no need to manually reset
                    if (setMicroscopeBusy) setMicroscopeBusy(false);
                    if (setCurrentOperation) setCurrentOperation(null); // Re-enable sidebar
                  } else {
                    if (showNotification) showNotification(`Failed to cancel scan: ${result.message}`, 'error');
                    if (appendLog) appendLog(`Failed to cancel scan: ${result.message}`);
                  }
                } catch (error) {
                  if (showNotification) showNotification(`Error cancelling scan: ${error.message}`, 'error');
                  if (appendLog) appendLog(`Error cancelling scan: ${error.message}`);
                }
                return;
              }
              
              // Check if WebRTC is active and stop it to prevent camera resource conflict
              const wasWebRtcActive = isWebRtcActive;
              if (wasWebRtcActive) {
                if (appendLog) appendLog('Stopping WebRTC stream to prevent camera resource conflict during scanning...');
                try {
                  if (toggleWebRtcStream) {
                    toggleWebRtcStream(); // This will stop the WebRTC stream
                    // Wait a moment for the stream to fully stop
                    await new Promise(resolve => setTimeout(resolve, 500));
                  } else {
                    if (appendLog) appendLog('Warning: toggleWebRtcStream function not available, proceeding with scan...');
                  }
                } catch (webRtcError) {
                  if (appendLog) appendLog(`Warning: Failed to stop WebRTC stream: ${webRtcError.message}. Proceeding with scan...`);
                }
              }
              
              // Note: scan state will be managed by status polling, but we set busy states immediately
              if (setMicroscopeBusy) setMicroscopeBusy(true); // Set global busy state
              if (setCurrentOperation) setCurrentOperation('scanning'); // Disable sidebar during scanning
              
              // Disable rectangle selection during scanning to allow map browsing
              setIsRectangleSelection(false);
              setRectangleStart(null);
              setRectangleEnd(null);
              
              try {
                if (appendLog) {
                  const channelNames = scanParameters.illumination_settings.map(s => s.channel).join(', ');
                  appendLog(`Starting scan: ${scanParameters.Nx}×${scanParameters.Ny} positions from (${scanParameters.start_x_mm.toFixed(1)}, ${scanParameters.start_y_mm.toFixed(1)}) mm`);
                  appendLog(`Channels: ${channelNames}`);
                }
                
                // Use new unified scan API
                const result = await microscopeControlService.scan_start({
                  saved_data_type: "full_zarr",
                  action_ID: 'scan_' + Date.now(),
                  start_x_mm: scanParameters.start_x_mm,
                  start_y_mm: scanParameters.start_y_mm,
                  Nx: scanParameters.Nx,
                  Ny: scanParameters.Ny,
                  dx_mm: scanParameters.dx_mm,
                  dy_mm: scanParameters.dy_mm,
                  illumination_settings: scanParameters.illumination_settings,
                  wells_to_scan: selectedWells,
                  well_plate_type: wellPlateType,
                  well_padding_mm: wellPaddingMm,
                  experiment_name: activeExperiment,
                  uploading: scanParameters.uploading,
                  do_contrast_autofocus: scanParameters.do_contrast_autofocus,
                  do_reflection_af: scanParameters.do_reflection_af,
                  timepoint: 0
                });
                
                if (result.success) {
                  if (showNotification) showNotification('Scan started successfully', 'success');
                  if (appendLog) {
                    appendLog('Scan started - monitoring progress via status polling');
                    if (wasWebRtcActive) {
                      appendLog('Note: WebRTC stream was stopped for scanning. Click "Start Live" to resume video stream if needed.');
                    }
                  }
                  // Close scan config panel
                  setShowScanConfig(false);
                  setIsRectangleSelection(false);
                  setRectangleStart(null);
                  setRectangleEnd(null);
                  // Enable scan results layer if not already
                  setVisibleLayers(prev => ({ ...prev, scanResults: true }));
                  
                  // Note: scan completion and results refresh will be handled by status polling
                } else {
                  if (showNotification) showNotification(`Failed to start scan: ${result.error_message || result.message}`, 'error');
                  if (appendLog) appendLog(`Failed to start scan: ${result.error_message || result.message}`);
                  // Reset busy states since scan didn't start
                  if (setMicroscopeBusy) setMicroscopeBusy(false);
                  if (setCurrentOperation) setCurrentOperation(null);
                }
              } catch (error) {
                if (showNotification) showNotification(`Error starting scan: ${error.message}`, 'error');
                if (appendLog) appendLog(`Error starting scan: ${error.message}`);
                // Reset busy states on error
                if (setMicroscopeBusy) setMicroscopeBusy(false);
                if (setCurrentOperation) setCurrentOperation(null);
              }
            }}
            className={`normal-scan-config-button ${
              isScanInProgress ? 'normal-scan-config-button--stop' : 'normal-scan-config-button--start'
            }`}
            disabled={!microscopeControlService}
          >
            {isScanInProgress ? (
              <>
                <i className="fas fa-stop mr-1"></i>
                Stop Scan
              </>
            ) : (
              <>
                <i className="fas fa-play mr-1"></i>
                Start Scan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NormalScanConfig;
