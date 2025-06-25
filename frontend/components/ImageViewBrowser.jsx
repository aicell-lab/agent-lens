import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

// Utility function to get the correct service ID
const getServiceId = () => {
  const url = window.location.href;
  return url.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
};

const ImageViewBrowser = ({ appendLog }) => {
  const [selectedGalleryId, setSelectedGalleryId] = useState('');
  const [selectedGalleryName, setSelectedGalleryName] = useState('');
  const [datasets, setDatasets] = useState([]);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [subfolders, setSubfolders] = useState([]);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(false);
  const [isLoadingSubfolders, setIsLoadingSubfolders] = useState(false);
  const [currentView, setCurrentView] = useState('datasets'); // 'datasets' or 'files'

  // Listen for gallery selection events from sidebar
  useEffect(() => {
    const handleGallerySelected = (event) => {
      const { galleryId, galleryName } = event.detail;
      setSelectedGalleryId(galleryId);
      setSelectedGalleryName(galleryName);
      setCurrentView('datasets'); // Always switch to dataset view when gallery changes
      setDatasets([]); // Clear previous datasets
      setSelectedDataset(''); // Clear previous dataset selection
      loadDatasets(galleryId);
    };

    const storedGalleryId = localStorage.getItem('selectedGalleryId');
    const storedGalleryName = localStorage.getItem('selectedGalleryName');
    if (storedGalleryId) {
      setSelectedGalleryId(storedGalleryId);
      setSelectedGalleryName(storedGalleryName || storedGalleryId.split('/').pop() || storedGalleryId);
      loadDatasets(storedGalleryId);
    } else {
      // If no gallery is in local storage, perhaps clear datasets or show a prompt
      setDatasets([]);
      setCurrentView('datasets');
    }

    window.addEventListener('gallerySelected', handleGallerySelected);
    return () => {
      window.removeEventListener('gallerySelected', handleGallerySelected);
    };
  }, []); 

  // Load subfolders when dataset or path changes
  useEffect(() => {
    if (selectedDataset && currentView === 'files') {
      loadSubfolders(selectedDataset, currentPath);
    }
  }, [selectedDataset, currentPath, currentView]);

  const loadDatasets = async (galleryId) => {
    if (!galleryId) return;
    setIsLoadingDatasets(true);
    appendLog(`Loading datasets from gallery: ${galleryId}...`);
    
    try {
      const serviceId = getServiceId();
      const response = await fetch(`/agent-lens/apps/${serviceId}/datasets?gallery_id=${encodeURIComponent(galleryId)}`);
      const data = await response.json();
      
      if (response.ok && data && data.length > 0) {
        setDatasets(data);
        appendLog(`Loaded ${data.length} datasets from gallery: ${galleryId}`);
      } else {
        setDatasets([]);
        appendLog(`No datasets found in gallery: ${galleryId}`);
      }
    } catch (error) {
      console.error('Error fetching datasets:', error);
      appendLog(`Error loading datasets: ${error.message}`);
      setDatasets([]);
    } finally {
      setIsLoadingDatasets(false);
    }
  };

  const loadSubfolders = async (datasetId, dirPath = null) => {
    setIsLoadingSubfolders(true);
    try {
      const serviceId = getServiceId();
      const pathParam = dirPath ? `&dir_path=${encodeURIComponent(dirPath)}` : '';
      const response = await fetch(`/agent-lens/apps/${serviceId}/subfolders?dataset_id=${encodeURIComponent(datasetId)}${pathParam}&limit=50`);
      const data = await response.json();
      
      if (response.ok && data.items) {
        setSubfolders(data.items);
      } else {
        setSubfolders([]);
      }
    } catch (error) {
      console.error('Error fetching subfolders:', error);
      appendLog(`Error loading files: ${error.message}`);
      setSubfolders([]);
    } finally {
      setIsLoadingSubfolders(false);
    }
  };

  const handleDatasetClick = (datasetId) => {
    setSelectedDataset(datasetId);
    // Immediately switch to file browsing view for this dataset
    setCurrentView('files');
    setCurrentPath(''); // Start at the root of the dataset
    setBreadcrumbs([]);
    appendLog(`Browsing files in dataset: ${datasetId}`);
  };

  const handleBrowseFiles = () => {
    // This function is now effectively merged into handleDatasetClick if a dataset is already selected by click.

    if (!selectedDataset) {
        appendLog("Please select a dataset first to browse its files.");
        return;
    }
    setCurrentView('files');
    setCurrentPath('');
    setBreadcrumbs([]);
    appendLog(`Browsing files in dataset: ${selectedDataset}`);
  };

  const handleFolderClick = (folderName) => {
    if (!folderName || typeof folderName !== 'string') return;
    
    const newPath = currentPath 
      ? (currentPath.endsWith('/') ? `${currentPath}${folderName}` : `${currentPath}/${folderName}`)
      : folderName;
    
    setCurrentPath(newPath);
    
    if (currentPath === '') {
      setBreadcrumbs([{ name: folderName, path: folderName }]);
    } else {
      if (!breadcrumbs.some(b => b.path === newPath)) {
        setBreadcrumbs([...breadcrumbs, { name: folderName, path: newPath }]);
      }
    }
    appendLog(`Navigating to folder: ${newPath}`);
  };

  const navigateToBreadcrumb = (index) => {
    if (index === -1) {
      setCurrentPath('');
      setBreadcrumbs([]);
      appendLog('Navigated to root directory');
    } else if (index >= 0 && index < breadcrumbs.length) {
      const breadcrumb = breadcrumbs[index];
      setCurrentPath(breadcrumb.path);
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
      appendLog(`Navigated to: ${breadcrumb.path}`);
    }
  };

  const handleBackToDatasets = () => {
    setCurrentView('datasets');
    setSelectedDataset('');
    setCurrentPath('');
    setBreadcrumbs([]);
    setSubfolders([]);
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!selectedGalleryId) {
    return (
      <div className="control-view image-view-browser">
        <div className="browser-placeholder">
          <h3>Image Data Browser</h3>
          <p>Select a gallery from the sidebar to view available datasets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="control-view image-view-browser">
      <h3 className="browser-title">
        {currentView === 'datasets' ? 'Available Datasets' : 'Browse Files'}
        {selectedGalleryName && <span className="gallery-subtitle">Gallery: {selectedGalleryName}</span>}
      </h3>

      {currentView === 'datasets' ? (
        <div className="datasets-view">
          {isLoadingDatasets ? (
            <div className="loading-state">
              <i className="fas fa-spinner fa-spin mr-2"></i>
              <span>Loading datasets...</span>
            </div>
          ) : (
            <>
              <div className="datasets-grid">
                {datasets.length > 0 ? (
                  datasets.map((dataset) => (
                    <div 
                      key={dataset.id}
                      className={`dataset-card ${selectedDataset === dataset.id ? 'selected' : ''}`}
                      onClick={() => handleDatasetClick(dataset.id)} // Single click to select and browse
                    >
                      <div className="dataset-icon">
                        <i className="fas fa-database"></i>
                      </div>
                      <div className="dataset-info">
                        <h4 className="dataset-name">{dataset.name}</h4>
                        <p className="dataset-id">{dataset.id}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="no-datasets">
                    <i className="fas fa-folder-open"></i>
                    <p>No datasets available in this gallery, or gallery not found.</p>
                  </div>
                )}
              </div>

            </>
          )}
        </div>
      ) : ( // currentView === 'files'
        <div className="files-view">
          <div className="files-header">
            <button 
              onClick={handleBackToDatasets}
              className="back-to-datasets-btn"
            >
              <i className="fas fa-arrow-left mr-2"></i>
              Back to Datasets
            </button>
            
            <div className="breadcrumb-navigation">
              <span 
                className="breadcrumb-item root" 
                onClick={() => navigateToBreadcrumb(-1)}
              >
                <i className="fas fa-home mr-1"></i>
                Root ({selectedDataset ? selectedDataset.split('/').pop() : 'Dataset'})
              </span>
              {breadcrumbs.map((crumb, index) => (
                <React.Fragment key={index}>
                  <span className="breadcrumb-separator">/</span>
                  <span 
                    className="breadcrumb-item"
                    onClick={() => navigateToBreadcrumb(index)}
                  >
                    {crumb.name}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="files-listing">
            {isLoadingSubfolders ? (
              <div className="loading-state">
                <i className="fas fa-spinner fa-spin mr-2"></i>
                <span>Loading files...</span>
              </div>
            ) : (
              <div className="files-grid">
                {subfolders.length > 0 ? (
                  subfolders.map((item, index) => (
                    <div
                      key={index}
                      className={`file-card ${item.type === 'directory' ? 'folder' : 'file'}`}
                      onClick={() => item.type === 'directory' ? handleFolderClick(item.name) : null}
                    >
                      <div className="file-icon">
                        <i className={`fas ${item.type === 'directory' ? 'fa-folder' : 'fa-file'}`}></i>
                      </div>
                      <div className="file-info">
                        <p className="file-name">{item.name}</p>
                        {item.size && (
                          <p className="file-size">{formatFileSize(item.size)}</p>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="no-files">
                    <i className="fas fa-folder-open"></i>
                    <p>No files or folders found in this directory.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

ImageViewBrowser.propTypes = {
  appendLog: PropTypes.func.isRequired
};

export default ImageViewBrowser; 