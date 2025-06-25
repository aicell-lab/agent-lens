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
  currentOperation,
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
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
}) => {
  const mapContainerRef = useRef(null);
  const canvasRef = useRef(null);
  const mapVideoRef = useRef(null);
  const dragImageDisplayRef = useRef(null);
  
  // Map view mode: 'FOV_FITTED' for fitted video view, 'FREE_PAN' for stage map view
  const [mapViewMode, setMapViewMode] = useState('FOV_FITTED');
  const [scaleLevel, setScaleLevel] = useState(0); // Start at highest resolution for FOV_FITTED mode
  const [zoomLevel, setZoomLevel] = useState(1.0); // Start at 100% zoom for FOV_FITTED mode
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [showWellPlate, setShowWellPlate] = useState(true);
  const [showScanResults, setShowScanResults] = useState(false);

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

  // Get current stage position from metadata or fallback
  const currentStagePosition = useMemo(() => {
    // Prefer WebRTC metadata when available
    if (frameMetadata?.stage_position) {
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
  const baseScale = 1 / Math.pow(4, scaleLevel);
  const calculatedMapScale = baseScale * zoomLevel;
  
  // Auto-calculate scale and pan for FOV_FITTED mode
  const autoFittedScale = useMemo(() => {
    const container = mapContainerRef.current;
    if (!container) return 1;
    
    // In FOV_FITTED mode, we want the FOV box to always appear as a consistent size
    // representing the video display area, regardless of microscope configuration loading
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
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
  }, [currentStagePosition, stageDimensions, fovSize, pixelsPerMm]);
  
  const autoFittedPan = useMemo(() => {
    const container = mapContainerRef.current;
    if (!container) return { x: 0, y: 0 };
    
    // Always center the FOV in the container for FOV_FITTED mode
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
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
  }, [currentStagePosition, stageDimensions, pixelsPerMm, autoFittedScale]);
  
  // Use fitted values in FOV_FITTED mode, manual values in FREE_PAN mode
  const mapScale = mapViewMode === 'FOV_FITTED' ? autoFittedScale : calculatedMapScale;
  const effectivePan = mapViewMode === 'FOV_FITTED' ? autoFittedPan : mapPan;

  // Calculate video frame position on the map
  const videoFramePosition = useMemo(() => {
    const container = mapContainerRef.current;
    if (!container) return null;
    
         // In FOV_FITTED mode, always show a centered FOV box representing the video display
     if (mapViewMode === 'FOV_FITTED') {
       const containerWidth = container.clientWidth;
       const containerHeight = container.clientHeight;
       
       // Fixed FOV box size for consistent video display representation
       const videoDisplaySize = Math.min(containerWidth, containerHeight) * 0.85; // 85% of container to better fill the space
      
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
  }, [mapViewMode, currentStagePosition, stageDimensions, mapScale, effectivePan, fovSize, pixelsPerMm]);

  // Handle panning (only in FREE_PAN mode)
  const handleMapPanning = (e) => {
    if (mapViewMode !== 'FREE_PAN') return;
    
    if (e.button === 0) { // Left click
      setIsPanning(true);
      setPanStart({ x: e.clientX - mapPan.x, y: e.clientY - mapPan.y });
    }
  };

  const handleMapPanMove = (e) => {
    if (isPanning && mapViewMode === 'FREE_PAN') {
      setMapPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMapPanEnd = () => {
    setIsPanning(false);
  };
  
  // Switch to FREE_PAN mode when zooming out in FOV_FITTED mode
  const transitionToFreePan = useCallback(() => {
    if (mapViewMode === 'FOV_FITTED') {
      setMapViewMode('FREE_PAN');
      // Set scale and pan to current fitted values for smooth transition
      setScaleLevel(0);
      setZoomLevel(autoFittedScale);
      setMapPan(autoFittedPan);
      if (appendLog) {
        appendLog('Switched to stage map view');
      }
    }
  }, [mapViewMode, autoFittedScale, autoFittedPan, appendLog]);
  
  // Switch back to FOV_FITTED mode
  const fitToView = useCallback(() => {
    setMapViewMode('FOV_FITTED');
    setScaleLevel(0);
    setZoomLevel(1.0);
    if (appendLog) {
      appendLog('Switched to fitted video view');
    }
  }, [appendLog]);

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

  // Debug effect to monitor video stream availability
  useEffect(() => {
    console.log('Map Display Debug:', {
      mapViewMode,
      isWebRtcActive,
      scaleLevel,
      hasVideoRef: !!videoRef?.current,
      hasRemoteStream: !!remoteStream,
      hasMapVideoRef: !!mapVideoRef.current,
      mainVideoHasStream: !!videoRef?.current?.srcObject,
      mapVideoHasStream: !!mapVideoRef.current?.srcObject,
      shouldShowVideoInFOV: mapViewMode === 'FOV_FITTED' && isWebRtcActive && remoteStream,
      shouldShowVideoInMap: mapViewMode === 'FREE_PAN' && scaleLevel <= 1 && isWebRtcActive && remoteStream
    });
  }, [mapViewMode, isWebRtcActive, scaleLevel, remoteStream, videoRef]);

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
    ctx.translate(effectivePan.x, effectivePan.y);
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
  }, [isOpen, stageDimensions, mapScale, effectivePan, showWellPlate]);

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
        const displayX = (centerX - stageDimensions.xMin) * pixelsPerMm * mapScale + effectivePan.x;
        const displayY = (centerY - stageDimensions.yMin) * pixelsPerMm * mapScale + effectivePan.y;
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
            cursor: 'crosshair' 
          }}
          onMouseDown={(e) => {
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
                  onClick={fitToView}
                  className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                  title="Fit to View"
                >
                  <i className="fas fa-crosshairs mr-1"></i>
                  Fit to View
                </button>
              </div>
              
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
                  checked={showScanResults}
                  onChange={(e) => setShowScanResults(e.target.checked)}
                  className="mr-2"
                />
                Show Scan Results
              </label>
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
          mapViewMode === 'FOV_FITTED' ? 'cursor-grab' : 'cursor-move'
        } ${isDragging || isPanning ? 'cursor-grabbing' : ''}`}
        onMouseDown={mapViewMode === 'FOV_FITTED' ? onMouseDown : handleMapPanning}
        onMouseMove={mapViewMode === 'FOV_FITTED' ? onMouseMove : handleMapPanMove}
        onMouseUp={mapViewMode === 'FOV_FITTED' ? onMouseUp : handleMapPanEnd}
        onMouseLeave={mapViewMode === 'FOV_FITTED' ? onMouseLeave : handleMapPanEnd}
        onDoubleClick={mapViewMode === 'FREE_PAN' ? handleDoubleClick : undefined}
        style={{
          userSelect: 'none',
          transition: isDragging || isPanning ? 'none' : 'transform 0.3s ease-out'
        }}
      >
        {/* Map canvas for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && (
          <canvas ref={canvasRef} className="absolute inset-0" />
        )}
        
        {/* 96-well plate overlay for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && render96WellPlate()}
        
        {/* Current video frame position indicator */}
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
              // FREE_PAN mode: Show video in map frame when at high zoom
              scaleLevel <= 1 && isWebRtcActive && remoteStream && (
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
        {mapViewMode === 'FOV_FITTED' && (isWebRtcActive || snapshotImage) && microscopeControlService && !microscopeBusy && !currentOperation && !isDragging && (
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
        
        {/* Stage position info for FREE_PAN mode */}
        {mapViewMode === 'FREE_PAN' && currentStagePosition && (
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
      
      {/* Video contrast controls for FOV_FITTED mode */}
      {mapViewMode === 'FOV_FITTED' && isWebRtcActive && (
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-80 p-2 rounded text-white max-w-xs">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-medium">Contrast</span>
              {isDataChannelConnected && (
                <i className="fas fa-circle text-green-500" style={{ fontSize: '4px' }} title="Metadata connected"></i>
              )}
            </div>
            <button
              onClick={() => setIsContrastControlsCollapsed(!isContrastControlsCollapsed)}
              className="text-xs text-gray-300 hover:text-white p-1"
              title={isContrastControlsCollapsed ? "Show contrast controls" : "Hide contrast controls"}
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
                    onChange={(e) => setAutoContrastEnabled(e.target.checked)}
                    disabled={!isDataChannelConnected}
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
  currentOperation: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
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
  onMouseDown: PropTypes.func,
  onMouseMove: PropTypes.func,
  onMouseUp: PropTypes.func,
  onMouseLeave: PropTypes.func,
};

export default MicroscopeMapDisplay; 