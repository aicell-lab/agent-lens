/**
 * Annotation Embedding Service
 * 
 * Service to automatically generate image and text embeddings for annotations.
 * 
 * NEW FEATURES (Advanced Extraction):
 * - Accesses scale0 data directly from microscope/artifact services
 * - Applies proper channel merging and contrast adjustments
 * - Works in both HISTORICAL and FREE_PAN modes
 * - Uses same processing logic as main microscopy system
 * 
 * LEGACY FEATURES (Canvas Extraction):
 * - Extracts image regions from microscope view canvas (legacy method)
 * - Falls back when advanced extraction requirements not met
 */

import TileProcessingManager from '../components/map_visualization/TileProcessingManager.jsx';

/**
 * Extract image region from canvas based on annotation coordinates
 * @param {HTMLCanvasElement} canvas - The microscope view canvas
 * @param {Object} annotation - Annotation object with points and type
 * @param {Object} mapScale - Current map scale
 * @param {Object} mapPan - Current map pan offset
 * @param {Object} stageDimensions - Stage dimensions in mm
 * @param {number} pixelsPerMm - Pixels per millimeter conversion
 * @returns {Promise<Blob>} Image blob of the extracted region
 */
export async function extractAnnotationImageRegion(canvas, annotation, mapScale, mapPan, stageDimensions, pixelsPerMm) {
  if (!canvas || !annotation) {
    throw new Error('Canvas or annotation is required');
  }

  // Convert stage coordinates to display coordinates
  const stageToDisplayCoords = (stageX_mm, stageY_mm) => {
    const mapX = (stageX_mm - stageDimensions.xMin) * pixelsPerMm;
    const mapY = (stageY_mm - stageDimensions.yMin) * pixelsPerMm;
    const displayX = mapX * mapScale + mapPan.x;
    const displayY = mapY * mapScale + mapPan.y;
    return { x: displayX, y: displayY };
  };

  // Get display coordinates for all annotation points
  const displayPoints = annotation.points.map(point => 
    stageToDisplayCoords(point.x, point.y)
  );

  // Calculate bounding box
  const xValues = displayPoints.map(p => p.x);
  const yValues = displayPoints.map(p => p.y);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  // Add some padding around the annotation
  const padding = 20;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  const width = Math.min(canvas.width - x, maxX - minX + 2 * padding);
  const height = Math.min(canvas.height - y, maxY - minY + 2 * padding);

  // Extract the region from canvas
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(x, y, width, height);
  
  // Create a new canvas for the extracted region
  const regionCanvas = document.createElement('canvas');
  regionCanvas.width = width;
  regionCanvas.height = height;
  // Set willReadFrequently to optimize for multiple readback operations
  regionCanvas.setAttribute('willReadFrequently', 'true');
  const regionCtx = regionCanvas.getContext('2d');
  regionCtx.putImageData(imageData, 0, 0);

  // Apply shape-based masking for polygon and freehand annotations
  if (annotation.type === 'polygon' || annotation.type === 'freehand') {
    const maskedCanvas = applyShapeMaskToCanvas(regionCanvas, displayPoints, x, y, padding);
    return canvasToBlob(maskedCanvas);
  }

  // Convert to blob (for rectangle annotations or when no masking needed)
  return canvasToBlob(regionCanvas);
}

/**
 * Extract annotation image region from scale0 data with proper channel processing
 * This is the improved version that accesses original data instead of just cropping the map
 * 
 * @param {Object} annotation - Annotation object with points and type
 * @param {Object} wellInfo - Well information object with centerX, centerY, id
 * @param {string} mode - 'HISTORICAL' or 'FREE_PAN'
 * @param {Object} services - Service objects { microscopeControlService, artifactZarrLoader }
 * @param {Object} channelConfigs - Channel settings for contrast/color { channelName: { min, max, color, enabled } }
 * @param {Array} enabledChannels - Array of enabled channel objects
 * @param {Object} metadata - Additional metadata (datasetId, wellPlateType, timepoint, etc.)
 * @returns {Promise<Blob>} Image blob of the extracted region with proper channel processing
 */
