import { Map, View } from 'ol';
import { TileGrid } from 'ol/tilegrid';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { defaults as defaultControls, FullScreen, ZoomSlider } from 'ol/control';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style'; // Added missing imports
import 'ol/ol.css';

// Define custom image dimensions and resolutions (from the sample HTML)
const imageWidth = 2048;      // Width of the full image
const imageHeight = 1280;     // Height of the full image
const resolutions = [1, 1/4, 1/16, 1/64, 1/256]; // Updated to support 5 scales

export const makeMap = (mapRef, extent) => {
  // Use provided extent or default to our custom extent based on image dimensions
  const customExtent = extent || [0, 0, imageWidth, imageHeight];

  // Create a custom tile grid matching our resolution levels and extent
  const tileGrid = new TileGrid({
    extent: customExtent,
    resolutions: resolutions,
    tileSize: 256,
  });

  // Create the map view with the center at the middle of the image
  const view = new View({
    center: [
      imageWidth/2,
      imageHeight/2,
    ],
    zoom: 0,
    minZoom: 0,
    maxZoom: resolutions.length - 1,
    resolutions: resolutions,
    maxResolution: 16,
  });

  return new Map({
    target: mapRef.current,
    layers: [],
    view: view,
    controls: defaultControls().extend([new ZoomSlider(), new FullScreen()]),
    // Set black background for the entire map container
    background: 'black',
  });
};

// Export a getter for the custom tile grid
export const getTileGrid = () =>
  new TileGrid({
    extent: [0, 0, imageWidth, imageHeight],
    resolutions: resolutions,
    tileSize: 256,
  });

export const addMapMask = (map, setVectorLayer) => {
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
};