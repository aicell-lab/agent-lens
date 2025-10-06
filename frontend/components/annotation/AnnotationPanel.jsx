import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './AnnotationPanel.css';
import AnnotationDetailsWindow from './AnnotationDetailsWindow';
import { generateAnnotationData, exportAnnotationsToJson } from '../../utils/annotationUtils';
import { extractAnnotationImageRegion, extractAnnotationImageRegionAdvanced } from '../../utils/annotationEmbeddingService';
import { generatePreviewFromDataUrl } from '../../utils/previewImageUtils';

// Helper function to extract coordinate information from annotation metadata
const extractCoordinate = (metadata) => {
  if (!metadata || typeof metadata !== 'object') {
    return 'Unknown';
  }
  
  // Try polygon_wkt first (for polygon/freehand annotations)
  if (metadata.polygon_wkt && typeof metadata.polygon_wkt === 'string') {
    try {
      // Extract coordinates from WKT format: POLYGON((x1 y1, x2 y2, ...))
      const match = metadata.polygon_wkt.match(/POLYGON\(\(([^)]+)\)\)/);
      if (match && match[1]) {
        const coords = match[1].split(',')[0].trim(); // Get first coordinate pair
        const [x, y] = coords.split(' ').map(coord => parseFloat(coord));
        if (!isNaN(x) && !isNaN(y)) {
          return `(${x.toFixed(3)}, ${y.toFixed(3)})`;
        }
      }
    } catch (error) {
      console.error('Error parsing WKT polygon:', error);
    }
  }
  
  // Try bbox (for rectangle annotations) - format: [x, y, width, height]
  if (metadata.bbox && Array.isArray(metadata.bbox) && metadata.bbox.length >= 2) {
    try {
      const [x, y] = metadata.bbox;
      if (!isNaN(x) && !isNaN(y)) {
        return `(${x.toFixed(3)}, ${y.toFixed(3)})`;
      }
    } catch (error) {
      console.error('Error parsing bbox:', error);
    }
  }
  
  return 'Unknown';
};

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
  onEmbeddingsGenerated,
  // Layer activation props
  activeLayer,
  layers,
  experiments
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
      // Support both Browse Data (historical) and experiment layers
      const isBrowseDataMode = isHistoricalDataMode || (activeLayer && layers.find(l => l.id === activeLayer)?.type === 'load-server');
      const isExperimentMode = !isHistoricalDataMode && (activeLayer && layers.find(l => l.id === activeLayer)?.type === 'experiment');
      
      const canUseAdvancedExtraction = 
        (isBrowseDataMode && artifactZarrLoader && enabledZarrChannels.length > 0) ||
        (isExperimentMode && microscopeControlService && Object.values(visibleChannelsConfig).some(v => v));

      setIsLoading(true);
      try {
        let imageBlob;

        if (canUseAdvancedExtraction) {
          console.log('🎨 Using advanced extraction for annotation preview');
          
          // Determine mode and prepare services based on layer type
          const mode = isBrowseDataMode ? 'HISTORICAL' : 'FREE_PAN';
          const services = {
            microscopeControlService,
            artifactZarrLoader
          };

          // Prepare channel configurations based on layer type
          let channelConfigs, enabledChannels;
          if (isBrowseDataMode) {
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
            
            // Convert imageBlob to data URL for future preview generation
            const extractedImageDataUrl = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(imageBlob);
            });
            
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
              generatedAt: new Date().toISOString(),
              extractedImageDataUrl  // Store the data URL for preview generation
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
  onEmbeddingsGenerated: PropTypes.func,
  // Layer activation props
  activeLayer: PropTypes.string,
  layers: PropTypes.array,
  experiments: PropTypes.array
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
  wellInfoMap = {}, // Map of annotation IDs to well information
  similarAnnotationWellMap = {}, // Map of well IDs to well information for similar annotations
  getWellInfoById = null, // Function to get well info by well ID
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
  onEmbeddingsGenerated = null,
  // Map browsing state
  isMapBrowsingMode = false,
  setIsMapBrowsingMode = null,
  // Similar annotation map rendering
  onSimilarAnnotationsUpdate = null,
  // Similar annotations state and controls
  similarAnnotations = [],
  showSimilarAnnotations = false,
  setShowSimilarAnnotations = null,
  onSimilarAnnotationsCleanup = null,
  // Navigation functions
  navigateToCoordinates = null,
  goBackToPreviousPosition = null,
  hasPreviousPosition = false,
  currentZoomLevel = null,
  currentScaleLevel = null,
  // Layer activation props
  activeLayer = null,
  layers = [],
  experiments = []
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
  
  // Load all annotations states
  const [isLoadingAllAnnotations, setIsLoadingAllAnnotations] = useState(false);
  const [loadedAnnotationsCount, setLoadedAnnotationsCount] = useState(0);

  // Helper functions for layer management
  const getActiveLayerInfo = () => {
    if (!activeLayer || !layers.length) return null;
    return layers.find(layer => layer.id === activeLayer);
  };

  const getActiveLayerType = () => {
    const layerInfo = getActiveLayerInfo();
    return layerInfo ? layerInfo.type : null;
  };

  const isBrowseDataLayer = () => {
    return getActiveLayerType() === 'load-server';
  };


  const getLayerDisplayName = () => {
    const layerInfo = getActiveLayerInfo();
    
    // If no layer info found in layers array, check if it's an experiment
    if (!layerInfo && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        return `Experiment: ${experiment.name}`;
      }
    }
    
    if (!layerInfo) return 'Unknown Layer';
    
    if (layerInfo.type === 'load-server' && selectedHistoricalDataset) {
      return '';
    } else if (layerInfo.type === 'experiment') {
      return `Experiment: ${layerInfo.name || 'Experiment'}`;
    }
    
    return layerInfo.name || 'Layer';
  };

  const tools = [
    { id: 'rectangle', name: 'Rectangle', icon: 'fa-square', tooltip: 'Draw rectangles' },
    { id: 'polygon', name: 'Polygon', icon: 'fa-draw-polygon', tooltip: 'Draw polygons (click to add points, double-click to finish)' },
    { id: 'freehand', name: 'Freehand', icon: 'fa-pencil', tooltip: 'Draw freehand shapes' },
    { id: 'map-browse', name: 'Map Browse', icon: 'fa-hand-paper', tooltip: 'Browse the map (pan and zoom)' },
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

  const handleToolSelection = (toolId) => {
    if (toolId === 'map-browse') {
      // Toggle map browsing mode
      if (setIsMapBrowsingMode) {
        setIsMapBrowsingMode(!isMapBrowsingMode);
      }
      // Don't change currentTool when toggling map browsing
    } else {
      // For other tools, deactivate map browsing and set the tool
      if (setIsMapBrowsingMode) {
        setIsMapBrowsingMode(false);
      }
      setCurrentTool(toolId);
    }
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

    // Get dataset ID for application ID - support both historical datasets and experiments
    let applicationId = selectedHistoricalDataset?.id;
    
    // If no historical dataset, check if we're using an experiment layer
    if (!applicationId && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        applicationId = experiment.name; // Use experiment name as application ID
      }
    }
    
    if (!applicationId) {
      alert('No dataset or experiment selected. Cannot upload annotations.');
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
          
          // Generate full annotation data including coordinates
          const annotationData = generateAnnotationData(annotation, wellInfo, annotation.channelInfo);
          
          console.log(`📍 Generated annotation data for ${annotation.id}:`, {
            bbox: annotationData.bbox,
            polygon_wkt: annotationData.polygon_wkt,
            type: annotationData.type
          });
          
          const metadata = {
            annotation_id: annotation.id,
            well_id: wellInfo?.id || 'unknown',
            annotation_type: annotation.type,
            timestamp: annotation.timestamp || new Date().toISOString(),
            // Include coordinate data from generateAnnotationData
            ...(annotationData.bbox && { bbox: annotationData.bbox }),
            ...(annotationData.polygon_wkt && { polygon_wkt: annotationData.polygon_wkt }),
            ...(annotation.channelInfo && { channel_info: annotation.channelInfo })
          };

          // Generate preview image if annotation has extracted image data
          let previewImage = null;
          const extractedImageDataUrl = annotation.extractedImageDataUrl || annotation.embeddings?.extractedImageDataUrl;
          
          console.log(`🖼️ Debugging annotation ${annotation.id}:`, {
            hasExtractedImageDataUrl: !!annotation.extractedImageDataUrl,
            hasEmbeddingsExtractedImageDataUrl: !!annotation.embeddings?.extractedImageDataUrl,
            hasEmbeddings: !!annotation.embeddings,
            hasImageEmbedding: !!annotation.embeddings?.imageEmbedding,
            finalExtractedImageDataUrl: !!extractedImageDataUrl
          });
          
          if (extractedImageDataUrl) {
            console.log(`🖼️ Generating preview for annotation ${annotation.id}`);
            previewImage = await generatePreviewFromDataUrl(extractedImageDataUrl);
            console.log(`🖼️ Preview generated for annotation ${annotation.id}:`, {
              previewGenerated: !!previewImage,
              previewSize: previewImage ? previewImage.length : 0
            });
          } else {
            console.log(`⚠️ No extractedImageDataUrl found for annotation ${annotation.id} - check embeddings generation`);
          }

          // Prepare URL with basic query parameters (without embedding)
          const queryParams = new URLSearchParams({
            collection_name: collectionName,
            application_id: applicationId,
            image_id: `${applicationId}_${annotation.id}`,
            description: annotation.description || `${annotation.type} annotation`,
            metadata: JSON.stringify(metadata),
            dataset_id: applicationId
          });
          
          console.log(`📤 Sending metadata for ${annotation.id}:`, metadata);

          // Prepare request body with large data (to avoid URL length limits)
          const requestBody = new FormData();
          
          // Add preview image to request body if generated
          if (previewImage) {
            requestBody.append('preview_image', previewImage);
            console.log(`🖼️ Sending preview image in request body for annotation ${annotation.id}`);
          }
          
          // CRITICAL: Add the pre-generated image embedding to request body
          if (annotation.embeddings && annotation.embeddings.imageEmbedding) {
            requestBody.append('image_embedding', JSON.stringify(annotation.embeddings.imageEmbedding));
            console.log(`🔗 Sending pre-generated image embedding for annotation ${annotation.id}`);
          } else {
            console.warn(`⚠️ No image embedding found for annotation ${annotation.id} - upload will fail`);
          }

          // Use the insert endpoint with correct URL pattern
          const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
          const insertResponse = await fetch(`/agent-lens/apps/${serviceId}/similarity/insert?${queryParams}`, {
            method: 'POST',
            body: requestBody
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

      // Show results and cleanup if successful
      if (uploadedCount > 0) {
        alert(`Successfully uploaded ${uploadedCount} annotation(s) to Weaviate collection '${collectionName}'.` + 
              (failedCount > 0 ? ` ${failedCount} failed.` : ''));
        
        // Clean up annotations after successful upload (same as Clear All button)
        console.log('🧹 Cleaning up annotations after successful upload');
        onClearAllAnnotations();
      } else {
        alert(`Failed to upload annotations. ${failedCount} failed.`);
      }

    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload annotations: ' + error.message);
    }
  };

  const handleLoadAllAnnotations = async () => {
    // Get dataset ID for application ID - support both historical datasets and experiments
    let applicationId = selectedHistoricalDataset?.id;
    
    // If no historical dataset, check if we're using an experiment layer
    if (!applicationId && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        applicationId = experiment.name; // Use experiment name as application ID
      }
    }
    
    if (!applicationId) {
      alert('No dataset or experiment selected. Cannot load annotations.');
      return;
    }

    setIsLoadingAllAnnotations(true);
    
    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        collection_name: convertToValidCollectionName('agent-lens'),
        application_id: applicationId,
        limit: '1000',
        include_vector: 'false'
      });
      
      const response = await fetch(`/agent-lens/apps/${serviceId}/similarity/fetch-all?${queryParams}`, {
        method: 'GET'
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success && result.annotations) {
          console.log(`📥 Loaded ${result.annotations.length} annotations from Weaviate`);
          
          // Update similar annotations to display all loaded annotations on the map
          if (onSimilarAnnotationsUpdate) {
            onSimilarAnnotationsUpdate(result.annotations);
            setLoadedAnnotationsCount(result.annotations.length);
          }
          
          // Show the annotations on the map
          if (setShowSimilarAnnotations) {
            setShowSimilarAnnotations(true);
          }
          
          alert(`Successfully loaded ${result.annotations.length} annotation(s) from the database.`);
        } else {
          console.error('No annotations found:', result);
          alert('No annotations found in the database.');
        }
      } else {
        console.error('Load annotations failed:', await response.text());
        alert('Failed to load annotations from database.');
      }
    } catch (error) {
      console.error('Error loading annotations:', error);
      alert('Error loading annotations: ' + error.message);
    } finally {
      setIsLoadingAllAnnotations(false);
    }
  };

  const handleFindSimilar = async (annotation) => {
    if (!annotation.embeddings?.imageEmbedding) {
      alert('This annotation does not have embeddings. Cannot search for similar annotations.');
      return;
    }

    // Get dataset ID for application ID - support both historical datasets and experiments
    let applicationId = selectedHistoricalDataset?.id;
    
    // If no historical dataset, check if we're using an experiment layer
    if (!applicationId && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        applicationId = experiment.name; // Use experiment name as application ID
      }
    }
    
    if (!applicationId) {
      alert('No dataset or experiment selected. Cannot search for similar annotations.');
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
          
          // Final validation
          if (!Array.isArray(results)) {
            results = results ? [results] : [];
          }
          
          setSimilarityResults(results);
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
          <span className="font-medium">Annotations</span>
          {/* Active Layer Display */}
          {activeLayer && getLayerDisplayName() && (
            <span className="text-xs text-blue-300 ml-2 px-2 py-1 bg-blue-900 rounded">
              {getLayerDisplayName()}
            </span>
          )}
          {/* Dataset ID Display for Browse Data layers */}
          {isBrowseDataLayer() && selectedHistoricalDataset?.id && (
            <span className="text-xs text-gray-500 ml-2">
              Dataset: {selectedHistoricalDataset.id}
            </span>
          )}
          {/* Load All Button / Loaded Annotations Indicator */}
          <span 
            className="text-xs text-green-400 ml-2 px-2 py-1 bg-green-900 rounded cursor-pointer hover:bg-green-800 transition-colors" 
            title={loadedAnnotationsCount > 0 ? "Loaded annotations from database" : "Click to load all annotations from database"}
            onClick={handleLoadAllAnnotations}
            style={{ 
              pointerEvents: isLoadingAllAnnotations ? 'none' : 'auto',
              opacity: isLoadingAllAnnotations ? 0.6 : 1 
            }}
          >
            <i className={`fas ${isLoadingAllAnnotations ? 'fa-spinner fa-spin' : 'fa-database'} mr-1`}></i>
            {isLoadingAllAnnotations ? 'Loading...' : (loadedAnnotationsCount > 0 ? `Load All (${loadedAnnotationsCount} loaded)` : 'Load All')}
          </span>
        </div>
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
                  onClick={() => handleToolSelection(tool.id)}
                  className={`annotation-tool-btn ${
                    tool.id === 'map-browse' 
                      ? (isMapBrowsingMode ? 'active' : '') 
                      : (currentTool === tool.id ? 'active' : '')
                  }`}
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
                placeholder="text ... in development"
                className="description-input"
                rows="2"
                maxLength="200"
                disabled
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
                          activeLayer={activeLayer}
                          layers={layers}
                          experiments={experiments}
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

          {/* Similar Annotations */}
          {showSimilarityPanel && (
            <div className="annotation-section">
              <div className="annotation-section-title">
                <i className="fas fa-search"></i>
                Similar Annotations
                <div className="similarity-results-actions">
                  {/* Go back button */}
                  {goBackToPreviousPosition && hasPreviousPosition && (
                    <button
                      onClick={goBackToPreviousPosition}
                      className="similarity-go-back-btn"
                      style={{
                        backgroundColor: '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        marginRight: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: '500'
                      }}
                      title="Go back to previous map position"
                    >
                      <i className="fas fa-arrow-left"></i>
                      Go Back
                    </button>
                  )}
                  {/* Map Toggle - only show if we have similar annotations on the map */}
                  {similarAnnotations.length > 0 && setShowSimilarAnnotations && (
                    <button
                      onClick={() => setShowSimilarAnnotations(!showSimilarAnnotations)}
                      className={`similarity-toggle-btn ${
                        showSimilarAnnotations ? 'active' : ''
                      }`}
                      style={{
                        backgroundColor: showSimilarAnnotations ? '#f59e0b' : '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        marginRight: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: '500'
                      }}
                      title={`${showSimilarAnnotations ? 'Hide' : 'Show'} similar annotations on map`}
                    >
                      <i className="fas fa-map-marker-alt"></i>
                      Map ({similarAnnotations.length})
                      <i className={`fas ${showSimilarAnnotations ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  )}
                  
                  {/* Show on Map button - for new search results */}
                  {onSimilarAnnotationsUpdate && similarityResults.length > 0 && (
                    <button
                      className="similarity-show-map-btn"
                      onClick={() => {
                        onSimilarAnnotationsUpdate(similarityResults);
                      }}
                      style={{
                        backgroundColor: '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        marginRight: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: '500'
                      }}
                      title="Show similar annotations on the map"
                    >
                      <i className="fas fa-map-marker-alt"></i>
                      Show on Map
                    </button>
                  )}
                  
                  {/* Close button with cleanup */}
                  <button
                    className="similarity-close-btn"
                    onClick={() => {
                      setShowSimilarityPanel(false);
                      // Clean up similar annotations from map when closing the window
                      if (onSimilarAnnotationsCleanup) {
                        onSimilarAnnotationsCleanup();
                      }
                    }}
                    title="Close similarity search and clear map"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ccc',
                      cursor: 'pointer',
                      padding: '2px',
                      fontSize: '14px'
                    }}
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>
              </div>
              
              <div className="similarity-results-content">
                {isSearching ? (
                  <div className="similarity-loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <div>Searching for similar annotations...</div>
                  </div>
                ) : similarityResults.length > 0 ? (
                  <div className="similarity-results-list">
                    {similarityResults.map((result, index) => {
                      const props = result.properties || result;
                      const metadata = props.metadata || '';
                      
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
                            console.error('Both JSON and Python dict parsing failed:', error);
                            parsedMetadata = { raw: metadata };
                          }
                        }
                      } else {
                        parsedMetadata = metadata;
                      }
                      
                      return (
                        <div key={index} className="similarity-result-item-embedded">
                          {/* Preview Image */}
                          {props.preview_image && (
                            <img 
                              src={`data:image/png;base64,${props.preview_image}`} 
                              alt="Preview" 
                              className="similarity-preview-image-small"
                            />
                          )}
                          
                          {/* Content */}
                          <div className="similarity-result-content-embedded">
                            <div className="similarity-result-title-embedded">
                              {props.description || 'No description'}
                            </div>
                            <div className="similarity-result-id-embedded">
                              {props.image_id || 'Unknown'}
                            </div>
                            {parsedMetadata && Object.keys(parsedMetadata).length > 0 && (
                              <div className="similarity-result-metadata-embedded">
                                <strong>Well:</strong> {parsedMetadata.well_id || 'Unknown'}
                                {(parsedMetadata.polygon_wkt || parsedMetadata.bbox) && (
                                  <> - {extractCoordinate(parsedMetadata)}</>
                                )}
                                <br/>
                                <strong>Type:</strong> {parsedMetadata.annotation_type || 'Unknown'}<br/>
                                {parsedMetadata.timestamp && (
                                  <>
                                    <strong>Time:</strong> {new Date(parsedMetadata.timestamp).toLocaleString()}<br/>
                                  </>
                                )}
                              </div>
                            )}
                            {result.metadata?.score && (
                              <div className="similarity-result-score-embedded">
                                Similarity: {(result.metadata.score * 100).toFixed(1)}%
                              </div>
                            )}
                            
                            {/* Go to button */}
                            {navigateToCoordinates && parsedMetadata && (parsedMetadata.polygon_wkt || parsedMetadata.bbox) && (
                              <div className="similarity-result-actions-embedded" style={{ marginTop: '8px' }}>
                                <button
                                  onClick={() => {
                                    // Extract well-relative coordinates from metadata
                                    let wellRelativeX, wellRelativeY;
                                    
                                    if (parsedMetadata.polygon_wkt) {
                                      // For polygon annotations, get the first coordinate
                                      const match = parsedMetadata.polygon_wkt.match(/POLYGON\(\(([^)]+)\)\)/);
                                      if (match && match[1]) {
                                        const firstCoord = match[1].split(',')[0].trim();
                                        const [x, y] = firstCoord.split(' ').map(coord => parseFloat(coord));
                                        wellRelativeX = x;
                                        wellRelativeY = y;
                                      }
                                    } else if (parsedMetadata.bbox && Array.isArray(parsedMetadata.bbox)) {
                                      // For bbox annotations, use the center of the bounding box
                                      const [x, y, width, height] = parsedMetadata.bbox;
                                      wellRelativeX = x + width / 2;
                                      wellRelativeY = y + height / 2;
                                    }
                                    
                                    if (wellRelativeX !== undefined && wellRelativeY !== undefined && parsedMetadata.well_id) {
                                      // Get well information - try similarAnnotationWellMap first, then use getWellInfoById
                                      let wellInfo = similarAnnotationWellMap[parsedMetadata.well_id];
                                      
                                      // If not in similarAnnotationWellMap, try to get it dynamically
                                      if (!wellInfo && getWellInfoById) {
                                        wellInfo = getWellInfoById(parsedMetadata.well_id);
                                      }
                                      
                                      if (wellInfo) {
                                        // Convert well-relative coordinates to stage coordinates
                                        const stageX = wellInfo.centerX + wellRelativeX;
                                        const stageY = wellInfo.centerY + wellRelativeY;
                                        
                                        console.log(`✅ Navigating to well-relative coords (${wellRelativeX.toFixed(3)}, ${wellRelativeY.toFixed(3)}) in well ${parsedMetadata.well_id}`);
                                        console.log(`✅ Well center: (${wellInfo.centerX.toFixed(3)}, ${wellInfo.centerY.toFixed(3)})`);
                                        console.log(`✅ Stage coords: (${stageX.toFixed(3)}, ${stageY.toFixed(3)})`);
                                        
                                        // Automatically show similar annotations on map if not already shown
                                        if (onSimilarAnnotationsUpdate && similarityResults.length > 0 && similarAnnotations.length === 0) {
                                          console.log('🗺️ Auto-triggering similar annotations render on map');
                                          onSimilarAnnotationsUpdate(similarityResults);
                                        }
                                        
                                        // Navigate to the coordinates while preserving current zoom level
                                        navigateToCoordinates(stageX, stageY, currentZoomLevel, currentScaleLevel);
                                      } else {
                                        console.warn(`❌ No well info found for well ${parsedMetadata.well_id}`);
                                        console.warn(`Available wells in similarAnnotationWellMap:`, Object.keys(similarAnnotationWellMap));
                                      }
                                    }
                                  }}
                                  className="similarity-go-to-btn"
                                  style={{
                                    backgroundColor: '#059669',
                                    color: 'white',
                                    border: '1px solid #10b981',
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontWeight: '500',
                                    transition: 'background-color 0.2s'
                                  }}
                                  onMouseEnter={(e) => {
                                    e.target.style.backgroundColor = '#047857';
                                  }}
                                  onMouseLeave={(e) => {
                                    e.target.style.backgroundColor = '#059669';
                                  }}
                                  title="Go to this annotation on the map"
                                >
                                  <i className="fas fa-map-marker-alt"></i>
                                  Go to
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="similarity-empty-embedded">
                    <i className="fas fa-search"></i>
                    <h4>No Similar Annotations Found</h4>
                    <p>Try creating more annotations or check if the current annotation has embeddings.</p>
                  </div>
                )}
              </div>
            </div>
          )}

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
  description: PropTypes.string,
  setDescription: PropTypes.func.isRequired,
  annotations: PropTypes.array.isRequired,
  onAnnotationDelete: PropTypes.func.isRequired,
  onClearAllAnnotations: PropTypes.func.isRequired,
  onExportAnnotations: PropTypes.func.isRequired,
  wellInfoMap: PropTypes.object, // Map of annotation IDs to well information
  similarAnnotationWellMap: PropTypes.object, // Map of well IDs to well information for similar annotations
  getWellInfoById: PropTypes.func, // Function to get well info by well ID
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
  onEmbeddingsGenerated: PropTypes.func,
  // Map browsing state
  isMapBrowsingMode: PropTypes.bool,
  setIsMapBrowsingMode: PropTypes.func,
  // Similar annotation map rendering
  onSimilarAnnotationsUpdate: PropTypes.func,
  // Similar annotations state and controls
  similarAnnotations: PropTypes.array,
  showSimilarAnnotations: PropTypes.bool,
  setShowSimilarAnnotations: PropTypes.func,
  onSimilarAnnotationsCleanup: PropTypes.func,
  // Navigation functions
  navigateToCoordinates: PropTypes.func,
  goBackToPreviousPosition: PropTypes.func,
  hasPreviousPosition: PropTypes.bool,
  currentZoomLevel: PropTypes.number,
  currentScaleLevel: PropTypes.number,
  // Layer activation props
  activeLayer: PropTypes.string,
  layers: PropTypes.array,
  experiments: PropTypes.array
};

export default AnnotationPanel;
