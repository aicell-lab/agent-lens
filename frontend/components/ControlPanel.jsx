import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { Rnd } from 'react-rnd';
import ControlButton from './ControlButton';
import CameraSettings from './CameraSettings';

const ControlPanel = ({
  microscopeControlService,
  segmentService,
  setSnapshotImage,
  snapshotImage,
  map,
  vectorLayer,
  appendLog,
  addTileLayer,
  channelNames,
  onClose,
}) => {
  const [isLightOn, setIsLightOn] = useState(false);
  const [xPosition, setXPosition] = useState(0);
  const [yPosition, setYPosition] = useState(0);
  const [zPosition, setZPosition] = useState(0);
  const [xMove, setXMove] = useState(1);
  const [yMove, setYMove] = useState(1);
  const [zMove, setZMove] = useState(0.1);
  const [illuminationIntensity, setIlluminationIntensity] = useState(50);
  const [illuminationChannel, setIlluminationChannel] = useState("0");
  const [cameraExposure, setCameraExposure] = useState(100);
  const [isLiveView, setIsLiveView] = useState(false);
  const canvasRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const status = await microscopeControlService.get_status();
      setXPosition(status.current_x);
      setYPosition(status.current_y);
      setZPosition(status.current_z);
      setIsLightOn(status.is_illumination_on);
      // Update other states if needed
    } catch (error) {
      appendLog(`Failed to fetch status: ${error.message}`);
    }
  };

  useEffect(() => {
    const interval = setInterval(fetchStatus, 1000); // Fetch status every second
    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  useEffect(() => {
    switch (illuminationChannel) {
      case "0":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      case "11":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      case "12":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      case "14":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      case "13":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      case "15":
        setIlluminationIntensity(50);
        setCameraExposure(100);
        break;
      default:
        break;
    }
  }, [illuminationChannel]);

  useEffect(() => {
    if (!snapshotImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    img.onload = () => {
      console.log('Image loaded:', img.width, 'x', img.height);
      canvas.width = 512;
      canvas.height = 512;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };

    img.onerror = (error) => {
      console.error('Error loading image:', error);
      appendLog('Error loading image to canvas');
    };

    console.log('Setting image source (length):', snapshotImage.length);
    img.src = snapshotImage;
  }, [snapshotImage]);

  useEffect(() => {
    let liveViewInterval;
    if (isLiveView) {
      liveViewInterval = setInterval(async () => {
        try {
          const base64Image = await microscopeControlService.one_new_frame(cameraExposure, parseInt(illuminationChannel, 10), parseInt(illuminationIntensity, 10));
          setSnapshotImage(`data:image/png;base64,${base64Image}`);
        } catch (error) {
          appendLog(`Error in live view: ${error.message}`);
        }
      }, 2000);
    } else if (liveViewInterval) {
      clearInterval(liveViewInterval);
    }
    return () => clearInterval(liveViewInterval);
  }, [isLiveView, cameraExposure, illuminationChannel, illuminationIntensity]);

  const moveMicroscope = async (direction, multiplier) => {
    if (!microscopeControlService) return;
    try {
      let moveX = 0, moveY = 0, moveZ = 0;
      if (direction === 'x') moveX = xMove * multiplier;
      else if (direction === 'y') moveY = yMove * multiplier;
      else if (direction === 'z') moveZ = zMove * multiplier;

      appendLog(`Attempting to move by: ${moveX}, ${moveY}, ${moveZ}`);
      const result = await microscopeControlService.move_by_distance(moveX, moveY, moveZ);
      if (result.success) {
        appendLog(result.message);
        appendLog(`Moved from (${result.initial_position.x}, ${result.initial_position.y}, ${result.initial_position.z}) to (${result.final_position.x}, ${result.final_position.y}, ${result.final_position.z})`);
      } else {
        appendLog(`Move failed: ${result.message}`);
      }
    } catch (error) {
      appendLog(`Error in moveMicroscope: ${error.message}`);
    }
  };

  const moveToPosition = async () => {
    if (!microscopeControlService) return;
    try {
      appendLog(`Attempting to move to position: (${xMove}, ${yMove}, ${zMove})`);
      const result = await microscopeControlService.move_to_position(xMove, yMove, zMove);
      if (result.success) {
        appendLog(result.message);
        appendLog(`Moved from (${result.initial_position.x}, ${result.initial_position.y}, ${result.initial_position.z}) to (${result.final_position.x}, ${result.final_position.y}, ${result.final_position.z})`);
      } else {
        appendLog(`Move failed: ${result.message}`);
      }
    } catch (error) {
      appendLog(`Error in moveToPosition: ${error.message}`);
    }
  };

  const snapImage = async () => {
    appendLog('Snapping image...');
    const exposureTime = cameraExposure;
    const channel = parseInt(illuminationChannel, 10);
    const intensity = parseInt(illuminationIntensity, 10);
    
    try {
      const base64Image = await microscopeControlService.one_new_frame(exposureTime, channel, intensity);
      console.log('Received base64 image data of length:', base64Image.length);
      setSnapshotImage(`data:image/png;base64,${base64Image}`);
      appendLog('Image snapped and fetched successfully.');
    } catch (error) {
      console.error('Error in snapImage:', error);
      appendLog(`Error in snapImage: ${error.message}`);
    }
  };

  const autoFocus = async () => {
    await microscopeControlService.auto_focus();
    appendLog('Auto-focusing...');
  };

  const toggleLight = async () => {
    if (!isLightOn) {
      appendLog('Light turned on.');
    } else {
      appendLog('Light turned off.');
    }
    setIsLightOn(!isLightOn);
  };

  const resetEmbedding = (map, vectorLayer) => {
    map.getLayers()
      .getArray()
      .slice()
      .filter((layer) => layer.get('isSegmentationLayer'))
      .forEach((layer) => {
      map.removeLayer(layer);
    });

    if (vectorLayer && vectorLayer.getSource()) {
        vectorLayer.getSource().clear();
    }
  };

  const startLiveView = () => {
    appendLog('Starting live view...');
    setIsLiveView(true);
  };

  const stopLiveView = () => {
    appendLog('Stopping live view...');
    setIsLiveView(false);
  };

  return (
    <Rnd
      default={{
        x: window.innerWidth - 500,
        y: 20,
        width: 500,
        height: 600,
      }}
      minWidth={300}
      minHeight={400}
      bounds="window"
      className="bg-white bg-opacity-95 p-6 rounded-lg shadow-lg z-50 border-l border-gray-300 box-border overflow-y-auto"
      enableResizing={{
        bottom: true,
        bottomRight: true,
        right: true,
      }}
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-medium">Manual Control</h3>
        <button onClick={onClose} className="text-red-500 hover:text-red-700">
          <i className="fas fa-times"></i> Close
        </button>
      </div>
      <div id="manual-control-content">
        <div
          id="image-display"
          className={`mb-4 w-full h-64 border ${
            snapshotImage ? 'border-gray-300' : 'border-dotted border-gray-400'
          } rounded flex items-center justify-center`}
        >
          {snapshotImage ? (
            <canvas
              ref={canvasRef}
              width={500}
              height={400}
              className="border border-gray-300 rounded"
            ></canvas>
          ) : (
            <p className="placeholder-text text-center">Image Display</p>
          )}
        </div>

        <div className="control-group mb-4">
          <div className="horizontal-buttons flex justify-between space-x-2">
            <button
              className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/4 p-2 rounded"
              onClick={toggleLight}
              disabled={!microscopeControlService}
            >
              <i className="fas fa-lightbulb icon"></i> {isLightOn ? 'Turn Light Off' : 'Turn Light On'}
            </button>
            <button
              className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/4 p-2 rounded"
              onClick={autoFocus}
              disabled={!microscopeControlService}
            >
              <i className="fas fa-crosshairs icon"></i> Autofocus
            </button>
            <button
              className="control-button snap-button bg-green-500 text-white hover:bg-green-600 w-1/4 p-2 rounded"
              onClick={snapImage}
              disabled={!microscopeControlService}
            >
              <i className="fas fa-camera icon"></i> Snap Image
            </button>
            <button
              className={`control-button live-button ${isLiveView ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white w-1/4 p-2 rounded`}
              onClick={isLiveView ? stopLiveView : startLiveView}
              disabled={!microscopeControlService}
            >
              <i className="fas fa-video icon"></i> {isLiveView ? 'Stop Live' : 'Live'}
            </button>
          </div>
        </div>

        <div className="coordinate-container mb-4 flex justify-between">
          {['x', 'y', 'z'].map((axis) => (
            <div key={axis} className="coordinate-group p-2 border border-gray-300 rounded-lg w-1/3">
              <div className="flex justify-between mb-2">
                <input
                  type="text"
                  className="control-input w-1/2 p-2 border border-gray-300 rounded"
                  placeholder={`${axis.toUpperCase()}(mm)`}
                  value={axis === 'x' ? xPosition : axis === 'y' ? yPosition : zPosition}
                  readOnly
                />
                <input
                  type="number"
                  className="control-input w-1/2 p-2 border border-gray-300 rounded"
                  placeholder={`d${axis.toUpperCase()}(mm)`}
                  value={axis === 'x' ? xMove : axis === 'y' ? yMove : zMove}
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);
                    if (axis === 'x') setXMove(value);
                    else if (axis === 'y') setYMove(value);
                    else setZMove(value);
                  }}
                />
              </div>
              <div className="aligned-buttons flex justify-between">
                <button
                  className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 mr-1 p-2 rounded"
                  onClick={() => moveMicroscope(axis, -1)}
                  disabled={!microscopeControlService}
                >
                  <i className={`fas fa-arrow-${axis === 'x' ? 'left' : 'down'}`}></i> {axis.toUpperCase()}-
                </button>
                <button
                  className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 ml-1 p-2 rounded"
                  onClick={() => moveMicroscope(axis, 1)}
                  disabled={!microscopeControlService}
                >
                  {axis.toUpperCase()}+ <i className={`fas fa-arrow-${axis === 'x' ? 'right' : 'up'}`}></i>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="illumination-camera-container mb-4 flex justify-between">
          <div className="illumination-settings p-2 border border-gray-300 rounded-lg w-1/2">
            <div className="illumination-intensity mb-4">
              <div className="intensity-label-row flex justify-between mb-2">
                <label>Illumination Intensity: </label>
                <span>{illuminationIntensity}%</span>
              </div>
              <input
                type="range"
                className="control-input w-full"
                min="0"
                max="100"
                value={illuminationIntensity}
                onChange={(e) => {
                  const newIntensity = parseInt(e.target.value, 10);
                  setIlluminationIntensity(newIntensity);
                  // Update server with new intensity
                }}
              />
            </div>

            <div className="illumination-channel">
              <label>Illumination Channel:</label>
              <select
                className="control-input w-full mt-2 p-2 border border-gray-300 rounded"
                value={illuminationChannel}
                onChange={(e) => setIlluminationChannel(e.target.value)}
              >
                <option value="0">BF LED matrix full</option>
                <option value="11">Fluorescence 405 nm Ex</option>
                <option value="12">Fluorescence 488 nm Ex</option>
                <option value="14">Fluorescence 561nm Ex</option>
                <option value="13">Fluorescence 638nm Ex</option>
                <option value="15">Fluorescence 730nm Ex</option>
              </select>
            </div>
          </div>

          <div className="camera-exposure-settings p-2 border border-gray-300 rounded-lg w-1/2">
            <label>Camera Exposure:</label>
            <input
              type="number"
              className="control-input w-full mt-2 p-2 border border-gray-300 rounded"
              value={cameraExposure}
              onChange={(e) => setCameraExposure(parseInt(e.target.value, 10))}
            />
          </div>
        </div>
      </div>
    </Rnd>
  );
};

ControlPanel.propTypes = {
  microscopeControlService: PropTypes.object,
  segmentService: PropTypes.object,
  setSnapshotImage: PropTypes.func.isRequired,
  snapshotImage: PropTypes.string,
  appendLog: PropTypes.func.isRequired,
  map: PropTypes.object,
  vectorLayer: PropTypes.object,
  addTileLayer: PropTypes.func,
  channelNames: PropTypes.object,
  onClose: PropTypes.func.isRequired,
};

export default ControlPanel;