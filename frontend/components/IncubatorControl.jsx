import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { tryGetService, useValidatedStringInput, getInputValidationClasses, validateStringInput } from '../utils';

const IncubatorControl = ({ 
  incubatorControlService, 
  appendLog,
  microscopeControlService,
  roboticArmService,
  selectedMicroscopeId,
  hyphaManager, // Added to get specific microscope services
  currentOperation,
  setCurrentOperation
}) => {
  // Example state for incubator parameters; adjust as needed.
  const [temperature, setTemperature] = useState(37);
  const [CO2, setCO2] = useState(5);
  const [isUpdating, setIsUpdating] = useState(false);
  const [slotsInfo, setSlotsInfo] = useState(Array(42).fill({}));
  // New state for selected slot details
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedSlotNumber, setSelectedSlotNumber] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Form state for sample information
  const [sampleForm, setSampleForm] = useState({
    name: '',
    status: 'IN',
    location: 'incubator_slot',
    date_to_incubator: '',
    well_plate_type: '96'
  });
  
  // Warning message state
  const [warningMessage, setWarningMessage] = useState('');
  
  // State for workflow messages (currentOperation is now a prop)
  const [workflowMessages, setWorkflowMessages] = useState([]);
  
  // Notification function for validation errors
  const showValidationError = (message) => {
    setWarningMessage(message);
  };

  // Validated string input for sample name to prevent filesystem issues
  const sampleNameInput = useValidatedStringInput(
    sampleForm.name,
    (value) => handleFormChange('name', value),
    {
      minLength: 1,
      maxLength: 50,
      allowEmpty: false,
      forbiddenChars: ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
      trim: true
    },
    showValidationError
  );
  
  // Helper functions for workflow messages
  const addWorkflowMessage = (message) => {
    setWorkflowMessages(prev => [{ message, timestamp: Date.now() }, ...prev]);
    appendLog(message);
  };

  const clearWorkflowMessages = () => {
    setWorkflowMessages([]);
  };

  const updateSettings = async () => {
    if (incubatorControlService) {
      try {
        const temp = await incubatorControlService.get_temperature();
        const co2 = await incubatorControlService.get_co2_level();
        setTemperature(temp);
        setCO2(co2);
        appendLog(`Incubator information updated: Temp ${temp}°C, CO2 ${co2}%`);
      } catch (error) {
        appendLog(`Failed to update incubator information: ${error.message}`);
      }
    } else {
      appendLog(`Updated incubator information locally: Temp ${temperature}°C, CO2 ${CO2}%`);
    }
  };

  const fetchSlotInformation = async () => {
    if (incubatorControlService) {
      try {
        const allSlotInfo = await incubatorControlService.get_slot_information();
        // Handle both array and individual slot responses
        const updatedSlotsInfo = Array(42).fill({});
        if (Array.isArray(allSlotInfo)) {
          allSlotInfo.forEach(slotInfo => {
            if (slotInfo && slotInfo.incubator_slot && slotInfo.incubator_slot >= 1 && slotInfo.incubator_slot <= 42) {
              updatedSlotsInfo[slotInfo.incubator_slot - 1] = slotInfo;
            }
          });
        } else if (allSlotInfo) {
          // If it returns a single slot info, handle it appropriately
          // This is a fallback in case the service returns different format
          for (let i = 1; i <= 42; i++) {
            try {
              const slotInfo = await incubatorControlService.get_slot_information(i);
              updatedSlotsInfo[i - 1] = slotInfo || {};
            } catch (error) {
              updatedSlotsInfo[i - 1] = {};
            }
          }
        }
        setSlotsInfo(updatedSlotsInfo);
        appendLog(`Slots information updated`);
      } catch (error) {
        appendLog(`Failed to update slots information: ${error.message}`);
      }
    }
  };

  useEffect(() => {
    // Call updateSettings and fetchSlotInformation once when the component mounts
    updateSettings();
    fetchSlotInformation();

    // Set an interval to update slots information every 10 seconds
    const interval = setInterval(fetchSlotInformation, 10000);

    return () => clearInterval(interval);
  }, []); // Empty dependency array ensures this runs only once on mount

  const handleOpen = () => {
    setIsUpdating(true);
  };

  const handleClose = () => {
    setIsUpdating(false);
  };

  const handleSlotDoubleClick = (slot, slotNumber) => {
    setSelectedSlot(slot);
    setSelectedSlotNumber(slotNumber);
    setSidebarOpen(true);
    setIsEditing(false);
    
    // If slot has data, populate the form for potential editing
    if (slot.name && slot.name.trim()) {
      setSampleForm({
        name: slot.name || '',
        status: slot.status || '',
        location: slot.location || 'incubator_slot',
        date_to_incubator: slot.date_to_incubator || '',
        well_plate_type: slot.well_plate_type || '96'
      });
    } else {
      // Reset form for empty slot
      setSampleForm({
        name: '',
        status: 'IN',
        location: 'incubator_slot',
        date_to_incubator: '',
        well_plate_type: '96'
      });
    }
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    setSelectedSlot(null);
    setSelectedSlotNumber(null);
    setIsEditing(false);
    setWarningMessage(''); // Clear warning when closing sidebar
  };

  const handleFormChange = (field, value) => {
    setSampleForm(prev => ({
      ...prev,
      [field]: value
    }));
    // Clear warning when user starts typing (but not for validation errors)
    if (warningMessage && !warningMessage.includes('Cannot contain these characters') && 
        !warningMessage.includes('Sample name is required') && 
        !warningMessage.includes('Sample name must be')) {
      setWarningMessage('');
    }
  };

  // Helper function to get specific microscope service by number
  const getSpecificMicroscopeService = async (microscopeNumber) => {
    if (!hyphaManager) {
      addWorkflowMessage("Error: HyphaManager not available");
      throw new Error("HyphaManager not available");
    }

    const microscopeServiceIds = {
      1: "reef-imaging/mirror-microscope-control-squid-1",
      2: "reef-imaging/mirror-microscope-control-squid-2",
      3: "reef-imaging/mirror-microscope-squid-plus-1"
    };

    const targetMicroscopeId = microscopeServiceIds[microscopeNumber];
    if (!targetMicroscopeId) {
      throw new Error(`Invalid microscope number: ${microscopeNumber}`);
    }

    addWorkflowMessage(`Connecting to ${targetMicroscopeId}...`);
    
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout after 15 seconds')), 15000)
      );
      
      const servicePromise = tryGetService(
        hyphaManager,
        `Microscope ${microscopeNumber} Control`,
        targetMicroscopeId,
        null, // No local service for real microscopes
        addWorkflowMessage,
        null // No notification function here
      );

      const specificMicroscopeService = await Promise.race([servicePromise, timeoutPromise]);

      if (!specificMicroscopeService) {
        throw new Error(`Failed to connect to Microscope ${microscopeNumber} service - service returned null`);
      }

      // Verify the service is actually functional by testing a simple call
      addWorkflowMessage(`Verifying connection to Microscope ${microscopeNumber}...`);
      try {
        // Test with a basic method that all microscope services should have
        await specificMicroscopeService.get_status();
        addWorkflowMessage(`✓ Successfully connected and verified Microscope ${microscopeNumber}`);
      } catch (statusError) {
        // If get_status fails, try a simpler check to see if essential methods exist
        if (typeof specificMicroscopeService.home_stage !== 'function' || 
            typeof specificMicroscopeService.return_stage !== 'function') {
          throw new Error(`Service connected but missing essential methods (home_stage, return_stage)`);
        }
        addWorkflowMessage(`✓ Service connected to Microscope ${microscopeNumber} (basic verification passed)`);
      }
      
      return specificMicroscopeService;
    } catch (error) {
      addWorkflowMessage(`✗ Failed to connect to Microscope ${microscopeNumber}: ${error.message}`);
      appendLog(`Connection failed for ${targetMicroscopeId}: ${error.message}`);
      throw error;
    }
  };

  // Helper function to check for microscope conflicts
  const checkMicroscopeConflict = async (microscopeNumber) => {
    try {
      const allSlotInfo = await incubatorControlService.get_slot_information();
      if (Array.isArray(allSlotInfo)) {
        const conflictSample = allSlotInfo.find(slot => 
          slot && slot.location === `microscope${microscopeNumber}`
        );
        return conflictSample;
      }
    } catch (error) {
      console.error('Error checking microscope conflict:', error);
      return null;
    }
    return null;
  };

  // Helper function to transfer sample from microscope to incubator slot
  const transferFromMicroscopeToSlot = async (microscopeNumber, targetSlot) => {
    clearWorkflowMessages();
    setCurrentOperation('transferring');
    
    let specificMicroscopeService = null;
    let armConnected = false;
    let armLightOn = false;
    
    try {
      addWorkflowMessage(`Preparing to transfer sample from Microscope ${microscopeNumber} to slot ${targetSlot}`);
      
      // Service availability checks
      if (!incubatorControlService) {
        const errorMsg = `Incubator service not available. Service object: ${incubatorControlService}`;
        addWorkflowMessage(`Debug: ${errorMsg}`);
        throw new Error("Incubator service not available");
      }
      
      if (!roboticArmService) {
        const errorMsg = `Robotic arm service not available. Service object: ${roboticArmService}`;
        addWorkflowMessage(`Debug: ${errorMsg}`);
        appendLog(`Transfer failed: Robotic arm service unavailable. This operation requires access to the robotic arm.`);
        throw new Error("Robotic arm service not available");
      }

      // Get the specific microscope service for the target microscope
      addWorkflowMessage(`Getting specific service for Microscope ${microscopeNumber}...`);
      specificMicroscopeService = await getSpecificMicroscopeService(microscopeNumber);
      
      // CRITICAL SAFETY CHECK: Home the microscope stage first and verify success
      addWorkflowMessage(`SAFETY CHECK: Homing microscope stage for Microscope ${microscopeNumber}...`);
      try {
        const homeResult = await specificMicroscopeService.home_stage();
        if (homeResult && homeResult.success === false) {
          throw new Error(`Microscope homing failed: ${homeResult.message || 'Unknown error'}`);
        }
        addWorkflowMessage(`✓ Microscope ${microscopeNumber} stage homed successfully - SAFE TO PROCEED`);
      } catch (homeError) {
        addWorkflowMessage(`✗ CRITICAL ERROR: Microscope homing failed - ${homeError.message}`);
        appendLog(`SAFETY ABORT: Microscope ${microscopeNumber} failed to home. Robotic arm operations cancelled to prevent collision.`);
        throw new Error(`Microscope homing failed: ${homeError.message}. Aborting for safety.`);
      }
      
      // Only proceed with robotic arm if microscope homing was successful
      addWorkflowMessage(`Connecting to robotic arm (microscope safely homed)...`);
      await roboticArmService.connect();
      armConnected = true;
      
      addWorkflowMessage(`Turning on robotic arm light...`);
      await roboticArmService.light_on();
      armLightOn = true;
      
      addWorkflowMessage(`Initiating sample transport from microscope ${microscopeNumber} to incubator...`);
      const transportResult = await roboticArmService.microscope_to_incubator(microscopeNumber);
      if (transportResult && transportResult.success === false) {
        throw new Error(`Robotic arm transport failed: ${transportResult.message || 'Unknown error'}`);
      }
      addWorkflowMessage("✓ Sample transported to incubator transfer station");
      
      addWorkflowMessage(`Moving sample from transfer station to slot ${targetSlot}...`);
      await incubatorControlService.put_sample_from_transfer_station_to_slot(targetSlot);
      addWorkflowMessage(`✓ Sample moved to incubator slot ${targetSlot}`);
      
      // Return microscope stage to ready position
      addWorkflowMessage(`Returning microscope ${microscopeNumber} stage to ready position...`);
      await specificMicroscopeService.return_stage();
      addWorkflowMessage(`✓ Microscope ${microscopeNumber} stage returned to ready position`);
      
      // Clean up robotic arm
      if (armLightOn) {
        await roboticArmService.light_off();
        addWorkflowMessage("✓ Robotic arm light turned off");
      }
      if (armConnected) {
        await roboticArmService.disconnect();
        addWorkflowMessage("✓ Robotic arm disconnected");
      }
      
      addWorkflowMessage("✓ Sample successfully transferred to incubator slot");
      setCurrentOperation(null);
      return true;
      
    } catch (error) {
      addWorkflowMessage(`✗ Error during transfer: ${error.message}`);
      appendLog(`Transfer operation failed: ${error.message}`);
      
      // Emergency cleanup - turn off robotic arm if it was activated
      try {
        if (armLightOn && roboticArmService) {
          addWorkflowMessage("Emergency cleanup: Turning off robotic arm light...");
          await roboticArmService.light_off();
        }
        if (armConnected && roboticArmService) {
          addWorkflowMessage("Emergency cleanup: Disconnecting robotic arm...");
          await roboticArmService.disconnect();
        }
      } catch (cleanupError) {
        addWorkflowMessage(`Warning: Cleanup failed: ${cleanupError.message}`);
        appendLog(`Warning: Emergency cleanup failed: ${cleanupError.message}`);
      }
      
      setCurrentOperation(null);
      throw error;
    }
  };

  const handleAddSample = async () => {
    // Validate sample name using the validated input
    if (!sampleNameInput.validateAndUpdate()) {
      setWarningMessage('Please fix the sample name validation errors before adding the sample.');
      return;
    }
    
    // Validate required fields
    const missingFields = [];
    if (!sampleForm.name.trim()) missingFields.push('Sample Name');
    if (!sampleForm.status.trim()) missingFields.push('Status');
    if (!sampleForm.well_plate_type.trim()) missingFields.push('Well Plate Type');
    
    if (missingFields.length > 0) {
      setWarningMessage(`Please fill in the required fields: ${missingFields.join(', ')}`);
      return;
    }

    if (!incubatorControlService) {
      appendLog('Incubator service not available');
      return;
    }

    // Handle special position workflows
    if (sampleForm.status === 'incubator_transfer_station') {
      try {
        setCurrentOperation('transferring');
        clearWorkflowMessages();
        addWorkflowMessage(`Moving sample from transfer station to slot ${selectedSlotNumber}`);
        await incubatorControlService.put_sample_from_transfer_station_to_slot(selectedSlotNumber);
        
        // Add the sample with correct location
        const result = await incubatorControlService.add_sample(
          selectedSlotNumber,
          sampleForm.name,
          'IN', // Set status to IN since it's now in the incubator
          'incubator_slot', // Set location to incubator_slot
          sampleForm.date_to_incubator,
          sampleForm.well_plate_type
        );
        addWorkflowMessage("Sample successfully moved from transfer station to incubator slot");
        appendLog(result);
        await fetchSlotInformation();
        setWarningMessage('');
        setCurrentOperation(null); // Re-enable UI
        closeSidebar();
      } catch (error) {
        setWarningMessage(`Failed to transfer sample from transfer station: ${error.message}`);
        appendLog(`Failed to transfer sample from transfer station: ${error.message}`);
        setCurrentOperation(null); // Re-enable UI even on error
      }
      return;
    }

    if (sampleForm.status === 'microscope1' || sampleForm.status === 'microscope2' || sampleForm.status === 'microscope3') {
      const microscopeNumber = sampleForm.status === 'microscope1' ? 1 : 
                              sampleForm.status === 'microscope2' ? 2 : 3;
      
      try {
        // Check for conflicts on the target microscope
        const conflictSample = await checkMicroscopeConflict(microscopeNumber);
        if (conflictSample) {
          setWarningMessage(`Conflict detected: There is already a sample resistered in incubator on Microscope ${microscopeNumber} (${conflictSample.name}).`);
          return;
        }
        
        // Transfer sample from microscope to the target slot
        await transferFromMicroscopeToSlot(microscopeNumber, selectedSlotNumber);
        
        // Add the sample with correct location
        const result = await incubatorControlService.add_sample(
          selectedSlotNumber,
          sampleForm.name,
          'IN', // Set status to IN since it's now in the incubator
          'incubator_slot', // Set location to incubator_slot
          sampleForm.date_to_incubator,
          sampleForm.well_plate_type
        );
        appendLog(result);
        await fetchSlotInformation();
        setWarningMessage('');
        closeSidebar();
      } catch (error) {
        setWarningMessage(`Failed to transfer sample from microscope: ${error.message}`);
        appendLog(`Failed to transfer sample from microscope: ${error.message}`);
      }
      return;
    }

    // Standard workflow for regular status options
    try {
      const result = await incubatorControlService.add_sample(
        selectedSlotNumber,
        sampleForm.name,
        sampleForm.status,
        sampleForm.location,
        sampleForm.date_to_incubator,
        sampleForm.well_plate_type
      );
      appendLog(result);
      await fetchSlotInformation(); // Refresh slot data
      setWarningMessage(''); // Clear any existing warning
      closeSidebar();
    } catch (error) {
      appendLog(`Failed to add sample: ${error.message}`);
    }
  };

  const handleRemoveSample = async () => {
    if (!incubatorControlService) {
      appendLog('Incubator service not available');
      return;
    }

    try {
      const result = await incubatorControlService.remove_sample(selectedSlotNumber);
      appendLog(result);
      await fetchSlotInformation(); // Refresh slot data
      closeSidebar();
    } catch (error) {
      appendLog(`Failed to remove sample: ${error.message}`);
    }
  };

  const handleEditSample = async () => {
    // Validate sample name using the validated input
    if (!sampleNameInput.validateAndUpdate()) {
      setWarningMessage('Please fix the sample name validation errors before saving changes.');
      return;
    }
    
    // Validate required fields first
    const missingFields = [];
    if (!sampleForm.name.trim()) missingFields.push('Sample Name');
    if (!sampleForm.status.trim()) missingFields.push('Status');
    if (!sampleForm.well_plate_type.trim()) missingFields.push('Well Plate Type');
    
    if (missingFields.length > 0) {
      setWarningMessage(`Please fill in the required fields: ${missingFields.join(', ')}`);
      return;
    }

    // For editing, we remove the old sample and add a new one
    try {
      setWarningMessage(''); // Clear any existing warning
      await handleRemoveSample();
      await handleAddSample();
    } catch (error) {
      appendLog(`Failed to edit sample: ${error.message}`);
    }
  };

  const renderSlots = () => {
    return slotsInfo.map((slot, index) => {
      const slotNumber = index + 1;
      const isOrange = slot.name && slot.name.trim();
      const bgColor = isOrange ? '#f97316' : '#22c55e'; // orange vs green
      return (
        <button
          key={slotNumber}
          style={{ backgroundColor: bgColor, cursor: currentOperation ? 'not-allowed' : 'pointer' }}
          className={`w-8 h-8 m-1 rounded ${currentOperation ? 'opacity-50' : 'hover:opacity-80'}`}
          onDoubleClick={() => !currentOperation && handleSlotDoubleClick(slot, slotNumber)}
          disabled={currentOperation}
          title={currentOperation ? 'Operation in progress' : `Slot ${slotNumber}${isOrange ? ` - ${slot.name}` : ' - Empty'}`}
        >
          {slotNumber}
        </button>
      );
    });
  };

  const isSlotEmpty = !selectedSlot || !selectedSlot.name || !selectedSlot.name.trim();

  return (
    <div className="control-view flex relative">
      {/* Loading overlay to prevent interactions during operations */}
      {currentOperation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" style={{ cursor: 'not-allowed' }}>
          <div className="bg-white p-6 rounded-lg shadow-lg max-w-md mx-4">
            <div className="flex items-center mb-4">
              <i className="fas fa-spinner fa-spin text-blue-500 mr-3 text-xl"></i>
              <h3 className="text-lg font-semibold">Sample Operation in Progress</h3>
            </div>
            <p className="text-gray-600 mb-4">
              Please wait while the sample transfer completes. Do not interact with the interface.
            </p>
            {workflowMessages.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 max-h-32 overflow-y-auto">
                <h6 className="text-sm font-semibold mb-2 text-blue-700">Current Progress:</h6>
                <ul className="text-xs space-y-1">
                  {workflowMessages.slice(0, 3).map((msg, index) => (
                    <li key={index} className="text-blue-600">
                      <i className="fas fa-circle-notch text-blue-500 mr-2"></i>
                      {msg.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Main incubator control panel */}
      <div className={`bg-white bg-opacity-95 p-6 rounded-lg shadow-lg border-l border-gray-300 box-border overflow-y-auto transition-all duration-300 ${sidebarOpen ? 'w-2/3' : 'w-full'} ${currentOperation ? 'pointer-events-none' : ''}`} style={{ cursor: currentOperation ? 'not-allowed' : 'default' }}>
        <h3 className="text-xl font-medium mb-4">Incubator Control</h3>
        <div id="incubator-control-content">
          <div className="incubator-settings">
            {/* Service Status Indicator */}
            <div className="mb-4 p-2 border rounded bg-gray-50">
              <h4 className="text-sm font-medium mb-2">Service Status</h4>
              <div className="grid grid-cols-1 gap-1 text-xs">
                <div className="flex items-center">
                  <i className={`fas ${incubatorControlService ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} mr-2`}></i>
                  <span>Incubator Service: {incubatorControlService ? 'Connected' : 'Disconnected'}</span>
                </div>
                <div className="flex items-center">
                  <i className={`fas ${microscopeControlService ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} mr-2`}></i>
                  <span>Microscope Service: {microscopeControlService ? 'Connected' : 'Disconnected'}</span>
                </div>
                <div className="flex items-center">
                  <i className={`fas ${roboticArmService ? 'fa-check-circle text-green-500' : 'fa-times-circle text-red-500'} mr-2`}></i>
                  <span>Robotic Arm Service: {roboticArmService ? 'Connected' : 'Disconnected'}</span>
                </div>
                {selectedMicroscopeId && (
                  <div className="flex items-center mt-1">
                    <i className="fas fa-microscope text-blue-500 mr-2"></i>
                    <span className="text-blue-600">Currently Selected: {selectedMicroscopeId}</span>
                  </div>
                )}
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-blue-800">
                  <div className="text-xs">
                    <i className="fas fa-info-circle mr-1"></i>
                    <strong>Transfer Operations:</strong>
                    <br />• "From Microscope 1/2" will connect to specific microscope services
                    <br />• Each operation verifies microscope safety before robotic arm movement
                  </div>
                </div>
                {(!incubatorControlService || !roboticArmService || !hyphaManager) && (
                  <div className="mt-2 p-2 bg-red-100 border border-red-300 rounded text-red-800">
                    <i className="fas fa-exclamation-triangle mr-1"></i>
                    <span className="text-xs">
                      Transfer operations require: Incubator Service, Robotic Arm Service, and HyphaManager
                      {!hyphaManager && <><br />• HyphaManager: Missing - cannot connect to specific microscopes</>}
                    </span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium">Temperature (°C):</label>
              <input
                type="number"
                className="mt-1 block w-full border border-gray-300 rounded p-2"
                value={temperature}
                readOnly
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium">CO2 (%):</label>
              <input
                type="number"
                className="mt-1 block w-full border border-gray-300 rounded p-2"
                value={CO2}
                readOnly
              />
            </div>
            <button
              className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600"
              onClick={updateSettings}
            >
              Update Settings
            </button>
            {/* New container for Microplate Racks */}
            <div className="rounded-lg border border-gray-300 p-4 mt-4">
              <h4 className="text-lg font-bold mb-2 text-center">Microplate Slots</h4>
              <p className="text-sm text-gray-600 mb-2 text-center">Double-click a slot to manage samples</p>
              <div className="grid grid-cols-2 gap-x-1 gap-y-1">
                <div className="grid grid-cols-1">
                  {renderSlots().slice(0, 21).reverse()}
                </div>
                <div className="grid grid-cols-1">
                  {renderSlots().slice(21).reverse()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar for slot management */}
      {sidebarOpen && (
        <div className={`w-1/3 bg-white bg-opacity-95 shadow-lg border-l border-gray-300 p-4 overflow-y-auto ${currentOperation ? 'pointer-events-none opacity-75' : ''}`} style={{ cursor: currentOperation ? 'not-allowed' : 'default' }}>
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-bold">
              Slot {selectedSlotNumber} Management
            </h4>
            <button 
              onClick={() => !currentOperation && closeSidebar()} 
              className={`text-xl font-bold ${currentOperation ? 'text-gray-400 cursor-not-allowed' : 'text-red-500 hover:text-red-700'}`}
              disabled={currentOperation}
              title={currentOperation ? 'Cannot close during operation' : 'Close'}
            >
              ×
            </button>
          </div>

          {isSlotEmpty ? (
            /* Add new sample form */
            <div>
              <h5 className="font-medium mb-3 text-green-600">Add New Sample</h5>
              {warningMessage && (
                <div className="mb-3 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  {warningMessage}
                </div>
              )}
              {workflowMessages.length > 0 && (
                <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded max-h-32 overflow-y-auto">
                  <h6 className="text-sm font-semibold mb-2 text-blue-700">Operation Progress:</h6>
                  <ul className="text-xs space-y-1">
                    {workflowMessages.map((msg, index) => (
                      <li key={index} className="text-blue-600">
                        <i className="fas fa-circle-notch text-blue-500 mr-2"></i>
                        {msg.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Sample Name: <span className="text-red-500">*</span></label>
                  <div className="input-container">
                    <input
                      type="text"
                      className={`w-full border rounded p-2 ${getInputValidationClasses(
                        sampleNameInput.isValid,
                        sampleNameInput.hasUnsavedChanges,
                        'border-gray-300'
                      )}`}
                      value={sampleNameInput.inputValue}
                      onChange={sampleNameInput.handleInputChange}
                      onKeyDown={sampleNameInput.handleKeyDown}
                      onBlur={sampleNameInput.handleBlur}
                      placeholder="Enter sample name (no special characters)"
                    />
                  </div>
                  {!sampleNameInput.isValid && sampleNameInput.hasUnsavedChanges && (
                    <p className="text-xs text-red-500 mt-1">
                      {(() => {
                        const validation = validateStringInput(sampleNameInput.inputValue, {
                          minLength: 1,
                          maxLength: 50,
                          allowEmpty: false,
                          forbiddenChars: ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
                          trim: true
                        });
                        return validation.error || 'Invalid sample name';
                      })()}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Status/Position: <span className="text-red-500">*</span></label>
                  <select
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.status}
                    onChange={(e) => handleFormChange('status', e.target.value)}
                  >
                    <option value="IN">IN (Normal incubator slot)</option>
                    <option value="OUT">OUT</option>
                    <option value="Not Available">Not Available</option>
                    <option value="incubator_transfer_station">From Incubator Transfer Station</option>
                    <option value="microscope1">From Microscope 1 (⚠️ Safety verified transfer)</option>
                    <option value="microscope2">From Microscope 2 (⚠️ Safety verified transfer)</option>
                    <option value="microscope3">From Squid+ Microscope 1 (⚠️ Safety verified transfer)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date to Incubator:</label>
                  <input
                    type="datetime-local"
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.date_to_incubator}
                    onChange={(e) => handleFormChange('date_to_incubator', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Well Plate Type: <span className="text-red-500">*</span></label>
                  <select
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.well_plate_type}
                    onChange={(e) => handleFormChange('well_plate_type', e.target.value)}
                  >
                    <option value="96">96-well</option>
                    <option value="384">384-well</option>
                    <option value="24">24-well</option>
                    <option value="48">48-well</option>
                  </select>
                </div>
                <button
                  onClick={handleAddSample}
                  className={`save-changes-button ${
                    currentOperation 
                      ? 'cursor-not-allowed' 
                      : ''
                  }`}
                  disabled={currentOperation !== null}
                >
                  {currentOperation === 'transferring' ? (
                    <span>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      Processing Transfer...
                    </span>
                  ) : (
                    'Add Sample'
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* Existing sample management */
            <div>
              {!isEditing ? (
                /* Display mode */
                <div>
                  <h5 className="font-medium mb-3 text-blue-600">Sample Information</h5>
                  <div className="space-y-2 mb-4">
                    <p><strong>Name:</strong> {selectedSlot.name}</p>
                    <p><strong>Status:</strong> {selectedSlot.status}</p>
                    <p><strong>Location:</strong> {selectedSlot.location}</p>
                    <p><strong>Date to Incubator:</strong> {selectedSlot.date_to_incubator}</p>
                    <p><strong>Well Plate Type:</strong> {selectedSlot.well_plate_type}</p>
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={() => setIsEditing(true)}
                      className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
                    >
                      Edit Sample
                    </button>
                    <button
                      onClick={handleRemoveSample}
                      className="w-full bg-red-500 text-white p-2 rounded hover:bg-red-600"
                    >
                      Remove Sample
                    </button>
                  </div>
                </div>
              ) : (
                /* Edit mode */
                <div>
                  <h5 className="font-medium mb-3 text-orange-600">Edit Sample</h5>
                  {warningMessage && (
                    <div className="mb-3 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                      {warningMessage}
                    </div>
                  )}
                  {workflowMessages.length > 0 && (
                    <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded max-h-32 overflow-y-auto">
                      <h6 className="text-sm font-semibold mb-2 text-blue-700">Operation Progress:</h6>
                      <ul className="text-xs space-y-1">
                        {workflowMessages.map((msg, index) => (
                          <li key={index} className="text-blue-600">
                            <i className="fas fa-circle-notch text-blue-500 mr-2"></i>
                            {msg.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Sample Name:</label>
                      <div className="input-container">
                        <input
                          type="text"
                          className={`w-full border rounded p-2 ${getInputValidationClasses(
                            sampleNameInput.isValid,
                            sampleNameInput.hasUnsavedChanges,
                            'border-gray-300'
                          )}`}
                          value={sampleNameInput.inputValue}
                          onChange={sampleNameInput.handleInputChange}
                          onKeyDown={sampleNameInput.handleKeyDown}
                          onBlur={sampleNameInput.handleBlur}
                          placeholder="Enter sample name (no special characters)"
                        />
                      </div>
                      {!sampleNameInput.isValid && sampleNameInput.hasUnsavedChanges && (
                        <p className="text-xs text-red-500 mt-1">
                          {(() => {
                            const validation = validateStringInput(sampleNameInput.inputValue, {
                              minLength: 1,
                              maxLength: 50,
                              allowEmpty: false,
                              forbiddenChars: ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
                              trim: true
                            });
                            return validation.error || 'Invalid sample name';
                          })()}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Status/Position:</label>
                      <select
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.status}
                        onChange={(e) => handleFormChange('status', e.target.value)}
                      >
                        <option value="">Select status/position</option>
                        <option value="IN">IN (Normal incubator slot)</option>
                        <option value="OUT">OUT</option>
                        <option value="Not Available">Not Available</option>
                        <option value="incubator_transfer_station">From Incubator Transfer Station</option>
                        <option value="microscope1">From Microscope 1 (⚠️ Safety verified transfer)</option>
                        <option value="microscope2">From Microscope 2 (⚠️ Safety verified transfer)</option>
                        <option value="microscope3">From Squid+ Microscope 1 (⚠️ Safety verified transfer)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Date to Incubator:</label>
                      <input
                        type="datetime-local"
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.date_to_incubator}
                        onChange={(e) => handleFormChange('date_to_incubator', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Well Plate Type:</label>
                      <select
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.well_plate_type}
                        onChange={(e) => handleFormChange('well_plate_type', e.target.value)}
                      >
                        <option value="96">96-well</option>
                        <option value="384">384-well</option>
                        <option value="24">24-well</option>
                        <option value="48">48-well</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <button
                        onClick={handleEditSample}
                        className={`save-changes-button ${
                          currentOperation 
                            ? 'cursor-not-allowed' 
                            : (!sampleForm.name.trim() || !sampleForm.status.trim() || !sampleForm.well_plate_type.trim())
                              ? 'cursor-not-allowed'
                              : ''
                        }`}
                        disabled={currentOperation !== null || !sampleForm.name.trim() || !sampleForm.status.trim() || !sampleForm.well_plate_type.trim()}
                      >
                        {currentOperation === 'transferring' ? (
                          <span>
                            <i className="fas fa-spinner fa-spin mr-2"></i>
                            Processing Transfer...
                          </span>
                        ) : (
                          'Save Changes'
                        )}
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="w-full bg-gray-500 text-white p-2 rounded hover:bg-gray-600"
                        style={{ backgroundColor: '#6c757d', color: 'white' }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

IncubatorControl.propTypes = {
  incubatorControlService: PropTypes.object,
  appendLog: PropTypes.func.isRequired,
  microscopeControlService: PropTypes.object,
  roboticArmService: PropTypes.object,
  selectedMicroscopeId: PropTypes.string,
  hyphaManager: PropTypes.object,
  currentOperation: PropTypes.string,
  setCurrentOperation: PropTypes.func.isRequired,
};

export default IncubatorControl;
