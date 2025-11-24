import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './SimilaritySearchPanel.css'; // Import styles for annotation-details-window class

/**
 * SimilarityResultInfoWindow - A floating window that displays detailed information about a clicked similarity result
 * 
 * This component shows:
 * - Preview image
 * - UUID
 * - Description
 * - Result type
 * - Well ID
 * - Timestamp
 */
const SimilarityResultInfoWindow = ({
  result,
  position,
  isVisible,
  onClose,
  containerBounds = null,
  onSearch = null,
  isSearching = false,
  collectionName = "Agentlens",
  applicationId = null
}) => {
  // All useState hooks must be at the top, before any early returns
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  const [editingTags, setEditingTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [isUpdatingTags, setIsUpdatingTags] = useState(false);

  // Adjust window position to keep it fully visible within container bounds
  useEffect(() => {
    if (!isVisible || !position) return;

    const windowWidth = 280; // Approximate window width
    const windowHeight = 350; // Approximate window height
    const padding = 20; // Padding from edges

    let newX = position.x;
    let newY = position.y;

    // Get container dimensions
    const containerWidth = containerBounds?.width || window.innerWidth;
    const containerHeight = containerBounds?.height || window.innerHeight;

    // Adjust horizontal position
    if (newX + windowWidth + padding > containerWidth) {
      newX = containerWidth - windowWidth - padding;
    }
    if (newX < padding) {
      newX = padding;
    }

    // Adjust vertical position
    if (newY + windowHeight + padding > containerHeight) {
      newY = containerHeight - windowHeight - padding;
    }
    if (newY < padding) {
      newY = padding;
    }

    setAdjustedPosition({ x: newX, y: newY });
  }, [position, isVisible, containerBounds]);

  // Handle ESC key to close window
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  // Update tags when result changes
  useEffect(() => {
    if (!result) {
      setEditingTags([]);
      setNewTagInput('');
      return;
    }
    
    const props = result.properties || result;
    const tagString = props.tag || '';
    let tags = [];
    try {
      if (tagString) {
        tags = JSON.parse(tagString);
        if (!Array.isArray(tags)) tags = [];
      }
    } catch (e) {
      console.warn('Failed to parse tags:', e);
      tags = [];
    }
    setEditingTags(tags);
    setNewTagInput('');
  }, [result]);

  // Early return after all hooks
  if (!isVisible || !result) return null;

  // Extract result data from properties
  const props = result.properties || result;
  const metadata = props.metadata || '';
  
  // Debug: Log available properties to see what morphology data exists
  console.log('SimilarityResultInfoWindow - Available properties:', {
    area: props.area,
    perimeter: props.perimeter,
    equivalent_diameter: props.equivalent_diameter,
    bbox_width: props.bbox_width,
    bbox_height: props.bbox_height,
    aspect_ratio: props.aspect_ratio,
    circularity: props.circularity,
    eccentricity: props.eccentricity,
    solidity: props.solidity,
    convexity: props.convexity,
    brightness: props.brightness,
    contrast: props.contrast,
    homogeneity: props.homogeneity,
    energy: props.energy,
    correlation: props.correlation,
    allProps: Object.keys(props)
  });
  
  // Extract UUID from result object
  const extractUUID = (resultObj) => {
    if (resultObj.uuid) return resultObj.uuid;
    if (resultObj.id) return resultObj.id;
    if (resultObj._uuid) return resultObj._uuid;
    // Try accessing via properties
    if (resultObj.properties) {
      const props = resultObj.properties;
      if (props.uuid) return props.uuid;
      if (props.id) return props.id;
    }
    return null;
  };
  
  const objectUUID = extractUUID(result);
  
  // Function to update tags
  const updateTags = async (updatedTags) => {
    if (!objectUUID || !applicationId || !result) {
      console.warn('Cannot update tags: missing objectUUID, applicationId, or result');
      return;
    }
    
    setIsUpdatingTags(true);
    try {
      // Determine service ID from URL (same pattern as SimilaritySearchPanel)
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      
      // Serialize tags as JSON array string
      const tagString = JSON.stringify(updatedTags);
      
      // Call the backend update endpoint
      const queryParams = new URLSearchParams({
        collection_name: collectionName,
        application_id: applicationId,
        uuid: objectUUID
      });
      
      const response = await fetch(`/agent-lens/apps/${serviceId}/similarity/update?${queryParams}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tag: tagString })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(errorData.detail || `Failed to update tags: ${response.statusText}`);
      }
      
      setEditingTags(updatedTags);
      console.log('Tags updated successfully');
    } catch (error) {
      console.error('Failed to update tags:', error);
      // Re-parse tags from result on error to revert
      if (result) {
        const props = result.properties || result;
        const tagString = props.tag || '';
        let tags = [];
        try {
          if (tagString) {
            tags = JSON.parse(tagString);
            if (!Array.isArray(tags)) tags = [];
          }
        } catch (e) {
          tags = [];
        }
        setEditingTags(tags);
      }
    } finally {
      setIsUpdatingTags(false);
    }
  };
  
  // Parse metadata
  let parsedMetadata = {};
  if (typeof metadata === 'string') {
    try {
      parsedMetadata = JSON.parse(metadata);
    } catch {
      try {
        const jsonString = metadata
          .replace(/'/g, '"')
          .replace(/True/g, 'true')
          .replace(/False/g, 'false')
          .replace(/None/g, 'null');
        parsedMetadata = JSON.parse(jsonString);
      } catch (error) {
        console.error('Error parsing metadata:', error);
        parsedMetadata = { raw: metadata };
      }
    }
  } else {
    parsedMetadata = metadata;
  }


  return (
    <>
      {/* Backdrop for click-outside to close */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'transparent',
          zIndex: 9998
        }}
        onClick={onClose}
      />
      
      {/* Info Window */}
      <div
        className="annotation-details-window"
        style={{
          position: 'fixed',
          left: `${adjustedPosition.x}px`,
          top: `${adjustedPosition.y}px`,
          width: '280px',
          maxHeight: '350px',
          backgroundColor: '#1a1a1a',
          border: '2px solid #000000',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          zIndex: 10000,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Arial, sans-serif',
          color: '#ffffff'
        }}
        onClick={(e) => e.stopPropagation()} // Prevent clicks inside from closing
      >
        {/* Minimal header with close button only */}
        <div
          style={{
            backgroundColor: '#000000',
            color: 'white',
            padding: '8px 12px',
            borderRadius: '6px 6px 0 0',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center'
          }}
        >
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              fontSize: '18px',
              cursor: 'pointer',
              padding: '0',
              width: '20px',
              height: '20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Close (ESC)"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div 
          style={{ 
            padding: '12px', 
            overflowY: 'auto', 
            overflowX: 'hidden',
            flex: 1,
            scrollbarWidth: 'thin', // For Firefox
            scrollbarColor: '#6b7280 #374151' // For Firefox (thumb, track)
          }}
          className="similarity-result-content"
        >
          {/* Preview Image and Tags Section */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            {/* Preview Image - Left side */}
            {props.preview_image && (
              <div style={{ flexShrink: 0 }}>
                <img
                  src={`data:image/png;base64,${props.preview_image}`}
                  alt="Result preview"
                  style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '4px',
                    border: '1px solid #374151',
                    objectFit: 'cover'
                  }}
                />
              </div>
            )}
            
            {/* Tags Section - Right side of preview */}
            <div style={{ 
              flex: '1',
              display: 'flex', 
              flexDirection: 'column',
              gap: '8px',
              minWidth: '0'
            }}>
              <div>
                <strong style={{ color: '#f3f4f6', fontSize: '12px', marginBottom: '4px', display: 'block' }}>
                  Tags
                </strong>
                
                {/* Tag Badges Container */}
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: '4px',
                  marginBottom: '6px'
                }}>
                  {editingTags.map((tag, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        padding: '3px 8px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '500'
                      }}
                    >
                      <span>{tag}</span>
                      <button
                        onClick={() => {
                          const newTags = editingTags.filter((_, i) => i !== index);
                          updateTags(newTags);
                        }}
                        disabled={isUpdatingTags}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#ffffff',
                          cursor: isUpdatingTags ? 'not-allowed' : 'pointer',
                          padding: '0',
                          fontSize: '14px',
                          lineHeight: '1',
                          opacity: isUpdatingTags ? 0.5 : 1
                        }}
                        title="Remove tag"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                
                {/* Add Tag Input */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newTagInput.trim()) {
                        const trimmedTag = newTagInput.trim();
                        if (!editingTags.includes(trimmedTag)) {
                          updateTags([...editingTags, trimmedTag]);
                        }
                        setNewTagInput('');
                      }
                    }}
                    placeholder="Add a tag..."
                    disabled={isUpdatingTags}
                    style={{
                      flex: '1',
                      padding: '4px 8px',
                      fontSize: '11px',
                      backgroundColor: '#374151',
                      color: '#f3f4f6',
                      border: '1px solid #6b7280',
                      borderRadius: '4px',
                      outline: 'none'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Information Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
            {/* UUID */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>UUID:</strong>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {/* Search button */}
                  {onSearch && objectUUID && (
                    <button
                      onClick={() => {
                        const uuid = objectUUID || '';
                        // Add header prefix for UUID based search
                        const uuidWithHeader = uuid ? `uuid: ${uuid}` : '';
                        onSearch(uuidWithHeader);
                      }}
                      disabled={isSearching}
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        backgroundColor: isSearching ? '#4b5563' : '#2563eb',
                        color: '#f3f4f6',
                        border: '1px solid #6b7280',
                        borderRadius: '3px',
                        cursor: isSearching ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: isSearching ? 0.5 : 1
                      }}
                      title="Search for similar cells using this UUID"
                    >
                      <i className={`fas ${isSearching ? 'fa-spinner fa-spin' : 'fa-search'}`} style={{ fontSize: '9px' }}></i>
                      Find Similar
                    </button>
                  )}
                  {/* Copy button */}
                  <button
                    onClick={() => {
                      const uuid = objectUUID || '';
                      // Add header prefix for UUID based search
                      const uuidWithHeader = uuid ? `uuid: ${uuid}` : '';
                      navigator.clipboard.writeText(uuidWithHeader).catch(console.error);
                    }}
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      backgroundColor: '#374151',
                      color: '#f3f4f6',
                      border: '1px solid #6b7280',
                      borderRadius: '3px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    title="Copy UUID (with header for search)"
                  >
                    <i className="fas fa-copy" style={{ fontSize: '9px' }}></i>
                    Copy
                  </button>
                </div>
              </div>
              <div 
                style={{ 
                  fontFamily: 'monospace', 
                  backgroundColor: '#374151', 
                  color: '#f3f4f6',
                  padding: '4px', 
                  borderRadius: '4px',
                  wordBreak: 'break-all',
                  fontSize: '11px'
                }}
              >
                {objectUUID || 'N/A'}
              </div>
            </div>

            {/* Description */}
            {props.description && (
              <div>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>Description:</strong>
                <div 
                  style={{ 
                    fontFamily: 'monospace', 
                    backgroundColor: '#374151', 
                    color: '#f3f4f6',
                    padding: '6px', 
                    borderRadius: '4px',
                    marginTop: '4px',
                    cursor: 'pointer',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '11px'
                  }}
                  onClick={() => {
                    navigator.clipboard.writeText(props.description || '').catch(console.error);
                  }}
                  title="Click to copy"
                >
                  {props.description}
                </div>
              </div>
            )}

            {/* Type & Well ID - Grid layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>Type:</strong>
                <div style={{ marginTop: '2px', fontSize: '12px' }}>
                  {parsedMetadata.annotation_type || parsedMetadata.type || 'Unknown'}
                </div>
              </div>
              <div>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>Well ID:</strong>
                <div style={{ marginTop: '2px', fontSize: '12px' }}>
                  {parsedMetadata.well_id || 'Unknown'}
                </div>
              </div>
            </div>

            {/* Timestamp */}
            {parsedMetadata.timestamp && (
              <div>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>Timestamp:</strong>
                <div style={{ marginTop: '2px', fontSize: '12px' }}>
                  {new Date(parsedMetadata.timestamp).toLocaleString()}
                </div>
              </div>
            )}

            {/* Cell Morphology Measurements */}
            {(props.area !== null && props.area !== undefined) ||
             (props.perimeter !== null && props.perimeter !== undefined) ||
             (props.equivalent_diameter !== null && props.equivalent_diameter !== undefined) ||
             (props.bbox_width !== null && props.bbox_width !== undefined) ||
             (props.bbox_height !== null && props.bbox_height !== undefined) ||
             (props.aspect_ratio !== null && props.aspect_ratio !== undefined) ||
             (props.circularity !== null && props.circularity !== undefined) ||
             (props.eccentricity !== null && props.eccentricity !== undefined) ||
             (props.solidity !== null && props.solidity !== undefined) ||
             (props.convexity !== null && props.convexity !== undefined) ||
             (props.brightness !== null && props.brightness !== undefined) ||
             (props.contrast !== null && props.contrast !== undefined) ||
             (props.homogeneity !== null && props.homogeneity !== undefined) ||
             (props.energy !== null && props.energy !== undefined) ||
             (props.correlation !== null && props.correlation !== undefined) ? (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #374151' }}>
                <strong style={{ color: '#f3f4f6', fontSize: '12px', marginBottom: '8px', display: 'block' }}>
                  Cell Morphology:
                </strong>
                
                {/* Helper function to format numbers */}
                {(() => {
                  const formatNumber = (value, decimals = 2) => {
                    if (value === null || value === undefined) return 'N/A';
                    return typeof value === 'number' ? value.toFixed(decimals) : value;
                  };
                  
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
                      {/* Size measurements */}
                      {props.area !== null && props.area !== undefined && (
                        <div title="Cell area in pixels">
                          <strong style={{ color: '#9ca3af' }}>Area:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.area, 1)} px²
                          </div>
                        </div>
                      )}
                      
                      {props.perimeter !== null && props.perimeter !== undefined && (
                        <div title="Cell perimeter in pixels">
                          <strong style={{ color: '#9ca3af' }}>Perimeter:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.perimeter, 1)} px
                          </div>
                        </div>
                      )}
                      
                      {props.equivalent_diameter !== null && props.equivalent_diameter !== undefined && (
                        <div title="Diameter of circle with same area in pixels">
                          <strong style={{ color: '#9ca3af' }}>Eq. Diameter:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.equivalent_diameter, 2)} px
                          </div>
                        </div>
                      )}
                      
                      {/* Bounding box */}
                      {props.bbox_width !== null && props.bbox_width !== undefined && (
                        <div title="Bounding box width in pixels">
                          <strong style={{ color: '#9ca3af' }}>BBox Width:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.bbox_width, 1)} px
                          </div>
                        </div>
                      )}
                      
                      {props.bbox_height !== null && props.bbox_height !== undefined && (
                        <div title="Bounding box height in pixels">
                          <strong style={{ color: '#9ca3af' }}>BBox Height:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.bbox_height, 1)} px
                          </div>
                        </div>
                      )}
                      
                      {/* Shape descriptors */}
                      {props.aspect_ratio !== null && props.aspect_ratio !== undefined && (
                        <div title="Major axis / minor axis (elongation, unitless)">
                          <strong style={{ color: '#9ca3af' }}>Aspect Ratio:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.aspect_ratio, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.circularity !== null && props.circularity !== undefined && (
                        <div title="4π×area/perimeter² (roundness, 1.0 = perfect circle)">
                          <strong style={{ color: '#9ca3af' }}>Circularity:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.circularity, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.eccentricity !== null && props.eccentricity !== undefined && (
                        <div title="0 = circle, → 1 elongated (unitless)">
                          <strong style={{ color: '#9ca3af' }}>Eccentricity:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.eccentricity, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.solidity !== null && props.solidity !== undefined && (
                        <div title="Area / convex hull area (unitless)">
                          <strong style={{ color: '#9ca3af' }}>Solidity:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.solidity, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.convexity !== null && props.convexity !== undefined && (
                        <div title="Perimeter of convex hull / perimeter (smoothness)">
                          <strong style={{ color: '#9ca3af' }}>Convexity:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.convexity, 3)}
                          </div>
                        </div>
                      )}
                      
                      {/* Texture-based features from GLCM analysis */}
                      {props.brightness !== null && props.brightness !== undefined && (
                        <div title="Mean pixel intensity (0-255)">
                          <strong style={{ color: '#9ca3af' }}>Brightness:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.brightness, 1)}
                          </div>
                        </div>
                      )}
                      
                      {props.contrast !== null && props.contrast !== undefined && (
                        <div title="GLCM contrast (texture variation)">
                          <strong style={{ color: '#9ca3af' }}>Contrast:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.contrast, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.homogeneity !== null && props.homogeneity !== undefined && (
                        <div title="GLCM homogeneity (texture smoothness, 0-1)">
                          <strong style={{ color: '#9ca3af' }}>Homogeneity:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.homogeneity, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.energy !== null && props.energy !== undefined && (
                        <div title="GLCM energy/uniformity (0-1)">
                          <strong style={{ color: '#9ca3af' }}>Energy:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.energy, 3)}
                          </div>
                        </div>
                      )}
                      
                      {props.correlation !== null && props.correlation !== undefined && (
                        <div title="GLCM correlation (texture linearity, -1 to 1)">
                          <strong style={{ color: '#9ca3af' }}>Correlation:</strong>
                          <div style={{ marginTop: '2px', color: '#f3f4f6' }}>
                            {formatNumber(props.correlation, 3)}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : null}

          </div>
        </div>
      </div>
    </>
  );
};

SimilarityResultInfoWindow.propTypes = {
  result: PropTypes.object,
  position: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired
  }),
  isVisible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  containerBounds: PropTypes.shape({
    width: PropTypes.number,
    height: PropTypes.number
  }),
  onSearch: PropTypes.func,
  isSearching: PropTypes.bool,
  collectionName: PropTypes.string,
  applicationId: PropTypes.string
};

export default SimilarityResultInfoWindow;

