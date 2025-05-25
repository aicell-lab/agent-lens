import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// NOTE: Ensure corresponding CSS for .sample-selector-dropdown and .hidden is added.
// .sample-selector-dropdown { position: absolute; top: 50px; /* Adjust as needed */ left: 20px; z-index: 1000; background: white; border: 1px solid #ccc; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 15px; border-radius: 5px; width: 300px; /* Or max-content */ }
// .hidden { display: none; }

const SampleSelector = ({ 
  isVisible, 
  selectedMicroscopeId, 
  microscopeControlService,
  incubatorControlService,
  roboticArmService,
  currentOperation,
  setCurrentOperation
}) => {
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [incubatorSlots, setIncubatorSlots] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);
  const [roboticArmServiceState, setRoboticArmServiceState] = useState(null);
  const [workflowMessages, setWorkflowMessages] = useState([]);
  // Track loaded sample ID on current microscope
  const [loadedSampleOnMicroscope, setLoadedSampleOnMicroscope] = useState(null);

  // Define the mapping of sample IDs to their data aliases
  const sampleDataAliases = {
    'simulated-sample-1': 'agent-lens/20250506-scan-time-lapse-2025-05-06_17-56-38',
    'simulated-sample-2': 'agent-lens/20250429-scan-time-lapse-2025-04-29_15-38-36',
    'simulated-sample-3': 'agent-lens/hpa-sample-2025-01-14_15-00-51'
  };
  
  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
                                selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'squid-control/squid-control-reef';
  const currentMicroscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 
                                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 2 : 0;

  // Helper function to add workflow messages
  const addWorkflowMessage = (message) => {
    setWorkflowMessages(prev => [{ message, timestamp: Date.now() }, ...prev]);
  };

  // Clear workflow messages
  const clearWorkflowMessages = () => {
    setWorkflowMessages([]);
  };

  // Helper function to update sample location
  const updateSampleLocation = async (incubatorSlot, newLocation) => {
    if (!incubatorControlService) return;
    try {
      await incubatorControlService.update_sample_location(incubatorSlot, newLocation);
      addWorkflowMessage(`Sample location updated to: ${newLocation}`);
      
      // If this is a location related to a microscope, track the loaded sample
      if (newLocation === 'microscope1' || newLocation === 'microscope2') {
        setLoadedSampleOnMicroscope(`slot-${incubatorSlot}`);
      } else if (newLocation === 'incubator_slot') {
        setLoadedSampleOnMicroscope(null);
      }
      
      // Refresh the slots data after location update
      await fetchIncubatorData();
    } catch (error) {
      console.error(`Failed to update sample location to ${newLocation}:`, error);
      addWorkflowMessage(`Error updating sample location: ${error.message}`);
    }
  };

  // Connect to robotic arm service when real microscope is selected
  useEffect(() => {
    const connectToRoboticArm = async () => {
      if (isRealMicroscopeSelected && !roboticArmService) {
        try {
          const robotic_arm_id = "reef-imaging/mirror-robotic-arm-control";
          
          // This is a placeholder for the actual connection method
          // In a real application, you would need to properly connect to the service
          const service = {
            connect: async () => addWorkflowMessage("Connected to robotic arm"),
            disconnect: async () => addWorkflowMessage("Disconnected from robotic arm"),
            light_on: async () => addWorkflowMessage("Robotic arm light turned on"),
            light_off: async () => addWorkflowMessage("Robotic arm light turned off"),
            grab_sample_from_incubator: async () => addWorkflowMessage("Sample grabbed from incubator"),
            incubator_to_microscope: async (microscopeNumber) => addWorkflowMessage(`Sample transported to microscope ${microscopeNumber}`),
            microscope_to_incubator: async (microscopeNumber) => addWorkflowMessage(`Sample transported from microscope ${microscopeNumber} to incubator`),
            put_sample_on_incubator: async () => addWorkflowMessage("Sample placed on incubator")
          };
          
          setRoboticArmServiceState(service);
          addWorkflowMessage("Robotic arm service initialized");
        } catch (error) {
          console.error("Failed to connect to robotic arm service:", error);
          setLoadingStatus("Failed to connect to robotic arm. Please try again.");
          setTimeout(() => setLoadingStatus(''), 3000);
        }
      }
    };

    connectToRoboticArm();
  }, [isRealMicroscopeSelected, roboticArmService]);

  // Load current data alias when component becomes visible
  useEffect(() => {
    const fetchCurrentSample = async () => {
      if (isVisible && isSimulatedMicroscopeSelected && microscopeControlService) {
        try {
          const currentDataAlias = await microscopeControlService.get_simulated_sample_data_alias();
          // Find the sample ID that matches the current data alias
          const matchingSampleId = Object.entries(sampleDataAliases)
            .find(([_, alias]) => alias === currentDataAlias)?.[0];
          
          if (matchingSampleId) {
            setSelectedSampleId(matchingSampleId);
            setIsSampleLoaded(true);
          }
        } catch (error) {
          console.error('Failed to get current simulated sample:', error);
        }
      }
    };

    fetchCurrentSample();
  }, [isVisible, isSimulatedMicroscopeSelected, microscopeControlService]);

  // Fetch incubator data when microscope selection changes or after location updates
  const fetchIncubatorData = async () => {
    if (incubatorControlService && 
        (selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
          selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2')) {
      try {
        // Get information for all slots at once
        const allSlotInfo = await incubatorControlService.get_slot_information();
        const slots = (allSlotInfo || []).filter(slotInfo => 
          slotInfo && slotInfo.name && slotInfo.name.trim()
        ).map(slotInfo => ({
          ...slotInfo,
          id: `slot-${slotInfo.incubator_slot}`
        }));
        
        // Check if any samples are loaded on the current microscope
        const samplesOnCurrentMicroscope = slots.filter(slot => 
          slot.location === `microscope${currentMicroscopeNumber}`
        );
        
        if (samplesOnCurrentMicroscope.length > 0) {
          // If a sample is already on this microscope, set it as selected and loaded
          setSelectedSampleId(samplesOnCurrentMicroscope[0].id);
          setIsSampleLoaded(true);
          setLoadedSampleOnMicroscope(samplesOnCurrentMicroscope[0].id);
        } else {
          // No sample on this microscope
          setIsSampleLoaded(false);
          
          // Clear selected sample if it was previously set for this microscope
          if (selectedSampleId && selectedSampleId.startsWith('slot-')) {
            const selectedSlot = slots.find(slot => slot.id === selectedSampleId);
            if (!selectedSlot || selectedSlot.location !== 'incubator_slot') {
              setSelectedSampleId(null);
            }
          }
        }
        
        setIncubatorSlots(slots);
      } catch (error) {
        console.error("[SampleSelector] Failed to fetch incubator slots:", error);
        setIncubatorSlots([]);
        setIsSampleLoaded(false);
        setSelectedSampleId(null);
      }
    } else {
      setIncubatorSlots([]); 
      setSelectedSampleId(null); 
      setIsSampleLoaded(false);
    }
  };

  // Call fetchIncubatorData when microscope selection changes
  useEffect(() => {
    if (selectedMicroscopeId) { 
      fetchIncubatorData();
    }
  }, [selectedMicroscopeId, incubatorControlService]);

  const handleSampleSelect = (sampleId) => {
    setSelectedSampleId(sampleId);
    console.log(`Sample selected: ${sampleId}`);
  };

  const handleLoadSample = async () => {
    if (!selectedSampleId) {
      console.log('No sample selected to load.');
      return;
    }

    // Clear previous workflow messages
    clearWorkflowMessages();
    
    if (isSimulatedMicroscopeSelected) {
      setLoadingStatus('Loading sample...'); // Set loading status
      setCurrentOperation('loading');
      try {
        addWorkflowMessage("Loading simulated sample...");
        const dataAlias = sampleDataAliases[selectedSampleId];
        if (dataAlias) {
          await microscopeControlService.set_simulated_sample_data_alias(dataAlias);
          addWorkflowMessage(`Loaded ${selectedSampleId}`);
        } else {
          throw new Error(`No data alias found for ${selectedSampleId}`);
        }
        setLoadingStatus('Sample loaded!'); // Update status on success
        setIsSampleLoaded(true);
        setCurrentOperation(null);
        // Auto-clear message after 3 seconds
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to load simulated sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus('Error loading sample'); // Show error status
        setCurrentOperation(null);
        // Auto-clear error message after 3 seconds
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    } else {
      // For real microscopes - Add validation and logging
      console.log(`[SampleSelector] Loading sample on microscope. Selected ID: ${selectedMicroscopeId}`);
      console.log(`[SampleSelector] Microscope control service:`, microscopeControlService);
      
      // Validation: Ensure we have the correct microscope service
      if (!microscopeControlService) {
        addWorkflowMessage("Error: No microscope service available");
        setLoadingStatus('Error: No microscope service available');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }

      const expectedMicroscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 2;
      addWorkflowMessage(`Preparing to load sample on Microscope ${expectedMicroscopeNumber}`);
      console.log(`[SampleSelector] Expected microscope number: ${expectedMicroscopeNumber}`);
      
      setLoadingStatus('Loading sample from incubator...'); 
      setCurrentOperation('loading');
      
      try {
        // Get incubator slot number from the selected sample ID
        const slotMatch = selectedSampleId.match(/slot-(\d+)/);
        if (!slotMatch) {
          throw new Error("Invalid slot ID format");
        }
        
        const incubatorSlot = parseInt(slotMatch[1], 10);
        addWorkflowMessage(`Loading sample from incubator slot ${incubatorSlot}`);
        
        // Check sample status
        const sampleStatus = await incubatorControlService.get_sample_status(incubatorSlot);
        addWorkflowMessage(`Sample status: ${sampleStatus}`);
        
        if (sampleStatus !== "IN") {
          throw new Error("Plate is not inside incubator");
        }
        
        // Use the provided robotic arm service or the locally created one
        const armService = roboticArmService || roboticArmServiceState;
        if (!armService) {
          throw new Error("Robotic arm service not available");
        }
        
        // 1. Incubator releases the sample
        addWorkflowMessage("Getting sample from slot to transfer station");
        await incubatorControlService.get_sample_from_slot_to_transfer_station(incubatorSlot);
        // Update sample location to incubator_station
        await updateSampleLocation(incubatorSlot, "incubator_station");
        addWorkflowMessage("Plate loaded onto transfer station");
        
        // Connect robotic arm and turn on light
        await armService.connect();
        await armService.light_on();
        
        // 2. Home microscope stage - Add validation and logging
        addWorkflowMessage(`Homing microscope stage for Microscope ${expectedMicroscopeNumber}`);
        console.log(`[SampleSelector] About to home stage for microscope ${expectedMicroscopeNumber} with service:`, microscopeControlService);
        await microscopeControlService.home_stage();
        addWorkflowMessage(`Microscope ${expectedMicroscopeNumber} stage homed successfully`);
        
        // 3. Use robotic arm to transport sample to microscope
        const microscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 2;
        
        // Double-check consistency
        if (microscopeNumber !== expectedMicroscopeNumber) {
          throw new Error(`Microscope number mismatch: expected ${expectedMicroscopeNumber}, got ${microscopeNumber}`);
        }
        
        // Update sample location to robotic_arm
        await updateSampleLocation(incubatorSlot, "robotic_arm");
        addWorkflowMessage(`Transporting sample to microscope ${microscopeNumber}`);
        
        // Call the appropriate transport method based on microscope number
        if (microscopeNumber === 1) {
          await armService.incubator_to_microscope(microscopeNumber);
        } else {
          await armService.incubator_to_microscope(microscopeNumber);
        }
        
        // Update sample location to microscope1 or microscope2
        await updateSampleLocation(incubatorSlot, `microscope${microscopeNumber}`);
        addWorkflowMessage("Sample placed on microscope");
        
        // Turn off light and disconnect robotic arm
        await microscopeControlService.return_stage();
        await armService.light_off();
        await armService.disconnect();
        
        addWorkflowMessage("Sample plate successfully loaded onto microscope stage");
        setLoadingStatus('Sample successfully loaded onto microscope.');
        setIsSampleLoaded(true);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to load sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus(`Error loading sample: ${error.message}`);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    }
  };

  const handleUnloadSample = async () => {
    if (!selectedSampleId) {
      console.log('No sample selected to unload.');
      return;
    }

    // Clear previous workflow messages
    clearWorkflowMessages();
    
    if (isSimulatedMicroscopeSelected) {
      setLoadingStatus('Unloading sample...'); 
      setCurrentOperation('unloading');
      try {
        addWorkflowMessage("Unloading simulated sample...");
        // For simulated microscope, just clear the sample
        await microscopeControlService.set_simulated_sample_data_alias('');
        addWorkflowMessage("Sample unloaded successfully");
        setLoadingStatus('Sample unloaded!');
        setIsSampleLoaded(false);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to unload simulated sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus('Error unloading sample');
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    } else {
      // For real microscopes - Add validation and logging
      console.log(`[SampleSelector] Unloading sample from microscope. Selected ID: ${selectedMicroscopeId}`);
      console.log(`[SampleSelector] Microscope control service:`, microscopeControlService);
      
      // Validation: Ensure we have the correct microscope service
      if (!microscopeControlService) {
        addWorkflowMessage("Error: No microscope service available");
        setLoadingStatus('Error: No microscope service available');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }

      const expectedMicroscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 2;
      addWorkflowMessage(`Preparing to unload sample from Microscope ${expectedMicroscopeNumber}`);
      console.log(`[SampleSelector] Expected microscope number: ${expectedMicroscopeNumber}`);
      
      setLoadingStatus('Unloading sample to incubator...'); 
      setCurrentOperation('unloading');
      
      try {
        // Get incubator slot number from the selected sample ID
        const slotMatch = selectedSampleId.match(/slot-(\d+)/);
        if (!slotMatch) {
          throw new Error("Invalid slot ID format");
        }
        
        const incubatorSlot = parseInt(slotMatch[1], 10);
        addWorkflowMessage(`Unloading sample to incubator slot ${incubatorSlot}`);
        
        // Check sample status and location
        const selectedSlot = incubatorSlots.find(slot => slot.id === selectedSampleId);
        if (!selectedSlot || selectedSlot.location !== `microscope${currentMicroscopeNumber}`) {
          throw new Error(`Sample is not on microscope ${currentMicroscopeNumber}`);
        }
        
        // Use the provided robotic arm service or the locally created one
        const armService = roboticArmService || roboticArmServiceState;
        if (!armService) {
          throw new Error("Robotic arm service not available");
        }
        
        // 1. Home microscope stage - Add validation and logging
        addWorkflowMessage(`Homing microscope stage for Microscope ${expectedMicroscopeNumber}`);
        console.log(`[SampleSelector] About to home stage for microscope ${expectedMicroscopeNumber} with service:`, microscopeControlService);
        await microscopeControlService.home_stage();
        addWorkflowMessage(`Microscope ${expectedMicroscopeNumber} stage homed successfully`);
        
        // Connect robotic arm and turn on light
        await armService.connect();
        await armService.light_on();
        
        // 2. Transport from microscope to incubator
        const microscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 2;
        
        // Double-check consistency
        if (microscopeNumber !== expectedMicroscopeNumber) {
          throw new Error(`Microscope number mismatch: expected ${expectedMicroscopeNumber}, got ${microscopeNumber}`);
        }
        
        // Update sample location to robotic_arm
        await updateSampleLocation(incubatorSlot, "robotic_arm");
        addWorkflowMessage(`Transporting sample from microscope ${microscopeNumber} to incubator`);
        
        // Call the appropriate transport method based on microscope number
        if (microscopeNumber === 1) {
          await armService.microscope_to_incubator(microscopeNumber);
        } else {
          await armService.microscope_to_incubator(microscopeNumber);
        }
        // Update sample location to incubator_station
        await updateSampleLocation(incubatorSlot, "incubator_station");
        addWorkflowMessage("Sample transported to incubator");
        
        // 3. Incubator collects the sample
        await incubatorControlService.put_sample_from_transfer_station_to_slot(incubatorSlot);
        
        // Update sample location to incubator_slot
        await updateSampleLocation(incubatorSlot, "incubator_slot");
        addWorkflowMessage("Sample moved to incubator slot");
        
        // Turn off light, disconnect robotic arm, and return microscope stage
        await microscopeControlService.return_stage();
        await armService.light_off();
        await armService.disconnect();
        
        addWorkflowMessage("Sample successfully unloaded from the microscopy stage");
        setLoadingStatus('Sample successfully unloaded to incubator.');
        setIsSampleLoaded(false);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to unload sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus(`Error unloading sample: ${error.message}`);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    }
  };

  // Determine if a sample can be selected based on its location
  const canSelectSample = (slot) => {
    // For simulated microscope, always allow selection
    if (isSimulatedMicroscopeSelected) return true;
    
    // Only samples in incubator_slot can be selected when no sample is loaded
    if (!isSampleLoaded) {
      return slot.location === 'incubator_slot';
    }
    
    // If a sample is already loaded, only the currently loaded sample can be selected
    return slot.location === `microscope${currentMicroscopeNumber}`;
  };

  // Get class name for sample button based on location and selected state
  const getSampleButtonClass = (slot) => {
    let className = 'sample-option'; // Base class from Sidebar.css, can be reused or made specific
    
    // Add selected state
    if (selectedSampleId === slot.id) {
      className += ' active';
    }
    
    // Add color state based on location
    if (slot.location === 'incubator_slot') {
      className += ' green-sample';
    } else {
      className += ' orange-sample';
    }
    
    return className;
  };

  return (
    <div className={`sample-selector-dropdown ${!isVisible ? 'hidden' : ''}`}>
      <h3 className="sample-sidebar-title">Select Sample</h3>
      
      {/* Sample Options Section */}
      <div className="sample-options-container">
        <div className="sample-options">
          {isSimulatedMicroscopeSelected && (
            <>
              <button
                className={`sample-option ${selectedSampleId === 'simulated-sample-1' ? 'active' : ''}`}
                onClick={() => handleSampleSelect('simulated-sample-1')}
                disabled={currentOperation !== null}
              >
                <i className="fas fa-flask"></i> 
                <span>Simulated Sample 1</span>
              </button>
              <button
                className={`sample-option ${selectedSampleId === 'simulated-sample-2' ? 'active' : ''}`}
                onClick={() => handleSampleSelect('simulated-sample-2')}
                disabled={currentOperation !== null}
              >
                <i className="fas fa-flask"></i> 
                <span>Simulated Sample 2</span>
              </button>
              <button
                className={`sample-option ${selectedSampleId === 'simulated-sample-3' ? 'active' : ''}`}
                onClick={() => handleSampleSelect('simulated-sample-3')}
                disabled={currentOperation !== null}
              >
                <i className="fas fa-flask"></i> 
                <span>Simulated Sample 3</span>
              </button>
            </>
          )}
          {isRealMicroscopeSelected && incubatorSlots.length > 0 && incubatorSlots.map(slot => (
            <button
              key={slot.id}
              className={getSampleButtonClass(slot)}
              onClick={() => handleSampleSelect(slot.id)}
              disabled={currentOperation !== null || !canSelectSample(slot)}
            >
              <i className="fas fa-vial"></i> 
              <div className="sample-info">
                <span className="sample-name">{slot.name || `Slot ${slot.incubator_slot}`}</span>
                <span className="sample-location">
                  Location: {slot.location}
                  {slot.location === 'incubator_slot' && ` (Slot #${slot.incubator_slot})`}
                </span>
              </div>
            </button>
          ))}
          {isRealMicroscopeSelected && incubatorSlots.length === 0 && (
                <p className="no-samples-message">No occupied incubator slots found or service unavailable.</p>
          )}
        </div>
        
        {/* Load/Unload Sample Button directly below sample list */}
        <hr className="sidebar-divider" />
        {!isSampleLoaded ? (
          <button 
            className={`load-sample-button ${currentOperation ? 'processing' : ''}`}
            onClick={handleLoadSample}
            disabled={!selectedSampleId || currentOperation !== null}
          >
            <div className="button-content">
              {currentOperation === 'loading' ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  <span>Loading Sample...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-upload"></i>
                  <span>Load Sample on Microscope</span>
                </>
              )}
            </div>
          </button>
        ) : (
          <button 
            className={`unload-sample-button ${currentOperation ? 'processing' : ''}`}
            onClick={handleUnloadSample}
            disabled={!selectedSampleId || currentOperation !== null}
          >
            <div className="button-content">
              {currentOperation === 'unloading' ? (
                <>
                  <i className="fas fa-spinner fa-spin"></i>
                  <span>Unloading Sample...</span>
                </>
              ) : (
                <>
                  <i className="fas fa-download"></i>
                  <span>Unload Sample</span>
                </>
              )}
            </div>
          </button>
        )}
      </div>

      {/* Workflow Messages */}
      {workflowMessages.length > 0 && (
        <div className="workflow-messages-container mt-4 mb-2 border border-gray-200 rounded p-2 bg-gray-50 max-h-48 overflow-y-auto">
          <h4 className="text-sm font-semibold mb-1">Operation Progress:</h4>
          <ul className="workflow-messages text-xs">
            {workflowMessages.map((msg, index) => (
              <li key={index} className="mb-1 py-1 px-2 border-b border-gray-100">
                <span className="operation-step"><i className="fas fa-circle-notch text-blue-500 mr-2"></i>{msg.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Status Message */}
      {loadingStatus && (
        <div className={`sample-loading-status my-2 py-2 px-3 rounded text-center ${
          loadingStatus.includes('successfully') ? 'bg-green-100 text-green-700' : 
          loadingStatus.includes('Error') ? 'bg-red-100 text-red-700' :
          currentOperation === 'loading' || currentOperation === 'unloading' ? 'bg-blue-100 text-blue-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {loadingStatus}
        </div>
      )}
    </div>
  );
};

SampleSelector.propTypes = {
  isVisible: PropTypes.bool.isRequired,
  selectedMicroscopeId: PropTypes.string,
  microscopeControlService: PropTypes.object,
  incubatorControlService: PropTypes.object,
  roboticArmService: PropTypes.object,
  currentOperation: PropTypes.string,
  setCurrentOperation: PropTypes.func
};

export default SampleSelector; 