export async function extractAnnotationImageRegionAdvanced(
  annotation, 
  wellInfo, 
  mode, 
  services, 
  channelConfigs, 
  enabledChannels, 
  metadata = {}
) {
  if (!annotation || !wellInfo) {
    throw new Error('Annotation and well info are required');
  }

  if (!services || (!services.microscopeControlService && !services.artifactZarrLoader)) {
    throw new Error('At least one service (microscopeControlService or artifactZarrLoader) is required');
  }

  if (!enabledChannels || enabledChannels.length === 0) {
    throw new Error('At least one enabled channel is required');
  }

  console.log(`🎨 AdvancedAnnotationExtraction: Processing annotation ${annotation.id} in ${mode} mode`);

  try {
    // Calculate annotation bounding box based on mode
    let annotationBounds;
    if (mode === 'HISTORICAL') {
      // For historical mode, use well-relative coordinates
      annotationBounds = calculateAnnotationBounds(annotation, wellInfo);
    } else {
      // For FREE_PAN mode, use stage coordinates directly
      annotationBounds = calculateAnnotationBoundsStage(annotation);
    }
    
    // Use exact annotation bounds without padding
    const regionBounds = {
      centerX: annotationBounds.centerX,
      centerY: annotationBounds.centerY,
      width_mm: annotationBounds.width,
      height_mm: annotationBounds.height
    };

    // Create tile request for scale0 data
    const tileRequest = {
      wellId: wellInfo.id,
      centerX: regionBounds.centerX,
      centerY: regionBounds.centerY,
      width_mm: regionBounds.width_mm,
      height_mm: regionBounds.height_mm,
      scaleLevel: 0, // Always use scale0 for highest resolution
      timepoint: metadata.timepoint || 0,
      datasetId: metadata.datasetId,
      wellPlateType: metadata.wellPlateType || '96',
      wellPaddingMm: 0,
      bounds: regionBounds
    };

    console.log(`🎨 AdvancedAnnotationExtraction: Tile request:`, tileRequest);

    // Process all enabled channels using the same logic as the main system
    const processedTile = await TileProcessingManager.processTileChannels(
      enabledChannels,
      tileRequest,
      mode,
      channelConfigs,
      services,
      metadata
    );

    if (!processedTile || !processedTile.data) {
      throw new Error('Failed to process tile channels for annotation region - no data available in this area');
    }

    console.log(`✅ AdvancedAnnotationExtraction: Successfully processed ${enabledChannels.length} channels`);

    // Convert data URL to blob
    let imageBlob = await dataUrlToBlob(processedTile.data);
    
    // Apply shape-based masking for polygon and freehand annotations
    if (annotation.type === 'polygon' || annotation.type === 'freehand') {
      imageBlob = await applyShapeMaskToImageBlob(imageBlob, annotation, annotationBounds, mode, wellInfo);
    }
    
    return imageBlob;

  } catch (error) {
    console.error('🎨 AdvancedAnnotationExtraction: Error extracting annotation region:', error);
    throw error;
  }
}

/**
 * Calculate annotation bounding box in stage coordinates (for FREE_PAN mode)
 * @param {Object} annotation - Annotation object with points
 * @returns {Object} Bounding box { centerX, centerY, width, height }
 */
function calculateAnnotationBoundsStage(annotation) {
  if (!annotation.points || annotation.points.length === 0) {
    throw new Error('Annotation must have points');
  }

  // Use annotation points directly (they're already in stage coordinates)
  const xValues = annotation.points.map(p => p.x);
  const yValues = annotation.points.map(p => p.y);
  
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    centerX,
    centerY,
    width,
    height,
    minX,
    maxX,
    minY,
    maxY
  };
}

