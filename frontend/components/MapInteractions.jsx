import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import DrawButton from './DrawButton';
import PenButton from './PenButton';
import SegmentControls from './SegmentControls';
import { getSnapshotArray, overlaySegmentationMask } from './Segment';
import MapButton from './MapButton';
import html2canvas from 'html2canvas';

const MapInteractions = ({ 
  segmentService, 
  snapshotImage, 
  map, 
  extent, 
  appendLog, 
  vectorLayer, 
  channelNames, 
  addTileLayer,
  isMapViewEnabled,
  selectedTimepoint,
  loadTimepointMap,
  currentChannel,
  setCurrentChannel,
  toggleChannelSelector,
  isChannelSelectorOpen,
  selectedChannels,
  handleChannelToggle,
  applyChannelSelection,
  isMergeMode,
  loadTimepointMapMerged,
  addMergedTileLayer,
  channelColors,
  openChannelSettings
}) => {
  const [isFirstClick, setIsFirstClick] = useState(true); // Track if it's the first click for segmentation
  const [isDrawingActive, setIsDrawingActive] = useState(false);
  const [selectedModel, setSelectedModel] = useState('vit_b_lm');
  const [segmentActive, setSegmentActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [localSnapshotImage, setLocalSnapshotImage] = useState(null);
  const [isPenActive, setIsPenActive] = useState(false);

  useEffect(() => {
    let clickListener;
    
    if (map) {
      clickListener = async (event) => {
        if (isDrawingActive) {
          return;
        }
        
        if (isPenActive) {
          await captureAndSegment(event.coordinate);
        }
      };
      
      map.on('click', clickListener);
    }

    return () => {
      if (map && clickListener) {
        map.un('click', clickListener);
      }
    };
  }, [map, isDrawingActive, isPenActive]);

  const captureMapScreenshot = async (coordinate) => {
    if (!map) return null;
    
    // Get the pixel position from map coordinates
    const pixel = map.getPixelFromCoordinate(coordinate);
    if (!pixel) return null;
    
    try {
      // The map element
      const mapElement = map.getTargetElement();
      
      // Calculate the area to capture (512x512 around the clicked point)
      const left = Math.max(0, pixel[0] - 256);
      const top = Math.max(0, pixel[1] - 256);
      
      // Calculate the bounds of the screenshot in map coordinates
      const topLeft = map.getCoordinateFromPixel([left, top]);
      const bottomRight = map.getCoordinateFromPixel([left + 512, top + 512]);
      
      // Create the extent for this screenshot
      const screenshotExtent = [
        topLeft[0],
        bottomRight[1],
        bottomRight[0],
        topLeft[1]
      ];
      
      // Use html2canvas to capture the screenshot
      const canvas = await html2canvas(mapElement, {
        x: left,
        y: top,
        width: 512,
        height: 512,
        useCORS: true,
        logging: false,
      });
      
      // Convert canvas to blob
      return new Promise(resolve => {
        canvas.toBlob(blob => {
          const url = URL.createObjectURL(blob);
          setLocalSnapshotImage(url);
          resolve({
            url: url,
            extent: screenshotExtent
          });
        }, 'image/png');
      });
    } catch (error) {
      console.error('Error capturing map screenshot:', error);
      appendLog(`Error capturing screenshot: ${error.message}`);
      return null;
    }
  };

  const getSegmentedResult = async (pointCoordinates, snapshotArray, imageExtent = null) => {
    let normalizedCoords = pointCoordinates;

    // If we have an image extent, we need to normalize the coordinates to 0-1 range
    if (imageExtent) {
        // Calculate normalized coordinates (0-1 range) within the image
        const imageWidth = imageExtent[2] - imageExtent[0];
        const imageHeight = imageExtent[3] - imageExtent[1];
        
        // Convert from map coordinates to image coordinates (0-1 range)
        const normalizedX = (pointCoordinates[0] - imageExtent[0]) / imageWidth;
        const normalizedY = (pointCoordinates[1] - imageExtent[1]) / imageHeight;
        
        // Convert to pixel coordinates (assuming image is 512x512)
        const pixelX = Math.floor(normalizedX * 512);
        const pixelY = Math.floor(normalizedY * 512);
        
        normalizedCoords = [pixelX, pixelY];
        console.log('Using normalized coordinates for segmentation:', normalizedCoords);
    }

    if (isFirstClick) {
        return await segmentService.compute_embedding_with_initial_segment(
            selectedModel,
            snapshotArray,
            [normalizedCoords],
            [1]
        );
    } else {
        return await segmentService.segment_with_existing_embedding(
            snapshotArray,
            [normalizedCoords],
            [1]
        );
    }
  };

  const captureAndSegment = async (pointCoordinates) => {
    appendLog(`Clicked at coordinates: (${pointCoordinates[0]}, ${pointCoordinates[1]})`);

    if (!segmentService) {
      appendLog('Segmentation service not available.');
      return;
    }

    setIsProcessing(true);
    appendLog('Capturing screenshot around the clicked location...');

    try {
      // Capture a screenshot of the map area
      const screenshot = await captureMapScreenshot(pointCoordinates);
      
      if (!screenshot) {
        appendLog('Failed to capture screenshot.');
        setIsProcessing(false);
        return;
      }
      
      appendLog('Screenshot captured. Processing segmentation...');

      // Use the fresh screenshot for segmentation
      const snapshotArray = await getSnapshotArray(screenshot.url);
      
      // For the local screenshot, we use the center point as the click point
      // We need to map this to the image coordinates
      const screenshotCenter = [256, 256]; // Center of 512x512 image
      
      const segmentedResult = await getSegmentedResult(screenshotCenter, snapshotArray, screenshot.extent);

      if (segmentedResult.error) {
          appendLog(`Segmentation error: ${segmentedResult.error}`);
          setIsProcessing(false);
          return;
      }

      // Use the screenshot extent for proper mask positioning
      overlaySegmentationMask(segmentedResult.mask, map, screenshot.extent);
      appendLog('Segmentation completed and displayed.');
    } catch (error) {
      appendLog(`Segmentation failed: ${error.message}`);
      console.error('Segmentation error:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImageClick = async (pointCoordinates) => {
    appendLog(`Clicked at coordinates: (${pointCoordinates[0]}, ${pointCoordinates[1]})`);

    if (!snapshotImage && !localSnapshotImage) {
        appendLog('Error: No snapshot image available for segmentation. Please capture an image first.');
        return;
    }

    try {
        const imageToUse = localSnapshotImage || snapshotImage;
        const snapshotArray = await getSnapshotArray(imageToUse);
        const segmentedResult = await getSegmentedResult(pointCoordinates, snapshotArray);

        if (segmentedResult.error) {
            appendLog(`Segmentation error: ${segmentedResult.error}`);
            return;
        }

        overlaySegmentationMask(segmentedResult.mask, map, extent);
        appendLog('Segmentation completed and displayed.');
    } catch (error) {
        appendLog(`Segmentation failed: ${error.message}`);
        console.error('Segmentation error:', error);
    }
  };

  const handleSegmentClick = async () => {
    if (!segmentService) {
      appendLog('Segmentation service not available.');
      return;
    }

    if (segmentActive) {
      // Deactivate segmentation mode
      setSegmentActive(false);
    } else {
      // Activate segmentation mode
      setSegmentActive(true);
    }
  };

  const channelLabels = {
    0: 'Brightfield',
    11: '405nm (Violet)',
    12: '488nm (Green)',
    14: '561nm (Red-Orange)',
    13: '638nm (Deep Red)'
  };

  return (
    <>
      {map && ( // Only render controls if map is available
        <>
          <PenButton 
            appendLog={appendLog} 
            setIsFirstClick={setIsFirstClick} 
            snapshotImage={snapshotImage || localSnapshotImage}
            isPenActive={isPenActive}
            setIsPenActive={setIsPenActive}
            isProcessing={isProcessing}
            top="150"
          />
          <SegmentControls 
            segmentService={segmentService} 
            snapshotImage={snapshotImage || localSnapshotImage} 
            selectedModel={selectedModel} 
            setSelectedModel={setSelectedModel} 
            map={map} 
            extent={extent} 
            appendLog={appendLog}
            top="60"
          />
          <DrawButton 
            drawType="Point" 
            icon="fa-map-marker-alt" 
            top="192"
            map={map} 
            vectorLayer={vectorLayer} 
            setIsDrawingActive={setIsDrawingActive} 
          />
          <DrawButton 
            drawType="Polygon" 
            icon="fa-draw-polygon" 
            top="234"
            map={map} 
            vectorLayer={vectorLayer} 
            setIsDrawingActive={setIsDrawingActive} 
          />
        </>
      )}
      
      {/* Bottom control buttons */}
      <div className="absolute bottom-4 left-4 flex space-x-2">
        {/* Channel Selector Button */}
        <div className="relative">
          <button
            className={`rounded-full p-3 shadow-lg ${isMergeMode ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-green-500 hover:bg-green-600'} text-white`}
            onClick={toggleChannelSelector}
            title={isMergeMode ? "Edit merged channels" : "Select channels"}
          >
            <i className="fas fa-layer-group"></i>
          </button>

          {/* Channel Selection Dropdown */}
          {isChannelSelectorOpen && (
            <div className="absolute bottom-full left-0 mb-2 bg-white rounded shadow-lg p-3 z-10 w-60">
              <h5 className="font-medium text-gray-800 mb-2">Select Channels</h5>
              <div className="space-y-2 mb-3">
                {Object.entries(channelLabels).map(([key, label]) => (
                  <div key={key} className="flex items-center">
                    <input
                      type="checkbox"
                      id={`channel-${key}`}
                      checked={selectedChannels.includes(parseInt(key))}
                      onChange={() => handleChannelToggle(parseInt(key))}
                      className="mr-2"
                    />
                    <label 
                      htmlFor={`channel-${key}`}
                      className="flex-1 cursor-pointer"
                      style={{
                        color: key !== '0' ? channelColors[parseInt(key)] : 'inherit'
                      }}
                    >
                      {label}
                    </label>
                  </div>
                ))}
              </div>

              {/* Apply Selection Button */}
              <div className="flex justify-between">
                <button
                  className="bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-2 rounded text-sm"
                  onClick={toggleChannelSelector}
                >
                  Cancel
                </button>
                <button
                  className="bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded text-sm"
                  onClick={applyChannelSelection}
                >
                  Apply Selection
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* Image Processing Button */}
        <button
          className="rounded-full p-3 shadow-lg bg-purple-600 hover:bg-purple-700 text-white"
          onClick={openChannelSettings}
          title="Image Processing Settings"
        >
          <i className="fas fa-sliders-h"></i>
        </button>
      </div>

      {/* Legend showing active channels in merge mode - positioned above the buttons */}
      {isMergeMode && selectedChannels.length > 1 && (
        <div className="absolute bottom-16 left-4 bg-white rounded shadow-lg p-2 w-48">
          <h6 className="text-xs font-medium text-gray-700 mb-1">Active Channels</h6>
          <div className="space-y-1">
            {selectedChannels.map(channelKey => (
              <div key={channelKey} className="flex items-center text-xs">
                <div 
                  className="w-3 h-3 rounded-full mr-2"
                  style={{
                    backgroundColor: channelKey === 0 ? '#ffffff' : channelColors[channelKey],
                    border: channelKey === 0 ? '1px solid #ccc' : 'none'
                  }}
                ></div>
                <span style={{ color: channelKey === 0 ? 'inherit' : channelColors[channelKey] }}>
                  {channelLabels[channelKey]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Processing indicator */}
      {isProcessing && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded z-50">
          <i className="fas fa-spinner fa-spin mr-2"></i> Processing segmentation...
        </div>
      )}
    </>
  );
}

MapInteractions.propTypes = {
  segmentService: PropTypes.object,
  snapshotImage: PropTypes.string,
  map: PropTypes.object,
  extent: PropTypes.array.isRequired,
  appendLog: PropTypes.func.isRequired,
  vectorLayer: PropTypes.object,
  channelNames: PropTypes.object.isRequired,
  addTileLayer: PropTypes.func.isRequired,
  isMapViewEnabled: PropTypes.bool,
  selectedTimepoint: PropTypes.string,
  loadTimepointMap: PropTypes.func,
  currentChannel: PropTypes.number,
  setCurrentChannel: PropTypes.func,
  toggleChannelSelector: PropTypes.func,
  isChannelSelectorOpen: PropTypes.bool,
  selectedChannels: PropTypes.array,
  handleChannelToggle: PropTypes.func,
  applyChannelSelection: PropTypes.func,
  isMergeMode: PropTypes.bool,
  loadTimepointMapMerged: PropTypes.func,
  addMergedTileLayer: PropTypes.func,
  channelColors: PropTypes.object,
  openChannelSettings: PropTypes.func.isRequired
};

MapInteractions.defaultProps = {
  isMapViewEnabled: false,
  selectedTimepoint: null,
  loadTimepointMap: () => {},
  currentChannel: 0,
  setCurrentChannel: () => {},
  toggleChannelSelector: () => {},
  isChannelSelectorOpen: false,
  selectedChannels: [0],
  handleChannelToggle: () => {},
  applyChannelSelection: () => {},
  isMergeMode: false,
  loadTimepointMapMerged: () => {},
  addMergedTileLayer: () => {},
  channelColors: {},
  openChannelSettings: () => {}
};

export default MapInteractions;