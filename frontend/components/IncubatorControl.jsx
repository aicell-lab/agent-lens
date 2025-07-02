import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const IncubatorControl = ({ 
  incubatorControlService, 
  appendLog,
  microscopeControlService,
  roboticArmService,
  selectedMicroscopeId 
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
  
  // State for operation tracking
  const [currentOperation, setCurrentOperation] = useState(null);
  const [workflowMessages, setWorkflowMessages] = useState([]);
  
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
    // Clear warning when user starts typing
    if (warningMessage) {
      setWarningMessage('');
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
    
    try {
      addWorkflowMessage(`Preparing to transfer sample from Microscope ${microscopeNumber} to slot ${targetSlot}`);
      
      if (!microscopeControlService) {
        throw new Error("Microscope service not available");
      }
      
      if (!roboticArmService) {
        throw new Error("Robotic arm service not available");
      }
      
      addWorkflowMessage(`Homing microscope stage for Microscope ${microscopeNumber}`);
      await microscopeControlService.home_stage();
      addWorkflowMessage(`Microscope ${microscopeNumber} stage homed successfully`);
      
      await roboticArmService.connect();
      await roboticArmService.light_on();
      
      addWorkflowMessage(`Transporting sample from microscope ${microscopeNumber} to incubator`);
      await roboticArmService.microscope_to_incubator(microscopeNumber);
      addWorkflowMessage("Sample transported to incubator transfer station");
      
      await incubatorControlService.put_sample_from_transfer_station_to_slot(targetSlot);
      addWorkflowMessage(`Sample moved to incubator slot ${targetSlot}`);
      
      await microscopeControlService.return_stage();
      await roboticArmService.light_off();
      await roboticArmService.disconnect();
      
      addWorkflowMessage("Sample successfully transferred to incubator slot");
      setCurrentOperation(null);
      return true;
    } catch (error) {
      addWorkflowMessage(`Error during transfer: ${error.message}`);
      setCurrentOperation(null);
      throw error;
    }
  };

  const handleAddSample = async () => {
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
        closeSidebar();
      } catch (error) {
        setWarningMessage(`Failed to transfer sample from transfer station: ${error.message}`);
        appendLog(`Failed to transfer sample from transfer station: ${error.message}`);
      }
      return;
    }

    if (sampleForm.status === 'microscope1' || sampleForm.status === 'microscope2') {
      const microscopeNumber = sampleForm.status === 'microscope1' ? 1 : 2;
      
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
          style={{ backgroundColor: bgColor }}
          className="w-8 h-8 m-1 rounded hover:opacity-80"
          onDoubleClick={() => handleSlotDoubleClick(slot, slotNumber)}
          title={`Slot ${slotNumber}${isOrange ? ` - ${slot.name}` : ' - Empty'}`}
        >
          {slotNumber}
        </button>
      );
    });
  };

  const isSlotEmpty = !selectedSlot || !selectedSlot.name || !selectedSlot.name.trim();

  return (
    <div className="control-view flex relative">
      {/* Main incubator control panel */}
      <div className={`bg-white bg-opacity-95 p-6 rounded-lg shadow-lg border-l border-gray-300 box-border overflow-y-auto transition-all duration-300 ${sidebarOpen ? 'w-2/3' : 'w-full'}`}>
        <h3 className="text-xl font-medium mb-4">Incubator Control</h3>
        <div id="incubator-control-content">
          <div className="incubator-settings">
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
        <div className="w-1/3 bg-white bg-opacity-95 shadow-lg border-l border-gray-300 p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-bold">
              Slot {selectedSlotNumber} Management
            </h4>
            <button 
              onClick={closeSidebar} 
              className="text-red-500 hover:text-red-700 text-xl font-bold"
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
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder="Enter sample name"
                  />
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
                    <option value="microscope1">From Microscope 1</option>
                    <option value="microscope2">From Microscope 2</option>
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
                  className={`w-full p-2 rounded text-white ${
                    currentOperation 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-green-500 hover:bg-green-600'
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
                      <input
                        type="text"
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.name}
                        onChange={(e) => handleFormChange('name', e.target.value)}
                      />
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
                        <option value="microscope1">From Microscope 1</option>
                        <option value="microscope2">From Microscope 2</option>
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
                        className={`w-full p-2 rounded text-white ${
                          currentOperation 
                            ? 'bg-gray-400 cursor-not-allowed' 
                            : (!sampleForm.name.trim() || !sampleForm.status.trim() || !sampleForm.well_plate_type.trim())
                              ? 'bg-gray-400 cursor-not-allowed opacity-70'
                              : 'bg-orange-500 hover:bg-orange-600'
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
};

export default IncubatorControl;