/**
 * Calculate annotation bounding box in well-relative coordinates (for HISTORICAL mode)
 * @param {Object} annotation - Annotation object with points
 * @param {Object} wellInfo - Well information with centerX, centerY
 * @returns {Object} Bounding box { centerX, centerY, width, height }
 */
function calculateAnnotationBounds(annotation, wellInfo) {
  if (!annotation.points || annotation.points.length === 0) {
    throw new Error('Annotation must have points');
  }

  // Convert stage coordinates to well-relative coordinates
  const wellRelativePoints = annotation.points.map(point => ({
    x: point.x - wellInfo.centerX,
    y: point.y - wellInfo.centerY
  }));

  // Calculate bounding box
  const xValues = wellRelativePoints.map(p => p.x);
  const yValues = wellRelativePoints.map(p => p.y);
  
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  const minY = Math.min(...yValues);
  const maxY = Math.max(...yValues);

  const width = maxX - minX;
  const height = maxY - minY;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    centerX,
    centerY,
    width,
    height,
    minX,
    maxX,
    minY,
    maxY
  };
}

/**
 * Convert data URL to blob
 * @param {string} dataUrl - Data URL string
 * @returns {Promise<Blob>} Image blob
 */
function dataUrlToBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from processed image'));
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load processed image'));
    };
    
    img.src = dataUrl;
  });
}

/**
 * Generate image embedding from annotation region
 * @param {Blob} imageBlob - Image blob of the annotation region
 * @returns {Promise<Array<number>>} Image embedding vector
 */
export async function generateImageEmbedding(imageBlob) {
  try {
    const formData = new FormData();
    formData.append('image', imageBlob, 'annotation_region.png');

    // Use the current page URL as base, which should be the frontend service URL
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/embedding/image`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Image embedding API error: ${response.status}`);
    }

    const result = await response.json();
    return result.embedding;
  } catch (error) {
    console.error('Error generating image embedding:', error);
    throw error;
  }
}

/**
 * Generate image embeddings from multiple image blobs in batch
 * @param {Array<Blob>} imageBlobs - Array of image blobs
 * @returns {Promise<Array<Array<number>|null>>} Array of embedding vectors (null for failed images)
 */
export async function generateImageEmbeddingBatch(imageBlobs) {
  try {
    if (!imageBlobs || imageBlobs.length === 0) {
      return [];
    }

    const formData = new FormData();
    imageBlobs.forEach((blob, index) => {
      formData.append('images', blob, `annotation_region_${index}.png`);
    });

    // Use the current page URL as base, which should be the frontend service URL
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/embedding/image-batch`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Batch image embedding API error: ${response.status}`);
    }

    const result = await response.json();
    
    // Convert results to array of embeddings (null for failed)
    return result.results.map(r => r?.embedding || null);
  } catch (error) {
    console.error('Error generating batch image embeddings:', error);
    throw error;
  }
}

/**
 * Generate text embedding from annotation description
 * @param {string} description - Annotation description text
 * @returns {Promise<Array<number>>} Text embedding vector
 */
export async function generateTextEmbedding(description) {
  if (!description || description.trim() === '') {
    return null;
  }

  try {
    // Use the current page URL as base, which should be the frontend service URL
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    const url = new URL(`${baseUrl}/embedding/text`);
    url.searchParams.set('text', description);
    
    const response = await fetch(url, {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`Text embedding API error: ${response.status}`);
    }

    const result = await response.json();
    return result.embedding;
  } catch (error) {
    console.error('Error generating text embedding:', error);
    throw error;
  }
}

/**
 * Generate both image and text embeddings for an annotation using advanced extraction
 * @param {Object} annotation - Annotation object
 * @param {Object} wellInfo - Well information object
 * @param {string} mode - 'HISTORICAL' or 'FREE_PAN'
 * @param {Object} services - Service objects
 * @param {Object} channelConfigs - Channel settings
 * @param {Array} enabledChannels - Enabled channels
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Object containing image and text embeddings
 */
