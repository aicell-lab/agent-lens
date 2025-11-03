import React, { useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const SimilarityResultsRenderer = ({
  containerRef,
  similarityResults = [],
  isVisible = true,
  mapScale,
  mapPan,
  stageDimensions,
  pixelsPerMm,
  wellInfoMap = {},
  className = "",
  isDrawingMode = false,
  isMapBrowsingMode = false,
  onResultClick = null
}) => {
  const canvasRef = useRef(null);
  const convertedResultsRef = useRef([]);

  // Convert stage coordinates to display coordinates (reuse from AnnotationCanvas)
  const stageToDisplayCoords = useCallback((stageX_mm, stageY_mm) => {
    const mapX = (stageX_mm - stageDimensions.xMin) * pixelsPerMm;
    const mapY = (stageY_mm - stageDimensions.yMin) * pixelsPerMm;
    const displayX = mapX * mapScale + mapPan.x;
    const displayY = mapY * mapScale + mapPan.y;
    return { x: displayX, y: displayY };
  }, [stageDimensions, pixelsPerMm, mapScale, mapPan]);

  // Convert well-relative coordinates to stage coordinates
  const wellRelativeToStageCoords = useCallback((wellRelativeX, wellRelativeY, wellInfo) => {
    return {
      x: wellInfo.centerX + wellRelativeX,
      y: wellInfo.centerY + wellRelativeY
    };
  }, []);

  // Parse WKT polygon string to extract coordinates
  const parseWktPolygon = useCallback((polygonWkt) => {
    if (!polygonWkt || typeof polygonWkt !== 'string') {
      return [];
    }
    
    try {
      // Extract coordinates from WKT format: POLYGON((x1 y1, x2 y2, ...))
      const match = polygonWkt.match(/POLYGON\(\(([^)]+)\)\)/);
      if (match && match[1]) {
        const coordPairs = match[1].split(',').map(pair => pair.trim());
        return coordPairs.map(pair => {
          const [x, y] = pair.split(' ').map(coord => parseFloat(coord));
          return { x, y };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));
      }
    } catch (error) {
      console.error('Error parsing WKT polygon:', error);
    }
    
    return [];
  }, []);

  // Parse bounding box to create rectangle points
  const parseBoundingBox = useCallback((bbox) => {
    if (!Array.isArray(bbox) || bbox.length < 4) {
      return [];
    }
    
    const [x, y, width, height] = bbox;
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height }
    ];
  }, []);

  // Convert similarity result data to renderable format
  const convertSimilarityResult = useCallback((similarityResult, index) => {
    const props = similarityResult.properties || similarityResult;
    const metadata = props.metadata || '';
    
    // Parse metadata
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
          console.error('Error parsing metadata:', error);
          parsedMetadata = { raw: metadata };
        }
      }
    } else {
      parsedMetadata = metadata;
    }

    const wellId = parsedMetadata.well_id;
    const wellInfo = wellInfoMap[wellId];
    
    if (!wellInfo) {
      console.warn(`No well info found for well ${wellId}`, {
        availableWellIds: Object.keys(wellInfoMap),
        wellInfoMap
      });
      return null;
    }

    // Determine shape type and extract points
    let points = [];
    let type = 'unknown';
    
    if (parsedMetadata.polygon_wkt) {
      type = 'polygon';
      points = parseWktPolygon(parsedMetadata.polygon_wkt);
    } else if (parsedMetadata.bbox) {
      type = 'rectangle';
      points = parseBoundingBox(parsedMetadata.bbox);
    }
    
    if (points.length === 0) {
      return null;
    }

    // Convert well-relative points to stage coordinates
    const stagePoints = points.map(point => 
      wellRelativeToStageCoords(point.x, point.y, wellInfo)
    );

    // Extract UUID for use as ID
    const extractUUID = (resultObj) => {
      if (resultObj.uuid) return resultObj.uuid;
      if (resultObj.id) return resultObj.id;
      if (resultObj._uuid) return resultObj._uuid;
      if (resultObj.properties) {
        const props = resultObj.properties;
        if (props.uuid) return props.uuid;
        if (props.id) return props.id;
      }
      return null;
    };
    
    const objectUUID = extractUUID(similarityResult);

    return {
      id: objectUUID || props.image_id || `similar_${Date.now()}`,
      type,
      points: stagePoints,
      wellId,
      description: props.description || 'Similarity result',
      similarityScore: similarityResult.metadata?.score || 0,
      rank: index + 1, // Rank is 1-based index
      strokeColor: '#ff6b35', // Orange color for similarity results
      strokeWidth: 2,
      fillColor: 'rgba(255, 107, 53, 0.1)', // Semi-transparent orange fill
      isSimilar: true,
      // Store original result data for info window
      originalData: similarityResult
    };
  }, [wellInfoMap, parseWktPolygon, parseBoundingBox, wellRelativeToStageCoords]);

  // Check if a point is inside a result shape (point-in-polygon detection)
  const isPointInResult = useCallback((point, result) => {
    const displayPoints = result.points.map(p => stageToDisplayCoords(p.x, p.y));
    
    switch (result.type) {
      case 'rectangle':
        if (displayPoints.length >= 4) {
          const xs = displayPoints.map(p => p.x);
          const ys = displayPoints.map(p => p.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
        }
        break;
      case 'polygon':
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

  // Handle canvas click
  const handleCanvasClick = useCallback((e) => {
    // Allow clicks when map browsing is active (even if drawing mode is on)
    const canClick = onResultClick && (isMapBrowsingMode || !isDrawingMode);
    
    if (!canClick) return;
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const clickPoint = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    
    // Find which result was clicked (check in reverse order to prioritize top-most)
    for (let i = convertedResultsRef.current.length - 1; i >= 0; i--) {
      const result = convertedResultsRef.current[i];
      if (isPointInResult(clickPoint, result)) {
        // Call the callback with the original result data and click position
        onResultClick(result.originalData, {
          x: e.clientX,
          y: e.clientY
        });
        return;
      }
    }
  }, [onResultClick, isDrawingMode, isMapBrowsingMode, isPointInResult]);

  // Draw similarity result on canvas
  const drawSimilarityResult = useCallback((ctx, result) => {
    const displayPoints = result.points.map(p => stageToDisplayCoords(p.x, p.y));
    
    ctx.strokeStyle = result.strokeColor;
    ctx.lineWidth = result.strokeWidth;
    ctx.fillStyle = result.fillColor;
    ctx.globalAlpha = 0.8; // Slightly transparent
    ctx.setLineDash([8, 4]); // Dashed line to distinguish from regular annotations
    
    ctx.beginPath();
    
    switch (result.type) {
      case 'rectangle':
        if (displayPoints.length >= 4) {
          const [p1, p2, p3] = displayPoints; // top-left, top-right, bottom-right
          const width = p2.x - p1.x;
          const height = p3.y - p2.y; // Use bottom-right point for correct height
          ctx.rect(p1.x, p1.y, width, height);
          ctx.fill();
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
          ctx.fill();
          ctx.stroke();
        }
        break;
    }
    
    // Draw map pin with rank indicator
    if (displayPoints.length > 0) {
      const firstPoint = displayPoints[0];
      const pinX = firstPoint.x + 5;
      const pinY = firstPoint.y - 15;
      
      // Draw map pin icon (simple triangle)
      ctx.fillStyle = '#ff6b35';
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(pinX, pinY + 8); // Bottom point
      ctx.lineTo(pinX - 4, pinY); // Left point
      ctx.lineTo(pinX + 4, pinY); // Right point
      ctx.closePath();
      ctx.fill();
      
      // Draw pin circle
      ctx.beginPath();
      ctx.arc(pinX, pinY - 2, 3, 0, 2 * Math.PI);
      ctx.fill();
      
      // Draw rank text
      ctx.font = 'bold 10px Arial';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.fillText(
        `#${result.rank || '?'}`,
        pinX,
        pinY - 1
      );
      ctx.textAlign = 'left'; // Reset text alignment
    }
    
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }, [stageToDisplayCoords]);

  // Render similarity results
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !isVisible) return;

    // Ensure canvas is properly sized
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resizeCanvas();

    const renderSimilarityResults = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Convert and draw similarity results, storing them for click detection
      const converted = [];
      similarityResults.forEach((similarityResult, index) => {
        const convertedResult = convertSimilarityResult(similarityResult, index);
        if (convertedResult) {
          converted.push(convertedResult);
          drawSimilarityResult(ctx, convertedResult);
        }
      });
      
      // Store converted results for click detection
      convertedResultsRef.current = converted;
    };

    renderSimilarityResults();

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      renderSimilarityResults();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [similarityResults, isVisible, convertSimilarityResult, drawSimilarityResult, containerRef]);

  // Set up click event listener
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e) => {
      handleCanvasClick(e);
    };

    // Allow clicks when map browsing is active (even if drawing mode is on)
    const canClick = (isMapBrowsingMode || !isDrawingMode) && onResultClick;
    
    if (canClick) {
      canvas.addEventListener('click', handleClick, true); // Use capture phase
    }

    return () => {
      canvas.removeEventListener('click', handleClick, true);
    };
  }, [handleCanvasClick, onResultClick, isDrawingMode, isMapBrowsingMode]);

  if (!isVisible || similarityResults.length === 0) {
    return null;
  }

  // Enable pointer events when map browsing is active OR when not in drawing mode
  const pointerEventsEnabled = (isMapBrowsingMode || !isDrawingMode) && !!onResultClick;
  
  const handleDirectClick = (e) => {
    e.stopPropagation(); // Prevent event from bubbling
    handleCanvasClick(e);
  };
  
  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 ${className}`}
      onClick={handleDirectClick}
      style={{
        zIndex: 1002, // Higher than AnnotationCanvas (1000) to ensure it's on top
        pointerEvents: pointerEventsEnabled ? 'auto' : 'none', // Enable clicks when map browsing or not drawing
        cursor: pointerEventsEnabled ? 'pointer' : 'default',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        position: 'absolute'
      }}
    />
  );
};

SimilarityResultsRenderer.propTypes = {
  containerRef: PropTypes.object.isRequired,
  similarityResults: PropTypes.array,
  isVisible: PropTypes.bool,
  mapScale: PropTypes.number.isRequired,
  mapPan: PropTypes.object.isRequired,
  stageDimensions: PropTypes.object.isRequired,
  pixelsPerMm: PropTypes.number.isRequired,
  wellInfoMap: PropTypes.object,
  className: PropTypes.string,
  isDrawingMode: PropTypes.bool,
  isMapBrowsingMode: PropTypes.bool,
  onResultClick: PropTypes.func
};

export default SimilarityResultsRenderer;
