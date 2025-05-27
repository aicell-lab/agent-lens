import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import ControlButton from './ControlButton';
import CameraSettings from './CameraSettings';
import ChatbotButton from './ChatbotButton';
import SampleSelector from './SampleSelector';

const MicroscopeControlPanel = ({
  map,
  setSnapshotImage,
  snapshotImage,
  microscopeControlService,
  segmentService,
  appendLog,
  addTileLayer,
  channelNames,
  vectorLayer,
  onClose,
  selectedMicroscopeId,
  incubatorControlService,
  roboticArmService,
  currentOperation,
  setCurrentOperation,
}) => {
  const [isLightOn, setIsLightOn] = useState(false);
  const [xPosition, setXPosition] = useState(0);
  const [yPosition, setYPosition] = useState(0);
  const [zPosition, setZPosition] = useState(0);
  const [xMove, setXMove] = useState(1);
  const [yMove, setYMove] = useState(1);
  const [zMove, setZMove] = useState(0.1);
  const [microscopeBusy, setMicroscopeBusy] = useState(false);

  // State for SampleSelector dropdown
  const [isSampleSelectorOpen, setIsSampleSelectorOpen] = useState(false);

  // Renamed states for actual values from microscope (for display)
  const [actualIlluminationIntensity, setActualIlluminationIntensity] = useState(50);
  const [actualCameraExposure, setActualCameraExposure] = useState(100);

  // New states for user's desired values (for input controls)
  const [desiredIlluminationIntensity, setDesiredIlluminationIntensity] = useState(50);
  const [desiredCameraExposure, setDesiredCameraExposure] = useState(100);

  const [illuminationChannel, setIlluminationChannel] = useState("0");
  const [isLiveView, setIsLiveView] = useState(false);
  const canvasRef = useRef(null);

  // State for collapsing the right panel
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  // Refs to hold the latest actual values for use in debounced effects
  const actualIlluminationIntensityRef = useRef(actualIlluminationIntensity);
  const actualCameraExposureRef = useRef(actualCameraExposure);

  useEffect(() => {
    actualIlluminationIntensityRef.current = actualIlluminationIntensity;
  }, [actualIlluminationIntensity]);

  useEffect(() => {
    actualCameraExposureRef.current = actualCameraExposure;
  }, [actualCameraExposure]);

  const fetchStatusAndUpdateActuals = async () => {
    if (!microscopeControlService) {
      return { intensity: actualIlluminationIntensity, exposure: actualCameraExposure }; // Return current actuals if no service
    }
    try {
      const status = await microscopeControlService.get_status();
      setXPosition(status.current_x);
      setYPosition(status.current_y);
      setZPosition(status.current_z);
      setIsLightOn(status.is_illumination_on);

      let fetchedIntensity = actualIlluminationIntensity;
      let fetchedExposure = actualCameraExposure;

      let intensityExposurePair;
      switch (illuminationChannel) {
        case "0": intensityExposurePair = status.BF_intensity_exposure; break;
        case "11": intensityExposurePair = status.F405_intensity_exposure; break;
        case "12": intensityExposurePair = status.F488_intensity_exposure; break;
        case "14": intensityExposurePair = status.F561_intensity_exposure; break;
        case "13": intensityExposurePair = status.F638_intensity_exposure; break;
        case "15": intensityExposurePair = status.F730_intensity_exposure; break;
        default:
          console.warn(`[MicroscopeControlPanel] Unknown illumination channel in fetchStatus: ${illuminationChannel}`);
          intensityExposurePair = [actualIlluminationIntensity, actualCameraExposure]; // Fallback to current actuals
      }

      if (intensityExposurePair && intensityExposurePair.length === 2) {
        fetchedIntensity = intensityExposurePair[0];
        fetchedExposure = intensityExposurePair[1];
        setActualIlluminationIntensity(fetchedIntensity);
        setActualCameraExposure(fetchedExposure);
      } else {
        console.warn(`[MicroscopeControlPanel] Could not find or parse intensity/exposure for channel ${illuminationChannel} from status:`, status);
      }
      return { intensity: fetchedIntensity, exposure: fetchedExposure };
    } catch (error) {
      appendLog(`Failed to fetch status: ${error.message}`);
      console.error("[MicroscopeControlPanel] Failed to fetch status:", error);
      return { intensity: actualIlluminationIntensity, exposure: actualCameraExposure }; // Return current actuals on error
    }
  };

  useEffect(() => {
    if (microscopeControlService) {
      const initAndSyncValues = async () => {
        const { intensity, exposure } = await fetchStatusAndUpdateActuals(); // Fetches and updates actuals, returns values
        // Sync desired values with the freshly fetched actual values
        setDesiredIlluminationIntensity(intensity);
        setDesiredCameraExposure(exposure);
      };
      initAndSyncValues();

      // Periodic fetch only updates actuals
      const interval = setInterval(fetchStatusAndUpdateActuals, 1000);
      return () => clearInterval(interval);
    }
  }, [microscopeControlService, illuminationChannel]); // Re-run if service or channel changes to re-sync

  // Effect to update illumination when desiredIlluminationIntensity or illuminationChannel changes
  useEffect(() => {
    if (!microscopeControlService) return;

    const handler = setTimeout(async () => {
      try {
        setMicroscopeBusy(true);
        appendLog(`Setting illumination (debounced) to channel ${illuminationChannel}, intensity ${desiredIlluminationIntensity}%`);
        await microscopeControlService.set_illumination(parseInt(illuminationChannel, 10), desiredIlluminationIntensity);
        await fetchStatusAndUpdateActuals(); // Update UI after successful set
        appendLog('Illumination updated successfully (debounced).');
      } catch (error) {
        appendLog(`Error setting illumination (debounced): ${error.message}`);
        console.error("[MicroscopeControlPanel] Error setting illumination (debounced):", error);
      } finally {
        setMicroscopeBusy(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [desiredIlluminationIntensity, illuminationChannel, microscopeControlService, appendLog]);
  
  // Effect to update camera exposure when desiredCameraExposure or illuminationChannel changes
  useEffect(() => {
    if (!microscopeControlService) return;

    const handler = setTimeout(async () => {
      try {
        setMicroscopeBusy(true);
        appendLog(`Setting camera exposure (debounced) for channel ${illuminationChannel} to ${desiredCameraExposure}ms`);
        await microscopeControlService.set_camera_exposure(parseInt(illuminationChannel, 10), desiredCameraExposure);
        await fetchStatusAndUpdateActuals(); // Update UI after successful set
        appendLog('Camera exposure updated successfully (debounced).');
      } catch (error) {
        appendLog(`Error setting camera exposure (debounced): ${error.message}`);
        console.error("[MicroscopeControlPanel] Error setting camera exposure (debounced):", error);
      } finally {
        setMicroscopeBusy(false);
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [desiredCameraExposure, illuminationChannel, microscopeControlService, appendLog]);

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
          // Only capture new frames if the microscope is not busy with other operations
          if (!microscopeBusy && microscopeControlService) {
            // Use DESIRED values for live view frames
            const base64Image = await microscopeControlService.one_new_frame();
            setSnapshotImage(`data:image/png;base64,${base64Image}`);
          }
        } catch (error) {
          appendLog(`Error in live view: ${error.message}`);
        }
      }, 2000); // Consider making interval dependent on desiredCameraExposure
    } else if (liveViewInterval) {
      clearInterval(liveViewInterval);
    }
    return () => clearInterval(liveViewInterval);
  }, [isLiveView, microscopeControlService, microscopeBusy, appendLog]);

  const moveMicroscope = async (direction, multiplier) => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
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
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const moveToPosition = async () => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
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
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const snapImage = async () => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
      appendLog('Snapping image...');

      if (isLiveView) {
        stopLiveView(); // Terminate live view first
        // Give a moment for live view to fully stop before snapping
        await new Promise(resolve => setTimeout(resolve, 100)); 
      }
      
      const base64Image = await microscopeControlService.one_new_frame();
      console.log('Received base64 image data of length:', base64Image.length);
      setSnapshotImage(`data:image/png;base64,${base64Image}`);
      appendLog('Image snapped and fetched successfully.');
    } catch (error) {
      console.error('Error in snapImage:', error);
      appendLog(`Error in snapImage: ${error.message}`);
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const contrastAutoFocus = async () => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
      appendLog('Performing contrast autofocus...');
      await microscopeControlService.auto_focus();
    } catch (error) {
      appendLog(`Error in contrast autofocus: ${error.message}`);
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const laserAutoFocus = async () => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
      appendLog('Performing laser autofocus...');
      await microscopeControlService.do_laser_autofocus();
    } catch (error) {
      appendLog(`Error in laser autofocus: ${error.message}`);
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const toggleLight = async () => {
    if (!microscopeControlService) return;
    try {
      setMicroscopeBusy(true);
      if (!isLightOn) {
        appendLog('Light turned on.');
      } else {
        appendLog('Light turned off.');
      }
      setIsLightOn(!isLightOn);
    } catch (error) {
      appendLog(`Error toggling light: ${error.message}`);
    } finally {
      setMicroscopeBusy(false);
    }
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

  // Toggle for SampleSelector dropdown
  const toggleSampleSelector = () => {
    setIsSampleSelectorOpen(!isSampleSelectorOpen);
  };

  const toggleRightPanel = () => {
    setIsRightPanelCollapsed(!isRightPanelCollapsed);
  };

  return (
    <div className="microscope-control-panel-container new-mcp-layout bg-white bg-opacity-95 p-4 rounded-lg shadow-lg border-l border-gray-300 box-border">
      {/* Left Side: Image Display */}
      <div className={`mcp-image-display-area ${isRightPanelCollapsed ? 'expanded' : ''}`}>
        <div
          id="image-display"
          className={`w-full border ${
            snapshotImage ? 'border-gray-300' : 'border-dotted border-gray-400'
          } rounded flex items-center justify-center`}
        >
          {snapshotImage ? (
            <img
              src={snapshotImage}
              alt="Microscope Snapshot"
              className="object-contain w-full h-full"
            />
          ) : (
            <p className="placeholder-text text-center">Image Display</p>
          )}
        </div>
        {/* Toggle button for the right panel */}
        <button 
          onClick={toggleRightPanel}
          className="right-panel-toggle-button"
          title={isRightPanelCollapsed ? "Show Controls" : "Hide Controls"}
        >
          <i className={`fas ${isRightPanelCollapsed ? 'fa-chevron-left' : 'fa-chevron-right'}`}></i>
        </button>
      </div>

      {/* Right Side: Controls and Chatbot */}
      <div className={`mcp-controls-chatbot-area ${isRightPanelCollapsed ? 'collapsed' : ''}`}>
        {/* Top-Right: Microscope Controls */}
        <div className="mcp-microscope-controls-area">
          {/* SampleSelector is moved here for better positioning context of its dropdown */}
          <SampleSelector 
            isVisible={isSampleSelectorOpen}
            selectedMicroscopeId={selectedMicroscopeId}
            microscopeControlService={microscopeControlService}
            incubatorControlService={incubatorControlService}
            roboticArmService={roboticArmService}
            currentOperation={currentOperation}
            setCurrentOperation={setCurrentOperation}
          />

          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center justify-start flex-grow">
              <h3 className="text-lg font-medium mr-3">
                {selectedMicroscopeId === 'squid-control/squid-control-reef' ? 'Simulated Microscope' :
                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 'Real Microscope 1' :
                 selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 'Real Microscope 2' :
                 'Microscope Control'}
              </h3>
              {selectedMicroscopeId && (
                <button 
                  onClick={toggleSampleSelector}
                  className="sample-selector-toggle-button p-1 bg-gray-200 hover:bg-gray-300 rounded shadow text-sm"
                  title="Select or manage samples"
                >
                  <i className="fas fa-flask mr-1"></i>
                  Select Samples
                  <i className={`fas ${isSampleSelectorOpen ? 'fa-chevron-up' : 'fa-chevron-down'} ml-1`}></i>
                </button>
              )}
            </div>
          </div>
          
          <div className="control-group mb-3">
            <div className="horizontal-buttons flex justify-between space-x-1">
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs"
                onClick={toggleLight}
                disabled={!microscopeControlService}
              >
                <i className="fas fa-lightbulb icon mr-1"></i> {isLightOn ? 'Light Off' : 'Light On'}
              </button>
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs"
                onClick={contrastAutoFocus}
                disabled={!microscopeControlService}
              >
                <i className="fas fa-crosshairs icon mr-1"></i> Contrast AF
              </button>
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs"
                onClick={laserAutoFocus}
                disabled={!microscopeControlService}
              >
                <i className="fas fa-bullseye icon mr-1"></i> Laser AF
              </button>
              <button
                className="control-button snap-button bg-green-500 text-white hover:bg-green-600 w-1/5 px-1.5 py-0.5 rounded text-xs"
                onClick={snapImage}
                disabled={!microscopeControlService}
              >
                <i className="fas fa-camera icon mr-1"></i> Snap
              </button>
              <button
                className={`control-button live-button ${isLiveView ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white w-1/5 px-1.5 py-0.5 rounded text-xs`}
                onClick={isLiveView ? stopLiveView : startLiveView}
                disabled={!microscopeControlService}
              >
                <i className="fas fa-video icon mr-1"></i> {isLiveView ? 'Stop' : 'Live'}
              </button>
            </div>
          </div>

          <div className="coordinate-container mb-3 flex justify-between space-x-1">
            {['x', 'y', 'z'].map((axis) => (
              <div key={axis} className="coordinate-group p-1 border border-gray-300 rounded-lg w-1/3">
                <div className="flex justify-between mb-1">
                  <div className="position-display w-1/2 mr-1 bg-gray-100 p-1 rounded flex items-center text-xs">
                    <span className="text-gray-600 font-normal text-xs">{axis.toUpperCase()}:</span>
                    <span className="ml-1 text-gray-800 text-xs">
                      {(axis === 'x' ? xPosition : axis === 'y' ? yPosition : zPosition).toFixed(3)} mm
                    </span>
                  </div>
                  <input
                    type="number"
                    className="control-input w-1/2 p-1 border border-gray-300 rounded text-xs"
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
                <div className="aligned-buttons flex justify-between space-x-1">
                  <button
                    className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 p-1 rounded text-xs"
                    onClick={() => moveMicroscope(axis, -1)}
                    disabled={!microscopeControlService}
                  >
                    <i className={`fas fa-arrow-${axis === 'x' ? 'left' : 'down'} mr-1`}></i> {axis.toUpperCase()}-
                  </button>
                  <button
                    className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 p-1 rounded text-xs"
                    onClick={() => moveMicroscope(axis, 1)}
                    disabled={!microscopeControlService}
                  >
                    {axis.toUpperCase()}+ <i className={`fas fa-arrow-${axis === 'x' ? 'right' : 'up'} ml-1`}></i>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="illumination-camera-container mb-3 flex justify-between space-x-1">
            <div className="illumination-settings p-1 border border-gray-300 rounded-lg w-1/2">
              <div className="illumination-intensity mb-2">
                <div className="intensity-label-row flex justify-between mb-1 text-xs">
                  <label>Illumination Intensity: </label>
                  <span>{actualIlluminationIntensity}%</span>
                </div>
                <input
                  type="range"
                  className="control-input w-full"
                  min="0"
                  max="100"
                  value={desiredIlluminationIntensity}
                  onChange={(e) => {
                    setDesiredIlluminationIntensity(parseInt(e.target.value, 10));
                  }}
                  disabled={microscopeBusy}
                />
              </div>

              <div className="illumination-channel text-xs">
                <label>Illumination Channel:</label>
                <select
                  className="control-input w-full mt-1 p-1 border border-gray-300 rounded text-xs"
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

            <div className="camera-exposure-settings p-1 border border-gray-300 rounded-lg w-1/2 text-xs">
              <label>Camera Exposure:</label>
              <span className="ml-1">{actualCameraExposure} ms</span>
              <input
                type="number"
                className="control-input w-full mt-1 p-1 border border-gray-300 rounded text-xs"
                value={desiredCameraExposure}
                onChange={(e) => setDesiredCameraExposure(parseInt(e.target.value, 10))}
              />
            </div>
          </div>
        </div>

        {/* Bottom-Right: Chatbot */}
        <div className="mcp-chatbot-area">
          <ChatbotButton 
            key={selectedMicroscopeId}
            microscopeControlService={microscopeControlService} 
            appendLog={appendLog} 
          />
        </div>
      </div>
    </div>
  );
};

MicroscopeControlPanel.propTypes = {
  microscopeControlService: PropTypes.object,
  segmentService: PropTypes.object,
  setSnapshotImage: PropTypes.func.isRequired,
  snapshotImage: PropTypes.string,
  appendLog: PropTypes.func.isRequired,
  map: PropTypes.object,
  vectorLayer: PropTypes.object,
  addTileLayer: PropTypes.func,
  channelNames: PropTypes.object,
  selectedMicroscopeId: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  incubatorControlService: PropTypes.object,
  roboticArmService: PropTypes.object,
  currentOperation: PropTypes.string,
  setCurrentOperation: PropTypes.func,
};

export default MicroscopeControlPanel; 