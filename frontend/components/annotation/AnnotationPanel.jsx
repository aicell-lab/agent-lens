import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './AnnotationPanel.css';
import AnnotationDetailsWindow from './AnnotationDetailsWindow';
import { generateAnnotationData, exportAnnotationsToJson } from '../../utils/annotationUtils';

const AnnotationPanel = ({
  isDrawingMode,
  setIsDrawingMode,
  currentTool,
  setCurrentTool,
  strokeColor,
  setStrokeColor,
  strokeWidth,
  setStrokeWidth,
  fillColor,
  setFillColor,
  annotations,
  onAnnotationDelete,
  onClearAllAnnotations,
  onExportAnnotations,
  onImportAnnotations,
  wellInfoMap = {}, // Map of annotation IDs to well information
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeColorType, setActiveColorType] = useState('stroke'); // 'stroke' or 'fill'
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [showDetailsWindow, setShowDetailsWindow] = useState(false);
  const [detailsWindowPosition, setDetailsWindowPosition] = useState({ x: 100, y: 100 });

  const tools = [
    { id: 'select', name: 'Select', icon: 'fa-mouse-pointer', tooltip: 'Select and move annotations' },
    { id: 'rectangle', name: 'Rectangle', icon: 'fa-square', tooltip: 'Draw rectangles' },
    { id: 'polygon', name: 'Polygon', icon: 'fa-draw-polygon', tooltip: 'Draw polygons (click to add points, double-click to finish)' },
    { id: 'freehand', name: 'Freehand', icon: 'fa-pencil', tooltip: 'Draw freehand shapes' },
    { id: 'delete', name: 'Delete', icon: 'fa-trash', tooltip: 'Delete annotations' },
  ];

  const presetColors = [
    '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
    '#ffffff', '#000000', '#808080', '#800000', '#008000', '#000080',
    '#808000', '#800080', '#008080', '#c0c0c0'
  ];

  const handleColorChange = (color, type) => {
    if (type === 'stroke') {
      setStrokeColor(color);
    } else {
      setFillColor(color);
    }
    setShowColorPicker(false);
  };

  const handleExport = () => {
    // Use the simplified export function from annotationUtils
    const data = exportAnnotationsToJson(annotations, wellInfoMap);
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onExportAnnotations();
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.annotations && Array.isArray(data.annotations)) {
          // Check if this is the new format with well-relative coordinates
          if (data.metadata && data.metadata.coordinate_system === 'well_relative_mm') {
            // Convert back to stage coordinates for display
            const convertedAnnotations = data.annotations.map(annotationData => {
              const wellInfo = wellInfoMap[annotationData.obj_id];
              if (!wellInfo) {
                console.warn(`No well info found for annotation ${annotationData.obj_id}`);
                return null;
              }
              
              // Convert well-relative points back to stage coordinates
              const stagePoints = annotationData.well_relative_points.map(point => ({
                x: point.x + wellInfo.centerX,
                y: point.y + wellInfo.centerY
              }));
              
              return {
                id: annotationData.obj_id,
                type: annotationData.type,
                points: stagePoints,
                strokeColor: annotationData.strokeColor,
                strokeWidth: annotationData.strokeWidth,
                fillColor: annotationData.fillColor,
                timestamp: annotationData.timestamp
              };
            }).filter(annotation => annotation !== null);
            
            onImportAnnotations(convertedAnnotations);
          } else {
            // Legacy format
            onImportAnnotations(data.annotations);
          }
        } else {
          alert('Invalid annotation file format');
        }
      } catch (error) {
        alert('Error reading annotation file: ' + error.message);
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const handleAnnotationClick = (annotation) => {
    const wellInfo = wellInfoMap[annotation.id];
    if (!wellInfo) {
      console.warn(`No well information found for annotation ${annotation.id}`);
      return;
    }
    
    const enhancedAnnotation = generateAnnotationData(annotation, wellInfo);
    setSelectedAnnotation(enhancedAnnotation);
    setShowDetailsWindow(true);
    
    // Position the window near the mouse or center of screen
    const centerX = window.innerWidth / 2 - 250;
    const centerY = window.innerHeight / 2 - 200;
    setDetailsWindowPosition({ x: centerX, y: centerY });
  };

  const handleCloseDetailsWindow = () => {
    setShowDetailsWindow(false);
    setSelectedAnnotation(null);
  };

  return (
    <div className="annotation-panel">
      {/* Header */}
      <div className="annotation-panel-header">
        <div className="flex items-center space-x-2">
          <i className="fas fa-draw-polygon text-blue-400"></i>
          <span className="font-medium">Enter Annotations</span>
        </div>
        <button
          onClick={() => setIsDrawingMode(!isDrawingMode)}
          className={`annotation-toggle-btn ${isDrawingMode ? 'active exit-mode' : ''}`}
          title={isDrawingMode ? 'Exit drawing mode' : 'Enter drawing mode'}
        >
          <i className={`fas ${isDrawingMode ? 'fa-times' : 'fa-edit'}`}></i>
        </button>
      </div>

      {isDrawingMode && (
        <>
          {/* Drawing Tools */}
          <div className="annotation-section">
            <div className="annotation-section-title">Drawing Tools</div>
            <div className="annotation-tools-grid">
              {tools.map(tool => (
                <button
                  key={tool.id}
                  onClick={() => setCurrentTool(tool.id)}
                  className={`annotation-tool-btn ${currentTool === tool.id ? 'active' : ''}`}
                  title={tool.tooltip}
                >
                  <i className={`fas ${tool.icon}`}></i>
                  <span className="tool-name">{tool.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Style Controls */}
          <div className="annotation-section">
            <div className="annotation-section-title">Style</div>
            
            {/* Stroke Color */}
            <div className="style-control">
              <label>Stroke Color:</label>
              <div className="color-control">
                <button
                  className="color-swatch"
                  style={{ backgroundColor: strokeColor }}
                  onClick={() => {
                    setActiveColorType('stroke');
                    setShowColorPicker(!showColorPicker);
                  }}
                  title="Change stroke color"
                />
                <span className="color-value">{strokeColor}</span>
              </div>
            </div>

            {/* Fill Color */}
            <div className="style-control">
              <label>Fill Color:</label>
              <div className="color-control">
                <button
                  className="color-swatch"
                  style={{ 
                    backgroundColor: fillColor === 'transparent' ? '#ffffff' : fillColor,
                    backgroundImage: fillColor === 'transparent' ? 
                      'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : 'none',
                    backgroundSize: '8px 8px',
                    backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
                  }}
                  onClick={() => {
                    setActiveColorType('fill');
                    setShowColorPicker(!showColorPicker);
                  }}
                  title="Change fill color"
                />
                <span className="color-value">{fillColor}</span>
              </div>
            </div>

            {/* Stroke Width */}
            <div className="style-control">
              <label>Stroke Width:</label>
              <div className="stroke-width-control">
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={strokeWidth}
                  onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                  className="stroke-width-slider"
                />
                <span className="stroke-width-value">{strokeWidth}px</span>
              </div>
            </div>

            {/* Color Picker */}
            {showColorPicker && (
              <div className="color-picker-overlay">
                <div className="color-picker">
                  <div className="color-picker-header">
                    <span>Choose {activeColorType} color</span>
                    <button 
                      onClick={() => setShowColorPicker(false)}
                      className="color-picker-close"
                    >
                      <i className="fas fa-times"></i>
                    </button>
                  </div>
                  
                  {/* Preset Colors */}
                  <div className="preset-colors">
                    {presetColors.map(color => (
                      <button
                        key={color}
                        className="preset-color"
                        style={{ backgroundColor: color }}
                        onClick={() => handleColorChange(color, activeColorType)}
                        title={color}
                      />
                    ))}
                    {activeColorType === 'fill' && (
                      <button
                        className="preset-color transparent-color"
                        onClick={() => handleColorChange('transparent', activeColorType)}
                        title="Transparent"
                      >
                        <i className="fas fa-ban"></i>
                      </button>
                    )}
                  </div>

                  {/* Custom Color Input */}
                  <div className="custom-color">
                    <label>Custom color:</label>
                    <input
                      type="color"
                      value={activeColorType === 'stroke' ? strokeColor : fillColor === 'transparent' ? '#ffffff' : fillColor}
                      onChange={(e) => handleColorChange(e.target.value, activeColorType)}
                      className="color-input"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Annotation List */}
          <div className="annotation-section">
            <div className="annotation-section-title">
              Annotations ({annotations.length})
            </div>
            {annotations.length === 0 ? (
              <div className="no-annotations">No annotations yet</div>
            ) : (
              <div className="annotation-list">
                {annotations.map((annotation, index) => {
                  const wellInfo = wellInfoMap[annotation.id];
                  const wellId = wellInfo ? wellInfo.id : 'Unknown';
                  
                  return (
                    <div key={annotation.id} className="annotation-item">
                      <div 
                        className="annotation-item-info"
                        onClick={() => handleAnnotationClick(annotation)}
                        style={{ cursor: 'pointer' }}
                        title={`Click to view details (Well: ${wellId})`}
                      >
                        <i className={`fas ${
                          annotation.type === 'rectangle' ? 'fa-square' :
                          annotation.type === 'freehand' ? 'fa-pencil' :
                          'fa-shape-polygon'
                        }`}></i>
                        <span className="annotation-type">{annotation.type}</span>
                        <span className="annotation-index">#{index + 1}</span>
                        {wellInfo && (
                          <span className="annotation-well" style={{ 
                            fontSize: '10px', 
                            color: '#666', 
                            marginLeft: '4px' 
                          }}>
                            Well: {wellId}
                          </span>
                        )}
                      </div>
                      <div className="annotation-item-actions">
                        <div 
                          className="annotation-color-indicator"
                          style={{ backgroundColor: annotation.strokeColor }}
                          title={`Stroke: ${annotation.strokeColor}, Fill: ${annotation.fillColor}`}
                        />
                        <button
                          onClick={() => onAnnotationDelete(annotation.id)}
                          className="annotation-delete-btn"
                          title="Delete annotation"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="annotation-section">
            <div className="annotation-section-title">Actions</div>
            <div className="annotation-actions">
              <button
                onClick={onClearAllAnnotations}
                className="annotation-action-btn danger"
                disabled={annotations.length === 0}
                title="Clear all annotations"
              >
                <i className="fas fa-trash-alt"></i>
                Clear All
              </button>
              
              <button
                onClick={handleExport}
                className="annotation-action-btn"
                disabled={annotations.length === 0}
                title="Export annotations to file"
              >
                <i className="fas fa-download"></i>
                Export
              </button>
              
              <label className="annotation-action-btn" title="Import annotations from file">
                <i className="fas fa-upload"></i>
                Import
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImport}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </>
      )}

      {/* Annotation Details Window */}
      <AnnotationDetailsWindow
        annotation={selectedAnnotation}
        isVisible={showDetailsWindow}
        onClose={handleCloseDetailsWindow}
        position={detailsWindowPosition}
      />
    </div>
  );
};

AnnotationPanel.propTypes = {
  isDrawingMode: PropTypes.bool.isRequired,
  setIsDrawingMode: PropTypes.func.isRequired,
  currentTool: PropTypes.string.isRequired,
  setCurrentTool: PropTypes.func.isRequired,
  strokeColor: PropTypes.string.isRequired,
  setStrokeColor: PropTypes.func.isRequired,
  strokeWidth: PropTypes.number.isRequired,
  setStrokeWidth: PropTypes.func.isRequired,
  fillColor: PropTypes.string.isRequired,
  setFillColor: PropTypes.func.isRequired,
  annotations: PropTypes.array.isRequired,
  onAnnotationDelete: PropTypes.func.isRequired,
  onClearAllAnnotations: PropTypes.func.isRequired,
  onExportAnnotations: PropTypes.func.isRequired,
  onImportAnnotations: PropTypes.func.isRequired,
  wellInfoMap: PropTypes.object, // Map of annotation IDs to well information
};

export default AnnotationPanel;
