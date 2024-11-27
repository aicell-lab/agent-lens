import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import './style.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

// Import OpenLayers modules
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
// import { get as getProjection, Projection } from 'ol/proj';

import 'ol/ol.css';
import Map from 'ol/Map';
import View from 'ol/View';
import Projection from 'ol/proj/Projection';
import ImageLayer from 'ol/layer/Image';
import ImageStatic from 'ol/source/ImageStatic';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import { Draw } from 'ol/interaction';
import { defaults as defaultControls, FullScreen, ZoomSlider } from 'ol/control';
import { getCenter } from 'ol/extent';
import * as olExtent from 'ol/extent';
import * as olProj from 'ol/proj';
import WinBox from 'winbox/src/js/winbox';

const originalWidth = 2048;
const originalHeight = 2048;

const MicroscopeControl = () => {
    
  const mapRef = useRef(null); // Reference to the map container
  const [map, setMap] = useState(null);
  const [imageLayer, setImageLayer] = useState(null);
  const [vectorLayer, setVectorLayer] = useState(null);

  const [microscopeControl, setMicroscopeControl] = useState(null);
  const [snapshotImage, setSnapshotImage] = useState(null);

  const [isControlSectionOpen, setIsControlSectionOpen] = useState(false);
  const [isDrawingActive, setIsDrawingActive] = useState(false);

  const [xPosition, setXPosition] = useState(0);
  const [yPosition, setYPosition] = useState(0);
  const [zPosition, setZPosition] = useState(0);
  const [BrightFieldIntensity, setBrightFieldIntensity] = useState(50);
  const [BrightFieldCameraExposure, setBrightFieldCameraExposure] = useState(100);
  const [Fluorescence405Intensity, setFluorescence405Intensity] = useState(50);
  const [Fluorescence405CameraExposure, setFluorescence405CameraExposure] = useState(100);
  const [Fluorescence488Intensity, setFluorescence488Intensity] = useState(50);
  const [Fluorescence488CameraExposure, setFluorescence488CameraExposure] = useState(100);
  const [Fluorescence561Intensity, setFluorescence561Intensity] = useState(50);
  const [Fluorescence561CameraExposure, setFluorescence561CameraExposure] = useState(100);
  const [Fluorescence638Intensity, setFluorescence638Intensity] = useState(50);
  const [Fluorescence638CameraExposure, setFluorescence638CameraExposure] = useState(100);
  const [Fluorescence730Intensity, setFluorescence730Intensity] = useState(50);
  const [Fluorescence730CameraExposure, setFluorescence730CameraExposure] = useState(100);
  const [illuminationIntensity, setIlluminationIntensity] = useState(50);
  const [illuminationChannel, setIlluminationChannel] = useState("0");
  const [cameraExposure, setCameraExposure] = useState(100);
  const [xMove, setXMove] = useState(1);
  const [yMove, setYMove] = useState(1);
  const [zMove, setZMove] = useState(0.1);
  const [isLightOn, setIsLightOn] = useState(false);
  const [isPlateScanRunning, setIsPlateScanRunning] = useState(false);
  const [log, setLog] = useState('');
  const [chatbotUrl, setChatbotUrl] = useState(null);
  const [svc, setSvc] = useState(null);  // Correctly initialize the similarity search service state
  const [numSimilarResults, setNumSimilarResults] = useState(5);
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPenActive, setIsPenActive] = useState(false); // State to track if the pen tool is active
  const [isFirstClick, setIsFirstClick] = useState(true); // Track if it's the first click for segmentation
  const [segmentService, setSegmentService] = useState(null);
  const [selectedModel, setSelectedModel] = useState('vit_b_lm'); // Default model
  const [similarityService, setSimilarityService] = useState(null);
  const appendLog = (message) => {
      setLog(prevLog => prevLog + message + '\n');
  };

  useEffect(() => {
    const initializeWebRPC = async () => {
      try {
        appendLog('Connecting to server...');
        const server_url = "https://hypha.aicell.io";
        //const token = await hyphaWebsocketClient.login({"server_url": server_url});
        const server = await hyphaWebsocketClient.connectToServer({ 
            "name": "js-client", 
            "server_url": server_url, 
            "method_timeout": 10,
            //"token": token,
        });
        appendLog('Server connected.');

        appendLog('Getting Segmentation service...');
        try {
          const segmentationService = await server.getService(
              "ws-user-google-oauth2|103047988474094226050/W3sBK4RR2ZkrixwftvU9d5:interactive-segmentation"
          );
          appendLog('Segmentation service acquired.');
          setSegmentService(segmentationService);
        } catch (error) {
          appendLog(`Error acquiring segmentation service: ${error.message}`);
        }
        
        appendLog('Getting microscope control service...');
        try {
          const mc = await server.getService(
              "ws-user-google-oauth2|103047988474094226050/EvAytsZjAYwdiXG5ywVWYw:microscope-control-squid-test"
          );
          appendLog('Microscope control service acquired.');
          setMicroscopeControl(mc);
        } catch (error) {
          appendLog(`Error acquiring microscope control service: ${error.message}`);
        }

        appendLog('Getting Similarity Search Service...');
        try {
          const similarityService = await server.getService(
            "ws-user-google-oauth2|103047988474094226050/SRNhPD5EsrF8PVhrTHTQ9R:image-embedding-similarity-search"
        );
          appendLog('Similarity Search Service acquired.');
          setSimilarityService(similarityService);
        } catch (error) {
          appendLog(`Error acquiring Similarity Search Service: ${error.message}`);
        }

        // Poll the server for status updates every 5 seconds
        const statusInterval = setInterval(async () => {
          try {
              if (microscopeControl) {  // Check if microscopeControl is available
                  const status = await microscopeControl.get_status();
                  updateUIBasedOnStatus(status);
              }
          } catch (statusError) {
              appendLog(`Error fetching status: ${statusError.message}`);
          }
        }, 2000);

        // Clear the interval when the component unmounts
        return () => clearInterval(statusInterval);
          
        } catch (error) {
            appendLog(`Error: ${error.message}`);
        }
    };
    initializeWebRPC();
  }, []);

  useEffect(() => {
    let hyphaCoreInitialized = false;
  
    const initializeHyphaCore = async () => {
      if (!hyphaCoreInitialized) {
        hyphaCoreInitialized = true;
  
        // Dynamically import HyphaCore
        const module = await import('https://cdn.jsdelivr.net/npm/hypha-core@0.20.38/dist/hypha-core.mjs');
        const { HyphaCore } = module;
  
        window.hyphaCore = new HyphaCore();
        window.chatbotWindow = null;
  
        window.hyphaCore.on('add_window', (config) => {
          console.log('Creating window with config:', config); // For debugging
          console.log('config.window_id:', config.window_id);
        
          const wb = new WinBox(config.name || config.src.slice(0, 128), {
            id: 'chatbot-window', // Assign an ID to the window
            background: '#448aff',
            x: 'center',
            y: 'center',
            width: '40%',
            height: '70%',
            movable: true,
            resizable: true,
            minimizable: true, // Allow the window to be minimized
            index: 9999, // Ensure it appears above other elements
            onclose: function () {
              window.chatbotWindow = null; // Reset the reference when closed
            },
            buttons: ['min', 'max', 'close'],
          });
        
          // Set the iframe's id to config.window_id
          wb.body.innerHTML = `<iframe id="${config.window_id}" src="${config.src}" style="width: 100%; height: 100%; border: none;"></iframe>`;
        
          return wb;
        });        
  
        await window.hyphaCore.start();
        window.hyphaApi = window.hyphaCore.api;
      }
    };
  
    initializeHyphaCore();
  }, []); // Empty dependency array ensures this runs once when the component mounts
  

  useEffect(() => {
    if (!map && mapRef.current) {
      // Define the extent of your image
      const imageWidth = 2048;
      const imageHeight = 2048;
      const extent = [0, 0, imageWidth, imageHeight];

      // Create a custom projection for the image
      const projection = new Projection({
        code: 'deepzoom-image',
        units: 'pixels',
        extent: extent,
      });

      // Initialize the map
      const initialMap = new Map({
        target: mapRef.current,
        layers: [],
        view: new View({
          projection: projection,
          center: [imageWidth / 2, imageHeight / 2],
          zoom: 2,
          minZoom: 0,
          maxZoom: 10,
        }),
        controls: defaultControls().extend([new ZoomSlider(), new FullScreen()]),
      });

      setMap(initialMap);
    }

    // Clean up on unmount
    return () => {
      if (map) {
        map.setTarget(null);
      }
    };
  }, [mapRef.current]);

  useEffect(() => {
    if (map && snapshotImage) {
      // Remove existing image layer if any
      if (imageLayer) {
        map.removeLayer(imageLayer);
      }
  
      const img = new Image();
      img.onload = () => {
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        const extent = [0, 0, imgWidth, imgHeight];
  
        const imageSource = new ImageStatic({
          url: snapshotImage,
          imageExtent: extent,
          projection: map.getView().getProjection(),
        });
  
        const newImageLayer = new ImageLayer({
          source: imageSource,
        });
  
        map.addLayer(newImageLayer);
        setImageLayer(newImageLayer);
  
        // Fit the map view to the image extent
        map.getView().fit(extent, { size: map.getSize() });
      };
  
      img.onerror = (error) => {
        appendLog(`Failed to load image: ${error.message || error}`);
        console.error('Failed to load image', error);
      };
  
      img.src = snapshotImage;
    }
  }, [map, snapshotImage]);
  
  useEffect(() => {
    return () => {
      if (snapshotImage) {
        URL.revokeObjectURL(snapshotImage);
      }
    };
  }, [snapshotImage]);
  

  useEffect(() => {
    if (map && !vectorLayer) {
      const annotationSource = new VectorSource();
  
      const newVectorLayer = new VectorLayer({
        source: annotationSource,
        zIndex: 1000, // Set a high value to show the mask on the the image
        style: new Style({
          stroke: new Stroke({
            color: 'blue',
            width: 2,
          }),
          fill: new Fill({
            color: 'rgba(0, 0, 255, 0.1)',
          }),
          image: new CircleStyle({
            radius: 6,
            fill: new Fill({ color: 'red' }),
            stroke: new Stroke({ color: 'black', width: 1 }),
          }),
        }),
      });
  
      map.addLayer(newVectorLayer);
      setVectorLayer(newVectorLayer);
    }
  }, [map, vectorLayer]); // Added vectorLayer to dependency array
   
  
  useEffect(() => {
    switch (illuminationChannel) {
      case "0":
        setIlluminationIntensity(BrightFieldIntensity);
        setCameraExposure(BrightFieldCameraExposure);
        break;
      case "11":
        setIlluminationIntensity(Fluorescence405Intensity);
        setCameraExposure(Fluorescence405CameraExposure);
        break;
      case "12":
        setIlluminationIntensity(Fluorescence488Intensity);
        setCameraExposure(Fluorescence488CameraExposure);
        break;
      case "14":
        setIlluminationIntensity(Fluorescence561Intensity);
        setCameraExposure(Fluorescence561CameraExposure);
        break;
      case "13":
        setIlluminationIntensity(Fluorescence638Intensity);
        setCameraExposure(Fluorescence638CameraExposure);
        break;
      case "15":
        setIlluminationIntensity(Fluorescence730Intensity);
        setCameraExposure(Fluorescence730CameraExposure);
        break;
      default:
        break;
    }
  }, [illuminationChannel, BrightFieldIntensity, BrightFieldCameraExposure, Fluorescence405Intensity, Fluorescence405CameraExposure, Fluorescence488Intensity, Fluorescence488CameraExposure, Fluorescence561Intensity, Fluorescence561CameraExposure, Fluorescence638Intensity, Fluorescence638CameraExposure, Fluorescence730Intensity, Fluorescence730CameraExposure]);
  
  const handleImageClick = async (coordinate) => {
    if (!isPenActive || !segmentService || !snapshotImage) return;
  
    // Since the projection is in pixels, coordinates correspond to image pixels
    const pointCoordinates = coordinate;
  
    appendLog(`Clicked at coordinates: (${pointCoordinates[0]}, ${pointCoordinates[1]})`);

    try {
        // Fetch the image data as a Blob
        const response = await fetch(snapshotImage);
        const blob = await response.blob();

        // Convert Blob to ArrayBuffer
        const arrayBuffer = await new Response(blob).arrayBuffer();

        // Convert ArrayBuffer to Uint8Array
        const uint8Array = new Uint8Array(arrayBuffer);

        let segmentedResult;
        if (isFirstClick) {
            // First click: Use compute_embedding_with_initial_segment with the selected model
            segmentedResult = await segmentService.compute_embedding_with_initial_segment(
                selectedModel,
                uint8Array,
                [pointCoordinates],
                [1]
            );
            setIsFirstClick(false);
        } else {
            // Subsequent clicks: Use segment_with_existing_embedding
            segmentedResult = await segmentService.segment_with_existing_embedding(
                uint8Array,
                [pointCoordinates],
                [1]
            );
        }

        if (segmentedResult.error) {
            appendLog(`Segmentation error: ${segmentedResult.error}`);
            return;
        }

        // Ensure mask data is not empty or malformed
        const maskData = segmentedResult.mask;
        if (!maskData) {
            appendLog("Received empty mask data from the server.");
            return;
        }

        // Overlay the segmentation mask onto the map
        overlaySegmentationMask(maskData);
        appendLog('Segmentation completed and displayed.');

    } catch (error) {
        appendLog(`Error in segmentation: ${error.message}`);
    }
  };

  useEffect(() => {
    if (map) {
      // Remove existing image layer if any
      if (imageLayer) {
        map.removeLayer(imageLayer);
      }
  
      const tileLayer = new TileLayer({
        source: new XYZ({
          url: 'http://localhost:8000/{z}/{x}/{y}.jpeg', // Update with your tile server URL
          crossOrigin: 'anonymous',
          tileSize: 256,
          maxZoom: 10, // Adjust based on your generated tiles
        }),
      });
  
      map.addLayer(tileLayer);
      setImageLayer(tileLayer);
    }
  }, [map]);
  
  
  useEffect(() => {
    if (map) {
      const handleMapClick = (event) => {
        if (isDrawingActive) {
          // Ignore clicks when drawing
          return;
        }
        const coordinate = event.coordinate;
        handleImageClick(coordinate);
      };
  
      map.on('click', handleMapClick);
  
      // Clean up on unmount
      return () => {
        map.un('click', handleMapClick);
      };
    }
  }, [map, handleImageClick, isDrawingActive]);  

  const [draw, setDraw] = useState(null);

  const addInteraction = (type) => {
    if (!map || !vectorLayer) {
      console.log('Map or vectorLayer is not available.');
      return;
    }
  
    // Remove existing interactions
    if (draw) {
      map.removeInteraction(draw);
    }
  
    // Create a new draw interaction
    const newDraw = new Draw({
      source: vectorLayer.getSource(),
      type: type, // 'Point', 'LineString', 'Polygon'
    });
  
    map.addInteraction(newDraw);
    setDraw(newDraw);
    setIsDrawingActive(true); // Set drawing active
  
    newDraw.on('drawend', (event) => {
      const feature = event.feature;
      console.log('New feature added:', feature);
  
      // After drawing ends, remove the interaction
      map.removeInteraction(newDraw);
      setDraw(null);
      setIsDrawingActive(false); // Reset drawing active state
    });
  };
  

  // Example: Start drawing points
  const startDrawingPoints = () => {
    addInteraction('Point');
  };

  // Example: Start drawing polygons
  const startDrawingPolygons = () => {
    addInteraction('Polygon');
  };

  const activatePenTool = () => {
    setIsPenActive(!isPenActive);
    setIsFirstClick(true); // Reset to first click whenever the tool is activated
    document.body.style.cursor = isPenActive ? 'default' : 'crosshair';
    appendLog(isPenActive ? 'Pen tool deactivated.' : 'Pen tool activated. Click on the image to segment a cell.');
  };

  const updateUIBasedOnStatus = (status) => {
    setXPosition(status.current_x);
    setYPosition(status.current_y);
    setZPosition(status.current_z);
    setIsLightOn(status.is_illumination_on);
    setBrightFieldIntensity(status.BF_intensity_exposure[0]);
    setBrightFieldCameraExposure(status.BF_intensity_exposure[1]);
    setFluorescence405Intensity(status.F405_intensity_exposure[0]);
    setFluorescence405CameraExposure(status.F405_intensity_exposure[1]);
    setFluorescence488Intensity(status.F488_intensity_exposure[0]);
    setFluorescence488CameraExposure(status.F488_intensity_exposure[1]);
    setFluorescence561Intensity(status.F561_intensity_exposure[0]);
    setFluorescence561CameraExposure(status.F561_intensity_exposure[1]);
    setFluorescence638Intensity(status.F638_intensity_exposure[0]);
    setFluorescence638CameraExposure(status.F638_intensity_exposure[1]);
    setFluorescence730Intensity(status.F730_intensity_exposure[0]);
    setFluorescence730CameraExposure(status.F730_intensity_exposure[1]);
    //console.log(status);
  };

  const updateParameters = async (updatedParams) => {
    if (!microscopeControl) return;
    try {
        appendLog('Updating parameters on the server...');
        const response = await microscopeControl.update_parameters_from_client(updatedParams);
        if (response.success) {
            appendLog('Parameters updated successfully.');
        } else {
            appendLog('Failed to update parameters.');
        }
    } catch (error) {
        appendLog(`Error updating parameters: ${error.message}`);
    }
};
  const channelKeyMap = {
      "0": "BF_intensity_exposure",
      "11": "F405_intensity_exposure",
      "12": "F488_intensity_exposure",
      "14": "F561_intensity_exposure",
      "13": "F638_intensity_exposure",
      "15": "F730_intensity_exposure"
  };

  const updateParametersOnServer = async (updatedParams) => {
      if (!microscopeControl) return;
      try {
          await microscopeControl.update_parameters_from_client(updatedParams);
          appendLog(`Parameters updated on server: ${JSON.stringify(updatedParams)}`);
      } catch (error) {
          appendLog(`Error updating parameters on server: ${error.message}`);
      }
  };
  

  const overlaySegmentationMask = (maskData) => {
    const extent = [0, 0, originalWidth, originalHeight];
  
    const maskSource = new ImageStatic({
      url: `data:image/png;base64,${maskData}`,
      imageExtent: extent,
      projection: map.getView().getProjection(),
    });
  
    const maskLayer = new ImageLayer({
      source: maskSource,
      opacity: 0.5, // Adjust transparency
    });
    
    // Tag the layer so it can be identified later
    maskLayer.set('isSegmentationLayer', true);

    map.addLayer(maskLayer);
  };
  
  const overlaySegmentationFeature = (coordinates) => {
    const feature = new ol.Feature({
      geometry: new ol.geom.Polygon([coordinates]),
    });
  
    vectorLayer.getSource().addFeature(feature);
  };
  

  const handleSegmentAllCells = async () => {
    if (!segmentService || !snapshotImage || !map) return;
   
    appendLog('Segmenting all cells in the image...');
    try {
      // Fetch the image data as a Blob
      const response = await fetch(snapshotImage);
      const blob = await response.blob();
  
      // Convert Blob to ArrayBuffer
      const arrayBuffer = await new Response(blob).arrayBuffer();
  
      // Convert ArrayBuffer to Uint8Array
      const uint8Array = new Uint8Array(arrayBuffer);
  
      // Use the segmentation service to segment all cells
      const segmentedResult = await segmentService.segment_all_cells(selectedModel, uint8Array);
  
      if (segmentedResult.error) {
        appendLog(`Segmentation error: ${segmentedResult.error}`);
        return;
      }
  
      // Process the masks from the segmentation result
      const masks = segmentedResult.masks;

      if (!masks || masks.length === 0) {
        appendLog("No cells found for segmentation.");
        return;
      }

      // Overlay each mask onto the map
      masks.forEach((maskData) => {
        overlaySegmentationMask(maskData);
      });
      
      appendLog('All cells segmented and displayed.');
    } catch (error) {
      appendLog(`Error in segmenting all cells: ${error.message}`);
    }
  };

  const handleResetEmbedding = async () => {
    if (!segmentService || !map) return;
  
    appendLog('Resetting embedding...');
    try {
      const result = await segmentService.reset_embedding();
      if (result) {
        appendLog('Embedding reset successfully.');
      } else {
        appendLog('No embedding was found to reset.');
      }
  
      // Remove segmentation layers from the map
      map.getLayers().getArray().slice().forEach((layer) => {
        if (layer.get('isSegmentationLayer')) {
          map.removeLayer(layer);
        }
      });
  
      // Also clear any features from the vectorLayer
      if (vectorLayer && vectorLayer.getSource()) {
        vectorLayer.getSource().clear();
      }
  
      appendLog('Segmentation overlays cleared.');
    } catch (error) {
      appendLog(`Error resetting embedding: ${error.message}`);
    }
  };
  

  const handleSimilaritySearch = async () => {
    console.log(
      snapshotImage,
      similarityService,
      numSimilarResults
    );

    if (!snapshotImage || !similarityService) {
      appendLog('No image or service available for similarity search.');
      return;
    }
    setIsLoading(true);
    appendLog('Starting similarity search...');
    try {
        // Fetch the image data as a Blob
        const response = await fetch(snapshotImage);
        const blob = await response.blob();
        // Convert Blob to ArrayBuffer
        const arrayBuffer = await new Response(blob).arrayBuffer();
        // Convert ArrayBuffer to Uint8Array
        const uint8Array = new Uint8Array(arrayBuffer);
        const imageData = {
            name: 'snapshot'
        };
        const results = await similarityService.find_similar_images(uint8Array, imageData, parseInt(numSimilarResults));
        appendLog(`Found ${results.length} similar images.`);
        // Save the results to the state
        setSearchResults(results);
    } catch (error) {
        appendLog(`Error searching for similar images: ${error.message}`);
    } finally {
        setIsLoading(false);
    }
  };

  const autoFocus = async () => {
    if (!microscopeControl) return;
    try {
      appendLog('Autofocusing...');
      await microscopeControl.auto_focus();
      appendLog('Autofocus completed.');
    } catch (error) {
      appendLog(`Error during autofocus: ${error.message}`);
    }
  };
  
  const snapImage = async () => {
    if (!microscopeControl) {
      appendLog('Microscope control is not initialized.');
      return;
    }
    try {
      appendLog('Snapping image...');
      let imageUrl = await microscopeControl.snap(
        parseInt(cameraExposure),
        parseInt(illuminationChannel),
        parseInt(illuminationIntensity)
      );
      if (!imageUrl) {
        throw new Error('Received empty image URL');
      }
  
      // Encode the URL to handle special characters
      imageUrl = encodeURI(imageUrl);
  
      // Fetch the image data with credentials
      const response = await fetch(imageUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
  
      // Convert response to Blob
      const blob = await response.blob();
  
      // Create a Blob URL
      const imageObjectURL = URL.createObjectURL(blob);
  
      setSnapshotImage(imageObjectURL);
      appendLog('Image snapped and fetched successfully.');
    } catch (error) {
      appendLog(`Error snapping image: ${error.message}`);
      console.error('Error in snapImage:', error);
    }
  };

  const moveMicroscope = useCallback(
    async (direction, multiplier) => {
      if (!microscopeControl) {
        appendLog('microscopeControl is null in moveMicroscope');
        return;
      }
      try {
        let moveX = 0,
          moveY = 0,
          moveZ = 0;
        if (direction === 'x') moveX = xMove * multiplier;
        else if (direction === 'y') moveY = yMove * multiplier;
        else if (direction === 'z') moveZ = zMove * multiplier;
  
        appendLog(`Attempting to move by: ${moveX}, ${moveY}, ${moveZ}`);
        const result = await microscopeControl.move_by_distance(
          moveX,
          moveY,
          moveZ
        );
        if (result.success) {
          appendLog(result.message);
          appendLog(
            `Moved from (${result.initial_position.x}, ${result.initial_position.y}, ${result.initial_position.z}) to (${result.final_position.x}, ${result.final_position.y}, ${result.final_position.z})`
          );
        } else {
          appendLog(`Move failed: ${result.message}`);
        }
      } catch (error) {
        appendLog(`Error in moveMicroscope: ${error.message}`);
      }
    },
    [microscopeControl, xMove, yMove, zMove]
  );

  // Add this above the return statement in MicroscopeControl
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const handleMouseDown = (event) => {
    isDraggingRef.current = true;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
  };

  const handleMouseMove = (event) => {
    if (!isDraggingRef.current) return;

    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (deltaX !== 0) moveMicroscope('x', deltaX / 10); // Adjust sensitivity
    if (deltaY !== 0) moveMicroscope('y', deltaY / 10); // Adjust sensitivity

    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      snapImage(); // Snap the image when dragging stops
    }
  };

  const moveToPosition = async () => {
      if (!microscopeControl) return;
      try {
          appendLog(`Attempting to move to position: (${xMove}, ${yMove}, ${zMove})`);
          const result = await microscopeControl.move_to_position(xMove, yMove, zMove);
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

  const toggleLight = async () => {
      if (!microscopeControl) return;
      try {
          if (!isLightOn) {
              await microscopeControl.on_illumination();
              appendLog('Light turned on.');
          } else {
              await microscopeControl.off_illumination();
              appendLog('Light turned off.');
          }
          setIsLightOn(!isLightOn);
      } catch (error) {
          appendLog(`Error toggling light: ${error.message}`);
      }
  };

  const startPlateScan = async () => {
      if (!microscopeControl) return;
      try {
          if (!isPlateScanRunning) {
              await microscopeControl.scan_well_plate();
              appendLog('Plate scan started.');
          } else {
              await microscopeControl.stop_scan();
              appendLog('Plate scan stopped.');
          }
          setIsPlateScanRunning(!isPlateScanRunning);
      } catch (error) {
          appendLog(`Error in plate scan: ${error.message}`);
      }
  };

  const setIllumination = async () => {
      if (!microscopeControl) return;
      try {
          await microscopeControl.set_illumination(
              parseInt(illuminationChannel),
              parseInt(illuminationIntensity)
          );
          appendLog(`Illumination set: Channel ${illuminationChannel}, Intensity ${illuminationIntensity}%`);
      } catch (error) {
          appendLog(`Error setting illumination: ${error.message}`);
      }
  };

  const setCameraExposureTime = async () => {
      if (!microscopeControl) return;
      try {
          await microscopeControl.set_camera_exposure(parseInt(cameraExposure));
          appendLog(`Camera exposure set to ${cameraExposure}ms`);
      } catch (error) {
          appendLog(`Error setting camera exposure: ${error.message}`);
      }
  };

  const openChatbot = useCallback(
    async () => {
      if (!microscopeControl) return;
  
      try {
        // Ensure HyphaCore is initialized
        if (!window.hyphaCore || !window.hyphaApi) {
          appendLog('HyphaCore is not initialized.');
          return;
        }
  
        if (window.chatbotWindow && !window.chatbotWindow.closed) {
          // If the window is minimized, restore it
          if (window.chatbotWindow.minimized) {
            window.chatbotWindow.restore();
          } else {
            // Bring the window to front
            window.chatbotWindow.focus();
          }
        } else {
          appendLog('Opening chatbot window...');
          const url = await microscopeControl.get_chatbot_url();
          window.chatbotWindow = await window.hyphaApi.createWindow({
            src: url,
            name: 'Chatbot',
          });
        }
      } catch (error) {
        appendLog(`Failed to open chatbot window: ${error.message}`);
      }
    },
    [microscopeControl, appendLog]
  );
  

  return (
    <div className="main-container">
      {/* Image Display Window */}
      <div id="image-display">
        {snapshotImage ? (
          <div
          ref={mapRef}
          style={{ width: '100%', height: '100%' }}
        ></div>
        ) : (
          <p className="placeholder-text">Image Display</p>
        )}  

        {/* Toggle Control Section Button */}
        <button
          className="settings-button"
          onClick={() => setIsControlSectionOpen(!isControlSectionOpen)}
        >
          <i className="fas fa-cog icon"></i>
        </button>

        <button
          id="search-similar-images"
          className="search-button"
          onClick={handleSimilaritySearch}
          disabled={!snapshotImage}
        >
          <i className="fas fa-search icon"></i> Search Similar 
        </button>

        <select
          id="segmentation-model"
          className="segmentation_model-button"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          <option value="vit_b_lm">ViT-B LM</option>
          <option value="vit_l_lm">ViT-L LM</option>
          <option value="vit_b">ViT-B</option>
          <option value="vit_b_em_organelles">ViT-B EM Organelles</option>
        </select>

        <button className="segment_cell-button" onClick={activatePenTool}>
          <i className={`fas ${isPenActive ? "fa-pencil-alt icon" : "fa-magic icon"}`}></i>
        </button>
        <button
          className="segment_all_cells-button"
          onClick={handleSegmentAllCells}
          disabled={!snapshotImage || !segmentService}
        >
        <i className="fas fa-layer-group icon"></i>
        </button>

        <button
          className="add_point-button"
          onClick={startDrawingPoints}
        >
        <i className="fas fa-map-marker-alt icon"></i>
        </button>

        <button
          className="add_polygon-button"
          onClick={startDrawingPolygons}
        >
        <i className="fas fa-draw-polygon icon"></i>
        </button>

        {/* Chatbot Button */}
        <button
        id="open-chatbot"
        className="chatbot-button"
        onClick={openChatbot}
        >
        <i className="fas fa-comments icon"></i>
        </button>
      </div>

      {/* Control Panel Section */}
{isControlSectionOpen && (
  <div id="control-chat-section">
    <h3 className="section-title">Manual Control</h3>
    <div id="manual-control-content">

      {/* Illumination Settings */}
      <div className="illumination-settings">
        {/* Illumination Intensity */}
        <div className="illumination-intensity">
          <div className="intensity-label-row">
            <label>Illumination Intensity:</label>
            <span>{illuminationIntensity}%</span>
          </div>
          <input
            type="range"
            className="control-input"
            min="0"
            max="100"
            value={illuminationIntensity}
            onChange={(e) => {
              const newIntensity = parseInt(e.target.value, 10);
              setIlluminationIntensity(newIntensity);
              const key = channelKeyMap[illuminationChannel];
              if (key) {
                updateParametersOnServer({
                  [key]: [newIntensity, cameraExposure],
                });
              }
              setIllumination(); // Call setIllumination when intensity changes
            }}
          />
        </div>

        {/* Illumination Channel */}
        <div className="illumination-channel">
          <label>Illumination Channel:</label>
          <select
            className="control-input"
            value={illuminationChannel}
            onChange={(e) => {
              setIlluminationChannel(e.target.value);
              setIllumination(); // Call setIllumination when channel changes
            }}
          >
            <option value="0">BF LED matrix full</option>
            <option value="11">Fluorescence 405 nm Ex</option>
            <option value="12">Fluorescence 488 nm Ex</option>
            <option value="13">Fluorescence 638 nm Ex</option>
            <option value="14">Fluorescence 561 nm Ex</option>
            <option value="15">Fluorescence 730 nm Ex</option>
          </select>
        </div>
      </div>

      {/* Camera Exposure Settings */}
      <div className="camera-exposure-settings">
        <label>Camera Exposure:</label>
        <input
          type="number"
          className="control-input camera-exposure-input"
          value={cameraExposure}
          onChange={(e) => {
            const newExposure = parseInt(e.target.value, 10);
            setCameraExposure(newExposure);
            const key = channelKeyMap[illuminationChannel];
            if (key) {
              updateParametersOnServer({
                [key]: [illuminationIntensity, newExposure],
              });
            }
          }}
        />
      </div>

      {/* Control Buttons */}
<div className="control-group">
  {/* First Row of Buttons */}
  <div className="horizontal-buttons">
    <button
      className="control-button"
      onClick={toggleLight}
      disabled={!microscopeControl}
    >
      <i className="fas fa-lightbulb icon"></i> {isLightOn ? 'Turn Light Off' : 'Turn Light On'}
    </button>
    <button
      className="control-button"
      onClick={autoFocus}
      disabled={!microscopeControl}
    >
      <i className="fas fa-crosshairs icon"></i> Autofocus
    </button>
  </div>

  {/* Second Row of Buttons */}
  <div className="horizontal-buttons" style={{ marginTop: '15px' }}>
    <button
      className="control-button snap-button"
      onClick={snapImage}
      disabled={!microscopeControl}
    >
      <i className="fas fa-camera icon"></i> Snap Image
    </button>
    <button
      className="control-button reset-button"
      onClick={handleResetEmbedding}
      disabled={!segmentService}
    >
      <i className="fas fa-sync icon"></i> Reset
    </button>
  </div>
</div>

    </div>
  </div>
)}

      
      {/* Log Section */}
      <div id="log-section">
        <h3>Log</h3>
        <div className="log-content">
          <pre id="log-text">{log}</pre>
        </div>
      </div>
    </div>
  );
};

// Render the application
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<MicroscopeControl />);
