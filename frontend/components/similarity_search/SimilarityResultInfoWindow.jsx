import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './AnnotationPanel.css'; // Import styles for annotation-details-window class

/**
 * SimilarityResultInfoWindow - A floating window that displays detailed information about a clicked similarity result
 * 
 * This component shows:
 * - Preview image
 * - Image ID
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
  containerBounds = null
}) => {
  const [adjustedPosition, setAdjustedPosition] = useState(position);

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


  if (!isVisible || !result) return null;

  // Extract result data from properties
  const props = result.properties || result;
  const metadata = props.metadata || '';
  
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
            flex: 1,
            scrollbarWidth: 'thick', // For Firefox
            scrollbarColor: '#6b7280 #374151' // For Firefox
          }}
          className="similarity-result-content"
        >
          {/* Preview Image */}
          {props.preview_image && (
            <div style={{ marginBottom: '10px', textAlign: 'center' }}>
              <img
                src={`data:image/png;base64,${props.preview_image}`}
                alt="Result preview"
                style={{
                  maxWidth: '100px',
                  maxHeight: '100px',
                  width: 'auto',
                  height: 'auto',
                  borderRadius: '4px',
                  border: '1px solid #374151'
                }}
              />
            </div>
          )}

          {/* Information Fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '12px' }}>
            {/* Image ID */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ color: '#f3f4f6', fontSize: '12px' }}>Image ID:</strong>
                <button
                  onClick={() => {
                    const imageId = props.image_id || '';
                    // Add header prefix for future image ID based search
                    const imageIdWithHeader = imageId ? `image_id: ${imageId}` : '';
                    navigator.clipboard.writeText(imageIdWithHeader).catch(console.error);
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
                  title="Copy Image ID (with header for search)"
                >
                  <i className="fas fa-copy" style={{ fontSize: '9px' }}></i>
                  Copy
                </button>
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
                {props.image_id || 'N/A'}
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
  })
};

export default SimilarityResultInfoWindow;

