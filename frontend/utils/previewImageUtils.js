/**
 * Utility functions for generating preview images from annotations
 */

/**
 * Generate a 50x50 preview image from annotation canvas data
 * @param {HTMLCanvasElement} canvas - The annotation canvas
 * @param {Object} annotation - The annotation object with bounds
 * @returns {Promise<string>} Base64 encoded preview image
 */
export const generatePreviewImage = async (canvas, annotation) => {
  try {
    if (!canvas || !annotation || !annotation.bounds) {
      return null;
    }

    const { x, y, width, height } = annotation.bounds;
    
    // Create a temporary canvas for the preview
    const previewCanvas = document.createElement('canvas');
    const previewCtx = previewCanvas.getContext('2d');
    
    // Set preview canvas size to 50x50
    previewCanvas.width = 50;
    previewCanvas.height = 50;
    
    // Calculate source dimensions (ensure they're positive)
    const sourceWidth = Math.max(Math.abs(width), 1);
    const sourceHeight = Math.max(Math.abs(height), 1);
    const sourceX = Math.min(x, x + width);
    const sourceY = Math.min(y, y + height);
    
    // Draw the annotation region onto the preview canvas, scaled to 50x50
    previewCtx.drawImage(
      canvas,
      sourceX, sourceY, sourceWidth, sourceHeight,  // Source rectangle
      0, 0, 50, 50                                   // Destination rectangle (50x50)
    );
    
    // Convert to base64 PNG and extract just the base64 part (without data URL prefix)
    const dataUrl = previewCanvas.toDataURL('image/png', 0.8); // 0.8 quality for compression
    const base64 = dataUrl.split(',')[1]; // Remove "data:image/png;base64," prefix
    
    return base64;
  } catch (error) {
    console.error('Error generating preview image:', error);
    return null;
  }
};

/**
 * Generate preview image from annotation's existing extracted image
 * @param {string} extractedImageDataUrl - Base64 data URL of extracted annotation image
 * @returns {Promise<string>} Base64 encoded 50x50 preview image
 */
export const generatePreviewFromDataUrl = async (extractedImageDataUrl) => {
  try {
    console.log('🖼️ generatePreviewFromDataUrl called with:', {
      hasDataUrl: !!extractedImageDataUrl,
      dataUrlPrefix: extractedImageDataUrl ? extractedImageDataUrl.substring(0, 30) : null
    });
    
    if (!extractedImageDataUrl) {
      console.log('⚠️ No extractedImageDataUrl provided');
      return null;
    }

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        console.log('🖼️ Image loaded successfully, generating preview...');
        // Create preview canvas
        const previewCanvas = document.createElement('canvas');
        const previewCtx = previewCanvas.getContext('2d');
        
        previewCanvas.width = 50;
        previewCanvas.height = 50;
        
        // Fill with black background
        previewCtx.fillStyle = 'black';
        previewCtx.fillRect(0, 0, 50, 50);
        
        // Calculate scaling to fit image within 50x50 while maintaining aspect ratio
        const scale = Math.min(50 / img.width, 50 / img.height);
        const scaledWidth = img.width * scale;
        const scaledHeight = img.height * scale;
        
        // Center the image in the 50x50 canvas
        const offsetX = (50 - scaledWidth) / 2;
        const offsetY = (50 - scaledHeight) / 2;
        
        // Draw image scaled and centered with black padding
        previewCtx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight);
        
        // Convert to base64 PNG and extract just the base64 part (without data URL prefix)
        const dataUrl = previewCanvas.toDataURL('image/png', 0.8);
        const base64 = dataUrl.split(',')[1]; // Remove "data:image/png;base64," prefix
        console.log('🖼️ Preview generated successfully:', {
          originalSize: `${img.width}x${img.height}`,
          scaledSize: `${scaledWidth.toFixed(1)}x${scaledHeight.toFixed(1)}`,
          previewSize: base64.length,
          previewPrefix: base64.substring(0, 30)
        });
        resolve(base64);
      };
      img.onerror = () => {
        console.error('Error loading image for preview generation');
        resolve(null);
      };
      img.src = extractedImageDataUrl;
    });
  } catch (error) {
    console.error('Error generating preview from data URL:', error);
    return null;
  }
};