export async function generateAnnotationEmbeddingsAdvanced(
  annotation, 
  wellInfo, 
  mode, 
  services, 
  channelConfigs, 
  enabledChannels, 
  metadata = {}
) {
  try {
    console.log('Generating embeddings for annotation:', annotation.id);

    // Extract image region using advanced method
    const imageBlob = await extractAnnotationImageRegionAdvanced(
      annotation, wellInfo, mode, services, channelConfigs, enabledChannels, metadata
    );

    // Generate embeddings in parallel
    const [imageEmbedding, textEmbedding] = await Promise.all([
      generateImageEmbedding(imageBlob),
      generateTextEmbedding(annotation.description || '')
    ]);

    const result = {
      imageEmbedding,
      textEmbedding,
      generatedAt: new Date().toISOString()
    };

    console.log('Embeddings generated successfully:', result);
    return result;

  } catch (error) {
    console.error('Error generating annotation embeddings:', error);
    throw error;
  }
}

/**
 * Generate both image and text embeddings for an annotation (legacy method)
 * @param {HTMLCanvasElement} canvas - The microscope view canvas
 * @param {Object} annotation - Annotation object
 * @param {Object} mapScale - Current map scale
 * @param {Object} mapPan - Current map pan offset
 * @param {Object} stageDimensions - Stage dimensions in mm
 * @param {number} pixelsPerMm - Pixels per millimeter conversion
 * @returns {Promise<Object>} Object containing image and text embeddings
 */
export async function generateAnnotationEmbeddings(canvas, annotation, mapScale, mapPan, stageDimensions, pixelsPerMm) {
  try {
    console.log('Generating embeddings for annotation (legacy method):', annotation.id);

    // Extract image region
    const imageBlob = await extractAnnotationImageRegion(
      canvas, annotation, mapScale, mapPan, stageDimensions, pixelsPerMm
    );

    // Generate embeddings in parallel
    const [imageEmbedding, textEmbedding] = await Promise.all([
      generateImageEmbedding(imageBlob),
      generateTextEmbedding(annotation.description || '')
    ]);

    const result = {
      imageEmbedding,
      textEmbedding,
      generatedAt: new Date().toISOString()
    };

    console.log('Embeddings generated successfully:', result);
    return result;

  } catch (error) {
    console.error('Error generating annotation embeddings:', error);
    throw error;
  }
}

/**
 * Apply shape-based masking to a canvas for polygon and freehand annotations
 * @param {HTMLCanvasElement} sourceCanvas - Source canvas with the image
 * @param {Array} displayPoints - Array of display coordinate points
 * @param {number} offsetX - X offset of the bounding box
 * @param {number} offsetY - Y offset of the bounding box  
 * @param {number} padding - Padding around the annotation
 * @returns {HTMLCanvasElement} New canvas with shape mask applied
 */
function applyShapeMaskToCanvas(sourceCanvas, displayPoints, offsetX, offsetY, padding) {
  // Create a new canvas for the masked result
  const maskedCanvas = document.createElement('canvas');
  maskedCanvas.width = sourceCanvas.width;
  maskedCanvas.height = sourceCanvas.height;
  maskedCanvas.setAttribute('willReadFrequently', 'true');
  
  const maskedCtx = maskedCanvas.getContext('2d');
  
  // Convert display points to canvas-relative coordinates
  const canvasPoints = displayPoints.map(point => ({
    x: point.x - offsetX,
    y: point.y - offsetY
  }));
  
  // Create a clipping path based on the annotation shape
  maskedCtx.save();
  maskedCtx.beginPath();
  
  if (canvasPoints.length > 0) {
    maskedCtx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
    for (let i = 1; i < canvasPoints.length; i++) {
      maskedCtx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
    }
    maskedCtx.closePath();
  }
  
  // Use the path as a clipping region
  maskedCtx.clip();
  
  // Draw the source image only within the clipped region
  maskedCtx.drawImage(sourceCanvas, 0, 0);
  
  maskedCtx.restore();
  
  return maskedCanvas;
}

