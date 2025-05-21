import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './Sidebar.css';
import SampleSelector from './SampleSelector';

const Sidebar = ({ 
  activeTab, 
  onTabChange, 
  onMicroscopeSelect, 
  selectedMicroscopeId,
  incubatorControlService,
  microscopeControlService
}) => {
  const [isMicroscopePanelOpen, setIsMicroscopePanelOpen] = useState(true);
  const [isSamplePanelOpen, setIsSamplePanelOpen] = useState(false);

  // Reset sample panel state when microscope selection changes
  useEffect(() => {
    if (!selectedMicroscopeId) {
      setIsSamplePanelOpen(false);
    }
  }, [selectedMicroscopeId]);

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

  const handleToggleSamplePanel = async () => {
    setIsSamplePanelOpen(!isSamplePanelOpen);
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
                  <span>{isSamplePanelOpen ? 'Hide' : 'Select Samples'}</span>
                  <i className={`fas ${isSamplePanelOpen ? 'fa-chevron-left' : 'fa-chevron-right'} microscope-toggle-icon`}></i>
                </div>
              </button>
            </>
          )}
        </div>
      )}

      {activeTab === 'microscope' && selectedMicroscopeId && isMicroscopePanelOpen && (
        <SampleSelector 
          isVisible={isSamplePanelOpen}
          selectedMicroscopeId={selectedMicroscopeId}
          microscopeControlService={microscopeControlService}
          incubatorControlService={incubatorControlService}
        />
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
  microscopeControlService: PropTypes.object,
};

export default Sidebar; 