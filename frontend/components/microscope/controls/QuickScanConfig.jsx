import React from 'react';
import { useValidatedNumberInput, getInputValidationClasses } from '../../../utils';
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
  wellPaddingMm,
  
  // Service props
  microscopeControlService,
  appendLog,
  showNotification,
  
  // Input validation hooks
  quickStripesInput,
  quickStripeWidthInput,
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
          {/* Well Plate Type */}
          <div className="quick-scan-config-section">
            <label className="quick-scan-config-label">Well Plate Type</label>
            <select
              value={quickScanParameters.wellplate_type}
              onChange={(e) => setQuickScanParameters(prev => ({ ...prev, wellplate_type: e.target.value }))}
              className="quick-scan-config-select"
              disabled={isQuickScanInProgress}
            >
              <option value="96">96-well plate</option>
            </select>
          </div>

          {/* Stripe Pattern Configuration */}
          <div className="quick-scan-config-section quick-scan-config-section--highlighted">
            <div className="quick-scan-config-section-header">
              <i className="fas fa-grip-lines mr-1"></i>
              Stripe Pattern
            </div>
            <div className="quick-scan-config-row">
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Stripes per Well</label>
                <input
                  type="number"
                  value={quickStripesInput.inputValue}
                  onChange={quickStripesInput.handleInputChange}
                  onKeyDown={quickStripesInput.handleKeyDown}
                  onBlur={quickStripesInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStripesInput.isValid,
                    quickStripesInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="1"
                  max="10"
                  disabled={isQuickScanInProgress}
                  placeholder="1-10"
                />
              </div>
              <div className="quick-scan-config-input-group">
                <label className="quick-scan-config-label">Stripe Width (mm)</label>
                <input
                  type="number"
                  value={quickStripeWidthInput.inputValue}
                  onChange={quickStripeWidthInput.handleInputChange}
                  onKeyDown={quickStripeWidthInput.handleKeyDown}
                  onBlur={quickStripeWidthInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStripeWidthInput.isValid,
                    quickStripeWidthInput.hasUnsavedChanges,
                    "quick-scan-config-input"
                  )}
                  min="0.5"
                  max="10.0"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="0.5-10.0"
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
            
            {/* Autofocus selection */}
            <div className="quick-scan-config-autofocus">
              <div className="quick-scan-config-section-header">
                <i className="fas fa-bullseye mr-1"></i>
                Autofocus
              </div>
              <div className="quick-scan-config-radio-group">
                <label className="quick-scan-config-radio">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={!quickScanParameters.do_contrast_autofocus && !quickScanParameters.do_reflection_af}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: false }))}
                    disabled={isQuickScanInProgress}
                  />
                  <span>None</span>
                </label>
                <label className="quick-scan-config-radio">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={quickScanParameters.do_contrast_autofocus}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: true, do_reflection_af: false }))}
                    disabled={isQuickScanInProgress}
                  />
                  <span>Contrast Autofocus</span>
                </label>
                <label className="quick-scan-config-radio">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={quickScanParameters.do_reflection_af}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: true }))}
                    disabled={isQuickScanInProgress}
                  />
                  <span>Reflection Autofocus</span>
                </label>
              </div>
              <div className="quick-scan-config-hint">
                Only one autofocus mode can be enabled for quick scan.
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
              <div>• {quickScanParameters.n_stripes}-stripe × {quickScanParameters.stripe_width_mm}mm serpentine pattern per well</div>
              <div>• Maximum exposure: 30ms</div>
              <div>• Scans entire {quickScanParameters.wellplate_type}-well plate</div>
              <div>• Estimated scan time: {(() => {
                const wellplateSizes = {'96': 96};
                const wells = wellplateSizes[quickScanParameters.wellplate_type] || 96;
                const stripesPerWell = quickScanParameters.n_stripes;
                const timePerStripe = quickScanParameters.stripe_width_mm / quickScanParameters.velocity_scan_mm_per_s;
                const estimatedTimeSeconds = wells * stripesPerWell * timePerStripe * 1.5; // 1.5x factor for movement overhead
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
                // Stop scan logic
                try {
                  if (appendLog) appendLog('Stopping quick scan...');
                  
                  const result = await microscopeControlService.stop_scan_and_stitching();
                  
                  if (result.success) {
                    if (showNotification) showNotification('Quick scan stop requested', 'success');
                    setIsQuickScanInProgress(false);
                    if (appendLog) appendLog('Quick scan stopped successfully');
                  } else {
                    if (showNotification) showNotification('Failed to stop quick scan', 'error');
                    if (appendLog) appendLog(`Quick scan stop failed: ${result.message}`);
                  }
                } catch (error) {
                  if (showNotification) showNotification('Error stopping quick scan', 'error');
                  if (appendLog) appendLog(`Quick scan stop error: ${error.message}`);
                }
              } else {
                // Start scan logic
                try {
                  if (appendLog) appendLog('Starting quick scan...');
                  
                  // Set scanning state immediately to update UI
                  setIsQuickScanInProgress(true);
                  
                  const result = await microscopeControlService.quick_scan_with_stitching(
                    quickScanParameters.wellplate_type,
                    quickScanParameters.exposure_time,
                    quickScanParameters.intensity,
                    quickScanParameters.fps_target,
                    'quick_scan_' + Date.now(),
                    quickScanParameters.n_stripes,
                    quickScanParameters.stripe_width_mm,
                    quickScanParameters.dy_mm,
                    quickScanParameters.velocity_scan_mm_per_s,
                    quickScanParameters.do_contrast_autofocus,
                    quickScanParameters.do_reflection_af,
                    activeExperiment, // experiment_name parameter
                    wellPaddingMm, // well_padding_mm parameter
                    quickScanParameters.uploading // uploading parameter
                  );
                  
                  if (appendLog) appendLog(`Quick scan result: ${JSON.stringify(result)}`);
                  
                  if (result && result.success) {
                    if (showNotification) showNotification('Quick scan started', 'success');
                    if (appendLog) appendLog('Quick scan started successfully');
                  } else {
                    // If scan failed, reset the state
                    setIsQuickScanInProgress(false);
                    if (showNotification) showNotification('Failed to start quick scan', 'error');
                    if (appendLog) appendLog(`Quick scan start failed: ${result ? result.message : 'No result returned'}`);
                  }
                } catch (error) {
                  // If error occurred, reset the state
                  setIsQuickScanInProgress(false);
                  if (showNotification) showNotification('Error starting quick scan', 'error');
                  if (appendLog) appendLog(`Quick scan start error: ${error.message}`);
                  console.error('Quick scan error:', error);
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
