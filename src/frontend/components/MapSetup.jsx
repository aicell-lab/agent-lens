import { Map, View } from 'ol';
import { Projection, addProjection } from 'ol/proj';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import 'ol/ol.css';
// import { isLocal } from '../utils';

export const makeMap = (mapRef, extent) => {
  const projection = new Projection({
    code: 'deepzoom-image',
    units: 'pixels',
    extent: extent,
  });

  addProjection(projection);

  return new Map({
    target: mapRef.current,
    layers: [],
    view: new View({
      projection: 'deepzoom-image',
      center: [extent[2] / 2, extent[3] / 2],
      zoom: 2,
      minZoom: 0,
      maxZoom: 10,
    }),
  });
};

export const addMapMask = (mapCurrent, setVectorLayer) => {
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

  mapCurrent.addLayer(newVectorLayer);
  setVectorLayer(newVectorLayer);
};