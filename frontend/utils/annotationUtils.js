/**
 * Annotation Utilities
 * 
 * This module provides utilities for generating annotation data with well-relative coordinates,
 * WKT polygon strings, and bounding box information for microscopy annotations.
 */

/**
 * Generate a random object ID
 * @returns {string} Random object ID
 */
export function generateObjectId() {
  return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Convert stage coordinates to well-relative coordinates
 * @param {number} stageX - Stage X coordinate in mm
 * @param {number} stageY - Stage Y coordinate in mm
 * @param {Object} wellInfo - Well information object with centerX, centerY
 * @returns {Object} Well-relative coordinates {x, y}
 */
export function stageToWellRelativeCoords(stageX, stageY, wellInfo) {
  return {
    x: stageX - wellInfo.centerX,
    y: stageY - wellInfo.centerY
  };
}

/**
 * Convert well-relative coordinates to stage coordinates
 * @param {number} wellX - Well-relative X coordinate in mm
 * @param {number} wellY - Well-relative Y coordinate in mm
 * @param {Object} wellInfo - Well information object with centerX, centerY
 * @returns {Object} Stage coordinates {x, y}
 */
export function wellRelativeToStageCoords(wellX, wellY, wellInfo) {
  return {
    x: wellX + wellInfo.centerX,
    y: wellY + wellInfo.centerY
  };
}

/**
 * Generate WKT polygon string from points
 * @param {Array} points - Array of {x, y} coordinate objects
 * @returns {string} WKT polygon string
 */
export function generateWktPolygon(points) {
  if (points.length < 3) {
    return null; // Need at least 3 points for a polygon
  }
  
  // Format coordinates as "x y" pairs
  const coordPairs = points.map(point => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
  
  // Ensure polygon is closed (first and last points are the same)
  const firstPoint = coordPairs[0];
  const lastPoint = coordPairs[coordPairs.length - 1];
  if (firstPoint !== lastPoint) {
    coordPairs.push(firstPoint);
  }
  
  // Create WKT polygon string
  return `POLYGON((${coordPairs.join(', ')}))`;
}

/**
 * Generate bounding box from points
 * @param {Array} points - Array of {x, y} coordinate objects
 * @returns {Array} Bounding box [x, y, width, height]
 */
export function generateBoundingBox(points) {
  if (points.length === 0) {
    return null;
  }
  
  const xValues = points.map(p => p.x);
  const yValues = points.map(p => p.y);
  
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);
  
  return [
    Math.round(minX * 10000) / 10000, // Round to 4 decimal places (0.0001 mm)
    Math.round(minY * 10000) / 10000,
    Math.round((maxX - minX) * 10000) / 10000,
    Math.round((maxY - minY) * 10000) / 10000
  ];
}

/**
 * Generate annotation data object
 * @param {Object} annotation - Original annotation object
 * @param {Object} wellInfo - Well information object
 * @returns {Object} Enhanced annotation data
 */
export function generateAnnotationData(annotation, wellInfo) {
  if (!annotation || !wellInfo) {
    return null;
  }
  
  // Convert stage coordinates to well-relative coordinates
  const wellRelativePoints = annotation.points.map(point => 
    stageToWellRelativeCoords(point.x, point.y, wellInfo)
  );
  
  const annotationData = {
    obj_id: generateObjectId(),
    well: wellInfo.id,
    type: annotation.type,
    description: annotation.description || '',
    timestamp: annotation.timestamp || Date.now(),
    created_at: new Date().toISOString()
  };
  
  // Generate type-specific data
  if (annotation.type === 'rectangle') {
    // For rectangles, generate bounding box
    const bbox = generateBoundingBox(wellRelativePoints);
    annotationData.bbox = bbox;
    annotationData.polygon_wkt = null;
  } else if (annotation.type === 'freehand' || annotation.type === 'polygon') {
    // For polygons and freehand, generate WKT polygon
    const polygonWkt = generateWktPolygon(wellRelativePoints);
    annotationData.polygon_wkt = polygonWkt;
    annotationData.bbox = null;
  }
  
  return annotationData;
}

/**
 * Export annotations to JSON format
 * @param {Array} annotations - Array of annotation objects
 * @param {Object} wellInfoMap - Map of annotation IDs to well information
 * @returns {Object} Export data object
 */
export function exportAnnotationsToJson(annotations, wellInfoMap) {
  const annotationData = annotations.map(annotation => {
    const wellInfo = wellInfoMap[annotation.id];
    return generateAnnotationData(annotation, wellInfo);
  }).filter(data => data !== null);
  
  return {
    annotations: annotationData,
    metadata: {
      export_timestamp: new Date().toISOString(),
      total_annotations: annotationData.length,
      coordinate_system: 'well_relative_mm'
    }
  };
}

/**
 * Format annotation data for display
 * @param {Object} annotationData - Annotation data object
 * @returns {Object} Formatted display data
 */
export function formatAnnotationForDisplay(annotationData) {
  if (!annotationData) {
    return null;
  }
  
  const display = {
    id: annotationData.obj_id,
    well: annotationData.well,
    type: annotationData.type,
    description: annotationData.description,
    created: new Date(annotationData.created_at).toLocaleString(),
    strokeColor: annotationData.strokeColor,
    fillColor: annotationData.fillColor,
    strokeWidth: annotationData.strokeWidth
  };
  
  // Add type-specific information
  if (annotationData.bbox) {
    display.boundingBox = {
      x: annotationData.bbox[0],
      y: annotationData.bbox[1],
      width: annotationData.bbox[2],
      height: annotationData.bbox[3]
    };
  }
  
  if (annotationData.polygon_wkt) {
    display.polygonWkt = annotationData.polygon_wkt;
  }
  
  return display;
}
