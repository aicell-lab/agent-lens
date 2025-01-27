import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import DrawButton from './DrawButton';
import PenButton from './PenButton';
import SegmentControls from './SegmentControls';
import { getSnapshotArray, overlaySegmentationMask } from './Segment';

const MapInteractions = ({ segmentService, snapshotImage, map, extent, appendLog, vectorLayer }) => {
  const [isFirstClick, setIsFirstClick] = useState(true); // Track if it's the first click for segmentation
  const [isDrawingActive, setIsDrawingActive] = useState(false);
  const [selectedModel, setSelectedModel] = useState('vit_b_lm');

  useEffect(() => {
    if (map) {
      map.on('click', async (event) => {
          if (isDrawingActive) {
              return;
          }
          await handleImageClick(event.coordinate)
      });

      return () => {
        map.un('click');
      };
    }
  }, [map]);

  const getSegmentedResult = async (pointCoordinates, snapshotArray) => {
    if (isFirstClick) {
        return await segmentService.compute_embedding_with_initial_segment(
            selectedModel,
            snapshotArray,
            [pointCoordinates],
            [1]
        );
    } else {
        return await segmentService.segment_with_existing_embedding(
            snapshotArray,
            [pointCoordinates],
            [1]
        );
    }
  };

  const handleImageClick = async (pointCoordinates) => {
    appendLog(`Clicked at coordinates: (${pointCoordinates[0]}, ${pointCoordinates[1]})`);

    const snapshotArray = await getSnapshotArray(snapshotImage)
    const segmentedResult = await getSegmentedResult(pointCoordinates, snapshotArray);

    if (segmentedResult.error) {
        appendLog(`Segmentation error: ${segmentedResult.error}`);
        return;
    }

    overlaySegmentationMask(segmentedResult.mask, map, extent);
    appendLog('Segmentation completed and displayed.');
  };

  return (
    <>
      <PenButton appendLog={appendLog} setIsFirstClick={setIsFirstClick} />
      <SegmentControls segmentService={segmentService} snapshotImage={snapshotImage} selectedModel={selectedModel} setSelectedModel={setSelectedModel} map={map} extent={extent} appendLog={appendLog} />
      <DrawButton drawType="Point" icon="fa-map-marker-alt" top="520" map={map} vectorLayer={vectorLayer} setIsDrawingActive={setIsDrawingActive} />
      <DrawButton drawType="Polygon" icon="fa-draw-polygon" top="570" map={map} vectorLayer={vectorLayer} setIsDrawingActive={setIsDrawingActive} />
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
  selectedModel: PropTypes.string,
};

export default MapInteractions;