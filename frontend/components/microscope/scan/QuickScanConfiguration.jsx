import React from 'react';
import PropTypes from 'prop-types';
import { useValidatedNumberInput, getInputValidationClasses } from '../../../utils';

const QuickScanConfiguration = ({
  isOpen,
  onClose,
  quickScanParameters,
  setQuickScanParameters,
  isQuickScanInProgress,
  microscopeControlService,
  showNotification,
  activeExperiment,
  wellPaddingMm,
  appendLog
}) => {
  // Validation hooks for quick scan parameters with "Enter to confirm" behavior
  const quickExposureInput = useValidatedNumberInput(
    quickScanParameters.exposure_time,
    (value) => setQuickScanParameters(prev => ({ ...prev, exposure_time: value })),
    { min: 1, max: 30, allowFloat: true },
    showNotification
  );

  const quickIntensityInput = useValidatedNumberInput(
    quickScanParameters.intensity,
    (value) => setQuickScanParameters(prev => ({ ...prev, intensity: value })),
    { min: 1, max: 100, allowFloat: false },
    showNotification
  );

  const quickFpsInput = useValidatedNumberInput(
    quickScanParameters.fps_target,
    (value) => setQuickScanParameters(prev => ({ ...prev, fps_target: value })),
    { min: 1, max: 60, allowFloat: false },
    showNotification
  );

  const quickStripesInput = useValidatedNumberInput(
    quickScanParameters.n_stripes,
    (value) => setQuickScanParameters(prev => ({ ...prev, n_stripes: value })),
    { min: 1, max: 10, allowFloat: false },
    showNotification
  );

  const quickStripeWidthInput = useValidatedNumberInput(
    quickScanParameters.stripe_width_mm,
    (value) => setQuickScanParameters(prev => ({ ...prev, stripe_width_mm: value })),
    { min: 0.5, max: 10.0, allowFloat: true },
    showNotification
  );

  const quickDyInput = useValidatedNumberInput(
    quickScanParameters.dy_mm,
    (value) => setQuickScanParameters(prev => ({ ...prev, dy_mm: value })),
    { min: 0.1, max: 5.0, allowFloat: true },
    showNotification
  );

  const quickVelocityInput = useValidatedNumberInput(
    quickScanParameters.velocity_scan_mm_per_s,
    (value) => setQuickScanParameters(prev => ({ ...prev, velocity_scan_mm_per_s: value })),
    { min: 1, max: 30, allowFloat: true },
    showNotification
  );

  const handleStartQuickScan = async () => {
    if (!microscopeControlService) return;
    
    if (isQuickScanInProgress) {
      // Stop scan logic
      try {
        if (appendLog) appendLog('Stopping quick scan...');
        
        const result = await microscopeControlService.stop_scan_and_stitching();
        
        if (result.success) {
          if (showNotification) showNotification('Quick scan stop requested', 'success');
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
          if (showNotification) showNotification('Failed to start quick scan', 'error');
          if (appendLog) appendLog(`Quick scan start failed: ${result ? result.message : 'No result returned'}`);
        }
      } catch (error) {
        if (showNotification) showNotification('Error starting quick scan', 'error');
        if (appendLog) appendLog(`Quick scan start error: ${error.message}`);
        console.error('Quick scan error:', error);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="absolute top-12 right-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 z-50 text-white scan-config-panel">
      <div className="flex items-center justify-between p-4 border-b border-gray-600 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-200">Quick Scan Configuration</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1"
          title="Close"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      <div className="p-3 scan-config-content">
        <div className="space-y-2 text-xs">
          {/* Well Plate Type */}
          <div>
            <label className="block text-gray-300 font-medium mb-1">Well Plate Type</label>
            <select
              value={quickScanParameters.wellplate_type}
              onChange={(e) => setQuickScanParameters(prev => ({ ...prev, wellplate_type: e.target.value }))}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
              disabled={isQuickScanInProgress}
            >
              <option value="96">96-well plate</option>
            </select>
          </div>

          {/* Stripe Pattern Configuration */}
          <div className="bg-gray-700 p-2 rounded">
            <div className="text-blue-300 font-medium mb-1"><i className="fas fa-grip-lines mr-1"></i>Stripe Pattern</div>
            <div className="flex space-x-2 mb-1">
              <div className="w-1/2 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Stripes per Well</label>
                <input
                  type="number"
                  value={quickStripesInput.inputValue}
                  onChange={quickStripesInput.handleInputChange}
                  onKeyDown={quickStripesInput.handleKeyDown}
                  onBlur={quickStripesInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStripesInput.isValid,
                    quickStripesInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                  )}
                  min="1"
                  max="10"
                  disabled={isQuickScanInProgress}
                  placeholder="1-10"
                />
              </div>
              <div className="w-1/2 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Stripe Width (mm)</label>
                <input
                  type="number"
                  value={quickStripeWidthInput.inputValue}
                  onChange={quickStripeWidthInput.handleInputChange}
                  onKeyDown={quickStripeWidthInput.handleKeyDown}
                  onBlur={quickStripeWidthInput.handleBlur}
                  className={getInputValidationClasses(
                    quickStripeWidthInput.isValid,
                    quickStripeWidthInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                  )}
                  min="0.5"
                  max="10.0"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="0.5-10.0"
                />
              </div>
            </div>
            <div className="input-validation-container">
              <label className="block text-gray-300 font-medium mb-1">Y Increment (mm)</label>
              <input
                type="number"
                value={quickDyInput.inputValue}
                onChange={quickDyInput.handleInputChange}
                onKeyDown={quickDyInput.handleKeyDown}
                onBlur={quickDyInput.handleBlur}
                className={getInputValidationClasses(
                  quickDyInput.isValid,
                  quickDyInput.hasUnsavedChanges,
                  "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
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
          <div className="bg-gray-700 p-2 rounded">
            <div className="text-green-300 font-medium mb-1"><i className="fas fa-camera mr-1"></i>Camera & Light</div>
            <div className="flex space-x-2 mb-1">
              <div className="flex-1 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Exposure (ms)</label>
                <input
                  type="number"
                  value={quickExposureInput.inputValue}
                  onChange={quickExposureInput.handleInputChange}
                  onKeyDown={quickExposureInput.handleKeyDown}
                  onBlur={quickExposureInput.handleBlur}
                  className={getInputValidationClasses(
                    quickExposureInput.isValid,
                    quickExposureInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                  )}
                  min="1"
                  max="30"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="1-30ms"
                />
              </div>
              <div className="flex-1 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Intensity (%)</label>
                <input
                  type="number"
                  value={quickIntensityInput.inputValue}
                  onChange={quickIntensityInput.handleInputChange}
                  onKeyDown={quickIntensityInput.handleKeyDown}
                  onBlur={quickIntensityInput.handleBlur}
                  className={getInputValidationClasses(
                    quickIntensityInput.isValid,
                    quickIntensityInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                  )}
                  min="0"
                  max="100"
                  disabled={isQuickScanInProgress}
                  placeholder="0-100%"
                />
              </div>
            </div>
            {/* Autofocus selection */}
            <div className="mt-1">
              <div className="text-blue-300 font-medium mb-1"><i className="fas fa-bullseye mr-1"></i>Autofocus</div>
              <div className="flex flex-col space-y-1">
                <label className="flex items-center text-xs">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={!quickScanParameters.do_contrast_autofocus && !quickScanParameters.do_reflection_af}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: false }))}
                    disabled={isQuickScanInProgress}
                    className="mr-2"
                  />
                  None
                </label>
                <label className="flex items-center text-xs">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={quickScanParameters.do_contrast_autofocus}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: true, do_reflection_af: false }))}
                    disabled={isQuickScanInProgress}
                    className="mr-2"
                  />
                  Contrast Autofocus
                </label>
                <label className="flex items-center text-xs">
                  <input
                    type="radio"
                    name="quickscan-autofocus"
                    checked={quickScanParameters.do_reflection_af}
                    onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: true }))}
                    disabled={isQuickScanInProgress}
                    className="mr-2"
                  />
                  Reflection Autofocus
                </label>
              </div>
              <div className="text-gray-400 text-xs mt-1">Only one autofocus mode can be enabled for quick scan.</div>
            </div>
          </div>

          {/* Motion & Acquisition Settings */}
          <div className="bg-gray-700 p-2 rounded">
            <div className="text-yellow-300 font-medium mb-1"><i className="fas fa-tachometer-alt mr-1"></i>Motion & Acquisition</div>
            <div className="flex space-x-2">
              <div className="flex-1 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Scan Velocity (mm/s)</label>
                <input
                  type="number"
                  value={quickVelocityInput.inputValue}
                  onChange={quickVelocityInput.handleInputChange}
                  onKeyDown={quickVelocityInput.handleKeyDown}
                  onBlur={quickVelocityInput.handleBlur}
                  className={getInputValidationClasses(
                    quickVelocityInput.isValid,
                    quickVelocityInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                  )}
                  min="1"
                  max="30"
                  step="0.1"
                  disabled={isQuickScanInProgress}
                  placeholder="1-30 mm/s"
                />
              </div>
              <div className="flex-1 input-validation-container">
                <label className="block text-gray-300 font-medium mb-1">Target FPS</label>
                <input
                  type="number"
                  value={quickFpsInput.inputValue}
                  onChange={quickFpsInput.handleInputChange}
                  onKeyDown={quickFpsInput.handleKeyDown}
                  onBlur={quickFpsInput.handleBlur}
                  className={getInputValidationClasses(
                    quickFpsInput.isValid,
                    quickFpsInput.hasUnsavedChanges,
                    "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
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
          <div className="bg-gray-700 p-2 rounded">
            <div className="text-purple-300 font-medium mb-1"><i className="fas fa-cloud-upload-alt mr-1"></i>Upload Settings</div>
            <label className="flex items-center text-xs">
              <input
                type="checkbox"
                checked={quickScanParameters.uploading}
                onChange={(e) => setQuickScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                className="mr-2"
                disabled={isQuickScanInProgress}
              />
              Upload during scanning
              <i className="fas fa-question-circle ml-1 text-gray-400" title="Enable background upload of scan data to artifact manager during scanning"></i>
            </label>
          </div>
          
          {/* Quick Scan Info */}
          <div className="bg-gray-700 p-2 rounded text-xs">
            <div className="text-yellow-300 font-medium mb-1"><i className="fas fa-info-circle mr-1"></i>Quick Scan Info</div>
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
        
        {/* Action Button */}
        <div className="flex justify-end space-x-2 mt-3">
          <button
            onClick={handleStartQuickScan}
            className={`px-3 py-1 text-xs ${isQuickScanInProgress ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'} text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center`}
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

QuickScanConfiguration.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  quickScanParameters: PropTypes.object.isRequired,
  setQuickScanParameters: PropTypes.func.isRequired,
  isQuickScanInProgress: PropTypes.bool.isRequired,
  microscopeControlService: PropTypes.object,
  showNotification: PropTypes.func,
  activeExperiment: PropTypes.string,
  wellPaddingMm: PropTypes.number.isRequired,
  appendLog: PropTypes.func
};

export default QuickScanConfiguration;
