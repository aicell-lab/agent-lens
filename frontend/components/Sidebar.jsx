import React from 'react';
import './Sidebar.css';

const Sidebar = ({ activeTab, onTabChange, onMicroscopeSelect, selectedMicroscopeId }) => {
  return (
    <div className="sidebar-container">
      <div className="main-sidebar">
        <div className="sidebar-tabs">
          <button 
            className={`sidebar-tab ${activeTab === 'microscope' ? 'active' : ''}`}
            onClick={() => onTabChange('microscope')}
          >
            <i className="fas fa-microscope"></i>
            <span>Microscopes</span>
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
        <div className="microscope-sidebar">
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
        </div>
      )}
    </div>
  );
};

export default Sidebar; 