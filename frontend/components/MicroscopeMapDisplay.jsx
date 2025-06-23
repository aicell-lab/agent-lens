import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import PropTypes from 'prop-types';
import './MicroscopeMapDisplay.css';

const MicroscopeMapDisplay = ({
  isOpen,
  onClose,
  microscopeConfiguration,
  isWebRtcActive,
  videoRef,
  remoteStream,
  frameMetadata,
  videoZoom,
  snapshotImage,
  isDragging,
  dragTransform,
  microscopeControlService,
  appendLog,
  showNotification,
}) => {
  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapVideoRef = useRef(null);
  const [scaleLevel, setScaleLevel] = useState(3); // Start at most zoomed out (scale 3) for overview
  const [zoomLevel, setZoomLevel] = useState(0.5); // Start at 50% zoom for scale 3 overview
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showWellPlate, setShowWellPlate] = useState(true);
  
  // Real-time stitching states
  const [stitchingStatus, setStitchingStatus] = useState({
    real_time_stitching_active: false,
    live_canvas_enabled: false,
    stitcher_initialized: false,
    canvas_path: null
  });
  const [showStitchingLayer, setShowStitchingLayer] = useState(false);
  const [stitchingChunks, setStitchingChunks] = useState(new Map()); // Map of chunk_key -> base64 image data
  const [failedChunks, setFailedChunks] = useState(new Map()); // Map of chunk_key -> timestamp of failure
  const [isLoadingStitching, setIsLoadingStitching] = useState(false);
  const [showChunkBorders, setShowChunkBorders] = useState(false); // Debug mode

  // Debouncing ref for chunk loading
  const chunkLoadTimeoutRef = useRef(null);

  // Inverted base scale: higher scale level = more zoomed out (shows more area)
  // Scale 0: 1x (normal), Scale 1: 0.25x, Scale 2: 0.0625x, Scale 3: 0.015625x (4x difference between levels)
  // NOTE: The backend zarr file uses scale 1-3, where UI scale 0 maps to backend scale 1
  const baseScale = 1 / Math.pow(4, scaleLevel);
  const mapScale = baseScale * zoomLevel;

  // Calculate stage dimensions from configuration
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

  // Get current stage position from metadata
  const currentStagePosition = useMemo(() => {
    if (!frameMetadata?.stage_position) {
      return null;
    }
    return {
      x: frameMetadata.stage_position.x_mm,
      y: frameMetadata.stage_position.y_mm,
      z: frameMetadata.stage_position.z_mm
    };
  }, [frameMetadata]);

  // Calculate video frame position on the map
  const videoFramePosition = useMemo(() => {
    if (!currentStagePosition || !stageDimensions) {
      return null;
    }
    
    // Video frame is 750x750 pixels representing the calculated FOV in mm
    
    // Coordinate system: (0,0) is upper-left corner
    return {
      x: (currentStagePosition.x - stageDimensions.xMin) * pixelsPerMm * mapScale + mapPan.x,
      y: (currentStagePosition.y - stageDimensions.yMin) * pixelsPerMm * mapScale + mapPan.y,
      width: fovSize * pixelsPerMm * mapScale,
      height: fovSize * pixelsPerMm * mapScale
    };
  }, [currentStagePosition, stageDimensions, mapScale, mapPan, microscopeConfiguration]);

  // Handle map panning
  const handleMouseDown = (e) => {
    if (e.button === 0) { // Left click
      setIsPanning(true);
      setPanStart({ x: e.clientX - mapPan.x, y: e.clientY - mapPan.y });
    }
  };

  const handleMouseMove = (e) => {
    if (isPanning) {
      setMapPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleDoubleClick = async (e) => {
    if (!microscopeControlService || !microscopeConfiguration || !stageDimensions) {
      if (showNotification) {
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
    const zoomDelta = e.deltaY > 0 ? 0.95 : 1.05; // Smaller steps for smoother zoom
    let newZoomLevel = zoomLevel * zoomDelta;
    
    const rect = mapContainerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Check if we should change scale level
    if (newZoomLevel > 2.0 && scaleLevel > 0) {
      // Zoom in to higher resolution (lower scale number = less zoomed out)
      // Calculate equivalent zoom level in the new scale to maintain continuity
      const equivalentZoom = (newZoomLevel * (1 / Math.pow(4, scaleLevel))) / (1 / Math.pow(4, scaleLevel - 1));
      zoomToPoint(Math.min(2.0, equivalentZoom), scaleLevel - 1, mouseX, mouseY);
    } else if (newZoomLevel < 0.17 && scaleLevel < 3) {
      // Zoom out to lower resolution (higher scale number = more zoomed out)
      // Calculate equivalent zoom level in the new scale to maintain continuity
      const equivalentZoom = (newZoomLevel * (1 / Math.pow(4, scaleLevel))) / (1 / Math.pow(4, scaleLevel + 1));
      zoomToPoint(Math.max(0.17, equivalentZoom), scaleLevel + 1, mouseX, mouseY);
    } else {
      // Smooth zoom within current scale level
      newZoomLevel = Math.max(0.17, Math.min(2.0, newZoomLevel));
      zoomToPoint(newZoomLevel, scaleLevel, mouseX, mouseY);
    }
  }, [zoomLevel, scaleLevel, zoomToPoint]);

  // Calculate which chunks are visible in the current viewport
  const calculateVisibleChunks = useCallback(() => {
    if (!mapContainerRef.current) return [];
    
    const container = mapContainerRef.current;
    const viewportWidth = container.clientWidth;
    const viewportHeight = container.clientHeight;
    
    // Canvas dimensions in mm (as specified in requirements)
    const canvasWidthMm = 120;
    const canvasHeightMm = 86;
    
    // Chunk size in mm based on scale level - ONLY for current scale
    const backendScaleLevel = Math.max(1, scaleLevel); // Map UI scale to backend scale
    const scaleFactors = {1: 1, 2: 4, 3: 16}; // Backend scale factors (1-based)
    const scaleFactor = scaleFactors[backendScaleLevel] || 4;
    
    // Backend uses pixel_size_um = 0.333, chunk_size = 256
    const pixelSizeMm = 0.333 / 1000; // Convert µm to mm
    const chunkSizeMm = 256 * pixelSizeMm * scaleFactor; // Size of one chunk in mm
    
    // Calculate visible area bounds in canvas coordinates (mm)
    // Canvas starts at (0,0) and extends to (120mm, 86mm), displayed at mapPan position
    const canvasVisibleLeftMm = Math.max(0, -mapPan.x / (pixelsPerMm * mapScale));
    const canvasVisibleTopMm = Math.max(0, -mapPan.y / (pixelsPerMm * mapScale));
    const canvasVisibleRightMm = Math.min(canvasWidthMm, (viewportWidth - mapPan.x) / (pixelsPerMm * mapScale));
    const canvasVisibleBottomMm = Math.min(canvasHeightMm, (viewportHeight - mapPan.y) / (pixelsPerMm * mapScale));
    
    // Early exit if no visible area
    if (canvasVisibleLeftMm >= canvasVisibleRightMm || canvasVisibleTopMm >= canvasVisibleBottomMm) {
      return [];
    }
    
    // Calculate which chunks are visible (with bounds checking)
    const chunkStartX = Math.max(0, Math.floor(canvasVisibleLeftMm / chunkSizeMm));
    const chunkEndX = Math.min(Math.ceil(canvasWidthMm / chunkSizeMm) - 1, Math.ceil(canvasVisibleRightMm / chunkSizeMm));
    const chunkStartY = Math.max(0, Math.floor(canvasVisibleTopMm / chunkSizeMm));
    const chunkEndY = Math.min(Math.ceil(canvasHeightMm / chunkSizeMm) - 1, Math.ceil(canvasVisibleBottomMm / chunkSizeMm));
    
    const visibleChunks = [];
    
    // Safety limit - don't load too many chunks at once
    const MAX_CHUNKS_PER_DIMENSION = 50; // Max 50x50 = 2500 chunks (still a lot but reasonable)
    const chunkCountX = chunkEndX - chunkStartX + 1;
    const chunkCountY = chunkEndY - chunkStartY + 1;
    
    if (chunkCountX > MAX_CHUNKS_PER_DIMENSION || chunkCountY > MAX_CHUNKS_PER_DIMENSION) {
      console.warn(`[MicroscopeMapDisplay] Too many chunks requested: ${chunkCountX}x${chunkCountY}. Limiting to viewport only.`);
      // Reduce to a reasonable viewport-sized area
      const centerChunkX = Math.floor((chunkStartX + chunkEndX) / 2);
      const centerChunkY = Math.floor((chunkStartY + chunkEndY) / 2);
      const halfLimit = Math.floor(MAX_CHUNKS_PER_DIMENSION / 4); // Much smaller limit
      
      const limitedStartX = Math.max(0, centerChunkX - halfLimit);
      const limitedEndX = Math.min(Math.ceil(canvasWidthMm / chunkSizeMm) - 1, centerChunkX + halfLimit);
      const limitedStartY = Math.max(0, centerChunkY - halfLimit);
      const limitedEndY = Math.min(Math.ceil(canvasHeightMm / chunkSizeMm) - 1, centerChunkY + halfLimit);
      
      for (let chunkX = limitedStartX; chunkX <= limitedEndX; chunkX++) {
        for (let chunkY = limitedStartY; chunkY <= limitedEndY; chunkY++) {
          const centerXMm = (chunkX + 0.5) * chunkSizeMm;
          const centerYMm = (chunkY + 0.5) * chunkSizeMm;
          
          visibleChunks.push({ 
            chunkX, 
            chunkY, 
            centerXMm,
            centerYMm,
            scale: backendScaleLevel  // ONLY current backend scale (1-3)
          });
        }
      }
    } else {
      // Normal case - load all visible chunks
      for (let chunkX = chunkStartX; chunkX <= chunkEndX; chunkX++) {
        for (let chunkY = chunkStartY; chunkY <= chunkEndY; chunkY++) {
          const centerXMm = (chunkX + 0.5) * chunkSizeMm;
          const centerYMm = (chunkY + 0.5) * chunkSizeMm;
          
          visibleChunks.push({ 
            chunkX, 
            chunkY, 
            centerXMm,
            centerYMm,
            scale: backendScaleLevel  // ONLY current backend scale (1-3)
          });
        }
      }
    }
    
    // Debug logging for chunk calculation
    console.log(`[MicroscopeMapDisplay] Scale ${scaleLevel} (backend ${backendScaleLevel}): visible area ${canvasVisibleLeftMm.toFixed(1)}-${canvasVisibleRightMm.toFixed(1)}mm x ${canvasVisibleTopMm.toFixed(1)}-${canvasVisibleBottomMm.toFixed(1)}mm, chunk size ${chunkSizeMm.toFixed(2)}mm, chunks ${chunkStartX}-${chunkEndX} x ${chunkStartY}-${chunkEndY} = ${visibleChunks.length} total`);
    
    return visibleChunks;
  }, [mapScale, mapPan, scaleLevel, pixelsPerMm]);

  // Load stitching chunks
  const loadStitchingChunks = useCallback(async () => {
    if (!showStitchingLayer || !microscopeControlService || !stitchingStatus.stitcher_initialized) {
      return;
    }
    
    // Don't start a new load if one is already in progress
    if (isLoadingStitching) {
      return;
    }
    
    setIsLoadingStitching(true);
    
    try {
      const visibleChunks = calculateVisibleChunks();
      
      // Safety check - if too many chunks, something is wrong
      if (visibleChunks.length > 1000) {
        console.error(`[MicroscopeMapDisplay] ERROR: Too many visible chunks calculated: ${visibleChunks.length}. Aborting load.`);
        setIsLoadingStitching(false);
        return;
      }
      
      // Create a list of chunks that need to be loaded
      const chunksToLoad = [];
      const currentTime = Date.now();
      const RETRY_DELAY_MS = 30000; // 30 seconds before retrying a failed chunk
      
      for (const chunk of visibleChunks) {
        const chunkKey = `${chunk.chunkX}_${chunk.chunkY}_${chunk.scale}`;
        
        // Skip if already loaded
        if (stitchingChunks.has(chunkKey)) {
          continue;
        }
        
        // Skip if recently failed (within retry delay)
        const failureTime = failedChunks.get(chunkKey);
        if (failureTime && (currentTime - failureTime) < RETRY_DELAY_MS) {
          continue;
        }
        
        chunksToLoad.push(chunk);
      }
      
      if (chunksToLoad.length === 0) {
        setIsLoadingStitching(false);
        return;
      }
      
      const backendScale = Math.max(1, scaleLevel);
      console.log(`[MicroscopeMapDisplay] Loading ${chunksToLoad.length} stitching chunks at UI scale ${scaleLevel} (backend scale ${backendScale})`);
      
      // Log some sample chunks for debugging
      if (chunksToLoad.length > 0) {
        const sample = chunksToLoad[0];
        console.log(`[MicroscopeMapDisplay] Sample chunk: chunkIdx=(${sample.chunkX},${sample.chunkY}) at ${sample.centerXMm.toFixed(2)}mm,${sample.centerYMm.toFixed(2)}mm, backend scale=${sample.scale}`);
      }
      
      // Load chunks in parallel with a limit
      const MAX_CONCURRENT_LOADS = 4;
      let successCount = 0;
      let errorCount = 0;
      
      for (let i = 0; i < chunksToLoad.length; i += MAX_CONCURRENT_LOADS) {
        const batch = chunksToLoad.slice(i, i + MAX_CONCURRENT_LOADS);
        
        const batchPromises = batch.map(async (chunk) => {
          const chunkKey = `${chunk.chunkX}_${chunk.chunkY}_${chunk.scale}`;
          
          try {
            if (!microscopeControlService.get_canvas_chunk) {
              console.warn('[MicroscopeMapDisplay] get_canvas_chunk method not available');
              return null;
            }
            
            // Call with chunk indices (much simpler!)
            // Backend expects chunk indices (0, 1, 2, 3...) not pixel coordinates
            const chunkData = await microscopeControlService.get_canvas_chunk(
              chunk.chunkX,     // chunk_x (index like 0, 1, 2, 3...)
              chunk.chunkY,     // chunk_y (index like 0, 1, 2, 3...)
              chunk.scale       // scale_level (1-3)
            );
            
            // Handle the response format from the backend
            if (chunkData && chunkData.data) {
              // Success case - data field contains base64 PNG
              return {
                key: chunkKey,
                data: {
                  chunkX: chunk.chunkX,
                  chunkY: chunk.chunkY,
                  scale: chunk.scale,
                  data: chunkData.data  // base64 PNG data
                }
              };
            } else if (chunkData && chunkData.success === false) {
              // Error case - chunk doesn't exist or other error
              // Only log if it's not a common "missing chunk" error
              if (chunkData.error && 
                  !chunkData.error.includes('Failed to retrieve chunk data') &&
                  !chunkData.error.includes('not available in local mode') &&
                  !chunkData.error.includes('only available in simulation mode')) {
                console.warn(`[MicroscopeMapDisplay] Chunk ${chunkKey} error: ${chunkData.error}`);
              }
              // Mark chunk as failed
              return { key: chunkKey, failed: true };
            }
          } catch (error) {
            console.error(`[MicroscopeMapDisplay] Error loading chunk ${chunkKey}:`, error);
            // Mark chunk as failed due to exception
            return { key: chunkKey, failed: true };
          }
          return { key: chunkKey, failed: true };
        });
        
        // Wait for this batch to complete before starting the next
        const batchResults = await Promise.all(batchPromises);
        
        // Separate successful and failed chunks
        const successfulChunks = batchResults.filter(result => result && !result.failed);
        const failedChunks = batchResults.filter(result => result && result.failed);
        
        successCount += successfulChunks.length;
        errorCount += failedChunks.length;
        
        // Update chunks state with successfully loaded chunks
        if (successfulChunks.length > 0) {
          setStitchingChunks(prev => {
            const newChunks = new Map(prev);
            successfulChunks.forEach(result => {
              newChunks.set(result.key, result.data);
            });
            return newChunks;
          });
        }
        
        // Track failed chunks with timestamp
        if (failedChunks.length > 0) {
          setFailedChunks(prev => {
            const newFailedChunks = new Map(prev);
            failedChunks.forEach(result => {
              newFailedChunks.set(result.key, currentTime);
            });
            return newFailedChunks;
          });
        }
      }
      
      console.log(`[MicroscopeMapDisplay] Chunk loading complete: ${successCount} successful, ${errorCount} failed/empty`);
      
    } catch (error) {
      console.error('[MicroscopeMapDisplay] Error loading stitching chunks:', error);
      if (appendLog) {
        appendLog(`Error loading stitching chunks: ${error.message}`);
      }
    } finally {
      setIsLoadingStitching(false);
    }
  }, [showStitchingLayer, microscopeControlService, stitchingStatus.stitcher_initialized, 
      calculateVisibleChunks, stitchingChunks, failedChunks, scaleLevel, isLoadingStitching]);

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

  // Load stitching chunks when layer is shown or viewport changes (with debouncing)
  useEffect(() => {
    if (showStitchingLayer && stitchingStatus.stitcher_initialized) {
      // Clear any existing timeout
      if (chunkLoadTimeoutRef.current) {
        clearTimeout(chunkLoadTimeoutRef.current);
      }
      
      // Set a new timeout to load chunks after a short delay
      chunkLoadTimeoutRef.current = setTimeout(() => {
        loadStitchingChunks();
      }, 150); // 150ms delay to debounce rapid pan/zoom
    }
    
    // Cleanup on unmount or when dependencies change
    return () => {
      if (chunkLoadTimeoutRef.current) {
        clearTimeout(chunkLoadTimeoutRef.current);
      }
    };
  }, [showStitchingLayer, stitchingStatus.stitcher_initialized, loadStitchingChunks, 
      mapPan.x, mapPan.y, mapScale]);

  // Handle video source assignment to prevent blinking
  useEffect(() => {
    if (mapVideoRef.current && remoteStream && isWebRtcActive && (scaleLevel === 0 || scaleLevel === 1)) {
      if (mapVideoRef.current.srcObject !== remoteStream) {
        console.log('Setting video source for map video element');
        mapVideoRef.current.srcObject = remoteStream;
        mapVideoRef.current.play().catch(error => {
          console.error('Error playing map video:', error);
        });
      }
    } else if (mapVideoRef.current && (!isWebRtcActive || scaleLevel > 1)) {
      if (mapVideoRef.current.srcObject) {
        console.log('Clearing video source for map video element');
        mapVideoRef.current.srcObject = null;
      }
    }
  }, [isWebRtcActive, scaleLevel, remoteStream]);

  // Fetch initial stitching status when map opens
  useEffect(() => {
    const fetchStitchingStatus = async () => {
      if (!isOpen || !microscopeControlService) return;
      
      try {
        if (microscopeControlService.get_real_time_stitching_status) {
          const status = await microscopeControlService.get_real_time_stitching_status();
          setStitchingStatus(status);
          console.log('[MicroscopeMapDisplay] Stitching status:', status);
        } else {
          console.warn('[MicroscopeMapDisplay] get_real_time_stitching_status method not available');
          // Set default disabled state if method doesn't exist
          setStitchingStatus({
            real_time_stitching_active: false,
            live_canvas_enabled: false,
            stitcher_initialized: false,
            canvas_path: null
          });
        }
      } catch (error) {
        console.error('[MicroscopeMapDisplay] Error fetching stitching status:', error);
        if (appendLog) {
          appendLog(`Error fetching stitching status: ${error.message}`);
        }
      }
    };
    
    fetchStitchingStatus();
  }, [isOpen, microscopeControlService]);

  // Debug effect to monitor video stream availability
  useEffect(() => {
    console.log('Map Display Debug:', {
      isWebRtcActive,
      scaleLevel,
      hasVideoRef: !!videoRef?.current,
      hasRemoteStream: !!remoteStream,
      hasMapVideoRef: !!mapVideoRef.current,
      showVideo: (scaleLevel === 0 || scaleLevel === 1) && isWebRtcActive && remoteStream
    });
  }, [isWebRtcActive, scaleLevel, remoteStream]);

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
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw stage boundaries and grid
    ctx.save();
    ctx.translate(mapPan.x, mapPan.y);
    ctx.scale(mapScale, mapScale);
    
    // Calculate stage position in pixels (origin at upper-left)
    const stagePixelX = 0;
    const stagePixelY = 0;
    const stagePixelWidth = stageDimensions.width * pixelsPerMm;
    const stagePixelHeight = stageDimensions.height * pixelsPerMm;
        
    // 96-well plate border
    const wellConfig = microscopeConfiguration?.wellplate?.formats?.['96_well'];
    if (wellConfig && showWellPlate) {
      const { well_spacing_mm, a1_x_mm, a1_y_mm } = wellConfig;
      
      // Calculate 96-well plate boundaries (A1 to H12)
      const plateStartX = a1_x_mm - well_spacing_mm * 0.5; // Half well before A1
      const plateStartY = a1_y_mm - well_spacing_mm * 0.5; // Half well before A1
      const plateEndX = a1_x_mm + 11 * well_spacing_mm + well_spacing_mm * 0.5; // Half well after column 12
      const plateEndY = a1_y_mm + 7 * well_spacing_mm + well_spacing_mm * 0.5; // Half well after row H
      
      // Convert to pixel coordinates
      const platePixelX = (plateStartX - stageDimensions.xMin) * pixelsPerMm;
      const platePixelY = (plateStartY - stageDimensions.yMin) * pixelsPerMm;
      const platePixelWidth = (plateEndX - plateStartX) * pixelsPerMm;
      const platePixelHeight = (plateEndY - plateStartY) * pixelsPerMm;
      
      // Draw well plate border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2 / mapScale;
      ctx.strokeRect(platePixelX, platePixelY, platePixelWidth, platePixelHeight);
    }
    
    ctx.restore();
  }, [isOpen, stageDimensions, mapScale, mapPan, showWellPlate]);

  // Render 96-well plate overlay
  const render96WellPlate = () => {
    if (!showWellPlate || !microscopeConfiguration) {
      return null;
    }
    
    // Use the correct configuration path from wellplate.formats
    const wellConfig = microscopeConfiguration?.wellplate?.formats?.['96_well'];
    
    if (!wellConfig) {
      return null;
    }
    
    const { well_size_mm, well_spacing_mm, a1_x_mm, a1_y_mm } = wellConfig;
    
    const wells = [];
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const cols = Array.from({ length: 12 }, (_, i) => i + 1);
    
    rows.forEach((row, rowIndex) => {
      cols.forEach((col, colIndex) => {
        // a1_x_mm and a1_y_mm already include offsets, don't add them again
        const centerX = a1_x_mm + colIndex * well_spacing_mm;
        const centerY = a1_y_mm + rowIndex * well_spacing_mm;
        
        // Convert to display coordinates (0,0 is upper-left corner)
        const displayX = (centerX - stageDimensions.xMin) * pixelsPerMm * mapScale + mapPan.x;
        const displayY = (centerY - stageDimensions.yMin) * pixelsPerMm * mapScale + mapPan.y;
        const displayRadius = (well_size_mm / 2) * pixelsPerMm * mapScale;
        
        wells.push(
          <g key={`${row}${col}`}>
            <circle
              cx={displayX}
              cy={displayY}
              r={displayRadius}
              fill="none"
              stroke="rgba(255, 255, 255, 0.6)"
              strokeWidth="1"
            />
            {scaleLevel >= 2 && (
              <text
                x={displayX}
                y={displayY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="rgba(255, 255, 255, 0.4)"
                fontSize={`${Math.min(12, 6 + scaleLevel * 2)}px`}
              >
                {row}{col}
              </text>
            )}
          </g>
        );
      });
    });
    
    return (
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      >
        {wells}
      </svg>
    );
  };

  // Render stitching layer
  const renderStitchingLayer = () => {
    if (!showStitchingLayer || !stitchingStatus.stitcher_initialized) {
      return null;
    }
    
    const chunks = [];
    const chunkSize = 256;
    
    // Calculate which chunks are visible in the current viewport
    const visibleChunks = calculateVisibleChunks();
    
    // Render only visible chunks
    visibleChunks.forEach(chunk => {
      const chunkKey = `${chunk.chunkX}_${chunk.chunkY}_${chunk.scale}`;
      const chunkData = stitchingChunks.get(chunkKey);
      
      // Check if chunk data exists and matches the current backend scale
      const currentBackendScale = Math.max(1, scaleLevel);
      if (chunkData && chunkData.scale === currentBackendScale) {
        // Calculate chunk position based on canvas coordinate system
        // Canvas origin is at (0,0) and extends to (120mm, 86mm)
        // Backend scale is 1-based, so map UI scale to backend scale
        const backendScale = Math.max(1, scaleLevel);
        const scaleFactors = {1: 1, 2: 4, 3: 16}; // Backend scale factors
        const scaleFactor = scaleFactors[backendScale] || 4;
        
        // Backend uses pixel_size_um = 0.333, chunk_size = 256
        const pixelSizeMm = 0.333 / 1000; // Convert µm to mm
        const chunkSizeMm = 256 * pixelSizeMm * scaleFactor; // Size of one chunk in mm
        
        // Convert chunk indices to mm position in canvas (top-left corner of chunk)
        const chunkXMm = chunk.chunkX * chunkSizeMm;
        const chunkYMm = chunk.chunkY * chunkSizeMm;
        
        // Convert mm to pixels and apply map transform
        const chunkX = chunkXMm * pixelsPerMm * mapScale + mapPan.x;
        const chunkY = chunkYMm * pixelsPerMm * mapScale + mapPan.y;
        
        // Display size should match the physical size of the chunk
        // The chunk represents chunkSizeMm at this scale level
        const displaySize = chunkSizeMm * pixelsPerMm * mapScale;
        
        chunks.push(
          <img
            key={chunkKey}
            src={`data:image/png;base64,${chunkData.data}`}
            style={{
              position: 'absolute',
              left: `${chunkX}px`,
              top: `${chunkY}px`,
              width: `${displaySize}px`,
              height: `${displaySize}px`,
              imageRendering: mapScale < 1 ? 'pixelated' : 'auto',
              pointerEvents: 'none',
              border: showChunkBorders ? '1px solid rgba(255, 0, 0, 0.3)' : 'none'
            }}
            alt={`Stitching chunk ${chunkKey}`}
            onError={(e) => {
              console.error(`Failed to load chunk ${chunkKey}`);
              // Remove failed chunk from cache
              setStitchingChunks(prev => {
                const newChunks = new Map(prev);
                newChunks.delete(chunkKey);
                return newChunks;
              });
            }}
          />
        );
      }
    });
    
    return (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: 0.8
        }}
      >
        {chunks}
        
        {/* Show loading indicator if chunks are being loaded */}
        {isLoadingStitching && (
          <div className="absolute top-16 left-4 bg-black bg-opacity-80 text-white p-2 rounded text-xs">
            <i className="fas fa-spinner fa-spin mr-2"></i>
            Loading stitching chunks...
          </div>
        )}
        
        {/* Debug info */}
        {visibleChunks.length > 0 && (
          <div className="absolute bottom-20 right-4 bg-black bg-opacity-60 text-white p-2 rounded text-xs">
            <div>Visible chunks: {visibleChunks.length} | Loaded: {
              Array.from(stitchingChunks.values()).filter(chunk => chunk.scale === Math.max(1, scaleLevel)).length
            } | Failed: {
              Array.from(failedChunks.keys()).filter(key => key.endsWith(`_${Math.max(1, scaleLevel)}`)).length
            }</div>
            <div>UI Scale: {scaleLevel} | Backend Scale: {Math.max(1, scaleLevel)}</div>
            <button
              onClick={() => setShowChunkBorders(!showChunkBorders)}
              className="mt-1 text-yellow-400 hover:text-yellow-300"
            >
              {showChunkBorders ? 'Hide' : 'Show'} chunk borders
            </button>
          </div>
        )}
      </div>
    );
  };

  // Handle start/stop stitching
  const handleToggleStitching = async () => {
    if (!microscopeControlService) return;
    
    try {
      if (stitchingStatus.real_time_stitching_active) {
        // Stop stitching
        if (microscopeControlService.stop_real_time_stitching) {
          await microscopeControlService.stop_real_time_stitching();
          if (appendLog) {
            appendLog('Stopping real-time stitching...');
          }
        } else {
          if (showNotification) {
            showNotification('Stop stitching function not available', 'warning');
          }
          return;
        }
      } else {
        // Start stitching
        if (microscopeControlService.start_real_time_stitching) {
          await microscopeControlService.start_real_time_stitching();
          if (appendLog) {
            appendLog('Starting real-time stitching...');
          }
        } else {
          if (showNotification) {
            showNotification('Start stitching function not available', 'warning');
          }
          return;
        }
      }
      
      // Refresh status
      if (microscopeControlService.get_real_time_stitching_status) {
        const status = await microscopeControlService.get_real_time_stitching_status();
        setStitchingStatus(status);
      }
    } catch (error) {
      console.error('[MicroscopeMapDisplay] Error toggling stitching:', error);
      if (appendLog) {
        appendLog(`Error toggling stitching: ${error.message}`);
      }
      if (showNotification) {
        showNotification(`Error toggling stitching: ${error.message}`, 'error');
      }
    }
  };

  // Handle refresh stitching map
  const handleRefreshStitching = async () => {
    if (!showStitchingLayer || !stitchingStatus.stitcher_initialized) return;
    
    // Clear current chunks and failed chunks to force reload
    setStitchingChunks(new Map());
    setFailedChunks(new Map());
    
    // Reload chunks
    await loadStitchingChunks();
    
    if (showNotification) {
      showNotification('Stitching map refreshed', 'success');
    }
  };

  // Clean up chunks that are far from the viewport
  const cleanupDistantChunks = useCallback(() => {
    if (stitchingChunks.size === 0) return;
    
    const visibleChunks = calculateVisibleChunks();
    const visibleKeys = new Set(visibleChunks.map(chunk => `${chunk.chunkX}_${chunk.chunkY}_${chunk.scale}`));
    
    // Add a buffer zone - keep chunks that are just outside the viewport
    const bufferMultiplier = 2; // Keep chunks within 2x the viewport
    const extendedVisibleChunks = [];
    
    visibleChunks.forEach(chunk => {
      // Add surrounding chunks to the buffer
      for (let dx = -bufferMultiplier; dx <= bufferMultiplier; dx++) {
        for (let dy = -bufferMultiplier; dy <= bufferMultiplier; dy++) {
          extendedVisibleChunks.push({
            chunkX: chunk.chunkX + dx,
            chunkY: chunk.chunkY + dy,
            scale: chunk.scale
          });
        }
      }
    });
    
    const extendedVisibleKeys = new Set(
      extendedVisibleChunks.map(chunk => `${chunk.chunkX}_${chunk.chunkY}_${chunk.scale}`)
    );
    
    // Remove chunks that are not in the extended visible area
    setStitchingChunks(prev => {
      const newChunks = new Map();
      prev.forEach((value, key) => {
        if (extendedVisibleKeys.has(key) || value.scale === scaleLevel) {
          newChunks.set(key, value);
        }
      });
      
      const removed = prev.size - newChunks.size;
      if (removed > 0) {
        console.log(`[MicroscopeMapDisplay] Cleaned up ${removed} distant chunks`);
      }
      
      return newChunks;
    });
    
    // Also clean up failed chunks that are far from viewport
    setFailedChunks(prev => {
      const newFailedChunks = new Map();
      prev.forEach((timestamp, key) => {
        if (extendedVisibleKeys.has(key)) {
          newFailedChunks.set(key, timestamp);
        }
      });
      return newFailedChunks;
    });
  }, [calculateVisibleChunks, stitchingChunks.size, scaleLevel]);

  // Periodically clean up distant chunks
  useEffect(() => {
    if (!showStitchingLayer) return;
    
    const cleanupInterval = setInterval(() => {
      cleanupDistantChunks();
    }, 5000); // Clean up every 5 seconds
    
    return () => clearInterval(cleanupInterval);
  }, [showStitchingLayer, cleanupDistantChunks]);

  // Clear chunks when scale level changes
  useEffect(() => {
    if (showStitchingLayer && stitchingChunks.size > 0) {
      // Check if we have chunks from a different backend scale level
      const currentBackendScale = Math.max(1, scaleLevel);
      const hasWrongScaleChunks = Array.from(stitchingChunks.values()).some(
        chunk => chunk.scale !== currentBackendScale
      );
      
      if (hasWrongScaleChunks) {
        console.log(`[MicroscopeMapDisplay] Clearing chunks due to scale level change to UI scale ${scaleLevel} (backend scale ${currentBackendScale})`);
        setStitchingChunks(new Map());
        setFailedChunks(new Map()); // Also clear failed chunks when changing scale
      }
    }
  }, [scaleLevel, showStitchingLayer]);

  if (!isOpen) return null;

  return (
    <div className="relative w-full h-full bg-black">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-80 p-2 z-10">
        <div className="microscope-map-header">
          <h3 className="text-white text-lg font-medium">Microscope Stage Map</h3>
          
          {/* Zoom controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={(e) => {
                const newZoom = zoomLevel * 0.9;
                const rect = mapContainerRef.current.getBoundingClientRect();
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                if (newZoom < 0.17 && scaleLevel < 3) {
                  zoomToPoint(0.17, scaleLevel + 1, centerX, centerY);
                } else {
                  zoomToPoint(Math.max(0.17, newZoom), scaleLevel, centerX, centerY);
                }
              }}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50"
              title="Zoom Out"
              disabled={scaleLevel === 3 && zoomLevel <= 0.17}
            >
              <i className="fas fa-search-minus"></i>
            </button>
            <span className="text-white text-xs min-w-[8rem] text-center">
              Scale {scaleLevel} ({(zoomLevel * 100).toFixed(1)}%)
            </span>
            <button
              onClick={(e) => {
                const newZoom = zoomLevel * 1.1;
                const rect = mapContainerRef.current.getBoundingClientRect();
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                if (newZoom > 2.0 && scaleLevel > 0) {
                  zoomToPoint(0.17, scaleLevel - 1, centerX, centerY);
                } else {
                  zoomToPoint(Math.min(2.0, newZoom), scaleLevel, centerX, centerY);
                }
              }}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50"
              title="Zoom In"
              disabled={scaleLevel === 0 && zoomLevel >= 2.0}
            >
              <i className="fas fa-search-plus"></i>
            </button>
            <button
              onClick={() => {
                const rect = mapContainerRef.current?.getBoundingClientRect();
                if (rect) {
                  const centerX = rect.width / 2;
                  const centerY = rect.height / 2;
                  zoomToPoint(0.5, 3, centerX, centerY);
                } else {
                  setScaleLevel(3);
                  setZoomLevel(0.5);
                  setMapPan({ x: 0, y: 0 });
                }
              }}
              className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded"
              title="Reset View"
            >
              <i className="fas fa-home"></i>
            </button>
          </div>
          
          {/* Layer toggles */}
          <div className="flex items-center space-x-4">
            <label className="flex items-center text-white text-xs">
              <input
                type="checkbox"
                checked={showWellPlate}
                onChange={(e) => setShowWellPlate(e.target.checked)}
                className="mr-2"
              />
              Show 96-Well Plate
            </label>
            
            <label className="flex items-center text-white text-xs">
              <input
                type="checkbox"
                checked={showStitchingLayer}
                onChange={(e) => setShowStitchingLayer(e.target.checked)}
                disabled={!stitchingStatus.stitcher_initialized}
                className="mr-2 disabled:opacity-50"
              />
              Show Real-Time Stitching Layer
            </label>
          </div>
          
          {/* Stitching controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleToggleStitching}
              disabled={!microscopeControlService}
              className={`px-3 py-1 text-xs rounded text-white disabled:opacity-50 ${
                stitchingStatus.real_time_stitching_active 
                  ? 'bg-red-600 hover:bg-red-500' 
                  : 'bg-green-600 hover:bg-green-500'
              }`}
            >
              {stitchingStatus.real_time_stitching_active ? 'Stop' : 'Start'} Real-Time Stitching
            </button>
            
            {showStitchingLayer && stitchingStatus.stitcher_initialized && (
              <button
                onClick={handleRefreshStitching}
                disabled={isLoadingStitching}
                className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50"
              >
                {isLoadingStitching ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-1"></i>
                    Loading...
                  </>
                ) : (
                  <>
                    <i className="fas fa-sync-alt mr-1"></i>
                    Refresh Stitching Map
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Map container */}
      <div
        ref={mapContainerRef}
        className="absolute inset-0 top-12 overflow-hidden cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0" />
        
        {/* Stitching layer */}
        {renderStitchingLayer()}
        
        {/* 96-well plate overlay */}
        {render96WellPlate()}
        
        {/* Current video frame position */}
        {videoFramePosition && (
          <div
            className="absolute border-2 border-yellow-400 pointer-events-none"
            style={{
              left: `${videoFramePosition.x - videoFramePosition.width / 2}px`,
              top: `${videoFramePosition.y - videoFramePosition.height / 2}px`,
              width: `${videoFramePosition.width}px`,
              height: `${videoFramePosition.height}px`
            }}
          >
            {/* Show video stream when at high zoom levels (scale 0 or 1) */}
            {(scaleLevel === 0 || scaleLevel === 1) && isWebRtcActive && remoteStream && (
              <video
                ref={mapVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover"
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid rgba(255, 255, 0, 0.3)', // Subtle yellow border to help debug visibility
                }}
                onLoadedMetadata={() => console.log('Map video metadata loaded')}
                onCanPlay={() => console.log('Map video can play')}
                onError={(e) => console.error('Map video error:', e)}
              />
            )}
            

            <div className="absolute -top-6 left-0 text-yellow-400 text-xs whitespace-nowrap">
              X: {currentStagePosition.x.toFixed(2)}mm, Y: {currentStagePosition.y.toFixed(2)}mm
            </div>
          </div>
        )}
        
        {/* Stage position info */}
        {currentStagePosition && (
          <div className="absolute bottom-4 left-4 bg-black bg-opacity-80 text-white p-2 rounded text-xs">
            <div>Stage Position:</div>
            <div>X: {currentStagePosition.x.toFixed(3)}mm</div>
            <div>Y: {currentStagePosition.y.toFixed(3)}mm</div>
            <div>Z: {currentStagePosition.z.toFixed(3)}mm</div>
            {microscopeControlService && (
              <div className="mt-1 text-xs text-gray-300 border-t border-gray-600 pt-1">
                <i className="fas fa-mouse-pointer mr-1"></i>
                Double-click to move stage
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

MicroscopeMapDisplay.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  microscopeConfiguration: PropTypes.object,
  isWebRtcActive: PropTypes.bool,
  videoRef: PropTypes.object,
  remoteStream: PropTypes.object,
  frameMetadata: PropTypes.object,
  videoZoom: PropTypes.number,
  snapshotImage: PropTypes.string,
  isDragging: PropTypes.bool,
  dragTransform: PropTypes.object,
  microscopeControlService: PropTypes.object,
  appendLog: PropTypes.func,
  showNotification: PropTypes.func,
};

export default MicroscopeMapDisplay; 