import { Map, View } from 'ol';
import { TileGrid } from 'ol/tilegrid';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { defaults as defaultControls, FullScreen, ZoomSlider } from 'ol/control';
import { Style, Stroke, Fill, Circle as CircleStyle } from 'ol/style';
import 'ol/ol.css';

// Define custom image dimensions and resolutions
const imageWidth = 20000;      // Width of the full image
const imageHeight = 20000;     // Height of the full image
// Extended resolutions to include higher zoom levels
const resolutions = [1, 1/4, 1/16, 1/64, 1/256, 1/1024]; // Added scale 4 and 5

// Store dynamic tile sizes for higher zoom levels
const dynamicTileSizes = {
  0: 2048, // Scale 0
  1: 2048, // Scale 1
  2: 2048, // Scale 2
  3: 2048, // Scale 3
  // Higher levels will be populated dynamically
};

export const makeMap = (mapRef, extent) => {
  // Use provided extent or default to our custom extent based on image dimensions
  const customExtent = extent || [0, 0, imageWidth, imageHeight];

  // Create a custom tile grid matching our resolution levels and extent
  const tileGrid = new TileGrid({
    extent: customExtent,
    resolutions: resolutions,
    tileSize: 2048, // Default tile size for lower zoom levels
  });

  // Create the map view with the center at the middle of the image
  const view = new View({
    center: [3000, imageHeight-1000],
    zoom: 0,
    minZoom: 0,
    maxZoom: resolutions.length - 1, // Allow all zoom levels defined in resolutions
    resolutions: resolutions,
  });

  return new Map({
    target: mapRef.current,
    layers: [],
    view: view,
    controls: defaultControls().extend([new ZoomSlider(), new FullScreen()]),
  });
};

// Export a getter for the custom tile grid
export const getTileGrid = () =>
  new TileGrid({
    extent: [0, 0, imageWidth, imageHeight],
    resolutions: resolutions,
    tileSize: 2048, // Default tile size for lower zoom levels
  });

// Function to update dynamic tile sizes for higher zoom levels
export const updateDynamicTileSizes = (zoomLevel, width, height) => {
  dynamicTileSizes[zoomLevel] = Math.max(width, height);
  console.log(`Updated dynamic tile size for zoom level ${zoomLevel}: ${dynamicTileSizes[zoomLevel]}`);
};

// Function to get the tile size for a specific zoom level
export const getTileSizeForZoom = (zoomLevel) => {
  return dynamicTileSizes[zoomLevel] || 2048;
};

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