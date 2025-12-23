import React from 'react';
import PropTypes from 'prop-types';
import { formatAnnotationForDisplay } from '../../utils/annotationUtils';

const AnnotationDetailsWindow = ({ 
  annotation, 
  isVisible, 
  onClose, 
  position = { x: 100, y: 100 } 
}) => {
  if (!isVisible || !annotation) {
    return null;
  }

  const displayData = formatAnnotationForDisplay(annotation);

  if (!displayData) {
    return null;
  }

  const handleClose = () => {
    onClose();
  };

  const handleCopyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
      console.log('Copied to clipboard:', text);
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
    });
  };

  return (
    <div 
      className="annotation-details-window"
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 10000,
        backgroundColor: '#1a1a1a',
        border: '2px solid #007bff',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        minWidth: '400px',
        maxWidth: '600px',
        fontFamily: 'Arial, sans-serif',
        color: '#ffffff'
      }}
    >
      {/* Header */}
      <div 
        style={{
          backgroundColor: '#007bff',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '6px 6px 0 0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 'bold' }}>
          Annotation Details
        </h3>
        <button
          onClick={handleClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '18px',
            cursor: 'pointer',
            padding: '0',
            width: '24px',
            height: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div style={{ padding: '16px' }}>
        {/* Basic Information */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#e5e7eb', fontSize: '14px' }}>
            Basic Information
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
            <div>
              <strong>Object ID:</strong>
              <div 
                style={{
                  fontFamily: 'monospace', 
                  backgroundColor: '#374151', 
                  color: '#f3f4f6',
                  padding: '4px', 
                  borderRadius: '4px',
                  marginTop: '2px',
                  cursor: 'pointer',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                onClick={() => handleCopyToClipboard(displayData.id)}
                title="Click to copy"
              >
                {displayData.id}
              </div>
            </div>
            <div>
              <strong>Well:</strong>
              <div style={{ marginTop: '2px' }}>{displayData.well}</div>
            </div>
            <div>
              <strong>Type:</strong>
              <div style={{ marginTop: '2px', textTransform: 'capitalize' }}>
                {displayData.type}
              </div>
            </div>
            <div>
              <strong>Created:</strong>
              <div style={{ marginTop: '2px' }}>{displayData.created}</div>
            </div>
            {displayData.description && (
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Description:</strong>
                <div 
                  style={{ 
                    fontFamily: 'monospace', 
                    backgroundColor: '#374151', 
                    color: '#f3f4f6',
                    padding: '8px', 
                    borderRadius: '4px',
                    marginTop: '4px',
                    cursor: 'pointer',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }}
                  onClick={() => handleCopyToClipboard(displayData.description)}
                  title="Click to copy"
                >
                  {displayData.description}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Coordinate Information */}
        <div style={{ marginBottom: '16px' }}>
          <h4 style={{ margin: '0 0 8px 0', color: '#e5e7eb', fontSize: '14px' }}>
            Coordinate Information
          </h4>
          
          {displayData.boundingBox && (
            <div style={{ marginBottom: '12px' }}>
              <strong>Bounding Box (well-relative):</strong>
              <div 
                style={{ 
                  fontFamily: 'monospace', 
                  backgroundColor: '#374151', 
                  color: '#f3f4f6',
                  padding: '8px', 
                  borderRadius: '4px',
                  marginTop: '4px',
                  cursor: 'pointer'
                }}
                onClick={() => handleCopyToClipboard(JSON.stringify(displayData.boundingBox))}
                title="Click to copy"
              >
                x: {displayData.boundingBox.x.toFixed(1)}mm, y: {displayData.boundingBox.y.toFixed(1)}mm<br/>
                width: {displayData.boundingBox.width.toFixed(1)}mm, height: {displayData.boundingBox.height.toFixed(1)}mm
              </div>
            </div>
          )}

          {displayData.polygonWkt && (
            <div style={{ marginBottom: '12px' }}>
              <strong>WKT Polygon:</strong>
              <div 
                style={{ 
                  fontFamily: 'monospace', 
                  backgroundColor: '#374151', 
                  color: '#f3f4f6',
                  padding: '8px', 
                  borderRadius: '4px',
                  marginTop: '4px',
                  fontSize: '11px',
                  wordBreak: 'break-all',
                  cursor: 'pointer'
                }}
                onClick={() => handleCopyToClipboard(displayData.polygonWkt)}
                title="Click to copy"
              >
                {displayData.polygonWkt}
              </div>
            </div>
          )}

        </div>

        {/* Channel Information */}
        {(displayData.channels || displayData.processSettings) && (
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', color: '#e5e7eb', fontSize: '14px' }}>
              Channel Information
            </h4>
            
            {displayData.channels && displayData.channels.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <strong>Channels:</strong>
                <div 
                  style={{ 
                    fontFamily: 'monospace', 
                    backgroundColor: '#374151', 
                    color: '#f3f4f6',
                    padding: '8px', 
                    borderRadius: '4px',
                    marginTop: '4px',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleCopyToClipboard(JSON.stringify(displayData.channels))}
                  title="Click to copy"
                >
                  {displayData.channels.join(', ')}
                </div>
              </div>
            )}

            {displayData.processSettings && Object.keys(displayData.processSettings).length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <strong>Process Settings:</strong>
                <div 
                  style={{ 
                    fontFamily: 'monospace', 
                    backgroundColor: '#374151', 
                    color: '#f3f4f6',
                    padding: '8px', 
                    borderRadius: '4px',
                    marginTop: '4px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    wordBreak: 'break-all'
                  }}
                  onClick={() => handleCopyToClipboard(JSON.stringify(displayData.processSettings, null, 2))}
                  title="Click to copy"
                >
                  {JSON.stringify(displayData.processSettings, null, 2)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={{ 
          borderTop: '1px solid #374151', 
          paddingTop: '12px',
          display: 'flex',
          gap: '8px'
        }}>
          <button
            onClick={() => {
              // Export only the essential annotation data without duplicates
              const exportData = {
                obj_id: annotation.obj_id,
                well: annotation.well,
                type: annotation.type,
                description: annotation.description,
                timestamp: annotation.timestamp,
                created_at: annotation.created_at,
                bbox: annotation.bbox,
                polygon_wkt: annotation.polygon_wkt
              };
              
              // Include channel information if available
              if (annotation.channels) {
                exportData.channels = annotation.channels;
              }
              
              if (annotation.process_settings) {
                exportData.process_settings = annotation.process_settings;
              }
              
              // Include embeddings if available
              if (annotation.embeddings) {
                exportData.embeddings = {
                  clipEmbedding: annotation.embeddings.clipEmbedding,
                  dinoEmbedding: annotation.embeddings.dinoEmbedding,
                  textEmbedding: annotation.embeddings.textEmbedding,
                  generatedAt: annotation.embeddings.generatedAt
                };
              }
              const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `annotation_${displayData.id}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              backgroundColor: '#28a745',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Export JSON
          </button>
          
          <button
            onClick={() => {
              const textData = `Annotation Details
Object ID: ${displayData.id}
Well: ${displayData.well}
Type: ${displayData.type}
Created: ${displayData.created}
${displayData.description ? `Description: ${displayData.description}` : ''}
${displayData.boundingBox ? `Bounding Box: ${JSON.stringify(displayData.boundingBox)}` : ''}
${displayData.polygonWkt ? `WKT Polygon: ${displayData.polygonWkt}` : ''}`;
              handleCopyToClipboard(textData);
            }}
            style={{
              backgroundColor: '#17a2b8',
              color: 'white',
              border: 'none',
              padding: '6px 12px',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            Copy All
          </button>
        </div>
      </div>
    </div>
  );
};

AnnotationDetailsWindow.propTypes = {
  annotation: PropTypes.object,
  isVisible: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  position: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number
  })
};

export default AnnotationDetailsWindow;
