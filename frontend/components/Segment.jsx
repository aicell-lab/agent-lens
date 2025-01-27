import ImageStatic from 'ol/source/ImageStatic';
import ImageLayer from 'ol/layer/Image';

export const getSnapshotArray = async (snapshotImage) => {
    const response = await fetch(snapshotImage);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    return new Uint8Array(arrayBuffer);
};

export const overlaySegmentationMask = (maskData, map, extent) => {
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