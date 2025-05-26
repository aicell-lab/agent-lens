import React from 'react';
import PropTypes from 'prop-types';
import MapButton from './MapButton';

const PenButton = ({ appendLog, setIsFirstClick, snapshotImage, isPenActive, setIsPenActive, isProcessing, top }) => {
    
    const activatePenTool = () => {
        if (!snapshotImage && !isPenActive) {
            appendLog('Ready to segment. Click on the image to capture a 512×512 area and segment it.');
        }
        
        setIsPenActive(!isPenActive);
        setIsFirstClick(true); // Reset to first click whenever the tool is activated
        document.body.style.cursor = isPenActive ? 'default' : 'crosshair';
        
        if (!isPenActive) {
            appendLog('Pen tool activated. Click on the image to segment a cell.');
        } else {
            appendLog('Pen tool deactivated.');
        }
    };
    
    // Use different styling for active state without hiding the button
    const buttonStyle = isPenActive 
        ? { backgroundColor: '#9333ea', boxShadow: '0 0 0 2px white, 0 0 0 4px #22c55e' }
        : {};
    
    return (
        <MapButton 
            onClick={activatePenTool} 
            icon={isPenActive ? "fa-pencil-alt" : "fa-magic"} 
            top={top}
            disabled={isProcessing}
            style={buttonStyle}
            title={isPenActive ? "Deactivate segmentation tool" : "Activate segmentation tool"}
        />
    );
}

// Props validation
PenButton.propTypes = {
    appendLog: PropTypes.func.isRequired,
    setIsFirstClick: PropTypes.func.isRequired,
    snapshotImage: PropTypes.string,
    isPenActive: PropTypes.bool.isRequired,
    setIsPenActive: PropTypes.func.isRequired,
    isProcessing: PropTypes.bool,
    top: PropTypes.string,
};

export default PenButton;
