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
  microscopeControlService,
  roboticArmService
}) => {
  const [isMicroscopePanelOpen, setIsMicroscopePanelOpen] = useState(true);
  const [isSamplePanelOpen, setIsSamplePanelOpen] = useState(false);
  
  // New state for Image View
  const [isImageViewPanelOpen, setIsImageViewPanelOpen] = useState(false);
  const [selectedGalleryId, setSelectedGalleryId] = useState('agent-lens/20250506-scan-time-lapse-gallery');
  const [selectedGalleryName, setSelectedGalleryName] = useState('');
  const [availableGalleries, setAvailableGalleries] = useState([
    { id: 'agent-lens/20250506-scan-time-lapse-gallery', name: 'Default Time-lapse Gallery' }
  ]);
  const [isSettingUpGalleryMap, setIsSettingUpGalleryMap] = useState(false);

  // Set default tab to 'microscope' on component mount
  useEffect(() => {
    onTabChange('microscope');
  }, []); // Empty dependency array means this runs once on mount

  // Reset sample panel state when microscope selection changes
  useEffect(() => {
    if (!selectedMicroscopeId) {
      setIsSamplePanelOpen(false);
    }
  }, [selectedMicroscopeId]);

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

  const handleImageViewTabClick = () => {
    if (activeTab === 'image-view') {
      const newPanelState = !isImageViewPanelOpen;
      setIsImageViewPanelOpen(newPanelState);
    } else {
      onTabChange('image-view');
      setIsImageViewPanelOpen(true);
    }
  };

  const handleToggleSamplePanel = async () => {
    setIsSamplePanelOpen(!isSamplePanelOpen);
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
            className={`sidebar-tab ${activeTab === 'image-view' || activeTab === 'image-view-map' ? 'active' : ''}`}
            onClick={handleImageViewTabClick}
          >
            <i className="fas fa-images"></i>
            <span>Image View</span>
            <i className={`fas ${(activeTab === 'image-view' || activeTab === 'image-view-map') && isImageViewPanelOpen ? 'fa-chevron-left' : 'fa-chevron-right'} microscope-toggle-icon`}></i>
          </button>
          <button 
            className={`sidebar-tab ${activeTab === 'incubator' ? 'active' : ''}`}
            onClick={() => onTabChange('incubator')}
          >
            <i className="fas fa-temperature-high"></i>
            <span>Incubator</span>
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
          roboticArmService={roboticArmService}
        />
      )}

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
  incubatorControlService: PropTypes.object,
  microscopeControlService: PropTypes.object,
  roboticArmService: PropTypes.object
};

export default Sidebar; 