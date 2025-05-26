import React from 'react';
import PropTypes from 'prop-types';

const MapButton = ({ onClick, icon, bottom = null, top = null, right = null, left = null, disabled = false, className = '', title = '', style = {} }) => {
    return (
        <button
            className={`absolute w-8 h-8 z-40 bg-blue-600 text-white border-none rounded-md text-xs font-medium cursor-pointer shadow-inner transition-all duration-300 ease-in-out hover:bg-blue-800 hover:shadow-xl hover:translate-y-[-2px] ${className}`}
            style={{
                top: top !== null ? `${top}px` : 'auto',
                bottom: bottom !== null ? `${bottom}px` : 'auto',
                right: right !== null ? `${right}px` : (left === null ? '10px' : 'auto'),
                left: left !== null ? `${left}px` : 'auto',
                ...style
            }}
            onClick={onClick}
            disabled={disabled}
            title={title}
        >
            <i className={`fas ${icon} icon`}></i>
        </button>
    )
}

MapButton.propTypes = {
    onClick: PropTypes.func.isRequired,
    icon: PropTypes.string.isRequired,
    top: PropTypes.string,
    bottom: PropTypes.string,
    right: PropTypes.string,
    left: PropTypes.string,
    disabled: PropTypes.bool,
    className: PropTypes.string,
    title: PropTypes.string,
    style: PropTypes.object
};

export default MapButton;
