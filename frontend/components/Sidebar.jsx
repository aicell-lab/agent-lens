import React from 'react';
import './Sidebar.css';

const Sidebar = ({ activeTab, onTabChange }) => {
  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button 
          className={`sidebar-tab ${activeTab === 'microscope' ? 'active' : ''}`}
          onClick={() => onTabChange('microscope')}
        >
          <i className="fas fa-microscope"></i>
          <span>Microscope</span>
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
          className={`sidebar-tab ${activeTab === 'imaging-tasks' ? 'active' : ''}`}
          onClick={() => onTabChange('imaging-tasks')}
        >
          <i className="fas fa-tasks"></i>
          <span>Imaging Tasks</span>
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