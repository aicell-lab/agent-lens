import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useValidatedNumberInput, getInputValidationClasses } from '../utils'; // Import validation utilities
import ArtifactZarrLoader from '../services/artifactZarrLoader.js';
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

  // Tile-based canvas state (replacing single stitchedCanvasData)
  const [stitchedTiles, setStitchedTiles] = useState([]); // Array of tile objects
  const [isLoadingCanvas, setIsLoadingCanvas] = useState(false);
  const [needsTileReload, setNeedsTileReload] = useState(false); // Flag to trigger tile loading after refresh
  const canvasUpdateTimerRef = useRef(null);
  const activeTileRequestsRef = useRef(new Set()); // Track active requests to prevent duplicates
  const chunkProgressUpdateTimes = useRef(new Map()); // Track last update time for each well to throttle progress updates
  const lastTileLoadAttemptRef = useRef(0); // Track last tile load attempt to prevent excessive retries

  // Function to refresh scan results (moved early to avoid dependency issues)
  const refreshScanResults = useCallback(() => {
    if (visibleLayers.scanResults && !isSimulatedMicroscope) {
      // Clear active requests
      activeTileRequestsRef.current.clear();
      
      // Clear all existing tiles to force reload of fresh data
      setStitchedTiles([]);
      
      if (appendLog) {
        appendLog('Refreshing scan results display - cleared cache');
      }
      
      // Set a flag to trigger tile loading after tiles are cleared
      setNeedsTileReload(true);
    }
  }, [visibleLayers.scanResults, appendLog, isSimulatedMicroscope]);

  // Clear canvas confirmation dialog state
  const [showClearCanvasConfirmation, setShowClearCanvasConfirmation] = useState(false);
  const [experimentToReset, setExperimentToReset] = useState(null);

  // Experiment management state (replacing fileset management)
  const [experiments, setExperiments] = useState([]);
  const [activeExperiment, setActiveExperiment] = useState(null);
  const [isLoadingExperiments, setIsLoadingExperiments] = useState(false);
  const [showCreateExperimentDialog, setShowCreateExperimentDialog] = useState(false);
  const [newExperimentName, setNewExperimentName] = useState('');
  const [experimentInfo, setExperimentInfo] = useState(null);

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

  // State to track the well being selected during drag operations
  const [dragSelectedWell, setDragSelectedWell] = useState(null);

  // Add state for historical data mode
  const [isHistoricalDataMode, setIsHistoricalDataMode] = useState(false);

  // Add state for real-time chunk loading progress
  const [realTimeChunkProgress, setRealTimeChunkProgress] = useState(new Map());
  const [realTimeWellProgress, setRealTimeWellProgress] = useState(new Map());
  const [isRealTimeLoading, setIsRealTimeLoading] = useState(false);
  
  // 🚀 REQUEST CANCELLATION: Track cancellable requests
  const [currentCancellableRequest, setCurrentCancellableRequest] = useState(null);
  const [lastRequestKey, setLastRequestKey] = useState(null);

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

  // Experiment management functions (replacing fileset functions)
  const loadExperiments = useCallback(async () => {
    if (!microscopeControlService || isSimulatedMicroscope) return;
    
    setIsLoadingExperiments(true);
    try {
      const result = await microscopeControlService.list_experiments();
      if (result.success !== false) {
        setExperiments(result.experiments || []);
        setActiveExperiment(result.active_experiment || null);
        if (appendLog) {
          appendLog(`Loaded ${result.total_count} experiments, active: ${result.active_experiment || 'none'}`);
        }
      }
    } catch (error) {
      console.error('Failed to load experiments:', error);
      if (appendLog) appendLog(`Failed to load experiments: ${error.message}`);
    } finally {
      setIsLoadingExperiments(false);
    }
  }, [microscopeControlService, isSimulatedMicroscope, appendLog]);

  const createExperiment = useCallback(async (name) => {
    if (!microscopeControlService || !name.trim()) return;
    
    try {
      const result = await microscopeControlService.create_experiment(name.trim());
      if (result.success !== false) {
        if (showNotification) showNotification(`Created experiment: ${name}`, 'success');
        if (appendLog) appendLog(`Created experiment: ${name}`);
        await loadExperiments(); // Refresh the list
      } else {
        if (showNotification) showNotification(`Failed to create experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to create experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error creating experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error creating experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments]);

  const setActiveExperimentHandler = useCallback(async (experimentName) => {
    if (!microscopeControlService || !experimentName) return;
    
    try {
      const result = await microscopeControlService.set_active_experiment(experimentName);
      if (result.success !== false) {
        if (showNotification) showNotification(`Activated experiment: ${experimentName}`, 'success');
        if (appendLog) appendLog(`Set active experiment: ${experimentName}`);
        await loadExperiments(); // Refresh the list
        // Refresh scan results if visible
        if (visibleLayers.scanResults) {
          setTimeout(() => {
            refreshScanResults();
          }, 100);
        }
        
        // Refresh canvas view to show new experiment data
        setTimeout(() => {
          refreshCanvasView();
        }, 200);
      } else {
        if (showNotification) showNotification(`Failed to activate experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to activate experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error activating experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error activating experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments, visibleLayers.scanResults, refreshScanResults]);

  const removeExperiment = useCallback(async (experimentName) => {
    if (!microscopeControlService || !experimentName) return;
    
    try {
      const result = await microscopeControlService.remove_experiment(experimentName);
      if (result.success !== false) {
        if (showNotification) showNotification(`Removed experiment: ${experimentName}`, 'success');
        if (appendLog) appendLog(`Removed experiment: ${experimentName}`);
        await loadExperiments(); // Refresh the list
      } else {
        if (showNotification) showNotification(`Failed to remove experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to remove experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error removing experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error removing experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments]);



  const getExperimentInfo = useCallback(async (experimentName) => {
    if (!microscopeControlService || !experimentName) return;
    
    try {
      const result = await microscopeControlService.get_experiment_info(experimentName);
      if (result.success !== false) {
        setExperimentInfo(result);
        if (appendLog) appendLog(`Loaded experiment info for: ${experimentName}`);
      } else {
        if (showNotification) showNotification(`Failed to get experiment info: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to get experiment info: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error getting experiment info: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error getting experiment info: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog]);

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
  const isHardwareInteractionDisabled = (isHistoricalDataMode && !(isSimulatedMicroscope && isHistoricalDataMode)) || microscopeBusy || currentOperation !== null || isScanInProgress || isQuickScanInProgress;
  const isMapBrowsingDisabled = false; // Allow map browsing during all operations for real-time scan result viewing
  
  // Legacy compatibility - some UI elements still use the general disabled state
  const isInteractionDisabled = isHardwareInteractionDisabled;

  // Handle panning (only in FREE_PAN mode)
  const handleMapPanning = (e) => {
    if (mapViewMode !== 'FREE_PAN' || isMapBrowsingDisabled) return;
    
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
    
    if (isPanning && mapViewMode === 'FREE_PAN' && !isMapBrowsingDisabled) {
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
    
    if (isMapBrowsingDisabled) {
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
    if (isSimulatedMicroscope && isHistoricalDataMode) {
      console.log('[Simulated Microscope] Quitting historical data mode when switching to FOV_FITTED');
      setIsHistoricalDataMode(false);
      setSelectedHistoricalDataset(null);
      setSelectedGallery(null);
      setStitchedTiles([]); // Clear historical tiles
    }
    
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
    
    if (isMapBrowsingDisabled) return;
    
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
  const getTileKey = useCallback((bounds, scale, channel) => {
    // For merged channels, use the sorted channel string to ensure consistent keys
    const normalizedChannel = channel.includes(',') ? channel.split(',').sort().join(',') : channel;
    return `${bounds.topLeft.x.toFixed(1)}_${bounds.topLeft.y.toFixed(1)}_${bounds.bottomRight.x.toFixed(1)}_${bounds.bottomRight.y.toFixed(1)}_${scale}_${normalizedChannel}`;
  }, []);

  // Memoize visible tiles with smart cleanup strategy
  const visibleTiles = useMemo(() => {
    if (!visibleLayers.scanResults) return [];
    
    const channelString = getChannelString();
    
    // Get tiles for current scale and channel selection
    const currentScaleTiles = stitchedTiles.filter(tile => 
      tile.scale === scaleLevel && 
      tile.channel === channelString
    );
    
    if (currentScaleTiles.length > 0) {
      // If we have current scale tiles, only show current scale
      return currentScaleTiles;
    }
    
    // If no current scale tiles, show lower resolution (higher scale number) tiles as fallback
    // This prevents showing high-res tiles when zoomed out (which would be wasteful)
    const availableScales = [...new Set(stitchedTiles.map(tile => tile.scale))]
      .filter(scale => scale >= scaleLevel) // Only show equal or lower resolution
      .sort((a, b) => a - b); // Sort ascending (lower numbers = higher resolution)
    
    for (const scale of availableScales) {
      const scaleTiles = stitchedTiles.filter(tile => 
        tile.scale === scale && 
        tile.channel === channelString
      );
      if (scaleTiles.length > 0) {
        return scaleTiles;
      }
    }
    
    return [];
  }, [stitchedTiles, scaleLevel, visibleLayers.channels, visibleLayers.scanResults, getSelectedChannels, getChannelString]);

  const addOrUpdateTile = useCallback((newTile) => {
    setStitchedTiles(prevTiles => {
      const tileKey = getTileKey(newTile.bounds, newTile.scale, newTile.channel);
      const existingIndex = prevTiles.findIndex(tile => 
        getTileKey(tile.bounds, tile.scale, tile.channel) === tileKey
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
  }, []);

  // Effect to clean up old tiles when channel changes  
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults) {
      // Trigger cleanup of old tiles after a delay to allow new ones to load
      const cleanupTimer = setTimeout(() => {
        cleanupOldTiles(scaleLevel, getChannelString());
      }, 1000);
      
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
        // In FREE_PAN mode, use map video ref for scales 0-1
        if (scaleLevel <= 1) {
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
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }
    
    // Clear canvas
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
  }, [isOpen, stageDimensions, mapScale, effectivePan, visibleLayers.wellPlate, containerSize]);

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

  // Effect to refresh tiles when channel selection changes
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults && !isSimulatedMicroscope) {
      // Clear existing tiles to force reload with new channel selection
      setStitchedTiles([]);
      activeTileRequestsRef.current.clear();
      
      // Schedule tile loading after a short delay
      const refreshTimer = setTimeout(() => {
        if (appendLog) {
          const selectedChannels = Object.entries(visibleLayers.channels)
            .filter(([, isVisible]) => isVisible)
            .map(([channelName]) => channelName);
          const channelList = selectedChannels.length > 0 ? selectedChannels : ['BF LED matrix full'];
          appendLog(`Channel selection changed to: ${channelList.join(', ')} - refreshing tiles`);
        }
        // We'll trigger the tile update through a state change rather than calling scheduleTileUpdate directly
        setNeedsTileReload(true);
      }, 500);
      
      return () => clearTimeout(refreshTimer);
    }
  }, [visibleLayers.channels, mapViewMode, visibleLayers.scanResults, isSimulatedMicroscope, appendLog]);

  // Helper function to check if a region is covered by existing tiles
  const isRegionCovered = useCallback((bounds, scale, channel, existingTiles) => {
    const tilesForScaleAndChannel = existingTiles.filter(tile => 
      tile.scale === scale && tile.channel === channel
    );
    
    // Check if the requested region is fully covered by existing tiles
    for (const tile of tilesForScaleAndChannel) {
      if (tile.bounds.topLeft.x <= bounds.topLeft.x &&
          tile.bounds.topLeft.y <= bounds.topLeft.y &&
          tile.bounds.bottomRight.x >= bounds.bottomRight.x &&
          tile.bounds.bottomRight.y >= bounds.bottomRight.y) {
        
        // Check if tile is potentially stale (older than 10 seconds)
        const tileAge = Date.now() - (tile.timestamp || 0);
        const maxTileAge = 10000; // 10 seconds
        
        if (tileAge > maxTileAge) {
          // Tile is stale, don't consider region as covered
          return false;
        }
        
        return true;
      }
    }
    return false;
  }, []);


  


  // Function to reset experiment after confirmation
  const handleResetExperiment = useCallback(async () => {
    if (!microscopeControlService || !experimentToReset) return;
    
    try {
      const result = await microscopeControlService.reset_experiment(experimentToReset);
      if (result.success !== false) {
        setStitchedTiles([]);
        activeTileRequestsRef.current.clear();
        if (showNotification) showNotification(`Experiment '${experimentToReset}' reset successfully`, 'success');
        if (appendLog) appendLog(`Experiment '${experimentToReset}' reset successfully`);
        // Refresh experiments list
        await loadExperiments();
      } else {
        if (showNotification) showNotification(`Failed to reset experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to reset experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Failed to reset experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Failed to reset experiment: ${error.message}`);
    } finally {
      setShowClearCanvasConfirmation(false);
      setExperimentToReset(null);
    }
  }, [microscopeControlService, experimentToReset, showNotification, appendLog, loadExperiments]);
  
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

  // Load experiments when layer dropdown is opened
  useEffect(() => {
    if (isLayerDropdownOpen && !isSimulatedMicroscope) {
      loadExperiments();
      // Also get experiment info for the active experiment
      if (activeExperiment) {
        getExperimentInfo(activeExperiment);
      }
    }
  }, [isLayerDropdownOpen, isSimulatedMicroscope, loadExperiments, activeExperiment, getExperimentInfo]);

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

  // Compute selected cells for grid drag
  const gridSelectedCells = useMemo(() => {
    if (!gridDragStart || !gridDragEnd) return {};
    const layout = getWellPlateLayout();
    const r1 = Math.min(gridDragStart[0], gridDragEnd[0]);
    const c1 = Math.min(gridDragStart[1], gridDragEnd[1]);
    const r2 = Math.max(gridDragStart[0], gridDragEnd[0]);
    const c2 = Math.max(gridDragStart[1], gridDragEnd[1]);
    const selected = {};
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        selected[`${r}-${c}`] = true;
      }
    }
    return selected;
  }, [gridDragStart, gridDragEnd, getWellPlateLayout]);

  // Mouse handlers for grid selection
  const handleGridCellMouseDown = (rowIdx, colIdx) => {
    setGridDragStart([rowIdx, colIdx]);
    setGridDragEnd([rowIdx, colIdx]);
    setIsGridDragging(true);
  };
  const handleGridCellMouseEnter = (rowIdx, colIdx) => {
    if (isGridDragging) {
      setGridDragEnd([rowIdx, colIdx]);
    }
  };
  useEffect(() => {
    const handleMouseUp = () => {
      if (isGridDragging && gridDragStart && gridDragEnd) {
        // Compute all selected wells
        const layout = getWellPlateLayout();
        const r1 = Math.min(gridDragStart[0], gridDragEnd[0]);
        const c1 = Math.min(gridDragStart[1], gridDragEnd[1]);
        const r2 = Math.max(gridDragStart[0], gridDragEnd[0]);
        const c2 = Math.max(gridDragStart[1], gridDragEnd[1]);
        const newSelected = [];
        for (let r = r1; r <= r2; r++) {
          for (let c = c1; c <= c2; c++) {
            newSelected.push(getWellIdFromIndex(r, c));
          }
        }
        // Add to previous selection (union)
        setSelectedWells(prev => Array.from(new Set([...prev, ...newSelected])));
      }
      setIsGridDragging(false);
      setGridDragStart(null);
      setGridDragEnd(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, [isGridDragging, gridDragStart, gridDragEnd, getWellIdFromIndex, getWellPlateLayout]);

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

  // Add state for gallery and dataset browsing
  const [galleries, setGalleries] = useState([]);
  const [galleriesLoading, setGalleriesLoading] = useState(false);
  const [galleriesError, setGalleriesError] = useState(null);
  const [selectedGallery, setSelectedGallery] = useState(null);
  const [datasets, setDatasets] = useState([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState(null);

  // Fetch galleries when modal opens or microscope changes
  useEffect(() => {
    if (!showBrowseDataModal || !selectedMicroscopeId) return;
    setGalleriesLoading(true);
    setGalleriesError(null);
    setGalleries([]);
    setSelectedGallery(null);
    setDatasets([]);
    setDatasetsError(null);
    const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
    fetch(`/agent-lens/apps/${serviceId}/list-microscope-galleries?microscope_service_id=${encodeURIComponent(selectedMicroscopeId)}`)
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
  }, [showBrowseDataModal, selectedMicroscopeId]);

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
  
  // Auto-enable historical data mode for simulated microscope when switching to FREE_PAN mode
  useEffect(() => {
    if (isSimulatedMicroscope && mapViewMode === 'FREE_PAN' && !isHistoricalDataMode) {
      console.log('[Simulated Microscope] Auto-enabling historical data mode in FREE_PAN mode');
      setIsHistoricalDataMode(true);
      setStitchedTiles([]); // Clear existing tiles
      
      // Auto-load default dataset for simulated microscope
      const defaultDatasetId = 'agent-lens/20250824-example-data-20250824t211822-798933';
      console.log('[Simulated Microscope] Auto-loading default dataset:', defaultDatasetId);
      
      // Create a mock dataset object for the default dataset
      const mockDataset = {
        id: defaultDatasetId,
        name: 'Simulated Sample Data',
        created_at: new Date().toISOString(),
        metadata: {
          microscope_service_id: selectedMicroscopeId,
          sample_id: 'simulated-sample-1'
        }
      };
      
      // Set the dataset and gallery for immediate use
      setSelectedHistoricalDataset(mockDataset);
      setSelectedGallery({
        id: 'agent-lens/1-20250824-example-data',
        name: 'Simulated Microscope Gallery',
        microscope_service_id: selectedMicroscopeId
      });
    }
  }, [isSimulatedMicroscope, mapViewMode, isHistoricalDataMode, selectedMicroscopeId, setStitchedTiles, setSelectedGallery]);
  
  // Auto-select first dataset when datasets are loaded in historical mode
  useEffect(() => {
    if (isHistoricalDataMode && datasets.length > 0 && !selectedHistoricalDataset) {
      console.log('[Historical Mode] Auto-selecting first dataset:', datasets[0]);
      setSelectedHistoricalDataset(datasets[0]);
    }
  }, [isHistoricalDataMode, datasets, selectedHistoricalDataset]);

  
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
    
    // 🚀 PERFORMANCE OPTIMIZATION: Throttle tile loading attempts to prevent CPU overload
    const now = Date.now();
    const MIN_LOAD_INTERVAL = 3000; // Minimum 3 seconds between tile load attempts
    if (now - lastTileLoadAttemptRef.current < MIN_LOAD_INTERVAL) {
      console.log('[loadStitchedTiles] Throttling tile load attempt - too soon since last attempt');
      return;
    }
    lastTileLoadAttemptRef.current = now;
    
    if (!visibleLayers.scanResults || mapViewMode !== 'FREE_PAN') {
      console.log('[loadStitchedTiles] Skipping - scan results not visible or not in FREE_PAN mode');
      return;
    }
    
    // Handle historical data mode
    if (isHistoricalDataMode) {
      console.log('[loadStitchedTiles] Historical data mode - checking requirements');
      if (!artifactZarrLoaderRef.current || !selectedHistoricalDataset || !selectedGallery) {
        console.log('[loadStitchedTiles] Skipping historical mode - missing requirements');
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
      
      // Check if this region is already covered by existing tiles
      if (isRegionCovered(bounds, scaleLevel, activeChannel, stitchedTiles)) {
        // Region is already loaded, no need to fetch
        return;
      }
      
      const width_mm = clampedBottomRight.x - clampedTopLeft.x;
      const height_mm = clampedBottomRight.y - clampedTopLeft.y;
      
      // Create a unique request key to prevent duplicate requests
      const requestKey = getTileKey(bounds, scaleLevel, activeChannel);
      
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
          
          // Convert channel name to index (needed for chunk check)
          const channelIndex = 0; // Single channel for now
          
          // Use artifactZarrLoader's proper coordinate conversion instead of simple conversion
          // First, get the metadata to understand the image dimensions and pixel size
          const correctDatasetId = artifactZarrLoaderRef.current.extractDatasetId(selectedHistoricalDataset.id);
          const baseUrl = `${artifactZarrLoaderRef.current.baseUrl}/${correctDatasetId}/zip-files/well_${wellInfo.id}_96.zip/~/data.zarr/`;
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
              channel: activeChannel,
              timestamp: Date.now(),
              isHistorical: true,
              datasetId: selectedHistoricalDataset.id,
              wellId: wellId,
              isPartial: loadedChunks < totalChunks, // Mark as partial for potential cleanup
              progress: `${loadedChunks}/${totalChunks}`
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
            channel: activeChannel,
            timestamp: Date.now(),
            isHistorical: true,
            datasetId: selectedHistoricalDataset.id,
            wellId: wellId,
            isPartial: false // Mark as complete
          };
          
          // Replace partial tile with complete tile
          addOrUpdateTile(finalTile);
        };
        
        // 🚀 REQUEST CANCELLATION: Check if we need to cancel previous request
        const currentRequestKey = getTileKey(bounds, scaleLevel, activeChannel);
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
            onWellComplete
          );
        
        // Store cancellation function for potential future cancellation
        setCurrentCancellableRequest({ cancel: cancelWellRequests, requestKey: currentRequestKey });
        
        const wellResults = await wellResultsPromise;
        
        // Process final results
        const successfulResults = wellResults.filter(result => result.success);
        if (successfulResults.length > 0) {
          console.log(`✅ REAL-TIME: Completed loading ${successfulResults.length}/${wellRequests.length} well regions`);
          
          // Clean up old tiles for this scale/channel combination to prevent memory bloat
          cleanupOldTiles(scaleLevel, getChannelString());
          
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
      return;
    }
    
    // Handle live microscope mode
    if (!microscopeControlService || (isSimulatedMicroscope && !isHistoricalDataMode)) {
      console.log('[loadStitchedTiles] Skipping - no microscope service or simulated mode (not in historical data mode)');
      // 🚀 PERFORMANCE OPTIMIZATION: Clear loading state when no service available
      if (activeTileRequestsRef.current.size === 0) {
        setIsLoadingCanvas(false);
      }
      return;
    }
    
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
    
    // Check if this region is already covered by existing tiles
    if (isRegionCovered(bounds, scaleLevel, activeChannel, stitchedTiles)) {
      console.log('[loadStitchedTiles] Region already covered by existing tiles - skipping');
      return;
    }
    
    const width_mm = clampedBottomRight.x - clampedTopLeft.x;
    const height_mm = clampedBottomRight.y - clampedTopLeft.y;
    
    // Create a unique request key to prevent duplicate requests
    const requestKey = getTileKey(bounds, scaleLevel, activeChannel);
    
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
      
      const result = await microscopeControlService.get_stitched_region(
        centerX,
        centerY,
        width_mm,
        height_mm,
        wellPlateType, // wellplate_type parameter
        scaleLevel,
        getChannelString(), // Use comma-separated channel string for merged display
        0, // timepoint index
        wellPaddingMm, // well_padding_mm parameter
        'base64'
      );
      
      if (result.success) {
        // DIAGNOSTIC: Log coordinate transformation for comparison with historical mode
        console.log(`📍 FREE_PAN: center(${centerX.toFixed(2)}, ${centerY.toFixed(2)}) → bounds(${bounds.topLeft.x.toFixed(1)}, ${bounds.topLeft.y.toFixed(1)}) ${width_mm.toFixed(1)}×${height_mm.toFixed(1)}mm`);
        
        const newTile = {
          data: `data:image/png;base64,${result.data}`,
          bounds,
          width_mm,
          height_mm,
          scale: scaleLevel,
          channel: getChannelString(), // Store the channel string used for this tile
          timestamp: Date.now(),
          isMerged: getSelectedChannels().length > 1, // Flag to indicate if this is a merged tile
          channelsUsed: getSelectedChannels() // Store which channels were used
        };
        
        addOrUpdateTile(newTile);
        
        // Clean up old tiles for this scale/channel combination to prevent memory bloat
        cleanupOldTiles(scaleLevel, getChannelString());
        
        if (appendLog) {
          appendLog(`Loaded tile for scale ${scaleLevel}, region (${clampedTopLeft.x.toFixed(1)}, ${clampedTopLeft.y.toFixed(1)}) to (${clampedBottomRight.x.toFixed(1)}, ${clampedBottomRight.y.toFixed(1)})`);
        }
      }
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
  }, [isHistoricalDataMode, microscopeControlService, visibleLayers.scanResults, visibleLayers.channels, mapViewMode, scaleLevel, displayToStageCoords, stageDimensions, pixelsPerMm, isRegionCovered, getTileKey, addOrUpdateTile, appendLog, isSimulatedMicroscope, selectedHistoricalDataset, selectedGallery, getIntersectingWells, calculateWellRegion, wellPlateType]);

  // Debounce tile loading - only load after user stops interacting for 1 second
  const scheduleTileUpdate = useCallback(() => {
    console.log('[scheduleTileUpdate] Called - clearing existing timer and scheduling new one');
    if (canvasUpdateTimerRef.current) {
      console.log('[scheduleTileUpdate] Clearing existing timer');
      clearTimeout(canvasUpdateTimerRef.current);
    }
    canvasUpdateTimerRef.current = setTimeout(() => {
      console.log('[scheduleTileUpdate] Timer fired - calling loadStitchedTiles');
      loadStitchedTiles();
    }, 1000); // Wait 1 second after user stops
    console.log('[scheduleTileUpdate] New timer scheduled for 1000ms');
  }, [loadStitchedTiles]);

  // Function to refresh canvas view (can be used by timepoint operations)
  const refreshCanvasView = useCallback(() => {
    if (!isSimulatedMicroscope) {
      // 🚀 REQUEST CANCELLATION: Cancel any pending requests before refreshing
      if (currentCancellableRequest) {
        const cancelledCount = currentCancellableRequest.cancel();
        console.log(`🚫 Refresh: Cancelled ${cancelledCount} pending requests`);
        setCurrentCancellableRequest(null);
      }
      
      // Clear active requests
      activeTileRequestsRef.current.clear();
      
      // Clear all existing tiles to force reload of fresh data
      setStitchedTiles([]);
      
      // Force immediate tile loading after clearing tiles
      setTimeout(() => {
        loadStitchedTiles();
      }, 100); // Small delay to ensure state is updated
      
      if (appendLog) {
        appendLog('Refreshing canvas view');
      }
    }
  }, [loadStitchedTiles, appendLog, isSimulatedMicroscope, currentCancellableRequest]);

  // Consolidated tile loading effect - replaces multiple overlapping effects
  const lastTileRequestRef = useRef({ panX: 0, panY: 0, scale: 0, timestamp: 0 });
  
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

    // Don't trigger tile loading if tiles are currently loading
    if (isLoadingCanvas || activeTileRequestsRef.current.size > 0) {
      console.log('[Tile Loading] Skipping - tiles are currently loading (isLoadingCanvas:', isLoadingCanvas, 'activeRequests:', activeTileRequestsRef.current.size, ')');
      return;
    }

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
        timestamp: Date.now()
      };
      
      // Schedule tile update
      scheduleTileUpdate();
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

  // 🚀 REQUEST CANCELLATION: Cleanup effect for cancellable requests
  useEffect(() => {
    return () => {
      // Cancel any pending cancellable requests when component unmounts
      if (currentCancellableRequest) {
        const cancelledCount = currentCancellableRequest.cancel();
        console.log(`🚫 Component unmount: Cancelled ${cancelledCount} pending requests`);
      }
      
      // 🚫 IMPROVED: Only cancel artifact loader requests if we're not in historical mode
      // This prevents aggressive cancellation during normal navigation
      if (artifactZarrLoaderRef.current && !isHistoricalDataMode) {
        const cancelledCount = artifactZarrLoaderRef.current.cancelAllRequests();
        console.log(`🚫 Component unmount: Cancelled ${cancelledCount} artifact loader requests`);
      }
    };
  }, [currentCancellableRequest, isHistoricalDataMode]);

  // Initial tile loading when the map becomes visible
  useEffect(() => {
    if (isOpen && mapViewMode === 'FREE_PAN' && visibleLayers.scanResults) {
      console.log('[Initial Tile Loading] Triggering initial tile loading');
      // Trigger initial tile loading through debounced function
      scheduleTileUpdate();
    }
  }, [isOpen, mapViewMode, visibleLayers.scanResults, scheduleTileUpdate]);

  // Effect to trigger tile loading when needsTileReload is set
  useEffect(() => {
    if (needsTileReload && mapViewMode === 'FREE_PAN' && visibleLayers.scanResults) {
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
        scheduleTileUpdate();
      }, 100);
    }
  }, [needsTileReload, mapViewMode, visibleLayers.scanResults, scheduleTileUpdate]);

  // Effect to cleanup high-resolution tiles when zooming out (but don't immediately load during active zoom)
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults) {
      console.log('[scaleLevel cleanup] Triggering cleanup and potential tile load');
      const activeChannel = getChannelString();
      
      // Always cleanup immediately when scale changes to save memory
      cleanupOldTiles(scaleLevel, activeChannel);
      
      // 🚀 PERFORMANCE OPTIMIZATION: Only trigger tile load if microscope service is available
      if (!isZooming && microscopeControlService && !isSimulatedMicroscope) {
        // Check if tiles are currently loading
        if (isLoadingCanvas || activeTileRequestsRef.current.size > 0) {
          console.log('[scaleLevel cleanup] Skipping - tiles are currently loading');
        } else {
          console.log('[scaleLevel cleanup] User not zooming - scheduling tile load');
          setTimeout(() => {
            scheduleTileUpdate(); // Use scheduleTileUpdate instead of direct call
          }, 800); // Increased delay to 800ms for less aggressive loading
        }
      } else {
        console.log('[scaleLevel cleanup] User is zooming or no microscope service - skipping tile load');
      }
    }
  }, [scaleLevel, mapViewMode, visibleLayers.scanResults, visibleLayers.channels, isZooming, scheduleTileUpdate, cleanupOldTiles, microscopeControlService, isSimulatedMicroscope]);

  // Effect to ensure tiles are loaded for current scale level
  // EXCLUDES historical mode - no automatic tile loading needed for historical data
  useEffect(() => {
    if (mapViewMode === 'FREE_PAN' && visibleLayers.scanResults && !isZooming && !isHistoricalDataMode) {
      const activeChannel = getChannelString();
      
      // 🚀 PERFORMANCE OPTIMIZATION: Check if microscope service is available before attempting tile loading
      if (!microscopeControlService || isSimulatedMicroscope) {
        console.log('[Scale Level Check] Skipping - no microscope service or simulated mode');
        return;
      }
      
      // Check if we have tiles for the current scale level
      const currentScaleTiles = stitchedTiles.filter(tile => 
        tile.scale === scaleLevel && 
        tile.channel === activeChannel
      );
      
      // If no tiles exist for current scale level, trigger loading
      if (currentScaleTiles.length === 0) {
        console.log(`[Scale Level Check] No tiles found for scale ${scaleLevel}, channel ${activeChannel} - triggering tile load`);
        
        // Check if tiles are currently loading
        if (isLoadingCanvas || activeTileRequestsRef.current.size > 0) {
          console.log('[Scale Level Check] Skipping - tiles are currently loading');
        } else {
          console.log('[Scale Level Check] Triggering tile load for missing scale level');
          setTimeout(() => {
            scheduleTileUpdate();
          }, 300); // Small delay to ensure other operations are complete
        }
      } else {
        console.log(`[Scale Level Check] Found ${currentScaleTiles.length} tiles for scale ${scaleLevel}, channel ${activeChannel}`);
      }
    }
  }, [scaleLevel, mapViewMode, visibleLayers.scanResults, visibleLayers.channels, stitchedTiles, isZooming, isLoadingCanvas, isHistoricalDataMode, scheduleTileUpdate, microscopeControlService, isSimulatedMicroscope]);

  if (!isOpen) return null;

  return (
    <div className="relative w-full h-full bg-black">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-80 p-2 flex justify-between items-center z-10">
        <div className="flex items-center space-x-4">
          <h3 className="text-white text-lg font-medium">
            {mapViewMode === 'FOV_FITTED' ? 'Video View' : 'Stage Map'}
          </h3>
          
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
                
                {/* Scan Area Button */}
                <button
                  onClick={() => {
                    if (isSimulatedMicroscope) return;
                    if (showScanConfig) {
                      // Close scan panel and cancel selection
                      setShowScanConfig(false);
                      setIsRectangleSelection(false);
                      setRectangleStart(null);
                      setRectangleEnd(null);
                      setDragSelectedWell(null);
                    } else {
                      // Automatically switch to FREE_PAN mode if in FOV_FITTED mode
                      if (mapViewMode === 'FOV_FITTED') {
                        transitionToFreePan();
                        if (appendLog) {
                          appendLog('Switched to stage map view for scan area selection');
                        }
                      }
                      // Open scan panel and load current microscope settings (only if not scanning)
                      if (!isScanInProgress) {
                        loadCurrentMicroscopeSettings();
                        // Automatically enable rectangle selection when opening scan panel (only if not scanning)
                        // Clear any existing selection first
                        setRectangleStart(null);
                        setRectangleEnd(null);
                        setDragSelectedWell(null);
                        setIsRectangleSelection(true);
                      }
                      setShowScanConfig(true);
                    }
                  }}
                  className={`px-2 py-1 text-xs text-white rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                    showScanConfig ? 'bg-blue-600 hover:bg-blue-500' : 
                    isScanInProgress ? 'bg-orange-600 hover:bg-orange-500' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                  title={isSimulatedMicroscope ? "Scanning not supported for simulated microscope" : 
                         isScanInProgress ? "View/stop current scan" : "Configure scan and select area (automatically switches to stage map view)"}
                  disabled={!microscopeControlService || isSimulatedMicroscope || isHistoricalDataMode || (isInteractionDisabled && !isScanInProgress)}
                >
                  <i className="fas fa-vector-square mr-1"></i>
                  {isScanInProgress ? (showScanConfig ? 'Close Scan Panel' : 'View Scan Progress') : 
                   (showScanConfig ? 'Close Scan Setup' : 'Scan Area')}
                </button>
                
                {/* Quick Scan Button */}
                <button
                  onClick={() => {
                    if (isSimulatedMicroscope) return;
                    if (showQuickScanConfig) {
                      // Close quick scan panel
                      setShowQuickScanConfig(false);
                    } else {
                      // Close normal scan panel if open
                      setShowScanConfig(false);
                      setIsRectangleSelection(false);
                      setRectangleStart(null);
                      setRectangleEnd(null);
                      setDragSelectedWell(null);
                      // Clean up grid drawing states
                      setGridDragStart(null);
                      setGridDragEnd(null);
                      setIsGridDragging(false);
                      // Open quick scan panel (always allow opening, even during scanning)
                      setShowQuickScanConfig(true);
                    }
                  }}
                  className={`px-2 py-1 text-xs text-white rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                    showQuickScanConfig ? 'bg-green-600 hover:bg-green-500' : 
                    isQuickScanInProgress ? 'bg-orange-600 hover:bg-orange-500' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                  title={isSimulatedMicroscope ? "Quick scanning not supported for simulated microscope" : 
                         isQuickScanInProgress ? "View/stop current quick scan" : "Quick scan entire well plate with high-speed acquisition"}
                  disabled={!microscopeControlService || isSimulatedMicroscope || isHistoricalDataMode || (isInteractionDisabled && !isQuickScanInProgress)}
                >
                  <i className="fas fa-bolt mr-1"></i>
                  {isQuickScanInProgress ? (showQuickScanConfig ? 'Close Quick Scan Panel' : 'View Quick Scan Progress') : 
                   (showQuickScanConfig ? 'Cancel Quick Scan' : 'Quick Scan')}
                </button>
                
                {/* Browse Data Button */}
                <button
                  onClick={() => {
                    if (isHistoricalDataMode) {
                      setIsHistoricalDataMode(false); // Exit historical data mode
                      setStitchedTiles([]); // Optionally clear tiles to force reload
                    } else {
                      setShowBrowseDataModal(true);
                    }
                  }}
                  className={`px-2 py-1 text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                    isHistoricalDataMode
                      ? 'bg-yellow-700 hover:bg-yellow-600 text-white border-2 border-yellow-400' // Style for exit mode
                      : 'bg-blue-700 hover:bg-blue-600 text-white'
                  }`}
                  title={isHistoricalDataMode ? 'Exit historical data map mode' : 'Browse imaging data for this microscope'}
                  disabled={!microscopeControlService || isSimulatedMicroscope || (!isHistoricalDataMode && isInteractionDisabled)}
                >
                  <i className={`fas ${isHistoricalDataMode ? 'fa-sign-out-alt' : 'fa-database'} mr-1`}></i>
                  {isHistoricalDataMode ? 'Exit Data Map' : 'Browse Data'}
                </button>
              </div>
              
              {/* Layer selector dropdown */}
              <div className="relative" ref={layerDropdownRef}>
                <button
                  onClick={() => setIsLayerDropdownOpen(!isLayerDropdownOpen)}
                  className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded flex items-center disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={isHistoricalDataMode}
                  title={isHistoricalDataMode ? 'Layers disabled in historical data mode' : 'Toggle layer visibility'}
                >
                  <i className="fas fa-layer-group mr-1"></i>
                  Layers
                  <i className={`fas ml-1 transition-transform ${isLayerDropdownOpen ? 'fa-caret-up' : 'fa-caret-down'}`}></i>
                </button>
                
                {isLayerDropdownOpen && (
                  <div className="absolute top-full right-0 mt-1 bg-gray-800 rounded shadow-lg p-4 min-w-[480px] z-20">
                    {/* Map Layers Section */}
                    <div className="mb-4">
                      <div className="text-sm text-gray-300 font-semibold mb-2">Map Layers</div>
                      <div className="flex flex-wrap gap-2">
                        <label className="flex items-center text-white text-xs hover:bg-gray-700 p-2 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visibleLayers.wellPlate}
                            onChange={(e) => setVisibleLayers(prev => ({ ...prev, wellPlate: e.target.checked }))}
                            className="mr-2"
                          />
                          96-Well Plate Grid
                        </label>
                        <label className="flex items-center text-white text-xs hover:bg-gray-700 p-2 rounded cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visibleLayers.scanResults}
                            onChange={(e) => setVisibleLayers(prev => ({ ...prev, scanResults: e.target.checked }))}
                            className="mr-2"
                          />
                          Scan Results
                        </label>
                      </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="flex gap-4">
                      {/* Experiment Selection (Left Side) */}
                      <div className="flex-1">
                        <div className="text-sm text-gray-300 font-semibold mb-2 flex items-center justify-between">
                          <span>Experiments</span>
                          {isLoadingExperiments && <i className="fas fa-spinner fa-spin text-xs"></i>}
                        </div>
                        
                        {!isSimulatedMicroscope ? (
                          <div className="space-y-2">
                            {/* Experiment List */}
                            <div className="bg-gray-700 rounded p-2 max-h-40 overflow-y-auto">
                              {experiments.length > 0 ? (
                                experiments.map((experiment) => (
                                  <div
                                    key={experiment.name}
                                    className={`flex items-center justify-between p-2 rounded text-xs hover:bg-gray-600 cursor-pointer ${
                                      experiment.name === activeExperiment ? 'bg-blue-600 text-white' : 'text-gray-300'
                                    }`}
                                    onClick={() => experiment.name !== activeExperiment && setActiveExperimentHandler(experiment.name)}
                                  >
                                    <div className="flex-1">
                                      <div className="font-medium">{experiment.name}</div>
                                      <div className="text-xs opacity-75">
                                        {experiment.name === activeExperiment && <span className="ml-1 text-green-300">• Active</span>}
                                      </div>
                                    </div>
                                    {experiment.name !== activeExperiment && (
                                      <div className="flex space-x-1">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setExperimentToReset(experiment.name);
                                            setShowClearCanvasConfirmation(true);
                                          }}
                                          className="text-yellow-400 hover:text-yellow-300"
                                          title="Reset experiment (clear data)"
                                        >
                                          <i className="fas fa-undo text-xs"></i>
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            removeExperiment(experiment.name);
                                          }}
                                          className="text-red-400 hover:text-red-300"
                                          title="Remove experiment"
                                        >
                                          <i className="fas fa-trash text-xs"></i>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))
                              ) : (
                                <div className="text-xs text-gray-400 p-2 text-center">
                                  {isLoadingExperiments ? 'Loading...' : 'No experiments available'}
                                </div>
                              )}
                            </div>
                            
                            {/* Experiment Actions */}
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setShowCreateExperimentDialog(true)}
                                  className="flex-1 px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                                >
                                  <i className="fas fa-plus mr-1"></i>
                                  Create
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!activeExperiment || !microscopeControlService) return;
                                    // Show notification that upload started
                                    if (showNotification) showNotification('Upload started in background', 'info');
                                    try {
                                      const result = await microscopeControlService.upload_zarr_dataset(
                                        activeExperiment,
                                        '', // description (optional, empty for now)
                                        true // include_acquisition_settings
                                      );
                                      if (result && result.success) {
                                        if (showNotification) showNotification('Upload completed successfully', 'success');
                                        if (appendLog) appendLog(`Upload completed: ${result.dataset_name}`);
                                      } else {
                                        if (showNotification) showNotification(`Upload failed: ${result?.message || 'Unknown error'}`, 'error');
                                        if (appendLog) appendLog(`Upload failed: ${result?.message || 'Unknown error'}`);
                                      }
                                    } catch (error) {
                                      if (showNotification) showNotification(`Upload error: ${error.message}`, 'error');
                                      if (appendLog) appendLog(`Upload error: ${error.message}`);
                                    }
                                  }}
                                  className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
                                  disabled={!activeExperiment}
                                  title={!activeExperiment ? "Select an active experiment to upload" : "Upload experiment data to artifact manager"}
                                >
                                  <i className="fas fa-upload mr-1"></i>
                                  Upload
                                </button>
                                <button
                                  onClick={() => getExperimentInfo(activeExperiment)}
                                  className="flex-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
                                  disabled={!activeExperiment}
                                  title={!activeExperiment ? "Select an active experiment to view info" : "View experiment information"}
                                >
                                  <i className="fas fa-info mr-1"></i>
                                  Info
                                </button>
                                <button
                                  onClick={() => loadExperiments()}
                                  className="px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded"
                                >
                                  <i className="fas fa-refresh mr-1"></i>
                                  Refresh
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 p-2 text-center">
                            Experiment management not available for simulated microscope
                          </div>
                        )}
                      </div>

                      {/* Channel Selection (Right Side) */}
                      {visibleLayers.scanResults && (
                        <div className="flex-1">
                          <div className="text-sm text-gray-300 font-semibold mb-2">Channels</div>
                          <div className="bg-gray-700 rounded p-2 max-h-40 overflow-y-auto">
                            {Object.entries(visibleLayers.channels).map(([channel, isVisible]) => (
                              <label key={channel} className="flex items-center text-white text-xs mb-1 hover:bg-gray-600 p-1 rounded cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={isVisible}
                                  onChange={() => setVisibleLayers(prev => ({
                                    ...prev,
                                    channels: {
                                      ...prev.channels,
                                      [channel]: !isVisible
                                    }
                                  }))}
                                  className="mr-2"
                                />
                                {channel}
                              </label>
                            ))}
                          </div>
                          
                          {/* Channel Selection Info */}
                          <div className="mt-2 text-xs text-gray-400">
                            {!hasSelectedChannels() ? (
                              <span className="text-yellow-400">⚠️ Select at least one channel</span>
                            ) : Object.values(visibleLayers.channels).filter(Boolean).length === 1 ? (
                              <span className="text-blue-400">🔵 Single channel mode</span>
                            ) : (
                              <span className="text-green-400">🟢 Multi-channel merge mode ({Object.values(visibleLayers.channels).filter(Boolean).length} channels)</span>
                            )}
                          </div>
                          
                          {/* Channel Selection Help */}
                          <div className="mt-1 text-xs text-gray-500">
                            {hasSelectedChannels() && Object.values(visibleLayers.channels).filter(Boolean).length > 1 && (
                              <span>Channels will be merged using backend color mapping</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Well Selection Controls */}
              <div className="flex items-center space-x-2">
                {/* Well Plate Type Selector */}
                <div className="flex items-center space-x-1">
                  <label className="text-white text-xs">Plate:</label>
                  <select
                    value={wellPlateType}
                    onChange={(e) => setWellPlateType(e.target.value)}
                    className="px-1 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-white"
                    disabled={isSimulatedMicroscope}
                  >
                    <option value="96">96-well</option>
                    <option value="96">only 96-well for now</option>
                  </select>
                </div>
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
          isMapBrowsingDisabled 
            ? 'cursor-not-allowed microscope-map-disabled' 
            : mapViewMode === 'FOV_FITTED' 
              ? (isHardwareInteractionDisabled ? 'cursor-not-allowed' : 'cursor-grab')
              : (isRectangleSelection && !isScanInProgress && !isQuickScanInProgress)
                ? (isHardwareInteractionDisabled ? 'cursor-not-allowed' : 'cursor-crosshair')
                : 'cursor-move'
        } ${isDragging || isPanning ? 'cursor-grabbing' : ''}`}
        onMouseDown={isMapBrowsingDisabled ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseDown) : handleMapPanning)}
        onMouseMove={isMapBrowsingDisabled ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseMove) : handleMapPanMove)}
        onMouseUp={isMapBrowsingDisabled ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseUp) : handleMapPanEnd)}
        onMouseLeave={isMapBrowsingDisabled ? undefined : (mapViewMode === 'FOV_FITTED' ? (isHardwareInteractionDisabled ? undefined : onMouseLeave) : handleMapPanEnd)}
        onDoubleClick={isHardwareInteractionDisabled ? undefined : (mapViewMode === 'FREE_PAN' && !isRectangleSelection ? handleDoubleClick : undefined)}
                  style={{
            userSelect: 'none',
            transition: isDragging || isPanning ? 'none' : 'transform 0.3s ease-out',
            opacity: isMapBrowsingDisabled ? 0.75 : 1,
            cursor: (isRectangleSelection && !isScanInProgress && !isQuickScanInProgress) && mapViewMode === 'FREE_PAN' && !isHardwareInteractionDisabled ? 'crosshair' : undefined
          }}
      >
        {/* Map canvas for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && (
          <canvas ref={canvasRef} className="absolute inset-0" />
        )}
        
        {/* Stitched scan results tiles layer (below other elements) */}
        {mapViewMode === 'FREE_PAN' && visibleTiles.map((tile, index) => {
          return (
            <div
              key={`${getTileKey(tile.bounds, tile.scale, tile.channel)}_${index}`}
              className="absolute pointer-events-none scan-results-container"
              style={{
                left: `${stageToDisplayCoords(tile.bounds.topLeft.x, tile.bounds.topLeft.y).x}px`,
                top: `${stageToDisplayCoords(tile.bounds.topLeft.x, tile.bounds.topLeft.y).y}px`,
                width: `${tile.width_mm * pixelsPerMm * mapScale}px`,
                height: `${tile.height_mm * pixelsPerMm * mapScale}px`,
                zIndex: 1 // All scan result tiles at same level
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
        {videoFramePosition && (!isHistoricalDataMode || (isSimulatedMicroscope && isHistoricalDataMode)) && (
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
              scaleLevel <= 1 && (
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

      {/* Reset Experiment Confirmation Dialog */}
      {showClearCanvasConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md w-full text-white">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-exclamation-triangle text-red-400 mr-2"></i>
                Reset Experiment
              </h3>
              <button
                onClick={() => setShowClearCanvasConfirmation(false)}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4">
              <p className="text-gray-300 mb-4">
                Are you sure you want to reset experiment "{experimentToReset}"? This will permanently delete all experiment data and cannot be undone.
              </p>
              <div className="bg-yellow-900 bg-opacity-30 border border-yellow-500 rounded-lg p-3 mb-4">
                <div className="flex items-start">
                  <i className="fas fa-info-circle text-yellow-400 mr-2 mt-0.5"></i>
                  <div className="text-sm text-yellow-200">
                    <p className="font-medium mb-1">This action will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Remove all scan result images from all wells</li>
                      <li>Clear all experiment data from storage</li>
                      <li>Reset the experiment to empty state</li>
                      <li>Keep the experiment structure for future use</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end space-x-3 p-4 border-t border-gray-600">
              <button
                onClick={() => {
                  setShowClearCanvasConfirmation(false);
                  setExperimentToReset(null);
                }}
                className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                <i className="fas fa-times mr-1"></i>
                Cancel
              </button>
              <button
                onClick={handleResetExperiment}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                <i className="fas fa-undo mr-1"></i>
                Reset Experiment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Experiment Dialog */}
      {showCreateExperimentDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md w-full text-white">
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-plus text-green-400 mr-2"></i>
                Create New Experiment
              </h3>
              <button
                onClick={() => {
                  setShowCreateExperimentDialog(false);
                  setNewExperimentName('');
                }}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              <div className="mb-4">
                <label className="block text-gray-300 font-medium mb-2">Experiment Name</label>
                <input
                  type="text"
                  value={newExperimentName}
                  onChange={(e) => setNewExperimentName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter experiment name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newExperimentName.trim()) {
                      createExperiment(newExperimentName);
                      setShowCreateExperimentDialog(false);
                      setNewExperimentName('');
                    }
                  }}
                />
              </div>
              <div className="bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-3 mb-4">
                <div className="flex items-start">
                  <i className="fas fa-info-circle text-blue-400 mr-2 mt-0.5"></i>
                  <div className="text-sm text-blue-200">
                    <p className="font-medium mb-1">About Experiments:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Experiments organize well-separated microscopy data</li>
                      <li>Each well has its own canvas within the experiment</li>
                      <li>Only one experiment can be active at a time</li>
                      <li>Better scalability and data organization</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-4 border-t border-gray-600">
              <button
                onClick={() => {
                  setShowCreateExperimentDialog(false);
                  setNewExperimentName('');
                }}
                className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newExperimentName.trim()) {
                    createExperiment(newExperimentName);
                    setShowCreateExperimentDialog(false);
                    setNewExperimentName('');
                  }
                }}
                className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                disabled={!newExperimentName.trim()}
              >
                <i className="fas fa-plus mr-1"></i>
                Create Experiment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Scan Configuration Side Panel */}
      {showQuickScanConfig && (
        <div className="absolute top-12 right-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 z-50 text-white scan-config-panel">
          <div className="flex items-center justify-between p-4 border-b border-gray-600 flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-200">Quick Scan Configuration</h3>
            <button
              onClick={() => setShowQuickScanConfig(false)}
              className="text-gray-400 hover:text-white p-1"
              title="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          
          <div className="p-3 scan-config-content">
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-gray-300 font-medium mb-1">Well Plate Type</label>
                <select
                  value={quickScanParameters.wellplate_type}
                  onChange={(e) => setQuickScanParameters(prev => ({ ...prev, wellplate_type: e.target.value }))}
                  className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white"
                  disabled={isQuickScanInProgress}
                >
                  <option value="96">96-well plate</option>
                </select>
              </div>

              {/* Stripe Pattern Configuration */}
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-blue-300 font-medium mb-1"><i className="fas fa-grip-lines mr-1"></i>Stripe Pattern</div>
                <div className="flex space-x-2 mb-1">
                  <div className="w-1/2 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Stripes per Well</label>
                    <input
                      type="number"
                      value={quickStripesInput.inputValue}
                      onChange={quickStripesInput.handleInputChange}
                      onKeyDown={quickStripesInput.handleKeyDown}
                      onBlur={quickStripesInput.handleBlur}
                      className={getInputValidationClasses(
                        quickStripesInput.isValid,
                        quickStripesInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="1"
                      max="10"
                      disabled={isQuickScanInProgress}
                      placeholder="1-10"
                    />
                  </div>
                  <div className="w-1/2 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Stripe Width (mm)</label>
                    <input
                      type="number"
                      value={quickStripeWidthInput.inputValue}
                      onChange={quickStripeWidthInput.handleInputChange}
                      onKeyDown={quickStripeWidthInput.handleKeyDown}
                      onBlur={quickStripeWidthInput.handleBlur}
                      className={getInputValidationClasses(
                        quickStripeWidthInput.isValid,
                        quickStripeWidthInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="0.5"
                      max="10.0"
                      step="0.1"
                      disabled={isQuickScanInProgress}
                      placeholder="0.5-10.0"
                    />
                  </div>
                </div>
                <div className="input-validation-container">
                  <label className="block text-gray-300 font-medium mb-1">Y Increment (mm)</label>
                  <input
                    type="number"
                    value={quickDyInput.inputValue}
                    onChange={quickDyInput.handleInputChange}
                    onKeyDown={quickDyInput.handleKeyDown}
                    onBlur={quickDyInput.handleBlur}
                    className={getInputValidationClasses(
                      quickDyInput.isValid,
                      quickDyInput.hasUnsavedChanges,
                      "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                    )}
                    min="0.1"
                    max="5.0"
                    step="0.1"
                    disabled={isQuickScanInProgress}
                    placeholder="0.1-5.0"
                  />
                </div>
              </div>
              
              {/* Camera & Illumination Settings */}
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-green-300 font-medium mb-1"><i className="fas fa-camera mr-1"></i>Camera & Light</div>
                <div className="flex space-x-2 mb-1">
                  <div className="flex-1 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Exposure (ms)</label>
                    <input
                      type="number"
                      value={quickExposureInput.inputValue}
                      onChange={quickExposureInput.handleInputChange}
                      onKeyDown={quickExposureInput.handleKeyDown}
                      onBlur={quickExposureInput.handleBlur}
                      className={getInputValidationClasses(
                        quickExposureInput.isValid,
                        quickExposureInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="1"
                      max="30"
                      step="0.1"
                      disabled={isQuickScanInProgress}
                      placeholder="1-30ms"
                    />
                  </div>
                  <div className="flex-1 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Intensity (%)</label>
                    <input
                      type="number"
                      value={quickIntensityInput.inputValue}
                      onChange={quickIntensityInput.handleInputChange}
                      onKeyDown={quickIntensityInput.handleKeyDown}
                      onBlur={quickIntensityInput.handleBlur}
                      className={getInputValidationClasses(
                        quickIntensityInput.isValid,
                        quickIntensityInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="0"
                      max="100"
                      disabled={isQuickScanInProgress}
                      placeholder="0-100%"
                    />
                  </div>
                </div>
                {/* Autofocus selection */}
                <div className="mt-1">
                  <div className="text-blue-300 font-medium mb-1"><i className="fas fa-bullseye mr-1"></i>Autofocus</div>
                  <div className="flex flex-col space-y-1">
                    <label className="flex items-center text-xs">
                      <input
                        type="radio"
                        name="quickscan-autofocus"
                        checked={!quickScanParameters.do_contrast_autofocus && !quickScanParameters.do_reflection_af}
                        onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: false }))}
                        disabled={isQuickScanInProgress}
                        className="mr-2"
                      />
                      None
                    </label>
                    <label className="flex items-center text-xs">
                      <input
                        type="radio"
                        name="quickscan-autofocus"
                        checked={quickScanParameters.do_contrast_autofocus}
                        onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: true, do_reflection_af: false }))}
                        disabled={isQuickScanInProgress}
                        className="mr-2"
                      />
                      Contrast Autofocus
                    </label>
                    <label className="flex items-center text-xs">
                      <input
                        type="radio"
                        name="quickscan-autofocus"
                        checked={quickScanParameters.do_reflection_af}
                        onChange={() => setQuickScanParameters(prev => ({ ...prev, do_contrast_autofocus: false, do_reflection_af: true }))}
                        disabled={isQuickScanInProgress}
                        className="mr-2"
                      />
                      Reflection Autofocus
                    </label>
                  </div>
                  <div className="text-gray-400 text-xs mt-1">Only one autofocus mode can be enabled for quick scan.</div>
                </div>
              </div>

              {/* Motion & Acquisition Settings */}
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-yellow-300 font-medium mb-1"><i className="fas fa-tachometer-alt mr-1"></i>Motion & Acquisition</div>
                <div className="flex space-x-2">
                  <div className="flex-1 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Scan Velocity (mm/s)</label>
                    <input
                      type="number"
                      value={quickVelocityInput.inputValue}
                      onChange={quickVelocityInput.handleInputChange}
                      onKeyDown={quickVelocityInput.handleKeyDown}
                      onBlur={quickVelocityInput.handleBlur}
                      className={getInputValidationClasses(
                        quickVelocityInput.isValid,
                        quickVelocityInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="1"
                      max="30"
                      step="0.1"
                      disabled={isQuickScanInProgress}
                      placeholder="1-30 mm/s"
                    />
                  </div>
                  <div className="flex-1 input-validation-container">
                    <label className="block text-gray-300 font-medium mb-1">Target FPS</label>
                    <input
                      type="number"
                      value={quickFpsInput.inputValue}
                      onChange={quickFpsInput.handleInputChange}
                      onKeyDown={quickFpsInput.handleKeyDown}
                      onBlur={quickFpsInput.handleBlur}
                      className={getInputValidationClasses(
                        quickFpsInput.isValid,
                        quickFpsInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-600 border rounded text-white text-xs"
                      )}
                      min="1"
                      max="60"
                      disabled={isQuickScanInProgress}
                      placeholder="1-60 fps"
                    />
                  </div>
                </div>
              </div>
              
              {/* Upload During Scanning Toggle */}
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-purple-300 font-medium mb-1"><i className="fas fa-cloud-upload-alt mr-1"></i>Upload Settings</div>
                <label className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={quickScanParameters.uploading}
                    onChange={(e) => setQuickScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                    className="mr-2"
                    disabled={isQuickScanInProgress}
                  />
                  Upload during scanning
                  <i className="fas fa-question-circle ml-1 text-gray-400" title="Enable background upload of scan data to artifact manager during scanning"></i>
                </label>
              </div>
              
              <div className="bg-gray-700 p-2 rounded text-xs">
                <div className="text-yellow-300 font-medium mb-1"><i className="fas fa-info-circle mr-1"></i>Quick Scan Info</div>
                <div>• Brightfield channel only</div>
                <div>• {quickScanParameters.n_stripes}-stripe × {quickScanParameters.stripe_width_mm}mm serpentine pattern per well</div>
                <div>• Maximum exposure: 30ms</div>
                <div>• Scans entire {quickScanParameters.wellplate_type}-well plate</div>
                <div>• Estimated scan time: {(() => {
                  const wellplateSizes = {'96': 96};
                  const wells = wellplateSizes[quickScanParameters.wellplate_type] || 96;
                  const stripesPerWell = quickScanParameters.n_stripes;
                  const timePerStripe = quickScanParameters.stripe_width_mm / quickScanParameters.velocity_scan_mm_per_s;
                  const estimatedTimeSeconds = wells * stripesPerWell * timePerStripe * 1.5; // 1.5x factor for movement overhead
                  return estimatedTimeSeconds < 60 ? `${Math.round(estimatedTimeSeconds)}s` : `${Math.round(estimatedTimeSeconds/60)}min`;
                })()}</div>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-3">
              <button
                onClick={async () => {
                  if (!microscopeControlService) return;
                  
                  if (isQuickScanInProgress) {
                    // Stop scan logic
                    try {
                      if (appendLog) appendLog('Stopping quick scan...');
                      
                      const result = await microscopeControlService.stop_scan_and_stitching();
                      
                      if (result.success) {
                        if (showNotification) showNotification('Quick scan stop requested', 'success');
                        setIsQuickScanInProgress(false);
                        if (appendLog) appendLog('Quick scan stopped successfully');
                      } else {
                        if (showNotification) showNotification('Failed to stop quick scan', 'error');
                        if (appendLog) appendLog(`Quick scan stop failed: ${result.message}`);
                      }
                    } catch (error) {
                      if (showNotification) showNotification('Error stopping quick scan', 'error');
                      if (appendLog) appendLog(`Quick scan stop error: ${error.message}`);
                    }
                  } else {
                    // Start scan logic
                    try {
                      if (appendLog) appendLog('Starting quick scan...');
                      
                      // Set scanning state immediately to update UI
                      setIsQuickScanInProgress(true);
                      
                      const result = await microscopeControlService.quick_scan_with_stitching(
                        quickScanParameters.wellplate_type,
                        quickScanParameters.exposure_time,
                        quickScanParameters.intensity,
                        quickScanParameters.fps_target,
                        'quick_scan_' + Date.now(),
                        quickScanParameters.n_stripes,
                        quickScanParameters.stripe_width_mm,
                        quickScanParameters.dy_mm,
                        quickScanParameters.velocity_scan_mm_per_s,
                        quickScanParameters.do_contrast_autofocus,
                        quickScanParameters.do_reflection_af,
                        activeExperiment, // experiment_name parameter
                        wellPaddingMm, // well_padding_mm parameter
                        quickScanParameters.uploading // uploading parameter
                      );
                      
                      if (appendLog) appendLog(`Quick scan result: ${JSON.stringify(result)}`);
                      
                      if (result && result.success) {
                        if (showNotification) showNotification('Quick scan started', 'success');
                        if (appendLog) appendLog('Quick scan started successfully');
                      } else {
                        // If scan failed, reset the state
                        setIsQuickScanInProgress(false);
                        if (showNotification) showNotification('Failed to start quick scan', 'error');
                        if (appendLog) appendLog(`Quick scan start failed: ${result ? result.message : 'No result returned'}`);
                      }
                    } catch (error) {
                      // If error occurred, reset the state
                      setIsQuickScanInProgress(false);
                      if (showNotification) showNotification('Error starting quick scan', 'error');
                      if (appendLog) appendLog(`Quick scan start error: ${error.message}`);
                      console.error('Quick scan error:', error);
                    }
                  }
                }}
                className={`px-3 py-1 text-xs ${isQuickScanInProgress ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'} text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center`}
                disabled={!microscopeControlService}
              >
                {isQuickScanInProgress ? (
                  <>
                    <i className="fas fa-stop mr-1"></i>
                    Stop Quick Scan
                  </>
                ) : (
                  <>
                    <i className="fas fa-bolt mr-1"></i>
                    Start Quick Scan
                  </>
                )}
              </button>

            </div>
          </div>
        </div>
      )}

      {/* Scan Configuration Side Panel */}
      {showScanConfig && (
        <div className="absolute top-12 right-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 z-50 text-white scan-config-panel">
          <div className="flex items-center justify-between p-3 border-b border-gray-600 flex-shrink-0">
            <h3 className="text-sm font-semibold text-gray-200">Scan Configuration</h3>
            <button
              onClick={() => {
                setShowScanConfig(false);
                setIsRectangleSelection(false);
                setRectangleStart(null);
                setRectangleEnd(null);
                setDragSelectedWell(null);
                // Clean up grid drawing states
                setGridDragStart(null);
                setGridDragEnd(null);
                setIsGridDragging(false);
              }}
              className="text-gray-400 hover:text-white p-1"
              title="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          
          <div className="p-3 scan-config-content">
            {/* --- Multi-well Selection Grid UI --- */}
            <div className="scan-well-plate-grid-container">
              <div className="flex flex-col w-full items-center">
                <div className="flex w-full items-center mb-1">
                  <span className="text-xs text-gray-300 mr-2">Selected: {selectedWells.length}</span>
                  <button
                    onClick={() => setSelectedWells([])}
                    className="ml-auto px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Clear all well selections"
                    disabled={selectedWells.length === 0}
                  >
                    <i className="fas fa-refresh mr-1"></i>Refresh
                  </button>
                </div>
                <div className="scan-well-plate-grid">
                  <div className="scan-grid-col-labels">
                    <div></div>
                    {getWellPlateGridLabels().cols.map((label, colIdx) => (
                      <div key={`col-${label}`} className="scan-grid-label">{label}</div>
                    ))}
                  </div>
                  {getWellPlateGridLabels().rows.map((rowLabel, rowIdx) => (
                    <div key={`row-${rowIdx}`} className="scan-grid-row">
                      <div className="scan-grid-label">{rowLabel}</div>
                      {getWellPlateGridLabels().cols.map((colLabel, colIdx) => {
                        const wellId = getWellIdFromIndex(rowIdx, colIdx);
                        const isSelected = selectedWells.includes(wellId);
                        const isDragSelected = gridSelectedCells[`${rowIdx}-${colIdx}`];
                        return (
                          <div
                            key={`cell-${rowIdx}-${colIdx}`}
                            className={`scan-grid-cell${isSelected || isDragSelected ? ' selected' : ''}`}
                            onMouseDown={() => handleGridCellMouseDown(rowIdx, colIdx)}
                            onMouseEnter={() => handleGridCellMouseEnter(rowIdx, colIdx)}
                            style={{ userSelect: 'none' }}
                          >
                            {/* Optionally show wellId or leave blank for cleaner look */}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-gray-300 font-medium mb-1">Start Position (mm)</label>
                <div className="flex space-x-2">
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={startXInput.inputValue}
                      onChange={startXInput.handleInputChange}
                      onKeyDown={startXInput.handleKeyDown}
                      onBlur={startXInput.handleBlur}
                      className={getInputValidationClasses(
                        startXInput.isValid,
                        startXInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      step="0.1"
                      disabled={isScanInProgress}
                      placeholder="X position"
                    />
                  </div>
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={startYInput.inputValue}
                      onChange={startYInput.handleInputChange}
                      onKeyDown={startYInput.handleKeyDown}
                      onBlur={startYInput.handleBlur}
                      className={getInputValidationClasses(
                        startYInput.isValid,
                        startYInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      step="0.1"
                      disabled={isScanInProgress}
                      placeholder="Y position"
                    />
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-gray-300 font-medium mb-1">Grid Size (positions)</label>
                <div className="flex space-x-2">
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={nxInput.inputValue}
                      onChange={nxInput.handleInputChange}
                      onKeyDown={nxInput.handleKeyDown}
                      onBlur={nxInput.handleBlur}
                      className={getInputValidationClasses(
                        nxInput.isValid,
                        nxInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      min="1"
                      disabled={isScanInProgress}
                      placeholder="Nx"
                    />
                  </div>
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={nyInput.inputValue}
                      onChange={nyInput.handleInputChange}
                      onKeyDown={nyInput.handleKeyDown}
                      onBlur={nyInput.handleBlur}
                      className={getInputValidationClasses(
                        nyInput.isValid,
                        nyInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      min="1"
                      disabled={isScanInProgress}
                      placeholder="Ny"
                    />
                  </div>
                </div>
              </div>
              
              <div>
                <label className="block text-gray-300 font-medium mb-1">Step Size (mm)</label>
                <div className="flex space-x-2">
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={dxInput.inputValue}
                      onChange={dxInput.handleInputChange}
                      onKeyDown={dxInput.handleKeyDown}
                      onBlur={dxInput.handleBlur}
                      className={getInputValidationClasses(
                        dxInput.isValid,
                        dxInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      step="0.1"
                      min="0.1"
                      disabled={isScanInProgress}
                      placeholder="dX step"
                    />
                  </div>
                  <div className="w-1/2 input-validation-container">
                    <input
                      type="number"
                      value={dyInput.inputValue}
                      onChange={dyInput.handleInputChange}
                      onKeyDown={dyInput.handleKeyDown}
                      onBlur={dyInput.handleBlur}
                      className={getInputValidationClasses(
                        dyInput.isValid,
                        dyInput.hasUnsavedChanges,
                        "w-full px-2 py-1 bg-gray-700 border rounded text-white"
                      )}
                      step="0.1"
                      min="0.1"
                      disabled={isScanInProgress}
                      placeholder="dY step"
                    />
                  </div>
                </div>
              </div>
              

              
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-gray-300 font-medium">Illumination Channels</label>
                  <div className="flex space-x-1">
                    <button
                      onClick={() => {
                        if (isScanInProgress) return;
                        loadCurrentMicroscopeSettings();
                      }}
                      className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isScanInProgress || !microscopeControlService}
                      title="Load current microscope settings"
                    >
                      <i className="fas fa-download mr-1"></i>
                      Load Current
                    </button>
                    <button
                      onClick={() => {
                        if (isScanInProgress) return;
                        // Find a channel that's not already in use
                        const availableChannels = [
                          'BF LED matrix full',
                          'Fluorescence 405 nm Ex',
                          'Fluorescence 488 nm Ex',
                          'Fluorescence 561 nm Ex',
                          'Fluorescence 638 nm Ex',
                          'Fluorescence 730 nm Ex'
                        ];
                        const usedChannels = scanParameters.illumination_settings.map(s => s.channel);
                        const nextChannel = availableChannels.find(c => !usedChannels.includes(c)) || 'BF LED matrix full';
                        
                        setScanParameters(prev => ({
                          ...prev,
                          illumination_settings: [
                            ...prev.illumination_settings,
                            {
                              channel: nextChannel,
                              intensity: 50,
                              exposure_time: 100
                            }
                          ]
                        }));
                      }}
                      className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={isScanInProgress || scanParameters.illumination_settings.length >= 6}
                      title="Add channel"
                    >
                      <i className="fas fa-plus mr-1"></i>
                      Add Channel
                    </button>
                  </div>
                </div>
                
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {scanParameters.illumination_settings.map((setting, index) => (
                    <div key={index} className="bg-gray-700 p-2 rounded border border-gray-600">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-gray-300 font-medium">Channel {index + 1}</span>
                        <button
                          onClick={() => {
                            if (isScanInProgress || scanParameters.illumination_settings.length <= 1) return;
                            setScanParameters(prev => ({
                              ...prev,
                              illumination_settings: prev.illumination_settings.filter((_, i) => i !== index)
                            }));
                          }}
                          className="px-1 py-0.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
                          disabled={isScanInProgress || scanParameters.illumination_settings.length <= 1}
                          title="Remove channel"
                        >
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                      
                      <div className="space-y-2">
                        <div className="relative">
                          <select
                            value={setting.channel}
                            onChange={(e) => {
                              if (isScanInProgress) return;
                              setScanParameters(prev => ({
                                ...prev,
                                illumination_settings: prev.illumination_settings.map((s, i) => 
                                  i === index ? { ...s, channel: e.target.value } : s
                                )
                              }));
                            }}
                            className={`w-full px-2 py-1 text-xs bg-gray-600 border rounded text-white ${
                              scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1 
                                ? 'border-yellow-500' 
                                : 'border-gray-500'
                            }`}
                            disabled={isScanInProgress}
                          >
                            <option value="BF LED matrix full">BF LED matrix full</option>
                            <option value="Fluorescence 405 nm Ex">Fluorescence 405 nm Ex</option>
                            <option value="Fluorescence 488 nm Ex">Fluorescence 488 nm Ex</option>
                            <option value="Fluorescence 561 nm Ex">Fluorescence 561 nm Ex</option>
                            <option value="Fluorescence 638 nm Ex">Fluorescence 638 nm Ex</option>
                            <option value="Fluorescence 730 nm Ex">Fluorescence 730 nm Ex</option>
                          </select>
                          {scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1 && (
                            <div className="absolute -top-1 -right-1">
                              <i className="fas fa-exclamation-triangle text-yellow-500 text-xs" title="Duplicate channel detected"></i>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex space-x-2">
                          <div className="flex-1">
                            <input
                              type="number"
                              value={setting.intensity}
                              onChange={(e) => {
                                if (isScanInProgress) return;
                                const value = parseInt(e.target.value) || 0;
                                if (value >= 1 && value <= 100) {
                                  setScanParameters(prev => ({
                                    ...prev,
                                    illumination_settings: prev.illumination_settings.map((s, i) => 
                                      i === index ? { ...s, intensity: value } : s
                                    )
                                  }));
                                }
                              }}
                              className="w-full px-2 py-1 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                              min="1"
                              max="100"
                              disabled={isScanInProgress}
                              placeholder="Intensity %"
                            />
                          </div>
                          <div className="flex-1">
                            <input
                              type="number"
                              value={setting.exposure_time}
                              onChange={(e) => {
                                if (isScanInProgress) return;
                                const value = parseInt(e.target.value) || 0;
                                if (value >= 1 && value <= 1000) {
                                  setScanParameters(prev => ({
                                    ...prev,
                                    illumination_settings: prev.illumination_settings.map((s, i) => 
                                      i === index ? { ...s, exposure_time: value } : s
                                    )
                                  }));
                                }
                              }}
                              className="w-full px-2 py-1 text-xs bg-gray-600 border border-gray-500 rounded text-white"
                              min="1"
                              max="1000"
                              disabled={isScanInProgress}
                              placeholder="Exposure ms"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                
                {scanParameters.illumination_settings.length > 1 && (
                  <div className="mt-2 p-2 bg-blue-900 bg-opacity-30 rounded border border-blue-500 text-xs">
                    <div className="flex items-center text-blue-300 mb-1">
                      <i className="fas fa-info-circle mr-1"></i>
                      Multi-channel Acquisition
                    </div>
                    <div className="text-gray-300">
                      Channels: {scanParameters.illumination_settings.map(s => 
                        s.channel.replace('Fluorescence ', '').replace(' Ex', '').replace('BF LED matrix full', 'BF')
                      ).join(', ')}
                    </div>
                    {scanParameters.illumination_settings.some((setting, index) => 
                      scanParameters.illumination_settings.filter(s => s.channel === setting.channel).length > 1
                    ) && (
                      <div className="text-yellow-300 mt-1">
                        <i className="fas fa-exclamation-triangle mr-1"></i>
                        Warning: Duplicate channels detected
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <div className="flex items-center space-x-4">
                <label className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={scanParameters.do_contrast_autofocus}
                    onChange={(e) => setScanParameters(prev => ({ ...prev, do_contrast_autofocus: e.target.checked }))}
                    className="mr-2"
                    disabled={isScanInProgress}
                  />
                  Contrast AF
                </label>
                <label className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={scanParameters.do_reflection_af}
                    onChange={(e) => setScanParameters(prev => ({ ...prev, do_reflection_af: e.target.checked }))}
                    className="mr-2"
                    disabled={isScanInProgress}
                  />
                  Reflection AF
                </label>
              </div>
              
              {/* Upload During Scanning Toggle */}
              <div className="bg-gray-700 p-2 rounded">
                <div className="text-purple-300 font-medium mb-1"><i className="fas fa-cloud-upload-alt mr-1"></i>Upload Settings</div>
                <label className="flex items-center text-xs">
                  <input
                    type="checkbox"
                    checked={scanParameters.uploading}
                    onChange={(e) => setScanParameters(prev => ({ ...prev, uploading: e.target.checked }))}
                    className="mr-2"
                    disabled={isScanInProgress}
                  />
                  Upload during scanning
                  <i className="fas fa-question-circle ml-1 text-gray-400" title="Enable background upload of scan data to artifact manager during scanning"></i>
                </label>
              </div>
              
              <div className="bg-gray-700 p-2 rounded text-xs">
                <div>Total scan area: {(scanParameters.Nx * scanParameters.dx_mm).toFixed(1)} × {(scanParameters.Ny * scanParameters.dy_mm).toFixed(1)} mm</div>
                <div>Total positions: {scanParameters.Nx * scanParameters.Ny}</div>
                <div>Channels: {scanParameters.illumination_settings.length}</div>
                <div>Total images: {scanParameters.Nx * scanParameters.Ny * scanParameters.illumination_settings.length}</div>
                <div>End position: ({(scanParameters.start_x_mm + (scanParameters.Nx-1) * scanParameters.dx_mm).toFixed(1)}, {(scanParameters.start_y_mm + (scanParameters.Ny-1) * scanParameters.dy_mm).toFixed(1)}) mm</div>
              </div>
              
              
              {isRectangleSelection && (
                <div className="bg-blue-900 bg-opacity-50 p-2 rounded text-xs border border-blue-500">
                  <i className="fas fa-vector-square mr-1"></i>
                  Drag on the map to select scan area. Current settings will be used as defaults.
                </div>
              )}
            </div>
            
                        <div className="flex justify-end space-x-2 mt-4">
                <button
                  onClick={() => {
                    if (isScanInProgress) return;
                    if (isRectangleSelection) {
                      // Stop rectangle selection
                      setIsRectangleSelection(false);
                      setRectangleStart(null);
                      setRectangleEnd(null);
                      setDragSelectedWell(null);
                    } else {
                      // Start rectangle selection - clear any existing selection first
                      setRectangleStart(null);
                      setRectangleEnd(null);
                      setDragSelectedWell(null);
                      setIsRectangleSelection(true);
                    }
                  }}
                  className={`px-3 py-1 text-xs rounded disabled:opacity-50 disabled:cursor-not-allowed ${
                    isRectangleSelection ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-600 hover:bg-gray-500 text-white'
                  }`}
                  disabled={isScanInProgress}
                >
                  <i className="fas fa-vector-square mr-1"></i>
                  {isRectangleSelection ? 'Stop Selection' : 'Select Area'}
                </button>
                <button
                  onClick={async () => {
                    if (!microscopeControlService) return;
                    
                    if (isScanInProgress) {
                      // Stop scan logic
                      try {
                        if (appendLog) appendLog('Stopping scan...');
                        
                        const result = await microscopeControlService.stop_scan_and_stitching();
                        
                        if (result.success) {
                          if (showNotification) showNotification('Scan stop requested', 'success');
                          if (appendLog) appendLog('Scan stop requested - scan will be interrupted');
                          setIsScanInProgress(false);
                          if (setMicroscopeBusy) setMicroscopeBusy(false);
                          if (setCurrentOperation) setCurrentOperation(null); // Re-enable sidebar
                        } else {
                          if (showNotification) showNotification(`Failed to stop scan: ${result.message}`, 'error');
                          if (appendLog) appendLog(`Failed to stop scan: ${result.message}`);
                        }
                      } catch (error) {
                        if (showNotification) showNotification(`Error stopping scan: ${error.message}`, 'error');
                        if (appendLog) appendLog(`Error stopping scan: ${error.message}`);
                      }
                      return;
                    }
                    

                    
                    // Check if WebRTC is active and stop it to prevent camera resource conflict
                    const wasWebRtcActive = isWebRtcActive;
                    if (wasWebRtcActive) {
                      if (appendLog) appendLog('Stopping WebRTC stream to prevent camera resource conflict during scanning...');
                      try {
                        if (toggleWebRtcStream) {
                          toggleWebRtcStream(); // This will stop the WebRTC stream
                          // Wait a moment for the stream to fully stop
                          await new Promise(resolve => setTimeout(resolve, 500));
                        } else {
                          if (appendLog) appendLog('Warning: toggleWebRtcStream function not available, proceeding with scan...');
                        }
                      } catch (webRtcError) {
                        if (appendLog) appendLog(`Warning: Failed to stop WebRTC stream: ${webRtcError.message}. Proceeding with scan...`);
                      }
                    }
                    
                    setIsScanInProgress(true);
                    if (setMicroscopeBusy) setMicroscopeBusy(true); // Also set global busy state
                    if (setCurrentOperation) setCurrentOperation('scanning'); // Disable sidebar during scanning
                    
                    // Disable rectangle selection during scanning to allow map browsing
                    setIsRectangleSelection(false);
                    setRectangleStart(null);
                    setRectangleEnd(null);
                    
                    try {
                      
                      
                      if (appendLog) {
                        const channelNames = scanParameters.illumination_settings.map(s => s.channel).join(', ');
                        appendLog(`Starting scan: ${scanParameters.Nx}×${scanParameters.Ny} positions from (${scanParameters.start_x_mm.toFixed(1)}, ${scanParameters.start_y_mm.toFixed(1)}) mm`);
                        appendLog(`Channels: ${channelNames}`);
                      }
                      
                      const result = await microscopeControlService.normal_scan_with_stitching(
                        scanParameters.start_x_mm,
                        scanParameters.start_y_mm,
                        scanParameters.Nx,
                        scanParameters.Ny,
                        scanParameters.dx_mm,
                        scanParameters.dy_mm,
                        scanParameters.illumination_settings,
                        scanParameters.do_contrast_autofocus,
                        scanParameters.do_reflection_af,
                        'scan_' + Date.now(),
                        0, // timepoint index
                        activeExperiment, // experiment_name parameter
                        selectedWells, // <-- now supports multi-well
                        wellPlateType, // wellplate_type parameter
                        wellPaddingMm, // well_padding_mm parameter
                        scanParameters.uploading // uploading parameter
                      );
                      
                      if (result.success) {
                        if (showNotification) showNotification('Scan completed successfully', 'success');
                        if (appendLog) {
                          appendLog('Scan completed successfully');
                          if (wasWebRtcActive) {
                            appendLog('Note: WebRTC stream was stopped for scanning. Click "Start Live" to resume video stream if needed.');
                          }
                        }
                        setShowScanConfig(false);
                        setIsRectangleSelection(false);
                        setRectangleStart(null);
                        setRectangleEnd(null);
                        // Enable scan results layer if not already
                        setVisibleLayers(prev => ({ ...prev, scanResults: true }));
                        
                        // Refresh scan results display once after completion
                        setTimeout(() => {
                          refreshScanResults();
                        }, 1000); // Wait 1 second then refresh
                      } else {
                        if (showNotification) showNotification(`Scan failed: ${result.message}`, 'error');
                        if (appendLog) appendLog(`Scan failed: ${result.message}`);
                      }
                    } catch (error) {
                      if (showNotification) showNotification(`Scan error: ${error.message}`, 'error');
                      if (appendLog) appendLog(`Scan error: ${error.message}`);
                    } finally {
                      setIsScanInProgress(false);
                      if (setMicroscopeBusy) setMicroscopeBusy(false); // Clear global busy state
                      if (setCurrentOperation) setCurrentOperation(null); // Re-enable sidebar
                    }
                  }}
                className={`px-3 py-1 text-xs text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center ${
                  isScanInProgress ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'
                }`}
                disabled={!microscopeControlService}
              >
                {isScanInProgress ? (
                  <>
                    <i className="fas fa-stop mr-1"></i>
                    Stop Scan
                  </>
                ) : (
                  <>
                    <i className="fas fa-play mr-1"></i>
                    Start Scan
                  </>
                )}
              </button>
              

            </div>
          </div>
        </div>
      )}
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
                <div className="text-gray-300 font-medium mb-2">Experiment Galleries</div>
                {galleriesLoading && <div className="text-xs text-gray-400">Loading galleries...</div>}
                {galleriesError && <div className="text-xs text-red-400">{galleriesError}</div>}
                {!galleriesLoading && !galleriesError && galleries.length === 0 && (
                  <div className="text-xs text-gray-400">No galleries found for this microscope.</div>
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
};

export default MicroscopeMapDisplay; 