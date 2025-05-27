import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './Sidebar.css';
import SampleSelector from './SampleSelector';

const Sidebar = ({ 
  activeTab, 
  onTabChange, 
  onMicroscopeSelect, 
  selectedMicroscopeId,
  currentOperation, // Added prop to disable navigation during sample operations
}) => {
  // State for microscope dropdown
  const [isMicroscopeDropdownOpen, setIsMicroscopeDropdownOpen] = useState(true);

  // New state for Image View
  const initialDefaultGalleryId = 'agent-lens/20250506-scan-time-lapse-gallery';
  const hpaGalleryId = 'agent-lens/hpa-sample-gallery';

  const [isImageViewPanelOpen, setIsImageViewPanelOpen] = useState(false);
  const [selectedGalleryId, setSelectedGalleryId] = useState(initialDefaultGalleryId);
  const [selectedGalleryName, setSelectedGalleryName] = useState(
    initialDefaultGalleryId.split('/').pop() || initialDefaultGalleryId
  ); // Placeholder, will be updated
  const [availableGalleries, setAvailableGalleries] = useState([
    { id: initialDefaultGalleryId, name: initialDefaultGalleryId.split('/').pop() || initialDefaultGalleryId },
    { id: hpaGalleryId, name: hpaGalleryId.split('/').pop() || hpaGalleryId }
  ]);
  const [isSettingUpGalleryMap, setIsSettingUpGalleryMap] = useState(false);

  // New state for main sidebar collapse
  const [isMainSidebarCollapsed, setIsMainSidebarCollapsed] = useState(false);

  // Set default tab to 'microscope' on component mount
  useEffect(() => {
    // Set default tab on initial mount
    onTabChange('microscope');

    // Setup and sync the initial default gallery
    const setupInitialDefaultGallery = async () => {
      // Fetch the definitive name for the initial gallery.
      // This call will also update selectedGalleryName state (if initialDefaultGalleryId is still selectedGalleryId)
      // and its entry in availableGalleries state via fetchGalleryInfo's internal logic.
      const definitiveInitialName = await fetchGalleryInfo(initialDefaultGalleryId);

      // Now, ensure ImageViewBrowser uses this default gallery by setting localStorage
      // and dispatching the event. This overrides any stale value in localStorage.
      localStorage.setItem('selectedGalleryId', initialDefaultGalleryId);
      localStorage.setItem('selectedGalleryName', definitiveInitialName); // Use the name that fetchGalleryInfo determined
      window.dispatchEvent(new CustomEvent('gallerySelected', {
        detail: { galleryId: initialDefaultGalleryId, galleryName: definitiveInitialName }
      }));
    };

    setupInitialDefaultGallery();
  }, []); // Runs ONCE on mount

  // Effect to fetch gallery info when selectedGalleryId changes (e.g., by double-click or initial set)
  useEffect(() => {
    if (selectedGalleryId) {
      // This will fetch info for the initialDefaultGalleryId on mount (as selectedGalleryId starts with it)
      // and for any subsequent changes to selectedGalleryId.
      // fetchGalleryInfo updates selectedGalleryName if the fetched ID matches current selectedGalleryId.
      fetchGalleryInfo(selectedGalleryId);
    }
  }, [selectedGalleryId]); // Re-run when selectedGalleryId changes

  const fetchGalleryInfo = async (galleryIdToFetch) => {
    let galleryDisplayName = galleryIdToFetch.split('/').pop() || galleryIdToFetch; // Fallback

    // Use a more specific name from availableGalleries if it's already been fetched and is better than derived
    const existingGalleryInList = availableGalleries.find(g => g.id === galleryIdToFetch);
    if (existingGalleryInList && existingGalleryInList.name !== (galleryIdToFetch.split('/').pop() || galleryIdToFetch)) {
      galleryDisplayName = existingGalleryInList.name;
    }

    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      const response = await fetch(`/agent-lens/apps/${serviceId}/gallery-info?gallery_id=${encodeURIComponent(galleryIdToFetch)}`);
      const data = await response.json();
      if (response.ok && data) {
        // Prefer manifest name, then alias, then derived name
        galleryDisplayName = data.manifest?.name || data.alias || (galleryIdToFetch.split('/').pop() || galleryIdToFetch);
      }
    } catch (error) {
      console.error(`Error fetching gallery info for ${galleryIdToFetch}:`, error);
      // On error, galleryDisplayName retains its current value (derived or from existing list)
    }

    // Update selectedGalleryName state only if the fetched info is for the *currently selected* gallery in the UI
    if (galleryIdToFetch === selectedGalleryId) {
      setSelectedGalleryName(galleryDisplayName);
    }

    // Update the name in the availableGalleries list state
    setAvailableGalleries(prevGalleries =>
      prevGalleries.map(gallery =>
        gallery.id === galleryIdToFetch ? { ...gallery, name: galleryDisplayName } : gallery
      )
    );
    return galleryDisplayName; // Return the determined name for use by callers like setupInitialDefaultGallery
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
    if (activeTab === 'image-view' || activeTab === 'image-view-map') {
      const newPanelState = !isImageViewPanelOpen;
      setIsImageViewPanelOpen(newPanelState);
    } else {
      onTabChange('image-view');
      setIsImageViewPanelOpen(true);
    }
  };

  const handleGalleryItemClick = (galleryId) => {
    // Step 1: Select the gallery (this updates UI and might trigger async name fetch via useEffect)
    setSelectedGalleryId(galleryId);

    // Step 2: Prepare to trigger the data loading for ImageViewBrowser

    const galleryInfo = availableGalleries.find(g => g.id === galleryId);
    const nameToDispatch = galleryInfo ? galleryInfo.name : (galleryId.split('/').pop() || galleryId);
    // setSelectedGalleryName(nameToDispatch); // This will be handled by useEffect watching selectedGalleryId

    // Step 3: Update localStorage and dispatch the event for ImageViewBrowser.
    localStorage.setItem('selectedGalleryId', galleryId);
    localStorage.setItem('selectedGalleryName', nameToDispatch); // Use the name we have now
    window.dispatchEvent(new CustomEvent('gallerySelected', {
      detail: { galleryId: galleryId, galleryName: nameToDispatch }
    }));

    // Step 4: Ensure the correct tab and panel state
    if (activeTab === 'image-view-map') {
      onTabChange('image-view'); // Switch from map view to browser view
    } else if (activeTab !== 'image-view') {
      onTabChange('image-view'); // Switch to image view tab if not already on it or map view
    }

    if (!isImageViewPanelOpen) {
      setIsImageViewPanelOpen(true); // Open the panel if it's closed
    }
  };

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
        // If the removed gallery was the selected one, select the first in the new list
        const newSelectedId = updatedGalleries[0].id;
        handleGalleryItemClick(newSelectedId); // Use the click handler to ensure all logic runs
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
          {/* Microscope Dropdown Submenu - Modified for CSS transition */}
          {activeTab === 'microscope' && !isMainSidebarCollapsed && (
            <div 
              className={`sidebar-submenu microscope-options-dropdown ${isMicroscopeDropdownOpen ? 'open' : ''}`}
            >
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
                  onClick={() => handleGalleryItemClick(gallery.id)} // Changed to single click
                >
                  {/* The inner button is primarily for layout and visual grouping, not a separate click target changing selection */}
                  <button className="gallery-select-btn" tabIndex="-1"> {/* tabIndex to prevent double focus */}
                    <i className="fas fa-folder"></i>
                    <span>{gallery.name}</span>
                  </button>
                  {availableGalleries.length > 1 && (
                    <button
                      className="gallery-remove-btn"
                      onClick={(e) => { 
                        e.stopPropagation(); // Prevent gallery selection when removing
                        handleRemoveGallery(gallery.id); 
                      }}
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
  currentOperation: PropTypes.string, // Added prop type
};

export default Sidebar; 