/**
 * Annotation Embedding Service
 * 
 * Simple service to automatically generate image and text embeddings for annotations.
 * Extracts image regions from microscope view and calls existing embedding APIs.
 */

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

  // Convert to blob
  return new Promise((resolve, reject) => {
    regionCanvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to create image blob'));
      }
    }, 'image/png');
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
 * Generate both image and text embeddings for an annotation
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
    console.log('Generating embeddings for annotation:', annotation.id);

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
