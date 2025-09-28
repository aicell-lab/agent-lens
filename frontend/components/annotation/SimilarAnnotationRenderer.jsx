import React, { useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const SimilarAnnotationRenderer = ({
  containerRef,
  similarAnnotations = [],
  isVisible = true,
  mapScale,
  mapPan,
  stageDimensions,
  pixelsPerMm,
  wellInfoMap = {},
  className = ""
}) => {
  const canvasRef = useRef(null);

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

  // Convert similar annotation data to renderable format
  const convertSimilarAnnotation = useCallback((similarAnnotation, index) => {
    const props = similarAnnotation.properties || similarAnnotation;
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

    // Determine annotation type and extract points
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

    return {
      id: props.image_id || `similar_${Date.now()}`,
      type,
      points: stagePoints,
      wellId,
      description: props.description || 'Similar annotation',
      similarityScore: similarAnnotation.metadata?.score || 0,
      rank: index + 1, // Rank is 1-based index
      strokeColor: '#ff6b35', // Orange color for similar annotations
      strokeWidth: 2,
      fillColor: 'rgba(255, 107, 53, 0.1)', // Semi-transparent orange fill
      isSimilar: true
    };
  }, [wellInfoMap, parseWktPolygon, parseBoundingBox, wellRelativeToStageCoords]);

  // Draw similar annotation on canvas
  const drawSimilarAnnotation = useCallback((ctx, annotation) => {
    const displayPoints = annotation.points.map(p => stageToDisplayCoords(p.x, p.y));
    
    ctx.strokeStyle = annotation.strokeColor;
    ctx.lineWidth = annotation.strokeWidth;
    ctx.fillStyle = annotation.fillColor;
    ctx.globalAlpha = 0.8; // Slightly transparent
    ctx.setLineDash([8, 4]); // Dashed line to distinguish from regular annotations
    
    ctx.beginPath();
    
    switch (annotation.type) {
      case 'rectangle':
        if (displayPoints.length >= 2) {
          const [p1, p2] = displayPoints;
          const width = p2.x - p1.x;
          const height = p2.y - p1.y;
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
        `#${annotation.rank || '?'}`,
        pinX,
        pinY - 1
      );
      ctx.textAlign = 'left'; // Reset text alignment
    }
    
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }, [stageToDisplayCoords]);

  // Render similar annotations
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

    const renderSimilarAnnotations = () => {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Convert and draw similar annotations
      similarAnnotations.forEach((similarAnnotation, index) => {
        const convertedAnnotation = convertSimilarAnnotation(similarAnnotation, index);
        if (convertedAnnotation) {
          drawSimilarAnnotation(ctx, convertedAnnotation);
        }
      });
    };

    renderSimilarAnnotations();

    // Set up resize observer
    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
      renderSimilarAnnotations();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [similarAnnotations, isVisible, convertSimilarAnnotation, drawSimilarAnnotation, containerRef]);

  if (!isVisible || similarAnnotations.length === 0) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        zIndex: 1001, // Above regular annotations but below UI elements
        pointerEvents: 'none', // Don't interfere with map interactions
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    />
  );
};

SimilarAnnotationRenderer.propTypes = {
  containerRef: PropTypes.object.isRequired,
  similarAnnotations: PropTypes.array,
  isVisible: PropTypes.bool,
  mapScale: PropTypes.number.isRequired,
  mapPan: PropTypes.object.isRequired,
  stageDimensions: PropTypes.object.isRequired,
  pixelsPerMm: PropTypes.number.isRequired,
  wellInfoMap: PropTypes.object,
  className: PropTypes.string
};

export default SimilarAnnotationRenderer;
