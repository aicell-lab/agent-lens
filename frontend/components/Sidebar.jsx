import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './Sidebar.css';
import SampleSelector from './SampleSelector';

const Sidebar = React.forwardRef(({ 
  activeTab, 
  onTabChange, 
  onMicroscopeSelect, 
  selectedMicroscopeId,
  currentOperation, // Added prop to disable navigation during sample operations
}, ref) => {
  // State for microscope dropdown
  const [isMicroscopeDropdownOpen, setIsMicroscopeDropdownOpen] = useState(true);


  // New state for main sidebar collapse
  const [isMainSidebarCollapsed, setIsMainSidebarCollapsed] = useState(false);

  // Set default tab to 'microscope' on component mount
  useEffect(() => {
    // Set default tab on initial mount
    onTabChange('microscope');

  }, []); // Runs ONCE on mount



  const handleMicroscopeTabClick = () => {
    if (activeTab === 'microscope') {
      // Toggle dropdown instead of panel
      setIsMicroscopeDropdownOpen(!isMicroscopeDropdownOpen);
    } else {
      onTabChange('microscope');
      setIsMicroscopeDropdownOpen(true); // Open dropdown when switching to this tab
      // setIsMicroscopePanelOpen(true); // Removed
    }
  };








  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/microscope-control-squid-1' ||
                                 selectedMicroscopeId === 'reef-imaging/microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'agent-lens/squid-control-reef';

  // Toggle function for main sidebar collapse
  const toggleMainSidebarCollapse = () => {
    if (!currentOperation) { // Only allow collapse/expand if no operation is in progress
      setIsMainSidebarCollapsed(!isMainSidebarCollapsed);
    }
  };

  // Function to collapse sidebar from parent (for FREE_PAN auto-collapse)
  const collapseSidebar = () => {
    if (!currentOperation && !isMainSidebarCollapsed) {
      setIsMainSidebarCollapsed(true);
    }
  };

  // Function to expand sidebar from parent (for Fit to View)
  const expandSidebar = () => {
    if (!currentOperation && isMainSidebarCollapsed) {
      setIsMainSidebarCollapsed(false);
    }
  };

  // Expose collapse and expand functions to parent via useImperativeHandle
  React.useImperativeHandle(ref, () => ({
    collapseSidebar,
    expandSidebar
  }), [currentOperation, isMainSidebarCollapsed]);

  return (
    <div className="sidebar-container">
      <div className={`main-sidebar ${isMainSidebarCollapsed ? 'main-sidebar-collapsed' : ''} ${currentOperation ? 'operation-in-progress' : ''}`} style={{ cursor: currentOperation ? 'not-allowed' : 'default' }}>
        <div className="sidebar-tabs">
          <button 
            className={`sidebar-tab ${activeTab === 'microscope' ? 'active' : ''}`}
            onClick={handleMicroscopeTabClick}
            title={isMainSidebarCollapsed ? "Microscopes" : ""} // Show title on hover when collapsed
          >
            <i className="fas fa-microscope"></i>
            {!isMainSidebarCollapsed && <span>Microscopes</span>}
            {!isMainSidebarCollapsed && <i className={`fas ${isMicroscopeDropdownOpen ? 'fa-chevron-down' : 'fa-chevron-right'} microscope-toggle-icon`}></i>}
          </button>
          {/* Microscope Dropdown Submenu - Modified for CSS transition */}
          {activeTab === 'microscope' && !isMainSidebarCollapsed && (
            <div 
              className={`sidebar-submenu microscope-options-dropdown ${isMicroscopeDropdownOpen ? 'open' : ''}`}
            >
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'agent-lens/squid-control-reef' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('agent-lens/squid-control-reef');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
                disabled={!!currentOperation}
              >
                <i className="fas fa-desktop"></i> {/* Changed icon for simulated */}
                <span>Simulated Microscope</span>
              </button>
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/microscope-control-squid-1' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('reef-imaging/microscope-control-squid-1');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
                disabled={!!currentOperation}
              >
                <i className="fas fa-microscope"></i>
                <span>Real Microscope 1</span>
              </button>
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/microscope-control-squid-2' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('reef-imaging/microscope-control-squid-2');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
                disabled={!!currentOperation}
              >
                <i className="fas fa-microscope"></i>
                <span>Real Microscope 2</span>
              </button>
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/microscope-squid-plus-1' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('reef-imaging/microscope-squid-plus-1');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
                disabled={!!currentOperation}
              >
                <i className="fas fa-microscope"></i>
                <span>Squid+ 1</span>
              </button>
            </div>
          )}
          <button 
            className={`sidebar-tab ${activeTab === 'imagej' ? 'active' : ''}`}
            onClick={() => onTabChange('imagej')}
            disabled={!!currentOperation} 
            title={currentOperation ? "Sample operation in progress" : (isMainSidebarCollapsed ? "ImageJ" : "ImageJ.js for image processing")}
          >
            <i className="fas fa-magic"></i>
            {!isMainSidebarCollapsed && <span>ImageJ</span>}
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'incubator' ? 'active' : ''}`}
            onClick={() => onTabChange('incubator')}
            disabled={!!currentOperation} 
            title={currentOperation ? "Sample operation in progress" : (isMainSidebarCollapsed ? "Incubator" : "Control incubator")}
          >
            <i className="fas fa-temperature-high"></i>
            {!isMainSidebarCollapsed && <span>Incubator</span>}
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => onTabChange('dashboard')}
            disabled={!!currentOperation} 
            title={currentOperation ? "Sample operation in progress" : (isMainSidebarCollapsed ? "Dashboard" : "View dashboard and logs")}
          >
            <i className="fas fa-tachometer-alt"></i>
            {!isMainSidebarCollapsed && <span>Dashboard</span>}
          </button>
        </div>
        {/* Collapse/Expand button for the main sidebar */}
        <div className="main-sidebar-toggle-container">
          <button 
            onClick={toggleMainSidebarCollapse} 
            className="main-sidebar-toggle-button"
            disabled={!!currentOperation}
            title={currentOperation ? "Sample operation in progress" : (isMainSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar")}
          >
            <i className={`fas ${isMainSidebarCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`}></i>
          </button>
        </div>
      </div>
    </div>
  );
});

Sidebar.propTypes = {
  activeTab: PropTypes.string.isRequired,
  onTabChange: PropTypes.func.isRequired,
  onMicroscopeSelect: PropTypes.func.isRequired,
  selectedMicroscopeId: PropTypes.string,
  currentOperation: PropTypes.string, // Added prop type
};

export default Sidebar; 