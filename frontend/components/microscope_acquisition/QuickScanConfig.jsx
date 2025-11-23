import React from 'react';
import { useValidatedNumberInput, getInputValidationClasses } from '../../utils';
import './QuickScanConfig.css';

const QuickScanConfig = ({
  // State props
  showQuickScanConfig,
  setShowQuickScanConfig,
  quickScanParameters,
  setQuickScanParameters,
  isQuickScanInProgress,
  setIsQuickScanInProgress,
  activeExperiment,
  
  // Service props
  microscopeControlService,
  appendLog,
  showNotification,
  
  // Busy state props
  setMicroscopeBusy,
  setCurrentOperation,
  
  // Input validation hooks
  quickStartXInput,
  quickStartYInput,
  quickScanWidthInput,
  quickScanHeightInput,
  quickDyInput,
  quickExposureInput,
  quickIntensityInput,
  quickVelocityInput,
  quickFpsInput
}) => {
  if (!showQuickScanConfig) return null;

  return (
    <div className="quick-scan-config-panel">
      <div className="quick-scan-config-header">
        <h3 className="quick-scan-config-title">
          <i className="fas fa-bolt mr-2"></i>
          Quick Scan Configuration
        </h3>
        <button
          onClick={() => setShowQuickScanConfig(false)}
          className="quick-scan-config-close"
          title="Close"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      <div className="quick-scan-config-content">
        <div className="quick-scan-config-sections">
          {/* Scan Region Configuration */}
          <div className="quick-scan-config-section quick-scan-config-section--highlighted">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-vector-square mr-1"></i>
              Scan Region
            </div>
            <div className="quick-scan-config-row">
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Start X (mm)</label>
                <input
                  type="number"
                  value={quickStartXInput.inputValue}
                  onChange={quickStartXInput.handleInputChange}
                  onKeyDown={quickStartXInput.handleKeyDown}
                  onBlur={quickStartXInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStartXInput.isValid,
                    quickStartXInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="-100"
                  max="100"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="X position"
                />
              </div>
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Start Y (mm)</label>
                <input
                  type="number"
                  value={quickStartYInput.inputValue}
                  onChange={quickStartYInput.handleInputChange}
                  onKeyDown={quickStartYInput.handleKeyDown}
                  onBlur={quickStartYInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStartYInput.isValid,
                    quickStartYInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="-100"
                  max="100"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="Y position"
                />
              </div>
            </div>
            <div className="quick-scan-config-row">
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Width (mm)</label>
                <input
                  type="number"
                  value={quickScanWidthInput.inputValue}
                  onChange={quickScanWidthInput.handleInputChange}
                  onKeyDown={quickScanWidthInput.handleKeyDown}
                  onBlur={quickScanWidthInput.handleBlur}
                  className={getInputValidationClasses(
                    quickScanWidthInput.isValid,
                    quickScanWidthInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="200"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="Scan width"
                />
              </div>
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Height (mm)</label>
                <input
                  type="number"
                  value={quickScanHeightInput.inputValue}
                  onChange={quickScanHeightInput.handleInputChange}
                  onKeyDown={quickScanHeightInput.handleKeyDown}
                  onBlur={quickScanHeightInput.handleBlur}
                  className={getInputValidationClasses(
                    quickScanHeightInput.isValid,
                    quickScanHeightInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="200"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="Scan height"
                />
              </div>
            </div>
            <div className="quick-scan-config-input-group">
              <label className="quick-scan-config-label">Y Increment (mm)</label>
              <input
                type="number"
                value={quickDyInput.inputValue}
                onChange={quickDyInput.handleInputChange}
                onKeyDown={quickDyInput.handleKeyDown}
                onBlur={quickDyInput.handleBlur}
                className={getInputValidationClasses(
                  quickDyInput.isValid,
                  quickDyInput.hasUnsavedChanges,
                  "quick-scan-config-input"
                )}
                min="0.1"
                max="5.0"
                step="0.1"
                disabled={isQuickScanInProgress}
                placeholder="0.1-5.0"
              />
            </div>
          </div>
          
          {/* Camera & Illumination Settings */}
          <div className="quick-scan-config-section quick-scan-config-section--highlighted">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-camera mr-1"></i>
              Camera & Light
            </div>
            <div className="quick-scan-config-row">
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Exposure (ms)</label>
                <input
                  type="number"
                  value={quickExposureInput.inputValue}
                  onChange={quickExposureInput.handleInputChange}
                  onKeyDown={quickExposureInput.handleKeyDown}
                  onBlur={quickExposureInput.handleBlur}
                  className={getInputValidationClasses(
                    quickExposureInput.isValid,
                    quickExposureInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="30"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="1-30ms"
                />
              </div>
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Intensity (%)</label>
                <input
                  type="number"
                  value={quickIntensityInput.inputValue}
                  onChange={quickIntensityInput.handleInputChange}
                  onKeyDown={quickIntensityInput.handleKeyDown}
                  onBlur={quickIntensityInput.handleBlur}
                  className={getInputValidationClasses(
                    quickIntensityInput.isValid,
                    quickIntensityInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="0"
                  max="100"
                  disabled={isQuickScanInProgress}
                  placeholder="0-100%"
                />
              </div>
            </div>
            
          </div>

          {/* Motion & Acquisition Settings */}
          <div className="quick-scan-config-section quick-scan-config-section--highlighted">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-tachometer-alt mr-1"></i>
              Motion & Acquisition
            </div>
            <div className="quick-scan-config-row">
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Scan Velocity (mm/s)</label>
                <input
                  type="number"
                  value={quickVelocityInput.inputValue}
                  onChange={quickVelocityInput.handleInputChange}
                  onKeyDown={quickVelocityInput.handleKeyDown}
                  onBlur={quickVelocityInput.handleBlur}
                  className={getInputValidationClasses(
                    quickVelocityInput.isValid,
                    quickVelocityInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="30"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="1-30 mm/s"
                />
              </div>
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Target FPS</label>
                <input
                  type="number"
                  value={quickFpsInput.inputValue}
                  onChange={quickFpsInput.handleInputChange}
                  onKeyDown={quickFpsInput.handleKeyDown}
                  onBlur={quickFpsInput.handleBlur}
                  className={getInputValidationClasses(
                    quickFpsInput.isValid,
                    quickFpsInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="60"
                  disabled={isQuickScanInProgress}
                  placeholder="1-60 fps"
                />
              </div>
            </div>
          </div>
          
          {/* Upload During Scanning Toggle */}
          <div className="quick-scan-config-section quick-scan-config-section--highlighted">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-cloud-upload-alt mr-1"></i>
              Upload Settings
            </div>
            <label className="quick-scan-config-checkbox">
              <input
                type="checkbox"
                checked={quickScanParameters.uploading}
                onChange={(e) => setQuickScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                disabled={isQuickScanInProgress}
              />
              <span>Upload after scanning</span>
              <i className="fas fa-question-circle quick-scan-config-help" title="Enable background upload of scan data to artifact manager during scanning"></i>
            </label>
          </div>
          
          {/* Quick Scan Info */}
          <div className="quick-scan-config-section quick-scan-config-section--info">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-info-circle mr-1"></i>
              Quick Scan Info
            </div>
            <div className="quick-scan-config-info-list">
              <div>• Brightfield channel only</div>
              <div>• Horizontal stripe serpentine pattern</div>
              <div>• Scans rectangular region: {quickScanParameters.scan_width_mm}mm × {quickScanParameters.scan_height_mm}mm</div>
              <div>• Starting position: ({quickScanParameters.start_x_mm}, {quickScanParameters.start_y_mm}) mm</div>
              <div>• No autofocus - simple, fast scanning</div>
              <div>• Estimated scan time: {(() => {
                const stripes = Math.ceil(quickScanParameters.scan_height_mm / quickScanParameters.dy_mm);
                const timePerStripe = quickScanParameters.scan_width_mm / quickScanParameters.velocity_scan_mm_per_s;
                const estimatedTimeSeconds = stripes * timePerStripe * 1.5; // 1.5x factor for movement overhead
                return estimatedTimeSeconds < 60 ? `${Math.round(estimatedTimeSeconds)}s` : `${Math.round(estimatedTimeSeconds/60)}min`;
              })()}</div>
            </div>
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="quick-scan-config-actions">
          <button
            onClick={async () => {
              if (!microscopeControlService) return;
              
              if (isQuickScanInProgress) {
                // Cancel scan using new unified API
                try {
                  if (appendLog) appendLog('Cancelling quick scan...');
                  
                  const result = await microscopeControlService.scan_cancel();
                  
                  if (result.success) {
                    if (showNotification) showNotification('Quick scan cancelled successfully', 'success');
                    // Note: scan state will be updated by status polling, no need to manually reset
                    if (appendLog) appendLog('Quick scan cancelled - operation interrupted');
                  } else {
                    if (showNotification) showNotification(`Failed to cancel quick scan: ${result.message}`, 'error');
                    if (appendLog) appendLog(`Quick scan cancel failed: ${result.message}`);
                  }
                } catch (error) {
                  if (showNotification) showNotification(`Error cancelling quick scan: ${error.message}`, 'error');
                  if (appendLog) appendLog(`Quick scan cancel error: ${error.message}`);
                }
              } else {
                // Start scan using new unified API
                try {
                  if (appendLog) appendLog('Starting quick scan...');
                  
                  // Note: scan state will be managed by status polling, but we set busy states immediately
                  if (setMicroscopeBusy) setMicroscopeBusy(true); // Set global busy state
                  if (setCurrentOperation) setCurrentOperation('scanning'); // Disable sidebar during scanning
                  
                  const result = await microscopeControlService.scan_start({
                    saved_data_type: "quick_zarr",
                    start_x_mm: quickScanParameters.start_x_mm,
                    start_y_mm: quickScanParameters.start_y_mm,
                    scan_width_mm: quickScanParameters.scan_width_mm,
                    scan_height_mm: quickScanParameters.scan_height_mm,
                    dy_mm: quickScanParameters.dy_mm,
                    exposure_time: quickScanParameters.exposure_time,
                    intensity: quickScanParameters.intensity,
                    fps_target: quickScanParameters.fps_target,
                    velocity_scan_mm_per_s: quickScanParameters.velocity_scan_mm_per_s,
                    experiment_name: activeExperiment,
                    uploading: quickScanParameters.uploading
                  });
                  
                  if (appendLog) appendLog(`Quick scan start result: ${JSON.stringify(result)}`);
                  
                  if (result && result.success) {
                    if (showNotification) showNotification('Quick scan started successfully', 'success');
                    if (appendLog) appendLog('Quick scan started - monitoring progress via status polling');
                  } else {
                    // If scan failed to start, show error and reset busy states
                    if (showNotification) showNotification(`Failed to start quick scan: ${result?.error_message || result?.message || 'Unknown error'}`, 'error');
                    if (appendLog) appendLog(`Quick scan start failed: ${result?.error_message || result?.message || 'No result returned'}`);
                    // Reset busy states since scan didn't start
                    if (setMicroscopeBusy) setMicroscopeBusy(false);
                    if (setCurrentOperation) setCurrentOperation(null);
                  }
                } catch (error) {
                  // If error occurred, show error and reset busy states
                  if (showNotification) showNotification(`Error starting quick scan: ${error.message}`, 'error');
                  if (appendLog) appendLog(`Quick scan start error: ${error.message}`);
                  console.error('Quick scan error:', error);
                  // Reset busy states since scan didn't start
                  if (setMicroscopeBusy) setMicroscopeBusy(false);
                  if (setCurrentOperation) setCurrentOperation(null);
                }
              }
            }}
            className={`quick-scan-config-button ${isQuickScanInProgress ? 'quick-scan-config-button--stop' : 'quick-scan-config-button--start'}`}
            disabled={!microscopeControlService}
          >
            {isQuickScanInProgress ? (
              <>
                <i className="fas fa-stop mr-1"></i>
                Stop Quick Scan
              </>
            ) : (
              <>
                <i className="fas fa-bolt mr-1"></i>
                Start Quick Scan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickScanConfig;
