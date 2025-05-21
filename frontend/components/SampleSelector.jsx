import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const SampleSelector = ({ 
  isVisible, 
  selectedMicroscopeId, 
  microscopeControlService,
  incubatorControlService
}) => {
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [incubatorSlots, setIncubatorSlots] = useState([]);
  const [loadingStatus, setLoadingStatus] = useState('');

  // Define the mapping of sample IDs to their data aliases
  const sampleDataAliases = {
    'simulated-sample-1': 'squid-control/image-map-20250429-treatment-zip',
    'simulated-sample-2': 'squid-control/image-map-20250506-treatment-zip'
  };
  
  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
                                selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'squid-control/squid-control-reef';

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
              slots.push({ ...slotInfo, id: `slot-${i}` }); 
            }
          }
          setIncubatorSlots(slots);
          setSelectedSampleId(null); 
        } catch (error) {
          console.error("[SampleSelector] Failed to fetch incubator slots:", error);
          setIncubatorSlots([]);
        }
      } else {
        setIncubatorSlots([]); 
        setSelectedSampleId(null); 
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

    if (isSimulatedMicroscopeSelected) {
      setLoadingStatus('Loading sample...'); // Set loading status
      try {
        if (selectedSampleId === 'simulated-sample-1') {
          await microscopeControlService.set_simulated_sample_data_alias('squid-control/image-map-20250429-treatment-zip');
          console.log('Loaded simulated sample 1');
        } else if (selectedSampleId === 'simulated-sample-2') {
          await microscopeControlService.set_simulated_sample_data_alias('squid-control/image-map-20250506-treatment-zip');
          console.log('Loaded simulated sample 2');
        }
        setLoadingStatus('Sample loaded!'); // Update status on success
        // Auto-clear message after 3 seconds
        setTimeout(() => setLoadingStatus(''), 3000);
      } catch (error) {
        console.error('Failed to load simulated sample:', error);
        setLoadingStatus('Error loading sample'); // Show error status
        // Auto-clear error message after 3 seconds
        setTimeout(() => setLoadingStatus(''), 3000);
      }
    } else {
      // For real microscopes
      setLoadingStatus('Feature is in development');
      // Auto-clear message after 3 seconds
      setTimeout(() => setLoadingStatus(''), 3000);
      console.log(`Loading sample: ${selectedSampleId}`);
    }
  };

  return (
    <div className={`sample-sidebar ${!isVisible ? 'collapsed' : ''}`}>
      <h3 className="sample-sidebar-title">Select Sample</h3>
      <div className="sample-options">
        {isSimulatedMicroscopeSelected && (
          <>
            <button
              className={`sample-option ${selectedSampleId === 'simulated-sample-1' ? 'active' : ''}`}
              onClick={() => handleSampleSelect('simulated-sample-1')}
            >
              <i className="fas fa-flask"></i> 
              <span>Simulated Sample 1</span>
            </button>
            <button
              className={`sample-option ${selectedSampleId === 'simulated-sample-2' ? 'active' : ''}`}
              onClick={() => handleSampleSelect('simulated-sample-2')}
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
          >
            <i className="fas fa-vial"></i> 
            <span>{slot.name || `Slot ${slot.incubator_slot}`}</span>
          </button>
        ))}
        {isRealMicroscopeSelected && incubatorSlots.length === 0 && (
              <p className="no-samples-message">No occupied incubator slots found or service unavailable.</p>
        )}
      </div>
      {loadingStatus && (
        <div className={`sample-loading-status my-2 py-2 px-3 rounded text-center ${
          loadingStatus === 'Sample loaded!' ? 'bg-green-100 text-green-700' : 
          loadingStatus === 'Error loading sample' ? 'bg-red-100 text-red-700' :
          loadingStatus === 'Feature is in development' ? 'bg-yellow-100 text-yellow-700' :
          'bg-blue-100 text-blue-700'
        }`}>
          {loadingStatus}
        </div>
      )}
      <button 
        className="load-sample-button"
        onClick={handleLoadSample}
        disabled={!selectedSampleId}
      >
        Load Sample on Microscope
      </button>
    </div>
  );
};

SampleSelector.propTypes = {
  isVisible: PropTypes.bool.isRequired,
  selectedMicroscopeId: PropTypes.string,
  microscopeControlService: PropTypes.object,
  incubatorControlService: PropTypes.object
};

export default SampleSelector; 