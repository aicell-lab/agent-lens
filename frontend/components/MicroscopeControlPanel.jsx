import React, { useState, useRef, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import ControlButton from './ControlButton';
import CameraSettings from './CameraSettings';
import ChatbotButton from './ChatbotButton';
import SampleSelector from './SampleSelector';
import ImagingTasksModal from './ImagingTasksModal';
import './ImagingTasksModal.css'; // Added for well plate styles

// Helper function to convert a uint8 hypha-rpc numpy array to a displayable Data URL
const numpyArrayToDataURL = (numpyArray) => {
  if (!numpyArray || !numpyArray._rvalue) {
    console.error("Invalid numpy array object received:", numpyArray);
    return null;
  }
  const { _rvalue: buffer, _rshape: shape, _rdtype: dtype } = numpyArray;
  
  if (dtype !== 'uint8') {
    console.error(`Expected dtype uint8 but received: ${dtype}. Cannot process.`);
    return null; // Or handle appropriately
  }

  const height = shape[0];
  const width = shape[1];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data; // This is a Uint8ClampedArray

  const pixels = new Uint8Array(buffer);

  // Directly map the grayscale uint8 pixels to RGBA
  for (let i = 0; i < pixels.length; i++) {
    const pixelValue = pixels[i];
    data[i * 4] = pixelValue;     // R
    data[i * 4 + 1] = pixelValue; // G
    data[i * 4 + 2] = pixelValue; // B
    data[i * 4 + 3] = 255;        // A (fully opaque)
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

const WEBRTC_SERVICE_IDS = {
  "agent-lens/squid-control-reef": "agent-lens/video-track-squid-control-reef",
  "reef-imaging/mirror-microscope-control-squid-1": "reef-imaging/video-track-microscope-control-squid-1",
  "reef-imaging/mirror-microscope-control-squid-2": "reef-imaging/video-track-microscope-control-squid-2", // Assuming typo correction
};

// Define well plate configurations
const WELL_PLATE_CONFIGS = {
  '96': { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], cols: Array.from({ length: 12 }, (_, i) => i + 1) },
  '48': { rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: Array.from({ length: 8 }, (_, i) => i + 1) },
  '24': { rows: ['A', 'B', 'C', 'D'], cols: Array.from({ length: 6 }, (_, i) => i + 1) },
};

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
  hyphaManager, // Changed from hyphaServer and hyphaAuthToken
  showNotification = null, // New prop for showing notifications
  orchestratorManagerService, // New prop for orchestrator service
  onOpenImageJ = null, // New prop for opening image in ImageJ
  imjoyApi = null, // New prop for ImJoy API
}) => {
  const [isLightOn, setIsLightOn] = useState(false);
  const [xPosition, setXPosition] = useState(0);
  const [yPosition, setYPosition] = useState(0);
  const [zPosition, setZPosition] = useState(0);
  const [xMove, setXMove] = useState(0.1);
  const [yMove, setYMove] = useState(0.1);
  const [zMove, setZMove] = useState(0.01);
  const [microscopeBusy, setMicroscopeBusy] = useState(false);

  // String states for input fields to allow smooth float input
  const [xMoveStr, setXMoveStr] = useState(xMove.toString());
  const [yMoveStr, setYMoveStr] = useState(yMove.toString());
  const [zMoveStr, setZMoveStr] = useState(zMove.toString());

  // State for the snapped image, storing both raw numpy and display URL
  const [snappedImageData, setSnappedImageData] = useState({
    numpy: null,
    url: null,
  });

  // State for SampleSelector dropdown
  const [isSampleSelectorOpen, setIsSampleSelectorOpen] = useState(false);

  // Microscope configuration states
  const [microscopeConfiguration, setMicroscopeConfiguration] = useState(null);
  const [isConfigurationLoaded, setIsConfigurationLoaded] = useState(false);
  const [isConfigurationLoading, setIsConfigurationLoading] = useState(false);
  const [configurationError, setConfigurationError] = useState(null);
  const [isConfigurationWindowOpen, setIsConfigurationWindowOpen] = useState(false);

  // Well Plate Navigator State
  const [selectedWellPlateType, setSelectedWellPlateType] = useState('96');
  const [currentWellPlateRows, setCurrentWellPlateRows] = useState(WELL_PLATE_CONFIGS['96'].rows);
  const [currentWellPlateCols, setCurrentWellPlateCols] = useState(WELL_PLATE_CONFIGS['96'].cols);
  const [isWellPlateNavigatorOpen, setIsWellPlateNavigatorOpen] = useState(false); // Changed default to false

  // Renamed states for actual values from microscope (for display)
  const [actualIlluminationIntensity, setActualIlluminationIntensity] = useState(50);
  const [actualCameraExposure, setActualCameraExposure] = useState(100);

  // New states for user's desired values (for input controls)
  const [desiredIlluminationIntensity, setDesiredIlluminationIntensity] = useState(50);
  const [desiredCameraExposure, setDesiredCameraExposure] = useState(100);

  const [illuminationChannel, setIlluminationChannel] = useState("0");
  const canvasRef = useRef(null);
  const videoRef = useRef(null);

  // Ref to track if the illumination channel change was initiated by the UI
  const channelSetByUIFlagRef = useRef(false);

  // WebRTC State
  const [isWebRtcActive, setIsWebRtcActive] = useState(false);
  const [webRtcPc, setWebRtcPc] = useState(null);
  const [webRtcError, setWebRtcError] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null); // State for the incoming WebRTC stream

  // State for collapsing the right panel - THIS WAS ACCIDENTALLY REMOVED, ADDING IT BACK
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  // New state for video contrast adjustment
  const [videoContrastMin, setVideoContrastMin] = useState(0);
  const [videoContrastMax, setVideoContrastMax] = useState(255);
  const [autoContrastEnabled, setAutoContrastEnabled] = useState(false);
  const autoContrastEnabledRef = useRef(autoContrastEnabled);
  
  // Auto-contrast adjustment parameters
  const [autoContrastMinAdjust, setAutoContrastMinAdjust] = useState(-60); // P5 - 30
  const [autoContrastMaxAdjust, setAutoContrastMaxAdjust] = useState(60);  // P95 + 30
  const autoContrastMinAdjustRef = useRef(autoContrastMinAdjust);
  const autoContrastMaxAdjustRef = useRef(autoContrastMaxAdjust);

  // Refs to hold the latest actual values for use in debounced effects
  const actualIlluminationIntensityRef = useRef(actualIlluminationIntensity);
  const actualCameraExposureRef = useRef(actualCameraExposure);

  // New states for imaging tasks
  const [imagingTasks, setImagingTasks] = useState([]);
  const [isImagingModalOpen, setIsImagingModalOpen] = useState(false);
  const [selectedTaskForModal, setSelectedTaskForModal] = useState(null);

  // State to track sample loading status from SampleSelector
  const [sampleLoadStatus, setSampleLoadStatus] = useState({
    isSampleLoaded: false,
    loadedSampleOnMicroscope: null,
    selectedSampleId: null,
    isRealMicroscope: false,
    isSimulatedMicroscope: false
  });

  // WebRTC DataChannel states for metadata
  const [metadataDataChannel, setMetadataDataChannel] = useState(null);
  const [frameMetadata, setFrameMetadata] = useState(null);
  const [isDataChannelConnected, setIsDataChannelConnected] = useState(false);

  // Callback to receive sample load status updates from SampleSelector
  const handleSampleLoadStatusChange = useCallback((status) => {
    setSampleLoadStatus(status);
  }, []);

  useEffect(() => {
    actualIlluminationIntensityRef.current = actualIlluminationIntensity;
  }, [actualIlluminationIntensity]);

  useEffect(() => {
    actualCameraExposureRef.current = actualCameraExposure;
  }, [actualCameraExposure]);

  // Keep autoContrastEnabledRef in sync with state
  useEffect(() => {
    autoContrastEnabledRef.current = autoContrastEnabled;
  }, [autoContrastEnabled]);

  // Keep adjustment parameter refs in sync with state
  useEffect(() => {
    autoContrastMinAdjustRef.current = autoContrastMinAdjust;
  }, [autoContrastMinAdjust]);

  useEffect(() => {
    autoContrastMaxAdjustRef.current = autoContrastMaxAdjust;
  }, [autoContrastMaxAdjust]);

  // Memoized function to stop the WebRTC stream
  const memoizedStopWebRtcStream = useCallback(() => {
    if (!isWebRtcActive && !webRtcPc) {
      // appendLog('memoizedStopWebRtcStream: called but stream already inactive.'); // Optional debug
      return;
    }
    appendLog('Stopping WebRTC stream...');
    if (webRtcPc) {
      webRtcPc.close();
      setWebRtcPc(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebRtcActive(false);
    setRemoteStream(null);
    setMetadataDataChannel(null);
    setIsDataChannelConnected(false);
    setFrameMetadata(null);
    appendLog('WebRTC stream stopped.');
  }, [appendLog, isWebRtcActive, webRtcPc]);

  // Helper function to get intensity/exposure pair from status object
  const getIntensityExposurePairFromStatus = (status, channel) => {
    if (!status || channel === null || channel === undefined) return null;
    switch (channel.toString()) {
      case "0": return status.BF_intensity_exposure;
      case "11": return status.F405_intensity_exposure;
      case "12": return status.F488_intensity_exposure;
      case "14": return status.F561_intensity_exposure;
      case "13": return status.F638_intensity_exposure;
      case "15": return status.F730_intensity_exposure;
      default: return null;
    }
  };

  const fetchStatusAndUpdateActuals = async () => {
    if (!microscopeControlService) {
      // Return current desired values if no service, as initAndSyncValues uses these to set desired states
      return { intensity: desiredIlluminationIntensity, exposure: desiredCameraExposure };
    }
    try {
      const status = await microscopeControlService.get_status();
      setXPosition(status.current_x);
      setYPosition(status.current_y);
      setZPosition(status.current_z);
      setIsLightOn(status.is_illumination_on);

      const hardwareChannel = status.current_channel?.toString();

      // If a UI-initiated channel change is NOT pending, and hardware channel differs from UI, sync UI.
      if (hardwareChannel && !channelSetByUIFlagRef.current && illuminationChannel !== hardwareChannel) {
        setIlluminationChannel(hardwareChannel);
      }

      // Update "Actual" display values based on the true hardware channel
      let actualIntensityForDisplay = actualIlluminationIntensity; // Default to current state
      let actualExposureForDisplay = actualCameraExposure;   // Default to current state
      if (hardwareChannel) {
        const pair = getIntensityExposurePairFromStatus(status, hardwareChannel);
        if (pair) {
          actualIntensityForDisplay = pair[0];
          actualExposureForDisplay = pair[1];
        }
      }
      setActualIlluminationIntensity(actualIntensityForDisplay);
      setActualCameraExposure(actualExposureForDisplay);

      // For returning values to sync "Desired" inputs (via initAndSyncValues):
      // Use the current `illuminationChannel` state (UI's perspective).
      let intensityForDesiredSync = actualIntensityForDisplay; // Fallback to hardware actuals
      let exposureForDesiredSync = actualExposureForDisplay;   // Fallback

      const pairForUIScheduledChannel = getIntensityExposurePairFromStatus(status, illuminationChannel);
      if (pairForUIScheduledChannel) {
        intensityForDesiredSync = pairForUIScheduledChannel[0];
        exposureForDesiredSync = pairForUIScheduledChannel[1];
      }

      return { intensity: intensityForDesiredSync, exposure: exposureForDesiredSync };
    } catch (error) {
      appendLog(`Failed to fetch status: ${error.message}`);
      console.error("[MicroscopeControlPanel] Failed to fetch status:", error);
      // Fallback: return current desired values to avoid them being reset by error
      return { intensity: desiredIlluminationIntensity, exposure: desiredCameraExposure };
    }
  };

  useEffect(() => {
    if (microscopeControlService) {
      const initAndSyncValues = async () => {
        const { intensity, exposure } = await fetchStatusAndUpdateActuals(); // Fetches and updates actuals, returns values
        setDesiredIlluminationIntensity(intensity);
        setDesiredCameraExposure(exposure);
      };
      initAndSyncValues();

      // Periodic fetch only updates actuals
      const interval = setInterval(fetchStatusAndUpdateActuals, 1000);
      return () => clearInterval(interval);
    }
  }, [microscopeControlService, illuminationChannel]); // Re-run if service or channel changes to re-sync

  // Effect to automatically load microscope configuration when service changes
  useEffect(() => {
    if (microscopeControlService && selectedMicroscopeId) {
      // Reset configuration state when switching microscopes
      setMicroscopeConfiguration(null);
      setIsConfigurationLoaded(false);
      setConfigurationError(null);
      
      // Only auto-load configuration if the current microscope service supports it
      if (typeof microscopeControlService.get_microscope_configuration === 'function') {
        appendLog(`Auto-loading configuration for selected microscope: ${selectedMicroscopeId}`);
        loadMicroscopeConfiguration();
      } else {
        setConfigurationError("Configuration not supported for this microscope.");
        appendLog(`Configuration not supported for microscope: ${selectedMicroscopeId}`);
      }
    } else {
      // Clear configuration when no service or microscope selected
      setMicroscopeConfiguration(null);
      setIsConfigurationLoaded(false);
      setConfigurationError("No microscope selected.");
    }
  }, [microscopeControlService, selectedMicroscopeId]);

  // Effect to update illumination when desiredIlluminationIntensity or illuminationChannel changes
  useEffect(() => {
    if (!microscopeControlService) return;

    const handler = setTimeout(async () => {
      try {
        appendLog(`Setting illumination (debounced) to channel ${illuminationChannel}, intensity ${desiredIlluminationIntensity}%`);
        await microscopeControlService.set_illumination(parseInt(illuminationChannel, 10), desiredIlluminationIntensity);
        // fetchStatusAndUpdateActuals will be called in finally
      } catch (error) {
        appendLog(`Error setting illumination (debounced): ${error.message}`);
        console.error("[MicroscopeControlPanel] Error setting illumination (debounced):", error);
      } finally {
        // Crucial: fetch status AFTER the operation, then clear the flag and busy state.
        await fetchStatusAndUpdateActuals();
        channelSetByUIFlagRef.current = false;
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [desiredIlluminationIntensity, illuminationChannel, microscopeControlService, appendLog]);
  
  // Effect to update camera exposure when desiredCameraExposure or illuminationChannel changes
  useEffect(() => {
    if (!microscopeControlService) return;

    const handler = setTimeout(async () => {
      try {
        appendLog(`Setting camera exposure (debounced) for channel ${illuminationChannel} to ${desiredCameraExposure}ms`);
        await microscopeControlService.set_camera_exposure(parseInt(illuminationChannel, 10), desiredCameraExposure);
        await fetchStatusAndUpdateActuals(); // Update UI after successful set
        appendLog('Camera exposure updated successfully (debounced).');
      } catch (error) {
        appendLog(`Error setting camera exposure (debounced): ${error.message}`);
        console.error("[MicroscopeControlPanel] Error setting camera exposure (debounced):", error);
      } finally {
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(handler);
  }, [desiredCameraExposure, illuminationChannel, microscopeControlService, appendLog]);

  // Effect to adjust video frame contrast
  useEffect(() => {
    if (!microscopeControlService || !isWebRtcActive) return;

    // Basic validation to ensure min is not greater than max
    if (videoContrastMin >= videoContrastMax) {
      return;
    }

    const handler = setTimeout(async () => {
      try {
        appendLog(`Adjusting video contrast: min=${videoContrastMin}, max=${videoContrastMax}`);
        await microscopeControlService.adjust_video_frame(videoContrastMin, videoContrastMax);
        appendLog('Video contrast adjusted successfully.');
      } catch (error) {
        appendLog(`Error adjusting video contrast: ${error.message}`);
        console.error("[MicroscopeControlPanel] Error adjusting video contrast:", error);
      }
    }, 200); // 200ms debounce

    return () => clearTimeout(handler);
  }, [videoContrastMin, videoContrastMax, microscopeControlService, isWebRtcActive, appendLog]);

  useEffect(() => {
    if (!snapshotImage || !canvasRef.current || isWebRtcActive) return;

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
  }, [snapshotImage, isWebRtcActive]);

  // WebRTC Streaming Logic
  const startWebRtcStream = async () => {
    if (!hyphaManager) {
      appendLog("WebRTC Error: HyphaManager not available.");
      setWebRtcError("HyphaManager not available.");
      setIsWebRtcActive(false);
      return;
    }

    const fullWebRtcServiceId = WEBRTC_SERVICE_IDS[selectedMicroscopeId];
    if (!selectedMicroscopeId || !fullWebRtcServiceId) {
      appendLog(`WebRTC Error: No WebRTC service ID configured for ${selectedMicroscopeId}`);
      setWebRtcError(`No WebRTC service ID configured for ${selectedMicroscopeId}`);
      setIsWebRtcActive(false);
      return;
    }

    const serviceIdParts = fullWebRtcServiceId.split('/');
    const targetWorkspace = serviceIdParts.length > 1 ? serviceIdParts[0] : null; // Infer workspace
    const simpleWebRtcServiceName = serviceIdParts.length > 1 ? serviceIdParts[serviceIdParts.length - 1] : serviceIdParts[0];

    if (!targetWorkspace) {
        appendLog(`WebRTC Error: Could not determine workspace from WebRTC service ID ${fullWebRtcServiceId}`);
        setWebRtcError(`Could not determine workspace for ${fullWebRtcServiceId}`);
        setIsWebRtcActive(false);
        return;
    }

    appendLog(`Starting WebRTC stream for ${selectedMicroscopeId} (Target Workspace: ${targetWorkspace}, Service: ${simpleWebRtcServiceName})...`);
    setWebRtcError(null);
    setMicroscopeBusy(true);

    try {
      // Get server for the target workspace from the manager
      const serverForRtc = await hyphaManager.getServer(targetWorkspace);
      if (!serverForRtc) {
        throw new Error(`Failed to get server for workspace ${targetWorkspace} from HyphaManager.`);
      }
      appendLog(`Got Hypha server for WebRTC workspace: ${targetWorkspace}`);

      let iceServers = [{ "urls": ["stun:stun.l.google.com:19302"] }];
      try {
        const response = await fetch('https://ai.imjoy.io/public/services/coturn/get_rtc_ice_servers');
        if (response.ok) {
          iceServers = await response.json();
          appendLog('Fetched ICE servers successfully.');
        } else {
          appendLog('Failed to fetch ICE servers, using fallback STUN server.');
          }
        } catch (error) {
        appendLog(`Error fetching ICE servers: ${error.message}. Using fallback STUN server.`);
      }

      const pc = await window.hyphaWebsocketClient.getRTCService(
        serverForRtc, // Use the server from HyphaManager
        fullWebRtcServiceId, // Use full service ID instead of simple name
        {
          ice_servers: iceServers,
          on_init: async (peerConnection) => {
            appendLog('WebRTC peer connection initialized by client.');
            
            peerConnection.addEventListener('track', (evt) => {
              appendLog(`WebRTC track received: ${evt.track.kind}, ID: ${evt.track.id}, Stream IDs: ${evt.streams.map(s => s.id).join(', ')}`);
              if (evt.track.kind === 'video') {
                if (evt.streams && evt.streams[0]) {
                  appendLog(`Setting remote video stream (ID: ${evt.streams[0].id}) to state.`);
                  setRemoteStream(evt.streams[0]);
                } else {
                  appendLog('Video track received, but no associated stream. Creating new stream.');
                  const newStream = new MediaStream();
                  newStream.addTrack(evt.track);
                  setRemoteStream(newStream);
                }
              }
            });

            // Set up data channel listener for metadata
            peerConnection.addEventListener('datachannel', (event) => {
              const dataChannel = event.channel;
              appendLog(`WebRTC data channel received: ${dataChannel.label}`);
              
              if (dataChannel.label === 'metadata') {
                appendLog('Setting up metadata data channel...');
                setMetadataDataChannel(dataChannel);
                
                dataChannel.addEventListener('open', () => {
                  appendLog('Metadata data channel opened');
                  setIsDataChannelConnected(true);
                });
                
                dataChannel.addEventListener('message', (event) => {
                  try {
                    const metadata = JSON.parse(event.data);
                    console.log('Received metadata via data channel:', metadata);
                    setFrameMetadata(metadata);
                    
                    // Auto-adjust contrast range if enabled (use refs to get current values)
                    if (autoContrastEnabledRef.current && metadata.gray_level_stats) {
                      const stats = metadata.gray_level_stats;
                      // Auto-adjust contrast range based on percentiles with user adjustments
                      if (stats.percentiles) {
                        const p5Value = (stats.percentiles.p5 || 0) * 255 / 100;
                        const p95Value = (stats.percentiles.p95 || 100) * 255 / 100;
                        
                        const currentMinAdjust = autoContrastMinAdjustRef.current;
                        const currentMaxAdjust = autoContrastMaxAdjustRef.current;
                        
                        const newMin = Math.round(p5Value + currentMinAdjust);
                        const newMax = Math.round(p95Value + currentMaxAdjust);
                        
                        setVideoContrastMin(Math.max(0, Math.min(254, newMin)));
                        setVideoContrastMax(Math.min(255, Math.max(1, newMax)));
                        console.log(`Auto-contrast updated: Min=${newMin} (P5${currentMinAdjust >= 0 ? '+' : ''}${currentMinAdjust}), Max=${newMax} (P95${currentMaxAdjust >= 0 ? '+' : ''}${currentMaxAdjust})`);
                      }
                    }
                    
                  } catch (error) {
                    appendLog(`Error parsing metadata: ${error.message}`);
                    console.error('Error parsing metadata from data channel:', error);
                  }
                });
                
                dataChannel.addEventListener('close', () => {
                  appendLog('Metadata data channel closed');
                  setIsDataChannelConnected(false);
                  setMetadataDataChannel(null);
                });
                
                dataChannel.addEventListener('error', (error) => {
                  appendLog(`Metadata data channel error: ${error}`);
                  console.error('Metadata data channel error:', error);
                });
              }
            });

            peerConnection.addEventListener('connectionstatechange', () => {
              appendLog(`WebRTC connection state: ${peerConnection.connectionState}`);
              if (['closed', 'failed', 'disconnected'].includes(peerConnection.connectionState)) {
                appendLog('WebRTC connection closed or failed. Stopping stream.');
                // Calling stopWebRtcStream directly here can cause issues if pc is not yet set in state
                // Consider a more robust state management or event for this
                if(webRtcPc || pc) { // Check if pc is available from closure or state
                    (webRtcPc || pc).close();
                }
                setIsWebRtcActive(false); 
                if (videoRef.current) videoRef.current.srcObject = null;
              }
            });

            // Send a dummy track to the server to trigger its on_track handler
            try {
              appendLog('Attempting to send a dummy track to the server...');
              const dummyCanvas = document.createElement('canvas');
              dummyCanvas.width = 100;
              dummyCanvas.height = 100;
              const ctx = dummyCanvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.01)'; // Make it nearly transparent
                ctx.fillRect(0, 0, 1, 1); // Draw a tiny dot to ensure stream has data
              }
              const dummyStream = dummyCanvas.captureStream(1); // 1 frame per second
              for (const track of dummyStream.getVideoTracks()) {
                if (peerConnection.signalingState !== 'closed') {
                    appendLog(`Adding dummy video track: ${track.label}`);
                    peerConnection.addTrack(track, dummyStream);
                } else {
                    appendLog('Peer connection closed before dummy track could be added.');
                    break;
                }
              }
              appendLog('Dummy track sending process initiated.');
            } catch (e) {
              appendLog(`Error sending dummy track: ${e.message}`);
              console.error("Error sending dummy track:", e);
            }
          },
        }
      );
      
      setWebRtcPc(pc); // Set pc state first

      // After RTC service is obtained, get the actual microscope service through it
      try {
        appendLog(`Attempting to get microscope service '${selectedMicroscopeId}' via WebRTC PC.`);
        const remoteMicroscopeService = await pc.getService(selectedMicroscopeId);
                  if (remoteMicroscopeService) {
            appendLog(`Successfully got microscope service '${selectedMicroscopeId}' via WebRTC. API:`);
            // You can store remoteMicroscopeService in a state if you need to call its methods
            // For now, just logging its presence.
            console.log(await remoteMicroscopeService.api());
          } else {
            appendLog(`Failed to get microscope service '${selectedMicroscopeId}' via WebRTC. Service was null.`);
          }
        } catch (error) {
          appendLog(`Error getting microscope service '${selectedMicroscopeId}' via WebRTC: ${error.message}`);
          console.error(`Error getting microscope service '${selectedMicroscopeId}' via WebRTC:`, error);
      }

      setIsWebRtcActive(true);
      appendLog('WebRTC stream setup process completed.');
    } catch (error) {
      appendLog(`Error starting WebRTC stream: ${error.message}`);
      console.error("[MicroscopeControlPanel] Error starting WebRTC stream:", error);
      setWebRtcError(error.message);
      setIsWebRtcActive(false);
      if (webRtcPc) { 
        webRtcPc.close();
        setWebRtcPc(null);
      } else if (pc && typeof pc.close === 'function') { 
        pc.close();
      }
      // Show notification for permission errors
      if (showNotification && error.message && error.message.includes('Permission denied for workspace')) {
        showNotification(error.message, 'error');
      }
      // No need to manually disconnect serverForRtc, manager handles it
    } finally {
      setMicroscopeBusy(false);
    }
  };

  const stopWebRtcStream = memoizedStopWebRtcStream;

  const toggleWebRtcStream = () => {
    if (isWebRtcActive) {
      memoizedStopWebRtcStream();
    } else {
      // Clear previous snapshot when starting live view for a cleaner display
      setSnapshotImage(null); 
      startWebRtcStream();
    }
  };
  
  // Effect for cleaning up WebRTC connection on ID change or component unmount
  useEffect(() => {
    // This effect returns a cleanup function that will be called when:
    return () => {
      // Check `isWebRtcActive` from the closure of the render that defined this cleanup.
      if (isWebRtcActive) {
        appendLog(`Auto-stopping WebRTC stream for ${selectedMicroscopeId} (ID change/unmount).`);
        memoizedStopWebRtcStream();
      }
    };
  }, [selectedMicroscopeId, isWebRtcActive, memoizedStopWebRtcStream, appendLog]);

  // Effect to attach remote stream to video element when available
  useEffect(() => {
    if (isWebRtcActive && remoteStream && videoRef.current) {
      appendLog('Attaching remote stream to video element and attempting to play.');
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch(error => {
        appendLog(`Error playing video: ${error.message}`);
        console.error("Error attempting to play video:", error);
      });
    } else if (!isWebRtcActive && videoRef.current) {
        videoRef.current.srcObject = null; // Ensure srcObject is cleared when not active
    }
  }, [isWebRtcActive, remoteStream]); // videoRef.current is not a reactive dependency

  // Effect to stop WebRTC stream if a sample operation starts
  useEffect(() => {
    if (currentOperation && isWebRtcActive) {
      // Handle both string operations (from SampleSelector) and object operations (from well navigation)
      if (typeof currentOperation === 'string') {
        // String operations like 'loading' and 'unloading' from SampleSelector should stop WebRTC
        if (currentOperation === 'loading' || currentOperation === 'unloading') {
          appendLog(`Sample operation '${currentOperation}' started, stopping WebRTC stream.`);
          memoizedStopWebRtcStream();
        }
      } else if (currentOperation.id && !currentOperation.id.startsWith('navigate_well_')) {
        // Object operations that are not well navigation should stop WebRTC
        appendLog(`Operation '${currentOperation.name}' started, stopping WebRTC stream.`);
        memoizedStopWebRtcStream();
      } else if (currentOperation.id && currentOperation.id.startsWith('navigate_well_')) {
        appendLog(`Navigating to well ('${currentOperation.name}'), WebRTC stream will remain active.`);
      }
    }
  }, [currentOperation, isWebRtcActive, memoizedStopWebRtcStream, appendLog]);

  // Effect to immediately apply auto-adjustment when toggle is turned on
  useEffect(() => {
    if (autoContrastEnabled && frameMetadata && frameMetadata.gray_level_stats) {
      const stats = frameMetadata.gray_level_stats;
      // Auto-adjust contrast range based on percentiles with user adjustments
      if (stats.percentiles) {
        const p5Value = (stats.percentiles.p5 || 0) * 255 / 100;
        const p95Value = (stats.percentiles.p95 || 100) * 255 / 100;
        
        const newMin = Math.round(p5Value + autoContrastMinAdjust);
        const newMax = Math.round(p95Value + autoContrastMaxAdjust);
        
        setVideoContrastMin(Math.max(0, Math.min(254, newMin)));
        setVideoContrastMax(Math.min(255, Math.max(1, newMax)));
        appendLog(`Auto-contrast applied: Min=${newMin} (P5${autoContrastMinAdjust >= 0 ? '+' : ''}${autoContrastMinAdjust}), Max=${newMax} (P95${autoContrastMaxAdjust >= 0 ? '+' : ''}${autoContrastMaxAdjust})`);
      }
    }
  }, [autoContrastEnabled, autoContrastMinAdjust, autoContrastMaxAdjust]); // Trigger when toggle or adjustments change

  // Helper function to render histogram display
  const renderHistogramDisplay = () => {
    if (!frameMetadata || !frameMetadata.gray_level_stats || !frameMetadata.gray_level_stats.histogram) {
      return null;
    }

    const histogram = frameMetadata.gray_level_stats.histogram;
    const counts = histogram.counts || [];
    const binEdges = histogram.bin_edges || [];
    
    if (counts.length === 0) return null;

    const maxCount = Math.max(...counts);
    const histogramWidth = 256; // Fixed width for display
    const histogramHeight = 60;
    
    return (
      <div className="histogram-display" style={{ position: 'relative', width: '100%', height: `${histogramHeight}px`, backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px' }}>
        <svg width="100%" height={histogramHeight} style={{ display: 'block' }}>
          {counts.map((count, index) => {
            const x = (index / counts.length) * 100; // Convert to percentage
            const height = (count / maxCount) * (histogramHeight - 4); // 4px padding
            const binStart = binEdges[index] || (index * 255 / counts.length);
            const binEnd = binEdges[index + 1] || ((index + 1) * 255 / counts.length);
            const binCenter = (binStart + binEnd) / 2;
            
            return (
              <rect
                key={index}
                x={`${x}%`}
                y={histogramHeight - height - 2}
                width={`${100 / counts.length}%`}
                height={height}
                fill="#6c757d"
                title={`Bin ${binCenter.toFixed(0)}: ${count} pixels`}
              />
            );
          })}
          
          {/* Contrast range indicators */}
          <line
            x1={`${(videoContrastMin / 255) * 100}%`}
            y1="0"
            x2={`${(videoContrastMin / 255) * 100}%`}
            y2={histogramHeight}
            stroke="#dc3545"
            strokeWidth="2"
            opacity="0.8"
          />
          <line
            x1={`${(videoContrastMax / 255) * 100}%`}
            y1="0"
            x2={`${(videoContrastMax / 255) * 100}%`}
            y2={histogramHeight}
            stroke="#dc3545"
            strokeWidth="2"
            opacity="0.8"
          />
          
          {/* Range fill */}
          <rect
            x={`${(videoContrastMin / 255) * 100}%`}
            y="0"
            width={`${((videoContrastMax - videoContrastMin) / 255) * 100}%`}
            height={histogramHeight}
            fill="#007bff"
            opacity="0.2"
          />
        </svg>
        
        {/* Interactive overlay for dragging */}
        <div 
          style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            cursor: 'crosshair' 
          }}
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const valueAt = Math.round((x / rect.width) * 255);
            
            // Determine which handle is closer
            const distToMin = Math.abs(valueAt - videoContrastMin);
            const distToMax = Math.abs(valueAt - videoContrastMax);
            
            if (distToMin < distToMax) {
              setVideoContrastMin(Math.max(0, Math.min(valueAt, videoContrastMax - 1)));
            } else {
              setVideoContrastMax(Math.min(255, Math.max(valueAt, videoContrastMin + 1)));
            }
          }}
        />
      </div>
    );
  };

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

      if (isWebRtcActive) { // Check if WebRTC is active
        memoizedStopWebRtcStream(); // Terminate WebRTC stream first
        // Give a moment for WebRTC to fully stop before snapping
        await new Promise(resolve => setTimeout(resolve, 200)); 
      }
      
      const numpyImage = await microscopeControlService.one_new_frame();
      console.log('Received numpy image object:', numpyImage);

      const dataURL = numpyArrayToDataURL(numpyImage);
      if (dataURL) {
        // Store both the raw numpy object and the display URL
        setSnappedImageData({ numpy: numpyImage, url: dataURL });
        // Also update the snapshotImage prop for legacy display
        setSnapshotImage(dataURL);
        appendLog('Image snapped and converted successfully.');
      } else {
        appendLog('Failed to convert numpy image to displayable format.');
      }
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

  const setLaserReference = async () => {
    if (!microscopeControlService) {
      appendLog("Set Laser Reference: Microscope service not available.");
      if (showNotification) showNotification("Microscope service not available to set laser reference.", 'warning');
      return;
    }
    try {
      setMicroscopeBusy(true);
      appendLog('Setting laser reference...');
      await microscopeControlService.set_laser_reference(); 
      appendLog('Laser reference set successfully.');
      if (showNotification) showNotification('Laser reference set successfully.', 'success');
    } catch (error) {
      appendLog(`Error setting laser reference: ${error.message}`);
      if (showNotification) showNotification(`Error setting laser reference: ${error.message}`, 'error');
      console.error("[MicroscopeControlPanel] Error setting laser reference:", error);
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

  // Toggle for SampleSelector dropdown
  const toggleSampleSelector = () => {
    setIsSampleSelectorOpen(!isSampleSelectorOpen);
  };

  const toggleRightPanel = () => {
    setIsRightPanelCollapsed(!isRightPanelCollapsed);
  };

  const fetchImagingTasks = useCallback(async () => {
    if (!orchestratorManagerService || !selectedMicroscopeId) {
      setImagingTasks([]);
      // For simulated or unmanaged scopes, ensure task-related busy state is cleared if no service/id.
      if (selectedMicroscopeId === "agent-lens/squid-control-reef" || !orchestratorManagerService) {
        setMicroscopeBusy(false);
      }
      return;
    }

    if (selectedMicroscopeId === "agent-lens/squid-control-reef") {
      appendLog("Time-lapse imaging not supported for simulated microscope.");
      setImagingTasks([]);
      setMicroscopeBusy(false); // Simulated microscope is not busy due to tasks
      return;
    }

    // For real microscopes with orchestrator service
    let activeTaskFoundForThisScope = false;
    try {
      appendLog("Fetching imaging tasks...");
      const tasks = await orchestratorManagerService.get_all_imaging_tasks();
      appendLog(`Fetched ${tasks.length} imaging tasks.`);
      
      // Extract microscope identifier from the full service ID
      const microscopeIdentifier = selectedMicroscopeId.includes('microscope-control-squid') 
        ? `microscope-control-squid-${selectedMicroscopeId.endsWith('1') ? '1' : '2'}`
        : null;
      
      const relevantTasks = tasks.filter(task => 
        task.settings && task.settings.allocated_microscope === microscopeIdentifier
      );
      setImagingTasks(relevantTasks);

      // A task is considered active if its status is anything other than 'completed' or 'failed'
      const activeTask = relevantTasks.find(task => 
        task.operational_state && 
        task.operational_state.status !== "completed" && 
        task.operational_state.status !== "failed" // Add other non-busy terminal states if any
      );

      if (activeTask) {
        activeTaskFoundForThisScope = true;
        appendLog(`Microscope ${selectedMicroscopeId} has an active imaging task: ${activeTask.name}. Status: ${activeTask.operational_state.status}`);
        if (showNotification) {
          showNotification(`Microscope has an unfinished imaging task: ${activeTask.name}. Controls may be limited.`, 'info');
        }
        setMicroscopeBusy(true); // CRITICAL: Set busy if an active task for this scope is found
      } else {
        // If no active task is found for this REAL microscope, it's not busy due to tasks.
        // (Simulated scope and no orchestrator handled at the start of the function)
        if (selectedMicroscopeId !== "agent-lens/squid-control-reef" && orchestratorManagerService) {
            appendLog(`No active imaging tasks found for ${selectedMicroscopeId}. Setting microscope to not busy.`);
            setMicroscopeBusy(false);
        }
      }

    } catch (error) {
      appendLog(`Error fetching imaging tasks: ${error.message}`);
      console.error("[MicroscopeControlPanel] Error fetching imaging tasks:", error);
      setImagingTasks([]);
      // Do not change microscopeBusy state on error, as the actual state is unknown or might be busy from other ops.
    }

  }, [orchestratorManagerService, selectedMicroscopeId, appendLog, showNotification, setMicroscopeBusy]);

  // Effect to fetch imaging tasks
  useEffect(() => {
    fetchImagingTasks();
  }, [fetchImagingTasks]); // Depend on the memoized fetchImagingTasks

  const openImagingTaskModal = (task) => {
    if (selectedMicroscopeId === "agent-lens/squid-control-reef") {
      appendLog("Time-lapse imaging management not supported for simulated microscope.");
      if(showNotification) showNotification("Time-lapse imaging not supported for simulated microscope.", "info");
      return;
    }

    // Check if a sample is already loaded on the microscope
    if (!task && sampleLoadStatus.isSampleLoaded) {
      const warningMessage = sampleLoadStatus.isRealMicroscope 
        ? `The microscope is occupied by a sample (${sampleLoadStatus.loadedSampleOnMicroscope || 'unknown sample'}). Please go to 'Select Samples' and put the sample back to incubator first.`
        : `The simulated microscope has a sample loaded (${sampleLoadStatus.selectedSampleId || 'unknown sample'}). Please go to 'Select Samples' and unload the current sample first before creating a new imaging task.`;
      
      appendLog(`Cannot create new imaging task: ${warningMessage}`);
      if(showNotification) showNotification(warningMessage, "warning");
      return;
    }

    // Stop WebRTC stream when opening imaging task modal
    if (isWebRtcActive) {
      appendLog("Stopping WebRTC stream before opening imaging task modal.");
      memoizedStopWebRtcStream();
    }

    setSelectedTaskForModal(task); // if task is null, it's for creating a new task
    setIsImagingModalOpen(true);
    appendLog(task ? `Opening modal to manage task: ${task.name}` : "Opening modal to create new imaging task.");
  };

  const closeImagingTaskModal = () => {
    setIsImagingModalOpen(false);
    setSelectedTaskForModal(null);
    appendLog("Closed imaging task modal.");
    // Optionally re-fetch tasks here if changes might have occurred
    // fetchImagingTasks(); // if orchestratorManagerService.get_all_imaging_tasks was called inside modal.
  };

  // Update well plate grid when type changes
  useEffect(() => {
    setCurrentWellPlateRows(WELL_PLATE_CONFIGS[selectedWellPlateType].rows);
    setCurrentWellPlateCols(WELL_PLATE_CONFIGS[selectedWellPlateType].cols);
  }, [selectedWellPlateType]);

  const handleWellPlateTypeChange = (event) => {
    setSelectedWellPlateType(event.target.value);
  };

  const toggleWellPlateNavigator = () => {
    setIsWellPlateNavigatorOpen(!isWellPlateNavigatorOpen);
  };

  const handleWellDoubleClick = async (row, col) => {
    if (!microscopeControlService) {
      appendLog("Microscope control service not available.");
      if (showNotification) showNotification("Microscope control service not available.", "error");
      return;
    }
    if (microscopeBusy || currentOperation) {
      appendLog("Microscope is busy or another operation is in progress.");
      if (showNotification) showNotification("Microscope is busy or another operation is in progress.", "warning");
      return;
    }

    const operationId = `navigate_well_${row}${col}`;
    setCurrentOperation({ id: operationId, name: `Navigating to Well ${row}${col}` });
    setMicroscopeBusy(true);
    appendLog(`Navigating to well: ${row}${col}, Plate Type: ${selectedWellPlateType}`);
    try {
      await microscopeControlService.navigate_to_well(row, col, selectedWellPlateType);
      appendLog(`Successfully navigated to well: ${row}${col}`);
      if (showNotification) showNotification(`Successfully navigated to well: ${row}${col}`, "success");
      await fetchStatusAndUpdateActuals(); // Update positions
    } catch (error) {
      appendLog(`Error navigating to well ${row}${col}: ${error.message}`);
      if (showNotification) showNotification(`Error navigating to well ${row}${col}: ${error.message}`, "error");
      console.error(`[MicroscopeControlPanel] Error navigating to well:`, error);
    } finally {
      setMicroscopeBusy(false);
      setCurrentOperation(null);
    }
  };

  // Function to load microscope configuration
  const loadMicroscopeConfiguration = async () => {
    if (!microscopeControlService) {
      const errorMsg = "Microscope control service not available.";
      setConfigurationError(errorMsg);
      setIsConfigurationLoaded(false);
      if (showNotification) showNotification(errorMsg, 'warning');
      return;
    }

    // Check if the current microscope service supports configuration loading
    if (typeof microscopeControlService.get_microscope_configuration !== 'function') {
      const errorMsg = "Configuration not supported for this microscope.";
      setConfigurationError(errorMsg);
      setIsConfigurationLoaded(false);
      appendLog(`Configuration loading not supported for microscope: ${selectedMicroscopeId}`);
      return;
    }

    setIsConfigurationLoading(true);
    setConfigurationError(null);
    
    try {
      appendLog(`Loading microscope configuration for ${selectedMicroscopeId}...`);
      const response = await microscopeControlService.get_microscope_configuration();
      
      if (response.success) {
        // Store configuration without metadata
        const configWithoutMetadata = { ...response.configuration };
        delete configWithoutMetadata.metadata;
        
        setMicroscopeConfiguration(configWithoutMetadata);
        setIsConfigurationLoaded(true);
        appendLog(`Microscope configuration loaded successfully for ${selectedMicroscopeId}.`);
      } else {
        const errorMsg = "Failed to load microscope configuration.";
        setConfigurationError(errorMsg);
        setIsConfigurationLoaded(false);
        appendLog(errorMsg);
        if (showNotification) showNotification(errorMsg, 'error');
      }
    } catch (error) {
      const errorMsg = `Error loading microscope configuration: ${error.message}`;
      setConfigurationError(errorMsg);
      setIsConfigurationLoaded(false);
      appendLog(errorMsg);
      if (showNotification) showNotification(errorMsg, 'error');
      console.error("[MicroscopeControlPanel] Error loading microscope configuration:", error);
    } finally {
      setIsConfigurationLoading(false);
    }
  };

  // Function to open configuration display window
  const openConfigurationWindow = () => {
    if (!microscopeConfiguration) {
      if (showNotification) showNotification("No configuration loaded. Please load configuration first.", 'warning');
      return;
    }
    setIsConfigurationWindowOpen(true);
  };

  // Function to close configuration display window
  const closeConfigurationWindow = () => {
    setIsConfigurationWindowOpen(false);
  };

  return (
    <div className="microscope-control-panel-container new-mcp-layout bg-white bg-opacity-95 p-4 rounded-lg shadow-lg border-l border-gray-300 box-border">
      {/* Left Side: Image Display */}
      <div className={`mcp-image-display-area ${isRightPanelCollapsed ? 'expanded' : ''}`}>
        <div
          id="image-display"
          className={`w-full border ${
            (snapshotImage || isWebRtcActive) ? 'border-gray-300' : 'border-dotted border-gray-400'
          } rounded flex items-center justify-center bg-black relative`}
        >
          {isWebRtcActive && !webRtcError ? (
            <video ref={videoRef} autoPlay playsInline muted className="object-contain w-full h-full" />
          ) : snappedImageData.url ? (
            <>
              <img
                src={snappedImageData.url}
                alt="Microscope Snapshot"
                className="object-contain w-full h-full"
              />
              {/* ImageJ.js Badge */}
              {onOpenImageJ && (
                <button
                  onClick={() => onOpenImageJ(snappedImageData.numpy)}
                  className="imagej-badge absolute top-2 right-2 p-1 bg-white bg-opacity-90 hover:bg-opacity-100 rounded shadow-md transition-all duration-200 flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={imjoyApi ? "Open in ImageJ.js" : "ImageJ.js integration is loading..."}
                  disabled={!imjoyApi}
                >
                  <img 
                    src="https://ij.imjoy.io/assets/badge/open-in-imagej-js-badge.svg" 
                    alt="Open in ImageJ.js" 
                    className="h-4"
                  />
                </button>
              )}
            </>
          ) : (
            <p className="placeholder-text text-center text-gray-300">
              {webRtcError ? `WebRTC Error: ${webRtcError}` : (microscopeControlService ? 'Image Display' : 'Microscope not connected')}
            </p>
          )}
        </div>
        {/* Video Contrast Controls with Histogram */}
        {isWebRtcActive && (
          <div className="video-contrast-controls mt-2 p-2 border border-gray-300 rounded-lg bg-white bg-opacity-90">
            <div className="text-xs font-medium text-gray-700 mb-2 flex items-center justify-between">
              <span>Gray Level Histogram & Contrast</span>
              <div className="flex items-center space-x-2">
                {isDataChannelConnected && (
                  <span className="text-green-600 text-xs">
                    <i className="fas fa-circle text-green-500 mr-1" style={{ fontSize: '6px' }}></i>
                    Metadata Channel
                  </span>
                )}
              </div>
            </div>
            
            {/* Auto Contrast Toggle */}
            <div className="flex items-center mb-2">
              <label className="text-xs text-gray-600 mr-2">Auto Contrast Adjustment</label>
              <label className="auto-contrast-toggle mr-2">
                <input
                  type="checkbox"
                  checked={autoContrastEnabled}
                  onChange={(e) => setAutoContrastEnabled(e.target.checked)}
                  disabled={!isDataChannelConnected}
                />
                <span className="auto-contrast-slider"></span>
              </label>
              <span className="text-xs text-gray-500">
                {autoContrastEnabled ? 'ON' : 'OFF'}
                {!isDataChannelConnected && ' (Channel Required)'}
              </span>
            </div>
            
            {/* Auto Contrast Parameters */}
            {autoContrastEnabled && (
              <div className="auto-contrast-params mb-2 p-2 bg-gray-50 rounded border">
                <div className="text-xs text-gray-600 mb-1">Adjustment Parameters</div>
                <div className="flex items-center justify-between space-x-2">
                  {/* Min Adjustment */}
                  <div className="flex items-center space-x-1">
                    <label className="text-xs text-gray-600 whitespace-nowrap">P5:</label>
                    <button
                      type="button"
                      className="w-5 h-5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={() => setAutoContrastMinAdjust(prev => prev - 1)}
                      disabled={!isDataChannelConnected}
                    >
                      <i className="fas fa-minus" style={{ fontSize: '8px' }}></i>
                    </button>
                    <input
                      type="number"
                      value={autoContrastMinAdjust}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value)) {
                          setAutoContrastMinAdjust(Math.max(-255, Math.min(255, value)));
                        }
                      }}
                      className="w-12 px-1 py-0 text-xs text-center border border-gray-300 rounded"
                      disabled={!isDataChannelConnected}
                      step="1"
                    />
                    <button
                      type="button"
                      className="w-5 h-5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={() => setAutoContrastMinAdjust(prev => prev + 1)}
                      disabled={!isDataChannelConnected}
                    >
                      <i className="fas fa-plus" style={{ fontSize: '8px' }}></i>
                    </button>
                  </div>
                  
                  {/* Max Adjustment */}
                  <div className="flex items-center space-x-1">
                    <label className="text-xs text-gray-600 whitespace-nowrap">P95:</label>
                    <button
                      type="button"
                      className="w-5 h-5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={() => setAutoContrastMaxAdjust(prev => prev - 1)}
                      disabled={!isDataChannelConnected}
                    >
                      <i className="fas fa-minus" style={{ fontSize: '8px' }}></i>
                    </button>
                    <input
                      type="number"
                      value={autoContrastMaxAdjust}
                      onChange={(e) => {
                        const value = parseInt(e.target.value, 10);
                        if (!isNaN(value)) {
                          setAutoContrastMaxAdjust(Math.max(-255, Math.min(255, value)));
                        }
                      }}
                      className="w-12 px-1 py-0 text-xs text-center border border-gray-300 rounded"
                      disabled={!isDataChannelConnected}
                      step="1"
                    />
                    <button
                      type="button"
                      className="w-5 h-5 text-xs bg-gray-200 hover:bg-gray-300 rounded flex items-center justify-center"
                      onClick={() => setAutoContrastMaxAdjust(prev => prev + 1)}
                      disabled={!isDataChannelConnected}
                    >
                      <i className="fas fa-plus" style={{ fontSize: '8px' }}></i>
                    </button>
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Range: P5{autoContrastMinAdjust >= 0 ? '+' : ''}{autoContrastMinAdjust} to P95{autoContrastMaxAdjust >= 0 ? '+' : ''}{autoContrastMaxAdjust} gray levels
                </div>
              </div>
            )}
            
            {/* Histogram Display */}
            {frameMetadata && frameMetadata.gray_level_stats ? (
              <div className="mb-2">
                {renderHistogramDisplay()}
                
                {/* Statistics Display */}
                <div className="mt-1 text-xs text-gray-600 flex justify-between">
                  <span>Mean: {frameMetadata.gray_level_stats.mean_percent?.toFixed(1)}%</span>
                  <span>Range: {videoContrastMin}-{videoContrastMax}</span>
                  <span>Contrast: {frameMetadata.gray_level_stats.contrast_ratio?.toFixed(3)}</span>
                </div>
              </div>
            ) : (
              <div className="mb-2 text-xs text-gray-500 italic">
                {isDataChannelConnected ? 'Waiting for metadata...' : 'No histogram data available'}
              </div>
            )}
            
            {/* Manual Contrast Controls */}
            <div className="flex items-center space-x-2">
              <label htmlFor="min-contrast" className="text-xs text-gray-600 w-16 shrink-0">Min: {videoContrastMin}</label>
              <input
                id="min-contrast"
                type="range"
                min="0"
                max="255"
                value={videoContrastMin}
                onChange={(e) => {
                  const newMin = parseInt(e.target.value, 10);
                  if (newMin < videoContrastMax) {
                    setVideoContrastMin(newMin);
                  }
                }}
                className="w-full"
                title={`Min value: ${videoContrastMin}`}
              />
            </div>
            <div className="flex items-center space-x-2 mt-1">
              <label htmlFor="max-contrast" className="text-xs text-gray-600 w-16 shrink-0">Max: {videoContrastMax}</label>
              <input
                id="max-contrast"
                type="range"
                min="0"
                max="255"
                value={videoContrastMax}
                onChange={(e) => {
                  const newMax = parseInt(e.target.value, 10);
                  if (newMax > videoContrastMin) {
                    setVideoContrastMax(newMax);
                  }
                }}
                className="w-full"
                title={`Max value: ${videoContrastMax}`}
              />
            </div>
          </div>
        )}

        {/* Frame Metadata Display */}
        {isWebRtcActive && frameMetadata && (
          <div className="frame-metadata-display mt-2 p-2 border border-gray-300 rounded-lg bg-white bg-opacity-90">
            <div className="text-xs font-medium text-gray-700 mb-2">Microscope Information</div>
            <div className="text-xs text-gray-600 space-y-1">
              {/* Stage Position */}
              {frameMetadata.stage_position && (
                <div>
                  <strong>Stage Position:</strong> 
                  X: {frameMetadata.stage_position.x_mm?.toFixed(3)}mm, 
                  Y: {frameMetadata.stage_position.y_mm?.toFixed(3)}mm, 
                  Z: {frameMetadata.stage_position.z_mm?.toFixed(3)}mm
                </div>
              )}
              
              {/* Channel and Exposure Info */}
              <div>
                <strong>Channel:</strong> {frameMetadata.channel} | 
                <strong> Intensity:</strong> {frameMetadata.intensity}% | 
                <strong> Exposure:</strong> {frameMetadata.exposure_time_ms}ms
              </div>
              
              {/* Timestamp */}
              {frameMetadata.timestamp && (
                <div>
                  <strong>Timestamp:</strong> {new Date(frameMetadata.timestamp * 1000).toLocaleString()}
                </div>
              )}
              
              {/* Exposure Quality */}
              {frameMetadata.gray_level_stats?.exposure_quality && (
                <div>
                  <strong>Exposure Quality:</strong> 
                  Well-exposed: {frameMetadata.gray_level_stats.exposure_quality.well_exposed_pixels_percent?.toFixed(1)}% | 
                  Under: {frameMetadata.gray_level_stats.exposure_quality.underexposed_pixels_percent?.toFixed(1)}% | 
                  Over: {frameMetadata.gray_level_stats.exposure_quality.overexposed_pixels_percent?.toFixed(1)}%
                </div>
              )}
              
              {/* Additional Stats */}
              {frameMetadata.gray_level_stats && (
                <div>
                  <strong>Stats:</strong> 
                  Std: {frameMetadata.gray_level_stats.std_percent?.toFixed(1)}% | 
                  Dynamic Range: {frameMetadata.gray_level_stats.dynamic_range_percent?.toFixed(1)}% | 
                  Median: {frameMetadata.gray_level_stats.median_percent?.toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        )}
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
            onSampleLoadStatusChange={handleSampleLoadStatusChange}
            microscopeBusy={microscopeBusy}
          />

          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center justify-start flex-grow">
              <h3 className="text-lg font-medium mr-3">
                {selectedMicroscopeId === 'agent-lens/squid-control-reef' ? 'Simulated Microscope' :
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
            
            {/* Configuration button in upper right corner */}
            <div className="flex items-center space-x-2">
              {selectedMicroscopeId && (
                <button
                  onClick={isConfigurationLoaded ? openConfigurationWindow : loadMicroscopeConfiguration}
                  className={`config-button p-1 rounded shadow text-xs disabled:opacity-75 disabled:cursor-not-allowed ${
                    isConfigurationLoading 
                      ? 'bg-yellow-500 hover:bg-yellow-600' 
                      : isConfigurationLoaded 
                        ? 'bg-blue-500 hover:bg-blue-600' 
                        : 'bg-gray-500 hover:bg-gray-600'
                  } text-white`}
                  title={
                    isConfigurationLoading 
                      ? "Loading configuration..." 
                      : isConfigurationLoaded 
                        ? "View microscope configuration" 
                        : "Load microscope configuration"
                  }
                  disabled={!microscopeControlService}
                >
                  {isConfigurationLoading ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-1"></i>
                      Loading...
                    </>
                  ) : isConfigurationLoaded ? (
                    <>
                      <i className="fas fa-cog mr-1"></i>
                      Config
                    </>
                  ) : (
                    <>
                      <i className="fas fa-download mr-1"></i>
                      Load Config
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
          
          <div className="control-group mb-3">
            <div className="horizontal-buttons flex justify-between space-x-1">
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                onClick={contrastAutoFocus}
                disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
              >
                <i className="fas fa-crosshairs icon mr-1"></i> Contrast AF
              </button>
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                onClick={laserAutoFocus}
                disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
              >
                <i className="fas fa-bullseye icon mr-1"></i> Laser AF
              </button>
              <button
                className="control-button bg-blue-500 text-white hover:bg-blue-600 w-1/5 px-1.5 py-0.5 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                onClick={setLaserReference}
                disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
              >
                <i className="fas fa-bookmark icon mr-1"></i> Set Ref
              </button>
              <button
                className="control-button snap-button bg-green-500 text-white hover:bg-green-600 w-1/5 px-1.5 py-0.5 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                onClick={snapImage}
                disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
              >
                <i className="fas fa-camera icon mr-1"></i> Snap
              </button>
              <button
                className={`control-button live-button ${isWebRtcActive ? 'bg-red-500 hover:bg-red-600' : 'bg-purple-500 hover:bg-purple-600'} text-white w-1/5 px-1.5 py-0.5 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed`}
                onClick={toggleWebRtcStream}
                disabled={!microscopeControlService || currentOperation !== null || !hyphaManager || microscopeBusy}
                title={!hyphaManager ? "HyphaManager not connected" : (isWebRtcActive ? "Stop Live Stream" : "Start Live Stream")}
              >
                <i className="fas fa-video icon mr-1"></i> {isWebRtcActive ? 'Stop Live' : 'Start Live'}
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
                    className="control-input w-1/2 p-1 border border-gray-300 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                    placeholder={`d${axis.toUpperCase()}(mm)`}
                    value={axis === 'x' ? xMoveStr : axis === 'y' ? yMoveStr : zMoveStr}
                    min="0"
                    onChange={(e) => {
                      if (currentOperation || microscopeBusy) return;
                      const newStringValue = e.target.value;
                      let newNumericValue = parseFloat(newStringValue);

                      if (axis === 'x') {
                        setXMoveStr(newStringValue);
                        if (!isNaN(newNumericValue)) {
                          setXMove(newNumericValue < 0 ? 0 : newNumericValue);
                        }
                      } else if (axis === 'y') {
                        setYMoveStr(newStringValue);
                        if (!isNaN(newNumericValue)) {
                          setYMove(newNumericValue < 0 ? 0 : newNumericValue);
                        }
                      } else { // Z-axis
                        setZMoveStr(newStringValue);
                        if (!isNaN(newNumericValue)) {
                          setZMove(newNumericValue < 0 ? 0 : newNumericValue);
                        }
                      }
                    }}
                    disabled={currentOperation !== null || microscopeBusy}
                  />
                </div>
                <div className="aligned-buttons flex justify-between space-x-1">
                  <button
                    className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 p-1 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                    onClick={() => moveMicroscope(axis, -1)}
                    disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
                  >
                    <i className={`fas fa-arrow-${axis === 'x' ? 'left' : axis === 'y' ? 'up' : 'down'} mr-1`}></i> {axis.toUpperCase()}-
                  </button>
                  <button
                    className="half-button bg-blue-500 text-white hover:bg-blue-600 w-1/2 p-1 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                    onClick={() => moveMicroscope(axis, 1)}
                    disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
                  >
                    {axis.toUpperCase()}+ <i className={`fas fa-arrow-${axis === 'x' ? 'right' : axis === 'y' ? 'down' : 'up'} ml-1`}></i>
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
                  className="control-input w-full disabled:opacity-75 disabled:cursor-not-allowed"
                  min="0"
                  max="100"
                  value={desiredIlluminationIntensity}
                  onChange={(e) => {
                    if (!microscopeControlService || currentOperation || microscopeBusy) return;
                    setDesiredIlluminationIntensity(parseInt(e.target.value, 10));
                  }}
                  disabled={!microscopeControlService || microscopeBusy || currentOperation !== null}
                />
              </div>

              <div className="illumination-channel text-xs">
                <label>Illumination Channel:</label>
                <select
                  className="control-input w-full mt-1 p-1 border border-gray-300 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                  value={illuminationChannel}
                  onChange={(e) => {
                    if (!microscopeControlService || currentOperation || microscopeBusy) return;
                    const newChannel = e.target.value;
                    if (illuminationChannel !== newChannel) { // Only if channel actually changes
                      setIlluminationChannel(newChannel); // This triggers the set_illumination effect
                      channelSetByUIFlagRef.current = true; // Indicate change is fresh from UI, pending hardware ack
                    }
                  }}
                  disabled={!microscopeControlService || currentOperation !== null || microscopeBusy}
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
              <span className="ml-1 text-gray-800 text-xs">{actualCameraExposure} ms</span>
              <input
                type="number"
                className="control-input w-full mt-1 p-1 border border-gray-300 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
                value={desiredCameraExposure}
                max="900"
                onChange={(e) => {
                  if (currentOperation || microscopeBusy) return;
                  const value = parseInt(e.target.value, 10);
                  if (value > 900) {
                    if (showNotification) {
                      showNotification('Maximum exposure time is 900ms', 'warning');
                    }
                  }
                  setDesiredCameraExposure(Math.min(value, 900)); // Ensure value doesn't exceed 900ms
                }}
                disabled={currentOperation !== null || microscopeBusy}
              />
            </div>
          </div>
        </div>

        {/* Well Plate Navigator Section */}
        <div className="p-3 border border-gray-300 rounded-lg mb-3">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Well Plate Navigator</h3>
              <button
                className="ml-2 px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded border border-gray-300 flex items-center transition-colors duration-200"
                onClick={toggleWellPlateNavigator}
                aria-expanded={isWellPlateNavigatorOpen}
                aria-controls="well-plate-grid-content"
                title={isWellPlateNavigatorOpen ? "Hide Well Plate Grid" : "Show Well Plate Grid"}
              >
                <span className="mr-1">{isWellPlateNavigatorOpen ? "Hide" : "Show"}</span>
                <i className={`fas ${isWellPlateNavigatorOpen ? 'fa-chevron-up' : 'fa-chevron-down'} transition-transform duration-300`}></i>
              </button>
            </div>
            <div className="flex items-center">
              <label htmlFor="wellPlateTypeSelect" className="text-sm font-medium text-gray-700 dark:text-gray-400 mr-2">Type:</label>
              <select
                id="wellPlateTypeSelect"
                value={selectedWellPlateType}
                onChange={handleWellPlateTypeChange}
                disabled={!microscopeControlService || microscopeBusy || currentOperation !== null}
                className="control-input p-1 text-xs rounded shadow-sm border-gray-300 focus:ring-blue-500 focus:border-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white disabled:opacity-75 disabled:cursor-not-allowed"
              >
                <option value="96">96 Well</option>
                <option value="24">24 Well</option>
              </select>
            </div>
          </div>

          <div 
            id="well-plate-grid-content" 
            className={`well-plate-grid-container overflow-x-auto transition-all duration-300 ease-in-out origin-top ${isWellPlateNavigatorOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
            style={{
              overflow: isWellPlateNavigatorOpen ? 'visible' : 'hidden',
            }}
          >
            <div 
              className="well-plate-grid" 
              style={{ 
                gridTemplateColumns: `auto repeat(${currentWellPlateCols.length}, minmax(30px, 1fr))`,
                transform: isWellPlateNavigatorOpen ? 'scaleY(1)' : 'scaleY(0)',
                transition: 'transform 0.3s ease-in-out',
                transformOrigin: 'top'
              }}
            >
              <div className="grid-col-labels">
                <div className="grid-label"></div>
                {currentWellPlateCols.map(col => (
                  <div key={`col-label-${col}`} className="grid-label">{col}</div>
                ))}
              </div>
              {currentWellPlateRows.map(row => (
                <div key={`row-${row}`} className="grid-row">
                  <div className="grid-label">{row}</div>
                  {currentWellPlateCols.map(col => (
                    <div
                      key={`cell-${row}-${col}`}
                      className={`grid-cell ${(!microscopeControlService || microscopeBusy || currentOperation !== null) ? 'disabled' : ''}`}
                      onClick={() => {
                        if (!microscopeControlService || microscopeBusy || currentOperation) return;
                        handleWellDoubleClick(row, col);
                      }}
                      title={`Well ${row}${col} - Click to navigate`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          if (!microscopeControlService || microscopeBusy || currentOperation) return;
                          handleWellDoubleClick(row, col);
                        }
                      }}
                      disabled={!microscopeControlService || microscopeBusy || currentOperation !== null}
                    >
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Imaging Tasks Section - Always show, but with different states based on availability */}
        <div className="imaging-tasks-section mb-3 p-3 border border-gray-300 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-medium">Time-Lapse Imaging Tasks</h4>
            <button
              className="control-button bg-green-500 text-white hover:bg-green-600 px-2 py-1 rounded text-xs disabled:opacity-75 disabled:cursor-not-allowed"
              onClick={() => openImagingTaskModal(null)}
              disabled={
                selectedMicroscopeId === "agent-lens/squid-control-reef" || 
                !orchestratorManagerService || 
                currentOperation !== null || 
                microscopeBusy || 
                imagingTasks.some(t => t.operational_state?.status !== 'completed' && t.operational_state?.status !== 'failed')
              }
              title={
                selectedMicroscopeId === "agent-lens/squid-control-reef" 
                  ? "Time-lapse imaging not supported on simulated microscope"
                  : !orchestratorManagerService 
                    ? "Orchestrator service not available (check reef-imaging workspace access)"
                    : sampleLoadStatus.isSampleLoaded
                      ? "Microscope is occupied. Unload current sample first via 'Select Samples'"
                      : imagingTasks.some(t => t.operational_state?.status !== 'completed' && t.operational_state?.status !== 'failed')
                        ? "Microscope has an active/pending task. Cannot create new task."
                        : "Create New Imaging Task"
              }
            >
              <i className="fas fa-plus mr-1"></i> New Task
            </button>
          </div>
          
          {selectedMicroscopeId === "agent-lens/squid-control-reef" ? (
            <p className="text-xs text-gray-500 italic">Time-lapse imaging is not supported on the simulated microscope.</p>
          ) : !orchestratorManagerService ? (
            <p className="text-xs text-gray-500 italic">Time-lapse imaging not available (orchestrator service not accessible - check reef-imaging workspace access).</p>
          ) : imagingTasks.length === 0 ? (
            <p className="text-xs text-gray-500">No imaging tasks found for this microscope.</p>
          ) : (
            <ul className="list-disc pl-5 space-y-1 text-xs">
              {imagingTasks.map(task => (
                <li 
                  key={task.name} 
                  className={`cursor-pointer hover:text-blue-600 ${task.operational_state?.status !== 'completed' && task.operational_state?.status !== 'failed' ? 'font-semibold text-blue-700' : 'text-gray-600'}`}
                  onClick={() => openImagingTaskModal(task)}
                  title={`Status: ${task.operational_state?.status || 'Unknown'}. Click to manage.`}
                >
                  {task.name} ({task.operational_state?.status || 'Unknown'})
                  {task.operational_state?.status !== 'completed' && task.operational_state?.status !== 'failed' && <i className="fas fa-spinner fa-spin ml-2 text-blue-500"></i>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bottom-Right: Chatbot */}
        <div className="mcp-chatbot-area">
          <ChatbotButton 
            key={selectedMicroscopeId}
            microscopeControlService={microscopeControlService} 
            appendLog={appendLog} 
            microscopeBusy={microscopeBusy}
          />
        </div>
      </div>

      {isImagingModalOpen && (
        <ImagingTasksModal
          isOpen={isImagingModalOpen}
          onClose={closeImagingTaskModal}
          task={selectedTaskForModal}
          orchestratorManagerService={orchestratorManagerService}
          appendLog={appendLog}
          showNotification={showNotification}
          selectedMicroscopeId={selectedMicroscopeId}
          onTaskChange={fetchImagingTasks}
          incubatorControlService={incubatorControlService}
          microscopeControlService={microscopeControlService}
        />
      )}

      {/* Configuration Display Modal */}
      {isConfigurationWindowOpen && microscopeConfiguration && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[70vh] flex flex-col">
            {/* Modal Header - Fixed */}
            <div className="flex justify-between items-center p-3 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-lg font-semibold text-gray-800">
                Microscope Configuration
                {selectedMicroscopeId && (
                  <span className="text-sm text-gray-600 ml-2">
                    ({selectedMicroscopeId === 'agent-lens/squid-control-reef' ? 'Simulated' :
                      selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-1' ? 'Real Microscope 1' :
                      selectedMicroscopeId === 'reef-imaging/mirror-microscope-control-squid-2' ? 'Real Microscope 2' :
                      selectedMicroscopeId})
                  </span>
                )}
              </h2>
              <button
                onClick={closeConfigurationWindow}
                className="text-gray-400 hover:text-gray-600 text-xl font-bold w-6 h-6 flex items-center justify-center flex-shrink-0"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Body - Scrollable */}
            <div className="overflow-y-auto p-3" style={{ maxHeight: 'calc(70vh - 120px)' }}>
              <pre className="bg-gray-100 p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap font-mono leading-tight">
                {JSON.stringify(microscopeConfiguration, null, 2)}
              </pre>
            </div>

            {/* Modal Footer - Fixed */}
            <div className="flex justify-end p-3 border-t border-gray-200 flex-shrink-0">
              <button
                onClick={closeConfigurationWindow}
                className="px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
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
  hyphaManager: PropTypes.object, // Changed prop type
  showNotification: PropTypes.func, // Added prop type for notification function
  orchestratorManagerService: PropTypes.object, // Added prop type
  onOpenImageJ: PropTypes.func, // Added prop type for ImageJ integration
  imjoyApi: PropTypes.object, // Added prop type for ImJoy API
};

export default MicroscopeControlPanel; 