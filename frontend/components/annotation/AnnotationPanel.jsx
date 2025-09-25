import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './AnnotationPanel.css';
import AnnotationDetailsWindow from './AnnotationDetailsWindow';
import { generateAnnotationData, exportAnnotationsToJson } from '../../utils/annotationUtils';
import { extractAnnotationImageRegion, extractAnnotationImageRegionAdvanced } from '../../utils/annotationEmbeddingService';

// Component for displaying annotation image previews
const AnnotationImagePreview = ({ 
  annotation, 
  wellInfo, 
  mapScale, 
  mapPan, 
  stageDimensions, 
  pixelsPerMm,
  // New props for advanced extraction
  isHistoricalDataMode,
  microscopeControlService,
  artifactZarrLoader,
  zarrChannelConfigs,
  realMicroscopeChannelConfigs,
  enabledZarrChannels,
  visibleChannelsConfig,
  selectedHistoricalDataset,
  wellPlateType,
  timepoint,
  // Callback for embedding generation
  onEmbeddingsGenerated
}) => {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const generatePreview = async () => {
      if (!annotation || !wellInfo) {
        return;
      }

      // Skip if embeddings already exist to prevent infinite loops
      if (annotation.embeddings) {
        console.log('🔄 Skipping preview generation - embeddings already exist');
        return;
      }

      // Check if we have the required services and data for advanced extraction
      const canUseAdvancedExtraction = 
        (isHistoricalDataMode && artifactZarrLoader && enabledZarrChannels.length > 0) ||
        (!isHistoricalDataMode && microscopeControlService && Object.values(visibleChannelsConfig).some(v => v));

      setIsLoading(true);
      try {
        let imageBlob;

        if (canUseAdvancedExtraction) {
          console.log('🎨 Using advanced extraction for annotation preview');
          
          // Determine mode and prepare services
          const mode = isHistoricalDataMode ? 'HISTORICAL' : 'FREE_PAN';
          const services = {
            microscopeControlService,
            artifactZarrLoader
          };

          // Prepare channel configurations based on mode
          let channelConfigs, enabledChannels;
          if (isHistoricalDataMode) {
            channelConfigs = zarrChannelConfigs;
            enabledChannels = enabledZarrChannels;
          } else {
            channelConfigs = realMicroscopeChannelConfigs;
            // Convert visible channels to enabled channels format
            enabledChannels = Object.entries(visibleChannelsConfig)
              .filter(([, isVisible]) => isVisible)
              .map(([channelName]) => ({ channelName, label: channelName }));
          }

          // Prepare metadata
          const metadata = {
            datasetId: selectedHistoricalDataset?.id,
            wellPlateType,
            timepoint
          };

          // Use advanced extraction
          imageBlob = await extractAnnotationImageRegionAdvanced(
            annotation,
            wellInfo,
            mode,
            services,
            channelConfigs,
            enabledChannels,
            metadata
          );
        } else {
          console.log('🎨 Using legacy extraction for annotation preview (missing requirements for advanced)');
          
          // Fall back to legacy method if advanced requirements not met
          if (!mapScale || !mapPan || !stageDimensions || !pixelsPerMm) {
            console.warn('Missing requirements for legacy extraction as well');
            return;
          }

          // Find the main microscope view container
          const microscopeContainer = document.querySelector('.relative.w-full.h-full.bg-black');
          if (!microscopeContainer) {
            console.warn('Microscope container not found for image preview');
            return;
          }

          // Create a temporary canvas that captures the current view
          const tempCanvas = document.createElement('canvas');
          const containerRect = microscopeContainer.getBoundingClientRect();
          tempCanvas.width = containerRect.width;
          tempCanvas.height = containerRect.height;
          tempCanvas.setAttribute('willReadFrequently', 'true');
          const tempCtx = tempCanvas.getContext('2d');

          // Fill with black background
          tempCtx.fillStyle = '#000000';
          tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

          // Draw all visible tile images to the temporary canvas
          const tileImages = document.querySelectorAll('.scan-results-container img');
          for (const img of tileImages) {
            if (img.complete && img.naturalWidth > 0) {
              const container = img.parentElement;
              const containerRect = {
                left: parseFloat(container.style.left) || 0,
                top: parseFloat(container.style.top) || 0,
                width: parseFloat(container.style.width) || 0,
                height: parseFloat(container.style.height) || 0
              };

              // Draw the tile image
              tempCtx.drawImage(
                img,
                containerRect.left,
                containerRect.top,
                containerRect.width,
                containerRect.height
              );
            }
          }

          // Use legacy extraction
          imageBlob = await extractAnnotationImageRegion(
            tempCanvas, 
            annotation, 
            mapScale, 
            mapPan, 
            stageDimensions, 
            pixelsPerMm
          );
        }

        const url = URL.createObjectURL(imageBlob);
        setPreviewUrl(url);
        
        // Generate embeddings AFTER image is successfully processed
        // Only generate if embeddings don't already exist to prevent infinite loops
        if ((annotation.type === 'rectangle' || annotation.type === 'polygon' || annotation.type === 'freehand') && 
            !annotation.embeddings && onEmbeddingsGenerated) {
          try {
            console.log('🔗 Generating embeddings after successful image processing');
            
            // Import embedding function dynamically to avoid circular dependencies
            const { generateImageEmbedding, generateTextEmbedding } = await import('../../utils/annotationEmbeddingService');
            
            // Generate embeddings using the same image blob
            const [imageEmbedding, textEmbedding] = await Promise.all([
              generateImageEmbedding(imageBlob),
              generateTextEmbedding(annotation.description || '')
            ]);
            
            const embeddings = {
              imageEmbedding,
              textEmbedding,
              generatedAt: new Date().toISOString()
            };
            
            // Update annotation with embeddings via callback
            onEmbeddingsGenerated(annotation.id, embeddings);
            
            console.log('✅ Embeddings generated successfully after image processing');
          } catch (embeddingError) {
            console.error('❌ Error generating embeddings after image processing:', embeddingError);
          }
        }
      } catch (error) {
        console.error('Error generating annotation preview:', error);
        // TODO: Could add a fallback to show an error icon instead of spinner
      } finally {
        setIsLoading(false);
      }
    };

    generatePreview();

    // Cleanup object URL on unmount
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [
    annotation?.id, // Only depend on annotation ID, not the whole object
    // Use JSON.stringify to create a stable reference for points
    annotation?.points ? JSON.stringify(annotation.points) : null,
    wellInfo, 
    mapScale, 
    mapPan, 
    stageDimensions, 
    pixelsPerMm,
    isHistoricalDataMode,
    zarrChannelConfigs,
    realMicroscopeChannelConfigs,
    enabledZarrChannels,
    visibleChannelsConfig,
    selectedHistoricalDataset,
    wellPlateType,
    timepoint
  ]);

  if (isLoading) {
    return (
      <div className="annotation-preview" style={{
        width: '40px',
        height: '30px',
        backgroundColor: '#f0f0f0',
        border: '1px solid #ddd',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: '8px'
      }}>
        <i className="fas fa-spinner fa-spin" style={{ fontSize: '10px', color: '#666' }}></i>
      </div>
    );
  }

  if (!previewUrl) {
    return null;
  }

  return (
    <div className="annotation-preview" style={{
      width: '40px',
      height: '30px',
      border: '1px solid #ddd',
      borderRadius: '4px',
      marginLeft: '8px',
      overflow: 'hidden',
      backgroundColor: '#f0f0f0'
    }}>
      <img 
        src={previewUrl} 
        alt={`${annotation.type} annotation preview`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }}
      />
    </div>
  );
};

