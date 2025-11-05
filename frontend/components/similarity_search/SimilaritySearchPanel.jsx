import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './SimilaritySearchPanel.css';
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
  layers
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

const SimilaritySearchPanel = ({
  isDrawingMode,
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
  wellInfoMap = {}, // Map of annotation IDs to well information
  similarityResultsWellMap = {}, // Map of well IDs to well information for similarity results
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
  // Similarity results map rendering
  onSimilarityResultsUpdate = null,
  // Similarity results state and controls
  similarityResults = [],
  showSimilarityResults = false,
  setShowSimilarityResults = null,
  onSimilarityResultsCleanup = null,
  // Navigation functions
  navigateToCoordinates = null,
  goBackToPreviousPosition = null,
  hasPreviousPosition = false,
  currentZoomLevel = null,
  currentScaleLevel = null,
  // Layer activation props
  activeLayer = null,
  layers = [],
  experiments = [],
  // Similarity search handler
  onFindSimilar = null,
  // Similarity search results props
  showSimilarityPanel = false,
  similaritySearchResults = [],
  isSearching = false,
  searchType = null, // 'image' or 'text'
  textSearchQuery = '',
  setShowSimilarityPanel = null,
  setSimilaritySearchResults = null
}) => {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeColorType, setActiveColorType] = useState('stroke'); // 'stroke' or 'fill'
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [showDetailsWindow, setShowDetailsWindow] = useState(false);
  const [detailsWindowPosition, setDetailsWindowPosition] = useState({ x: 100, y: 100 });
  
  // Load all annotations states
  const [isLoadingAllAnnotations, setIsLoadingAllAnnotations] = useState(false);
  const [loadedAnnotationsCount, setLoadedAnnotationsCount] = useState(0);
  const [availableApplications, setAvailableApplications] = useState([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState(null);
  const [isLoadingApplications, setIsLoadingApplications] = useState(false);
  const [showApplicationList, setShowApplicationList] = useState(false);

  // Helper functions for layer management
  const getActiveLayerInfo = () => {
    if (!activeLayer) return null;
    // First check regular layers
    if (layers.length > 0) {
      const layerInfo = layers.find(layer => layer.id === activeLayer);
      if (layerInfo) return layerInfo;
    }
    // Then check experiments
    if (experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        // Return a layer-like object for experiments
        return { id: experiment.name, type: 'experiment' };
      }
    }
    return null;
  };

  const getActiveLayerType = () => {
    const layerInfo = getActiveLayerInfo();
    return layerInfo ? layerInfo.type : null;
  };

  const isBrowseDataLayer = () => {
    return getActiveLayerType() === 'load-server';
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

  const handleLoadApplicationList = async () => {
    // Get dataset ID for prefix - support both historical datasets and experiments
    let prefix = selectedHistoricalDataset?.id;
    
    // If no historical dataset, check if we're using an experiment layer
    if (!prefix && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        prefix = experiment.name;
      }
    }
    
    if (!prefix) {
      alert('No dataset or experiment selected. Cannot load annotation applications.');
      return;
    }

    setIsLoadingApplications(true);
    
    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        collection_name: convertToValidCollectionName('agent-lens'),
        prefix: prefix,
        limit: '1000'
      });
      
      const response = await fetch(`/agent-lens/apps/${serviceId}/similarity/list-applications?${queryParams}`, {
        method: 'GET'
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success && result.applications) {
          console.log(`📋 Found ${result.applications.length} annotation application(s)`);
          setAvailableApplications(result.applications);
          setShowApplicationList(true);
          
          // Auto-select first application if none selected
          if (!selectedApplicationId && result.applications.length > 0) {
            setSelectedApplicationId(result.applications[0].application_id);
          }
        } else {
          console.error('No applications found:', result);
          setAvailableApplications([]);
          alert('No annotation applications found.');
        }
      } else {
        console.error('Load applications failed:', await response.text());
        alert('Failed to load annotation applications from database.');
      }
    } catch (error) {
      console.error('Error loading applications:', error);
      alert('Error loading applications: ' + error.message);
    } finally {
      setIsLoadingApplications(false);
    }
  };

  const handleLoadAllAnnotations = async (specificApplicationId = null) => {
    // Get dataset ID for application ID - support both historical datasets and experiments
    let applicationId = specificApplicationId || selectedApplicationId || selectedHistoricalDataset?.id;
    
    // If no historical dataset, check if we're using an experiment layer
    if (!applicationId && activeLayer && experiments.length > 0) {
      const experiment = experiments.find(exp => exp.name === activeLayer);
      if (experiment) {
        applicationId = experiment.name; // Use experiment name as application ID
      }
    }
    
    if (!applicationId) {
      // If no specific application ID, try to load all with prefix matching
      const prefix = selectedHistoricalDataset?.id || (activeLayer && experiments.find(exp => exp.name === activeLayer)?.name);
      if (!prefix) {
        alert('No dataset or experiment selected. Cannot load annotations.');
        return;
      }
      // Use prefix matching to load all
      applicationId = prefix;
    }

    setIsLoadingAllAnnotations(true);
    
    try {
      const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
      
      // Determine if we should use prefix matching (if applicationId matches the base prefix)
      const basePrefix = selectedHistoricalDataset?.id || (activeLayer && experiments.find(exp => exp.name === activeLayer)?.name);
      const usePrefixMatch = basePrefix && (applicationId === basePrefix || applicationId.startsWith(basePrefix + '_'));
      
      // Prepare query parameters
      const queryParams = new URLSearchParams({
        collection_name: convertToValidCollectionName('agent-lens'),
        application_id: applicationId,
        limit: '1000',
        include_vector: 'false',
        use_prefix_match: usePrefixMatch ? 'true' : 'false'
      });
      
      const response = await fetch(`/agent-lens/apps/${serviceId}/similarity/fetch-all?${queryParams}`, {
        method: 'GET'
      });

      if (response.ok) {
        const result = await response.json();
        
        if (result.success && result.annotations) {
          console.log(`📥 Loaded ${result.annotations.length} annotations from Weaviate`);
          
          // Update similarity results to display all loaded results on the map
          if (onSimilarityResultsUpdate) {
            onSimilarityResultsUpdate(result.annotations);
            setLoadedAnnotationsCount(result.annotations.length);
          }
          
          // Show the results on the map
          if (setShowSimilarityResults) {
            setShowSimilarityResults(true);
          }
          
          // Update selected application ID if we loaded a specific one
          if (specificApplicationId) {
            setSelectedApplicationId(specificApplicationId);
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

  const handleFindSimilar = (annotation) => {
    if (onFindSimilar) {
      onFindSimilar(annotation);
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
    <div className="similarity-search-panel">
      {/* Header */}
      <div className="similarity-search-panel-header">
        <div className="flex items-center space-x-2">
          <i className="fas fa-draw-polygon text-blue-400"></i>
          <span className="font-medium text-sm">Similarity Search</span>
          {/* Close button to deactivate similarity search layer */}
          <button
            onClick={() => {
              // Clear all annotations when closing
              if (onClearAllAnnotations) {
                onClearAllAnnotations();
              }
              // Clean up similarity search results
              if (setShowSimilarityPanel) {
                setShowSimilarityPanel(false);
              }
              if (setSimilaritySearchResults) {
                setSimilaritySearchResults([]);
              }
              // Clean up similarity results from map
              if (onSimilarityResultsCleanup) {
                onSimilarityResultsCleanup();
              }
              // Trigger deactivation event to close similarity search layer and update visibility
              const event = new CustomEvent('similaritySearchLayerDeactivated', {
                detail: { layerId: activeLayer, layerType: getActiveLayerType() }
              });
              window.dispatchEvent(event);
            }}
            className="ml-auto text-red-400 hover:text-red-300 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
            title="Close similarity search panel, clear annotations and similarity results, and deactivate similarity search layer"
          >
            <i className="fas fa-times"></i>
          </button>
          {/* Dataset ID Display for Browse Data layers */}
          {isBrowseDataLayer() && selectedHistoricalDataset?.id && (
            <span className="text-xs text-gray-500 ml-2">
              Dataset: {selectedHistoricalDataset.id}
            </span>
          )}
          {/* Load Applications List Button */}
          <span 
            className="text-xs text-blue-400 ml-2 px-2 py-1 bg-blue-900 rounded cursor-pointer hover:bg-blue-800 transition-colors" 
            title="Click to see available similarity search applications"
            onClick={handleLoadApplicationList}
            style={{ 
              pointerEvents: isLoadingApplications ? 'none' : 'auto',
              opacity: isLoadingApplications ? 0.6 : 1 
            }}
          >
            <i className={`fas ${isLoadingApplications ? 'fa-spinner fa-spin' : 'fa-list'} mr-1`}></i>
            {isLoadingApplications ? 'Loading...' : 'List Apps'}
          </span>
          
          {/* Load All Button / Loaded Annotations Indicator */}
          <span 
            className="text-xs text-green-400 ml-2 px-2 py-1 bg-green-900 rounded cursor-pointer hover:bg-green-800 transition-colors" 
            title={loadedAnnotationsCount > 0 ? "Loaded annotations from database" : "Click to load all annotations from database"}
            onClick={() => handleLoadAllAnnotations()}
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

      {/* Annotation Applications List */}
      {showApplicationList && availableApplications.length > 0 && (
        <div className="annotation-section" style={{ marginBottom: '10px', border: '1px solid #3b82f6', borderRadius: '4px', padding: '8px' }}>
          <div className="annotation-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              <i className="fas fa-list text-blue-400 mr-2"></i>
              Annotation Applications ({availableApplications.length})
            </span>
            <button
              onClick={() => setShowApplicationList(false)}
              className="text-xs text-gray-400 hover:text-gray-200"
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              title="Close application list"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div style={{ marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {availableApplications.map((app) => (
              <div
                key={app.application_id}
                onClick={() => handleLoadAllAnnotations(app.application_id)}
                style={{
                  padding: '8px',
                  marginBottom: '4px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  backgroundColor: selectedApplicationId === app.application_id ? '#1e40af' : '#1e3a8a',
                  border: selectedApplicationId === app.application_id ? '2px solid #60a5fa' : '1px solid #3b82f6',
                  transition: 'all 0.2s',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
                onMouseEnter={(e) => {
                  if (selectedApplicationId !== app.application_id) {
                    e.currentTarget.style.backgroundColor = '#2563eb';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedApplicationId !== app.application_id) {
                    e.currentTarget.style.backgroundColor = '#1e3a8a';
                  }
                }}
                title={`Click to load annotations from ${app.application_id}`}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i className={`fas ${selectedApplicationId === app.application_id ? 'fa-check-circle' : 'fa-circle'} text-blue-400`}></i>
                  <span style={{ fontSize: '12px', color: '#e0e7ff' }}>{app.application_id}</span>
                </div>
                <span style={{ fontSize: '11px', color: '#93c5fd' }}>
                  {app.annotation_count} annotation{app.annotation_count !== 1 ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
          {selectedApplicationId && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #3b82f6', fontSize: '11px', color: '#93c5fd' }}>
              <i className="fas fa-info-circle mr-1"></i>
              Selected: <strong>{selectedApplicationId}</strong>
            </div>
          )}
        </div>
      )}

      {isDrawingMode && (
        <>
          {/* Similar Annotations */}
          {showSimilarityPanel && (
            <div className="annotation-section">
              <div className="annotation-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <i className="fas fa-search"></i>
                  <span>
                    {searchType === 'text' 
                      ? (() => {
                          // Check if it's a UUID search
                          if (textSearchQuery.startsWith('uuid: ')) {
                            const uuid = textSearchQuery.substring(6); // Remove "uuid: " prefix
                            const truncatedUuid = uuid.length > 10 ? `${uuid.substring(0, 10)}...` : uuid;
                            return `Similar Results (UUID: "${truncatedUuid}")`;
                          }
                          return `Similar Results (Text: "${textSearchQuery}")`;
                        })()
                      : 'Similar Results (Image)'}
                  </span>
                </div>
                <div className="similarity-results-actions" style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '6px',
                  marginLeft: 'auto'
                }}>
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
                  {/* Map Toggle - only show if we have similarity results on the map */}
                  {similarityResults.length > 0 && setShowSimilarityResults && (
                    <button
                      onClick={() => setShowSimilarityResults(!showSimilarityResults)}
                      className={`similarity-toggle-btn ${
                        showSimilarityResults ? 'active' : ''
                      }`}
                      style={{
                        backgroundColor: showSimilarityResults ? '#f59e0b' : '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: '500'
                      }}
                      title={`${showSimilarityResults ? 'Hide' : 'Show'} similarity results on map`}
                    >
                      <i className="fas fa-map-marker-alt"></i>
                      Map ({similarityResults.length})
                      <i className={`fas ${showSimilarityResults ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                    </button>
                  )}
                  
                  {/* Show on Map button - for new search results */}
                  {onSimilarityResultsUpdate && similaritySearchResults.length > 0 && (
                    <button
                      className="similarity-show-map-btn"
                      onClick={() => {
                        onSimilarityResultsUpdate(similaritySearchResults);
                        // Enable map browsing when showing results on map
                        if (setIsMapBrowsingMode) {
                          setIsMapBrowsingMode(true);
                        }
                      }}
                      style={{
                        backgroundColor: '#374151',
                        color: '#d1d5db',
                        border: '1px solid #4b5563',
                        padding: '3px 6px',
                        borderRadius: '4px',
                        fontSize: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        fontWeight: '500'
                      }}
                      title="Show similarity results on the map"
                    >
                      <i className="fas fa-map-marker-alt"></i>
                      Show on Map
                    </button>
                  )}
                  
                  {/* Close button with cleanup */}
                  <button
                    className="similarity-close-btn"
                    onClick={() => {
                      if (setShowSimilarityPanel) {
                        setShowSimilarityPanel(false);
                      }
                      // Clean up similarity results from map when closing the window
                      if (onSimilarityResultsCleanup) {
                        onSimilarityResultsCleanup();
                      }
                      // Clean up similarity search results
                      if (setSimilaritySearchResults) {
                        setSimilaritySearchResults([]);
                      }
                      // Trigger deactivation event to update layer visibility icon
                      const layerType = getActiveLayerType();
                      const event = new CustomEvent('similaritySearchLayerDeactivated', {
                        detail: { layerId: activeLayer, layerType: layerType }
                      });
                      window.dispatchEvent(event);
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
                    <div>Searching for similar results...</div>
                  </div>
                ) : similaritySearchResults.length > 0 ? (
                  <div className="similarity-results-list">
                    {similaritySearchResults.map((result, index) => {
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
                              {objectUUID || 'Unknown'}
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
                                      // Get well information - try similarityResultsWellMap first, then use getWellInfoById
                                      let wellInfo = similarityResultsWellMap[parsedMetadata.well_id];
                                      
                                      // If not in similarityResultsWellMap, try to get it dynamically
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
                                        
                                        // Automatically show similarity results on map if not already shown
                                        if (onSimilarityResultsUpdate && similaritySearchResults.length > 0 && !showSimilarityResults) {
                                          console.log('🗺️ Auto-triggering similarity results render on map');
                                          onSimilarityResultsUpdate(similaritySearchResults);
                                        }
                                        
                                        // Enable map browsing when navigating to annotation
                                        if (setIsMapBrowsingMode) {
                                          setIsMapBrowsingMode(true);
                                        }
                                        
                                        // Navigate to the coordinates while preserving current zoom level
                                        navigateToCoordinates(stageX, stageY, currentZoomLevel, currentScaleLevel);
                                      } else {
                                        console.warn(`❌ No well info found for well ${parsedMetadata.well_id}`);
                                        console.warn(`Available wells in similarityResultsWellMap:`, Object.keys(similarityResultsWellMap));
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
                    <h4>No Similar Results Found</h4>
                    <p>Try creating more annotations or check if the current annotation has embeddings.</p>
                  </div>
                )}
              </div>
            </div>
          )}

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

          {/* Annotation List */}
          <div className="annotation-section">
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
                            title="Find similar results"
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

SimilaritySearchPanel.propTypes = {
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
  similarityResultsWellMap: PropTypes.object, // Map of well IDs to well information for similarity results
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
  // Similarity results map rendering
  onSimilarityResultsUpdate: PropTypes.func,
  // Similarity results state and controls
  similarityResults: PropTypes.array,
  showSimilarityResults: PropTypes.bool,
  setShowSimilarityResults: PropTypes.func,
  onSimilarityResultsCleanup: PropTypes.func,
  // Navigation functions
  navigateToCoordinates: PropTypes.func,
  goBackToPreviousPosition: PropTypes.func,
  hasPreviousPosition: PropTypes.bool,
  currentZoomLevel: PropTypes.number,
  currentScaleLevel: PropTypes.number,
  // Layer activation props
  activeLayer: PropTypes.string,
  layers: PropTypes.array,
  experiments: PropTypes.array,
  // Similarity search handler
  onFindSimilar: PropTypes.func,
  // Similarity search results props
  showSimilarityPanel: PropTypes.bool,
  similaritySearchResults: PropTypes.array,
  isSearching: PropTypes.bool,
  searchType: PropTypes.string,
  textSearchQuery: PropTypes.string,
  setShowSimilarityPanel: PropTypes.func,
  setSimilaritySearchResults: PropTypes.func
};

export default SimilaritySearchPanel;
