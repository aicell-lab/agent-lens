import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './Sidebar.css';
import SampleSelector from './SampleSelector';

const Sidebar = ({ 
  activeTab, 
  onTabChange, 
  onMicroscopeSelect, 
  selectedMicroscopeId,
  // incubatorControlService, // Will be passed directly to SampleSelector if needed elsewhere
  // microscopeControlService, // Will be passed directly to SampleSelector if needed elsewhere
  // roboticArmService // Will be passed directly to SampleSelector if needed elsewhere
  currentOperation, // Added prop to disable navigation during sample operations
}) => {
  // State for microscope dropdown
  const [isMicroscopeDropdownOpen, setIsMicroscopeDropdownOpen] = useState(false);
  // const [isMicroscopePanelOpen, setIsMicroscopePanelOpen] = useState(true); // Removed
  // const [isSamplePanelOpen, setIsSamplePanelOpen] = useState(false); // SampleSelector will be moved

  // New state for Image View
  const [isImageViewPanelOpen, setIsImageViewPanelOpen] = useState(false);
  const [selectedGalleryId, setSelectedGalleryId] = useState('agent-lens/20250506-scan-time-lapse-gallery');
  const [selectedGalleryName, setSelectedGalleryName] = useState('');
  const [availableGalleries, setAvailableGalleries] = useState([
    { id: 'agent-lens/20250506-scan-time-lapse-gallery', name: 'Default Time-lapse Gallery' }
  ]);
  const [isSettingUpGalleryMap, setIsSettingUpGalleryMap] = useState(false);

  // New state for main sidebar collapse
  const [isMainSidebarCollapsed, setIsMainSidebarCollapsed] = useState(false);

  // Set default tab to 'microscope' on component mount
  useEffect(() => {
    onTabChange('microscope');
  }, []); // Empty dependency array means this runs once on mount

  // Fetch gallery name when gallery ID changes
  useEffect(() => {
    if (selectedGalleryId) {
      fetchGalleryInfo(selectedGalleryId);
    }
  }, [selectedGalleryId]);

  // Also fetch gallery info on component mount for the default gallery
  useEffect(() => {
    if (selectedGalleryId) {
      fetchGalleryInfo(selectedGalleryId);
    }
  }, []); // Empty dependency array means this runs once on mount

  const fetchGalleryInfo = async (galleryId) => {
    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      const response = await fetch(`/agent-lens/apps/${serviceId}/gallery-info?gallery_id=${encodeURIComponent(galleryId)}`);
      const data = await response.json();
      
      if (response.ok && data) {
        // Use the same pattern as in register_frontend_service.py for getting display name
        const displayName = data.manifest?.name || data.alias || galleryId.split('/').pop() || galleryId;
        setSelectedGalleryName(displayName);
        
        // Update the gallery in availableGalleries if it exists
        setAvailableGalleries(prev => prev.map(gallery => 
          gallery.id === galleryId 
            ? { ...gallery, name: displayName }
            : gallery
        ));
      } else {
        // Fallback to derived name if API fails
        setSelectedGalleryName(galleryId.split('/').pop() || galleryId);
      }
    } catch (error) {
      console.error('Error fetching gallery info:', error);
      // Fallback to derived name if API fails
      setSelectedGalleryName(galleryId.split('/').pop() || galleryId);
    }
  };

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

  const handleImageViewTabClick = () => {
    if (activeTab === 'image-view') {
      const newPanelState = !isImageViewPanelOpen;
      setIsImageViewPanelOpen(newPanelState);
    } else {
      onTabChange('image-view');
      setIsImageViewPanelOpen(true);
    }
  };

  // const handleToggleSamplePanel = async () => { // Removed: SampleSelector will be moved
  //   setIsSamplePanelOpen(!isSamplePanelOpen);
  // };

  const handleBrowseData = () => {
    // If we're currently in map view, close it first
    if (activeTab === 'image-view-map') {
      onTabChange('image-view');
    }
    
    // Store the selected gallery ID and name for the main content area to use
    localStorage.setItem('selectedGalleryId', selectedGalleryId);
    localStorage.setItem('selectedGalleryName', selectedGalleryName);
    // Trigger a custom event to notify main content area
    window.dispatchEvent(new CustomEvent('gallerySelected', { 
      detail: { galleryId: selectedGalleryId, galleryName: selectedGalleryName } 
    }));
  };

  const handleViewGalleryImageData = async () => {
    if (isSettingUpGalleryMap || !selectedGalleryId) return;
    
    setIsSettingUpGalleryMap(true);
    
    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      const response = await fetch(`/agent-lens/apps/${serviceId}/setup-gallery-map?gallery_id=${encodeURIComponent(selectedGalleryId)}`);
      const data = await response.json();
      
      if (data.success) {
        // Store the gallery ID in local storage so other components can access it
        localStorage.setItem('imageMapGallery', selectedGalleryId);
        localStorage.setItem('imageMapGalleryName', selectedGalleryName);
        // Also store in session storage to track this was explicitly set in this session
        sessionStorage.setItem('mapSetupExplicit', 'true');
        
        // Switch to map view
        onTabChange('image-view-map');
      } else {
        console.error('Failed to setup gallery map:', data.message);
      }
    } catch (error) {
      console.error('Error setting up gallery map:', error);
    } finally {
      setIsSettingUpGalleryMap(false);
    }
  };

  const handleCloseMapView = () => {
    // Close the map view and return to image view
    onTabChange('image-view');
  };

  const handleGallerySelect = async (galleryId) => {
    setSelectedGalleryId(galleryId);
    // Gallery name will be fetched by the useEffect
  };

  const handleAddGallery = () => {
    const galleryId = prompt('Enter gallery ID:');
    if (galleryId && !availableGalleries.find(g => g.id === galleryId)) {
      const newGallery = {
        id: galleryId,
        name: galleryId.split('/').pop() || galleryId // Temporary name, will be updated when selected
      };
      setAvailableGalleries([...availableGalleries, newGallery]);
    }
  };

  const handleRemoveGallery = (galleryId) => {
    if (availableGalleries.length > 1) {
      const updatedGalleries = availableGalleries.filter(g => g.id !== galleryId);
      setAvailableGalleries(updatedGalleries);
      if (selectedGalleryId === galleryId) {
        setSelectedGalleryId(updatedGalleries[0].id);
      }
    }
  };

  const isRealMicroscopeSelected = selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ||
                                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2';
  const isSimulatedMicroscopeSelected = selectedMicroscopeId === 'squid-control/squid-control-reef';

  // Toggle function for main sidebar collapse
  const toggleMainSidebarCollapse = () => {
    if (!currentOperation) { // Only allow collapse/expand if no operation is in progress
      setIsMainSidebarCollapsed(!isMainSidebarCollapsed);
    }
  };

  return (
    <div className="sidebar-container">
      <div className={`main-sidebar ${isMainSidebarCollapsed ? 'main-sidebar-collapsed' : ''}`}>
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
          {/* Microscope Dropdown Submenu */}
          {activeTab === 'microscope' && isMicroscopeDropdownOpen && !isMainSidebarCollapsed && (
            <div className="sidebar-submenu microscope-options-dropdown">
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'squid-control/squid-control-reef' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('squid-control/squid-control-reef');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
              >
                <i className="fas fa-desktop"></i> {/* Changed icon for simulated */}
                <span>Simulated Microscope</span>
              </button>
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('reef-imaging/mirror-microscope-control-squid-1');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
              >
                <i className="fas fa-microscope"></i>
                <span>Real Microscope 1</span>
              </button>
              <button
                className={`sidebar-submenu-tab ${selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 'active' : ''}`}
                onClick={() => {
                  onMicroscopeSelect('reef-imaging/mirror-microscope-control-squid-2');
                  // setIsMicroscopeDropdownOpen(false); // Optional: close dropdown on selection
                }}
              >
                <i className="fas fa-microscope"></i>
                <span>Real Microscope 2</span>
              </button>
            </div>
          )}
          <button 
            className={`sidebar-tab ${activeTab === 'image-view' || activeTab === 'image-view-map' ? 'active' : ''}`}
            onClick={handleImageViewTabClick}
            disabled={!!currentOperation} 
            title={currentOperation ? "Sample operation in progress" : (isMainSidebarCollapsed ? "Image View" : "View images and galleries")}
          >
            <i className="fas fa-images"></i>
            {!isMainSidebarCollapsed && <span>Image View</span>}
            {!isMainSidebarCollapsed && <i className={`fas ${(activeTab === 'image-view' || activeTab === 'image-view-map') && isImageViewPanelOpen ? 'fa-chevron-left' : 'fa-chevron-right'} microscope-toggle-icon`}></i>}
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
      
      {(activeTab === 'image-view' || activeTab === 'image-view-map') && (
        <div className={`image-view-sidebar ${!isImageViewPanelOpen ? 'collapsed' : ''}`}>
          <h3 className="image-view-sidebar-title">Select Image Gallery</h3>
          
          {/* Gallery Selection */}
          <div className="gallery-selection">
            <div className="gallery-header">
              <span className="gallery-label">Gallery:</span>
              <div className="gallery-actions">
                <button 
                  className="gallery-action-btn add-btn"
                  onClick={handleAddGallery}
                  title="Add Gallery"
                >
                  <i className="fas fa-plus"></i>
                </button>
              </div>
            </div>
            
            <div className="gallery-options">
              {availableGalleries.map((gallery) => (
                <div 
                  key={gallery.id}
                  className={`gallery-option ${selectedGalleryId === gallery.id ? 'active' : ''}`}
                >
                  <button
                    className="gallery-select-btn"
                    onClick={() => handleGallerySelect(gallery.id)}
                  >
                    <i className="fas fa-folder"></i>
                    <span>{gallery.name}</span>
                  </button>
                  {availableGalleries.length > 1 && (
                    <button
                      className="gallery-remove-btn"
                      onClick={() => handleRemoveGallery(gallery.id)}
                      title="Remove Gallery"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <hr className="sidebar-divider" />

          {/* Gallery Actions */}
          <div className="gallery-actions-section">
            {activeTab === 'image-view-map' ? (
              // Show red Close button when in map view
              <button 
                onClick={handleCloseMapView} 
                className="close-map-view-button"
              >
                <i className="fas fa-map mr-2"></i>
                Close
              </button>
            ) : (
              // Show View Image Data button when not in map view
              <button 
                onClick={handleViewGalleryImageData} 
                className="view-gallery-image-data-button"
                disabled={isSettingUpGalleryMap || !selectedGalleryId}
              >
                {isSettingUpGalleryMap ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Setting Up Gallery Map...
                  </>
                ) : (
                  <>
                    <i className="fas fa-map mr-2"></i>
                    View Image Data
                  </>
                )}
              </button>
            )}
            
            <button 
              onClick={handleBrowseData} 
              className="browse-data-button"
            >
              <i className="fas fa-search mr-2"></i>
              Browse Data
            </button>
          </div>
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
  // incubatorControlService: PropTypes.object, // Removed from here
  // microscopeControlService: PropTypes.object, // Removed from here
  // roboticArmService: PropTypes.object // Removed from here
  currentOperation: PropTypes.string, // Added prop type
};

export default Sidebar; 