import React from 'react';
import PropTypes from 'prop-types';
import { useValidatedNumberInput, getInputValidationClasses } from '../../../utils';
import WellPlateGrid from './WellPlateGrid';

const ScanConfiguration = ({
  isOpen,
  onClose,
  scanParameters,
  setScanParameters,
  isScanInProgress,
  selectedWells,
  setSelectedWells,
  isRectangleSelection,
  setIsRectangleSelection,
  setRectangleStart,
  setRectangleEnd,
  setDragSelectedWell,
  gridDragStart,
  setGridDragStart,
  gridDragEnd,
  setGridDragEnd,
  isGridDragging,
  setIsGridDragging,
  gridSelectedCells,
  getWellPlateGridLabels,
  getWellIdFromIndex,
  handleGridCellMouseDown,
  handleGridCellMouseEnter,
  handleMouseUp,
  loadCurrentMicroscopeSettings,
  microscopeControlService,
  scanBounds,
  validateStartPosition,
  validateGridSize,
  showNotification,
  activeExperiment,
  wellPlateType,
  wellPaddingMm,
  refreshScanResults,
  setVisibleLayers,
  appendLog,
  showNotification: showNotificationProp,
  toggleWebRtcStream,
  isWebRtcActive,
  setMicroscopeBusy,
  setCurrentOperation
}) => {
  // Validation hooks for scan parameters with "Enter to confirm" behavior
  const startXInput = useValidatedNumberInput(
    scanParameters.start_x_mm,
    (value) => setScanParameters(prev => ({ ...prev, start_x_mm: value })),
    { 
      min: scanBounds.xMin, 
      max: scanBounds.xMax, 
      allowFloat: true,
      customValidation: (value) => validateStartPosition(value, true)
    },
    showNotification
  );

  const startYInput = useValidatedNumberInput(
    scanParameters.start_y_mm,
    (value) => setScanParameters(prev => ({ ...prev, start_y_mm: value })),
    { 
      min: scanBounds.yMin, 
      max: scanBounds.yMax, 
      allowFloat: true,
      customValidation: (value) => validateStartPosition(value, false)
    },
    showNotification
  );

  const nxInput = useValidatedNumberInput(
    scanParameters.Nx,
    (value) => setScanParameters(prev => ({ ...prev, Nx: value })),
    { 
      min: 1, 
      max: 50, 
      allowFloat: false,
      customValidation: (value) => validateGridSize(value, true)
    },
    showNotification
  );

  const nyInput = useValidatedNumberInput(
    scanParameters.Ny,
    (value) => setScanParameters(prev => ({ ...prev, Ny: value })),
    { 
      min: 1, 
      max: 50, 
      allowFloat: false,
      customValidation: (value) => validateGridSize(value, false)
    },
    showNotification
  );

  const dxInput = useValidatedNumberInput(
    scanParameters.dx_mm,
    (value) => setScanParameters(prev => ({ ...prev, dx_mm: value })),
    { min: 0.01, max: 10, allowFloat: true },
    showNotification
  );

  const dyInput = useValidatedNumberInput(
    scanParameters.dy_mm,
    (value) => setScanParameters(prev => ({ ...prev, dy_mm: value })),
    { min: 0.01, max: 10, allowFloat: true },
    showNotification
  );

  const handleStartScan = async () => {
    if (!microscopeControlService) return;
    
    if (isScanInProgress) {
      // Stop scan logic
      try {
        if (appendLog) appendLog('Stopping scan...');
        
        const result = await microscopeControlService.stop_scan_and_stitching();
        
        if (result.success) {
          if (showNotification) showNotification('Scan stop requested', 'success');
          if (appendLog) appendLog('Scan stop requested - scan will be interrupted');
          // Note: State updates are handled by parent component
        } else {
          if (showNotification) showNotification(`Failed to stop scan: ${result.message}`, 'error');
          if (appendLog) appendLog(`Failed to stop scan: ${result.message}`);
        }
      } catch (error) {
        if (showNotification) showNotification(`Error stopping scan: ${error.message}`, 'error');
        if (appendLog) appendLog(`Error stopping scan: ${error.message}`);
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
    
    // Note: State updates are handled by parent component
    // This function just triggers the scan logic
    if (appendLog) {
      const channelNames = scanParameters.illumination_settings.map(s => s.channel).join(', ');
      appendLog(`Starting scan: ${scanParameters.Nx}×${scanParameters.Ny} positions from (${scanParameters.start_x_mm.toFixed(1)}, ${scanParameters.start_y_mm.toFixed(1)}) mm`);
      appendLog(`Channels: ${channelNames}`);
    }
    
    try {
      const result = await microscopeControlService.normal_scan_with_stitching(
        scanParameters.start_x_mm,
        scanParameters.start_y_mm,
        scanParameters.Nx,
        scanParameters.Ny,
        scanParameters.dx_mm,
        scanParameters.dy_mm,
        scanParameters.illumination_settings,
        scanParameters.do_contrast_autofocus,
        scanParameters.do_reflection_af,
        'scan_' + Date.now(),
        0, // timepoint index
        activeExperiment, // experiment_name parameter
        selectedWells, // <-- now supports multi-well
        wellPlateType, // wellplate_type parameter
        wellPaddingMm, // well_padding_mm parameter
        scanParameters.uploading // uploading parameter
      );
      
      if (result.success) {
        if (showNotification) showNotification('Scan completed successfully', 'success');
        if (appendLog) {
          appendLog('Scan completed successfully');
          if (wasWebRtcActive) {
            appendLog('Note: WebRTC stream was stopped for scanning. Click "Start Live" to resume video stream if needed.');
          }
        }
        // Note: UI state updates are handled by parent component
        setVisibleLayers(prev => ({ ...prev, scanResults: true }));
        
        // Refresh scan results display once after completion
        setTimeout(() => {
          refreshScanResults();
        }, 1000); // Wait 1 second then refresh
      } else {
        if (showNotification) showNotification(`Scan failed: ${result.message}`, 'error');
        if (appendLog) appendLog(`Scan failed: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Scan error: ${error.message}`, 'error');
      if (appendLog) appendLog(`Scan error: ${error.message}`);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-12 right-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 z-50 text-white scan-config-panel">
      <div className="flex items-center justify-between p-3 border-b border-gray-600 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-200">Scan Configuration</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1"
          title="Close"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      <div className="p-3 scan-config-content">
        {/* Multi-well Selection Grid */}
        <WellPlateGrid
          selectedWells={selectedWells}
          setSelectedWells={setSelectedWells}
          gridDragStart={gridDragStart}
          setGridDragStart={setGridDragStart}
          gridDragEnd={gridDragEnd}
          setGridDragEnd={setGridDragEnd}
          isGridDragging={isGridDragging}
          setIsGridDragging={setIsGridDragging}
          gridSelectedCells={gridSelectedCells}
          getWellPlateGridLabels={getWellPlateGridLabels}
          getWellIdFromIndex={getWellIdFromIndex}
          handleGridCellMouseDown={handleGridCellMouseDown}
          handleGridCellMouseEnter={handleGridCellMouseEnter}
          handleMouseUp={handleMouseUp}
        />

        <div className="space-y-2 text-xs">
          {/* Start Position */}
          <div>
            <label className="block text-gray-300 font-medium mb-1">Start Position (mm)</label>
            <div className="flex space-x-2">
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={startXInput.inputValue}
                  onChange={startXInput.handleInputChange}
                  onKeyDown={startXInput.handleKeyDown}
                  onBlur={startXInput.handleBlur}
                  className={getInputValidationClasses(
                    startXInput.isValid,
                    startXInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                  )}
                  step="0.1"
                  disabled={isScanInProgress}
                  placeholder="X position"
                />
              </div>
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={startYInput.inputValue}
                  onChange={startYInput.handleInputChange}
                  onKeyDown={startYInput.handleKeyDown}
                  onBlur={startYInput.handleBlur}
                  className={getInputValidationClasses(
                    startYInput.isValid,
                    startYInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                  )}
                  step="0.1"
                  disabled={isScanInProgress}
                  placeholder="Y position"
                />
              </div>
            </div>
          </div>
          
          {/* Grid Size */}
          <div>
            <label className="block text-gray-300 font-medium mb-1">Grid Size (positions)</label>
            <div className="flex space-x-2">
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={nxInput.inputValue}
                  onChange={nxInput.handleInputChange}
                  onKeyDown={nxInput.handleKeyDown}
                  onBlur={nxInput.handleBlur}
                  className={getInputValidationClasses(
                    nxInput.isValid,
                    nxInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                  )}
                  min="1"
                  disabled={isScanInProgress}
                  placeholder="Nx"
                />
              </div>
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={nyInput.inputValue}
                  onChange={nyInput.handleInputChange}
                  onKeyDown={nyInput.handleKeyDown}
                  onBlur={nyInput.handleBlur}
                  className={getInputValidationClasses(
                    nyInput.isValid,
                    nyInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                  )}
                  min="1"
                  disabled={isScanInProgress}
                  placeholder="Ny"
                />
              </div>
            </div>
          </div>
          
          {/* Step Size */}
          <div>
            <label className="block text-gray-300 font-medium mb-1">Step Size (mm)</label>
            <div className="flex space-x-2">
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={dxInput.inputValue}
                  onChange={dxInput.handleInputChange}
                  onKeyDown={dxInput.handleKeyDown}
                  onBlur={dxInput.handleBlur}
                  className={getInputValidationClasses(
                    dxInput.isValid,
                    dxInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                  )}
                  step="0.1"
                  min="0.1"
                  disabled={isScanInProgress}
                  placeholder="dX step"
                />
              </div>
              <div className="w-1/2 input-validation-container">
                <input
                  type="number"
                  value={dyInput.inputValue}
                  onChange={dyInput.handleInputChange}
                  onKeyDown={dyInput.handleKeyDown}
                  onBlur={dyInput.handleBlur}
                  className={getInputValidationClasses(
                    dyInput.isValid,
                    dyInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-700 border rounded text-white"
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
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-gray-300 font-medium">Illumination Channels</label>
              <div className="flex space-x-1">
                <button
                  onClick={() => {
                    if (isScanInProgress) return;
                    loadCurrentMicroscopeSettings();
                  }}
                  className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
                  className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isScanInProgress || scanParameters.illumination_settings.length >= 6}
                  title="Add channel"
                >
                  <i className="fas fa-plus mr-1"></i>
                  Add Channel
                </button>
              </div>
            </div>
            
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {scanParameters.illumination_settings.map((setting, index) => (
                <div key={index} className="bg-gray-700 p-2 rounded border border-gray-600">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-300 font-medium">Channel {index + 1}</span>
                    <button
                      onClick={() => {
                        if (isScanInProgress || scanParameters.illumination_settings.length <= 1) return;
                        setScanParameters(prev => ({
                          ...prev,
                          illumination_settings: prev.illumination_settings.filter((_, i) => i !== index)
                        }));
                      }}
                      className="px-1 py-0.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isScanInProgress || scanParameters.illumination_settings.length <= 1}
                      title="Remove channel"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="relative">
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
                        className={`w-full px-2 py-1 text-xs bg-gray-600 border rounded text-white ${
                          scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1 
                            ? 'border-yellow-500' 
                            : 'border-gray-500'
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
                        <div className="absolute -top-1 -right-1">
                          <i className="fas fa-exclamation-triangle text-yellow-500 text-xs" title="Duplicate channel detected"></i>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex space-x-2">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-400 mb-1">Intensity (%)</label>
                        <input
                          type="number"
                          value={setting.intensity}
                          onChange={(e) => {
                            if (isScanInProgress) return;
                            setScanParameters(prev => ({
                              ...prev,
                              illumination_settings: prev.illumination_settings.map((s, i) => 
                                i === index ? { ...s, intensity: parseInt(e.target.value) || 0 } : s
                              )
                            }));
                          }}
                          className="w-full px-2 py-1 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                          min="0"
                          max="100"
                          disabled={isScanInProgress}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs text-gray-400 mb-1">Exposure (ms)</label>
                        <input
                          type="number"
                          value={setting.exposure_time}
                          onChange={(e) => {
                            if (isScanInProgress) return;
                            setScanParameters(prev => ({
                              ...prev,
                              illumination_settings: prev.illumination_settings.map((s, i) => 
                                i === index ? { ...s, exposure_time: parseInt(e.target.value) || 0 } : s
                              )
                            }));
                          }}
                          className="w-full px-2 py-1 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                          min="1"
                          max="10000"
                          disabled={isScanInProgress}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Autofocus Options */}
          <div className="flex items-center space-x-4">
            <label className="flex items-center text-xs">
              <input
                type="checkbox"
                checked={scanParameters.do_contrast_autofocus}
                onChange={(e) => setScanParameters(prev => ({ ...prev, do_contrast_autofocus: e.target.checked }))}
                className="mr-2"
                disabled={isScanInProgress}
              />
              Contrast AF
            </label>
            <label className="flex items-center text-xs">
              <input
                type="checkbox"
                checked={scanParameters.do_reflection_af}
                onChange={(e) => setScanParameters(prev => ({ ...prev, do_reflection_af: e.target.checked }))}
                className="mr-2"
                disabled={isScanInProgress}
              />
              Reflection AF
            </label>
          </div>
          
          {/* Upload During Scanning Toggle */}
          <div className="bg-gray-700 p-2 rounded">
            <div className="text-purple-300 font-medium mb-1"><i className="fas fa-cloud-upload-alt mr-1"></i>Upload Settings</div>
            <label className="flex items-center text-xs">
              <input
                type="checkbox"
                checked={scanParameters.uploading}
                onChange={(e) => setScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                className="mr-2"
                disabled={isScanInProgress}
              />
              Upload during scanning
              <i className="fas fa-question-circle ml-1 text-gray-400" title="Enable background upload of scan data to artifact manager during scanning"></i>
            </label>
          </div>
          
          {/* Scan Info */}
          <div className="bg-gray-700 p-2 rounded text-xs">
            <div>Total scan area: {(scanParameters.Nx * scanParameters.dx_mm).toFixed(1)} × {(scanParameters.Ny * scanParameters.dy_mm).toFixed(1)} mm</div>
            <div>Total positions: {scanParameters.Nx * scanParameters.Ny}</div>
            <div>Channels: {scanParameters.illumination_settings.length}</div>
            <div>Total images: {scanParameters.Nx * scanParameters.Ny * scanParameters.illumination_settings.length}</div>
            <div>End position: ({(scanParameters.start_x_mm + (scanParameters.Nx-1) * scanParameters.dx_mm).toFixed(1)}, {(scanParameters.start_y_mm + (scanParameters.Ny-1) * scanParameters.dy_mm).toFixed(1)}) mm</div>
          </div>
          
          {/* Rectangle Selection Info */}
          {isRectangleSelection && (
            <div className="bg-blue-900 bg-opacity-50 p-2 rounded text-xs border border-blue-500">
              <i className="fas fa-vector-square mr-1"></i>
              Drag on the map to select scan area. Current settings will be used as defaults.
            </div>
          )}
        </div>
        
        {/* Action Buttons */}
        <div className="flex justify-end space-x-2 mt-4">
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
            className={`px-3 py-1 text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed ${
              isRectangleSelection ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-600 hover:bg-gray-500 text-white'
            }`}
            disabled={isScanInProgress}
          >
            <i className="fas fa-vector-square mr-1"></i>
            {isRectangleSelection ? 'Stop Selection' : 'Select Area'}
          </button>
          <button
            onClick={handleStartScan}
            className={`px-3 py-1 text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed ${
              isScanInProgress ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
            } text-white`}
            disabled={!microscopeControlService}
          >
            <i className={`fas ${isScanInProgress ? 'fa-stop' : 'fa-play'} mr-1`}></i>
            {isScanInProgress ? 'Stop Scan' : 'Start Scan'}
          </button>
        </div>
      </div>
    </div>
  );
};

ScanConfiguration.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  scanParameters: PropTypes.object.isRequired,
  setScanParameters: PropTypes.func.isRequired,
  isScanInProgress: PropTypes.bool.isRequired,
  selectedWells: PropTypes.array.isRequired,
  setSelectedWells: PropTypes.func.isRequired,
  isRectangleSelection: PropTypes.bool.isRequired,
  setIsRectangleSelection: PropTypes.func.isRequired,
  setRectangleStart: PropTypes.func.isRequired,
  setRectangleEnd: PropTypes.func.isRequired,
  setDragSelectedWell: PropTypes.func.isRequired,
  gridDragStart: PropTypes.object,
  setGridDragStart: PropTypes.func.isRequired,
  gridDragEnd: PropTypes.object,
  setGridDragEnd: PropTypes.func.isRequired,
  isGridDragging: PropTypes.bool.isRequired,
  setIsGridDragging: PropTypes.func.isRequired,
  gridSelectedCells: PropTypes.object.isRequired,
  getWellPlateGridLabels: PropTypes.func.isRequired,
  getWellIdFromIndex: PropTypes.func.isRequired,
  handleGridCellMouseDown: PropTypes.func.isRequired,
  handleGridCellMouseEnter: PropTypes.func.isRequired,
  handleMouseUp: PropTypes.func.isRequired,
  loadCurrentMicroscopeSettings: PropTypes.func.isRequired,
  microscopeControlService: PropTypes.object,
  scanBounds: PropTypes.object.isRequired,
  validateStartPosition: PropTypes.func.isRequired,
  validateGridSize: PropTypes.func.isRequired,
  showNotification: PropTypes.func,
  activeExperiment: PropTypes.string,
  wellPlateType: PropTypes.string.isRequired,
  wellPaddingMm: PropTypes.number.isRequired,
  refreshScanResults: PropTypes.func.isRequired,
  setVisibleLayers: PropTypes.func.isRequired,
  appendLog: PropTypes.func,
  toggleWebRtcStream: PropTypes.func,
  isWebRtcActive: PropTypes.bool,
  setMicroscopeBusy: PropTypes.func,
  setCurrentOperation: PropTypes.func
};

export default ScanConfiguration;
