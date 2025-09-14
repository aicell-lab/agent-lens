import React, { useRef, useEffect, useState, useCallback } from 'react';
import PropTypes from 'prop-types';

const AnnotationCanvas = ({
  containerRef,
  isDrawingMode,
  currentTool,
  strokeColor,
  strokeWidth,
  fillColor,
  mapScale,
  mapPan,
  annotations,
  onAnnotationAdd,
  onAnnotationUpdate,
  onAnnotationDelete,
  stageDimensions,
  pixelsPerMm,
  className = ""
}) => {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState([]);
  const [startPoint, setStartPoint] = useState(null);
  const [previewShape, setPreviewShape] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isPolygonMode, setIsPolygonMode] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState([]);

  // Convert display coordinates to stage coordinates
  const displayToStageCoords = useCallback((displayX, displayY) => {
    const mapX = (displayX - mapPan.x) / mapScale;
    const mapY = (displayY - mapPan.y) / mapScale;
    const stageX_mm = (mapX / pixelsPerMm) + stageDimensions.xMin;
    const stageY_mm = (mapY / pixelsPerMm) + stageDimensions.yMin;
    return { x: stageX_mm, y: stageY_mm };
  }, [mapPan, mapScale, pixelsPerMm, stageDimensions]);

  // Convert stage coordinates to display coordinates
  const stageToDisplayCoords = useCallback((stageX_mm, stageY_mm) => {
    const mapX = (stageX_mm - stageDimensions.xMin) * pixelsPerMm;
    const mapY = (stageY_mm - stageDimensions.yMin) * pixelsPerMm;
    const displayX = mapX * mapScale + mapPan.x;
    const displayY = mapY * mapScale + mapPan.y;
    return { x: displayX, y: displayY };
  }, [stageDimensions, pixelsPerMm, mapScale, mapPan]);

  // Get mouse position relative to canvas
  const getMousePos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }, []);

  // Check if point is inside annotation
  const isPointInAnnotation = useCallback((point, annotation) => {
    const displayPoints = annotation.points.map(p => stageToDisplayCoords(p.x, p.y));
    
    switch (annotation.type) {
      case 'rectangle':
        if (displayPoints.length >= 2) {
          const [p1, p2] = displayPoints;
          const minX = Math.min(p1.x, p2.x);
          const maxX = Math.max(p1.x, p2.x);
          const minY = Math.min(p1.y, p2.y);
          const maxY = Math.max(p1.y, p2.y);
          return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
        }
        break;
      case 'polygon':
      case 'freehand':
        // Use ray casting algorithm for point-in-polygon
        if (displayPoints.length >= 3) {
          let inside = false;
          for (let i = 0, j = displayPoints.length - 1; i < displayPoints.length; j = i++) {
            if (((displayPoints[i].y > point.y) !== (displayPoints[j].y > point.y)) &&
                (point.x < (displayPoints[j].x - displayPoints[i].x) * (point.y - displayPoints[i].y) / (displayPoints[j].y - displayPoints[i].y) + displayPoints[i].x)) {
              inside = !inside;
            }
          }
          return inside;
        }
        break;
    }
    return false;
  }, [stageToDisplayCoords]);


  // Handle mouse down
  const handleMouseDown = useCallback((e) => {
    if (!isDrawingMode) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const mousePos = getMousePos(e);
    const stagePos = displayToStageCoords(mousePos.x, mousePos.y);

    // Check if clicking on existing annotation for selection/editing
    const clickedAnnotation = annotations.find(ann => isPointInAnnotation(mousePos, ann));
    
    if (currentTool === 'select') {
      if (clickedAnnotation) {
        setSelectedAnnotation(clickedAnnotation);
        setIsDragging(true);
        const displayPos = stageToDisplayCoords(clickedAnnotation.points[0].x, clickedAnnotation.points[0].y);
        setDragOffset({
          x: mousePos.x - displayPos.x,
          y: mousePos.y - displayPos.y
        });
      } else {
        setSelectedAnnotation(null);
      }
      return;
    }

    if (currentTool === 'delete') {
      if (clickedAnnotation) {
        onAnnotationDelete(clickedAnnotation.id);
      }
      return;
    }

    // Handle polygon mode
    if (currentTool === 'polygon') {
      if (!isPolygonMode) {
        // Start new polygon
        setIsPolygonMode(true);
        setPolygonPoints([stagePos]);
        setPreviewShape({
          type: 'polygon',
          points: [stagePos]
        });
      } else {
        // Add point to existing polygon
        const newPoints = [...polygonPoints, stagePos];
        setPolygonPoints(newPoints);
        setPreviewShape({
          type: 'polygon',
          points: newPoints
        });
      }
      return;
    }

    // Start drawing new annotation
    setIsDrawing(true);
    setStartPoint(stagePos);
    
    if (currentTool === 'freehand') {
      setCurrentPath([stagePos]);
    }
  }, [isDrawingMode, currentTool, getMousePos, displayToStageCoords, annotations, isPointInAnnotation, stageToDisplayCoords, onAnnotationDelete, isPolygonMode, polygonPoints]);

  // Handle mouse move
  const handleMouseMove = useCallback((e) => {
    if (!isDrawingMode) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const mousePos = getMousePos(e);
    const stagePos = displayToStageCoords(mousePos.x, mousePos.y);

    // Handle dragging selected annotation
    if (isDragging && selectedAnnotation) {
      const newDisplayPos = {
        x: mousePos.x - dragOffset.x,
        y: mousePos.y - dragOffset.y
      };
      const newStagePos = displayToStageCoords(newDisplayPos.x, newDisplayPos.y);
      
      // Calculate offset from original position
      const originalPos = selectedAnnotation.points[0];
      const offset = {
        x: newStagePos.x - originalPos.x,
        y: newStagePos.y - originalPos.y
      };
      
      // Update all points with the offset
      const updatedPoints = selectedAnnotation.points.map(point => ({
        x: point.x + offset.x,
        y: point.y + offset.y
      }));
      
      onAnnotationUpdate(selectedAnnotation.id, { points: updatedPoints });
      return;
    }

    if (!isDrawing || !startPoint) return;

    // Update preview for shape tools
    if (currentTool === 'rectangle') {
      setPreviewShape({
        type: 'rectangle',
        points: [startPoint, stagePos]
      });
    } else if (currentTool === 'freehand') {
      setCurrentPath(prev => [...prev, stagePos]);
    }
  }, [isDrawingMode, isDragging, selectedAnnotation, dragOffset, getMousePos, displayToStageCoords, isDrawing, startPoint, currentTool, onAnnotationUpdate]);

  // Handle double click for polygon completion
  const handleDoubleClick = useCallback((e) => {
    if (!isDrawingMode || currentTool !== 'polygon' || !isPolygonMode) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    // Complete polygon if we have at least 3 points
    if (polygonPoints.length >= 3) {
      const newAnnotation = {
        id: Date.now().toString(),
        type: 'polygon',
        points: polygonPoints,
        strokeColor,
        strokeWidth,
        fillColor,
        timestamp: Date.now()
      };
      
      onAnnotationAdd(newAnnotation);
    }
    
    // Reset polygon state
    setIsPolygonMode(false);
    setPolygonPoints([]);
    setPreviewShape(null);
  }, [isDrawingMode, currentTool, isPolygonMode, polygonPoints, strokeColor, strokeWidth, fillColor, onAnnotationAdd]);

  // Handle mouse up
  const handleMouseUp = useCallback((e) => {
    if (!isDrawingMode) return;

    e.preventDefault();
    e.stopPropagation();

    if (isDragging) {
      setIsDragging(false);
      return;
    }

    if (currentTool === 'polygon') {
      // Don't complete polygon on single click, wait for double-click
      return;
    }

    if (!isDrawing || !startPoint) return;

    const mousePos = getMousePos(e);
    const stagePos = displayToStageCoords(mousePos.x, mousePos.y);

    // Create annotation based on tool
    let newAnnotation = null;
    
    switch (currentTool) {
      case 'rectangle':
        newAnnotation = {
          id: Date.now().toString(),
          type: 'rectangle',
          points: [startPoint, stagePos],
          strokeColor,
          strokeWidth,
          fillColor,
          timestamp: Date.now()
        };
        break;
      case 'freehand':
        if (currentPath.length > 1) {
          newAnnotation = {
            id: Date.now().toString(),
            type: 'freehand',
            points: currentPath,
            strokeColor,
            strokeWidth,
            fillColor,
            timestamp: Date.now()
          };
        }
        break;
    }

    if (newAnnotation) {
      onAnnotationAdd(newAnnotation);
    }

    // Reset drawing state
    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPath([]);
    setPreviewShape(null);
  }, [isDrawingMode, isDragging, isDrawing, startPoint, getMousePos, displayToStageCoords, currentTool, currentPath, strokeColor, strokeWidth, fillColor, onAnnotationAdd, isPolygonMode]);

  // Draw annotation on canvas
  const drawAnnotation = useCallback((ctx, annotation, isPreview = false) => {
    const displayPoints = annotation.points.map(p => stageToDisplayCoords(p.x, p.y));
    
    ctx.strokeStyle = annotation.strokeColor;
    ctx.lineWidth = annotation.strokeWidth;
    ctx.fillStyle = annotation.fillColor || 'transparent';
    
    if (isPreview) {
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([5, 5]);
    } else {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    
    switch (annotation.type) {
      case 'rectangle':
        if (displayPoints.length >= 2) {
          const [p1, p2] = displayPoints;
          const width = p2.x - p1.x;
          const height = p2.y - p1.y;
          ctx.rect(p1.x, p1.y, width, height);
          if (annotation.fillColor && annotation.fillColor !== 'transparent') {
            ctx.fill();
          }
          ctx.stroke();
        }
        break;
      case 'freehand':
        if (displayPoints.length > 1) {
          ctx.moveTo(displayPoints[0].x, displayPoints[0].y);
          for (let i = 1; i < displayPoints.length; i++) {
            ctx.lineTo(displayPoints[i].x, displayPoints[i].y);
          }
          ctx.stroke();
        }
        break;
      case 'polygon':
        if (displayPoints.length > 2) {
          ctx.moveTo(displayPoints[0].x, displayPoints[0].y);
          for (let i = 1; i < displayPoints.length; i++) {
            ctx.lineTo(displayPoints[i].x, displayPoints[i].y);
          }
          ctx.closePath();
          if (annotation.fillColor && annotation.fillColor !== 'transparent') {
            ctx.fill();
          }
          ctx.stroke();
        }
        break;
    }
    
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }, [stageToDisplayCoords]);

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    // Ensure canvas is properly sized
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    // Initial resize
    resizeCanvas();

    const renderAnnotations = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw all annotations
      annotations.forEach(annotation => {
        drawAnnotation(ctx, annotation);
        
        // Highlight selected annotation
        if (selectedAnnotation && annotation.id === selectedAnnotation.id) {
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          drawAnnotation(ctx, annotation, false);
          ctx.setLineDash([]);
        }
      });

      // Draw preview shape
      if (previewShape) {
        drawAnnotation(ctx, { ...previewShape, strokeColor, strokeWidth, fillColor }, true);
      }

      // Draw current path for freehand tool
      if (currentPath.length > 1) {
        const displayPath = currentPath.map(p => stageToDisplayCoords(p.x, p.y));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(displayPath[0].x, displayPath[0].y);
        for (let i = 1; i < displayPath.length; i++) {
          ctx.lineTo(displayPath[i].x, displayPath[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      // Draw polygon preview
      if (isPolygonMode && polygonPoints.length > 0) {
        const displayPolygonPoints = polygonPoints.map(p => stageToDisplayCoords(p.x, p.y));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(displayPolygonPoints[0].x, displayPolygonPoints[0].y);
        for (let i = 1; i < displayPolygonPoints.length; i++) {
          ctx.lineTo(displayPolygonPoints[i].x, displayPolygonPoints[i].y);
        }
        // Don't close the polygon yet, just show the line
        ctx.stroke();
        
        // Draw points
        ctx.fillStyle = strokeColor;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
        displayPolygonPoints.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        });
        
        ctx.globalAlpha = 1;
      }
    };

    // Initial render
    renderAnnotations();

    // Set up resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      renderAnnotations(); // Re-render after resize
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [annotations, previewShape, currentPath, strokeColor, strokeWidth, fillColor, selectedAnnotation, containerRef, drawAnnotation, stageToDisplayCoords]);

  // Separate effect to re-render when annotations change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isDrawingMode) return;

    const renderAnnotations = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw all annotations
      annotations.forEach(annotation => {
        drawAnnotation(ctx, annotation);
        
        // Highlight selected annotation
        if (selectedAnnotation && annotation.id === selectedAnnotation.id) {
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 2;
          ctx.setLineDash([3, 3]);
          drawAnnotation(ctx, annotation, false);
          ctx.setLineDash([]);
        }
      });

      // Draw preview shape
      if (previewShape) {
        drawAnnotation(ctx, { ...previewShape, strokeColor, strokeWidth, fillColor }, true);
      }

      // Draw current path for freehand tool
      if (currentPath.length > 1) {
        const displayPath = currentPath.map(p => stageToDisplayCoords(p.x, p.y));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(displayPath[0].x, displayPath[0].y);
        for (let i = 1; i < displayPath.length; i++) {
          ctx.lineTo(displayPath[i].x, displayPath[i].y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
      }

      // Draw polygon preview
      if (isPolygonMode && polygonPoints.length > 0) {
        const displayPolygonPoints = polygonPoints.map(p => stageToDisplayCoords(p.x, p.y));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(displayPolygonPoints[0].x, displayPolygonPoints[0].y);
        for (let i = 1; i < displayPolygonPoints.length; i++) {
          ctx.lineTo(displayPolygonPoints[i].x, displayPolygonPoints[i].y);
        }
        // Don't close the polygon yet, just show the line
        ctx.stroke();
        
        // Draw points
        ctx.fillStyle = strokeColor;
        ctx.globalAlpha = 0.9;
        ctx.setLineDash([]);
        displayPolygonPoints.forEach(point => {
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        });
        
        ctx.globalAlpha = 1;
      }
    };

    renderAnnotations();
  }, [annotations, selectedAnnotation, previewShape, currentPath, strokeColor, strokeWidth, fillColor, isDrawingMode, drawAnnotation, stageToDisplayCoords, isPolygonMode, polygonPoints]);

  // Set up event listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !isDrawingMode) return;

    // Ensure canvas is properly sized before setting up listeners
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Container not ready yet, retry after a short delay
      const timeoutId = setTimeout(() => {
        const canvas = canvasRef.current;
        if (canvas) {
          canvas.width = container.clientWidth;
          canvas.height = container.clientHeight;
          canvas.style.width = `${container.clientWidth}px`;
          canvas.style.height = `${container.clientHeight}px`;
        }
      }, 100);
      return () => clearTimeout(timeoutId);
    }

    // Add event listeners with passive: false to ensure we can preventDefault
    const options = { passive: false };
    
    canvas.addEventListener('mousedown', handleMouseDown, options);
    canvas.addEventListener('mousemove', handleMouseMove, options);
    canvas.addEventListener('mouseup', handleMouseUp, options);
    canvas.addEventListener('mouseleave', handleMouseUp, options);
    canvas.addEventListener('dblclick', handleDoubleClick, options);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [isDrawingMode, handleMouseDown, handleMouseMove, handleMouseUp, handleDoubleClick, containerRef]);

  if (!isDrawingMode) return null;

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-auto ${className}`}
      style={{
        zIndex: 1000, // High z-index to be above map elements
        cursor: currentTool === 'select' ? 'pointer' : 
                currentTool === 'delete' ? 'crosshair' : 
                'crosshair',
        pointerEvents: 'auto', // Ensure canvas can receive mouse events
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    />
  );
};

AnnotationCanvas.propTypes = {
  containerRef: PropTypes.object.isRequired,
  isDrawingMode: PropTypes.bool.isRequired,
  currentTool: PropTypes.string.isRequired,
  strokeColor: PropTypes.string.isRequired,
  strokeWidth: PropTypes.number.isRequired,
  fillColor: PropTypes.string,
  mapScale: PropTypes.number.isRequired,
  mapPan: PropTypes.object.isRequired,
  annotations: PropTypes.array.isRequired,
  onAnnotationAdd: PropTypes.func.isRequired,
  onAnnotationUpdate: PropTypes.func.isRequired,
  onAnnotationDelete: PropTypes.func.isRequired,
  stageDimensions: PropTypes.object.isRequired,
  pixelsPerMm: PropTypes.number.isRequired,
  className: PropTypes.string,
};

export default AnnotationCanvas;

