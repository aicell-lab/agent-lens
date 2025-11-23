import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useValidatedNumberInput, getInputValidationClasses } from '../../utils';
import './WellPlateOffsetPanel.css';

const WellPlateOffsetPanel = ({
  // State props
  showWellPlateOffsetPanel,
  setShowWellPlateOffsetPanel,
  microscopeConfiguration,
  
  // Service props
  microscopeControlService,
  appendLog,
  showNotification,
  
  // Callback to reload configuration after save
  onConfigurationUpdated,
  
  // Input validation hooks
  offsetXInput,
  offsetYInput,
}) => {
  const [isSaving, setIsSaving] = useState(false);

  if (!showWellPlateOffsetPanel) return null;

  const handleSave = async () => {
    // Validate inputs before saving
    if (!offsetXInput.isValid || !offsetYInput.isValid) {
      showNotification('Please fix validation errors before saving.', 'error');
      return;
    }

    setIsSaving(true);
    
    try {
      appendLog(`Setting well plate offsets: X=${offsetXInput.inputValue} mm, Y=${offsetYInput.inputValue} mm`);
      
      // Call the microscope service to set the offsets
      const result = await microscopeControlService.set_wellplate_offset(
        parseFloat(offsetXInput.inputValue),
        parseFloat(offsetYInput.inputValue)
      );
      
      appendLog(`Well plate offsets updated successfully: X=${result.offset_x_mm} mm, Y=${result.offset_y_mm} mm`);
      showNotification('Well plate offsets saved successfully!', 'success');
      
      // Reload the microscope configuration to reflect changes
      if (onConfigurationUpdated) {
        await onConfigurationUpdated();
      }
      
      // Close the panel
      setShowWellPlateOffsetPanel(false);
      
      // Show browser alert to remind user to refresh
      alert('Well plate offsets saved successfully!\n\nPlease refresh the page to see the updated well plate positions.');
    } catch (error) {
      console.error('Error setting well plate offsets:', error);
      appendLog(`Error setting well plate offsets: ${error.message}`);
      showNotification(`Failed to save offsets: ${error.message}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setShowWellPlateOffsetPanel(false);
  };

  return (
    <div className="well-plate-offset-panel">
      <div className="well-plate-offset-header">
        <h3 className="well-plate-offset-title">
          <i className="fas fa-wrench mr-2"></i>
          Well Plate Offset Adjustment
        </h3>
        <button
          onClick={handleCancel}
          className="well-plate-offset-close"
          title="Close"
          disabled={isSaving}
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      <div className="well-plate-offset-content">
        <div className="well-plate-offset-sections">
          {/* Current Values Info */}
          <div className="well-plate-offset-section well-plate-offset-section--info">
            <div className="well-plate-offset-section-header">
              <i className="fas fa-info-circle mr-1"></i>
              Current Configuration
            </div>
            <div className="well-plate-offset-info-list">
              <div>
                <strong>Offset X:</strong> {microscopeConfiguration?.wellplate?.offset_x_mm ?? 'N/A'} mm
              </div>
              <div>
                <strong>Offset Y:</strong> {microscopeConfiguration?.wellplate?.offset_y_mm ?? 'N/A'} mm
              </div>
            </div>
          </div>

          {/* Offset Adjustment Section */}
          <div className="well-plate-offset-section well-plate-offset-section--highlighted">
            <div className="well-plate-offset-section-header">
              <i className="fas fa-sliders-h mr-1"></i>
              Adjust Offsets
            </div>
            
            <div className="well-plate-offset-row">
              <div className="well-plate-offset-input-group">
                <label className="well-plate-offset-label">
                  Offset X (mm)
                  <i 
                    className="fas fa-question-circle well-plate-offset-help" 
                    title="X-axis offset in millimeters. Range: -10 to 10 mm. Press Enter to confirm."
                  ></i>
                </label>
                <input
                  type="number"
                  value={offsetXInput.inputValue}
                  onChange={offsetXInput.handleInputChange}
                  onKeyDown={offsetXInput.handleKeyDown}
                  onBlur={offsetXInput.handleBlur}
                  className={getInputValidationClasses(
                    offsetXInput.isValid,
                    offsetXInput.hasUnsavedChanges,
                    "well-plate-offset-input"
                  )}
                  min="-10"
                  max="10"
                  step="0.1"
                  disabled={isSaving}
                  placeholder="X offset"
                />
              </div>
            </div>

            <div className="well-plate-offset-row">
              <div className="well-plate-offset-input-group">
                <label className="well-plate-offset-label">
                  Offset Y (mm)
                  <i 
                    className="fas fa-question-circle well-plate-offset-help" 
                    title="Y-axis offset in millimeters. Range: -10 to 10 mm. Press Enter to confirm."
                  ></i>
                </label>
                <input
                  type="number"
                  value={offsetYInput.inputValue}
                  onChange={offsetYInput.handleInputChange}
                  onKeyDown={offsetYInput.handleKeyDown}
                  onBlur={offsetYInput.handleBlur}
                  className={getInputValidationClasses(
                    offsetYInput.isValid,
                    offsetYInput.hasUnsavedChanges,
                    "well-plate-offset-input"
                  )}
                  min="-10"
                  max="10"
                  step="0.1"
                  disabled={isSaving}
                  placeholder="Y offset"
                />
              </div>
            </div>

            <div className="well-plate-offset-hint">
              <i className="fas fa-lightbulb mr-1"></i>
              Offsets are added to well positions. Press Enter to confirm changes, Escape to cancel.
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="well-plate-offset-actions">
          <button
            onClick={handleCancel}
            className="well-plate-offset-button well-plate-offset-button--cancel"
            disabled={isSaving}
          >
            <i className="fas fa-times mr-1"></i>
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="well-plate-offset-button well-plate-offset-button--save"
            disabled={isSaving || !offsetXInput.isValid || !offsetYInput.isValid}
          >
            {isSaving ? (
              <>
                <i className="fas fa-spinner fa-spin mr-1"></i>
                Saving...
              </>
            ) : (
              <>
                <i className="fas fa-save mr-1"></i>
                Save Offsets
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

WellPlateOffsetPanel.propTypes = {
  // State props
  showWellPlateOffsetPanel: PropTypes.bool.isRequired,
  setShowWellPlateOffsetPanel: PropTypes.func.isRequired,
  microscopeConfiguration: PropTypes.object,
  
  // Service props
  microscopeControlService: PropTypes.object.isRequired,
  appendLog: PropTypes.func.isRequired,
  showNotification: PropTypes.func.isRequired,
  
  // Callback
  onConfigurationUpdated: PropTypes.func,
  
  // Input validation hooks
  offsetXInput: PropTypes.shape({
    inputValue: PropTypes.string.isRequired,
    handleInputChange: PropTypes.func.isRequired,
    handleKeyDown: PropTypes.func.isRequired,
    handleBlur: PropTypes.func.isRequired,
    isValid: PropTypes.bool.isRequired,
    hasUnsavedChanges: PropTypes.bool.isRequired,
  }).isRequired,
  offsetYInput: PropTypes.shape({
    inputValue: PropTypes.string.isRequired,
    handleInputChange: PropTypes.func.isRequired,
    handleKeyDown: PropTypes.func.isRequired,
    handleBlur: PropTypes.func.isRequired,
    isValid: PropTypes.bool.isRequired,
    hasUnsavedChanges: PropTypes.bool.isRequired,
  }).isRequired,
};

export default WellPlateOffsetPanel;