/**
 * Apply shape-based masking to an image blob for polygon and freehand annotations
 * @param {Blob} imageBlob - Source image blob
 * @param {Object} annotation - Annotation object with points and type
 * @param {Object} annotationBounds - Bounding box information
 * @param {string} mode - 'HISTORICAL' or 'FREE_PAN'
 * @param {Object} wellInfo - Well information (for HISTORICAL mode)
 * @returns {Promise<Blob>} Masked image blob
 */
async function applyShapeMaskToImageBlob(imageBlob, annotation, annotationBounds, mode, wellInfo) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create canvas from the source image
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      sourceCanvas.setAttribute('willReadFrequently', 'true');
      const sourceCtx = sourceCanvas.getContext('2d');
      sourceCtx.drawImage(img, 0, 0);
      
      // Calculate the scale factor between the image and the annotation bounds
      const imageWidth = img.width;
      const imageHeight = img.height;
      const boundsWidth = annotationBounds.width;
      const boundsHeight = annotationBounds.height;
      
      // Convert annotation points to image-relative coordinates
      let imagePoints;
      if (mode === 'HISTORICAL') {
        // Convert stage coordinates to well-relative, then to image coordinates
        imagePoints = annotation.points.map(point => {
          const wellRelativeX = point.x - wellInfo.centerX;
          const wellRelativeY = point.y - wellInfo.centerY;
          // Convert from annotation space to image space
          const imageX = ((wellRelativeX - annotationBounds.centerX) + (boundsWidth / 2)) * (imageWidth / boundsWidth);
          const imageY = ((wellRelativeY - annotationBounds.centerY) + (boundsHeight / 2)) * (imageHeight / boundsHeight);
          return { x: imageX, y: imageY };
        });
      } else {
        // For FREE_PAN mode, convert stage coordinates directly to image coordinates
        imagePoints = annotation.points.map(point => {
          const imageX = ((point.x - annotationBounds.centerX) + (boundsWidth / 2)) * (imageWidth / boundsWidth);
          const imageY = ((point.y - annotationBounds.centerY) + (boundsHeight / 2)) * (imageHeight / boundsHeight);
          return { x: imageX, y: imageY };
        });
      }
      
      // Create masked canvas
      const maskedCanvas = document.createElement('canvas');
      maskedCanvas.width = imageWidth;
      maskedCanvas.height = imageHeight;
      maskedCanvas.setAttribute('willReadFrequently', 'true');
      const maskedCtx = maskedCanvas.getContext('2d');
      
      // Create clipping path
      maskedCtx.save();
      maskedCtx.beginPath();
      
      if (imagePoints.length > 0) {
        maskedCtx.moveTo(imagePoints[0].x, imagePoints[0].y);
        for (let i = 1; i < imagePoints.length; i++) {
          maskedCtx.lineTo(imagePoints[i].x, imagePoints[i].y);
        }
        maskedCtx.closePath();
      }
      
      // Apply clipping and draw image
      maskedCtx.clip();
      maskedCtx.drawImage(sourceCanvas, 0, 0);
      maskedCtx.restore();
      
      // Convert to blob
      maskedCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create masked image blob'));
        }
      }, 'image/png');
    };
    
    img.onerror = () => {
      reject(new Error('Failed to load image for masking'));
    };
    
    // Convert blob to data URL for image loading
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read image blob'));
    };
    reader.readAsDataURL(imageBlob);
  });
}

/**
 * Convert canvas to blob (helper function)
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @returns {Promise<Blob>} Image blob
 */
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create image blob from canvas'));
      }
    }, 'image/png');
  });
}
