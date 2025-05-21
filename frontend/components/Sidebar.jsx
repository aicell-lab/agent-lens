import React, { useState } from 'react';
import './Sidebar.css';

const Sidebar = ({ activeTab, onTabChange, onMicroscopeSelect, selectedMicroscopeId }) => {
  const [isMicroscopeSubMenuOpen, setIsMicroscopeSubMenuOpen] = useState(false);

  const handleMicroscopeTabClick = () => {
    if (activeTab === 'microscope') {
      setIsMicroscopeSubMenuOpen(!isMicroscopeSubMenuOpen);
    } else {
      onTabChange('microscope');
      setIsMicroscopeSubMenuOpen(true);
    }
  };

  const handleMicroscopeSelection = (microscopeId) => {
    onMicroscopeSelect(microscopeId);
    setIsMicroscopeSubMenuOpen(false);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button 
          className={`sidebar-tab ${activeTab === 'microscope' ? 'active' : ''}`}
          onClick={handleMicroscopeTabClick}
        >
          <i className="fas fa-microscope"></i>
          <span>Microscopes {isMicroscopeSubMenuOpen ? '\u25B2' : '\u25BC'}</span>
        </button>
        {activeTab === 'microscope' && isMicroscopeSubMenuOpen && (
          <div className="sidebar-submenu">
            <button
              className={`sidebar-submenu-tab ${selectedMicroscopeId === 'squid-control/squid-control-reef' ? 'active' : ''}`}
              onClick={() => handleMicroscopeSelection('squid-control/squid-control-reef')}
            >
              <span>Simulated Microscope</span>
            </button>
            <button
              className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 'active' : ''}`}
              onClick={() => handleMicroscopeSelection('reef-imaging/mirror-microscope-control-squid-1')}
            >
              <span>Real Microscope 1</span>
            </button>
            <button
              className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 'active' : ''}`}
              onClick={() => handleMicroscopeSelection('reef-imaging/mirror-microscope-control-squid-2')}
            >
              <span>Real Microscope 2</span>
            </button>
          </div>
        )}
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
  );
};

export default Sidebar; 