import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const SampleSelector = ({ 
  isVisible, 
  selectedMicroscopeId, 
  microscopeControlService,
  incubatorControlService,
  roboticArmService
}) => {
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [incubatorSlots, setIncubatorSlots] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);
  const [roboticArmServiceState, setRoboticArmServiceState] = useState(null);
  const [currentOperation, setCurrentOperation] = useState(null);
  const [workflowMessages, setWorkflowMessages] = useState([]);

  // Define the mapping of sample IDs to their data aliases
  const sampleDataAliases = {
    'simulated-sample-1': 'squid-control/image-map-20250429-treatment-zip',
    'simulated-sample-2': 'squid-control/image-map-20250506-treatment-zip'
  };
  
  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
                                selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'squid-control/squid-control-reef';

  // Helper function to add workflow messages
  const addWorkflowMessage = (message) => {
    setWorkflowMessages(prev => [...prev, { message, timestamp: Date.now() }]);
  };

  // Clear workflow messages
  const clearWorkflowMessages = () => {
    setWorkflowMessages([]);
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
            transport_from_incubator_to_microscope1: async () => addWorkflowMessage("Sample transported to microscope 1"),
            transport_from_incubator_to_microscope2: async () => addWorkflowMessage("Sample transported to microscope 2"),
            put_sample_on_microscope1: async () => addWorkflowMessage("Sample placed on microscope 1"),
            put_sample_on_microscope2: async () => addWorkflowMessage("Sample placed on microscope 2"),
            grab_sample_from_microscope1: async () => addWorkflowMessage("Sample grabbed from microscope 1"),
            grab_sample_from_microscope2: async () => addWorkflowMessage("Sample grabbed from microscope 2"),
            transport_from_microscope1_to_incubator: async () => addWorkflowMessage("Sample transported from microscope 1 to incubator"),
            transport_from_microscope2_to_incubator: async () => addWorkflowMessage("Sample transported from microscope 2 to incubator"),
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

  // Fetch incubator data when microscope selection changes
  useEffect(() => {
    const fetchIncubatorData = async () => {
      if (incubatorControlService && 
          (selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
           selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2')) {
        try {
          const slots = [];
          for (let i = 1; i <= 42; i++) {
            const slotInfo = await incubatorControlService.get_slot_information(i);
            if (slotInfo && slotInfo.name && slotInfo.name.trim()) { 
              slots.push({ ...slotInfo, id: `slot-${i}`, incubator_slot: i }); 
            }
          }
          setIncubatorSlots(slots);
          setSelectedSampleId(null); 
          setIsSampleLoaded(false);
        } catch (error) {
          console.error("[SampleSelector] Failed to fetch incubator slots:", error);
          setIncubatorSlots([]);
        }
      } else {
        setIncubatorSlots([]); 
        setSelectedSampleId(null); 
        setIsSampleLoaded(false);
      }
    };

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
        if (selectedSampleId === 'simulated-sample-1') {
          await microscopeControlService.set_simulated_sample_data_alias('squid-control/image-map-20250429-treatment-zip');
          addWorkflowMessage('Loaded simulated sample 1');
        } else if (selectedSampleId === 'simulated-sample-2') {
          await microscopeControlService.set_simulated_sample_data_alias('squid-control/image-map-20250506-treatment-zip');
          addWorkflowMessage('Loaded simulated sample 2');
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
      // For real microscopes
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
        
        // Connect to robotic arm and start workflow
        await armService.connect();
        await armService.light_on();
        
        // Prepare incubator and microscope in parallel
        addWorkflowMessage("Getting sample from slot to transfer station");
        await incubatorControlService.get_sample_from_slot_to_transfer_station(incubatorSlot);
        addWorkflowMessage("Homing microscope stage");
        await microscopeControlService.home_stage();
        
        addWorkflowMessage("Plate loaded onto transfer station");
        await armService.grab_sample_from_incubator();
        
        // Transport to appropriate microscope
        if (selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1') {
          await armService.transport_from_incubator_to_microscope1();
          await armService.put_sample_on_microscope1();
        } else {
          await armService.transport_from_incubator_to_microscope2();
          await armService.put_sample_on_microscope2();
        }
        
        addWorkflowMessage("Sample placed on microscope");
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
      // For real microscopes
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
        
        // Check sample status
        const sampleStatus = await incubatorControlService.get_sample_status(incubatorSlot);
        addWorkflowMessage(`Sample status: ${sampleStatus}`);
        
        if (sampleStatus !== "OUT") {
          throw new Error("Plate is not outside incubator");
        }
        
        // Use the provided robotic arm service or the locally created one
        const armService = roboticArmService || roboticArmServiceState;
        if (!armService) {
          throw new Error("Robotic arm service not available");
        }
        
        // Connect to robotic arm and start workflow
        await armService.connect();
        await armService.light_on();
        
        addWorkflowMessage("Homing microscope stage");
        await microscopeControlService.home_stage();
        
        // Grab from appropriate microscope
        if (selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1') {
          await armService.grab_sample_from_microscope1();
          await armService.transport_from_microscope1_to_incubator();
        } else {
          await armService.grab_sample_from_microscope2();
          await armService.transport_from_microscope2_to_incubator();
        }
        
        addWorkflowMessage("Robotic arm moved to incubator");
        await armService.put_sample_on_incubator();
        addWorkflowMessage("Sample placed on incubator");
        
        // Return sample to incubator slot and return microscope stage in parallel
        await incubatorControlService.put_sample_from_transfer_station_to_slot(incubatorSlot);
        addWorkflowMessage("Sample moved to incubator slot");
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

  return (
    <div className={`sample-sidebar ${!isVisible ? 'collapsed' : ''}`}>
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
            </>
          )}
          {isRealMicroscopeSelected && incubatorSlots.length > 0 && incubatorSlots.map(slot => (
            <button
              key={slot.id}
              className={`sample-option ${selectedSampleId === slot.id ? 'active' : ''}`}
              onClick={() => handleSampleSelect(slot.id)}
              disabled={currentOperation !== null}
            >
              <i className="fas fa-vial"></i> 
              <span>{slot.name || `Slot ${slot.incubator_slot}`}</span>
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
            className="load-sample-button"
            onClick={handleLoadSample}
            disabled={!selectedSampleId || currentOperation !== null}
          >
            <div className="button-content">
              <i className="fas fa-upload"></i>
              <span>Load Sample on Microscope</span>
            </div>
          </button>
        ) : (
          <button 
            className="unload-sample-button"
            onClick={handleUnloadSample}
            disabled={!selectedSampleId || currentOperation !== null}
          >
            <div className="button-content">
              <i className="fas fa-download"></i>
              <span>Unload Sample from Microscope</span>
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
              <li key={index} className="mb-1 py-1 px-2 border-b border-gray-100 last:border-b-0">
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
  roboticArmService: PropTypes.object
};

export default SampleSelector; 