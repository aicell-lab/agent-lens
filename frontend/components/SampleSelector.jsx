import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { isRealMicroscope, isSimulatedMicroscope, getMicroscopeNumber, getOrchestratorMicroscopeId } from '../utils';

// NOTE: Ensure corresponding CSS for .sample-selector-dropdown and .hidden is added.
// .sample-selector-dropdown { position: absolute; top: 50px; /* Adjust as needed */ left: 20px; z-index: 1000; background: white; border: 1px solid #ccc; box-shadow: 0 2px 10px rgba(0,0,0,0.1); padding: 15px; border-radius: 5px; width: 300px; /* Or max-content */ }
// .hidden { display: none; }

const normalizeSimulationSamples = (samples) => {
  return Object.entries(samples || {})
    .map(([id, info]) => ({
      id,
      name: id,
      description: info?.description || null,
      objective: info?.objective || null,
      cellLine: info?.cell_line || null,
      staining: info?.staining || null,
      channels: Array.isArray(info?.channels) ? info.channels : [],
      configName: info?.config_name || null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const createSimulationSampleFromStatus = (simulationDataSource) => {
  const sampleName =
    simulationDataSource?.sampleInfo?.name ||
    simulationDataSource?.activeSample ||
    null;

  if (!sampleName) {
    return [];
  }

  return [
    {
      id: sampleName,
      name: sampleName,
      description: simulationDataSource?.sampleInfo?.description || null,
      objective: simulationDataSource?.sampleInfo?.objective || null,
      cellLine: simulationDataSource?.sampleInfo?.cell_line || null,
      staining: simulationDataSource?.sampleInfo?.staining || null,
      channels: Array.isArray(simulationDataSource?.sampleInfo?.channels)
        ? simulationDataSource.sampleInfo.channels
        : [],
      configName: simulationDataSource?.sampleInfo?.config_name || null,
    },
  ];
};

const SampleSelector = ({
  isVisible,
  selectedMicroscopeId,
  microscopeControlService,
  simulationDataSource,
  incubatorControlService,
  orchestratorManagerService,
  currentOperation,
  setCurrentOperation,
  onSampleLoadStatusChange,
  microscopeBusy,
}) => {
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [incubatorSlots, setIncubatorSlots] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [isSampleLoaded, setIsSampleLoaded] = useState(false);
  const [workflowMessages, setWorkflowMessages] = useState([]);
  // Track loaded sample ID on current microscope
  const [loadedSampleOnMicroscope, setLoadedSampleOnMicroscope] = useState(null);
  const [labVideoStreamUrls, setLabVideoStreamUrls] = useState({});
  const [simulationSamples, setSimulationSamples] = useState([]);
  const [simulationSamplesError, setSimulationSamplesError] = useState('');

  // Use centralized config utility functions
  const isRealMicroscopeSelected = isRealMicroscope(selectedMicroscopeId);
  const isSimulatedMicroscopeSelected = isSimulatedMicroscope(selectedMicroscopeId);
  const currentMicroscopeNumber = getMicroscopeNumber(selectedMicroscopeId) || 0;
  const isSampleTransitionInProgress =
    currentOperation === 'loading' ||
    currentOperation === 'unloading' ||
    currentOperation === 'switching';

  // Notify parent when sample load status changes
  useEffect(() => {
    if (onSampleLoadStatusChange) {
      // Find the sample name for the loaded sample (only for real microscopes)
      let loadedSampleName = null;
      if (loadedSampleOnMicroscope) {
        if (isRealMicroscopeSelected) {
          const loadedSlot = incubatorSlots.find(
            slot => slot.id === loadedSampleOnMicroscope
          );
          loadedSampleName = loadedSlot?.name || null;
        } else if (isSimulatedMicroscopeSelected) {
          const loadedSimulationSample = simulationSamples.find(
            sample => sample.id === loadedSampleOnMicroscope
          );
          loadedSampleName =
            loadedSimulationSample?.name ||
            simulationDataSource?.sampleInfo?.name ||
            loadedSampleOnMicroscope;
        }
      }

      onSampleLoadStatusChange({
        isSampleLoaded,
        loadedSampleOnMicroscope,
        loadedSampleName,
        selectedSampleId,
        isRealMicroscope: isRealMicroscopeSelected,
        isSimulatedMicroscope: isSimulatedMicroscopeSelected
      });
    }
  }, [
    incubatorSlots,
    isRealMicroscopeSelected,
    isSampleLoaded,
    isSimulatedMicroscopeSelected,
    loadedSampleOnMicroscope,
    onSampleLoadStatusChange,
    selectedSampleId,
    simulationDataSource?.sampleInfo?.name,
    simulationSamples,
  ]);

  // Helper function to add workflow messages
  const addWorkflowMessage = (message) => {
    setWorkflowMessages(prev => [{ message, timestamp: Date.now() }, ...prev]);
  };

  // Clear workflow messages
  const clearWorkflowMessages = () => {
    setWorkflowMessages([]);
  };

  const fetchSimulationSamples = async () => {
    if (!microscopeControlService || !isSimulatedMicroscopeSelected) {
      setSimulationSamples([]);
      setSimulationSamplesError('');
      return;
    }

    if (typeof microscopeControlService.list_simulation_samples !== 'function') {
      const fallbackSamples = createSimulationSampleFromStatus(simulationDataSource);
      setSimulationSamples(fallbackSamples);
      setSimulationSamplesError(
        'Connected microscope service does not expose list_simulation_samples(). Update or redeploy squid-control to enable full simulated sample selection.'
      );
      return;
    }

    try {
      const samples = await microscopeControlService.list_simulation_samples();
      setSimulationSamples(normalizeSimulationSamples(samples));
      setSimulationSamplesError('');
    } catch (error) {
      console.error('[SampleSelector] Failed to fetch simulation samples:', error);
      setSimulationSamples(createSimulationSampleFromStatus(simulationDataSource));
      setSimulationSamplesError(
        error?.message || 'Failed to load simulated samples.'
      );
    }
  };

  // Check transport queue status
  const checkTransportQueueStatus = async () => {
    if (!orchestratorManagerService || !isRealMicroscopeSelected) {
      return;
    }
    
    try {
      const status = await orchestratorManagerService.get_transport_queue_status();
      
      // Add status information to workflow messages if there's an active task
      if (status && status.active_task) {
        addWorkflowMessage(`Transport queue: ${status.active_task} (Queue size: ${status.queue_size})`);
      }
    } catch (error) {
      console.error('Failed to get transport queue status:', error);
    }
  };



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
    } else if (!isSimulatedMicroscopeSelected) { // No specific microscope type or no service
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

  useEffect(() => {
    if (!isVisible || !isSimulatedMicroscopeSelected) {
      return;
    }

    fetchSimulationSamples();
  }, [
    isVisible,
    isSimulatedMicroscopeSelected,
    microscopeControlService,
    selectedMicroscopeId,
    simulationDataSource,
  ]);

  useEffect(() => {
    if (!isSimulatedMicroscopeSelected) {
      setSimulationSamples([]);
      setSimulationSamplesError('');
      return;
    }

    const activeSample =
      simulationDataSource?.activeSample ||
      simulationDataSource?.sampleInfo?.name ||
      null;

    setIsSampleLoaded(Boolean(activeSample));
    setLoadedSampleOnMicroscope(activeSample);

    if (activeSample) {
      setSelectedSampleId(activeSample);
    }
  }, [
    isSimulatedMicroscopeSelected,
    simulationDataSource?.activeSample,
    simulationDataSource?.sampleInfo?.name,
  ]);

  // Check transport queue status periodically and when operations complete
  useEffect(() => {
    if (isRealMicroscopeSelected && orchestratorManagerService) {
      // Check immediately
      checkTransportQueueStatus();

      // Set up periodic checking every 5 seconds
      const interval = setInterval(checkTransportQueueStatus, 5000);

      return () => clearInterval(interval);
    }
  }, [isRealMicroscopeSelected, orchestratorManagerService]);

  useEffect(() => {
    if (isRealMicroscopeSelected && orchestratorManagerService) {
      orchestratorManagerService.get_lab_video_stream_urls()
        .then(urls => setLabVideoStreamUrls(urls || {}))
        .catch(err => console.error('Failed to fetch lab video stream URLs:', err));
    }
  }, [isRealMicroscopeSelected, orchestratorManagerService]);

  const handleSampleSelect = (sampleId) => {
    if (isSimulatedMicroscopeSelected) {
      setSelectedSampleId(sampleId);
      console.log(`Simulated sample selected: ${sampleId}`);
      return;
    }

    if (isSampleLoaded) {
      // If a sample is loaded, only allow re-selecting the currently loaded sample.
      const currentlyLoadedSample = loadedSampleOnMicroscope;
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
      if (!microscopeControlService) {
        addWorkflowMessage('Error: No microscope service available');
        setLoadingStatus('Error: No microscope service available');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }

      if (typeof microscopeControlService.switch_sample !== 'function') {
        const errorMessage =
          'Connected microscope service does not expose switch_sample(). Update or redeploy squid-control to enable simulated sample switching.';
        addWorkflowMessage(`Error: ${errorMessage}`);
        setLoadingStatus(`Error switching sample: ${errorMessage}`);
        setTimeout(() => setLoadingStatus(''), 4000);
        return;
      }

      if (selectedSampleId === loadedSampleOnMicroscope) {
        setLoadingStatus(`Sample ${selectedSampleId} is already active.`);
        setTimeout(() => setLoadingStatus(''), 2000);
        return;
      }

      addWorkflowMessage(
        `Switching simulated microscope to sample ${selectedSampleId}`
      );
      setLoadingStatus(`Switching simulated sample to ${selectedSampleId}...`);
      setCurrentOperation('switching');

      try {
        const result = await microscopeControlService.switch_sample(selectedSampleId);
        const activeSample =
          result?.simulation_active_sample ||
          result?.active_sample ||
          selectedSampleId;

        setIsSampleLoaded(Boolean(activeSample));
        setLoadedSampleOnMicroscope(activeSample);
        setSelectedSampleId(activeSample);
        addWorkflowMessage(
          result?.message || `Successfully switched simulated sample to ${activeSample}`
        );
        setLoadingStatus(`Successfully switched simulated sample to ${activeSample}.`);
        await fetchSimulationSamples();
      } catch (error) {
        console.error('Failed to switch simulated sample:', error);
        addWorkflowMessage(`Error: ${error.message}`);
        setLoadingStatus(`Error switching sample: ${error.message}`);
      } finally {
        setCurrentOperation(null);
        setTimeout(() => setLoadingStatus(''), 3000);
      }

      return;
    }

    { // Real Microscope
      console.log(`[SampleSelector] Loading sample on microscope. Selected ID: ${selectedMicroscopeId}`);
      if (!orchestratorManagerService) {
        addWorkflowMessage("Error: No orchestrator service available");
        setLoadingStatus('Error: No orchestrator service available');
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

        // Convert full service ID to the format expected by orchestrator
        const microscopeIdForOrchestrator = getOrchestratorMicroscopeId(selectedMicroscopeId);
        
        addWorkflowMessage(`Queuing load operation for incubator slot ${incubatorSlot} to microscope ${microscopeIdForOrchestrator}`);
        
        // Use orchestrator service to handle the entire load operation
        const result = await orchestratorManagerService.load_plate_from_incubator_to_microscope(
          incubatorSlot, 
          microscopeIdForOrchestrator
        );
        
        if (result && result.success) {
          addWorkflowMessage("Sample plate successfully loaded onto microscope stage");
          setLoadingStatus('Sample successfully loaded onto microscope.');
          setIsSampleLoaded(true);
          setLoadedSampleOnMicroscope(selectedSampleId);
          // Refresh incubator data to get updated locations
          await fetchIncubatorData();
          // Check transport queue status after operation
          await checkTransportQueueStatus();
        } else {
          throw new Error(result ? result.message : 'Unknown error from orchestrator');
        }
        
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
    if (!selectedSampleId && !loadedSampleOnMicroscope) {
      console.log('No sample selected or loaded to unload.');
      return;
    }

    clearWorkflowMessages();
    const sampleToUnloadId = loadedSampleOnMicroscope || selectedSampleId;

    { // Real Microscope
      if (!sampleToUnloadId || !sampleToUnloadId.startsWith('slot-')) {
        addWorkflowMessage("Error: No valid real sample identified as loaded.");
        setLoadingStatus('Error: No valid real sample identified as loaded.');
        setTimeout(() => setLoadingStatus(''), 3000);
        return;
      }
      console.log(`[SampleSelector] Unloading sample ${sampleToUnloadId} from microscope ${selectedMicroscopeId}`);
      if (!orchestratorManagerService) { 
        addWorkflowMessage("Error: No orchestrator service available");
        setLoadingStatus('Error: No orchestrator service available');
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

        // Convert full service ID to the format expected by orchestrator
        const microscopeIdForOrchestrator = getOrchestratorMicroscopeId(selectedMicroscopeId);
        
        addWorkflowMessage(`Queuing unload operation for incubator slot ${incubatorSlot} from microscope ${microscopeIdForOrchestrator}`);
        
        // Use orchestrator service to handle the entire unload operation
        const result = await orchestratorManagerService.unload_plate_from_microscope(
          incubatorSlot, 
          microscopeIdForOrchestrator
        );
        
        if (result && result.success) {
          addWorkflowMessage("Sample successfully unloaded from the microscopy stage");
          setLoadingStatus('Sample successfully unloaded to incubator.');
          setIsSampleLoaded(false);
          setLoadedSampleOnMicroscope(null);
          setSelectedSampleId(null);
          // Refresh incubator data to get updated locations
          await fetchIncubatorData();
          // Check transport queue status after operation
          await checkTransportQueueStatus();
        } else {
          throw new Error(result ? result.message : 'Unknown error from orchestrator');
        }
        
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
    if (isSimulatedMicroscopeSelected) {
      return true;
    }

    // If a sample is loaded on this real microscope, only that sample itself is selectable (to enable unload)
    if (isSampleLoaded && isRealMicroscopeSelected && slot.id === loadedSampleOnMicroscope) {
      return true;
    }
    // If no sample is loaded (on this real microscope), only incubator_slot samples are selectable for loading
    if (!isSampleLoaded && isRealMicroscopeSelected && slot.location === 'incubator_slot') {
      return true;
    }
    return false; // Otherwise, not selectable
  };

  // Get class name for sample button based on location and selected state
  const getSampleButtonClass = (slot) => {
    let className = 'sample-option';

    if (
      isSimulatedMicroscopeSelected &&
      (slot.id === loadedSampleOnMicroscope || slot.id === selectedSampleId)
    ) {
      className += ' active';
      return className;
    }

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
      {isVisible && isSimulatedMicroscopeSelected && (
        <div className="workflow-message">
          <div className="flex items-center justify-between gap-2">
            <span>
              Active simulated sample:{' '}
              <strong>{loadedSampleOnMicroscope || 'Unknown'}</strong>
            </span>
            <button
              className="sample-button load-button"
              onClick={fetchSimulationSamples}
              disabled={isSampleTransitionInProgress || !microscopeControlService}
              type="button"
            >
              <i className="fas fa-rotate-right"></i>
              Refresh
            </button>
          </div>
          {simulationDataSource?.sampleInfo?.description && (
            <div className="mt-2 text-xs text-gray-300">
              {simulationDataSource.sampleInfo.description}
            </div>
          )}
        </div>
      )}

      {/* Live Lab Video Feed - Only show for real microscopes */}
      {isVisible && isRealMicroscopeSelected && Object.keys(labVideoStreamUrls).length > 0 && (
        <div className="lab-video-feed">
          <h5 className="video-feed-title">
            <i className="fas fa-video mr-2"></i>
            Live Lab Feed
          </h5>
          {Object.entries(labVideoStreamUrls).map(([cameraId, url]) => (
            <div key={cameraId} className="video-container">
              <div className="video-camera-label">{cameraId}</div>
              <img
                src={url}
                alt={`Lab Feed - ${cameraId}`}
                className="lab-video-img"
                onLoad={() => console.log(`Lab video feed loaded: ${cameraId}`)}
                onError={() => console.log(`Lab video feed failed to load: ${cameraId}`)}
              />
            </div>
          ))}
        </div>
      )}
      
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
          ) : currentOperation === 'switching' ? (
            <button
              className="sample-button"
              disabled={true}
            >
              <i className="fas fa-spinner fa-spin mr-2"></i>
              <span>Switching Sample...</span>
            </button>
          ) : currentOperation === 'loading' ? (
            <button 
              className="sample-button"
              disabled={true}
            >
              <i className="fas fa-spinner fa-spin mr-2"></i>
              <span>{isSimulatedMicroscopeSelected ? 'Switching Sample...' : 'Loading Sample...'}</span>
            </button>
          ) : isRealMicroscopeSelected && isSampleLoaded ? (
            <button 
              className="sample-button unload-button"
              onClick={handleUnloadSample}
              disabled={currentOperation !== null || microscopeBusy ||
                          (isRealMicroscopeSelected && loadedSampleOnMicroscope === null)
              }
            >
              <i className="fas fa-download mr-2"></i>
              <span>Unload Sample</span>
            </button>
          ) : (
            <button 
              className="sample-button load-button"
              onClick={handleLoadSample}
              disabled={
                !selectedSampleId ||
                currentOperation !== null ||
                microscopeBusy ||
                (isRealMicroscopeSelected &&
                  incubatorSlots.find(s => s.id === selectedSampleId)?.location !== 'incubator_slot') ||
                (isSimulatedMicroscopeSelected &&
                  (!microscopeControlService ||
                    selectedSampleId === loadedSampleOnMicroscope))
              }
            >
              <i className="fas fa-upload mr-2"></i>
              <span>
                {isSimulatedMicroscopeSelected
                  ? selectedSampleId === loadedSampleOnMicroscope
                    ? 'Current Sample Active'
                    : 'Switch Sample'
                  : 'Load Sample on Microscope'}
              </span>
            </button>
          )}
        </div>
        
        <div className="sample-list">
          {isSimulatedMicroscopeSelected && simulationSamples.length > 0 && simulationSamples.map(sample => (
            <div
              key={sample.id}
              className={`sample-item ${getSampleButtonClass(sample).includes('active') ? 'selected' : ''}`}
              onClick={() => currentOperation === null ? handleSampleSelect(sample.id) : null}
              style={{ cursor: currentOperation !== null ? 'not-allowed' : 'pointer' }}
            >
              <i className="fas fa-microscope mr-2"></i>
              <div className="sample-info">
                <span className="sample-name">
                  {sample.name}
                  {sample.id === loadedSampleOnMicroscope ? ' (active)' : ''}
                </span>
                <span className="sample-location">
                  {[sample.objective, sample.cellLine].filter(Boolean).join(' • ') || 'Simulated sample'}
                </span>
                {sample.description && (
                  <span className="sample-location">{sample.description}</span>
                )}
              </div>
            </div>
          ))}
          {isSimulatedMicroscopeSelected && simulationSamples.length === 0 && (
            <div className="sample-item" style={{ color: '#9ca3af', fontStyle: 'italic' }}>
              {simulationSamplesError || 'No simulated samples available from the microscope service.'}
            </div>
          )}
          {isRealMicroscopeSelected && incubatorSlots.length > 0 && incubatorSlots.map(slot => (
            <div
              key={slot.id}
              className={`sample-item ${getSampleButtonClass(slot).includes('active') ? 'selected' : ''} ${!canSelectSample(slot) ? 'unavailable' : ''}`}
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
          isSampleTransitionInProgress ? 'border-blue-500' :
          'border-blue-500'
        }`}>
          <i className={`fas ${
            loadingStatus.includes('successfully') || loadingStatus.includes('Sample loaded!') || loadingStatus.includes('Sample unloaded!') ? 'fa-check-circle text-green-400' : 
            loadingStatus.includes('Error') ? 'fa-exclamation-circle text-red-400' :
            isSampleTransitionInProgress ? 'fa-spinner fa-spin text-blue-400' :
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
  simulationDataSource: PropTypes.object,
  incubatorControlService: PropTypes.object,
  orchestratorManagerService: PropTypes.object,
  currentOperation: PropTypes.string,
  setCurrentOperation: PropTypes.func.isRequired,
  onSampleLoadStatusChange: PropTypes.func.isRequired,
  microscopeBusy: PropTypes.bool,
};

export default SampleSelector;
