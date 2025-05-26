import React from 'react';
import PropTypes from 'prop-types';
import { getSnapshotArray, overlaySegmentationMask } from './Segment';

const SegmentButton = ({ appendLog, snapshotImage, segmentService, map, extent, selectedModel, setSelectedModel, vectorLayer }) => {

    const handleSegmentAllCells = async () => {
        if (!segmentService || !snapshotImage || !map) return;
    
        appendLog('Segmenting all cells in the image...');
        try {
          const response = await getSnapshotArray(snapshotImage);
          const segmentedResult = await segmentService.segment_all_cells(selectedModel, response);
    
          if (segmentedResult.error) {
            appendLog(`Segmentation error: ${segmentedResult.error}`);
            return;
          }
    
          const masks = segmentedResult.masks;
    
          if (!masks || masks.length === 0) {
            appendLog("No cells found for segmentation.");
            return;
          }
    
          masks.forEach((maskData) => {
            overlaySegmentationMask(maskData, map, extent);
          });
    
          appendLog('All cells segmented and displayed.');
        } catch (error) {
          appendLog(`Error in segmenting all cells: ${error.message}`);
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

    return (
      <>
        <select
          className="absolute right-1 p-0.5 z-40 w-24 bg-blue-600 text-white border-none rounded-md text-sm font-medium cursor-pointer shadow-inner transition-all duration-300 ease-in-out hover:bg-blue-800 hover:shadow-xl hover:translate-y-[-2px]"
          style={{ top: '60px' }}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          <option value="vit_b_lm">ViT-B LM</option>
          <option value="vit_l_lm">ViT-L LM</option>
          <option value="vit_b">ViT-B</option>
          <option value="vit_b_em_organelles">ViT-B EM Organelles</option>
        </select>
        <button
          className="absolute w-16 h-8 z-40 bg-blue-600 text-white border-none rounded-md text-xs font-medium cursor-pointer shadow-inner transition-all duration-300 ease-in-out hover:bg-blue-800 hover:shadow-xl hover:translate-y-[-2px]"
          style={{ top: '110px', right: '10px' }}
          onClick={handleSegmentAllCells}
          disabled={!snapshotImage || !segmentService}
          title={!snapshotImage ? "Please capture an image from the Microscope Control panel first" : "Auto Segment"}
        >
          Auto Segment
        </button>

      </>
    );
};

SegmentButton.propTypes = {
    appendLog: PropTypes.func.isRequired,
    snapshotImage: PropTypes.string,
    segmentService: PropTypes.object,
    map: PropTypes.object,
    extent: PropTypes.array.isRequired,
    selectedModel: PropTypes.string,
    setSelectedModel: PropTypes.func.isRequired,
    vectorLayer: PropTypes.object,
};

export default SegmentButton;