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
  setCurrentOperation,
  onSampleLoadStatusChange,
  microscopeBusy,
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
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'agent-lens/squid-control-reef';
  const currentMicroscopeNumber = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 1 : 
                                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 2 : 0;

  // Notify parent when sample load status changes
  useEffect(() => {
    if (onSampleLoadStatusChange) {
      onSampleLoadStatusChange({
        isSampleLoaded,
        loadedSampleOnMicroscope,
        selectedSampleId,
        isRealMicroscope: isRealMicroscopeSelected,
        isSimulatedMicroscope: isSimulatedMicroscopeSelected
      });
    }
  }, [isSampleLoaded, loadedSampleOnMicroscope, selectedSampleId, isRealMicroscopeSelected, isSimulatedMicroscopeSelected, onSampleLoadStatusChange]);

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
        // If moved back to incubator, ensure it's not marked as loaded on this scope
        if (loadedSampleOnMicroscope === `slot-${incubatorSlot}`) {
            setLoadedSampleOnMicroscope(null);
        }
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
          setTimeout(() => setLoadingStatus(''), 6000);
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
          } else {
            setSelectedSampleId(null);
            setIsSampleLoaded(false);
          }
        } catch (error) {
          console.error('Failed to get current simulated sample:', error);
          setSelectedSampleId(null);
          setIsSampleLoaded(false);
        }
      }
    };

    fetchCurrentSample();
  }, [isVisible, isSimulatedMicroscopeSelected, microscopeControlService]);

  // Fetch incubator data when microscope selection changes or after location updates
  const fetchIncubatorData = async () => {
    if (incubatorControlService && isRealMicroscopeSelected) {
      try {
        const allSlotInfo = await incubatorControlService.get_slot_information();
        const slots = (allSlotInfo || []).filter(slotInfo => 
          slotInfo && slotInfo.name && slotInfo.name.trim()
        ).map(slotInfo => ({
          ...slotInfo,
          id: `slot-${slotInfo.incubator_slot}`
        }));
        
        const sampleOnThisMicroscope = slots.find(slot => 
          slot.location === `microscope${currentMicroscopeNumber}`
        );
        
        if (sampleOnThisMicroscope) {
          setSelectedSampleId(sampleOnThisMicroscope.id);
          setIsSampleLoaded(true);
          setLoadedSampleOnMicroscope(sampleOnThisMicroscope.id);
        } else {
          setIsSampleLoaded(false);
          setLoadedSampleOnMicroscope(null);
          // If no sample is on this microscope, selectedSampleId should only be set if it's an incubator slot
          // and not a sample that *was* on another microscope.
          if (selectedSampleId && selectedSampleId.startsWith('slot-')){
            const currentSelectedSlot = slots.find(s => s.id === selectedSampleId);
            if(!currentSelectedSlot || currentSelectedSlot.location !== 'incubator_slot'){
              setSelectedSampleId(null); // Clear selection if it's not a valid incubator slot to pick next
            }
          } else if (selectedSampleId && !selectedSampleId.startsWith('slot-')) {
            // This case is for simulated samples, should not clear if it's a valid simulated ID
          }
        }
        setIncubatorSlots(slots);
      } catch (error) {
        console.error("[SampleSelector] Failed to fetch incubator slots:", error);
        setIncubatorSlots([]);
        setIsSampleLoaded(false);
        setSelectedSampleId(null);
        setLoadedSampleOnMicroscope(null);
      }
    } else if (isSimulatedMicroscopeSelected) {
      // For simulated, check if a sample is loaded via its state
    } else { // No specific microscope type or no service
      setIncubatorSlots([]); 
      setSelectedSampleId(null); 
      setIsSampleLoaded(false);
      setLoadedSampleOnMicroscope(null);
    }
  };

  // Call fetchIncubatorData when microscope selection changes or service becomes available
  useEffect(() => {
    fetchIncubatorData();
  }, [selectedMicroscopeId, incubatorControlService, currentMicroscopeNumber]);

  const handleSampleSelect = (sampleId) => {
    if (isSampleLoaded) {
      // If a sample is loaded, only allow re-selecting the currently loaded sample.
      const currentlyLoadedSample = isSimulatedMicroscopeSelected ? selectedSampleId : loadedSampleOnMicroscope;
      if (sampleId !== currentlyLoadedSample) {
        console.log('A sample is already loaded. Unload it first or re-select the current one.');
        return; // Do not change selection
      }
    }
    // If no sample is loaded, or if the loaded sample itself is clicked again, allow setting selectedSampleId.
    setSelectedSampleId(sampleId);
    console.log(`Sample selected: ${sampleId}`);
  };

  const handleLoadSample = async () => {
    if (!selectedSampleId) {
      console.log('No sample selected to load.');
      return;
    }

    clearWorkflowMessages();
    
    if (isSimulatedMicroscopeSelected) {
      setLoadingStatus('Loading sample...');
      setCurrentOperation('loading'); // This will trigger WebRTC stream to stop in MicroscopeControlPanel
      try {
        addWorkflowMessage("Loading simulated sample...");
        const dataAlias = sampleDataAliases[selectedSampleId];
        if (dataAlias) {
          await microscopeControlService.set_simulated_sample_data_alias(dataAlias);
          addWorkflowMessage(`Loaded ${selectedSampleId}`);
        } else {
          throw new Error(`No data alias found for ${selectedSampleId}`);
        }
        setLoadingStatus('Sample loaded!');
        setIsSampleLoaded(true);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to load simulated sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus('Error loading sample');
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    } else { // Real Microscope
      console.log(`[SampleSelector] Loading sample on microscope. Selected ID: ${selectedMicroscopeId}`);
      if (!microscopeControlService) {
        addWorkflowMessage("Error: No microscope service available");
        setLoadingStatus('Error: No microscope service available');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }

      const expectedMicroscopeNumber = currentMicroscopeNumber;
      addWorkflowMessage(`Preparing to load sample on Microscope ${expectedMicroscopeNumber}`);
      setLoadingStatus('Loading sample from incubator...'); 
      setCurrentOperation('loading'); // This will trigger WebRTC stream to stop in MicroscopeControlPanel
      
      try {
        const slotMatch = selectedSampleId.match(/slot-(\d+)/);
        if (!slotMatch) throw new Error("Invalid slot ID format");
        const incubatorSlot = parseInt(slotMatch[1], 10);

        addWorkflowMessage(`Loading sample from incubator slot ${incubatorSlot}`);
        const sampleStatus = await incubatorControlService.get_sample_status(incubatorSlot);
        addWorkflowMessage(`Sample status: ${sampleStatus}`);
        if (sampleStatus !== "IN") throw new Error("Plate is not inside incubator");
        
        const armService = roboticArmService || roboticArmServiceState;
        if (!armService) throw new Error("Robotic arm service not available");
        
        addWorkflowMessage("Getting sample from slot to transfer station and homing microscope stage simultaneously");
        
        // Start both operations concurrently
        const [transferResult, homeResult] = await Promise.all([
          incubatorControlService.get_sample_from_slot_to_transfer_station(incubatorSlot),
          microscopeControlService.home_stage()
        ]);
        
        await updateSampleLocation(incubatorSlot, "incubator_station");
        addWorkflowMessage("Plate loaded onto transfer station");
        addWorkflowMessage(`Microscope ${expectedMicroscopeNumber} stage homed successfully`);
        
        await armService.connect();
        await armService.light_on();
        
        await updateSampleLocation(incubatorSlot, "robotic_arm");
        addWorkflowMessage(`Transporting sample to microscope ${expectedMicroscopeNumber}`);
        await armService.incubator_to_microscope(expectedMicroscopeNumber);
        
        await updateSampleLocation(incubatorSlot, `microscope${expectedMicroscopeNumber}`);
        addWorkflowMessage("Sample placed on microscope");
        
        await microscopeControlService.return_stage();
        await armService.light_off();
        await armService.disconnect();
        
        addWorkflowMessage("Sample plate successfully loaded onto microscope stage");
        setLoadingStatus('Sample successfully loaded onto microscope.');
        setIsSampleLoaded(true);
        setLoadedSampleOnMicroscope(selectedSampleId);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to load sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus(`Error loading sample: ${error.message}`);
        setCurrentOperation(null);
        // Attempt to revert location if arm transfer failed mid-way
        const slotMatch = selectedSampleId.match(/slot-(\d+)/);
        if(slotMatch){
            const incubatorSlot = parseInt(slotMatch[1], 10);
            const currentSlotInfo = incubatorSlots.find(s => s.id === selectedSampleId);
            if(currentSlotInfo && currentSlotInfo.location !== 'incubator_slot'){
                try { await updateSampleLocation(incubatorSlot, "incubator_slot"); } catch (e) { console.error("Error reverting location:", e);}
            }
        }
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    }
  };

  const handleUnloadSample = async () => {
    if (!selectedSampleId && !loadedSampleOnMicroscope) {
      console.log('No sample selected or loaded to unload.');
      return;
    }

    clearWorkflowMessages();
    const sampleToUnloadId = loadedSampleOnMicroscope || selectedSampleId;

    if (isSimulatedMicroscopeSelected) {
      setLoadingStatus('Unloading sample...'); 
      setCurrentOperation('unloading'); // This will trigger WebRTC stream to stop in MicroscopeControlPanel
      try {
        addWorkflowMessage("Unloading simulated sample...");
        await microscopeControlService.set_simulated_sample_data_alias('');
        addWorkflowMessage("Sample unloaded successfully");
        setLoadingStatus('Sample unloaded!');
        setIsSampleLoaded(false);
        setSelectedSampleId(null);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to unload simulated sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus('Error unloading sample');
        setIsSampleLoaded(false);
        setSelectedSampleId(null);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    } else { // Real Microscope
      if (!sampleToUnloadId || !sampleToUnloadId.startsWith('slot-')) {
        addWorkflowMessage("Error: No valid real sample identified as loaded.");
        setLoadingStatus('Error: No valid real sample identified as loaded.');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }
      console.log(`[SampleSelector] Unloading sample ${sampleToUnloadId} from microscope ${selectedMicroscopeId}`);
      if (!microscopeControlService) { 
        addWorkflowMessage("Error: No microscope service available");
        setLoadingStatus('Error: No microscope service available');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }

      const expectedMicroscopeNumber = currentMicroscopeNumber;
      addWorkflowMessage(`Preparing to unload sample from Microscope ${expectedMicroscopeNumber}`);
      setLoadingStatus('Unloading sample to incubator...'); 
      setCurrentOperation('unloading'); // This will trigger WebRTC stream to stop in MicroscopeControlPanel
      
      try {
        const slotMatch = sampleToUnloadId.match(/slot-(\d+)/);
        if (!slotMatch) throw new Error("Invalid slot ID format for unloading");
        const incubatorSlot = parseInt(slotMatch[1], 10);

        addWorkflowMessage(`Unloading sample to incubator slot ${incubatorSlot}`);
        const selectedSlotInfo = incubatorSlots.find(slot => slot.id === sampleToUnloadId);
        if (!selectedSlotInfo || selectedSlotInfo.location !== `microscope${expectedMicroscopeNumber}`) {
          throw new Error(`Sample ${sampleToUnloadId} is not on microscope ${expectedMicroscopeNumber}. Location: ${selectedSlotInfo?.location}`);
        }
        
        const armService = roboticArmService || roboticArmServiceState;
        if (!armService) throw new Error("Robotic arm service not available");
        
        addWorkflowMessage(`Homing microscope stage for Microscope ${expectedMicroscopeNumber}`);
        await microscopeControlService.home_stage();
        addWorkflowMessage(`Microscope ${expectedMicroscopeNumber} stage homed successfully`);
        
        await armService.connect();
        await armService.light_on();
        
        await updateSampleLocation(incubatorSlot, "robotic_arm");
        addWorkflowMessage(`Transporting sample from microscope ${expectedMicroscopeNumber} to incubator`);
        await armService.microscope_to_incubator(expectedMicroscopeNumber);
        await updateSampleLocation(incubatorSlot, "incubator_station");
        addWorkflowMessage("Sample transported to incubator transfer station");
        
        await incubatorControlService.put_sample_from_transfer_station_to_slot(incubatorSlot);
        await updateSampleLocation(incubatorSlot, "incubator_slot"); // This will trigger fetchIncubatorData
        addWorkflowMessage("Sample moved to incubator slot");
        
        await microscopeControlService.return_stage();
        await armService.light_off();
        await armService.disconnect();
        
        addWorkflowMessage("Sample successfully unloaded from the microscopy stage");
        setLoadingStatus('Sample successfully unloaded to incubator.');
        setIsSampleLoaded(false);
        setLoadedSampleOnMicroscope(null);
        setSelectedSampleId(null);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to unload sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus(`Error unloading sample: ${error.message}`);
        await fetchIncubatorData(); 
        setIsSampleLoaded(false);
        setLoadedSampleOnMicroscope(null);
        setSelectedSampleId(null);
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    }
  };

  // Determine if a sample can be selected based on its location
  const canSelectSample = (slot) => {
    // If a sample is loaded on this real microscope, only that sample itself is selectable (to enable unload)
    if (isSampleLoaded && isRealMicroscopeSelected && slot.id === loadedSampleOnMicroscope) {
      return true;
    }
    // If no sample is loaded (on this real microscope), only incubator_slot samples are selectable for loading
    if (!isSampleLoaded && isRealMicroscopeSelected && slot.location === 'incubator_slot') {
      return true;
    }
    // For simulated microscope, always allow selection if no operation is ongoing (disabled state handles currentOperation)
    if (isSimulatedMicroscopeSelected) {
      return true; // Actual selection logic is in handleSampleSelect
    }
    return false; // Otherwise, not selectable
  };

  // Get class name for sample button based on location and selected state
  const getSampleButtonClass = (slot) => {
    let className = 'sample-option';
    
    if (isSampleLoaded && slot.id === loadedSampleOnMicroscope) {
      // If a sample is loaded on this real microscope, it's active
      className += ' active';
    } else if (!isSampleLoaded && selectedSampleId === slot.id) {
      // If no sample is loaded, the one explicitly selected is active
      className += ' active';
    }
    
    if (slot.location === 'incubator_slot') {
      className += ' green-sample';
    } else if (slot.location === `microscope${currentMicroscopeNumber}`){
      // Sample on the current microscope is orange (and active if loadedSampleOnMicroscope matches)
      className += ' orange-sample';
    } else if (slot.location !== 'incubator_slot') {
        // Sample on another microscope or robotic arm, etc. is orange but not necessarily active
        className += ' orange-sample';
    }
    
    return className;
  };

  return (
    <div className={`sample-selector-container ${!isVisible ? 'hidden' : ''}`}>
      <h4>Select Sample</h4>
      
      <div className="sample-options-container">
        {/* Sample Control Buttons */}
        <div className="sample-controls">
          {currentOperation === 'unloading' ? (
            <button 
              className="sample-button"
              disabled={true}
            >
              <i className="fas fa-spinner fa-spin mr-2"></i>
              <span>Unloading Sample...</span>
            </button>
          ) : currentOperation === 'loading' ? (
            <button 
              className="sample-button"
              disabled={true}
            >
              <i className="fas fa-spinner fa-spin mr-2"></i>
              <span>Loading Sample...</span>
            </button>
          ) : isSampleLoaded ? (
            <button 
              className="sample-button"
              onClick={handleUnloadSample}
              disabled={currentOperation !== null || microscopeBusy || 
                          (isSimulatedMicroscopeSelected && selectedSampleId === null) || 
                          (isRealMicroscopeSelected && loadedSampleOnMicroscope === null)
              }
            >
              <i className="fas fa-download mr-2"></i>
              <span>Unload Sample</span>
            </button>
          ) : (
            <button 
              className="sample-button"
              onClick={handleLoadSample}
              disabled={!selectedSampleId || currentOperation !== null || microscopeBusy ||
                          (isRealMicroscopeSelected && incubatorSlots.find(s=>s.id === selectedSampleId)?.location !== 'incubator_slot')
              }
            >
              <i className="fas fa-upload mr-2"></i>
              <span>Load Sample on Microscope</span>
            </button>
          )}
        </div>
        
        <div className="sample-list">
          {isSimulatedMicroscopeSelected && (
            <>
              {Object.keys(sampleDataAliases).map(sampleKey => (
                <div
                  key={sampleKey}
                  className={`sample-item ${(isSampleLoaded ? selectedSampleId === sampleKey : selectedSampleId === sampleKey) ? 'selected' : ''}`}
                  onClick={() => handleSampleSelect(sampleKey)}
                  style={{ cursor: currentOperation !== null || (isSampleLoaded && selectedSampleId !== sampleKey) ? 'not-allowed' : 'pointer' }}
                >
                  <i className="fas fa-flask mr-2"></i> 
                  <span>{sampleKey.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
                </div>
              ))}
            </>
          )}
          {isRealMicroscopeSelected && incubatorSlots.length > 0 && incubatorSlots.map(slot => (
            <div
              key={slot.id}
              className={`sample-item ${getSampleButtonClass(slot).includes('active') ? 'selected' : ''}`}
              onClick={() => currentOperation === null && canSelectSample(slot) ? handleSampleSelect(slot.id) : null}
              style={{ cursor: currentOperation !== null || !canSelectSample(slot) ? 'not-allowed' : 'pointer' }}
            >
              <i className="fas fa-vial mr-2"></i> 
              <div className="sample-info">
                <span className="sample-name">{slot.name || `Slot ${slot.incubator_slot}`}</span>
                <span className="sample-location">
                  Location: {slot.location}
                  {slot.location === 'incubator_slot' && ` (Slot #${slot.incubator_slot})`}
                </span>
              </div>
            </div>
          ))}
          {isRealMicroscopeSelected && incubatorSlots.length === 0 && (
                <div className="sample-item" style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                  No occupied incubator slots found or service unavailable.
                </div>
          )}
        </div>
      </div>

      {workflowMessages.length > 0 && (
        <div className="workflow-messages">
          <h4 className="text-sm font-semibold mb-3">Operation Progress:</h4>
          {workflowMessages.map((msg, index) => (
            <div key={index} className="workflow-message">
              <i className="fas fa-circle-notch text-blue-400 mr-2"></i>
              {msg.message}
            </div>
          ))}
        </div>
      )}

      {loadingStatus && (
        <div className={`workflow-message ${
          loadingStatus.includes('successfully') || loadingStatus.includes('Sample loaded!') || loadingStatus.includes('Sample unloaded!') ? 'border-green-500' : 
          loadingStatus.includes('Error') ? 'border-red-500' :
          currentOperation === 'loading' || currentOperation === 'unloading' ? 'border-blue-500' :
          'border-blue-500'
        }`}>
          <i className={`fas ${
            loadingStatus.includes('successfully') || loadingStatus.includes('Sample loaded!') || loadingStatus.includes('Sample unloaded!') ? 'fa-check-circle text-green-400' : 
            loadingStatus.includes('Error') ? 'fa-exclamation-circle text-red-400' :
            currentOperation === 'loading' || currentOperation === 'unloading' ? 'fa-spinner fa-spin text-blue-400' :
            'fa-info-circle text-blue-400'
          } mr-2`}></i>
          {loadingStatus}
        </div>
      )}
    </div>
  );
};

SampleSelector.propTypes = {
  isVisible: PropTypes.bool.isRequired,
  selectedMicroscopeId: PropTypes.string.isRequired,
  microscopeControlService: PropTypes.object,
  incubatorControlService: PropTypes.object,
  roboticArmService: PropTypes.object,
  currentOperation: PropTypes.string,
  setCurrentOperation: PropTypes.func.isRequired,
  onSampleLoadStatusChange: PropTypes.func.isRequired,
  microscopeBusy: PropTypes.bool,
};

export default SampleSelector; 