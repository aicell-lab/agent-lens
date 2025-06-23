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

  // Inverted base scale: higher scale level = more zoomed out (shows more area)
  // Scale 0: 1x (normal), Scale 1: 0.25x, Scale 2: 0.0625x, Scale 3: 0.015625x (4x difference between levels)
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
    } else if (newZoomLevel < 0.1 && scaleLevel < 3) {
      // Zoom out to lower resolution (higher scale number = more zoomed out)
      // Calculate equivalent zoom level in the new scale to maintain continuity
      const equivalentZoom = (newZoomLevel * (1 / Math.pow(4, scaleLevel))) / (1 / Math.pow(4, scaleLevel + 1));
      zoomToPoint(Math.max(0.1, equivalentZoom), scaleLevel + 1, mouseX, mouseY);
    } else {
      // Smooth zoom within current scale level
      newZoomLevel = Math.max(0.1, Math.min(2.0, newZoomLevel));
      zoomToPoint(newZoomLevel, scaleLevel, mouseX, mouseY);
    }
  }, [zoomLevel, scaleLevel, zoomToPoint]);

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

  if (!isOpen) return null;

  return (
    <div className="relative w-full h-full bg-black">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 bg-black bg-opacity-80 p-2 flex justify-between items-center z-10">
        <div className="flex items-center space-x-4">
          <h3 className="text-white text-lg font-medium">Microscope Stage Map</h3>
                     <div className="flex items-center space-x-2">
             <button
               onClick={(e) => {
                 const newZoom = zoomLevel * 0.9; // Smaller increment for smoother transitions
                 const rect = mapContainerRef.current.getBoundingClientRect();
                 const centerX = rect.width / 2;
                 const centerY = rect.height / 2;
                 
                 if (newZoom < 0.1 && scaleLevel < 3) {
                   // Zoom out to lower resolution (higher scale number)
                   zoomToPoint(0.1, scaleLevel + 1, centerX, centerY);
                 } else {
                   // Smooth zoom within current scale level
                   zoomToPoint(Math.max(0.1, newZoom), scaleLevel, centerX, centerY);
                 }
               }}
               className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded disabled:opacity-50"
               title="Zoom Out"
               disabled={scaleLevel === 3 && zoomLevel <= 0.1}
             >
               <i className="fas fa-search-minus"></i>
             </button>
             <span className="text-white text-xs min-w-[8rem] text-center">
               Scale {scaleLevel} ({(zoomLevel * 100).toFixed(1)}%)
             </span>
             <button
               onClick={(e) => {
                 const newZoom = zoomLevel * 1.1; // Smaller increment for smoother transitions
                 const rect = mapContainerRef.current.getBoundingClientRect();
                 const centerX = rect.width / 2;
                 const centerY = rect.height / 2;
                 
                 if (newZoom > 2.0 && scaleLevel > 0) {
                   // Zoom in to higher resolution (lower scale number)
                   zoomToPoint(0.1, scaleLevel - 1, centerX, centerY);
                 } else {
                   // Smooth zoom within current scale level
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
                                        // Reset to overview (most zoomed out), centered on stage
                     zoomToPoint(0.5, 3, centerX, centerY);
                 } else {
                                        // Fallback if no rect available (most zoomed out)
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
          <label className="flex items-center text-white text-xs">
            <input
              type="checkbox"
              checked={showWellPlate}
              onChange={(e) => setShowWellPlate(e.target.checked)}
              className="mr-2"
            />
            Show 96-Well Plate
          </label>
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