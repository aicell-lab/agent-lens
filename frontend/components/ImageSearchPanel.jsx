import React, { useState, useRef, useCallback, useEffect } from 'react';
import PropTypes from 'prop-types';
import './ImageSearchPanel.css';

const ImageSearchPanel = ({ similarityService, appendLog, showNotification }) => {
  // Search states
  const [searchMode, setSearchMode] = useState('text'); // 'text' or 'image'
  const [textQuery, setTextQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [searchType, setSearchType] = useState('images'); // 'images' or 'cells'
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);

  // Upload states
  const [uploadMode, setUploadMode] = useState('images'); // 'images' or 'cells'
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadAnnotation, setUploadAnnotation] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  // File input refs
  const searchFileInputRef = useRef(null);
  const uploadFileInputRef = useRef(null);

  // Drag and drop states
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragTarget, setDragTarget] = useState(null); // 'search' or 'upload'

  // Supported image formats
  const supportedFormats = [
    'image/jpeg', 'image/png', 'image/tiff', 'image/bmp', 
    'image/gif', 'image/webp', 'image/x-ms-bmp'
  ];

  const isValidImageFile = (file) => {
    if (!file) return false;
    
    // Check MIME type
    if (supportedFormats.includes(file.type)) {
      return true;
    }
    
    // Check file extension as fallback
    const extension = file.name.toLowerCase().split('.').pop();
    const validExtensions = ['jpg', 'jpeg', 'png', 'tiff', 'tif', 'bmp', 'gif', 'webp'];
    return validExtensions.includes(extension);
  };

  const handleFileRead = (file, callback) => {
    if (!isValidImageFile(file)) {
      showNotification(`Unsupported file format: ${file.name}. Please use JPEG, PNG, TIFF, BMP, GIF, or WebP.`, 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      callback(e.target.result, file);
    };
    reader.onerror = () => {
      showNotification('Error reading file', 'error');
    };
    reader.readAsArrayBuffer(file);
  };

  // Search functionality
  const handleSearch = async () => {
    if (!similarityService) {
      showNotification('Similarity service not available', 'error');
      return;
    }

    if (searchMode === 'text' && !textQuery.trim()) {
      showNotification('Please enter a search query', 'error');
      return;
    }

    if (searchMode === 'image' && !selectedFile) {
      showNotification('Please select an image file', 'error');
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      let results;
      
      if (searchMode === 'text') {
        if (searchType === 'images') {
          results = await similarityService.find_similar_images(textQuery, 5);
        } else {
          results = await similarityService.find_similar_cells(textQuery, 5);
        }
      } else {
        // Image search
        handleFileRead(selectedFile, async (arrayBuffer, file) => {
          try {
            const uint8Array = new Uint8Array(arrayBuffer);
            
            if (searchType === 'images') {
              results = await similarityService.find_similar_images(uint8Array, 5);
            } else {
              results = await similarityService.find_similar_cells(uint8Array, 5);
            }
            
            if (Array.isArray(results)) {
              setSearchResults(results);
              appendLog(`Found ${results.length} similar ${searchType}`);
            } else if (results?.status === 'error') {
              showNotification(results.message || 'Search failed', 'error');
            } else {
              setSearchResults([]);
              appendLog('No results found');
            }
          } catch (error) {
            console.error('Search error:', error);
            showNotification(`Search failed: ${error.message}`, 'error');
          } finally {
            setIsSearching(false);
          }
        });
        return; // Exit early as handleFileRead will handle the async completion
      }

      if (Array.isArray(results)) {
        setSearchResults(results);
        appendLog(`Found ${results.length} similar ${searchType}`);
      } else if (results?.status === 'error') {
        showNotification(results.message || 'Search failed', 'error');
      } else {
        setSearchResults([]);
        appendLog('No results found');
      }
    } catch (error) {
      console.error('Search error:', error);
      showNotification(`Search failed: ${error.message}`, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  // Upload functionality
  const handleUpload = async () => {
    if (!similarityService) {
      showNotification('Similarity service not available', 'error');
      return;
    }

    if (!uploadFile || !uploadDescription.trim()) {
      showNotification('Please select a file and enter a description', 'error');
      return;
    }

    setIsUploading(true);

    handleFileRead(uploadFile, async (arrayBuffer, file) => {
      try {
        const uint8Array = new Uint8Array(arrayBuffer);
        const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
        
                 let result;
         if (uploadMode === 'images') {
           result = await similarityService.add_image(
             uint8Array, 
             uploadDescription, 
             fileExtension
           );
         } else {
           result = await similarityService.add_cell(
             uint8Array, 
             uploadDescription, 
             uploadAnnotation || '', 
             fileExtension
           );
         }

        if (result?.status === 'success') {
          showNotification(`${uploadMode === 'images' ? 'Image' : 'Cell'} uploaded successfully!`, 'success');
          appendLog(`Uploaded ${uploadMode === 'images' ? 'image' : 'cell'}: ${uploadDescription}`);
          
                     // Reset upload form
           setUploadFile(null);
           setUploadDescription('');
           setUploadAnnotation('');
           if (uploadFileInputRef.current) {
             uploadFileInputRef.current.value = '';
           }
        } else {
          showNotification(result?.message || 'Upload failed', 'error');
        }
      } catch (error) {
        console.error('Upload error:', error);
        showNotification(`Upload failed: ${error.message}`, 'error');
      } finally {
        setIsUploading(false);
      }
    });
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e, target) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
    setDragTarget(target);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragTarget(null);
  }, []);

  const handleDrop = useCallback((e, target) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    setDragTarget(null);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      const file = files[0];
      if (isValidImageFile(file)) {
        if (target === 'search') {
          setSelectedFile(file);
          setSearchMode('image');
        } else if (target === 'upload') {
          setUploadFile(file);
        }
      } else {
        showNotification('Please drop a valid image file', 'error');
      }
    }
  }, [showNotification]);

  const Tooltip = ({ text, children }) => (
    <div className="tooltip-container">
      {children}
      <div className="tooltip-text">{text}</div>
    </div>
  );

  return (
    <div className="control-view image-search-panel">
      <h3 className="panel-title">Image Similarity Search</h3>
      
      {/* Search Section */}
      <div className="search-section">
        <h4 className="section-title">Search</h4>
        
        {/* Search Type Toggle */}
        <div className="toggle-group">
          <label className="toggle-label">
            Search in:
            <Tooltip text="Microscopy images: Search in the full microscope field-of-view images. Cell images: Search in the segmented single cell images.">
              <i className="fas fa-question-circle tooltip-icon"></i>
            </Tooltip>
          </label>
          <div className="toggle-buttons">
            <button
              className={`toggle-btn ${searchType === 'images' ? 'active' : ''}`}
              onClick={() => setSearchType('images')}
            >
              <i className="fas fa-microscope"></i> Microscopy Images
            </button>
            <button
              className={`toggle-btn ${searchType === 'cells' ? 'active' : ''}`}
              onClick={() => setSearchType('cells')}
            >
              <i className="fas fa-circle"></i> Single Cells
            </button>
          </div>
        </div>

        {/* Search Mode Toggle */}
        <div className="input-mode-toggle">
          <button
            className={`mode-btn ${searchMode === 'text' ? 'active' : ''}`}
            onClick={() => setSearchMode('text')}
          >
            <i className="fas fa-font"></i> Text Search
          </button>
          <button
            className={`mode-btn ${searchMode === 'image' ? 'active' : ''}`}
            onClick={() => setSearchMode('image')}
          >
            <i className="fas fa-image"></i> Image Search
          </button>
        </div>

        {/* Text Search Input */}
        {searchMode === 'text' && (
          <div className="input-group">
            <label>Search Query:</label>
            <input
              type="text"
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="Enter description to search for..."
              className="text-input"
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
        )}

        {/* Image Search Input */}
        {searchMode === 'image' && (
          <div className="input-group">
            <label>Search Image:</label>
            <div 
              className={`file-upload-area ${isDragOver && dragTarget === 'search' ? 'drag-over' : ''}`}
              onDragOver={(e) => handleDragOver(e, 'search')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'search')}
            >
              <input
                type="file"
                ref={searchFileInputRef}
                onChange={(e) => setSelectedFile(e.target.files[0])}
                accept="image/*,.tiff,.tif"
                className="file-input"
              />
              <div className="upload-prompt">
                {selectedFile ? (
                  <span><i className="fas fa-image"></i> {selectedFile.name}</span>
                ) : (
                  <>
                    <i className="fas fa-cloud-upload-alt"></i>
                    <span>Drop image here or click to browse</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Search Button */}
        <button
          onClick={handleSearch}
          disabled={isSearching || (searchMode === 'text' && !textQuery.trim()) || (searchMode === 'image' && !selectedFile)}
          className="search-btn"
        >
          {isSearching ? (
            <>
              <i className="fas fa-spinner fa-spin"></i> Searching...
            </>
          ) : (
            <>
              <i className="fas fa-search"></i> Search
            </>
          )}
        </button>
      </div>

      <hr className="section-divider" />

      {/* Search Results */}
      <div className="results-section">
        <h4 className="section-title">Search Results</h4>
        {searchResults.length > 0 ? (
          <div className="results-grid">
            {searchResults.map((result, index) => (
              <div key={result.id || index} className="result-item">
                <div className="result-image">
                  <img 
                    src={`data:image/jpeg;base64,${result.image_base64}`} 
                    alt={result.text_description}
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
                <div className="result-info">
                  <div className="result-description">{result.text_description}</div>
                  <div className="result-similarity">
                    Similarity: {(result.similarity * 100).toFixed(1)}%
                  </div>
                  {result.annotation && (
                    <div className="result-annotation">Note: {result.annotation}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="no-results">
            <i className="fas fa-search"></i>
            <span>No search results yet</span>
          </div>
        )}
      </div>

      <hr className="section-divider" />

      {/* Upload Section */}
      <div className="upload-section">
        <h4 className="section-title">Add to Dataset</h4>
        
        {/* Upload Type Toggle */}
        <div className="toggle-group">
          <label className="toggle-label">Upload type:</label>
          <div className="toggle-buttons">
            <button
              className={`toggle-btn ${uploadMode === 'images' ? 'active' : ''}`}
              onClick={() => setUploadMode('images')}
            >
              <i className="fas fa-microscope"></i> Microscopy Image
            </button>
            <button
              className={`toggle-btn ${uploadMode === 'cells' ? 'active' : ''}`}
              onClick={() => setUploadMode('cells')}
            >
              <i className="fas fa-circle"></i> Single Cell
            </button>
          </div>
        </div>

        {/* File Upload */}
        <div className="input-group">
          <label>Image File:</label>
          <div 
            className={`file-upload-area ${isDragOver && dragTarget === 'upload' ? 'drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, 'upload')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, 'upload')}
          >
            <input
              type="file"
              ref={uploadFileInputRef}
              onChange={(e) => setUploadFile(e.target.files[0])}
              accept="image/*,.tiff,.tif"
              className="file-input"
            />
            <div className="upload-prompt">
              {uploadFile ? (
                <span><i className="fas fa-image"></i> {uploadFile.name}</span>
              ) : (
                <>
                  <i className="fas fa-cloud-upload-alt"></i>
                  <span>Drop image here or click to browse</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Description Input */}
        <div className="input-group">
          <label>Description: *</label>
          <input
            type="text"
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            placeholder={uploadMode === 'images' ? "Describe this image (include channel if applicable, e.g., 'DAPI stained nuclei', 'GFP expressing cells')..." : "Describe this cell..."}
            className="text-input"
          />
        </div>

        {/* Conditional fields based on upload type */}
        {uploadMode === 'cells' && (
          <div className="input-group">
            <label>Annotation (optional):</label>
            <input
              type="text"
              value={uploadAnnotation}
              onChange={(e) => setUploadAnnotation(e.target.value)}
              placeholder="Additional notes about this cell..."
              className="text-input"
            />
          </div>
        )}

        {/* Upload Button */}
        <button
          onClick={handleUpload}
          disabled={isUploading || !uploadFile || !uploadDescription.trim()}
          className="upload-btn"
        >
          {isUploading ? (
            <>
              <i className="fas fa-spinner fa-spin"></i> Uploading...
            </>
          ) : (
            <>
              <i className="fas fa-upload"></i> Add to Dataset
            </>
          )}
        </button>
      </div>
    </div>
  );
};

ImageSearchPanel.propTypes = {
  similarityService: PropTypes.object,
  appendLog: PropTypes.func.isRequired,
  showNotification: PropTypes.func.isRequired,
};

export default ImageSearchPanel; 