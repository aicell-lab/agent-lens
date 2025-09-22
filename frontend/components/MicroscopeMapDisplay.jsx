import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useValidatedNumberInput } from '../utils'; // Import validation utilities
import ArtifactZarrLoader from '../utils/artifactZarrLoader.js';
import LayerPanel from './microscope/map/LayerPanel';
import useExperimentZarrManager from './microscope/map/ExperimentZarrManager';
import TileProcessingManager from './microscope/map/TileProcessingManager';
import QuickScanConfig from './microscope/controls/QuickScanConfig';
import NormalScanConfig from './microscope/controls/NormalScanConfig';
import AnnotationPanel from './annotation/AnnotationPanel';
import AnnotationCanvas from './annotation/AnnotationCanvas';
import { generateAnnotationEmbeddings } from '../utils/annotationEmbeddingService';
import './MicroscopeMapDisplay.css';

const MicroscopeMapDisplay = ({
  isOpen,
  microscopeConfiguration,
  isWebRtcActive,
  videoRef,
  remoteStream,
  frameMetadata,
  videoZoom,
  setVideoZoom,
  snapshotImage,
  snappedImageData,
  isDragging,
  dragTransform,
  microscopeControlService,
  appendLog,
  showNotification,
  fallbackStagePosition,
  onOpenImageJ,
  imjoyApi,
  webRtcError,
  microscopeBusy,
  setMicroscopeBusy,
  currentOperation,
  setCurrentOperation,
  videoContrastMin,
  setVideoContrastMin,
  videoContrastMax,
  setVideoContrastMax,
  autoContrastEnabled,
  setAutoContrastEnabled,
  autoContrastMinAdjust,
  setAutoContrastMinAdjust,
  autoContrastMaxAdjust,
  setAutoContrastMaxAdjust,
  isDataChannelConnected,
  isContrastControlsCollapsed,
  setIsContrastControlsCollapsed,
  selectedMicroscopeId,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  toggleWebRtcStream,
  onFreePanAutoCollapse,
  onFitToViewUncollapse,
  sampleLoadStatus,
  // Panel control props
  isSamplePanelOpen,
  setIsSamplePanelOpen,
  isControlPanelOpen,
  setIsControlPanelOpen,
  // Sample selector props
  incubatorControlService,
  orchestratorManagerService,
  onSampleLoadStatusChange,
}) => {
  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapVideoRef = useRef(null);
  
  // Check if using simulated microscope - disable scanning features
  const isSimulatedMicroscope = selectedMicroscopeId === 'agent-lens/squid-control-reef';
  
  // Close scan configurations when switching to simulated microscope (basic cleanup only)
  useEffect(() => {
    if (isSimulatedMicroscope) {
      // Close any open scan configurations
      setShowScanConfig(false);
      setShowQuickScanConfig(false);
      setIsRectangleSelection(false);
      setRectangleStart(null);
      setRectangleEnd(null);
      setDragSelectedWell(null);
      // Clean up grid drawing states
      setGridDragStart(null);
      setGridDragEnd(null);
      setIsGridDragging(false);
    }
  }, [isSimulatedMicroscope]);
  
  // 🚀 PERFORMANCE OPTIMIZATION: Clean up progress tracking on unmount or mode change
  useEffect(() => {
    return () => {
      // Clean up progress tracking when component unmounts
      chunkProgressUpdateTimes.current.clear();
    };
  }, []);

  // Set default quick scan parameters for specific microscope types
  useEffect(() => {
    if (selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1') {
      // Set default values for Real Microscope 1
      setQuickScanParameters(prev => ({
        ...prev,
        intensity: 70,
        exposure_time: 2
      }));
    }
  }, [selectedMicroscopeId]);

  
  // Map view mode: 'FOV_FITTED' for fitted video view, 'FREE_PAN' for stage map view
  const [mapViewMode, setMapViewMode] = useState('FOV_FITTED');
  const [scaleLevel, setScaleLevel] = useState(0); // Start at highest resolution for FOV_FITTED mode
  const [zoomLevel, setZoomLevel] = useState(1.0); // Start at 100% zoom for FOV_FITTED mode
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  
  // Add state to track active zoom operations
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef(null);
  
  // New states for scan functionality
  const [isRectangleSelection, setIsRectangleSelection] = useState(false);
  const [rectangleStart, setRectangleStart] = useState(null);
  const [rectangleEnd, setRectangleEnd] = useState(null);
  const [showScanConfig, setShowScanConfig] = useState(false);
  const [isScanInProgress, setIsScanInProgress] = useState(false);
  const [scanParameters, setScanParameters] = useState({
    start_x_mm: 20,
    start_y_mm: 20,
    Nx: 5,
    Ny: 5,
    dx_mm: 0.85,
    dy_mm: 0.85,
    illumination_settings: [
      {
        channel: 'BF LED matrix full',
        intensity: 50,
        exposure_time: 100
      }
    ],
    do_contrast_autofocus: false,
    do_reflection_af: false,
    uploading: false
  });

  // Quick scan functionality states
  const [showQuickScanConfig, setShowQuickScanConfig] = useState(false);
  const [isQuickScanInProgress, setIsQuickScanInProgress] = useState(false);
  const [quickScanParameters, setQuickScanParameters] = useState({
    wellplate_type: '96',
    exposure_time: 4,
    intensity: 100,
    fps_target: 5,
    n_stripes: 3,
    stripe_width_mm: 4,
    dy_mm: 0.85,
    velocity_scan_mm_per_s: 3.0,
    do_contrast_autofocus: false,
    do_reflection_af: false,
    uploading: false
  });

  // Layer dropdown state
  const [isLayerDropdownOpen, setIsLayerDropdownOpen] = useState(false);
  const layerDropdownRef = useRef(null);

  // Annotation system state
  const [isAnnotationDropdownOpen, setIsAnnotationDropdownOpen] = useState(false);
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [currentAnnotationTool, setCurrentAnnotationTool] = useState('select');
  const [annotationStrokeColor, setAnnotationStrokeColor] = useState('#ff0000');
  const [annotationStrokeWidth, setAnnotationStrokeWidth] = useState(2);
  const [annotationFillColor, setAnnotationFillColor] = useState('transparent');
  const [annotationDescription, setAnnotationDescription] = useState('');
  const [annotations, setAnnotations] = useState([]);
  const annotationDropdownRef = useRef(null);

  // Layer visibility management (moved early to avoid dependency issues)
  const [visibleLayers, setVisibleLayers] = useState({
    wellPlate: true,
    scanResults: true,
    channels: {
      'BF LED matrix full': true,
      'Fluorescence 405 nm Ex': false,
      'Fluorescence 488 nm Ex': false,
      'Fluorescence 561 nm Ex': false,
      'Fluorescence 638 nm Ex': false,
      'Fluorescence 730 nm Ex': false
    }
  });

  // Layer management state (moved early to avoid hoisting issues)
  const [layers, setLayers] = useState([
    {
      id: 'well-plate',
      name: '96-Well Plate Grid',
      type: 'plate-view',
      visible: true, // Will be synced with visibleLayers.wellPlate
      channels: [],
      readonly: true
    },
    {
      id: 'microscope-control',
      name: 'Microscope Control',
      type: 'microscope-control',
      visible: true, // Default activated
      channels: [],
      readonly: true
    }
  ]);
  const [expandedLayers, setExpandedLayers] = useState({});

  // Helper functions for layer-driven data loading (moved early to avoid hoisting issues)
  const getVisibleLayersByType = useCallback((type) => {
    return layers.filter(layer => layer.type === type && layer.visible);
  }, [layers]);

  const isLayerTypeVisible = useCallback((type) => {
    return layers.some(layer => layer.type === type && layer.visible);
  }, [layers]);

  const getBrowseDataLayer = useCallback(() => {
    return layers.find(layer => layer.type === 'load-server' && layer.visible);
  }, [layers]);

  const getScanDataLayer = useCallback(() => {
    return layers.find(layer => (layer.type === 'quick-scan' || layer.type === 'normal-scan') && layer.visible);
  }, [layers]);

  // Sync layers visibility with visibleLayers (moved early to avoid hoisting issues)
  useEffect(() => {
    setLayers(prev => prev.map(layer => 
      layer.id === 'well-plate'
        ? { ...layer, visible: visibleLayers.wellPlate }
        : layer
    ));
  }, [visibleLayers.wellPlate]);

  // Update hardware locked state when microscope control layer visibility changes
  useEffect(() => {
    const microscopeControlLayer = layers.find(layer => layer.id === 'microscope-control');
    if (microscopeControlLayer) {
      setIsHardwareLocked(!microscopeControlLayer.visible);
    }
  }, [layers]);


  // Tile-based canvas state (replacing single stitchedCanvasData)
  const [stitchedTiles, setStitchedTiles] = useState([]); // Array of tile objects
  const [isLoadingCanvas, setIsLoadingCanvas] = useState(false);
  const [needsTileReload, setNeedsTileReload] = useState(false); // Flag to trigger tile loading after refresh
  const canvasUpdateTimerRef = useRef(null);
  const activeTileRequestsRef = useRef(new Set()); // Track active requests to prevent duplicates
  const chunkProgressUpdateTimes = useRef(new Map()); // Track last update time for each well to throttle progress updates
  const lastTileLoadAttemptRef = useRef(0); // Track last tile load attempt to prevent excessive retries

  // Multi-channel state management for zarr data (defined early to avoid hoisting issues)
  const [zarrChannelConfigs, setZarrChannelConfigs] = useState({});
  const [availableZarrChannels, setAvailableZarrChannels] = useState([]);
  const [isMultiChannelMode, setIsMultiChannelMode] = useState(false);

  // Real microscope channel configs for min/max contrast - now per-layer
  const [realMicroscopeChannelConfigs, setRealMicroscopeChannelConfigs] = useState({});
  
  // Per-layer contrast settings - each layer maintains its own contrast independently
  const [layerContrastSettings, setLayerContrastSettings] = useState({});

  // Add state for historical data mode
  const [isHistoricalDataMode, setIsHistoricalDataMode] = useState(false);

  // Add state for real-time chunk loading progress
  const [realTimeChunkProgress, setRealTimeChunkProgress] = useState(new Map());
  const [realTimeWellProgress, setRealTimeWellProgress] = useState(new Map());
  const [isRealTimeLoading, setIsRealTimeLoading] = useState(false);

  // Hardware locked state - when microscope control layer is deactivated
  const [isHardwareLocked, setIsHardwareLocked] = useState(false);

  // Function to refresh scan results (moved early to avoid dependency issues)
  const refreshScanResults = useCallback(() => {
    if (visibleLayers.scanResults && !isSimulatedMicroscope) {
      // Clear active requests to prevent conflicts
      activeTileRequestsRef.current.clear();
      
      if (appendLog) {
        appendLog('Refreshing scan results display - direct replacement');
      }
      
      // Set flag to trigger tile loading - loadStitchedTiles will be called by the effect
      setNeedsTileReload(true);
    }
  }, [appendLog, isSimulatedMicroscope]); // Removed visibleLayers.scanResults to prevent triggering on layer toggles

  // Initialize experiment zarr manager hook
  const experimentManager = useExperimentZarrManager({
    microscopeControlService,
    isSimulatedMicroscope,
    showNotification,
    appendLog,
    onExperimentChange: (data) => {
      // Handle experiment changes if needed
      if (data.activeExperiment && visibleLayers.scanResults) {
        setTimeout(() => {
          refreshScanResults();
        }, 100);
      }
      // Refresh canvas view to show new experiment data
      setTimeout(() => {
        refreshCanvasView();
      }, 200);
    },
    onExperimentReset: (experimentName) => {
      // Handle experiment reset - clear stitched tiles and active requests
      setStitchedTiles([]);
      activeTileRequestsRef.current.clear();
    }
  });

  // Well selection state for scanning
  const [selectedWells, setSelectedWells] = useState([]); // Start with no wells selected
  const [wellPlateType, setWellPlateType] = useState('96'); // Default to 96-well
  const [wellPaddingMm] = useState(1.0); // Default padding

  // Helper function to get well plate configuration
  const getWellPlateConfig = useCallback(() => {
    if (!microscopeConfiguration?.wellplate?.formats) return null;
    
    const formatKey = wellPlateType === '96' ? '96_well' : 
                     wellPlateType === '48' ? '48_well' : 
                     wellPlateType === '24' ? '24_well' : '96_well';
    
    return microscopeConfiguration.wellplate.formats[formatKey];
  }, [microscopeConfiguration, wellPlateType]);

  // Helper function to get well plate layout
  const getWellPlateLayout = useCallback(() => {
    const layouts = {
      '96': { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], cols: Array.from({ length: 12 }, (_, i) => i + 1) },
      '48': { rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: Array.from({ length: 8 }, (_, i) => i + 1) },
      '24': { rows: ['A', 'B', 'C', 'D'], cols: Array.from({ length: 6 }, (_, i) => i + 1) }
    };
    return layouts[wellPlateType] || layouts['96'];
  }, [wellPlateType]);

  // Helper function to get selected channels for API calls
  const getSelectedChannels = useCallback(() => {
    const selectedChannels = Object.entries(visibleLayers.channels)
      .filter(([, isVisible]) => isVisible)
      .map(([channelName]) => channelName);
    
    // Ensure at least one channel is selected
    if (selectedChannels.length === 0) {
      return ['BF LED matrix full']; // Default to brightfield
    }
    
    return selectedChannels;
  }, [visibleLayers.channels]);

  // Helper function to check if any channels are selected
  const hasSelectedChannels = useCallback(() => {
    return Object.values(visibleLayers.channels).some(isVisible => isVisible);
  }, [visibleLayers.channels]);

  // Helper function to get channel string for API calls
  const getChannelString = useCallback(() => {
    const selectedChannels = getSelectedChannels();
    return selectedChannels.join(',');
  }, [getSelectedChannels]);

  // Helper functions for zarr multi-channel management
  const getEnabledZarrChannels = useCallback(() => {
    return Object.entries(zarrChannelConfigs)
      .filter(([, config]) => config.enabled)
      .map(([channelName, config]) => ({ channelName, ...config }));
  }, [zarrChannelConfigs]);


  const updateZarrChannelConfig = useCallback((channelName, updates) => {
    setZarrChannelConfigs(prev => ({
      ...prev,
      [channelName]: {
        ...prev[channelName],
        ...updates
      }
    }));
  }, []);

  // Effect to refresh tiles when zarr channel contrast settings change in browse data layer
  useEffect(() => {
    const browseDataLayer = getBrowseDataLayer();
    if (browseDataLayer && mapViewMode === 'FREE_PAN') {
      console.log('🎨 BROWSE DATA: Zarr channel configs changed, triggering tile refresh');
      
      // Don't clear tiles if real-time loading is in progress
      const hasActiveRequests = activeTileRequestsRef.current.size > 0;
      if (currentOperation === null && !hasActiveRequests) {
        // Clear active requests to prevent conflicts
        activeTileRequestsRef.current.clear();
        
        console.log('🎨 BROWSE DATA: Refreshing tiles with updated contrast settings');
        console.log('🎨 BROWSE DATA: Current zarrChannelConfigs:', zarrChannelConfigs);
        console.log('🎨 BROWSE DATA: Enabled channels:', getEnabledZarrChannels());
        
        // Set flag to trigger tile loading - loadStitchedTiles will be called by the effect
        setNeedsTileReload(true);
      } else {
        console.log('🎨 BROWSE DATA: Skipping tile refresh - real-time loading in progress or operation active');
      }
    }
  }, [zarrChannelConfigs, getBrowseDataLayer, mapViewMode, currentOperation]);

  const updateRealMicroscopeChannelConfig = useCallback((channelName, updates) => {
    console.log(`🎨 MicroscopeMapDisplay: updateRealMicroscopeChannelConfig called for ${channelName} with updates:`, updates);
    setRealMicroscopeChannelConfigs(prev => {
      const newConfig = {
        ...prev,
        [channelName]: {
          min: 0,
          max: 255,
          ...prev[channelName],
          ...updates
        }
      };
      console.log(`🎨 MicroscopeMapDisplay: Updated config for ${channelName}:`, newConfig[channelName]);
      console.log(`🎨 MicroscopeMapDisplay: Full new config:`, newConfig);
      return newConfig;
    });
  }, []);

  // Per-layer contrast management functions
  const updateLayerContrastSettings = useCallback((layerId, updates) => {
    console.log(`🎨 MicroscopeMapDisplay: updateLayerContrastSettings called for layer ${layerId} with updates:`, updates);
    setLayerContrastSettings(prev => ({
      ...prev,
      [layerId]: {
        ...prev[layerId],
        ...updates
      }
    }));
  }, []);

  const getLayerContrastSettings = useCallback((layerId) => {
    return layerContrastSettings[layerId] || { min: 0, max: 255 };
  }, [layerContrastSettings]);

  const initializeZarrChannelsFromMetadata = useCallback((channelMetadata) => {
    if (!channelMetadata || !channelMetadata.activeChannels) return;
    
    const newConfigs = {};
    channelMetadata.activeChannels.forEach(channel => {
      newConfigs[channel.label] = {
        enabled: true, // Auto-enable all active channels as requested
        min: channel.window.start,
        max: channel.window.end,
        color: channel.color,
        index: channel.index,
        coefficient: channel.coefficient,
        family: channel.family
      };
    });
    
    console.log(`🎨 Initialized ${Object.keys(newConfigs).length} zarr channels:`, Object.keys(newConfigs));
    setZarrChannelConfigs(newConfigs);
    setAvailableZarrChannels(channelMetadata.activeChannels);
    setIsMultiChannelMode(Object.keys(newConfigs).length > 1);
  }, []);

  const shouldUseMultiChannelLoading = useCallback(() => {
    // For browse data layer: use zarr channels
    const browseDataLayer = getBrowseDataLayer();
    if (browseDataLayer) {
      return availableZarrChannels.length > 0 && 
             Object.values(zarrChannelConfigs).some(config => config.enabled);
    }
    // For scan data layer: use visibleLayers.channels
    // Let the microscope service handle channel merging
    const scanDataLayer = getScanDataLayer();
    return scanDataLayer && !isSimulatedMicroscope && 
           Object.values(visibleLayers.channels).some(isVisible => isVisible);
  }, [getBrowseDataLayer, getScanDataLayer, availableZarrChannels.length, zarrChannelConfigs, isSimulatedMicroscope, visibleLayers.channels]);

  // State to track the well being selected during drag operations
  const [dragSelectedWell, setDragSelectedWell] = useState(null);
  
  // 🚀 REQUEST CANCELLATION: Track cancellable requests
  const [currentCancellableRequest, setCurrentCancellableRequest] = useState(null);
  const [lastRequestKey, setLastRequestKey] = useState(null);

  // Well information mapping for annotations
  const [annotationWellMap, setAnnotationWellMap] = useState({});
  
  // Embedding status tracking
  const [embeddingStatus, setEmbeddingStatus] = useState({}); // Track embedding status per annotation

  const handleImportAnnotations = useCallback((importedAnnotations) => {
    setAnnotations(importedAnnotations);
    if (appendLog) {
      appendLog(`Imported ${importedAnnotations.length} annotations`);
    }
  }, [appendLog]);

  // Helper function to render real-time loading progress
  const renderRealTimeProgress = useCallback(() => {
    if (!isRealTimeLoading || realTimeChunkProgress.size === 0) return null;
    
    const totalChunks = Array.from(realTimeChunkProgress.values()).reduce((sum, p) => sum + p.totalChunks, 0);
    const loadedChunks = Array.from(realTimeChunkProgress.values()).reduce((sum, p) => sum + p.loadedChunks, 0);
    
    return (
      <div className="real-time-progress-overlay" style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        background: 'rgba(0, 0, 0, 0.8)',
        padding: '8px',
        borderRadius: '4px',
        zIndex: 1000,
        width: '120px'
      }}>
        <div style={{ 
          color: 'white', 
          fontSize: '11px', 
          textAlign: 'center', 
          marginBottom: '4px',
          fontFamily: 'monospace'
        }}>
          {loadedChunks}/{totalChunks}
        </div>
        <div style={{ 
          width: '100%', 
          height: '6px', 
          background: '#333', 
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${(loadedChunks / totalChunks) * 100}%`,
            height: '100%',
            background: '#4CAF50',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>
    );
  }, [isRealTimeLoading, realTimeChunkProgress]);

  // Helper function to detect which well a stage coordinate belongs to
  const detectWellFromStageCoords = useCallback((stageX, stageY) => {
    const wellConfig = getWellPlateConfig();
    if (!wellConfig) return null;
    
    const { well_size_mm, well_spacing_mm, a1_x_mm, a1_y_mm } = wellConfig;
    const layout = getWellPlateLayout();
    const { rows, cols } = layout;
    
    // Find the closest well by checking distance to each well center
    let closestWell = null;
    let minDistance = Infinity;
    
    rows.forEach((row, rowIndex) => {
      cols.forEach((col, colIndex) => {
        const wellId = `${row}${col}`;
        const wellCenterX = a1_x_mm + colIndex * well_spacing_mm;
        const wellCenterY = a1_y_mm + rowIndex * well_spacing_mm;
        
        // Check if point is within well boundaries (considering well padding)
        const wellRadius = (well_size_mm / 2) + wellPaddingMm;
        const distance = Math.sqrt(
          Math.pow(stageX - wellCenterX, 2) + Math.pow(stageY - wellCenterY, 2)
        );
        
        if (distance <= wellRadius && distance < minDistance) {
          minDistance = distance;
          closestWell = {
            id: wellId,
            centerX: wellCenterX,
            centerY: wellCenterY,
            rowIndex,
            colIndex,
            radius: wellRadius
          };
        }
      });
    });
    
    return closestWell;
  }, [getWellPlateConfig, getWellPlateLayout, wellPaddingMm]);

  // Detect well for annotation and update mapping
  const detectWellForAnnotation = useCallback((annotation) => {
    // Use the first point to determine which well the annotation belongs to
    if (annotation.points && annotation.points.length > 0) {
      const firstPoint = annotation.points[0];
      const wellInfo = detectWellFromStageCoords(firstPoint.x, firstPoint.y);
      
      if (wellInfo) {
        setAnnotationWellMap(prev => ({
          ...prev,
          [annotation.id]: wellInfo
        }));
        
        if (appendLog) {
          appendLog(`Annotation ${annotation.type} assigned to well ${wellInfo.id}`);
        }
      } else {
        console.warn(`Could not detect well for annotation at (${firstPoint.x}, ${firstPoint.y})`);
      }
    }
  }, [detectWellFromStageCoords, appendLog]);

  // Annotation handlers
  const handleAnnotationAdd = useCallback(async (annotation) => {
    setAnnotations(prev => [...prev, annotation]);
    
    // Detect well for the new annotation
    detectWellForAnnotation(annotation);
    
    if (appendLog) {
      appendLog(`Added ${annotation.type} annotation at (${annotation.points[0].x.toFixed(2)}, ${annotation.points[0].y.toFixed(2)}) mm`);
    }

    // Automatically generate embeddings for rectangle, polygon, and freehand annotations
    if (annotation.type === 'rectangle' || annotation.type === 'polygon' || annotation.type === 'freehand') {
      try {
        // Set embedding status to generating
        setEmbeddingStatus(prev => ({
          ...prev,
          [annotation.id]: { status: 'generating', error: null }
        }));

        if (appendLog) {
          appendLog(`Generating embeddings for ${annotation.type} annotation...`);
        }

        // Get the microscope view canvas (the main canvas showing the map)
        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Microscope view canvas not found');
        }

        // Calculate mapScale inside the function to avoid hoisting issues
        const currentMapScale = mapViewMode === 'FOV_FITTED' ? autoFittedScale : calculatedMapScale;

        // Generate embeddings
        const embeddings = await generateAnnotationEmbeddings(
          canvas,
          annotation,
          currentMapScale,
          mapPan,
          stageDimensions,
          pixelsPerMm
        );

        // Update annotation with embeddings
        setAnnotations(prev => 
          prev.map(ann => 
            ann.id === annotation.id 
              ? { ...ann, embeddings }
              : ann
          )
        );

        // Set embedding status to completed
        setEmbeddingStatus(prev => ({
          ...prev,
          [annotation.id]: { status: 'completed', error: null }
        }));

        if (appendLog) {
          appendLog(`Embeddings generated successfully for ${annotation.type} annotation`);
        }

      } catch (error) {
        console.error('Error generating embeddings:', error);
        
        // Set embedding status to error
        setEmbeddingStatus(prev => ({
          ...prev,
          [annotation.id]: { status: 'error', error: error.message }
        }));

        if (appendLog) {
          appendLog(`Failed to generate embeddings: ${error.message}`);
        }
      }
    }
  }, [appendLog, detectWellForAnnotation, mapPan, canvasRef]);

  const handleAnnotationUpdate = useCallback((id, updates) => {
    setAnnotations(prev => 
      prev.map(ann => ann.id === id ? { ...ann, ...updates } : ann)
    );
    
    // Re-detect well if annotation was moved
    if (updates.points) {
      const updatedAnnotation = annotations.find(ann => ann.id === id);
      if (updatedAnnotation) {
        const updatedWithNewPoints = { ...updatedAnnotation, ...updates };
        detectWellForAnnotation(updatedWithNewPoints);
      }
    }
  }, [annotations, detectWellForAnnotation]);

  const handleAnnotationDelete = useCallback((id) => {
    setAnnotations(prev => prev.filter(ann => ann.id !== id));
    
    // Remove from well mapping
    setAnnotationWellMap(prev => {
      const newMap = { ...prev };
      delete newMap[id];
      return newMap;
    });
    
    if (appendLog) {
      appendLog(`Deleted annotation`);
    }
  }, [appendLog]);

  const handleClearAllAnnotations = useCallback(() => {
    setAnnotations([]);
    setAnnotationWellMap({});
    if (appendLog) {
      appendLog(`Cleared all annotations (${annotations.length} removed)`);
    }
  }, [appendLog, annotations.length]);

  const handleExportAnnotations = useCallback(() => {
    if (appendLog) {
      appendLog(`Exported ${annotations.length} annotations`);
    }
  }, [appendLog, annotations.length]);

  // Helper function to get well boundaries in stage coordinates
  const getWellBoundaries = useCallback((wellInfo) => {
    if (!wellInfo) return null;
    
    const { centerX, centerY, radius } = wellInfo;
    return {
      xMin: centerX - radius,
      xMax: centerX + radius,
      yMin: centerY - radius,
      yMax: centerY + radius,
      centerX,
      centerY
    };
  }, []);

  // Helper function to clamp coordinates to well boundaries
  const clampToWellBoundaries = useCallback((stageX, stageY, wellBoundaries) => {
    if (!wellBoundaries) return { x: stageX, y: stageY };
    
    return {
      x: Math.max(wellBoundaries.xMin, Math.min(wellBoundaries.xMax, stageX)),
      y: Math.max(wellBoundaries.yMin, Math.min(wellBoundaries.yMax, stageY))
    };
  }, []);

  // Helper function to convert absolute stage coordinates to relative (well-centered) coordinates
  const stageToRelativeCoords = useCallback((stageX, stageY, wellInfo) => {
    if (!wellInfo) return { x: stageX, y: stageY };
    
    return {
      x: stageX - wellInfo.centerX,
      y: stageY - wellInfo.centerY
    };
  }, []);

  // Extract functions from experiment manager
  const {
    experiments,
    activeExperiment,
    isLoadingExperiments,
    showCreateExperimentDialog,
    setShowCreateExperimentDialog,
    newExperimentName,
    setNewExperimentName,
    experimentInfo,
    showClearCanvasConfirmation,
    setShowClearCanvasConfirmation,
    experimentToReset,
    setExperimentToReset,
    showDeleteConfirmation,
    setShowDeleteConfirmation,
    experimentToDelete,
    setExperimentToDelete,
    loadExperiments,
    createExperiment,
    setActiveExperimentHandler,
    removeExperiment,
    getExperimentInfo,
    handleResetExperiment,
    handleDeleteExperiment,
    renderDialogs,
  } = experimentManager;

  // Multi-layer experiment visibility state
  const [visibleExperiments, setVisibleExperiments] = useState([]);

  // Auto-show active experiment when it changes (backwards compatibility)
  useEffect(() => {
    if (activeExperiment && !visibleExperiments.includes(activeExperiment)) {
      setVisibleExperiments(prev => [...prev, activeExperiment]);
    }
  }, [activeExperiment, visibleExperiments]);


  // Calculate stage dimensions from configuration (moved early to avoid dependency issues)
  const stageDimensions = useMemo(() => {
    if (!microscopeConfiguration?.limits?.software_pos_limit) {
      return { width: 100, height: 70 }; // Default dimensions in mm
    }
    const limits = microscopeConfiguration.limits.software_pos_limit;
    const width = limits.x_positive - limits.x_negative;
    const height = limits.y_positive - limits.y_negative;
    return { 
      width, 
      height,
      xMin: limits.x_negative,
      xMax: limits.x_positive,
      yMin: limits.y_negative || 0,
      yMax: limits.y_positive
    };
  }, [microscopeConfiguration]);

  // Calculate dynamic bounds for scan parameters based on microscope configuration
  const scanBounds = useMemo(() => {
    if (!stageDimensions || !microscopeConfiguration?.limits?.software_pos_limit) {
      return {
        xMin: 0, xMax: 200,
        yMin: 0, yMax: 100
      };
    }
    return {
      xMin: stageDimensions.xMin,
      xMax: stageDimensions.xMax,
      yMin: stageDimensions.yMin,
      yMax: stageDimensions.yMax
    };
  }, [stageDimensions, microscopeConfiguration]);

  // Custom validation function for start positions that considers grid end position
  const validateStartPosition = useCallback((value, isX = true) => {
    const currentScanParams = scanParameters;
    const endPosition = isX 
      ? value + (currentScanParams.Nx - 1) * currentScanParams.dx_mm
      : value + (currentScanParams.Ny - 1) * currentScanParams.dy_mm;
    
    const maxAllowed = isX ? scanBounds.xMax : scanBounds.yMax;
    const minAllowed = isX ? scanBounds.xMin : scanBounds.yMin;
    
    if (value < minAllowed) {
      return { isValid: false, value: null, error: `Start position must be at least ${minAllowed.toFixed(1)} mm` };
    }
    
    if (endPosition > maxAllowed) {
      const maxStartForGrid = maxAllowed - (isX ? (currentScanParams.Nx - 1) * currentScanParams.dx_mm : (currentScanParams.Ny - 1) * currentScanParams.dy_mm);
      return { 
        isValid: false, 
        value: null, 
        error: `Grid extends beyond stage limit. Max start position: ${maxStartForGrid.toFixed(1)} mm` 
      };
    }
    
    return { isValid: true, value: value, error: null };
  }, [scanParameters, scanBounds]);

  // Custom validation function for grid size that considers current start position
  const validateGridSize = useCallback((value, isNx = true) => {
    const currentScanParams = scanParameters;
    const startPos = isNx ? currentScanParams.start_x_mm : currentScanParams.start_y_mm;
    const stepSize = isNx ? currentScanParams.dx_mm : currentScanParams.dy_mm;
    const endPosition = startPos + (value - 1) * stepSize;
    
    const maxAllowed = isNx ? scanBounds.xMax : scanBounds.yMax;
    
    if (value < 1) {
      return { isValid: false, value: null, error: 'Grid size must be at least 1' };
    }
    
    if (endPosition > maxAllowed) {
      const maxGridSize = Math.floor((maxAllowed - startPos) / stepSize) + 1;
      return { 
        isValid: false, 
        value: null, 
        error: `Grid too large. Max size: ${maxGridSize} positions` 
      };
    }
    
    return { isValid: true, value: value, error: null };
  }, [scanParameters, scanBounds]);

  // Validation hooks for scan parameters with "Enter to confirm" behavior
  const startXInput = useValidatedNumberInput(
    scanParameters.start_x_mm,
    (value) => setScanParameters(prev => ({ ...prev, start_x_mm: value })),
    { 
      min: scanBounds.xMin, 
      max: scanBounds.xMax, 
      allowFloat: true,
      customValidation: (value) => validateStartPosition(value, true)
    },
    showNotification
  );

  const startYInput = useValidatedNumberInput(
    scanParameters.start_y_mm,
    (value) => setScanParameters(prev => ({ ...prev, start_y_mm: value })),
    { 
      min: scanBounds.yMin, 
      max: scanBounds.yMax, 
      allowFloat: true,
      customValidation: (value) => validateStartPosition(value, false)
    },
    showNotification
  );

  const nxInput = useValidatedNumberInput(
    scanParameters.Nx,
    (value) => setScanParameters(prev => ({ ...prev, Nx: value })),
    { 
      min: 1, 
      max: 50, 
      allowFloat: false,
      customValidation: (value) => validateGridSize(value, true)
    },
    showNotification
  );

  const nyInput = useValidatedNumberInput(
    scanParameters.Ny,
    (value) => setScanParameters(prev => ({ ...prev, Ny: value })),
    { 
      min: 1, 
      max: 50, 
      allowFloat: false,
      customValidation: (value) => validateGridSize(value, false)
    },
    showNotification
  );

  const dxInput = useValidatedNumberInput(
    scanParameters.dx_mm,
    (value) => setScanParameters(prev => ({ ...prev, dx_mm: value })),
    { min: 0.01, max: 10, allowFloat: true },
    showNotification
  );

  const dyInput = useValidatedNumberInput(
    scanParameters.dy_mm,
    (value) => setScanParameters(prev => ({ ...prev, dy_mm: value })),
    { min: 0.01, max: 10, allowFloat: true },
    showNotification
  );



  // Validation hooks for quick scan parameters with "Enter to confirm" behavior
  const quickExposureInput = useValidatedNumberInput(
    quickScanParameters.exposure_time,
    (value) => setQuickScanParameters(prev => ({ ...prev, exposure_time: value })),
    { min: 1, max: 30, allowFloat: true },
    showNotification
  );

  const quickIntensityInput = useValidatedNumberInput(
    quickScanParameters.intensity,
    (value) => setQuickScanParameters(prev => ({ ...prev, intensity: value })),
    { min: 1, max: 100, allowFloat: false },
    showNotification
  );

  const quickFpsInput = useValidatedNumberInput(
    quickScanParameters.fps_target,
    (value) => setQuickScanParameters(prev => ({ ...prev, fps_target: value })),
    { min: 1, max: 60, allowFloat: false },
    showNotification
  );

  const quickStripesInput = useValidatedNumberInput(
    quickScanParameters.n_stripes,
    (value) => setQuickScanParameters(prev => ({ ...prev, n_stripes: value })),
    { min: 1, max: 10, allowFloat: false },
    showNotification
  );

  const quickStripeWidthInput = useValidatedNumberInput(
    quickScanParameters.stripe_width_mm,
    (value) => setQuickScanParameters(prev => ({ ...prev, stripe_width_mm: value })),
    { min: 0.5, max: 10.0, allowFloat: true },
    showNotification
  );

  const quickDyInput = useValidatedNumberInput(
    quickScanParameters.dy_mm,
    (value) => setQuickScanParameters(prev => ({ ...prev, dy_mm: value })),
    { min: 0.1, max: 5.0, allowFloat: true },
    showNotification
  );

  const quickVelocityInput = useValidatedNumberInput(
    quickScanParameters.velocity_scan_mm_per_s,
    (value) => setQuickScanParameters(prev => ({ ...prev, velocity_scan_mm_per_s: value })),
    { min: 1, max: 30, allowFloat: true },
    showNotification
  );
  
  // Calculate pixelsPerMm from microscope configuration
  const pixelsPerMm = useMemo(() => {
    if (!microscopeConfiguration?.optics?.calculated_pixel_size_mm || !microscopeConfiguration?.acquisition?.crop_width) {
      return 10; // Fallback to original hardcoded value
    }
    
    const calculatedPixelSizeMm = microscopeConfiguration.optics.calculated_pixel_size_mm;
    const cropWidth = microscopeConfiguration.acquisition.crop_width;
    const displayWidth = 750; // Video frame display size
    
    // Calculate actual pixel size for the display window
    // calculated_pixel_size_mm is for the full crop, scale it for display
    const actualPixelSizeMm = calculatedPixelSizeMm * (cropWidth / displayWidth);
    
    // Convert to pixels per mm
    return 1 / actualPixelSizeMm;
  }, [microscopeConfiguration]);

  // Calculate FOV size from microscope configuration
  const fovSize = useMemo(() => {
    if (!microscopeConfiguration?.optics?.calculated_pixel_size_mm || !microscopeConfiguration?.acquisition?.crop_width) {
      return 0.5; // Fallback for 40x objective
    }
    
    const calculatedPixelSizeMm = microscopeConfiguration.optics.calculated_pixel_size_mm;
    const cropWidth = microscopeConfiguration.acquisition.crop_width;
    const displayWidth = 750; // Video frame display size
    
    // Calculate FOV: display_width_pixels * pixel_size_mm
    const actualPixelSizeMm = calculatedPixelSizeMm * (cropWidth / displayWidth);
    return displayWidth * actualPixelSizeMm;
  }, [microscopeConfiguration]);

  // Track container dimensions for memoized calculations
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  // Get current stage position from metadata or fallback
  const currentStagePosition = useMemo(() => {
    // Prefer WebRTC metadata when available
    if (frameMetadata?.stage_position &&
        typeof frameMetadata.stage_position.x_mm === 'number' &&
        typeof frameMetadata.stage_position.y_mm === 'number' &&
        typeof frameMetadata.stage_position.z_mm === 'number') {
      return {
        x: frameMetadata.stage_position.x_mm,
        y: frameMetadata.stage_position.y_mm,
        z: frameMetadata.stage_position.z_mm
      };
    }
    
    // Fallback to status data when WebRTC is not active
    if (fallbackStagePosition && 
        typeof fallbackStagePosition.x === 'number' && 
        typeof fallbackStagePosition.y === 'number' && 
        typeof fallbackStagePosition.z === 'number') {
      return {
        x: fallbackStagePosition.x,
        y: fallbackStagePosition.y,
        z: fallbackStagePosition.z
      };
    }
    
    return null;
  }, [frameMetadata, fallbackStagePosition]);

  // In FOV_FITTED mode, automatically calculate scale and pan to fit video in the display
  // In FREE_PAN mode, use manual scale and pan controls
  // Scale levels: 0=1x, 1=0.25x, 2=0.0625x, 3=0.015625x, 4=0.00390625x (4x difference between levels)
  // Zoom range: 25% to 6400% (0.25x to 64x) within each scale level - increased to allow scale level transitions
  const baseScale = 1 / Math.pow(4, scaleLevel);
  const calculatedMapScale = baseScale * zoomLevel;
  
  // Auto-calculate scale and pan for FOV_FITTED mode
  const autoFittedScale = useMemo(() => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) return 1;
    
    // In FOV_FITTED mode, we want the FOV box to always appear as a consistent size
    // representing the video display area, regardless of microscope configuration loading
    const containerWidth = containerDimensions.width;
    const containerHeight = containerDimensions.height;
    
    // Use a fixed FOV display size that represents the video window
    // This should be consistent regardless of whether config is loaded
    const videoDisplaySize = Math.min(containerWidth, containerHeight) * 0.8; // 80% of container
    
    // If we have real configuration data, use it for accurate scaling
    if (currentStagePosition && stageDimensions && fovSize && pixelsPerMm > 0) {
      const fovPixelWidth = fovSize * pixelsPerMm;
      const fovPixelHeight = fovSize * pixelsPerMm;
      
      // Scale to fit FOV comfortably in the container
      const scaleX = containerWidth / (fovPixelWidth * 1.2);
      const scaleY = containerHeight / (fovPixelHeight * 1.2);
      return Math.min(scaleX, scaleY);
    }
    
    // Fallback: ensure a reasonable scale that shows a fixed-size FOV box
    // This prevents the "jumping" by providing a consistent fallback
    return videoDisplaySize / 400; // Assume 400px default FOV size
  }, [containerDimensions, currentStagePosition, stageDimensions, fovSize, pixelsPerMm]);
  
  const autoFittedPan = useMemo(() => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) return { x: 0, y: 0 };
    
    // Always center the FOV in the container for FOV_FITTED mode
    const containerWidth = containerDimensions.width;
    const containerHeight = containerDimensions.height;
    
    // If we have real position data, center based on actual stage position
    if (currentStagePosition && stageDimensions && autoFittedScale) {
      const stagePosX = (currentStagePosition.x - stageDimensions.xMin) * pixelsPerMm * autoFittedScale;
      const stagePosY = (currentStagePosition.y - stageDimensions.yMin) * pixelsPerMm * autoFittedScale;
      
      return {
        x: containerWidth / 2 - stagePosX,
        y: containerHeight / 2 - stagePosY
      };
    }
    
    // Fallback: center the FOV box in the container
    // This prevents jumping by always centering the FOV display
    return {
      x: containerWidth / 2,
      y: containerHeight / 2
    };
  }, [containerDimensions, currentStagePosition, stageDimensions, pixelsPerMm, autoFittedScale]);
  
  // Use fitted values in FOV_FITTED mode, manual values in FREE_PAN mode
  const mapScale = mapViewMode === 'FOV_FITTED' ? autoFittedScale : calculatedMapScale;
  const effectivePan = mapViewMode === 'FOV_FITTED' ? autoFittedPan : mapPan;

  // Calculate video frame position on the map
  const videoFramePosition = useMemo(() => {
    if (containerDimensions.width === 0 || containerDimensions.height === 0) return null;
    
         // In FOV_FITTED mode, always show a centered FOV box representing the video display
     if (mapViewMode === 'FOV_FITTED') {
       const containerWidth = containerDimensions.width;
       const containerHeight = containerDimensions.height;
       
       // Fixed FOV box size for consistent video display representation
       const videoDisplaySize = Math.min(containerWidth, containerHeight) * 0.9; // 90% of container to better fill the space
      
      return {
        x: containerWidth / 2,
        y: containerHeight / 2,
        width: videoDisplaySize,
        height: videoDisplaySize
      };
    }
    
    // In FREE_PAN mode, calculate based on actual stage position and configuration
    if (!currentStagePosition || !stageDimensions) {
      return null;
    }
    
    // Video frame is 750x750 pixels representing the calculated FOV in mm
    // Coordinate system: (0,0) is upper-left corner
    return {
      x: (currentStagePosition.x - stageDimensions.xMin) * pixelsPerMm * mapScale + effectivePan.x,
      y: (currentStagePosition.y - stageDimensions.yMin) * pixelsPerMm * mapScale + effectivePan.y,
      width: fovSize * pixelsPerMm * mapScale,
      height: fovSize * pixelsPerMm * mapScale
    };
  }, [containerDimensions, mapViewMode, currentStagePosition, stageDimensions, mapScale, effectivePan, fovSize, pixelsPerMm]);

  // Split interaction controls: hardware vs map browsing, exclude simulated microscope in historical mode
  const isHardwareInteractionDisabled = (isHistoricalDataMode && !(isSimulatedMicroscope && isHistoricalDataMode)) || microscopeBusy || currentOperation !== null || isScanInProgress || isQuickScanInProgress || isDrawingMode || isHardwareLocked;
  const isMapBrowsingDisabled = false; // Allow map browsing - annotation canvas will handle its own interactions
  
  // Legacy compatibility - some UI elements still use the general disabled state
  const isInteractionDisabled = isHardwareInteractionDisabled;

  // Handle panning (only in FREE_PAN mode)
  const handleMapPanning = (e) => {
    if (mapViewMode !== 'FREE_PAN' || isDrawingMode) return;
    
    // During active scanning, disable rectangle selection to allow map browsing
    if (isRectangleSelection && !isScanInProgress && !isQuickScanInProgress) {
      handleRectangleSelectionStart(e);
      return;
    }
    
    if (e.button === 0) { // Left click
      setIsPanning(true);
      setPanStart({ x: e.clientX - mapPan.x, y: e.clientY - mapPan.y });
    }
  };

  const handleMapPanMove = (e) => {
    // During active scanning, disable rectangle selection to allow map browsing
    if (isRectangleSelection && rectangleStart && !isScanInProgress && !isQuickScanInProgress) {
      handleRectangleSelectionMove(e);
      return;
    }
    
    if (isPanning && mapViewMode === 'FREE_PAN' && !isDrawingMode) {
      // Cancel any pending tile loads during active panning
      if (canvasUpdateTimerRef.current) {
        clearTimeout(canvasUpdateTimerRef.current);
      }
      
      setMapPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMapPanEnd = () => {
    // During active scanning, disable rectangle selection to allow map browsing
    if (isRectangleSelection && rectangleStart && !isScanInProgress && !isQuickScanInProgress) {
      handleRectangleSelectionEnd();
      return;
    }
    
    if (isDrawingMode) {
      setIsPanning(false);
      return;
    }
    
    // Set isPanning to false after a small delay to ensure operation is truly complete
    setTimeout(() => {
      setIsPanning(false);
    }, 100); // Small delay to ensure pan operation is complete
  };
  
  // Switch to FREE_PAN mode when zooming out in FOV_FITTED mode
  const transitionToFreePan = useCallback(() => {
    if (mapViewMode === 'FOV_FITTED') {
      setMapViewMode('FREE_PAN');
      
      // Trigger auto-collapse on FREE_PAN transition
      if (onFreePanAutoCollapse) {
        const shouldCollapseRightPanel = onFreePanAutoCollapse();
        if (shouldCollapseRightPanel && appendLog) {
          appendLog('Auto-collapsed sidebar and right panel for FREE_PAN mode');
        }
      }
      
      // Start at higher scale level to avoid loading huge high-resolution data
      // Calculate appropriate scale level based on fitted scale to bias towards lower resolution
      const baseEffectiveScale = autoFittedScale; // Base scale from FOV_FITTED mode
      
      let initialScaleLevel = 1; // Default to scale 1
      let initialZoomLevel;
      
      // MAXIMUM bias towards higher scale levels (lower resolution) - extremely hard to reach scale 0 and scale 1
      if (baseEffectiveScale < 2.0) { // Very zoomed out - scale 4 (much larger threshold)
        initialScaleLevel = 4; // Use lowest resolution
        initialZoomLevel = baseEffectiveScale * Math.pow(4, 4);
      } else if (baseEffectiveScale < 8.0) { // Zoomed out - scale 3 (much larger threshold)
        initialScaleLevel = 3; // Use low resolution  
        initialZoomLevel = baseEffectiveScale * Math.pow(4, 3);
      } else if (baseEffectiveScale < 32.0) { // Medium zoom - scale 2 (much larger threshold)
        initialScaleLevel = 2; // Use medium resolution
        initialZoomLevel = baseEffectiveScale * Math.pow(4, 2);
      } else if (baseEffectiveScale < 128.0) { // Close zoom - scale 1 (much larger threshold)
        initialScaleLevel = 1; // Use higher resolution (but not highest)
        initialZoomLevel = baseEffectiveScale * Math.pow(4, 1);
      } else { // Very close zoom - scale 0 (extremely hard to reach)
        initialScaleLevel = 0; // Use highest resolution only when extremely close
        initialZoomLevel = baseEffectiveScale;
      }
      
      // Clamp zoom level to valid range
      initialZoomLevel = Math.max(0.25, Math.min(64.0, initialZoomLevel));
      
      // Calculate new map scale for FREE_PAN mode
      const newMapScale = (1 / Math.pow(4, initialScaleLevel)) * initialZoomLevel;
      
      // Calculate pan position to keep FOV box in view during transition
      // This maintains the FOV position relative to the container at the new scale level
      let calculatedPan = { x: 0, y: 0 };
      if (currentStagePosition && stageDimensions && containerDimensions.width > 0) {
        // Calculate where the FOV should be positioned on the new scale
        const stagePosX = (currentStagePosition.x - stageDimensions.xMin) * pixelsPerMm * newMapScale;
        const stagePosY = (currentStagePosition.y - stageDimensions.yMin) * pixelsPerMm * newMapScale;
        
        // Center the FOV in the container
        calculatedPan = {
          x: containerDimensions.width / 2 - stagePosX,
          y: containerDimensions.height / 2 - stagePosY
        };
      } else {
        // Fallback: use the autoFittedPan scaled appropriately
        const scaleRatio = newMapScale / autoFittedScale;
        calculatedPan = {
          x: autoFittedPan.x * scaleRatio,
          y: autoFittedPan.y * scaleRatio
        };
      }
      
      setScaleLevel(initialScaleLevel);
      setZoomLevel(initialZoomLevel);
      setMapPan(calculatedPan);
      if (appendLog) {
        appendLog(`Switched to stage map view (scale ${initialScaleLevel}, zoom ${(initialZoomLevel * 100).toFixed(1)}%)`);
      }
    }
  }, [mapViewMode, autoFittedScale, autoFittedPan, appendLog, currentStagePosition, stageDimensions, pixelsPerMm, containerDimensions]);
  
  // Switch back to FOV_FITTED mode
  const fitToView = useCallback(() => {
    // First, uncollapse panels if the function is provided
    if (onFitToViewUncollapse) {
      const panelsExpanded = onFitToViewUncollapse();
      if (panelsExpanded && appendLog) {
        appendLog('Expanded sidebar and right panel for fitted video view');
      }
    }
    
    setMapViewMode('FOV_FITTED');
    setScaleLevel(0); // FOV_FITTED mode always uses scale 0 (highest resolution)
    setZoomLevel(1.0); // Reset to 100% zoom
    
    // For simulated microscope, quit historical mode when switching to FOV_FITTED
    // Note: Data loading is now handled by layer visibility, not mode switching
    
    if (appendLog) {
      appendLog('Switched to fitted video view');
    }
    
    // Container dimensions will be automatically updated by ResizeObserver
    // No need for setTimeout hack - memoized calculations will recalculate
    // when containerDimensions state updates
  }, [onFitToViewUncollapse, appendLog, isSimulatedMicroscope, isHistoricalDataMode, setStitchedTiles]);

  const handleDoubleClick = async (e) => {
    if (!microscopeControlService || !microscopeConfiguration || !stageDimensions || isHardwareInteractionDisabled) {
      if (showNotification && !isHardwareInteractionDisabled) {
        showNotification('Cannot move stage: microscope service or configuration not available', 'warning');
      }
      return;
    }

    try {
      // Get click position relative to map container
      const rect = mapContainerRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Convert click coordinates to map coordinates (accounting for pan and scale)
      const mapX = (clickX - mapPan.x) / mapScale;
      const mapY = (clickY - mapPan.y) / mapScale;

      // Convert from map pixels to stage coordinates (mm)
      const stageX_mm = (mapX / pixelsPerMm) + stageDimensions.xMin;
      const stageY_mm = (mapY / pixelsPerMm) + stageDimensions.yMin;

      // Check if the coordinates are within stage limits
      if (stageX_mm < stageDimensions.xMin || stageX_mm > stageDimensions.xMax ||
          stageY_mm < stageDimensions.yMin || stageY_mm > stageDimensions.yMax) {
        if (showNotification) {
          showNotification('Target position is outside stage limits', 'warning');
        }
        if (appendLog) {
          appendLog(`Target position (${stageX_mm.toFixed(3)}, ${stageY_mm.toFixed(3)}) is outside stage limits`);
        }
        return;
      }

      if (appendLog) {
        appendLog(`Moving stage to clicked position: X=${stageX_mm.toFixed(3)}mm, Y=${stageY_mm.toFixed(3)}mm`);
      }

      // Get current Z position to maintain it
      const currentZ = frameMetadata?.stage_position?.z_mm || 0;

      // Move to the clicked position
      const result = await microscopeControlService.move_to_position(stageX_mm, stageY_mm, currentZ);
      
      if (result.success) {
        if (appendLog) {
          appendLog(`Successfully moved to position: ${result.message}`);
          appendLog(`Moved from (${result.initial_position.x.toFixed(3)}, ${result.initial_position.y.toFixed(3)}) to (${result.final_position.x.toFixed(3)}, ${result.final_position.y.toFixed(3)})`);
        }
        if (showNotification) {
          showNotification(`Stage moved to (${result.final_position.x.toFixed(3)}, ${result.final_position.y.toFixed(3)})`, 'success');
        }
      } else {
        if (appendLog) {
          appendLog(`Failed to move stage: ${result.message}`);
        }
        if (showNotification) {
          showNotification(`Failed to move stage: ${result.message}`, 'error');
        }
      }
    } catch (error) {
      const errorMsg = `Error moving stage: ${error.message}`;
      if (appendLog) {
        appendLog(errorMsg);
      }
      if (showNotification) {
        showNotification(errorMsg, 'error');
      }
      console.error('[MicroscopeMapDisplay] Error moving stage:', error);
    }
  };

  // Helper function to zoom to a specific point
  const zoomToPoint = useCallback((newZoomLevel, newScaleLevel, pointX, pointY) => {
    const oldScale = mapScale;
    const newScale = (1 / Math.pow(4, newScaleLevel)) * newZoomLevel;
    
    // Calculate new pan position to keep the zoom point stationary
    const newPanX = pointX - (pointX - mapPan.x) * (newScale / oldScale);
    const newPanY = pointY - (pointY - mapPan.y) * (newScale / oldScale);
    
    setScaleLevel(newScaleLevel);
    setZoomLevel(newZoomLevel);
    setMapPan({ x: newPanX, y: newPanY });
  }, [mapPan.x, mapPan.y, mapScale]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    
    if (isDrawingMode) return;
    
    // Set zooming state to true and reset timeout
    setIsZooming(true);
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }
    
    // Clear zooming state after 500ms of no zoom activity
    zoomTimeoutRef.current = setTimeout(() => {
      setIsZooming(false);
    }, 500);
    
    if (mapViewMode === 'FOV_FITTED') {
      // In FOV_FITTED mode, zoom out transitions to FREE_PAN mode
      if (e.deltaY > 0) { // Zoom out
        transitionToFreePan();
      }
      // Zoom in is handled by videoZoom in the video element itself
      if (setVideoZoom && e.deltaY < 0) {
        setVideoZoom(prev => Math.min(3.0, prev * 1.1));
      }
      return;
    }
    
    // FREE_PAN mode - normal map zoom behavior
    const zoomDelta = e.deltaY > 0 ? 0.95 : 1.05; // Smaller steps for smoother zoom
    let newZoomLevel = zoomLevel * zoomDelta;
    
    const rect = mapContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check if we should change scale level - MAXIMUM bias towards higher scale levels (lower resolution)
    if (newZoomLevel > 32.0 && scaleLevel > 0) {
      // Zoom in to higher resolution (lower scale number = less zoomed out)
      // Extremely restrictive threshold (32.0) to avoid loading high resolution unless really needed
      const equivalentZoom = (newZoomLevel * (1 / Math.pow(4, scaleLevel))) / (1 / Math.pow(4, scaleLevel - 1));
      zoomToPoint(Math.min(64.0, equivalentZoom), scaleLevel - 1, mouseX, mouseY);
    } else if (newZoomLevel < 8.0 && scaleLevel < 4) {
      // Zoom out to lower resolution (higher scale number = more zoomed out)
      // Much more aggressive threshold (8.0) to push users to lower resolution much sooner
      const equivalentZoom = (newZoomLevel * (1 / Math.pow(4, scaleLevel))) / (1 / Math.pow(4, scaleLevel + 1));
      zoomToPoint(Math.max(0.25, equivalentZoom), scaleLevel + 1, mouseX, mouseY);
    } else {
      // Smooth zoom within current scale level
      newZoomLevel = Math.max(0.25, Math.min(64.0, newZoomLevel));
      zoomToPoint(newZoomLevel, scaleLevel, mouseX, mouseY);
    }
  }, [mapViewMode, zoomLevel, scaleLevel, zoomToPoint, transitionToFreePan, setVideoZoom]);

  useEffect(() => {
    const mapContainer = mapContainerRef.current;
    if (isOpen && mapContainer) {
      mapContainer.addEventListener('wheel', handleWheel, { passive: false });
      return () => {
        if (mapContainer) {
            mapContainer.removeEventListener('wheel', handleWheel);
        }
      };
    }
  }, [isOpen, handleWheel]);

  // Effect to track container dimension changes
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    // Update initial dimensions
    setContainerDimensions({
      width: container.clientWidth,
      height: container.clientHeight
    });

    // Use ResizeObserver to detect container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerDimensions({ width, height });
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]); // Re-run when component opens/closes

  // Effect to handle window resize and recalculate FOV positioning
  useEffect(() => {
    const handleResize = () => {
      // Force a re-render of the FOV positioning when container size changes
      // This is particularly important when panels expand/collapse
      if (mapViewMode === 'FOV_FITTED' && mapContainerRef.current) {
        // The autoFittedPan and autoFittedScale will automatically recalculate
        // due to their dependency on container dimensions
        setContainerDimensions({
          width: mapContainerRef.current.clientWidth,
          height: mapContainerRef.current.clientHeight
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [mapViewMode]);

  // Helper functions for tile management
  const getTileKey = useCallback((bounds, scale, channel, experimentName = null) => {
    // For merged channels, use the sorted channel string to ensure consistent keys
    const normalizedChannel = channel.includes(',') ? channel.split(',').sort().join(',') : channel;
    const expName = experimentName || 'default';
    return `${bounds.topLeft.x.toFixed(1)}_${bounds.topLeft.y.toFixed(1)}_${bounds.bottomRight.x.toFixed(1)}_${bounds.bottomRight.y.toFixed(1)}_${scale}_${normalizedChannel}_${expName}`;
  }, []);

  // Memoize visible tiles with smart cleanup strategy  
  const visibleTiles = useMemo(() => {
    const browseDataLayer = getBrowseDataLayer();
    const scanDataLayer = getScanDataLayer();
    const hasScanResults = visibleLayers.scanResults && visibleExperiments.length > 0;
    
    if (!browseDataLayer && !scanDataLayer && !hasScanResults) return [];
    
    // Determine current channel configuration
    const useMultiChannel = shouldUseMultiChannelLoading();
    
    // For multi-layer support, we need different channel strings for different tile types
    const browseChannelString = useMultiChannel && browseDataLayer ? 
      getEnabledZarrChannels().map(ch => ch.channelName).sort().join(',') : 
      getChannelString();
    const scanChannelString = getChannelString(); // Always use microscope channels for scan data
    
    // 🚀 REDUCED LOGGING: Only log when NOT interacting and when tiles change significantly
    const shouldLogDetails = (!isZooming && !isPanning) && (stitchedTiles.length % 5 === 0 || stitchedTiles.length <= 5); // Log every 5th tile change when not interacting
    if (shouldLogDetails) {
      console.log(`🔍 [visibleTiles] Multi-layer filtering logic:`, {
        useMultiChannel,
        isHistoricalDataMode,
        browseChannelString,
        scanChannelString,
        scaleLevel,
        totalTiles: stitchedTiles.length,
        visibleExperiments: visibleExperiments,
        activeExperiment: activeExperiment,
        browseDataMatching: stitchedTiles.filter(tile => tile.channel === browseChannelString).length,
        scanDataMatching: stitchedTiles.filter(tile => tile.channel === scanChannelString).length
      });
      
      // DEBUG: Show all tile channels and experiment names
      console.log(`🔍 [visibleTiles] All tiles details:`, stitchedTiles.map(tile => ({
        experiment: tile.experimentName,
        channel: tile.channel,
        scale: tile.scale,
        isMultiChannel: tile.metadata?.isMultiChannel
      })));
    }
    
    // Get tiles for current scale and channel selection
    const currentScaleTiles = stitchedTiles.filter(tile => {
      // Multi-layer experiment filtering: only show tiles from visible experiments
      // If no experiments are explicitly visible, show tiles from active experiment (backwards compatibility)
      const experimentsToShow = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : []);
      const isExperimentVisible = !tile.experimentName || tile.experimentName === null || experimentsToShow.includes(tile.experimentName);
      
      if (!isExperimentVisible) {
        if (shouldLogDetails) {
          console.log(`🔍 [visibleTiles] Filtering out tile - experiment not visible:`, {
            tileExperiment: tile.experimentName,
            experimentsToShow,
            isExperimentVisible
          });
        }
        return false;
      }
      
      // Determine tile type and apply appropriate channel filtering
      const isBrowseDataTile = tile.metadata?.isMultiChannel || tile.channel?.includes('historical');
      const isScanDataTile = !isBrowseDataTile && tile.experimentName;
      
      const scaleMatch = tile.scale === scaleLevel;
      
      if (isBrowseDataTile) {
        // Browse data tiles: use zarr channel matching for multi-channel, or simple channel matching
        if (useMultiChannel && isHistoricalDataMode && tile.metadata?.isMultiChannel) {
          // Multi-channel browse data: only check scale
          if (shouldLogDetails) {
            console.log(`🔍 [visibleTiles] Browse data multi-channel tile:`, {
              scaleMatch,
              tileScale: tile.scale,
              targetScale: scaleLevel
            });
          }
          return scaleMatch;
        } else {
          // Single channel browse data: check channel match using browse channel string
          const channelMatch = tile.channel === browseChannelString;
          const result = scaleMatch && channelMatch;
          if (shouldLogDetails) {
            console.log(`🔍 [visibleTiles] Browse data single-channel tile:`, {
              tileChannel: tile.channel,
              targetChannel: browseChannelString,
              channelMatch,
              scaleMatch,
              result
            });
          }
          return result;
        }
      } else if (isScanDataTile) {
        // Scan data tiles: use microscope channel matching
        const channelMatch = tile.channel === scanChannelString;
        const result = scaleMatch && channelMatch;
        if (shouldLogDetails) {
          console.log(`🔍 [visibleTiles] Scan data tile:`, {
            tileChannel: tile.channel,
            targetChannel: scanChannelString,
            channelMatch,
            tileScale: tile.scale,
            targetScale: scaleLevel,
            scaleMatch,
            result
          });
        }
        return result;
      } else {
        // Fallback: use general channel matching (use scan channel string)
        const channelMatch = tile.channel === scanChannelString;
        const result = scaleMatch && channelMatch;
        if (shouldLogDetails) {
          console.log(`🔍 [visibleTiles] Fallback tile:`, {
            tileChannel: tile.channel,
            targetChannel: scanChannelString,
            channelMatch,
            scaleMatch,
            result
          });
        }
        return result;
      }
    });
    
    // 🚀 REDUCED LOGGING: Only log if detailed logging is enabled
    if (shouldLogDetails) {
      console.log(`🔍 [visibleTiles] Current scale tiles found:`, currentScaleTiles.length);
    }
    
    if (currentScaleTiles.length > 0) {
      // If we have current scale tiles, only show current scale
      return currentScaleTiles;
    }
    
    // In historical mode, if no tiles for current scale, show ANY available tiles to prevent blackout
    if (isHistoricalDataMode) {
      console.log(`[visibleTiles] Historical mode: No tiles for scale ${scaleLevel}, showing fallback tiles to prevent blackout`);
      const fallbackTiles = stitchedTiles.filter(tile => {
        const experimentsToShow = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : []);
        const isExperimentVisible = !tile.experimentName || tile.experimentName === null || experimentsToShow.includes(tile.experimentName);
        return isExperimentVisible;
      });
      
      if (fallbackTiles.length > 0) {
        console.log(`[visibleTiles] Showing ${fallbackTiles.length} fallback tiles to prevent blackout`);
        return fallbackTiles;
      }
    }
    
    // If no current scale tiles, show lower resolution (higher scale number) tiles as fallback
    // This prevents showing high-res tiles when zoomed out (which would be wasteful)
    const availableScales = [...new Set(stitchedTiles.map(tile => tile.scale))]
      .filter(scale => scale >= scaleLevel) // Only show equal or lower resolution
      .sort((a, b) => a - b); // Sort ascending (lower numbers = higher resolution)
    
    for (const scale of availableScales) {
      const scaleTiles = stitchedTiles.filter(tile => {
        // Multi-layer experiment filtering: only show tiles from visible experiments (SAME AS ABOVE!)
        const experimentsToShow = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : []);
        const isExperimentVisible = !tile.experimentName || tile.experimentName === null || experimentsToShow.includes(tile.experimentName);
        
        if (!isExperimentVisible) {
          return false;
        }
        
        // Determine tile type and apply appropriate channel filtering (same logic as above)
        const isBrowseDataTile = tile.metadata?.isMultiChannel || tile.channel?.includes('historical');
        const isScanDataTile = !isBrowseDataTile && tile.experimentName;
        
        if (isBrowseDataTile) {
          // Browse data tiles: use zarr channel matching for multi-channel, or simple channel matching
          if (useMultiChannel && isHistoricalDataMode && tile.metadata?.isMultiChannel) {
            return tile.scale === scale && 
                   JSON.stringify(tile.metadata.channelsUsed?.sort()) === JSON.stringify(getEnabledZarrChannels().map(ch => ch.channelName).sort());
          } else {
            return tile.scale === scale && tile.channel === browseChannelString;
          }
        } else if (isScanDataTile) {
          // Scan data tiles: use microscope channel matching
          return tile.scale === scale && tile.channel === scanChannelString;
        } else {
          // Fallback: use general channel matching (use scan channel string)
          return tile.scale === scale && tile.channel === scanChannelString;
        }
      });
      if (scaleTiles.length > 0) {
        return scaleTiles;
      }
    }
    
    return [];
  }, [stitchedTiles, scaleLevel, visibleLayers.channels, visibleLayers.scanResults, shouldUseMultiChannelLoading, getEnabledZarrChannels, getSelectedChannels, getChannelString, visibleExperiments, activeExperiment, isZooming, isPanning, getBrowseDataLayer, getScanDataLayer]); // Added interaction state dependencies for proper logging control

  const addOrUpdateTile = useCallback((newTile) => {
    setStitchedTiles(prevTiles => {
      const tileKey = getTileKey(newTile.bounds, newTile.scale, newTile.channel, newTile.experimentName);
      const existingIndex = prevTiles.findIndex(tile => 
        getTileKey(tile.bounds, tile.scale, tile.channel, tile.experimentName) === tileKey
      );
      
      if (existingIndex >= 0) {
        // Update existing tile
        const updatedTiles = [...prevTiles];
        updatedTiles[existingIndex] = newTile;
        return updatedTiles;
      } else {
        // Add new tile
        return [...prevTiles, newTile];
      }
    });
  }, [getTileKey]);

  const cleanupOldTiles = useCallback((currentScale, activeChannel, maxTilesPerScale = 20) => {
    setStitchedTiles(prevTiles => {
      // Keep all tiles for current scale and channel
      const currentTiles = prevTiles.filter(tile => 
        tile.scale === currentScale && tile.channel === activeChannel
      );
      
      // For historical mode, be more conservative with cleanup to prevent map clearing during zoom
      if (isHistoricalDataMode) {
        // In historical mode, if there are no tiles for current scale, keep all existing tiles
        // to prevent the map from clearing during zoom operations
        if (currentTiles.length === 0) {
          console.log('[cleanupOldTiles] Historical mode: No tiles for current scale, preserving all existing tiles to prevent blackout');
          return prevTiles; // Keep all existing tiles
        }
        
        // Also preserve tiles if we're in the middle of a scale change (zoom in or out)
        const isScaleChanging = scaleLevel !== lastTileRequestRef.current.scaleLevel;
        if (isScaleChanging) {
          console.log(`[cleanupOldTiles] Historical mode: Scale level changing from ${lastTileRequestRef.current.scaleLevel} to ${scaleLevel}, preserving all existing tiles to prevent blackout`);
          return prevTiles; // Keep all existing tiles during scale changes
        }
      }
      
      // Smart cleanup: when zooming out (to higher scale numbers), aggressively clean high-res tiles
      // When zooming in (to lower scale numbers), keep lower-res tiles as background
      const otherTiles = prevTiles.filter(tile => 
        !(tile.scale === currentScale && tile.channel === activeChannel)
      ).filter(tile => {
        // If zooming out (currentScale > tile.scale), remove high-resolution tiles
        if (currentScale > tile.scale) {
          return false; // Remove higher resolution tiles to save memory
        }
        // If zooming in (currentScale < tile.scale), keep lower resolution tiles
        return tile.channel === activeChannel; // Only keep same channel
      }).slice(-maxTilesPerScale); // Limit total tiles
      
      return [...currentTiles, ...otherTiles];
    });
  }, [isHistoricalDataMode, scaleLevel]);

  // Effect to clean up old tiles when channel changes  
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults) {
      // Trigger cleanup of old tiles after a delay to allow new ones to load
      const cleanupTimer = setTimeout(() => {
        cleanupOldTiles(scaleLevel, getChannelString());
      }, 300);
      
      return () => clearTimeout(cleanupTimer);
    }
  }, [visibleLayers.channels, mapViewMode, visibleLayers.scanResults, scaleLevel, cleanupOldTiles, getChannelString]);



  // Handle video source assignment for both main video and map video refs
  useEffect(() => {
    if (isWebRtcActive && remoteStream) {
      // In FOV_FITTED mode, prioritize main video ref
      if (mapViewMode === 'FOV_FITTED') {
        if (videoRef?.current && videoRef.current.srcObject !== remoteStream) {
          console.log('Setting video source for main video element (FOV_FITTED mode)');
          videoRef.current.srcObject = remoteStream;
          videoRef.current.play().catch(error => {
            console.error('Error playing main video:', error);
          });
        }
        // Clear map video ref in FOV_FITTED mode to avoid conflicts
        if (mapVideoRef.current && mapVideoRef.current.srcObject) {
          console.log('Clearing map video source in FOV_FITTED mode');
          mapVideoRef.current.srcObject = null;
        }
      } else {
        // In FREE_PAN mode, use map video ref for scales 0-3
        if (scaleLevel <= 3) {
          if (mapVideoRef.current && mapVideoRef.current.srcObject !== remoteStream) {
            console.log('Setting video source for map video element (FREE_PAN mode)');
            mapVideoRef.current.srcObject = remoteStream;
            mapVideoRef.current.play().catch(error => {
              console.error('Error playing map video:', error);
            });
          }
        } else {
          // Clear map video ref at higher scales
          if (mapVideoRef.current && mapVideoRef.current.srcObject) {
            console.log('Clearing map video source at high scale');
            mapVideoRef.current.srcObject = null;
          }
        }
      }
    } else {
      // Clear both video refs when WebRTC is not active
      if (videoRef?.current && videoRef.current.srcObject) {
        console.log('Clearing main video source');
        videoRef.current.srcObject = null;
      }
      if (mapVideoRef.current && mapVideoRef.current.srcObject) {
        console.log('Clearing map video source');
        mapVideoRef.current.srcObject = null;
      }
    }
  }, [isWebRtcActive, remoteStream, mapViewMode, scaleLevel, videoRef]);


  // State to trigger canvas redraw on container resize
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  
  // Set up ResizeObserver to detect container size changes
  useEffect(() => {
    if (!mapContainerRef.current || !isOpen) return;
    
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    
    resizeObserver.observe(mapContainerRef.current);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, [isOpen]);

  // Draw the map
  useEffect(() => {
    if (!canvasRef.current || !isOpen) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to match container
    const container = mapContainerRef.current;
    if (container) {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      
      // Only resize if dimensions actually changed to avoid unnecessary clearing
      if (canvas.width !== newWidth || canvas.height !== newHeight) {
        // Store current image data before resize
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        
        // Resize canvas
        canvas.width = newWidth;
        canvas.height = newHeight;
        
        // Restore image data after resize
        if (imageData.width > 0 && imageData.height > 0) {
          ctx.putImageData(imageData, 0, 0);
        } else {
          // Only clear with black if no existing data
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    
    // Only redraw stage boundaries and grid if no existing image data
    // This prevents clearing the map during zoom/pan operations
    const hasExistingData = stitchedTiles.length > 0 || realTimeChunkProgress.size > 0;
    const isCurrentlyZooming = isZooming || currentOperation === 'zooming';
    
    // In historical mode, preserve existing tiles during scale changes to prevent blackout
    // Check if we're zooming (any direction) or if scale level has changed
    const isScaleChanging = scaleLevel !== lastTileRequestRef.current.scaleLevel;
    
    // More aggressive preservation in historical mode:
    // 1. Always preserve during zooming
    // 2. Always preserve during scale changes
    // 3. Always preserve if we have any tiles at all (even from different scales)
    const hasAnyTiles = stitchedTiles.length > 0;
    const shouldPreserveTiles = isHistoricalDataMode && (
      isCurrentlyZooming || 
      isScaleChanging || 
      hasAnyTiles  // Preserve any existing tiles in historical mode
    );
    
    // Debug logging for scale changes
    if (isHistoricalDataMode && isScaleChanging) {
      console.log(`[Canvas] Scale change detected: ${lastTileRequestRef.current.scaleLevel} → ${scaleLevel}, hasAnyTiles: ${hasAnyTiles}, shouldPreserve: ${shouldPreserveTiles}`);
    }
    
    if (!hasExistingData && !isCurrentlyZooming && !shouldPreserveTiles) {
      // Clear canvas only if no existing data and not preserving tiles
      console.log(`[Canvas] Clearing canvas - hasExistingData: ${hasExistingData}, isCurrentlyZooming: ${isCurrentlyZooming}, shouldPreserveTiles: ${shouldPreserveTiles}`);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw stage boundaries and grid
      ctx.save();
      ctx.translate(effectivePan.x, effectivePan.y);
      ctx.scale(mapScale, mapScale);
      
      // Calculate stage position in pixels (origin at upper-left)
      const stagePixelX = 0;
      const stagePixelY = 0;
      const stagePixelWidth = stageDimensions.width * pixelsPerMm;
      const stagePixelHeight = stageDimensions.height * pixelsPerMm;
      
      ctx.restore();
    }
  }, [isOpen, stageDimensions, mapScale, effectivePan, containerSize, stitchedTiles.length, realTimeChunkProgress.size, isZooming, currentOperation]); // Note: visibleLayers.wellPlate removed - well plate is rendered as SVG overlay, not on canvas

  // Handle well click for selection
  const handleWellClick = useCallback((wellId) => {
    if (isSimulatedMicroscope && !isHistoricalDataMode) return;
    
    setSelectedWells(prev => {
      if (prev.includes(wellId)) {
        // Remove well if already selected
        return prev.filter(w => w !== wellId);
      } else {
        // Add well to selection
        return [...prev, wellId];
      }
    });
  }, [isSimulatedMicroscope, isHistoricalDataMode]);

  // Render well plate overlay with interactive wells
  const render96WellPlate = () => {
    if (!visibleLayers.wellPlate || !microscopeConfiguration) {
      return null;
    }
    
    const wellConfig = getWellPlateConfig();
    if (!wellConfig) {
      return null;
    }
    
    const { well_size_mm, well_spacing_mm, a1_x_mm, a1_y_mm } = wellConfig;
    const layout = getWellPlateLayout();
    
    // Calculate well plate border dimensions
    const { rows, cols } = layout;
    
    // Calculate plate boundary in stage coordinates
    const plateMargin = well_size_mm / 2 + 3; // Add 3mm margin around wells for better visual spacing
    const plateTopLeftX = a1_x_mm - plateMargin;
    const plateTopLeftY = a1_y_mm - plateMargin;
    const plateBottomRightX = a1_x_mm + (cols.length - 1) * well_spacing_mm + plateMargin;
    const plateBottomRightY = a1_y_mm + (rows.length - 1) * well_spacing_mm + plateMargin;
    
    // Convert plate boundaries to display coordinates
    const plateDisplayTopLeft = {
      x: (plateTopLeftX - stageDimensions.xMin) * pixelsPerMm * mapScale + effectivePan.x,
      y: (plateTopLeftY - stageDimensions.yMin) * pixelsPerMm * mapScale + effectivePan.y
    };
    const plateDisplayBottomRight = {
      x: (plateBottomRightX - stageDimensions.xMin) * pixelsPerMm * mapScale + effectivePan.x,
      y: (plateBottomRightY - stageDimensions.yMin) * pixelsPerMm * mapScale + effectivePan.y
    };
    
    const plateWidth = plateDisplayBottomRight.x - plateDisplayTopLeft.x;
    const plateHeight = plateDisplayBottomRight.y - plateDisplayTopLeft.y;
    
    const wells = [];
    
    rows.forEach((row, rowIndex) => {
      cols.forEach((col, colIndex) => {
        const wellId = `${row}${col}`;
        const isSelected = selectedWells.includes(wellId);
        const hasData = experimentInfo?.wells && experimentInfo.wells.includes(wellId);
        
        // a1_x_mm and a1_y_mm already include offsets, don't add them again
        const centerX = a1_x_mm + colIndex * well_spacing_mm;
        const centerY = a1_y_mm + rowIndex * well_spacing_mm;
        
        // Convert to display coordinates (0,0 is upper-left corner)
        const displayX = (centerX - stageDimensions.xMin) * pixelsPerMm * mapScale + effectivePan.x;
        const displayY = (centerY - stageDimensions.yMin) * pixelsPerMm * mapScale + effectivePan.y;
        const displayRadius = (well_size_mm / 2) * pixelsPerMm * mapScale;
        
        wells.push(
          <g key={wellId}>
            <circle
              cx={displayX}
              cy={displayY}
              r={displayRadius}
              fill="none"
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth={isSelected ? "2" : "1"}
              style={{ cursor: (isSimulatedMicroscope && !isHistoricalDataMode) ? 'default' : 'pointer' }}
              onClick={() => !(isSimulatedMicroscope && !isHistoricalDataMode) && handleWellClick(wellId)}
            />
            {scaleLevel >= 2 && (
              <text
                x={displayX}
                y={displayY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255, 255, 255, 0.8)"
                fontSize={`${Math.min(12, 6 + scaleLevel * 2)}px`}
                style={{ cursor: (isSimulatedMicroscope && !isHistoricalDataMode) ? 'default' : 'pointer', pointerEvents: 'none' }}
              >
                {wellId}
              </text>
            )}
          </g>
        );
      });
    });
    
    return (
      <svg
        className="well-plate-overlay"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: (isSimulatedMicroscope && !isHistoricalDataMode) ? 'none' : 'auto', // Allow clicks for well selection
          zIndex: 5 // Well plate overlay above scan results
        }}
      >
        {/* 96-well plate rectangular border */}
        <rect
          x={plateDisplayTopLeft.x}
          y={plateDisplayTopLeft.y}
          width={plateWidth}
          height={plateHeight}
          fill="none"
          stroke="rgba(255, 255, 255, 0.8)"
          strokeWidth="1"
          rx="4"
          ry="4"
        />
        
        {wells}
      </svg>
    );
  };

  // Helper function to render histogram display
  const renderHistogramDisplay = () => {
    if (!frameMetadata || !frameMetadata.gray_level_stats || !frameMetadata.gray_level_stats.histogram) {
      return null;
    }

    const histogram = frameMetadata.gray_level_stats.histogram;
    const counts = histogram.counts || [];
    const binEdges = histogram.bin_edges || [];
    
    if (counts.length === 0) return null;

    const maxCount = Math.max(...counts);
    const histogramHeight = 40; // Compact height
    
    return (
      <div className="histogram-display" style={{ position: 'relative', width: '100%', height: `${histogramHeight}px`, backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px' }}>
        <svg width="100%" height={histogramHeight} style={{ display: 'block' }}>
          {counts.map((count, index) => {
            const x = (index / counts.length) * 100; // Convert to percentage
            const height = (count / maxCount) * (histogramHeight - 4); // 4px padding
            const binStart = binEdges[index] || (index * 255 / counts.length);
            const binEnd = binEdges[index + 1] || ((index + 1) * 255 / counts.length);
            const binCenter = (binStart + binEnd) / 2;
            
            return (
              <rect
                key={index}
                x={`${x}%`}
                y={histogramHeight - height - 2}
                width={`${100 / counts.length}%`}
                height={height}
                fill="#6c757d"
                title={`Bin ${binCenter.toFixed(0)}: ${count} pixels`}
              />
            );
          })}
          
          {/* Contrast range indicators */}
          <line
            x1={`${(videoContrastMin / 255) * 100}%`}
            y1="0"
            x2={`${(videoContrastMin / 255) * 100}%`}
            y2={histogramHeight}
            stroke="#dc3545"
            strokeWidth="2"
            opacity="0.8"
          />
          <line
            x1={`${(videoContrastMax / 255) * 100}%`}
            y1="0"
            x2={`${(videoContrastMax / 255) * 100}%`}
            y2={histogramHeight}
            stroke="#dc3545"
            strokeWidth="2"
            opacity="0.8"
          />
          
          {/* Range fill */}
          <rect
            x={`${(videoContrastMin / 255) * 100}%`}
            y="0"
            width={`${((videoContrastMax - videoContrastMin) / 255) * 100}%`}
            height={histogramHeight}
            fill="#007bff"
            opacity="0.2"
          />
        </svg>
        
        {/* Interactive overlay for dragging */}
        <div 
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            cursor: isHardwareInteractionDisabled ? 'not-allowed' : 'crosshair',
            pointerEvents: isHardwareInteractionDisabled ? 'none' : 'auto'
          }}
          onMouseDown={(e) => {
            if (isHardwareInteractionDisabled) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const valueAt = Math.round((x / rect.width) * 255);

            if (autoContrastEnabled) {
              // Adjust auto-contrast offsets
              if (!frameMetadata || !frameMetadata.gray_level_stats || !frameMetadata.gray_level_stats.percentiles) return;
              
              const stats = frameMetadata.gray_level_stats;
              const p5Value = (stats.percentiles.p5 || 0) * 255 / 100;
              const p95Value = (stats.percentiles.p95 || 100) * 255 / 100;

              // The current min/max are based on p5/p95 + adjustments
              const currentMin = p5Value + autoContrastMinAdjust;
              const currentMax = p95Value + autoContrastMaxAdjust;

              const distToMin = Math.abs(valueAt - currentMin);
              const distToMax = Math.abs(valueAt - currentMax);

              if (distToMin < distToMax) {
                const newMinAdjust = valueAt - p5Value;
                setAutoContrastMinAdjust(newMinAdjust);
              } else {
                const newMaxAdjust = valueAt - p95Value;
                setAutoContrastMaxAdjust(newMaxAdjust);
              }
            } else {
              // Original logic for manual contrast
              const distToMin = Math.abs(valueAt - videoContrastMin);
              const distToMax = Math.abs(valueAt - videoContrastMax);
              
              if (distToMin < distToMax) {
                setVideoContrastMin(Math.max(0, Math.min(valueAt, videoContrastMax - 1)));
              } else {
                setVideoContrastMax(Math.min(255, Math.max(valueAt, videoContrastMin + 1)));
              }
            }
          }}
        />
      </div>
    );
  };

  // Helper function to convert display coordinates to stage coordinates
  const displayToStageCoords = useCallback((displayX, displayY) => {
    if (mapViewMode === 'FOV_FITTED') {
      // In FOV_FITTED mode, use a simpler conversion
      return { x: 0, y: 0 }; // Not applicable in FOV_FITTED mode
    }
    
    // In FREE_PAN mode, account for pan and scale correctly
    const mapX = (displayX - effectivePan.x) / mapScale;
    const mapY = (displayY - effectivePan.y) / mapScale;
    const stageX_mm = (mapX / pixelsPerMm) + stageDimensions.xMin;
    const stageY_mm = (mapY / pixelsPerMm) + stageDimensions.yMin;
    return { x: stageX_mm, y: stageY_mm };
  }, [mapViewMode, effectivePan, mapScale, pixelsPerMm, stageDimensions]);
  
  // Helper function to convert stage coordinates to display coordinates
  const stageToDisplayCoords = useCallback((stageX_mm, stageY_mm) => {
    if (mapViewMode === 'FOV_FITTED') {
      // In FOV_FITTED mode, not applicable
      return { x: 0, y: 0 };
    }
    
    // In FREE_PAN mode, convert stage coordinates to display coordinates
    const mapX = (stageX_mm - stageDimensions.xMin) * pixelsPerMm;
    const mapY = (stageY_mm - stageDimensions.yMin) * pixelsPerMm;
    const displayX = mapX * mapScale + effectivePan.x;
    const displayY = mapY * mapScale + effectivePan.y;
    return { x: displayX, y: displayY };
  }, [mapViewMode, stageDimensions, pixelsPerMm, mapScale, effectivePan]);

  // Calculate FOV positions for scan preview
  const calculateFOVPositions = useCallback(() => {
    if (!scanParameters || !fovSize || !pixelsPerMm || !mapScale) return [];
    
    const positions = [];
    for (let i = 0; i < scanParameters.Nx; i++) {
      for (let j = 0; j < scanParameters.Ny; j++) {
        // Calculate relative position
        const relativeX = scanParameters.start_x_mm + i * scanParameters.dx_mm;
        const relativeY = scanParameters.start_y_mm + j * scanParameters.dy_mm;
        
        // Convert to absolute stage coordinates
        // If we have a selected well, the scan parameters are relative to well center
        let stageX, stageY;
        if (dragSelectedWell) {
          // Convert relative coordinates back to absolute
          stageX = dragSelectedWell.centerX + relativeX;
          stageY = dragSelectedWell.centerY + relativeY;
        } else {
          // Fallback: treat as absolute coordinates
          stageX = relativeX;
          stageY = relativeY;
        }
        
        const displayCoords = stageToDisplayCoords(stageX, stageY);
        const fovDisplaySize = fovSize * pixelsPerMm * mapScale;
        
        positions.push({
          x: displayCoords.x - fovDisplaySize / 2,
          y: displayCoords.y - fovDisplaySize / 2,
          width: fovDisplaySize,
          height: fovDisplaySize,
          stageX,
          stageY,
          index: i * scanParameters.Ny + j
        });
      }
    }
    return positions;
  }, [scanParameters, fovSize, pixelsPerMm, mapScale, stageToDisplayCoords, dragSelectedWell]);
  
  // Helper function to get intensity/exposure pair from status object (similar to MicroscopeControlPanel)
  const getIntensityExposurePairFromStatus = (status, channel) => {
    if (!status || channel === null || channel === undefined) return null;
    switch (channel.toString()) {
      case "0": return status.BF_intensity_exposure;
      case "11": return status.F405_intensity_exposure;
      case "12": return status.F488_intensity_exposure;
      case "14": return status.F561_intensity_exposure;
      case "13": return status.F638_intensity_exposure;
      case "15": return status.F730_intensity_exposure;
      default: return null;
    }
  };

  // Function to load current microscope settings
  const loadCurrentMicroscopeSettings = useCallback(async () => {
    if (!microscopeControlService) return;
    
    try {
      const status = await microscopeControlService.get_status();
      const currentChannel = status.current_channel?.toString();
      
      // Map channel numbers to channel names
      const channelMap = {
        "0": "BF LED matrix full",
        "11": "Fluorescence 405 nm Ex",
        "12": "Fluorescence 488 nm Ex", 
        "14": "Fluorescence 561 nm Ex",
        "13": "Fluorescence 638 nm Ex",
        "15": "Fluorescence 730 nm Ex"
      };
      
      const channelName = channelMap[currentChannel] || "BF LED matrix full";
      
      // Get current intensity and exposure for this channel
      const pair = getIntensityExposurePairFromStatus(status, currentChannel);
      const intensity = pair ? pair[0] : 50;
      const exposure_time = pair ? pair[1] : 100;
      
      // Update scan parameters with current microscope settings
      // For merged display, include all selected channels with default settings
      const selectedChannels = getSelectedChannels();
      const illuminationSettings = selectedChannels.map(channel => {
        // Use current microscope settings for the active channel, defaults for others
        if (channel === channelName) {
          return {
            channel: channel,
            intensity: intensity,
            exposure_time: exposure_time
          };
        } else {
          // Default settings for other channels
          return {
            channel: channel,
            intensity: 50,
            exposure_time: 100
          };
        }
      });
      
      setScanParameters(prev => ({
        ...prev,
        illumination_settings: illuminationSettings
      }));
      
      if (appendLog) {
        appendLog(`Loaded current microscope settings: ${channelName}, ${intensity}% intensity, ${exposure_time}ms exposure`);
      }
    } catch (error) {
      if (appendLog) {
        appendLog(`Failed to load microscope settings: ${error.message}`);
      }
      console.error('[MicroscopeMapDisplay] Failed to load microscope settings:', error);
    }
  }, [microscopeControlService, appendLog, getSelectedChannels]);

  // Effect to update scan parameters when channel selection changes
  useEffect(() => {
    if (microscopeControlService && !isSimulatedMicroscope) {
      loadCurrentMicroscopeSettings();
    }
  }, [visibleLayers.channels, loadCurrentMicroscopeSettings, microscopeControlService, isSimulatedMicroscope]);

  // Track previous channel selection to prevent unnecessary tile clearing
  const previousChannelSelectionRef = useRef('');
  
  // Effect to refresh tiles when channel selection changes
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults && !isSimulatedMicroscope) {
      // Only clear tiles if we actually have a meaningful channel change
      const selectedChannels = Object.entries(visibleLayers.channels)
        .filter(([, isVisible]) => isVisible)
        .map(([channelName]) => channelName);
      const channelList = selectedChannels.length > 0 ? selectedChannels : ['BF LED matrix full'];
      const currentChannelString = channelList.sort().join(',');
      
      // Check if this is a real channel change vs just LayerPanel opening/closing
      if (currentChannelString !== previousChannelSelectionRef.current) {
        console.log(`[Channel Change] Detected real channel change: ${previousChannelSelectionRef.current} → ${currentChannelString}`);
        
        // Update the ref to track current selection
        previousChannelSelectionRef.current = currentChannelString;
        
        // Clear active requests to prevent conflicts
        activeTileRequestsRef.current.clear();
        
        if (appendLog) {
          appendLog(`Channel selection changed to: ${channelList.join(', ')} - refreshing tiles`);
        }
        
        // Set flag to trigger tile loading - loadStitchedTiles will be called by the effect
        setNeedsTileReload(true);
      } else {
        console.log(`[Channel Change] No real channel change detected - LayerPanel UI update only`);
      }
    }
  }, [visibleLayers.channels, mapViewMode, isSimulatedMicroscope, appendLog]); // Removed visibleLayers.scanResults to prevent triggering on layer toggles


  // Effect to listen for contrast settings changes and refresh tiles
  useEffect(() => {
    const handleContrastSettingsChanged = (event) => {
      console.log(`🎨 MicroscopeMapDisplay: Received contrast settings change event:`, event.detail);
      console.log(`🎨 MicroscopeMapDisplay: Current conditions - mapViewMode: ${mapViewMode}, scanResults: ${visibleLayers.scanResults}, isSimulated: ${isSimulatedMicroscope}`);
      
      if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults && !isSimulatedMicroscope) {
        console.log(`🎨 MicroscopeMapDisplay: Processing contrast settings change event`);
        
        // Clear active requests to prevent conflicts
        activeTileRequestsRef.current.clear();
        
        console.log(`🎨 MicroscopeMapDisplay: Refreshing tiles after contrast change, current configs:`, realMicroscopeChannelConfigs);
        if (appendLog) {
          appendLog(`Contrast settings changed for ${event.detail.channelName} - refreshing tiles`);
        }
        
        // Set flag to trigger tile loading - loadStitchedTiles will be called by the effect
        setNeedsTileReload(true);
      } else {
        console.log(`🎨 MicroscopeMapDisplay: Ignoring contrast settings change event - conditions not met`);
      }
    };

    // Add event listener
    window.addEventListener('contrastSettingsChanged', handleContrastSettingsChanged);
    
    // Cleanup
    return () => {
      window.removeEventListener('contrastSettingsChanged', handleContrastSettingsChanged);
    };
  }, [mapViewMode, isSimulatedMicroscope, appendLog]); // Removed visibleLayers.scanResults to prevent triggering on layer toggles

  // Initialize real microscope channel configs for visible channels
  useEffect(() => {
    const scanDataLayer = getScanDataLayer();
    if (scanDataLayer && !isSimulatedMicroscope && mapViewMode === 'FREE_PAN') {
      const visibleChannels = Object.entries(visibleLayers.channels)
        .filter(([_, isVisible]) => isVisible)
        .map(([channelName]) => channelName);
      
      // Initialize configs for visible channels that don't have configs yet
      const newConfigs = {};
      let hasNewConfigs = false;
      
      visibleChannels.forEach(channelName => {
        if (!realMicroscopeChannelConfigs[channelName]) {
          newConfigs[channelName] = {
            min: 0,
            max: 255
          };
          hasNewConfigs = true;
        }
      });
      
      if (hasNewConfigs) {
        console.log(`🎨 Initializing channel configs for visible channels:`, Object.keys(newConfigs));
        setRealMicroscopeChannelConfigs(prev => ({
          ...prev,
          ...newConfigs
        }));
      }
    }
  }, [visibleLayers.channels, getScanDataLayer, isSimulatedMicroscope, mapViewMode, realMicroscopeChannelConfigs]);



  


  
  // Rectangle selection handlers
  const handleRectangleSelectionStart = useCallback((e) => {
    if (!isRectangleSelection || isHardwareInteractionDisabled || (isSimulatedMicroscope && !isHistoricalDataMode)) return;
    
    const rect = mapContainerRef.current.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    
    // Convert display coordinates to stage coordinates to detect the well
    const stageCoords = displayToStageCoords(startX, startY);
    const detectedWell = detectWellFromStageCoords(stageCoords.x, stageCoords.y);
    
    if (!detectedWell) {
      if (showNotification) {
        showNotification('Please start selection within a well boundary', 'warning');
      }
      return;
    }
    
    // Store the selected well for this drag operation
    setDragSelectedWell(detectedWell);
    setRectangleStart({ x: startX, y: startY });
    setRectangleEnd({ x: startX, y: startY });
    
    if (appendLog) {
      appendLog(`Started scan area selection in well ${detectedWell.id}`);
    }
  }, [isRectangleSelection, isHardwareInteractionDisabled, isSimulatedMicroscope, isHistoricalDataMode, displayToStageCoords, detectWellFromStageCoords, showNotification, appendLog]);
  
  const handleRectangleSelectionMove = useCallback((e) => {
    if (!rectangleStart || !isRectangleSelection || (isSimulatedMicroscope && !isHistoricalDataMode) || !dragSelectedWell) return;
    
    const rect = mapContainerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;
    
    // Convert to stage coordinates and clamp to well boundaries
    const stageCoords = displayToStageCoords(currentX, currentY);
    const wellBoundaries = getWellBoundaries(dragSelectedWell);
    const clampedStageCoords = clampToWellBoundaries(stageCoords.x, stageCoords.y, wellBoundaries);
    
    // Convert back to display coordinates
    const clampedDisplayCoords = stageToDisplayCoords(clampedStageCoords.x, clampedStageCoords.y);
    
    setRectangleEnd({ x: clampedDisplayCoords.x, y: clampedDisplayCoords.y });
  }, [rectangleStart, isRectangleSelection, isSimulatedMicroscope, isHistoricalDataMode, dragSelectedWell, displayToStageCoords, getWellBoundaries, clampToWellBoundaries, stageToDisplayCoords]);
  
  const handleRectangleSelectionEnd = useCallback((e) => {
    if (!rectangleStart || !rectangleEnd || !isRectangleSelection || (isSimulatedMicroscope && !isHistoricalDataMode) || !dragSelectedWell) return;
    
    // Convert rectangle corners to stage coordinates
    const topLeft = displayToStageCoords(
      Math.min(rectangleStart.x, rectangleEnd.x),
      Math.min(rectangleStart.y, rectangleEnd.y)
    );
    const bottomRight = displayToStageCoords(
      Math.max(rectangleStart.x, rectangleEnd.x),
      Math.max(rectangleStart.y, rectangleEnd.y)
    );
    
    // Convert absolute stage coordinates to relative coordinates (relative to well center)
    const relativeTopLeft = stageToRelativeCoords(topLeft.x, topLeft.y, dragSelectedWell);
    // const relativeBottomRight = stageToRelativeCoords(bottomRight.x, bottomRight.y, dragSelectedWell);
    
    const width_mm = bottomRight.x - topLeft.x;
    const height_mm = bottomRight.y - topLeft.y;
    
    // Calculate grid parameters
    const Nx = Math.max(1, Math.round(width_mm / scanParameters.dx_mm));
    const Ny = Math.max(1, Math.round(height_mm / scanParameters.dy_mm));
    
    // Update scan parameters with RELATIVE coordinates
    setScanParameters(prev => ({
      ...prev,
      start_x_mm: relativeTopLeft.x, // Now relative to well center
      start_y_mm: relativeTopLeft.y, // Now relative to well center
      Nx: Math.max(1, Nx),
      Ny: Math.max(1, Ny)
    }));
    
    // Update selected wells to include the detected well
    setSelectedWells([dragSelectedWell.id]);
    
    if (appendLog) {
      appendLog(`Grid selection in well ${dragSelectedWell.id}: ` +
        `relative start (${relativeTopLeft.x.toFixed(1)}, ${relativeTopLeft.y.toFixed(1)}) mm, ` +
        `${Nx}×${Ny} positions, step ${scanParameters.dx_mm}×${scanParameters.dy_mm} mm`
      );
    }
    
    // Only exit selection mode, do NOT clear rectangleStart/rectangleEnd/dragSelectedWell
    // This keeps the grid visible but makes it non-interactive (fixed)
    setIsRectangleSelection(false);
    setShowScanConfig(true);
  }, [rectangleStart, rectangleEnd, isRectangleSelection, displayToStageCoords, scanParameters.dx_mm, scanParameters.dy_mm, isSimulatedMicroscope, isHistoricalDataMode, dragSelectedWell, stageToRelativeCoords, appendLog]);



  // Click outside handler for layer dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (layerDropdownRef.current && !layerDropdownRef.current.contains(event.target)) {
        setIsLayerDropdownOpen(false);
      }
    };

    if (isLayerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isLayerDropdownOpen]);

  // Click outside handler for annotation dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (annotationDropdownRef.current && !annotationDropdownRef.current.contains(event.target)) {
        // Don't close dropdown if we're in drawing mode - user needs to see the tools
        if (!isDrawingMode) {
          setIsAnnotationDropdownOpen(false);
        }
      }
    };

    if (isAnnotationDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isAnnotationDropdownOpen, isDrawingMode]);

  // Disable conflicting interactions when entering drawing mode (but keep dropdown open)
  useEffect(() => {
    if (isDrawingMode) {
      // Disable rectangle selection when entering drawing mode to prevent conflicts
      setIsRectangleSelection(false);
      setRectangleStart(null);
      setRectangleEnd(null);
      setDragSelectedWell(null);
      if (appendLog) {
        appendLog('Entered annotation drawing mode - map interactions disabled');
      }
    } else if (!isDrawingMode && appendLog) {
      appendLog('Exited annotation drawing mode - map interactions enabled');
    }
  }, [isDrawingMode, appendLog]);

  // Load experiments when layer dropdown is opened
  useEffect(() => {
    if (isLayerDropdownOpen && !isSimulatedMicroscope) {
      loadExperiments();
      // Also get experiment info for the active experiment
      if (activeExperiment) {
        getExperimentInfo(activeExperiment);
      }
    }
  }, [isLayerDropdownOpen, isSimulatedMicroscope]); // Removed function dependencies to prevent infinite loops

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
      if (canvasUpdateTimerRef.current) {
        clearTimeout(canvasUpdateTimerRef.current);
      }
    };
  }, []);

  // Effect to periodically refresh tiles during scan/quick scan in FREE_PAN mode
  useEffect(() => {
    let intervalId = null;
    if (
      mapViewMode === 'FREE_PAN' &&
      (isScanInProgress || isQuickScanInProgress)
    ) {
      // Set needsTileReload every 3 seconds
      intervalId = setInterval(() => {
        setNeedsTileReload(true);
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [mapViewMode, isScanInProgress, isQuickScanInProgress]);

  // Helper: get well plate layout for grid
  const getWellPlateGridLabels = useCallback(() => {
    const layout = getWellPlateLayout();
    return {
      rows: layout.rows,
      cols: layout.cols
    };
  }, [getWellPlateLayout]);

  // Helper: get wellId from row/col index
  const getWellIdFromIndex = useCallback((rowIdx, colIdx) => {
    const layout = getWellPlateLayout();
    return `${layout.rows[rowIdx]}${layout.cols[colIdx]}`;
  }, [getWellPlateLayout]);

  // Helper: get row/col index from wellId
  const getIndexFromWellId = useCallback((wellId) => {
    const layout = getWellPlateLayout();
    const row = layout.rows.findIndex(r => wellId.startsWith(r));
    // Extract the column number from the well ID (everything after the row letter)
    const colNumber = parseInt(wellId.substring(1));
    const col = layout.cols.findIndex(c => c === colNumber);
    return [row, col];
  }, [getWellPlateLayout]);

  // State for drag selection in grid
  const [gridDragStart, setGridDragStart] = useState(null);
  const [gridDragEnd, setGridDragEnd] = useState(null);
  const [isGridDragging, setIsGridDragging] = useState(false);
  const [gridSelectedCells, setGridSelectedCells] = useState({});

  // Grid selected cells are managed by state in NormalScanConfig component

  // Mouse handlers for grid selection
  // Grid selection handlers are handled in NormalScanConfig component

  // In scan start button handler, pass selectedWells to normal_scan_with_stitching

  // Helper: calculate FOV positions for a given well center
  const calculateFOVPositionsForWell = useCallback((wellInfo) => {
    if (!scanParameters || !fovSize || !pixelsPerMm || !mapScale || !wellInfo) return [];
    
    const positions = [];
    for (let i = 0; i < scanParameters.Nx; i++) {
      for (let j = 0; j < scanParameters.Ny; j++) {
        const stageX = wellInfo.centerX + scanParameters.start_x_mm + i * scanParameters.dx_mm;
        const stageY = wellInfo.centerY + scanParameters.start_y_mm + j * scanParameters.dy_mm;
        const displayCoords = stageToDisplayCoords(stageX, stageY);
        const fovDisplaySize = fovSize * pixelsPerMm * mapScale;
        
        positions.push({
          x: displayCoords.x - fovDisplaySize / 2,
          y: displayCoords.y - fovDisplaySize / 2,
          width: fovDisplaySize,
          height: fovDisplaySize,
          stageX,
          stageY,
          index: i * scanParameters.Ny + j
        });
      }
    }
    return positions;
  }, [scanParameters, fovSize, pixelsPerMm, mapScale, stageToDisplayCoords]);

  // Add state for browse data modal
  const [showBrowseDataModal, setShowBrowseDataModal] = useState(false);
  
  // Layer management state and helper functions already moved early to avoid hoisting issues
 
  // Add state for gallery and dataset browsing
  const [galleries, setGalleries] = useState([]);
  const [galleriesLoading, setGalleriesLoading] = useState(false);
  const [galleriesError, setGalleriesError] = useState(null);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState(null);

  // Fetch galleries when modal opens (no microscope isolation - show all galleries)
  useEffect(() => {
    if (!showBrowseDataModal) return;
    setGalleriesLoading(true);
    setGalleriesError(null);
    setGalleries([]);
    setSelectedGallery(null);
    setDatasets([]);
    setDatasetsError(null);
    const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
    fetch(`/agent-lens/apps/${serviceId}/list-microscope-galleries`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setGalleries(data.galleries || []);
        } else {
          setGalleriesError(data.error || 'Failed to load galleries');
          console.error(data.error);
        }
      })
      .catch(e => setGalleriesError(e.message))
      .finally(() => setGalleriesLoading(false));
  }, [showBrowseDataModal]);

  // Fetch datasets when a gallery is selected
  useEffect(() => {
    if (!selectedGallery) {
      setDatasets([]);
      setDatasetsError(null);
      return;
    }
    setDatasetsLoading(true);
    setDatasetsError(null);
    setDatasets([]);
    const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
    fetch(`/agent-lens/apps/${serviceId}/list-gallery-datasets?gallery_id=${encodeURIComponent(selectedGallery.id)}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setDatasets(data.datasets || []);
        } else {
          setDatasetsError(data.error || 'Failed to load datasets');
        }
      })
      .catch(e => setDatasetsError(e.message))
      .finally(() => setDatasetsLoading(false));
  }, [selectedGallery, selectedMicroscopeId]);

  // Add state for selected dataset in historical mode
  const [selectedHistoricalDataset, setSelectedHistoricalDataset] = useState(null);
  
  // Helper function to get current channel information for annotations
  const getCurrentChannelInfo = useCallback(() => {
    const channels = [];
    const processSettings = {};
    
    if (isHistoricalDataMode) {
      // For historical mode, use zarr channel configs
      const enabledChannels = getEnabledZarrChannels();
      enabledChannels.forEach(channel => {
        channels.push(channel.channelName);
        processSettings[channel.channelName] = {
          min: channel.min,
          max: channel.max
        };
      });
    } else {
      // For real microscope mode, use visible layers
      const selectedChannels = getSelectedChannels();
      selectedChannels.forEach(channelName => {
        channels.push(channelName);
        const config = realMicroscopeChannelConfigs[channelName];
        processSettings[channelName] = {
          min: config?.min || 0,
          max: config?.max || 255
        };
      });
    }
    
    return {
      channels,
      process_settings: processSettings,
      // Add dataset information for historical mode
      ...(isHistoricalDataMode && selectedHistoricalDataset && {
        datasetId: selectedHistoricalDataset.id,
        datasetName: selectedHistoricalDataset.name || selectedHistoricalDataset.id
      })
    };
  }, [isHistoricalDataMode, getEnabledZarrChannels, getSelectedChannels, realMicroscopeChannelConfigs, selectedHistoricalDataset]);
  
  // Auto-enable historical data mode for simulated microscope when switching to FREE_PAN mode
  useEffect(() => {
    if (isSimulatedMicroscope && mapViewMode === 'FREE_PAN' && !isHistoricalDataMode) {
      console.log('[Simulated Microscope] Auto-enabling historical data mode in FREE_PAN mode');
      setIsHistoricalDataMode(true);
      setStitchedTiles([]); // Clear existing tiles
      
      // Create a Browse Data layer if it doesn't exist
      setLayers(prev => {
        const existingBrowseLayer = prev.find(layer => layer.type === 'load-server');
        if (!existingBrowseLayer) {
          const browseDataLayer = {
            id: `browse-data-${Date.now()}`,
            name: 'Browse Data',
            type: 'load-server',
            visible: true,
            channels: [],
            readonly: true
          };
          return [...prev, browseDataLayer];
        }
        return prev;
      });
    }
  }, [isSimulatedMicroscope, mapViewMode, isHistoricalDataMode, selectedMicroscopeId, setStitchedTiles, setSelectedGallery]);

  // Handle simulated sample switching - update dataset when sample changes
  useEffect(() => {
    if (isSimulatedMicroscope && sampleLoadStatus?.isSampleLoaded && sampleLoadStatus?.selectedSampleId) {
      // Map sample IDs to their data aliases (same as in SampleSelector)
      const sampleDataAliases = {
        'simulated-sample-1': 'agent-lens/20250824-example-data-20250824-221822',
        'hpa-sample': 'agent-lens/hpa-example-sample-20250114-150051'
      };
      
      const dataAlias = sampleDataAliases[sampleLoadStatus.selectedSampleId];
      if (dataAlias) {
        console.log('[Simulated Microscope] Sample switched, updating dataset to:', dataAlias);
        
        // Clear existing tiles to force reload with new data
        setStitchedTiles([]);
        activeTileRequestsRef.current.clear();
        
        // Create new mock dataset with the selected sample's data alias
        const mockDataset = {
          id: dataAlias,
          name: `Simulated Sample Data (${sampleLoadStatus.selectedSampleId})`,
          created_at: new Date().toISOString(),
          metadata: {
            microscope_service_id: selectedMicroscopeId,
            sample_id: sampleLoadStatus.selectedSampleId
          }
        };
        
        // Update the dataset and gallery
        setSelectedHistoricalDataset(mockDataset);
        setSelectedGallery({
          id: dataAlias, // Use the actual dataset ID as gallery ID
          name: `Simulated Microscope Gallery (${sampleLoadStatus.selectedSampleId})`,
          microscope_service_id: selectedMicroscopeId
        });
      }
    }
  }, [isSimulatedMicroscope, sampleLoadStatus?.isSampleLoaded, sampleLoadStatus?.selectedSampleId, selectedMicroscopeId, setStitchedTiles, setSelectedGallery]);
  
  // Auto-select first dataset when datasets are loaded in historical mode
  useEffect(() => {
    if (isHistoricalDataMode && datasets.length > 0 && !selectedHistoricalDataset) {
      console.log('[Historical Mode] Auto-selecting first dataset:', datasets[0]);
      setSelectedHistoricalDataset(datasets[0]);
    }
  }, [isHistoricalDataMode, datasets, selectedHistoricalDataset]);

  // Load zarr channel metadata when dataset changes (historical mode only)
  useEffect(() => {
    const loadZarrChannelMetadata = async () => {
      if (!artifactZarrLoaderRef.current || 
          !isHistoricalDataMode ||
          !selectedHistoricalDataset) {
        return;
      }
      
      try {
        console.log('[Zarr Channels] Loading channel metadata for dataset:', selectedHistoricalDataset.id);
        
        // Get available wells first to find a sample well for metadata
        const availableWells = await artifactZarrLoaderRef.current.getAvailableWells(selectedHistoricalDataset.id);
        if (availableWells.length === 0) {
          console.warn('[Zarr Channels] No available wells found');
          return;
        }
        
        // Use first available well to get channel metadata
        const sampleWell = availableWells[0];
        const correctDatasetId = artifactZarrLoaderRef.current.extractDatasetId(selectedHistoricalDataset.id);
        const baseUrl = `${artifactZarrLoaderRef.current.baseUrl}/${correctDatasetId}/zip-files/well_${sampleWell}_96.zip/~/data.zarr/`;
        
        // Get active channel metadata from zattrs
        const channelMetadata = await artifactZarrLoaderRef.current.getActiveChannelsFromZattrs(baseUrl);
        if (channelMetadata && channelMetadata.activeChannels.length > 0) {
          console.log(`[Zarr Channels] Found ${channelMetadata.activeChannels.length} active channels`);
          initializeZarrChannelsFromMetadata(channelMetadata);
        } else {
          console.warn('[Zarr Channels] No active channels found in metadata');
          setIsMultiChannelMode(false);
        }
        
      } catch (error) {
        console.error('[Zarr Channels] Failed to load channel metadata:', error);
        setIsMultiChannelMode(false);
      }
    };
    
    loadZarrChannelMetadata();
  }, [isHistoricalDataMode, selectedHistoricalDataset, initializeZarrChannelsFromMetadata]);

  
  // Initialize ArtifactZarrLoader for historical data
  const artifactZarrLoaderRef = useRef(null);
  
  // Initialize the loader when component mounts
  useEffect(() => {
    if (!artifactZarrLoaderRef.current) {
      artifactZarrLoaderRef.current = new ArtifactZarrLoader();
    }
    
    // Cleanup on unmount
    return () => {
      if (artifactZarrLoaderRef.current) {
        artifactZarrLoaderRef.current.clearCaches();
        artifactZarrLoaderRef.current.cancelActiveRequests();
      }
    };
  }, []);

  // Helper function to get wells that intersect with a region
  const getIntersectingWells = useCallback((regionMinX, regionMaxX, regionMinY, regionMaxY) => {
    const wellConfig = getWellPlateConfig();
    if (!wellConfig) return [];
    
    const { well_size_mm, well_spacing_mm, a1_x_mm, a1_y_mm } = wellConfig;
    const layout = getWellPlateLayout();
    const { rows, cols } = layout;
    
    const intersectingWells = [];
    
    rows.forEach((row, rowIndex) => {
      cols.forEach((col, colIndex) => {
        const wellId = `${row}${col}`;
        const wellCenterX = a1_x_mm + colIndex * well_spacing_mm;
        const wellCenterY = a1_y_mm + rowIndex * well_spacing_mm;
        
        // Calculate well boundaries
        const wellRadius = (well_size_mm / 2) + wellPaddingMm;
        const wellMinX = wellCenterX - wellRadius;
        const wellMaxX = wellCenterX + wellRadius;
        const wellMinY = wellCenterY - wellRadius;
        const wellMaxY = wellCenterY + wellRadius;
        
        // Check if well intersects with the region
        const intersects = wellMaxX >= regionMinX && wellMinX <= regionMaxX &&
                         wellMaxY >= regionMinY && wellMinY <= regionMaxY;
        
        if (intersects) {
          intersectingWells.push({
            id: wellId,
            centerX: wellCenterX,
            centerY: wellCenterY,
            rowIndex,
            colIndex,
            radius: wellRadius,
            wellMinX,
            wellMaxX,
            wellMinY,
            wellMaxY
          });
        }
      });
    });
    
    return intersectingWells;
  }, [getWellPlateConfig, getWellPlateLayout, wellPaddingMm]);

  // Helper function to calculate well-relative region for a specific well
  const calculateWellRegion = useCallback((wellInfo, regionMinX, regionMaxX, regionMinY, regionMaxY) => {
    // Calculate intersection of region with well boundaries
    const intersectionMinX = Math.max(regionMinX, wellInfo.wellMinX);
    const intersectionMaxX = Math.min(regionMaxX, wellInfo.wellMaxX);
    const intersectionMinY = Math.max(regionMinY, wellInfo.wellMinY);
    const intersectionMaxY = Math.min(regionMaxY, wellInfo.wellMaxY);
    
    // CRITICAL FIX: Ensure we have a valid intersection for this specific well
    if (intersectionMinX >= intersectionMaxX || intersectionMinY >= intersectionMaxY) {
      console.warn(`⚠️ No valid intersection for well ${wellInfo.id}: intersection bounds (${intersectionMinX.toFixed(3)}, ${intersectionMinY.toFixed(3)}) to (${intersectionMaxX.toFixed(3)}, ${intersectionMaxY.toFixed(3)})`);
      return null;
    }
    
    // Convert to well-relative coordinates (well center is at 0,0)
    const wellRelativeMinX = intersectionMinX - wellInfo.centerX;
    const wellRelativeMaxX = intersectionMaxX - wellInfo.centerX;
    const wellRelativeMinY = intersectionMinY - wellInfo.centerY;
    const wellRelativeMaxY = intersectionMaxY - wellInfo.centerY;
    
    // Calculate center and dimensions for zarr request
    const centerX = (wellRelativeMinX + wellRelativeMaxX) / 2;
    const centerY = (wellRelativeMinY + wellRelativeMaxY) / 2;
    const width_mm = intersectionMaxX - intersectionMinX;
    const height_mm = intersectionMaxY - intersectionMinY;
    
    // DEBUG: Log well-specific calculation details
    console.log(`🔍 Well ${wellInfo.id} region calculation:`);
    console.log(`   Well bounds: (${wellInfo.wellMinX.toFixed(3)}, ${wellInfo.wellMinY.toFixed(3)}) to (${wellInfo.wellMaxX.toFixed(3)}, ${wellInfo.wellMaxY.toFixed(3)})`);
    console.log(`   Region bounds: (${regionMinX.toFixed(3)}, ${regionMinY.toFixed(3)}) to (${regionMaxX.toFixed(3)}, ${regionMaxY.toFixed(3)})`);
    console.log(`   Intersection: (${intersectionMinX.toFixed(3)}, ${intersectionMinY.toFixed(3)}) to (${intersectionMaxX.toFixed(3)}, ${intersectionMaxY.toFixed(3)})`);
    console.log(`   Well-relative center: (${centerX.toFixed(3)}, ${centerY.toFixed(3)}) mm`);
    
    // CRITICAL FIX: Use the intersection bounds directly instead of coordinate transformation
    // The intersection bounds represent the exact region that should be loaded, so they
    // should be used directly as the tile bounds to avoid coordinate transformation errors
    
    return {
      centerX,
      centerY,
      width_mm,
      height_mm,
      intersectionBounds: {
        minX: intersectionMinX,
        maxX: intersectionMaxX,
        minY: intersectionMinY,
        maxY: intersectionMaxY
      }
    };
  }, []);

  // Intelligent tile-based loading function (moved here after all dependencies are defined)
  const loadStitchedTiles = useCallback(async () => {
    console.log('[loadStitchedTiles] Called - checking conditions');
    
    // 🚀 REQUEST CANCELLATION: Only cancel if we're starting a significantly different request
    // Calculate bounds first to generate consistent request key
    if (!canvasRef.current) {
      console.log('[loadStitchedTiles] Canvas not ready, skipping');
      return;
    }
    
    const earlyScaleLevel = Math.max(0, Math.min(4, Math.round(Math.log2(mapScale / 0.25))));
    const earlyActiveChannel = getSelectedChannels()[0] || 'BF LED matrix full';
    const currentViewBounds = {
      topLeft: { x: mapPan.x - canvasRef.current.width / (2 * mapScale), y: mapPan.y - canvasRef.current.height / (2 * mapScale) },
      bottomRight: { x: mapPan.x + canvasRef.current.width / (2 * mapScale), y: mapPan.y + canvasRef.current.height / (2 * mapScale) }
    };
    const currentRequestKey = getTileKey(currentViewBounds, earlyScaleLevel, earlyActiveChannel, selectedHistoricalDataset?.name || 'historical');
    const shouldCancelPrevious = lastRequestKey && lastRequestKey !== currentRequestKey;
    
    if (shouldCancelPrevious && currentCancellableRequest) {
      const cancelledCount = currentCancellableRequest.cancel();
      console.log(`🚫 loadStitchedTiles: Cancelled ${cancelledCount} pending requests (new area)`);
      setCurrentCancellableRequest(null);
      
      // 🚀 CRITICAL FIX: Also cancel ALL active requests in the artifact loader when moving to new area
      if (artifactZarrLoaderRef.current) {
        const artifactCancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
        console.log(`🚫 loadStitchedTiles: Cancelled ${artifactCancelledCount} active artifact requests (new area)`);
      }
    } else if (!shouldCancelPrevious && currentCancellableRequest) {
      console.log(`🔄 loadStitchedTiles: Request for same area already in progress, checking if it should be cancelled anyway`);
      // Cancel anyway if the request is very old (over 30 seconds)
      if (currentCancellableRequest.startTime && (Date.now() - currentCancellableRequest.startTime > 30000)) {
        console.log(`🚫 loadStitchedTiles: Cancelling old request (over 30s old)`);
        const cancelledCount = currentCancellableRequest.cancel();
        console.log(`🚫 loadStitchedTiles: Cancelled ${cancelledCount} old requests`);
        setCurrentCancellableRequest(null);
        
        if (artifactZarrLoaderRef.current) {
          const artifactCancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
          console.log(`🚫 loadStitchedTiles: Cancelled ${artifactCancelledCount} old artifact requests`);
        }
      } else {
        return; // Don't start duplicate requests for the same area
      }
    }
    
    // Update request tracking at the start to prevent duplicate requests
    setLastRequestKey(currentRequestKey);
    
    // Clear active requests to prevent conflicts
    activeTileRequestsRef.current.clear();
    
    console.log(`🔍 [loadStitchedTiles] Channel analysis:`, {
      visibleChannels: visibleLayers.channels,
      selectedChannels: getSelectedChannels(),
      channelString: getChannelString(),
      hasSelectedChannels: hasSelectedChannels()
    });
    
    // 🚀 PERFORMANCE OPTIMIZATION: Throttle tile loading attempts to prevent CPU overload
    const now = Date.now();
    const MIN_LOAD_INTERVAL = 300; // Minimum 0.3 seconds between tile load attempts
    if (now - lastTileLoadAttemptRef.current < MIN_LOAD_INTERVAL) {
      console.log('[loadStitchedTiles] Throttling tile load attempt - too soon since last attempt');
      return;
    }
    lastTileLoadAttemptRef.current = now;
    
    if (mapViewMode !== 'FREE_PAN') {
      console.log('[loadStitchedTiles] Skipping - not in FREE_PAN mode');
      return;
    }

    // Check for visible data layers
    const browseDataLayer = getBrowseDataLayer();
    const scanDataLayer = getScanDataLayer();
    
    // Also check if scan results are enabled (completed scan data)
    const hasScanResults = visibleLayers.scanResults && visibleExperiments.length > 0;
    
    console.log('[loadStitchedTiles] Layer check:', {
      browseDataLayer: browseDataLayer ? browseDataLayer.name : 'none',
      scanDataLayer: scanDataLayer ? scanDataLayer.name : 'none',
      hasScanResults,
      scanResultsEnabled: visibleLayers.scanResults,
      visibleExperiments: visibleExperiments.length,
      totalLayers: layers.length,
      layerTypes: layers.map(l => `${l.name}(${l.type})`).join(', ')
    });
    
    if (!browseDataLayer && !scanDataLayer && !hasScanResults) {
      console.log('[loadStitchedTiles] Skipping - no visible data layers or scan results');
      return;
    }
    
    // Handle browse data layer (previously historical data mode)
    if (browseDataLayer) {
      console.log('[loadStitchedTiles] Browse data layer - checking requirements');
      if (!artifactZarrLoaderRef.current || !selectedHistoricalDataset || !selectedGallery) {
        console.log('[loadStitchedTiles] Skipping browse data - missing requirements');
        // Don't return early - continue to check scan data layer
      } else {
      
      const container = mapContainerRef.current;
      if (!container || !stageDimensions || !pixelsPerMm) return;
      
      // Get the active channel string for API calls
      const activeChannel = getChannelString();
      
      // Calculate visible region in stage coordinates with buffer
      const bufferPercent = 0.2; // 20% buffer around visible area for smoother panning
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      
      // Add buffer to the visible area
      const bufferedLeft = -containerWidth * bufferPercent;
      const bufferedTop = -containerHeight * bufferPercent;
      const bufferedRight = containerWidth * (1 + bufferPercent);
      const bufferedBottom = containerHeight * (1 + bufferPercent);
      
      const topLeft = displayToStageCoords(bufferedLeft, bufferedTop);
      const bottomRight = displayToStageCoords(bufferedRight, bufferedBottom);
      
      // Clamp to stage boundaries
      const clampedTopLeft = {
        x: Math.max(stageDimensions.xMin, topLeft.x),
        y: Math.max(stageDimensions.yMin, topLeft.y)
      };
      const clampedBottomRight = {
        x: Math.min(stageDimensions.xMax, bottomRight.x),
        y: Math.min(stageDimensions.yMax, bottomRight.y)
      };
      
      const bounds = { topLeft: clampedTopLeft, bottomRight: clampedBottomRight };
      
      
      const width_mm = clampedBottomRight.x - clampedTopLeft.x;
      const height_mm = clampedBottomRight.y - clampedTopLeft.y;
      
      // Create a unique request key to prevent duplicate requests
      const requestKey = getTileKey(bounds, scaleLevel, activeChannel, selectedHistoricalDataset?.name || 'historical');
      
      // Check if we're already loading this tile
      if (activeTileRequestsRef.current.has(requestKey)) {
        return;
      }
      
      // Mark this request as active
      activeTileRequestsRef.current.add(requestKey);
      setIsLoadingCanvas(true);
      
      try {
        // Get all possible intersecting wells using well plate configuration
        const allIntersectingWells = getIntersectingWells(
          clampedTopLeft.x, clampedBottomRight.x, 
          clampedTopLeft.y, clampedBottomRight.y
        );
        if (allIntersectingWells.length === 0) {
          if (appendLog) appendLog('Historical data: No wells intersect with this region');
          return;
        }
        // Use artifactZarrLoader to filter only visible wells (center or overlap)
        const visibleWells = artifactZarrLoaderRef.current.getVisibleWellsInRegion(
          allIntersectingWells,
          clampedTopLeft.x, clampedBottomRight.x,
          clampedTopLeft.y, clampedBottomRight.y
        );
        console.log(`📊 Region analysis: (${clampedTopLeft.x.toFixed(3)}, ${clampedTopLeft.y.toFixed(3)}) to (${clampedBottomRight.x.toFixed(3)}, ${clampedBottomRight.y.toFixed(3)})`);
        console.log(`📊 Found ${allIntersectingWells.length} intersecting wells: ${allIntersectingWells.map(w => w.id).join(', ')}`);
        console.log(`📊 Found ${visibleWells.length} visible wells: ${visibleWells.map(w => w.id).join(', ')}`);
        if (visibleWells.length === 0) {
          if (appendLog) appendLog('Historical data: No visible wells in this region');
          return;
        }
        
        // 🚀 OPTIMIZATION: Get available wells from dataset metadata first!
        console.log(`🔍 Getting available wells from dataset metadata...`);
        const availableWellIds = await artifactZarrLoaderRef.current.getAvailableWells(selectedHistoricalDataset.id);
        
        // Filter visible wells to only include those that actually exist
        const existingVisibleWells = visibleWells.filter(well => availableWellIds.includes(well.id));
        
        console.log(`📊 Well filtering: ${visibleWells.length} visible wells, ${availableWellIds.length} available wells, ${existingVisibleWells.length} existing visible wells`);
        
        if (existingVisibleWells.length === 0) {
          if (appendLog) appendLog('Historical data: No existing wells in visible region');
          return;
        }
        
        // 🚀 MAXIMUM SPEED: Process all existing wells in parallel!
        console.log(`🚀 Processing ${existingVisibleWells.length} existing wells in parallel for scale ${scaleLevel}`);
        const startTime = Date.now();
        
        const wellProcessingPromises = existingVisibleWells.map(async (wellInfo) => {
          const wellStartTime = Date.now();
          const wellRegion = calculateWellRegion(
            wellInfo,
            clampedTopLeft.x, clampedBottomRight.x,
            clampedTopLeft.y, clampedBottomRight.y
          );
          
          // Skip wells with no valid intersection
          if (!wellRegion) {
            console.log(`⚠️ Skipping well ${wellInfo.id} - no valid intersection with region`);
            return null;
          }
          
          // Use artifactZarrLoader's proper coordinate conversion instead of simple conversion
          // First, get the metadata to understand the image dimensions and pixel size
          const correctDatasetId = artifactZarrLoaderRef.current.extractDatasetId(selectedHistoricalDataset.id);
          const baseUrl = `${artifactZarrLoaderRef.current.baseUrl}/${correctDatasetId}/zip-files/well_${wellInfo.id}_96.zip/~/data.zarr/`;
          
          // Convert channel name to index (needed for chunk check)
          // For historical data, we need to determine the correct channel index
          // First, try to get available chunks to see what channels are available
          const tempAvailableChunks = await artifactZarrLoaderRef.current.getAvailableChunks(baseUrl, scaleLevel);
          let channelIndex = 0; // Default fallback
          
          if (tempAvailableChunks && tempAvailableChunks.length > 0) {
            // Extract unique channel indices from available chunks
            const channelIndices = [...new Set(tempAvailableChunks.map(chunk => {
              const parts = chunk.split('.');
              return parseInt(parts[1], 10); // Second part is channel index
            }))].sort((a, b) => a - b);
            
            console.log(`🔍 Available channel indices for well ${wellInfo.id}: ${channelIndices.join(', ')}`);
            
            // Use the first available channel (usually the most common one)
            channelIndex = channelIndices[0];
            console.log(`🔍 Using channel index ${channelIndex} for well ${wellInfo.id}`);
          }
          const metadata = await artifactZarrLoaderRef.current.fetchZarrMetadata(baseUrl, scaleLevel);
          
          if (!metadata) {
            console.log(`❌ No metadata available for well ${wellInfo.id} scale ${scaleLevel}`);
            return null;
          }
          
          // Get pixel size for proper coordinate conversion
          const pixelSizeUm = artifactZarrLoaderRef.current.getPixelSizeFromMetadata(metadata, scaleLevel);
          
          // Convert well region coordinates to pixel coordinates using proper method
          const centerPixelCoords = artifactZarrLoaderRef.current.stageToPixelCoords(
            wellRegion.centerX, wellRegion.centerY, scaleLevel, pixelSizeUm, metadata
          );
          
          // Calculate region bounds in pixels
          const halfWidthPx = Math.floor((wellRegion.width_mm * 1000) / (pixelSizeUm * Math.pow(4, scaleLevel)) / 2);
          const halfHeightPx = Math.floor((wellRegion.height_mm * 1000) / (pixelSizeUm * Math.pow(4, scaleLevel)) / 2);
          
          const regionStartX = centerPixelCoords.x - halfWidthPx;
          const regionStartY = centerPixelCoords.y - halfHeightPx;
          const regionEndX = centerPixelCoords.x + halfWidthPx;
          const regionEndY = centerPixelCoords.y + halfHeightPx;
          
          console.log(`🔍 Well ${wellInfo.id} region: center=(${wellRegion.centerX.toFixed(2)}, ${wellRegion.centerY.toFixed(2)}) mm, ` +
                     `pixel center=(${centerPixelCoords.x}, ${centerPixelCoords.y}), ` +
                     `bounds=(${regionStartX}, ${regionStartY}) to (${regionEndX}, ${regionEndY})`);
          
          // Check available chunks for this well and region
          const availableChunks = await artifactZarrLoaderRef.current.getAvailableChunksForRegion(
            selectedHistoricalDataset.id,
            wellInfo.id,
            scaleLevel,
            regionStartX, regionStartY, regionEndX, regionEndY,
            0, channelIndex
          );
          
          const wellEndTime = Date.now();
          const wellDuration = wellEndTime - wellStartTime;
          
          if (availableChunks.length > 0) {
            console.log(`✅ Well ${wellInfo.id} has ${availableChunks.length} available chunks for scale ${scaleLevel} (${wellDuration}ms)`);
            return {
              wellId: wellInfo.id,
              centerX: wellRegion.centerX,
              centerY: wellRegion.centerY,
              width_mm: wellRegion.width_mm,
              height_mm: wellRegion.height_mm,
              channel: activeChannel,
              scaleLevel,
              timepoint: 0,
              datasetId: selectedHistoricalDataset.id,
              outputFormat: 'base64',
              intersectionBounds: wellRegion.intersectionBounds
            };
          } else {
            console.log(`❌ Well ${wellInfo.id} has no available chunks for scale ${scaleLevel} (${wellDuration}ms)`);
            return null;
          }
        });
        
        // Wait for all wells to be processed in parallel
        const wellProcessingResults = await Promise.all(wellProcessingPromises);
        const wellRequests = wellProcessingResults.filter(result => result !== null);
        
        const totalDuration = Date.now() - startTime;
        console.log(`⚡ Parallel well processing completed: ${wellRequests.length}/${visibleWells.length} wells in ${totalDuration}ms`);
        
        if (wellRequests.length === 0) {
          if (appendLog) appendLog('Historical data: No available chunks in visible wells');
          return;
        }

        
        // 🚀 REAL-TIME CHUNK LOADING: Load wells progressively with live updates!
        console.log(`🚀 REAL-TIME: Starting progressive loading for ${wellRequests.length} wells`);
        
        // Check if we should use multi-channel loading
        const useMultiChannel = shouldUseMultiChannelLoading();
        const enabledChannels = useMultiChannel ? getEnabledZarrChannels() : [];
        
        console.log(`🎨 Loading mode: ${useMultiChannel ? 'Multi-channel' : 'Single-channel'}, channels: ${enabledChannels.length}`);
        
        setIsRealTimeLoading(true);
        
        // Clear previous progress
        setRealTimeChunkProgress(new Map());
        setRealTimeWellProgress(new Map());
        
        // Track completed wells for final processing
        const completedWells = new Map();
        
        // Real-time chunk progress callback
        const onChunkProgress = (wellId, loadedChunks, totalChunks, partialCanvas) => {
          console.log(`🔄 REAL-TIME: Well ${wellId} progress: ${loadedChunks}/${totalChunks} chunks loaded`);
          

          
          // 🚀 REAL-TIME TILE UPDATES: Allow frequent updates for smooth progress visualization
          const now = Date.now();
          const lastUpdate = chunkProgressUpdateTimes.current.get(wellId) || 0;
          const UPDATE_INTERVAL = 200; // Only update state every 200ms per well
          
          // Always update progress state for real-time feedback
          setRealTimeChunkProgress(prev => {
            const newProgress = new Map(prev);
            newProgress.set(wellId, { loadedChunks, totalChunks, partialCanvas });
            return newProgress;
          });
          
          // Update last update time
          chunkProgressUpdateTimes.current.set(wellId, now);
          
          // 🚀 FREQUENT TILE UPDATES: Create tiles more frequently for smooth progress visualization
          const progressPercentage = (loadedChunks / totalChunks) * 100;
          
          // Create tiles more frequently for better progress visualization
          const shouldCreateTile = progressPercentage >= 10 && progressPercentage % 10 === 0 || 
                                  loadedChunks % Math.max(1, Math.floor(totalChunks / 10)) === 0 || 
                                  loadedChunks === totalChunks;
          
          if (partialCanvas && loadedChunks > 0 && shouldCreateTile) {
            const wellRequest = wellRequests.find(req => req.wellId === wellId);
            if (!wellRequest) return;
            
            // 🚀 IMPROVED QUALITY: Use higher quality for partial tiles for better visual feedback
            const quality = loadedChunks === totalChunks ? 0.95 : 0.85;
            const partialDataUrl = partialCanvas.toDataURL('image/jpeg', quality);
            
            // Calculate bounds (use intersection bounds for now, will be updated with actual bounds later)
            const wellBounds = {
              topLeft: {
                x: wellRequest.intersectionBounds.minX,
                y: wellRequest.intersectionBounds.minY
              },
              bottomRight: {
                x: wellRequest.intersectionBounds.maxX,
                y: wellRequest.intersectionBounds.maxY
              }
            };
            
            // Create temporary tile with partial data
            const tempTile = {
              data: partialDataUrl,
              bounds: wellBounds,
              width_mm: wellRequest.width_mm,
              height_mm: wellRequest.height_mm,
              scale: scaleLevel,
              channel: useMultiChannel ? 
                enabledChannels.map(ch => ch.channelName).sort().join(',') : 
                activeChannel,
              timestamp: Date.now(),
              isHistorical: true,
              datasetId: selectedHistoricalDataset.id,
              wellId: wellId,
              isPartial: loadedChunks < totalChunks, // Mark as partial for potential cleanup
              progress: `${loadedChunks}/${totalChunks}`,
              metadata: {
                isMultiChannel: useMultiChannel,
                channelsUsed: useMultiChannel ? enabledChannels.map(ch => ch.channelName) : [activeChannel]
              }
            };
            
            // Add or update tile with partial data
            addOrUpdateTile(tempTile);
          }
        };
        
        // Well completion callback
        const onWellComplete = (wellId, finalResult) => {
          console.log(`✅ REAL-TIME: Well ${wellId} completed loading`);
          
          // Store completed well result
          completedWells.set(wellId, finalResult);
          
          // Update well progress
          setRealTimeWellProgress(prev => {
            const newProgress = new Map(prev);
            newProgress.set(wellId, { status: 'completed', result: finalResult });
            return newProgress;
          });
          
          // Create final tile with complete data
          const wellRequest = wellRequests.find(req => req.wellId === wellId);
          if (!wellRequest) return;
          
          // CRITICAL FIX: Use actual stage bounds if available for accurate positioning
          let wellBounds;
          if (finalResult.metadata.actualStageBounds) {
            // Use the actual extracted bounds from zarr loader
            const actualBounds = finalResult.metadata.actualStageBounds;
            // Convert well-relative bounds to absolute bounds
            const wellInfo = existingVisibleWells.find(w => w.id === wellId);
            wellBounds = {
              topLeft: {
                x: wellInfo.centerX + actualBounds.startX,
                y: wellInfo.centerY + actualBounds.startY
              },
              bottomRight: {
                x: wellInfo.centerX + actualBounds.endX,
                y: wellInfo.centerY + actualBounds.endY
              }
            };
            console.log(`🎯 Using actual zarr bounds for ${wellId}: rel(${actualBounds.startX.toFixed(2)}, ${actualBounds.startY.toFixed(2)}) to (${actualBounds.endX.toFixed(2)}, ${actualBounds.endY.toFixed(2)})`);
          } else {
            // Fallback to calculated intersection bounds
            wellBounds = {
              topLeft: {
                x: wellRequest.intersectionBounds.minX,
                y: wellRequest.intersectionBounds.minY
              },
              bottomRight: {
                x: wellRequest.intersectionBounds.maxX,
                y: wellRequest.intersectionBounds.maxY
              }
            };
            console.log(`⚠️ Using fallback intersection bounds for ${wellId}`);
          }
          
          // DIAGNOSTIC: Log coordinate transformation for debugging (condensed)
          const centerX = (wellBounds.topLeft.x + wellBounds.bottomRight.x) / 2;
          const centerY = (wellBounds.topLeft.y + wellBounds.bottomRight.y) / 2;
          console.log(`📍 ${wellId}: rel(${wellRequest.centerX.toFixed(2)}, ${wellRequest.centerY.toFixed(2)}) → center(${centerX.toFixed(1)}, ${centerY.toFixed(1)}) ${finalResult.metadata.width_mm.toFixed(1)}×${finalResult.metadata.height_mm.toFixed(1)}mm`);
          
          // Create final tile with complete data
          const finalTile = {
            data: `data:image/png;base64,${finalResult.data}`,
            bounds: wellBounds,
            width_mm: finalResult.metadata.width_mm,
            height_mm: finalResult.metadata.height_mm,
            scale: scaleLevel,
            channel: useMultiChannel ? 
              finalResult.metadata.channelsUsed?.sort().join(',') || enabledChannels.map(ch => ch.channelName).sort().join(',') : 
              activeChannel,
            timestamp: Date.now(),
            isHistorical: true,
            datasetId: selectedHistoricalDataset.id,
            wellId: wellId,
            isPartial: false, // Mark as complete
            metadata: {
              ...finalResult.metadata,
              isMultiChannel: useMultiChannel,
              channelsUsed: finalResult.metadata.channelsUsed || (useMultiChannel ? enabledChannels.map(ch => ch.channelName) : [activeChannel])
            }
          };
          
          // Replace partial tile with complete tile
          addOrUpdateTile(finalTile);
        };
        
        // 🚀 REQUEST CANCELLATION: Check if we need to cancel previous request
        const currentRequestKey = getTileKey(bounds, scaleLevel, activeChannel, selectedHistoricalDataset?.name || 'historical');
        if (lastRequestKey && lastRequestKey !== currentRequestKey) {
          console.log(`🔄 User moved to new position, cancelling previous request: ${lastRequestKey} → ${currentRequestKey}`);
          if (currentCancellableRequest) {
            const cancelledCount = currentCancellableRequest.cancel();
            console.log(`🚫 Cancelled ${cancelledCount} pending requests for previous position`);
          }
        }
        
        // Update request tracking  
        setLastRequestKey(currentRequestKey);
        
        // Start real-time loading with cancellation support
        const { promise: wellResultsPromise, cancel: cancelWellRequests } = 
          artifactZarrLoaderRef.current.getMultipleWellRegionsRealTimeCancellable(
            wellRequests, 
            onChunkProgress, 
            onWellComplete,
            useMultiChannel,
            enabledChannels
          );
        
        // Store cancellation function for potential future cancellation
        setCurrentCancellableRequest({ 
          cancel: cancelWellRequests, 
          requestKey: currentRequestKey,
          startTime: Date.now()
        });
        
        const wellResults = await wellResultsPromise;
        
        // Process final results
        const successfulResults = wellResults.filter(result => result.success);
        if (successfulResults.length > 0) {
          console.log(`✅ REAL-TIME: Completed loading ${successfulResults.length}/${wellRequests.length} well regions`);
          
          // Clean up old tiles for this scale/channel combination to prevent memory bloat
          // For multi-channel, use the actual channels that were loaded (not all enabled channels)
          const channelKey = useMultiChannel ? 
            (successfulResults[0]?.metadata?.channelsUsed?.sort().join(',') || enabledChannels.map(ch => ch.channelName).sort().join(',')) : 
            getChannelString();
          cleanupOldTiles(scaleLevel, channelKey);
          
          if (appendLog) {
            appendLog(`✅ REAL-TIME: Loaded ${successfulResults.length} historical well tiles for scale ${scaleLevel}`);
          }
        } else {
          console.warn(`No wells available in this region`);
          if (appendLog) appendLog(`No wells available in this region`);
        }
        
        // Clear real-time loading state
        setIsRealTimeLoading(false);
        setRealTimeChunkProgress(new Map());
        setRealTimeWellProgress(new Map());
        
        // 🚀 PERFORMANCE OPTIMIZATION: Clean up progress tracking
        chunkProgressUpdateTimes.current.clear();
        

        
        // Clear cancellation state for completed request
        if (currentCancellableRequest && currentCancellableRequest.requestKey === currentRequestKey) {
          setCurrentCancellableRequest(null);
        }
      } catch (error) {
        console.error('Failed to load historical tiles:', error);
        if (appendLog) appendLog(`Failed to load historical tiles: ${error.message}`);
      } finally {
        // Remove from active requests
        activeTileRequestsRef.current.delete(requestKey);
        
        // Update loading state - check if any requests are still active
        if (activeTileRequestsRef.current.size === 0) {
          setIsLoadingCanvas(false);
        }
      }
    }
    }
    
    // Handle scan data layer (real microscope mode) or scan results
    if (scanDataLayer || hasScanResults) {
      console.log('[loadStitchedTiles] Processing scan data:', scanDataLayer ? `layer: ${scanDataLayer.name}` : 'scan results');
      if (!microscopeControlService || isSimulatedMicroscope) {
        console.log('[loadStitchedTiles] Skipping scan data - no microscope service or simulated mode');
        // Don't return early - browse data might have been loaded
      } else {
        console.log('[loadStitchedTiles] Scan data layer conditions met, proceeding with scan data loading');
    
    // 🚀 PERFORMANCE OPTIMIZATION: Additional check for microscope service availability
    try {
      // Test if microscope service is responsive
      await microscopeControlService.get_status();
    } catch (error) {
      console.log('[loadStitchedTiles] Microscope service not responsive - skipping tile loading');
      if (activeTileRequestsRef.current.size === 0) {
        setIsLoadingCanvas(false);
      }
      return;
    }
    
    const container = mapContainerRef.current;
    if (!container || !stageDimensions || !pixelsPerMm) return;
    
    // Get the active channel string for API calls
    const activeChannel = getChannelString();
    
    // Calculate visible region in stage coordinates with buffer
    const bufferPercent = 0.2; // 20% buffer around visible area for smoother panning
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // Add buffer to the visible area
    const bufferedLeft = -containerWidth * bufferPercent;
    const bufferedTop = -containerHeight * bufferPercent;
    const bufferedRight = containerWidth * (1 + bufferPercent);
    const bufferedBottom = containerHeight * (1 + bufferPercent);
    
    const topLeft = displayToStageCoords(bufferedLeft, bufferedTop);
    const bottomRight = displayToStageCoords(bufferedRight, bufferedBottom);
    
    // Clamp to stage boundaries
    const clampedTopLeft = {
      x: Math.max(stageDimensions.xMin, topLeft.x),
      y: Math.max(stageDimensions.yMin, topLeft.y)
    };
    const clampedBottomRight = {
      x: Math.min(stageDimensions.xMax, bottomRight.x),
      y: Math.min(stageDimensions.yMax, bottomRight.y)
    };
    
    const bounds = { topLeft: clampedTopLeft, bottomRight: clampedBottomRight };
    
    
    const width_mm = clampedBottomRight.x - clampedTopLeft.x;
    const height_mm = clampedBottomRight.y - clampedTopLeft.y;
    
    // Create a unique request key to prevent duplicate requests
    const requestKey = getTileKey(bounds, scaleLevel, activeChannel, 'all-experiments');
    
    // Check if we're already loading this tile
    if (activeTileRequestsRef.current.has(requestKey)) {
      console.log('[loadStitchedTiles] Tile request already in progress - skipping');
      return;
    }
    
    // Mark this request as active
    activeTileRequestsRef.current.add(requestKey);
    setIsLoadingCanvas(true);
    console.log('[loadStitchedTiles] Starting tile fetch for request key:', requestKey);
    
    try {
      // Calculate center coordinates for the new get_stitched_region API
      const centerX = clampedTopLeft.x + (width_mm / 2);
      const centerY = clampedTopLeft.y + (height_mm / 2);
      
      // 🎨 MULTI-LAYER TILE PROCESSING: Load tiles for each visible experiment
      console.log(`🎨 FREE_PAN: Loading tiles for visible experiments: ${visibleExperiments.join(', ')}`);
      console.log(`🎨 FREE_PAN: Current state - visibleExperiments:`, visibleExperiments, 'activeExperiment:', activeExperiment);
      
      // Get experiments to load tiles for
      // If no experiments are specified, load tiles without experiment filter (pass null to API)
      const experimentsToLoad = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : [null]);
      
      if (experimentsToLoad.length === 0) {
        console.warn('🎨 FREE_PAN: No experiments to load tiles for');
        if (appendLog) {
          appendLog('No experiments selected for tile loading');
        }
        return;
      }
      
      // Get enabled channels for FREE_PAN mode
      const enabledChannels = getSelectedChannels().map(channelName => ({
        label: channelName,
        channelName: channelName
      }));
      
      // Prepare services for TileProcessingManager
      const services = {
        microscopeControlService,
        artifactZarrLoader: null // Not needed for FREE_PAN mode
      };
      
      // Load tiles for each experiment
      for (const experimentName of experimentsToLoad) {
        try {
          console.log(`🎨 FREE_PAN: Loading tiles for experiment: ${experimentName}`);
          
          // Prepare tile request for this specific experiment
          const tileRequest = {
            centerX,
            centerY,
            width_mm,
            height_mm,
            wellPlateType,
            scaleLevel,
            timepoint: 0,
            wellPaddingMm,
            bounds,
            experimentName: experimentName // Add experiment name for get_stitched_region API
          };
          
          // Process tiles using TileProcessingManager with per-layer contrast settings
          // Create layer-specific contrast configs for this experiment
          const layerContrastConfigs = {};
          enabledChannels.forEach(channel => {
            const layerId = `${experimentName}-${channel.channelName}`;
            const layerContrast = getLayerContrastSettings(layerId);
            layerContrastConfigs[channel.channelName] = layerContrast;
          });
          
          const processedTile = await TileProcessingManager.processTileChannels(
            enabledChannels,
            tileRequest,
            'FREE_PAN',
            layerContrastConfigs,
            services
          );
          
          if (processedTile && processedTile.data) {
            console.log(`🎨 FREE_PAN: Successfully processed tile for experiment ${experimentName} with ${processedTile.channelsUsed?.length || 0} channels`);
            const newTile = {
              data: processedTile.data,
              bounds: processedTile.bounds,
              width_mm: processedTile.width_mm,
              height_mm: processedTile.height_mm,
              scale: processedTile.scale,
              channel: processedTile.channel,
              timestamp: Date.now(),
              isMerged: processedTile.isMerged,
              channelsUsed: processedTile.channelsUsed,
              experimentName: experimentName || null // Add experiment name to real microscope tiles (null if no experiment)
            };
            
            addOrUpdateTile(newTile);
          } else {
            console.warn(`🎨 FREE_PAN: TileProcessingManager returned empty tile for experiment ${experimentName}, channels: "${getChannelString()}"`);
          }
        } catch (error) {
          console.error(`🎨 FREE_PAN: Failed to load tile for experiment ${experimentName}:`, error);
          if (appendLog) {
            appendLog(`Failed to load tile for experiment ${experimentName}: ${error.message}`);
          }
        }
      }
      
      // Clean up old tiles for this scale/channel combination to prevent memory bloat
      cleanupOldTiles(scaleLevel, getChannelString());
      
      if (appendLog) {
        appendLog(`Loaded tiles for ${experimentsToLoad.length} experiments at scale ${scaleLevel}, region (${clampedTopLeft.x.toFixed(1)}, ${clampedTopLeft.y.toFixed(1)}) to (${clampedBottomRight.x.toFixed(1)}, ${clampedBottomRight.y.toFixed(1)})`);
      }
      
      console.log('[loadStitchedTiles] ✅ Scan data loading completed successfully');
    } catch (error) {
      console.error('Failed to load stitched tile:', error);
      if (appendLog) appendLog(`Failed to load scan tile: ${error.message}`);
    } finally {
      // Remove from active requests
      activeTileRequestsRef.current.delete(requestKey);
      
      // Update loading state - check if any requests are still active
      if (activeTileRequestsRef.current.size === 0) {
        setIsLoadingCanvas(false);
      }
    }
    }
    }
  }, [getBrowseDataLayer, getScanDataLayer, microscopeControlService, visibleLayers.channels, mapViewMode, scaleLevel, displayToStageCoords, stageDimensions, pixelsPerMm, getTileKey, addOrUpdateTile, appendLog, isSimulatedMicroscope, selectedHistoricalDataset, selectedGallery, getIntersectingWells, calculateWellRegion, wellPlateType, realMicroscopeChannelConfigs, zarrChannelConfigs, getEnabledZarrChannels, shouldUseMultiChannelLoading, visibleExperiments, activeExperiment, getLayerContrastSettings]);

  // Add a ref to track previous experiment selection to avoid unnecessary reloads
  const previousExperimentSelectionRef = useRef(null);

  // Effect to load tiles when visible experiments change
  useEffect(() => {
    const scanDataLayer = getScanDataLayer();
    if (mapViewMode === 'FREE_PAN' && scanDataLayer) {
      const activeChannel = getChannelString();
      
      // Check if microscope service is available
      if (!microscopeControlService || isSimulatedMicroscope) {
        console.log('[Visible Experiments] Skipping - no microscope service or simulated mode');
        return;
      }
      
      // Don't load tiles while user is actively interacting
      if (isPanning || isZooming) {
        console.log('[Visible Experiments] Skipping - user is actively interacting (panning:', isPanning, 'zooming:', isZooming, ')');
        return;
      }
      
      // Get current experiment selection string for comparison
      const currentExperimentString = visibleExperiments.sort().join(',');
      
      console.log(`[Experiment Change] Checking: previous='${previousExperimentSelectionRef.current}' current='${currentExperimentString}' visibleExperiments=[${visibleExperiments.join(', ')}]`);
      
      // Check if this is a real experiment change vs just UI update
      // First time (when ref is null), initialize it without triggering reload
      if (previousExperimentSelectionRef.current === null) {
        console.log(`[Experiment Change] First initialization - setting tracking ref to: ${currentExperimentString}`);
        previousExperimentSelectionRef.current = currentExperimentString;
        return;
      }
      
      if (currentExperimentString !== previousExperimentSelectionRef.current) {
        console.log(`[Experiment Change] Detected real experiment change: '${previousExperimentSelectionRef.current}' → '${currentExperimentString}'`);
        
        // Update the ref to track current selection
        previousExperimentSelectionRef.current = currentExperimentString;
        
        // Get experiments to check - same logic as tile loading
        const experimentsToCheck = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : [null]);
        
        // Check if we have tiles for all experiments at current scale/channel
        const missingExperiments = experimentsToCheck.filter(expName => {
          const hasTiles = stitchedTiles.some(tile => 
            tile.scale === scaleLevel && 
            tile.channel === activeChannel &&
            (expName === null ? tile.experimentName === null : tile.experimentName === expName)
          );
          return !hasTiles;
        });
        
        if (missingExperiments.length > 0) {
          const experimentNames = missingExperiments.map(exp => exp === null ? 'no-experiment' : exp);
          console.log(`[Visible Experiments] Missing tiles for experiments: ${experimentNames.join(', ')} - triggering tile load`);
          
          // Set flag to trigger tile loading - loadStitchedTiles will be called by the effect
          // This prevents blackout while preserving visible data
          
          if (appendLog) {
            appendLog(`Experiment visibility changed - loading tiles for: ${experimentNames.join(', ')}`);
          }
          
          // Set flag to trigger tile loading - no need for delays
          setNeedsTileReload(true);
        } else {
          console.log(`[Visible Experiments] All required experiments have tiles: ${experimentsToCheck.join(', ')}`);
        }
      } else {
        console.log(`[Experiment Change] No real experiment change detected - UI update only`);
      }
    }
  }, [visibleExperiments, activeExperiment, mapViewMode, getScanDataLayer, microscopeControlService, isSimulatedMicroscope, scaleLevel, stitchedTiles, getChannelString, isPanning, isZooming, appendLog, setNeedsTileReload]); // Updated to use layer-based logic

  // Debounce tile loading - only load after user stops interacting for 1 second
  const scheduleTileUpdate = useCallback((source = 'unknown') => {
    // 🚀 IMMEDIATE CANCELLATION: Cancel any ongoing requests when scheduling new ones
    if (currentCancellableRequest) {
      const cancelledCount = currentCancellableRequest.cancel();
      console.log(`🚫 scheduleTileUpdate (${source}): Cancelled ${cancelledCount} pending requests`);
      setCurrentCancellableRequest(null);
    }
    
    if (artifactZarrLoaderRef.current) {
      const artifactCancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
      console.log(`🚫 scheduleTileUpdate (${source}): Cancelled ${artifactCancelledCount} active artifact requests`);
    }
    
    // Clear active requests
    activeTileRequestsRef.current.clear();
    setIsLoadingCanvas(false);
    
    console.log(`[scheduleTileUpdate] Called from ${source} - clearing existing timer and scheduling new one`);
    if (canvasUpdateTimerRef.current) {
      console.log('[scheduleTileUpdate] Clearing existing timer');
      clearTimeout(canvasUpdateTimerRef.current);
    }
    canvasUpdateTimerRef.current = setTimeout(() => {
      console.log(`[scheduleTileUpdate] Timer fired from ${source} - calling loadStitchedTiles`);
      loadStitchedTiles();
    }, 300); // Wait 0.3 second after user stops
    console.log(`[scheduleTileUpdate] New timer scheduled for 300ms (source: ${source})`);
  }, [loadStitchedTiles, isLoadingCanvas]);

  // Function to refresh canvas view (can be used by timepoint operations)
  const refreshCanvasView = useCallback(() => {
    if (!isSimulatedMicroscope) {
      // 🚀 REQUEST CANCELLATION: Cancel any pending requests before refreshing
      if (currentCancellableRequest) {
        const cancelledCount = currentCancellableRequest.cancel();
        console.log(`🚫 Refresh: Cancelled ${cancelledCount} pending requests`);
        setCurrentCancellableRequest(null);
      }
      
      // 🚀 CRITICAL FIX: Also cancel ALL active requests in the artifact loader
      if (artifactZarrLoaderRef.current) {
        const artifactCancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
        console.log(`🚫 Refresh: Cancelled ${artifactCancelledCount} active artifact requests`);
      }
      
      // Clear active requests to prevent conflicts
      activeTileRequestsRef.current.clear();
      
      // Directly load new tiles - they will replace old ones automatically
      // This prevents blackout during refresh operations
      loadStitchedTiles();
      
      if (appendLog) {
        appendLog('Refreshing canvas view');
      }
    }
  }, [loadStitchedTiles, appendLog, isSimulatedMicroscope, currentCancellableRequest]);

  // Consolidated tile loading effect - replaces multiple overlapping effects
  const lastTileRequestRef = useRef({ panX: 0, panY: 0, scale: 0, scaleLevel: 0, timestamp: 0 });
  
  useEffect(() => {
    if (mapViewMode !== 'FREE_PAN' || !visibleLayers.scanResults) {
      console.log('[Tile Loading] Skipping - not in FREE_PAN mode or scan results not visible');
      return;
    }

    // Don't trigger tile loading if user is actively interacting
    if (isPanning || isZooming) {
      console.log('[Tile Loading] Skipping - user is actively interacting (panning:', isPanning, 'zooming:', isZooming, ')');
      return;
    }

    // REMOVED: Don't prevent cancellation when tiles are loading - this creates deadlock!
    // The scheduleTileUpdate function now handles cancellation properly

    const container = mapContainerRef.current;
    if (!container) {
      console.log('[Tile Loading] Skipping - no container reference');
      return;
    }

    // Check if this is a significant change that warrants tile loading
    const panThreshold = 80;
    const scaleThreshold = 0.15;
    
    const lastRequest = lastTileRequestRef.current;
    const panChangeX = Math.abs(mapPan.x - lastRequest.panX);
    const panChangeY = Math.abs(mapPan.y - lastRequest.panY);
    const scaleChange = Math.abs(mapScale - lastRequest.scale);
    
    const significantPanChange = panChangeX > panThreshold || panChangeY > panThreshold;
    const significantScaleChange = scaleChange > lastRequest.scale * scaleThreshold;
    
    // Only trigger if there's a significant change and enough time has passed since last request
    const timeSinceLastRequest = Date.now() - lastRequest.timestamp;
    const minTimeBetweenRequests = 500; // 500ms minimum between requests
    
    console.log('[Tile Loading] Checking conditions:', {
      panChangeX: panChangeX.toFixed(1),
      panChangeY: panChangeY.toFixed(1),
      scaleChange: scaleChange.toFixed(3),
      significantPanChange,
      significantScaleChange,
      timeSinceLastRequest: timeSinceLastRequest + 'ms',
      minTimeBetweenRequests: minTimeBetweenRequests + 'ms',
      willTrigger: (significantPanChange || significantScaleChange) && timeSinceLastRequest > minTimeBetweenRequests
    });
    
    if ((significantPanChange || significantScaleChange) && timeSinceLastRequest > minTimeBetweenRequests) {
      console.log('[Tile Loading] TRIGGERING tile update - significant change detected');
      
      // Update last request info
      lastTileRequestRef.current = {
        panX: mapPan.x,
        panY: mapPan.y,
        scale: mapScale,
        scaleLevel: scaleLevel,
        timestamp: Date.now()
      };
      
      // Schedule tile update
      scheduleTileUpdate('tile-loading-effect');
    } else {
      console.log('[Tile Loading] Skipping - no significant change or too soon since last request');
    }
  }, [
    mapViewMode, 
    visibleLayers.scanResults, 
    isPanning, 
    isZooming, 
    mapPan.x, 
    mapPan.y, 
    mapScale, 
    scheduleTileUpdate
  ]);

  // 🚀 REQUEST CANCELLATION: Cleanup effect for cancellable requests (only on actual unmount)
  useEffect(() => {
    return () => {
      // Only cancel on actual component unmount, not on re-renders
      console.log(`🚫 Component cleanup triggered`);
      if (currentCancellableRequest) {
        const cancelledCount = currentCancellableRequest.cancel();
        console.log(`🚫 Component unmount: Cancelled ${cancelledCount} pending requests`);
      }
      
      // 🚀 CRITICAL FIX: Also cancel ALL active requests in the artifact loader
      if (artifactZarrLoaderRef.current) {
        const artifactCancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
        console.log(`🚫 Component unmount: Cancelled ${artifactCancelledCount} active artifact requests`);
      }
    };
  }, []); // Remove dependencies to only run on actual unmount

  // 🚀 SIMPLIFIED: Initial tile loading - only when map first opens and user is not interacting
  const hasInitialLoadedRef = useRef(false);
  useEffect(() => {
    // Only trigger initial load when map first opens
    if (isOpen && !hasInitialLoadedRef.current) {
      hasInitialLoadedRef.current = true;
      
      // Use a longer delay to ensure map is fully initialized
      setTimeout(() => {
        if (mapViewMode === 'FREE_PAN' && !isZooming && !isPanning) {
          console.log('[Initial Tile Loading] Triggering one-time initial tile loading');
          scheduleTileUpdate('initial-loading');
        }
      }, 500); // Delay to ensure everything is ready
    }
    
    // Reset when map closes
    if (!isOpen) {
      hasInitialLoadedRef.current = false;
    }
  }, [isOpen, mapViewMode, isZooming, isPanning, scheduleTileUpdate]); // Added necessary dependencies

  // Effect to trigger tile loading when needsTileReload is set
  useEffect(() => {
    const browseDataLayer = getBrowseDataLayer();
    const scanDataLayer = getScanDataLayer();
    const hasScanResults = visibleLayers.scanResults && visibleExperiments.length > 0;
    if (needsTileReload && mapViewMode === 'FREE_PAN' && (browseDataLayer || scanDataLayer || hasScanResults) && !isZooming && !isPanning) {
      // Check if tiles are currently loading
      if (isLoadingCanvas || activeTileRequestsRef.current.size > 0) {
        console.log('[needsTileReload] Skipping - tiles are currently loading (isLoadingCanvas:', isLoadingCanvas, 'activeRequests:', activeTileRequestsRef.current.size, ')');
        setNeedsTileReload(false); // Reset flag but don't trigger new loading
        return;
      }
      
      console.log('[needsTileReload] Triggering tile reload');
      // Reset the flag
      setNeedsTileReload(false);
      
      // Trigger tile loading after a short delay to ensure tiles are cleared
      setTimeout(() => {
        scheduleTileUpdate('needs-reload');
      }, 100);
    }
  }, [needsTileReload, mapViewMode, getBrowseDataLayer, getScanDataLayer, visibleLayers.scanResults, visibleExperiments, scheduleTileUpdate, isZooming, isPanning]);

  // 🚀 SIMPLIFIED: Only cleanup tiles when scale changes, don't trigger new tile loading
  // This prevents the endless loop while still cleaning up memory
  useEffect(() => {
    const scanDataLayer = getScanDataLayer();
    if (mapViewMode === 'FREE_PAN' && scanDataLayer) {
      const activeChannel = getChannelString();
      console.log('[scaleLevel cleanup] Cleaning up old tiles for memory management');
      cleanupOldTiles(scaleLevel, activeChannel);
      // Tiles will be loaded only when user pans/zooms significantly
    }
  }, [scaleLevel, mapViewMode, getScanDataLayer, cleanupOldTiles, getChannelString]); // Updated to use layer-based logic


  if (!isOpen) return null;

  return (
    <div className="relative w-full h-full bg-black">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-80 p-2 flex justify-between items-center z-10">
        <div className="flex items-center space-x-4">
          {/* Samples and Controls buttons */}
          <div className="flex items-center space-x-2">
            {/* Sample Selection Button */}
            <button 
              onClick={() => setIsSamplePanelOpen(!isSamplePanelOpen)}
              className={`px-3 py-1 text-xs text-white rounded flex items-center ${
                isSamplePanelOpen ? 'bg-green-600 hover:bg-green-500' : 'bg-green-700 hover:bg-green-600'
              }`}
              title={isSamplePanelOpen ? "Close Sample Panel" : "Open Sample Panel"}
            >
              <i className="fas fa-flask mr-1"></i>
              Samples
            </button>

            {/* Control Panel Button */}
            <button 
              onClick={() => setIsControlPanelOpen(!isControlPanelOpen)}
              className={`px-3 py-1 text-xs text-white rounded flex items-center ${
                isControlPanelOpen ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-700 hover:bg-blue-600'
              }`}
              title={isControlPanelOpen ? "Close Control Panel" : "Open Control Panel"}
            >
              <i className="fas fa-cogs mr-1"></i>
              Controls
            </button>

          </div>
          
          {mapViewMode === 'FREE_PAN' && (
            <>
              <div className="flex items-center space-x-2">
                <button
                  onClick={(e) => {
                    if (isInteractionDisabled) return;
                    
                    // Track zoom operation
                    setIsZooming(true);
                    if (zoomTimeoutRef.current) {
                      clearTimeout(zoomTimeoutRef.current);
                    }
                    zoomTimeoutRef.current = setTimeout(() => {
                      setIsZooming(false);
                    }, 500);
                    
                    const newZoom = zoomLevel * 0.9;
                    const rect = mapContainerRef.current.getBoundingClientRect();
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    
                    if (newZoom < 0.25 && scaleLevel < 4) {
                      zoomToPoint(0.25, scaleLevel + 1, centerX, centerY);
                    } else {
                      zoomToPoint(Math.max(0.25, newZoom), scaleLevel, centerX, centerY);
                    }
                  }}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Zoom Out"
                  disabled={isInteractionDisabled || (scaleLevel === 4 && zoomLevel <= 0.25)}
                >
                  <i className="fas fa-search-minus"></i>
                </button>
                <span className="text-white text-xs min-w-[8rem] text-center">
                  Scale {scaleLevel} ({(zoomLevel * 100).toFixed(1)}%)
                </span>
                <button
                  onClick={(e) => {
                    if (isInteractionDisabled) return;
                    
                    // Track zoom operation
                    setIsZooming(true);
                    if (zoomTimeoutRef.current) {
                      clearTimeout(zoomTimeoutRef.current);
                    }
                    zoomTimeoutRef.current = setTimeout(() => {
                      setIsZooming(false);
                    }, 500);
                    
                    const newZoom = zoomLevel * 1.1;
                    const rect = mapContainerRef.current.getBoundingClientRect();
                    const centerX = rect.width / 2;
                    const centerY = rect.height / 2;
                    
                          if (newZoom > 64.0 && scaleLevel > 0) {
        zoomToPoint(0.25, scaleLevel - 1, centerX, centerY);
      } else {
        zoomToPoint(Math.min(64.0, newZoom), scaleLevel, centerX, centerY);
      }
                  }}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Zoom In"
                  disabled={isInteractionDisabled || (scaleLevel === 0 && zoomLevel >= 16.0)}
                >
                  <i className="fas fa-search-plus"></i>
                </button>
                <button
                  onClick={(isInteractionDisabled && !(isSimulatedMicroscope && isHistoricalDataMode)) ? undefined : () => {
                    // Track zoom operation
                    setIsZooming(true);
                    if (zoomTimeoutRef.current) {
                      clearTimeout(zoomTimeoutRef.current);
                    }
                    zoomTimeoutRef.current = setTimeout(() => {
                      setIsZooming(false);
                    }, 500);
                    
                    fitToView();
                  }}
                  className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Fit to View"
                  disabled={isInteractionDisabled && !(isSimulatedMicroscope && isHistoricalDataMode)}
                >
                  <i className="fas fa-crosshairs mr-1"></i>
                  Fit to View
                </button>
                                
              </div>
              
              {/* Annotation dropdown */}
              <div className="relative" ref={annotationDropdownRef}>
                <button
                  onClick={() => setIsAnnotationDropdownOpen(!isAnnotationDropdownOpen)}
                  className={`px-3 py-1 text-xs text-white rounded flex items-center ${
                    isDrawingMode ? 'bg-orange-600 hover:bg-orange-500' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                  title="Annotation tools"
                >
                  <i className="fas fa-draw-polygon mr-1"></i>
                  Annotations
                  <i className={`fas ml-1 transition-transform ${isAnnotationDropdownOpen ? 'fa-caret-up' : 'fa-caret-down'}`}></i>
                </button>
                
                {isAnnotationDropdownOpen && (
                  <div className="absolute top-full right-0 mt-1 z-20">
                    <AnnotationPanel
                      isDrawingMode={isDrawingMode}
                      setIsDrawingMode={setIsDrawingMode}
                      currentTool={currentAnnotationTool}
                      setCurrentTool={setCurrentAnnotationTool}
                      strokeColor={annotationStrokeColor}
                      setStrokeColor={setAnnotationStrokeColor}
                      strokeWidth={annotationStrokeWidth}
                      setStrokeWidth={setAnnotationStrokeWidth}
                      fillColor={annotationFillColor}
                      setFillColor={setAnnotationFillColor}
                      description={annotationDescription}
                      setDescription={setAnnotationDescription}
                      annotations={annotations}
                      onAnnotationDelete={handleAnnotationDelete}
                      onClearAllAnnotations={handleClearAllAnnotations}
                      onExportAnnotations={handleExportAnnotations}
                      onImportAnnotations={handleImportAnnotations}
                      wellInfoMap={annotationWellMap}
                      embeddingStatus={embeddingStatus}
                      mapScale={mapScale}
                      mapPan={mapPan}
                      stageDimensions={stageDimensions}
                      pixelsPerMm={pixelsPerMm}
                      // New props for advanced extraction
                      isHistoricalDataMode={isHistoricalDataMode}
                      microscopeControlService={microscopeControlService}
                      artifactZarrLoader={artifactZarrLoaderRef.current}
                      zarrChannelConfigs={zarrChannelConfigs}
                      realMicroscopeChannelConfigs={realMicroscopeChannelConfigs}
                      enabledZarrChannels={getEnabledZarrChannels()}
                      visibleChannelsConfig={visibleLayers.channels}
                      selectedHistoricalDataset={selectedHistoricalDataset}
                      wellPlateType={wellPlateType}
                      timepoint={0}
                    />
                  </div>
                )}
              </div>
              
              {/* Layer selector dropdown */}
              <div className="relative" ref={layerDropdownRef}>
                <button
                  onClick={() => setIsLayerDropdownOpen(!isLayerDropdownOpen)}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center"
                  title="Toggle layer visibility"
                >
                  <i className="fas fa-layer-group mr-1"></i>
                  Layers
                  <i className={`fas ml-1 transition-transform ${isLayerDropdownOpen ? 'fa-caret-up' : 'fa-caret-down'}`}></i>
                </button>
                
                {isLayerDropdownOpen && (
                  <div className="absolute top-full right-0 mt-1 z-20">
                    <LayerPanel
                      // Map Layers props
                      visibleLayers={visibleLayers}
                      setVisibleLayers={setVisibleLayers}
                      
                      // Experiments props
                      isSimulatedMicroscope={isSimulatedMicroscope}
                      isLoadingExperiments={isLoadingExperiments}
                      activeExperiment={activeExperiment}
                      experiments={experiments}
                      setActiveExperimentHandler={setActiveExperimentHandler}
                      setShowCreateExperimentDialog={setShowCreateExperimentDialog}
                      removeExperiment={removeExperiment}
                      setExperimentToReset={setExperimentToReset}
                      setShowClearCanvasConfirmation={setShowClearCanvasConfirmation}
                      setExperimentToDelete={setExperimentToDelete}
                      setShowDeleteConfirmation={setShowDeleteConfirmation}
                      
                      // Multi-Layer Experiments props
                      visibleExperiments={visibleExperiments}
                      setVisibleExperiments={setVisibleExperiments}
                      
                      // Multi-Channel props
                      shouldUseMultiChannelLoading={shouldUseMultiChannelLoading}
                      mapViewMode={mapViewMode}
                      availableZarrChannels={availableZarrChannels}
                      zarrChannelConfigs={zarrChannelConfigs}
                      updateZarrChannelConfig={updateZarrChannelConfig}
                      getEnabledZarrChannels={getEnabledZarrChannels}
                      realMicroscopeChannelConfigs={realMicroscopeChannelConfigs}
                      updateRealMicroscopeChannelConfig={updateRealMicroscopeChannelConfig}
                      
                      // Per-layer contrast settings
                      layerContrastSettings={layerContrastSettings}
                      updateLayerContrastSettings={updateLayerContrastSettings}
                      getLayerContrastSettings={getLayerContrastSettings}
                      
                      // Experiment creation props
                      microscopeControlService={microscopeControlService}
                      createExperiment={createExperiment}
                      showNotification={showNotification}
                      appendLog={appendLog}
                      
                      // Incubator service for fetching sample info
                      incubatorControlService={incubatorControlService}
                      
                      // Layout props
                      isFovFittedMode={mapViewMode === 'FOV_FITTED'}
                      
                      // Scan configuration props
                      showScanConfig={showScanConfig}
                      setShowScanConfig={setShowScanConfig}
                      showQuickScanConfig={showQuickScanConfig}
                      setShowQuickScanConfig={setShowQuickScanConfig}
                      
                      // Browse data modal props
                      setShowBrowseDataModal={setShowBrowseDataModal}
                      
                      // Historical data mode props
                      isHistoricalDataMode={isHistoricalDataMode}
                      setIsHistoricalDataMode={setIsHistoricalDataMode}
                      
                      // Layer management props
                      layers={layers}
                      setLayers={setLayers}
                      expandedLayers={expandedLayers}
                      setExpandedLayers={setExpandedLayers}
                      
                      // Dropdown control props
                      setIsLayerDropdownOpen={setIsLayerDropdownOpen}
                      
                      // Microscope control props
                      isControlPanelOpen={isControlPanelOpen}
                      setIsControlPanelOpen={setIsControlPanelOpen}
                      
                      // Live video props
                      isWebRtcActive={isWebRtcActive}
                      toggleWebRtcStream={toggleWebRtcStream}
                      currentOperation={currentOperation}
                      microscopeBusy={microscopeBusy}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          
          {mapViewMode === 'FOV_FITTED' && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-300">Zoom: {Math.round(videoZoom * 100)}%</span>
              <span className="text-xs text-gray-400">• Scroll down to see stage map</span>
            </div>
          )}
        </div>
      </div>

      {/* Main display container */}
      <div
        ref={mapContainerRef}
        className={`absolute inset-0 top-12 overflow-hidden ${
          isDrawingMode 
            ? 'cursor-crosshair' 
            : mapViewMode === 'FOV_FITTED' 
              ? (isHardwareInteractionDisabled ? 'cursor-not-allowed' : 'cursor-grab')
              : (isRectangleSelection && !isScanInProgress && !isQuickScanInProgress)
                ? (isHardwareInteractionDisabled ? 'cursor-not-allowed' : 'cursor-crosshair')
                : 'cursor-move'
        } ${isDragging || isPanning ? 'cursor-grabbing' : ''}`}
        onMouseDown={isDrawingMode ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseDown) : handleMapPanning)}
        onMouseMove={isDrawingMode ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseMove) : handleMapPanMove)}
        onMouseUp={isDrawingMode ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseUp) : handleMapPanEnd)}
        onMouseLeave={isDrawingMode ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseLeave) : handleMapPanEnd)}
        onDoubleClick={isHardwareInteractionDisabled ? undefined : (mapViewMode === 'FREE_PAN' && !isRectangleSelection ? handleDoubleClick : undefined)}
                  style={{
            userSelect: 'none',
            transition: isDragging || isPanning ? 'none' : 'transform 0.3s ease-out',
            opacity: isDrawingMode ? 0.9 : 1,
            cursor: (isRectangleSelection && !isScanInProgress && !isQuickScanInProgress) && mapViewMode === 'FREE_PAN' && !isHardwareInteractionDisabled ? 'crosshair' : undefined,
            zIndex: 1 // Ensure map container stays below other UI elements
          }}
      >
        {/* Map canvas for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && (
          <canvas ref={canvasRef} className="absolute inset-0" />
        )}
        
        {/* Stitched scan results tiles layer (below other elements) */}
        {mapViewMode === 'FREE_PAN' && visibleTiles.map((tile, index) => {
          // Calculate z-index for multi-layer experiments
          // Experiments shown later have higher z-index (appear on top)
          const experimentsToShow = visibleExperiments.length > 0 ? visibleExperiments : (activeExperiment ? [activeExperiment] : []);
          const experimentIndex = tile.experimentName ? experimentsToShow.indexOf(tile.experimentName) : -1;
          const baseZIndex = 1;
          const experimentZIndex = experimentIndex >= 0 ? experimentIndex + baseZIndex : baseZIndex;
          
          return (
            <div
              key={`${getTileKey(tile.bounds, tile.scale, tile.channel, tile.experimentName)}_${index}`}
              className="absolute pointer-events-none scan-results-container"
              style={{
                left: `${stageToDisplayCoords(tile.bounds.topLeft.x, tile.bounds.topLeft.y).x}px`,
                top: `${stageToDisplayCoords(tile.bounds.topLeft.x, tile.bounds.topLeft.y).y}px`,
                width: `${tile.width_mm * pixelsPerMm * mapScale}px`,
                height: `${tile.height_mm * pixelsPerMm * mapScale}px`,
                zIndex: experimentZIndex // Multi-layer z-index based on experiment order
              }}
            >
              <img
                src={tile.data}
                alt={`Scan Results Tile (Scale ${tile.scale})`}
                className="w-full h-full"
                style={{
                  objectFit: 'fill', // Fill the container exactly, matching the calculated dimensions
                  objectPosition: 'top left', // Ensure alignment with top-left corner
                  display: 'block' // Remove any inline spacing
                }}
              />
              
              {/* Debug info for tiles */}
              {process.env.NODE_ENV === 'development' && (
                <div className="absolute top-0 left-0 bg-black bg-opacity-50 text-white text-xs p-1">
                  S{tile.scale} {tile.isMerged ? 'MERGED' : tile.channel.substring(0, 3)}
                  {tile.experimentName && (
                    <div className="text-xs opacity-75">
                      Exp: {tile.experimentName.substring(0, 8)}
                    </div>
                  )}
                  {tile.isMerged && tile.channelsUsed && (
                    <div className="text-xs opacity-75">
                      {tile.channelsUsed.map(ch => ch.substring(0, 3)).join('+')}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        
        {/* Loading indicator for canvas */}
        {mapViewMode === 'FREE_PAN' && visibleLayers.scanResults && isLoadingCanvas && (
          <div className="absolute top-2 right-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded" style={{ zIndex: 25 }}>
            <i className="fas fa-spinner fa-spin mr-1"></i>Loading scan results...
          </div>
        )}
        
        {/* Well plate overlay for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && render96WellPlate()}
        
         {/* Annotation Canvas Overlay */}
         <AnnotationCanvas
           containerRef={mapContainerRef}
           isDrawingMode={isDrawingMode}
           currentTool={currentAnnotationTool}
           strokeColor={annotationStrokeColor}
           strokeWidth={annotationStrokeWidth}
           fillColor={annotationFillColor}
           description={annotationDescription}
           mapScale={mapScale}
           mapPan={effectivePan}
           annotations={annotations}
           onAnnotationAdd={handleAnnotationAdd}
           onAnnotationUpdate={handleAnnotationUpdate}
           onAnnotationDelete={handleAnnotationDelete}
           stageDimensions={stageDimensions}
           pixelsPerMm={pixelsPerMm}
           channelInfo={getCurrentChannelInfo()}
         />
        
        {/* Rectangle selection active indicator */}
        {mapViewMode === 'FREE_PAN' && isRectangleSelection && !rectangleStart && !isScanInProgress && !isQuickScanInProgress && (
          <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-blue-600 bg-opacity-90 text-white px-4 py-2 rounded-lg border border-blue-400 animate-pulse" style={{ zIndex: 30 }}>
            <div className="flex items-center space-x-2">
              <i className="fas fa-vector-square text-lg"></i>
              <div>
                <div className="font-medium">Rectangle Selection Active</div>
                <div className="text-xs opacity-90">Click and drag to select scan area</div>
              </div>
            </div>
          </div>
        )}

        {/* Rectangle selection overlay - only show during active selection */}
        {mapViewMode === 'FREE_PAN' && isRectangleSelection && rectangleStart && rectangleEnd && !isScanInProgress && !isQuickScanInProgress && (
          <>
            {/* Well boundary indicator */}
            {dragSelectedWell && (() => {
              const wellBoundaries = getWellBoundaries(dragSelectedWell);
              if (!wellBoundaries) return null;
              
              const wellDisplayTopLeft = stageToDisplayCoords(wellBoundaries.xMin, wellBoundaries.yMin);
              const wellDisplayBottomRight = stageToDisplayCoords(wellBoundaries.xMax, wellBoundaries.yMax);
              
              return (
                <div
                  className="absolute border-2 border-yellow-300 bg-yellow-300 bg-opacity-10 pointer-events-none"
                  style={{
                    left: `${wellDisplayTopLeft.x}px`,
                    top: `${wellDisplayTopLeft.y}px`,
                    width: `${wellDisplayBottomRight.x - wellDisplayTopLeft.x}px`,
                    height: `${wellDisplayBottomRight.y - wellDisplayTopLeft.y}px`,
                    zIndex: 28 // Below selection rectangle
                  }}
                >
                  <div className="absolute top-0 left-0 text-yellow-300 text-xs bg-black bg-opacity-60 px-1 rounded-br">
                    Well {dragSelectedWell.id}
                  </div>
                </div>
              );
            })()}
            
            <div
              className={`absolute border-2 bg-opacity-20 pointer-events-none ${
                isRectangleSelection 
                  ? 'border-blue-400 bg-blue-400' // Active selection - blue
                  : 'border-green-400 bg-green-400' // Fixed grid preview - green
              }`}
              style={{
                left: `${Math.min(rectangleStart.x, rectangleEnd.x)}px`,
                top: `${Math.min(rectangleStart.y, rectangleEnd.y)}px`,
                width: `${Math.abs(rectangleEnd.x - rectangleStart.x)}px`,
                height: `${Math.abs(rectangleEnd.y - rectangleStart.y)}px`,
                zIndex: 30 // High z-index to stay above all map layers
              }}
            />
            {/* FOV preview boxes during rectangle selection */}
            {(() => {
              const topLeft = displayToStageCoords(
                Math.min(rectangleStart.x, rectangleEnd.x),
                Math.min(rectangleStart.y, rectangleEnd.y)
              );
              const bottomRight = displayToStageCoords(
                Math.max(rectangleStart.x, rectangleEnd.x),
                Math.max(rectangleStart.y, rectangleEnd.y)
              );
              const width_mm = bottomRight.x - topLeft.x;
              const height_mm = bottomRight.y - topLeft.y;
              const Nx = Math.max(1, Math.round(width_mm / scanParameters.dx_mm));
              const Ny = Math.max(1, Math.round(height_mm / scanParameters.dy_mm));
              
              // Calculate FOV positions for the selected rectangle
              const fovDisplaySize = fovSize * pixelsPerMm * mapScale;
              const fovPreviews = [];
              
              for (let i = 0; i < Nx; i++) {
                for (let j = 0; j < Ny; j++) {
                  const stageX = topLeft.x + i * scanParameters.dx_mm;
                  const stageY = topLeft.y + j * scanParameters.dy_mm;
                  const displayCoords = stageToDisplayCoords(stageX, stageY);
                  
                  fovPreviews.push(
                    <div
                      key={`preview-fov-${i}-${j}`}
                      className="absolute border border-orange-400 bg-orange-400 bg-opacity-15 pointer-events-none"
                      style={{
                        left: `${displayCoords.x - fovDisplaySize / 2}px`,
                        top: `${displayCoords.y - fovDisplaySize / 2}px`,
                        width: `${fovDisplaySize}px`,
                        height: `${fovDisplaySize}px`,
                        zIndex: 29 // Below info tooltip but above selection rectangle
                      }}
                    >
                      {fovDisplaySize > 20 && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-orange-300 text-xs font-bold bg-black bg-opacity-60 px-1 rounded">
                            {i * Ny + j + 1}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }
              }
              
              return fovPreviews;
            })()}
            
            <div className="absolute bg-black bg-opacity-80 text-white text-xs px-2 py-1 rounded pointer-events-none"
                 style={{
                   left: `${rectangleEnd.x + 10}px`,
                   top: `${rectangleEnd.y + 10}px`,
                   zIndex: 31 // Even higher z-index for the info tooltip
                 }}>
              {(() => {
                const topLeft = displayToStageCoords(
                  Math.min(rectangleStart.x, rectangleEnd.x),
                  Math.min(rectangleStart.y, rectangleEnd.y)
                );
                const bottomRight = displayToStageCoords(
                  Math.max(rectangleStart.x, rectangleEnd.x),
                  Math.max(rectangleStart.y, rectangleEnd.y)
                );
                const width_mm = bottomRight.x - topLeft.x;
                const height_mm = bottomRight.y - topLeft.y;
                const Nx = Math.max(1, Math.round(width_mm / scanParameters.dx_mm));
                const Ny = Math.max(1, Math.round(height_mm / scanParameters.dy_mm));
                
                // Calculate relative coordinates for display
                const relativeTopLeft = dragSelectedWell 
                  ? stageToRelativeCoords(topLeft.x, topLeft.y, dragSelectedWell)
                  : { x: topLeft.x, y: topLeft.y };
                const relativeEndX = relativeTopLeft.x + (Nx-1) * scanParameters.dx_mm;
                const relativeEndY = relativeTopLeft.y + (Ny-1) * scanParameters.dy_mm;
                
                return (
                  <>
                    <div>Well: {dragSelectedWell?.id || 'Unknown'}</div>
                    <div>Relative start: ({relativeTopLeft.x.toFixed(1)}, {relativeTopLeft.y.toFixed(1)}) mm</div>
                    <div>Grid: {Nx} × {Ny} positions</div>
                    <div>Channels: {scanParameters.illumination_settings.length}</div>
                    <div>Total images: {Nx * Ny * scanParameters.illumination_settings.length}</div>
                    <div>Step: {scanParameters.dx_mm} × {scanParameters.dy_mm} mm</div>
                    <div>Relative end: ({relativeEndX.toFixed(1)}, {relativeEndY.toFixed(1)}) mm</div>
                  </>
                );
              })()}
            </div>
          </>
        )}

        {/* FOV boxes preview during scan configuration */}
        {mapViewMode === 'FREE_PAN' && showScanConfig && (() => {
          // For each selected well, show FOV grid overlay
          const layout = getWellPlateLayout();
          const wellConfig = getWellPlateConfig();
          if (!wellConfig) return null;
          return selectedWells.map(wellId => {
            // Find well center - fix the parsing logic for multi-digit column numbers
            const rowIdx = layout.rows.findIndex(r => wellId.startsWith(r));
            // Extract the column number from the well ID (everything after the row letter)
            const colNumber = parseInt(wellId.substring(1));
            const colIdx = layout.cols.findIndex(c => c === colNumber);
            if (rowIdx === -1 || colIdx === -1) return null;
            const centerX = wellConfig.a1_x_mm + colIdx * wellConfig.well_spacing_mm;
            const centerY = wellConfig.a1_y_mm + rowIdx * wellConfig.well_spacing_mm;
            const wellInfo = { id: wellId, centerX, centerY };
            
            const fovPositions = calculateFOVPositionsForWell(wellInfo);
            
            return fovPositions.map((fov, index) => (
                <div
                  key={`fov-${wellId}-${index}`}
                  className="absolute border border-green-400 bg-green-400 bg-opacity-10 pointer-events-none"
                  style={{
                    left: `${fov.x}px`,
                    top: `${fov.y}px`,
                    width: `${fov.width}px`,
                    height: `${fov.height}px`,
                    zIndex: 25
                  }}
                >
                {fov.width > 30 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-green-300 text-xs font-bold bg-black bg-opacity-60 px-1 rounded">
                      {fov.index + 1}
                    </span>
                  </div>
                )}
                {fov.width > 50 && (
                  <div className="absolute top-0 left-0 text-green-300 text-xs bg-black bg-opacity-60 px-1 rounded-br">
                    {fov.stageX.toFixed(1)}, {fov.stageY.toFixed(1)}
                  </div>
                )}
              </div>
            ));
          });
        })()}
        
        {/* Current video frame position indicator */}
        {videoFramePosition && (!isHistoricalDataMode || (isSimulatedMicroscope && isHistoricalDataMode)) && !isHardwareLocked && (
          <div
            className="absolute border-2 border-yellow-400 pointer-events-none"
            style={{
              left: `${videoFramePosition.x - videoFramePosition.width / 2}px`,
              top: `${videoFramePosition.y - videoFramePosition.height / 2}px`,
              width: `${videoFramePosition.width}px`,
              height: `${videoFramePosition.height}px`,
              zIndex: isSimulatedMicroscope ? 100 : 10 // Much higher z-index for simulated microscope
            }}
          >
            {/* Show video content based on mode */}
            {mapViewMode === 'FOV_FITTED' ? (
              // FOV_FITTED mode: Show full-screen video/image
              <div className="w-full h-full flex items-center justify-center">
                {isWebRtcActive && !webRtcError ? (
                  <video 
                    ref={videoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="pointer-events-none"
                    style={{
                      transform: `translate(${dragTransform.x}px, ${dragTransform.y}px) scale(${videoZoom})`,
                      transition: isDragging ? 'none' : 'transform 0.3s ease-out',
                      width: '750px',
                      height: '750px',
                      objectFit: 'contain',
                    }}
                  />
                ) : snappedImageData?.url ? (
                  <>
                    <img
                      src={snappedImageData.url}
                      alt="Microscope Snapshot"
                      className="pointer-events-none"
                      style={{
                        transform: `translate(${dragTransform.x}px, ${dragTransform.y}px) scale(${videoZoom})`,
                        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
                        width: '750px',
                        height: '750px',
                        objectFit: 'contain',
                      }}
                    />
                    {/* ImageJ.js Badge */}
                    {onOpenImageJ && (
                      <button
                        onClick={() => onOpenImageJ(snappedImageData.numpy)}
                        className="imagej-badge absolute top-2 right-2 p-1 bg-white bg-opacity-90 hover:bg-opacity-100 rounded shadow-md transition-all duration-200 flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed z-10"
                        title={imjoyApi ? "Open in ImageJ.js" : "ImageJ.js integration is loading..."}
                        disabled={!imjoyApi}
                        style={{ pointerEvents: 'auto' }}
                      >
                        <img 
                          src="https://ij.imjoy.io/assets/badge/open-in-imagej-js-badge.svg" 
                          alt="Open in ImageJ.js" 
                          className="h-4"
                        />
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-center text-gray-300">
                    {webRtcError ? `WebRTC Error: ${webRtcError}` : (microscopeControlService ? 'Video Display' : 'Microscope not connected')}
                  </p>
                )}
              </div>
            ) : (
              // FREE_PAN mode: Show video in map frame when at high zoom, or snapped image
              scaleLevel <= 3 && (
                isWebRtcActive && remoteStream ? (
                  <video
                    ref={mapVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{
                      backgroundColor: 'transparent',
                      border: '1px solid rgba(255, 255, 0, 0.3)',
                    }}
                  />
                ) : snappedImageData?.url ? (
                  <>
                    <img
                      src={snappedImageData.url}
                      alt="Microscope Snapshot"
                      className="w-full h-full object-cover"
                      style={{
                        backgroundColor: 'transparent',
                        border: '1px solid rgba(255, 255, 0, 0.3)',
                      }}
                    />
                    {/* ImageJ.js Badge for FREE_PAN mode */}
                    {onOpenImageJ && (
                      <button
                        onClick={() => onOpenImageJ(snappedImageData.numpy)}
                        className="imagej-badge absolute top-1 right-1 p-1 bg-white bg-opacity-90 hover:bg-opacity-100 rounded shadow-md transition-all duration-200 flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed z-10"
                        title={imjoyApi ? "Open in ImageJ.js" : "ImageJ.js integration is loading..."}
                        disabled={!imjoyApi}
                        style={{ pointerEvents: 'auto' }}
                      >
                        <img 
                          src="https://ij.imjoy.io/assets/badge/open-in-imagej-js-badge.svg" 
                          alt="Open in ImageJ.js" 
                          className="h-3"
                        />
                      </button>
                    )}
                  </>
                ) : null
              )
            )}

            {/* Stage position label */}
            {currentStagePosition && mapViewMode === 'FREE_PAN' && (
              <div className="absolute -top-6 left-0 text-yellow-400 text-xs whitespace-nowrap">
                X: {currentStagePosition.x.toFixed(2)}mm, Y: {currentStagePosition.y.toFixed(2)}mm
              </div>
            )}
          </div>
        )}
        
        {/* Drag move instructions overlay for FOV_FITTED mode */}
        {mapViewMode === 'FOV_FITTED' && (isWebRtcActive || snapshotImage) && microscopeControlService && !isHardwareInteractionDisabled && !isDragging && (
          <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded pointer-events-none">
            <i className="fas fa-hand-paper mr-1"></i>
            Drag to move stage
          </div>
        )}
        
        {/* Visual feedback during dragging for FOV_FITTED mode */}
        {mapViewMode === 'FOV_FITTED' && isDragging && (
          <div className="absolute top-2 left-2 bg-blue-500 bg-opacity-80 text-white text-xs px-2 py-1 rounded pointer-events-none">
            <i className="fas fa-arrows-alt mr-1"></i>
            Moving stage...
          </div>
        )}
        
        {/* Hardware operations status indicator */}
        {isHardwareInteractionDisabled && (
          <div className="absolute bottom-2 right-2 hardware-status-indicator text-white text-xs px-2 py-1 rounded pointer-events-none">
            <i className="fas fa-cog mr-1"></i>
            {isScanInProgress ? 
              'Hardware locked • Map browsing available' :
              isQuickScanInProgress ?
                'Hardware locked • Map browsing available' :
                currentOperation === 'loading' || currentOperation === 'unloading' ? 
                  `Hardware locked • Map browsing available` : 
                  'Hardware locked • Map browsing available'}
          </div>
        )}
        
        {/* Stage position info for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && currentStagePosition && !isHistoricalDataMode && (
          <div className="absolute bottom-4 left-4 bg-black bg-opacity-80 text-white p-2 rounded text-xs">
            <div>Stage Position:</div>
            <div>X: {currentStagePosition.x.toFixed(3)}mm</div>
            <div>Y: {currentStagePosition.y.toFixed(3)}mm</div>
            <div>Z: {currentStagePosition.z.toFixed(3)}mm</div>
            {microscopeControlService && !isHardwareInteractionDisabled && (
              <div className="mt-1 text-xs text-gray-300 border-t border-gray-600 pt-1">
                <i className="fas fa-mouse-pointer mr-1"></i>
                Double-click to move stage
              </div>
            )}
            {microscopeControlService && isHardwareInteractionDisabled && (
              <div className="mt-1 text-xs text-orange-300 border-t border-gray-600 pt-1">
                <i className="fas fa-lock mr-1"></i>
                Stage movement locked
              </div>
            )}
          </div>
        )}

      </div>

      {/* Video contrast controls - positioned below the video frame */}
      {isWebRtcActive && (
        <div 
          className={`absolute bottom-2 right-2 bg-black bg-opacity-80 p-2 rounded text-white max-w-xs ${isHardwareInteractionDisabled ? 'opacity-75' : ''}`}
          style={{ zIndex: 30 }}
        >
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-medium">Video Contrast</span>
              {isDataChannelConnected && (
                <i className="fas fa-circle text-green-500" style={{ fontSize: '4px' }} title="Metadata connected"></i>
              )}
            </div>
            <button
              onClick={() => !isHardwareInteractionDisabled && setIsContrastControlsCollapsed(!isContrastControlsCollapsed)}
              className="text-xs text-gray-300 hover:text-white p-1 disabled:cursor-not-allowed disabled:opacity-75"
              title={isContrastControlsCollapsed ? "Show contrast controls" : "Hide contrast controls"}
              disabled={isHardwareInteractionDisabled}
            >
              <i className={`fas ${isContrastControlsCollapsed ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
            </button>
          </div>
          
          {!isContrastControlsCollapsed && (
            <>
              {/* Auto Contrast Toggle */}
              <div className="flex items-center mb-1">
                <span className="text-xs text-gray-300 mr-2">Auto</span>
                <label className="auto-contrast-toggle">
                  <input
                    type="checkbox"
                    checked={autoContrastEnabled}
                    onChange={(e) => !isHardwareInteractionDisabled && setAutoContrastEnabled(e.target.checked)}
                    disabled={!isDataChannelConnected || isHardwareInteractionDisabled}
                  />
                  <span className="auto-contrast-slider"></span>
                </label>
              </div>
              
              {/* Histogram Display */}
              {frameMetadata && frameMetadata.gray_level_stats && (
                <div className="mb-1">
                  {renderHistogramDisplay()}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Experiment Management Dialogs */}
      {renderDialogs()}

      {/* Quick Scan Configuration Side Panel */}
      <QuickScanConfig
        // State props
        showQuickScanConfig={showQuickScanConfig}
        setShowQuickScanConfig={setShowQuickScanConfig}
        quickScanParameters={quickScanParameters}
        setQuickScanParameters={setQuickScanParameters}
        isQuickScanInProgress={isQuickScanInProgress}
        setIsQuickScanInProgress={setIsQuickScanInProgress}
        activeExperiment={activeExperiment}
        wellPaddingMm={wellPaddingMm}
        
        // Service props
        microscopeControlService={microscopeControlService}
        appendLog={appendLog}
        showNotification={showNotification}
        
        // Input validation hooks
        quickStripesInput={quickStripesInput}
        quickStripeWidthInput={quickStripeWidthInput}
        quickDyInput={quickDyInput}
        quickExposureInput={quickExposureInput}
        quickIntensityInput={quickIntensityInput}
        quickVelocityInput={quickVelocityInput}
        quickFpsInput={quickFpsInput}
      />

      {/* Normal Scan Configuration Side Panel */}
      <NormalScanConfig
        // State props
        showScanConfig={showScanConfig}
        setShowScanConfig={setShowScanConfig}
        scanParameters={scanParameters}
        setScanParameters={setScanParameters}
        isScanInProgress={isScanInProgress}
        setIsScanInProgress={setIsScanInProgress}
        activeExperiment={activeExperiment}
        wellPaddingMm={wellPaddingMm}
        wellPlateType={wellPlateType}
        selectedWells={selectedWells}
        setSelectedWells={setSelectedWells}
        isRectangleSelection={isRectangleSelection}
        setIsRectangleSelection={setIsRectangleSelection}
        rectangleStart={rectangleStart}
        setRectangleStart={setRectangleStart}
        rectangleEnd={rectangleEnd}
        setRectangleEnd={setRectangleEnd}
        dragSelectedWell={dragSelectedWell}
        setDragSelectedWell={setDragSelectedWell}
        gridSelectedCells={gridSelectedCells}
        setGridSelectedCells={setGridSelectedCells}
        gridDragStart={gridDragStart}
        setGridDragStart={setGridDragStart}
        gridDragEnd={gridDragEnd}
        setGridDragEnd={setGridDragEnd}
        isGridDragging={isGridDragging}
        setIsGridDragging={setIsGridDragging}
        visibleLayers={visibleLayers}
        setVisibleLayers={setVisibleLayers}
        refreshScanResults={refreshScanResults}
        
        // Service props
        microscopeControlService={microscopeControlService}
        appendLog={appendLog}
        showNotification={showNotification}
        isWebRtcActive={isWebRtcActive}
        toggleWebRtcStream={toggleWebRtcStream}
        setMicroscopeBusy={setMicroscopeBusy}
        setCurrentOperation={setCurrentOperation}
        
        // Input validation hooks
        startXInput={startXInput}
        startYInput={startYInput}
        nxInput={nxInput}
        nyInput={nyInput}
        dxInput={dxInput}
        dyInput={dyInput}
        
        // Helper functions
        getWellPlateGridLabels={getWellPlateGridLabels}
        getWellIdFromIndex={getWellIdFromIndex}
        loadCurrentMicroscopeSettings={loadCurrentMicroscopeSettings}
      />

      {/* Browse Data Modal */}
      {showBrowseDataModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-3xl w-full text-white">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-database text-blue-400 mr-2"></i>
                Browse Imaging Data
              </h3>
              <button
                onClick={() => setShowBrowseDataModal(false)}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>
            {/* Notice */}
            <div className="bg-blue-900 bg-opacity-40 text-blue-200 text-xs p-2 px-4 border-b border-blue-700">
              This is for data browsing, for management, please go to <a href="https://hypha.aicell.io/agent-lens#artifacts" target="_blank" rel="noopener noreferrer" className="underline text-blue-300">https://hypha.aicell.io/agent-lens#artifacts</a> if you have access.
            </div>
            {/* Modal Body: Two columns */}
            <div className="flex flex-row divide-x divide-gray-700" style={{ minHeight: '350px' }}>
              {/* Experiments/Galleries List (Left) */}
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="text-gray-300 font-medium mb-2">All Experiment Galleries</div>
                {galleriesLoading && <div className="text-xs text-gray-400">Loading galleries...</div>}
                {galleriesError && <div className="text-xs text-red-400">{galleriesError}</div>}
                {!galleriesLoading && !galleriesError && galleries.length === 0 && (
                  <div className="text-xs text-gray-400">No galleries found.</div>
                )}
                <ul className="space-y-1">
                  {galleries.map(gal => (
                    <li key={gal.id}>
                      <button
                        className={`w-full text-left px-2 py-1 rounded ${selectedGallery && selectedGallery.id === gal.id ? 'bg-blue-700 text-white' : 'bg-gray-700 text-gray-200 hover:bg-blue-800'}`}
                        onClick={() => setSelectedGallery(gal)}
                      >
                        {gal.manifest?.name || gal.alias || gal.id}
                      </button>
                    </li>
                  ))}
                </ul>
                {/* View Gallery in Map Button */}
                <div className="mt-4 flex justify-end">
                  <button
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!selectedGallery}
                    onClick={() => {
                      setShowBrowseDataModal(false);
                      setIsHistoricalDataMode(true);
                      setStitchedTiles([]); // Clear all loaded tiles
                      
                      // Create a Browse Data layer if it doesn't exist
                      setLayers(prev => {
                        const existingBrowseLayer = prev.find(layer => layer.type === 'load-server');
                        if (!existingBrowseLayer) {
                          const browseDataLayer = {
                            id: `browse-data-${Date.now()}`,
                            name: 'Browse Data',
                            type: 'load-server',
                            visible: true,
                            channels: [],
                            readonly: true
                          };
                          return [...prev, browseDataLayer];
                        }
                        return prev;
                      });
                    }}
                  >
                    <i className="fas fa-map-marked-alt mr-1"></i>
                    View Gallery in Map
                  </button>
                </div>
              </div>
              {/* Datasets List (Right) */}
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="text-gray-300 font-medium mb-2">Datasets</div>
                {!selectedGallery && <div className="text-xs text-gray-400">Select a gallery to view datasets.</div>}
                {datasetsLoading && <div className="text-xs text-gray-400">Loading datasets...</div>}
                {datasetsError && <div className="text-xs text-red-400">{datasetsError}</div>}
                {!datasetsLoading && !datasetsError && selectedGallery && datasets.length === 0 && (
                  <div className="text-xs text-gray-400">No datasets found in this gallery.</div>
                )}
                <ul className="space-y-1">
                  {datasets.map(ds => (
                    <li key={ds.id}>
                      <div className="px-2 py-1 rounded bg-gray-700 text-gray-200">
                        {ds.manifest?.name || ds.alias || ds.id}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Historical Timeline - positioned at bottom of main container */}
      {isHistoricalDataMode && selectedGallery && datasets.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-50">
          <div className="historical-timeline-container">
            <div className="historical-timeline-line">
              {datasets.map((ds, idx) => {
                const isSelected = selectedHistoricalDataset && selectedHistoricalDataset.id === ds.id;
                // Adjust position to account for sidebar and window edges
                let position;
                if (datasets.length === 1) {
                  position = 50; // Center if only one dataset
                } else {
                  // Use a smaller range to avoid edges: 10% to 90% instead of 0% to 100%
                  position = 10 + (idx / (datasets.length - 1)) * 80;
                }
                return (
                  <div
                    key={ds.id}
                    className={`historical-timeline-point${isSelected ? ' selected' : ''}`}
                    style={{ left: `${position}%` }}
                    onClick={() => setSelectedHistoricalDataset(ds)}
                    title={ds.manifest?.name || ds.alias || ds.id}
                  >
                    <div className="historical-timeline-dot" />
                    <div className="historical-timeline-tooltip">
                      <div className="tooltip-content">
                        <div className="tooltip-title">{ds.manifest?.name || ds.alias || ds.id}</div>
                        <div className="tooltip-details">
                          <div>ID: {ds.id}</div>
                          {ds.manifest?.description && <div>Description: {ds.manifest.description}</div>}
                          {ds.manifest?.created_at && <div>Created: {new Date(ds.manifest.created_at).toLocaleString()}</div>}
                          {ds.manifest?.size && <div>Size: {ds.manifest.size}</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Real-time chunk loading progress overlay */}
      {renderRealTimeProgress()}
      
    </div>
  );
};

MicroscopeMapDisplay.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  microscopeConfiguration: PropTypes.object,
  isWebRtcActive: PropTypes.bool,
  videoRef: PropTypes.object,
  remoteStream: PropTypes.object,
  frameMetadata: PropTypes.object,
  videoZoom: PropTypes.number,
  setVideoZoom: PropTypes.func,
  snapshotImage: PropTypes.string,
  snappedImageData: PropTypes.object,
  isDragging: PropTypes.bool,
  dragTransform: PropTypes.object,
  microscopeControlService: PropTypes.object,
  appendLog: PropTypes.func,
  showNotification: PropTypes.func,
  fallbackStagePosition: PropTypes.object,
  onOpenImageJ: PropTypes.func,
  imjoyApi: PropTypes.object,
  webRtcError: PropTypes.string,
  microscopeBusy: PropTypes.bool,
  setMicroscopeBusy: PropTypes.func,
  currentOperation: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  setCurrentOperation: PropTypes.func,
  videoContrastMin: PropTypes.number,
  setVideoContrastMin: PropTypes.func,
  videoContrastMax: PropTypes.number,
  setVideoContrastMax: PropTypes.func,
  autoContrastEnabled: PropTypes.bool,
  setAutoContrastEnabled: PropTypes.func,
  autoContrastMinAdjust: PropTypes.number,
  setAutoContrastMinAdjust: PropTypes.func,
  autoContrastMaxAdjust: PropTypes.number,
  setAutoContrastMaxAdjust: PropTypes.func,
  isDataChannelConnected: PropTypes.bool,
  isContrastControlsCollapsed: PropTypes.bool,
  setIsContrastControlsCollapsed: PropTypes.func,
  selectedMicroscopeId: PropTypes.string,
  onMouseDown: PropTypes.func,
  onMouseMove: PropTypes.func,
  onMouseUp: PropTypes.func,
  onMouseLeave: PropTypes.func,
  toggleWebRtcStream: PropTypes.func,
  onFreePanAutoCollapse: PropTypes.func,
  onFitToViewUncollapse: PropTypes.func,
  sampleLoadStatus: PropTypes.object,
  // Panel control props
  isSamplePanelOpen: PropTypes.bool,
  setIsSamplePanelOpen: PropTypes.func,
  isControlPanelOpen: PropTypes.bool,
  setIsControlPanelOpen: PropTypes.func,
  // Sample selector props
  incubatorControlService: PropTypes.object,
  orchestratorManagerService: PropTypes.object,
  onSampleLoadStatusChange: PropTypes.func,
};

export default MicroscopeMapDisplay; 