AnnotationImagePreview.propTypes = {
  annotation: PropTypes.object.isRequired,
  wellInfo: PropTypes.object,
  mapScale: PropTypes.object,
  mapPan: PropTypes.object,
  stageDimensions: PropTypes.object,
  pixelsPerMm: PropTypes.number,
  // New props for advanced extraction
  isHistoricalDataMode: PropTypes.bool,
  microscopeControlService: PropTypes.object,
  artifactZarrLoader: PropTypes.object,
  zarrChannelConfigs: PropTypes.object,
  realMicroscopeChannelConfigs: PropTypes.object,
  enabledZarrChannels: PropTypes.array,
  visibleChannelsConfig: PropTypes.object,
  selectedHistoricalDataset: PropTypes.object,
  wellPlateType: PropTypes.string,
  timepoint: PropTypes.number,
  onEmbeddingsGenerated: PropTypes.func
};

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
  description,
  setDescription,
  annotations,
  onAnnotationDelete,
  onClearAllAnnotations,
  onExportAnnotations,
  onImportAnnotations,
  wellInfoMap = {}, // Map of annotation IDs to well information
  embeddingStatus = {}, // Map of annotation IDs to embedding status
  mapScale = null, // Current map scale for image extraction
  mapPan = null, // Current map pan offset for image extraction
  stageDimensions = null, // Stage dimensions in mm for image extraction
  pixelsPerMm = null, // Pixels per millimeter conversion for image extraction
  // New props for advanced extraction
  isHistoricalDataMode = false,
  microscopeControlService = null,
  artifactZarrLoader = null,
  zarrChannelConfigs = {},
  realMicroscopeChannelConfigs = {},
  enabledZarrChannels = [],
  visibleChannelsConfig = {},
  selectedHistoricalDataset = null,
  wellPlateType = '96',
  timepoint = 0,
  // Callback for embedding generation
  onEmbeddingsGenerated = null
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeColorType, setActiveColorType] = useState('stroke'); // 'stroke' or 'fill'
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [showDetailsWindow, setShowDetailsWindow] = useState(false);
  const [detailsWindowPosition, setDetailsWindowPosition] = useState({ x: 100, y: 100 });
  
  // Similarity search states
  const [similarityResults, setSimilarityResults] = useState([]);
  const [showSimilarityPanel, setShowSimilarityPanel] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const tools = [
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
    // Create channel info map from annotations
    const channelInfoMap = {};
    annotations.forEach(annotation => {
      if (annotation.channelInfo) {
        channelInfoMap[annotation.id] = annotation.channelInfo;
      }
    });
    
    // Use the simplified export function from annotationUtils
    const data = exportAnnotationsToJson(annotations, wellInfoMap, channelInfoMap);
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `annotations_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onExportAnnotations();
  };

  // Convert collection name to valid Weaviate class name (no hyphens, starts with uppercase)
  const convertToValidCollectionName = (name) => {
    // Split by hyphens and capitalize each word, then join
    let valid = name.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join('');
    
    // Ensure it starts with uppercase letter
    if (!valid[0] || !valid[0].match(/[A-Z]/)) {
      valid = 'A' + valid.slice(1);
    }
    return valid;
  };

  const handleUpload = async () => {
    // Only upload annotations that have image embeddings
    const annotationsWithEmbeddings = annotations.filter(annotation => 
      annotation.embeddings && 
      annotation.embeddings.imageEmbedding
    );

    if (annotationsWithEmbeddings.length === 0) {
      alert('No annotations with image embeddings to upload. Annotations need image embeddings.');
      return;
    }

    // Get dataset ID for application ID
    const applicationId = selectedHistoricalDataset?.id;
    if (!applicationId) {
      alert('No dataset selected. Cannot upload annotations.');
      return;
    }

    const collectionName = convertToValidCollectionName('agent-lens');
    let uploadedCount = 0;
    let failedCount = 0;

    try {
      // Upload each annotation with embeddings
      for (const annotation of annotationsWithEmbeddings) {
        try {
          // Prepare metadata
          const wellInfo = wellInfoMap[annotation.id];
          const metadata = {
            annotation_id: annotation.id,
            well_id: wellInfo?.id || 'unknown',
            annotation_type: annotation.type,
            timestamp: annotation.timestamp || new Date().toISOString(),
            ...(annotation.channelInfo && { channel_info: annotation.channelInfo })
          };

          // Prepare URL with query parameters as expected by backend
          const queryParams = new URLSearchParams({
            collection_name: collectionName,
            application_id: applicationId,
            image_id: `${applicationId}_${annotation.id}`,
            description: annotation.description || `${annotation.type} annotation`,
            metadata: JSON.stringify(metadata),
            dataset_id: applicationId
          });

          // Use the insert endpoint with correct URL pattern
          const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
          const insertResponse = await fetch(`/agent-lens/apps/${serviceId}/similarity/insert?${queryParams}`, {
            method: 'POST'
          });

          if (insertResponse.ok) {
            const result = await insertResponse.json();
            console.log(`Uploaded annotation ${annotation.id}:`, result);
            uploadedCount++;
          } else {
            console.error(`Failed to upload annotation ${annotation.id}:`, await insertResponse.text());
            failedCount++;
          }
        } catch (error) {
          console.error(`Error uploading annotation ${annotation.id}:`, error);
          failedCount++;
        }
      }

      // Show results
      if (uploadedCount > 0) {
        alert(`Successfully uploaded ${uploadedCount} annotation(s) to Weaviate collection '${collectionName}'.` + 
              (failedCount > 0 ? ` ${failedCount} failed.` : ''));
      } else {
        alert(`Failed to upload annotations. ${failedCount} failed.`);
      }

    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload annotations: ' + error.message);
    }
  };

  const handleFindSimilar = async (annotation) => {
    if (!annotation.embeddings?.imageEmbedding) {
      alert('This annotation does not have embeddings. Cannot search for similar annotations.');
      return;
    }

    const applicationId = selectedHistoricalDataset?.id;
    if (!applicationId) {
      alert('No dataset selected. Cannot search for similar annotations.');
      return;
    }

    setIsSearching(true);
    setSimilarityResults([]);
    setShowSimilarityPanel(true);

    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        collection_name: convertToValidCollectionName('agent-lens'),
        application_id: applicationId,
        limit: '10',
        include_vector: 'false'
      });
      
      const response = await fetch(`/agent-lens/apps/${serviceId}/similarity/search/vector?${queryParams}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(annotation.embeddings.imageEmbedding)
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Full similarity search response:', result);
        
        if (result.success && result.results) {
          // Handle different result formats from Weaviate
          let results = result.results;
          
          // If results has an 'objects' property, extract it
          if (results.objects && Array.isArray(results.objects)) {
            results = results.objects;
          }
          
          // If results is not an array, try to extract objects from it
          if (!Array.isArray(results) && results.objects) {
            results = results.objects;
          }
          
          setSimilarityResults(results);
          console.log('Processed similarity search results:', results);
        } else {
          console.error('No results found:', result);
          setSimilarityResults([]);
        }
      } else {
        console.error('Similarity search failed:', await response.text());
        alert('Failed to search for similar annotations.');
      }
    } catch (error) {
      console.error('Error searching for similar annotations:', error);
      alert('Error searching for similar annotations: ' + error.message);
    } finally {
      setIsSearching(false);
    }
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
              
              const convertedAnnotation = {
                id: annotationData.obj_id,
                type: annotationData.type,
                points: stagePoints,
                strokeColor: annotationData.strokeColor,
                strokeWidth: annotationData.strokeWidth,
                fillColor: annotationData.fillColor,
                timestamp: annotationData.timestamp
              };
              
              // Include channel information if available
              if (annotationData.channels || annotationData.process_settings) {
                convertedAnnotation.channelInfo = {
                  channels: annotationData.channels || [],
                  process_settings: annotationData.process_settings || {}
                };
              }
              
              return convertedAnnotation;
            }).filter(annotation => annotation !== null);
            
            onImportAnnotations(convertedAnnotations);
          } else {
            // Legacy format - convert to include channel info if available
            const legacyAnnotations = data.annotations.map(annotation => {
              const convertedAnnotation = { ...annotation };
              
              // Include channel information if available in legacy format
              if (annotation.channels || annotation.process_settings) {
                convertedAnnotation.channelInfo = {
                  channels: annotation.channels || [],
                  process_settings: annotation.process_settings || {}
                };
              }
              
              return convertedAnnotation;
            });
            
            onImportAnnotations(legacyAnnotations);
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
    
    // Create channel info from annotation if available
    const channelInfo = annotation.channelInfo ? {
      channels: annotation.channelInfo.channels || [],
      process_settings: annotation.channelInfo.process_settings || {}
    } : null;
    
    const enhancedAnnotation = generateAnnotationData(annotation, wellInfo, channelInfo);
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
          {/* Dataset ID Display */}
          {selectedHistoricalDataset?.id && (
            <span className="text-xs text-gray-500 ml-2">
              Dataset: {selectedHistoricalDataset.id}
            </span>
          )}
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

            {/* Description */}
            <div className="style-control">
              <label>Description:</label>
              <textarea
                value={description || ''}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter annotation description..."
                className="description-input"
                rows="2"
                maxLength="200"
              />
              <div className="description-counter">
                {(description || '').length}/200 characters
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
                  const status = embeddingStatus[annotation.id];
                  
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
                        
                        {/* Image Preview */}
                        <AnnotationImagePreview 
                          annotation={annotation}
                          wellInfo={wellInfo}
                          mapScale={mapScale}
                          mapPan={mapPan}
                          stageDimensions={stageDimensions}
                          pixelsPerMm={pixelsPerMm}
                          isHistoricalDataMode={isHistoricalDataMode}
                          microscopeControlService={microscopeControlService}
                          artifactZarrLoader={artifactZarrLoader}
                          zarrChannelConfigs={zarrChannelConfigs}
                          realMicroscopeChannelConfigs={realMicroscopeChannelConfigs}
                          enabledZarrChannels={enabledZarrChannels}
                          visibleChannelsConfig={visibleChannelsConfig}
                          selectedHistoricalDataset={selectedHistoricalDataset}
                          wellPlateType={wellPlateType}
                          timepoint={timepoint}
                          onEmbeddingsGenerated={onEmbeddingsGenerated}
                        />
                        {wellInfo && (
                          <span className="annotation-well" style={{ 
                            fontSize: '10px', 
                            color: '#666', 
                            marginLeft: '4px' 
                          }}>
                            Well: {wellId}
                          </span>
                        )}
                        {/* Embedding Status Indicator */}
                        {status && (annotation.type === 'rectangle' || annotation.type === 'polygon' || annotation.type === 'freehand') && (
                          <span 
                            className="embedding-status" 
                            style={{ 
                              fontSize: '10px', 
                              marginLeft: '8px',
                              color: status.status === 'completed' ? '#28a745' : 
                                     status.status === 'generating' ? '#ffc107' : 
                                     status.status === 'error' ? '#dc3545' : '#666'
                            }}
                            title={status.status === 'generating' ? 'Generating embeddings...' : 
                                   status.status === 'completed' ? 'Embeddings ready' : 
                                   status.status === 'error' ? `Error: ${status.error}` : ''}
                          >
                            {status.status === 'generating' && <i className="fas fa-spinner fa-spin"></i>}
                            {status.status === 'completed' && <i className="fas fa-check-circle"></i>}
                            {status.status === 'error' && <i className="fas fa-exclamation-circle"></i>}
                          </span>
                        )}
                      </div>
                      <div className="annotation-item-actions">
                        {/* Find Similar button - only show if annotation has image embeddings */}
                        {annotation.embeddings?.imageEmbedding && (
                          <button
                            onClick={() => handleFindSimilar(annotation)}
                            className="annotation-action-btn"
                            style={{ 
                              fontSize: '10px', 
                              padding: '2px 4px', 
                              marginRight: '4px',
                              backgroundColor: '#17a2b8',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px'
                            }}
                            title="Find similar annotations"
                            disabled={isSearching}
                          >
                            <i className="fas fa-search"></i>
                          </button>
                        )}
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
                onClick={handleUpload}
                className="annotation-action-btn"
                disabled={annotations.filter(a => a.embeddings?.imageEmbedding).length === 0}
                title="Upload annotations with embeddings to Weaviate"
              >
                <i className="fas fa-cloud-upload-alt"></i>
                Upload
              </button>
              
              <button
                onClick={handleExport}
                className="annotation-action-btn"
                disabled={annotations.length === 0}
                title="Export annotations to JSON file"
                style={{ fontSize: '11px', padding: '4px 8px' }}
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

      {/* Similarity Search Results Panel */}
      {showSimilarityPanel && (
        <div className="similarity-panel" style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          width: '300px',
          maxHeight: '500px',
          backgroundColor: 'white',
          border: '1px solid #ccc',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          zIndex: 1000,
          overflow: 'hidden'
        }}>
          <div style={{
            padding: '10px',
            borderBottom: '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#f8f9fa'
          }}>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>
              Similar Annotations
            </h4>
            <button
              onClick={() => setShowSimilarityPanel(false)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '16px',
                cursor: 'pointer',
                color: '#666'
              }}
              title="Close"
            >
              ×
            </button>
          </div>
          
          <div style={{ 
            padding: '10px', 
            maxHeight: '400px', 
            overflowY: 'auto' 
          }}>
            {isSearching ? (
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <i className="fas fa-spinner fa-spin"></i>
                <div style={{ marginTop: '8px', fontSize: '12px' }}>Searching...</div>
              </div>
            ) : similarityResults.length > 0 ? (
              <div>
                {similarityResults.map((result, index) => {
                  // Extract properties from Weaviate object structure
                  const props = result.properties || result;
                  const metadata = props.metadata || '';
                  
                  // Try to parse metadata if it's a string
                  let parsedMetadata = {};
                  if (typeof metadata === 'string') {
                    try {
                      parsedMetadata = JSON.parse(metadata);
                    } catch {
                      parsedMetadata = { raw: metadata };
                    }
                  } else {
                    parsedMetadata = metadata;
                  }
                  
                  return (
                    <div key={index} style={{
                      padding: '8px',
                      borderBottom: '1px solid #eee',
                      fontSize: '12px'
                    }}>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        {props.description || 'No description'}
                      </div>
                      <div style={{ color: '#999', fontSize: '10px', marginBottom: '4px' }}>
                        ID: {props.image_id || 'Unknown'}
                      </div>
                      {parsedMetadata && Object.keys(parsedMetadata).length > 0 && (
                        <div style={{ color: '#666', marginBottom: '4px' }}>
                          <strong>Metadata:</strong>
                          <pre style={{ fontSize: '10px', margin: '2px 0', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(parsedMetadata, null, 2)}
                          </pre>
                        </div>
                      )}
                      {result.metadata?.score && (
                        <div style={{ color: '#28a745', fontSize: '11px' }}>
                          Score: {result.metadata.score.toFixed(3)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ 
                textAlign: 'center', 
                padding: '20px', 
                color: '#666',
                fontSize: '12px'
              }}>
                No similar annotations found
              </div>
            )}
          </div>
        </div>
      )}
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
  description: PropTypes.string,
  setDescription: PropTypes.func.isRequired,
  annotations: PropTypes.array.isRequired,
  onAnnotationDelete: PropTypes.func.isRequired,
  onClearAllAnnotations: PropTypes.func.isRequired,
  onExportAnnotations: PropTypes.func.isRequired,
  onImportAnnotations: PropTypes.func.isRequired,
  wellInfoMap: PropTypes.object, // Map of annotation IDs to well information
  embeddingStatus: PropTypes.object, // Map of annotation IDs to embedding status
  mapScale: PropTypes.object, // Current map scale for image extraction
  mapPan: PropTypes.object, // Current map pan offset for image extraction
  stageDimensions: PropTypes.object, // Stage dimensions in mm for image extraction
  pixelsPerMm: PropTypes.number, // Pixels per millimeter conversion for image extraction
  // New props for advanced extraction
  isHistoricalDataMode: PropTypes.bool,
  microscopeControlService: PropTypes.object,
  artifactZarrLoader: PropTypes.object,
  zarrChannelConfigs: PropTypes.object,
  realMicroscopeChannelConfigs: PropTypes.object,
  enabledZarrChannels: PropTypes.array,
  visibleChannelsConfig: PropTypes.object,
  selectedHistoricalDataset: PropTypes.object,
  wellPlateType: PropTypes.string,
  timepoint: PropTypes.number,
  onEmbeddingsGenerated: PropTypes.func
};

export default AnnotationPanel;
