import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const ImageJPanel = ({ isOpen, image, onClose, appendLog, imjoyApi }) => {
  const [ijInstance, setIjInstance] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const containerRef = useRef(null);

  // Create ImageJ window when ImJoy is ready
  useEffect(() => {
    const createImageJWindow = async () => {
      if (!imjoyApi || !containerRef.current || ijInstance) return;

      try {
        setIsLoading(true);
        setError(null);
        appendLog('Creating ImageJ.js window...');

        // Create ImageJ window
        const ij = await imjoyApi.createWindow({
          src: "https://ij.imjoy.io",
          name: "ImageJ.JS",
          window_id: "imagej-container" // Use the static ID of the container div
        });

        setIjInstance(ij);
        appendLog('ImageJ.js window created successfully.');
        setIsLoading(false);
      } catch (err) {
        console.error('Error creating ImageJ window:', err);
        const errorMessage = `Failed to create ImageJ.js window: ${err.message}`;
        setError(errorMessage);
        appendLog(errorMessage);
        setIsLoading(false);
      }
    };

    if (isOpen && imjoyApi && containerRef.current && !ijInstance) {
      createImageJWindow();
    }
  }, [isOpen, imjoyApi, ijInstance, appendLog]);

  // Load image when it changes
  useEffect(() => {
    const loadImageToImageJ = async () => {
      if (!ijInstance || !image) return;

      try {
        setIsLoading(true);
        appendLog('Loading image into ImageJ.js...');

        // Convert base64 data URL to format ImageJ can understand
        const base64Data = image.split(',')[1]; // Remove "data:image/png;base64," prefix
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Load the image into ImageJ
        await ijInstance.viewImage(bytes.buffer, { name: "microscope-snapshot.png" });
        appendLog('Image loaded into ImageJ.js successfully.');
        setIsLoading(false);
      } catch (err) {
        console.error('Error loading image to ImageJ:', err);
        const errorMessage = `Failed to load image: ${err.message}`;
        setError(errorMessage);
        appendLog(errorMessage);
        setIsLoading(false);
      }
    };

    if (image && ijInstance) {
      loadImageToImageJ();
    }
  }, [image, ijInstance, appendLog]);

  if (!isOpen) return null;

  return (
    <div className="imagej-panel h-full flex flex-col bg-white">
      {/* Header */}
      <div className="imagej-panel-header flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <img 
            src="https://ij.imjoy.io/assets/badge/launch-imagej-js-badge.svg" 
            alt="ImageJ.js" 
            className="h-6"
          />
          <h2 className="text-lg font-semibold text-gray-800">ImageJ.js</h2>
          {isLoading && (
            <div className="flex items-center gap-2 text-blue-600">
              <i className="fas fa-spinner fa-spin"></i>
              <span className="text-sm">Loading...</span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors"
          title="Close ImageJ Panel"
        >
          <i className="fas fa-times mr-1"></i>
          Close
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 m-4 rounded">
          <div className="flex items-center">
            <i className="fas fa-exclamation-triangle mr-2"></i>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* ImageJ Container */}
      <div className="imagej-container flex-1 p-4">
        {!imjoyApi ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <i className="fas fa-spinner fa-spin text-2xl mb-2"></i>
              <p>Initializing ImJoy Core...</p>
            </div>
          </div>
        ) : (
          <div
            ref={containerRef}
            id="imagej-container"
            className="w-full h-full border border-gray-300 rounded bg-gray-100"
            style={{ minHeight: '500px' }}
          />
        )}
      </div>

      {/* Instructions */}
      <div className="imagej-instructions p-4 border-t border-gray-200 bg-gray-50">
        <p className="text-sm text-gray-600">
          <i className="fas fa-info-circle mr-1"></i>
          You can drag and drop additional images directly into the ImageJ window above, or use the microscope controls to snap and send new images.
        </p>
      </div>
    </div>
  );
};

ImageJPanel.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  image: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  appendLog: PropTypes.func.isRequired,
  imjoyApi: PropTypes.object,
};

export default ImageJPanel; 