import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './Sidebar.css';

const Sidebar = ({ 
  activeTab, 
  onTabChange, 
  onMicroscopeSelect, 
  selectedMicroscopeId,
  incubatorControlService
}) => {
  const [selectedSampleId, setSelectedSampleId] = useState(null);
  const [incubatorSlots, setIncubatorSlots] = useState([]);
  const [isMicroscopePanelOpen, setIsMicroscopePanelOpen] = useState(true);
  const [isSamplePanelOpen, setIsSamplePanelOpen] = useState(false);

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
          console.error("[Sidebar] Failed to fetch incubator slots:", error);
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
    if (!selectedMicroscopeId) {
        setIsSamplePanelOpen(false);
    }

  }, [selectedMicroscopeId, incubatorControlService]);

  const handleMicroscopeTabClick = () => {
    if (activeTab === 'microscope') {
      const newPanelState = !isMicroscopePanelOpen;
      setIsMicroscopePanelOpen(newPanelState);
      if (!newPanelState) {
        setIsSamplePanelOpen(false);
      }
    } else {
      onTabChange('microscope');
      setIsMicroscopePanelOpen(true);
    }
  };

  const handleToggleSamplePanel = () => {
    setIsSamplePanelOpen(!isSamplePanelOpen);
  };

  const handleSampleSelect = (sampleId) => {
    setSelectedSampleId(sampleId);
    console.log(`Sample selected: ${sampleId}`);
  };

  const handleLoadSample = () => {
    if (selectedSampleId) {
      console.log(`Loading sample: ${selectedSampleId}`);
    } else {
      console.log('No sample selected to load.');
    }
  };

  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
                                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'squid-control/squid-control-reef';

  return (
    <div className="sidebar-container">
      <div className="main-sidebar">
        <div className="sidebar-tabs">
          <button 
            className={`sidebar-tab ${activeTab === 'microscope' ? 'active' : ''}`}
            onClick={handleMicroscopeTabClick}
          >
            <i className="fas fa-microscope"></i>
            <span>Microscopes</span>
            <i className={`fas ${activeTab === 'microscope' && isMicroscopePanelOpen ? 'fa-chevron-left' : 'fa-chevron-right'} microscope-toggle-icon`}></i>
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'main' ? 'active' : ''}`}
            onClick={() => onTabChange('main')}
          >
            <i className="fas fa-home"></i>
            <span>Image Map</span>
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'incubator' ? 'active' : ''}`}
            onClick={() => onTabChange('incubator')}
          >
            <i className="fas fa-temperature-high"></i>
            <span>Incubator</span>
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'data-management' ? 'active' : ''}`}
            onClick={() => onTabChange('data-management')}
          >
            <i className="fas fa-map"></i>
            <span>Data Management</span>
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onTabChange('dashboard')}
          >
            <i className="fas fa-tachometer-alt"></i>
            <span>Dashboard</span>
          </button>
        </div>
      </div>
      
      {activeTab === 'microscope' && (
        <div className={`microscope-sidebar ${!isMicroscopePanelOpen ? 'collapsed' : ''}`}>
          <h3 className="microscope-sidebar-title">Select Microscope</h3>
          <div className="microscope-options">
            <button
              className={`microscope-option ${selectedMicroscopeId === 'squid-control/squid-control-reef' ? 'active' : ''}`}
              onClick={() => onMicroscopeSelect('squid-control/squid-control-reef')}
            >
              <i className="fas fa-microscope"></i>
              <span>Simulated Microscope</span>
            </button>
            <button
              className={`microscope-option ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 'active' : ''}`}
              onClick={() => onMicroscopeSelect('reef-imaging/mirror-microscope-control-squid-1')}
            >
              <i className="fas fa-microscope"></i>
              <span>Real Microscope 1</span>
            </button>
            <button
              className={`microscope-option ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 'active' : ''}`}
              onClick={() => onMicroscopeSelect('reef-imaging/mirror-microscope-control-squid-2')}
            >
              <i className="fas fa-microscope"></i>
              <span>Real Microscope 2</span>
            </button>
          </div>
          {selectedMicroscopeId && (
            <>
              <hr className="sidebar-divider" />
              <button onClick={handleToggleSamplePanel} className="toggle-sample-panel-button">
                <div className="button-content">
                  {isSamplePanelOpen ? (
                    <i className="fas fa-eye-slash"></i>
                  ) : (
                    <i className="fas fa-flask"></i>
                  )}
                  <span>{isSamplePanelOpen ? 'Hide Samples' : 'Select Samples'}</span>
                  <i className={`fas ${isSamplePanelOpen ? 'fa-chevron-left' : 'fa-chevron-right'} microscope-toggle-icon`}></i>
                </div>
              </button>
            </>
          )}
        </div>
      )}

      {activeTab === 'microscope' && selectedMicroscopeId && isMicroscopePanelOpen && (
        <div className={`sample-sidebar ${!isSamplePanelOpen ? 'collapsed' : ''}`}>
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
          <button 
            className="load-sample-button"
            onClick={handleLoadSample}
            disabled={!selectedSampleId}
          >
            Load Sample on Microscope
          </button>
        </div>
      )}
    </div>
  );
};

Sidebar.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  onMicroscopeSelect: PropTypes.func.isRequired,
  selectedMicroscopeId: PropTypes.string,
  incubatorControlService: PropTypes.object,
};

export default Sidebar; 