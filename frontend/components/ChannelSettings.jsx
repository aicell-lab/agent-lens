import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { rgbToHex } from './utils';
// Import with a fallback for the color picker
let SketchPicker;
try {
  // Dynamic import with fallback
  const ReactColor = require('react-color');
  SketchPicker = ReactColor.SketchPicker;
} catch (e) {
  // Fallback implementation if react-color is not available
  console.warn('react-color package not found, using fallback color picker');
  SketchPicker = ({ color, onChange }) => (
    <div className="fallback-color-picker">
      <input
        type="color"
        value={color}
        onChange={(e) => onChange({ hex: e.target.value })}
        style={{ width: '100%', height: '30px' }}
      />
    </div>
  );
}

const ChannelSettings = ({ 
  selectedChannels,
  channelColors,
  onSettingsChange,
  onClose,
  initialSettings = {}
}) => {
  // Channel settings state with defaults
  const [settings, setSettings] = useState({});
  const [activeTab, setActiveTab] = useState('0');
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Get a stringified version of initialSettings to detect deep changes
  const initialSettingsKey = JSON.stringify(initialSettings);

  useEffect(() => {
    // Initialize settings with defaults or passed in initial values
    const initializedSettings = {};
    
    selectedChannels.forEach(channelKey => {
      const channelKeyStr = channelKey.toString();
      const channelInitialSettings = initialSettings.contrast && 
                                     initialSettings.brightness && 
                                     initialSettings.threshold && 
                                     initialSettings.color 
                                     ? {
                                         contrast: initialSettings.contrast[channelKeyStr] || 0,
                                         brightness: initialSettings.brightness[channelKeyStr] || 1.0,
                                         threshold: {
                                           min: initialSettings.threshold[channelKeyStr]?.min || 2,
                                           max: initialSettings.threshold[channelKeyStr]?.max || 98,
                                         },
                                         color: initialSettings.color[channelKeyStr] 
                                           ? rgbToHex(initialSettings.color[channelKeyStr]) 
                                           : rgbToHex(channelColors[channelKey] || [255, 255, 255])
                                       }
                                     : {
                                         contrast: 0,
                                         brightness: 1.0,
                                         threshold: {
                                           min: 2,
                                           max: 98,
                                         },
                                         color: rgbToHex(channelColors[channelKey] || [255, 255, 255])
                                       };
      
      initializedSettings[channelKeyStr] = channelInitialSettings;
    });
    
    setSettings(initializedSettings);
    
    // Set active tab to first selected channel
    if (selectedChannels.length > 0 && !settings[selectedChannels[0].toString()]) {
      setActiveTab(selectedChannels[0].toString());
    }
  }, [selectedChannels, initialSettingsKey]); // Add initialSettingsKey to dependency array

  // Convert hex color to RGB array
  const hexToRgb = (hex) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? [
      parseInt(result[1], 16),
      parseInt(result[2], 16),
      parseInt(result[3], 16)
    ] : [255, 255, 255];
  };

  const handleSettingChange = (channelKey, settingKey, value) => {
    const updatedSettings = { ...settings };
    
    if (settingKey === 'threshold_min') {
      updatedSettings[channelKey].threshold.min = value;
    } else if (settingKey === 'threshold_max') {
      updatedSettings[channelKey].threshold.max = value;
    } else if (settingKey === 'color') {
      updatedSettings[channelKey].color = value;
    } else {
      updatedSettings[channelKey][settingKey] = value;
    }
    
    setSettings(updatedSettings);
    
    // Convert settings to format expected by backend
    const processedSettings = {
      contrast: {},
      brightness: {},
      threshold: {},
      color: {}
    };
    
    Object.entries(updatedSettings).forEach(([channelKey, channelSettings]) => {
      processedSettings.contrast[channelKey] = channelSettings.contrast;
      processedSettings.brightness[channelKey] = channelSettings.brightness;
      processedSettings.threshold[channelKey] = channelSettings.threshold;
      processedSettings.color[channelKey] = hexToRgb(channelSettings.color);
    });
    
    onSettingsChange(processedSettings);
  };

  const handleColorChange = (color) => {
    handleSettingChange(activeTab, 'color', color.hex);
  };

  const channelLabels = {
    '0': 'Brightfield',
    '11': '405nm (Violet)',
    '12': '488nm (Green)',
    '14': '561nm (Red-Orange)',
    '13': '638nm (Deep Red)'
  };

  const resetChannelSettings = (channelKey) => {
    const defaultSettings = {
      contrast: 0,
      brightness: 1.0,
      threshold: {
        min: 2,
        max: 98
      },
      color: rgbToHex(channelColors[parseInt(channelKey)] || [255, 255, 255])
    };
    
    const updatedSettings = { ...settings };
    updatedSettings[channelKey] = defaultSettings;
    setSettings(updatedSettings);
    
    // Update parent component
    const processedSettings = {
      contrast: {},
      brightness: {},
      threshold: {},
      color: {}
    };
    
    Object.entries(updatedSettings).forEach(([channelKey, channelSettings]) => {
      processedSettings.contrast[channelKey] = channelSettings.contrast;
      processedSettings.brightness[channelKey] = channelSettings.brightness;
      processedSettings.threshold[channelKey] = channelSettings.threshold;
      processedSettings.color[channelKey] = hexToRgb(channelSettings.color);
    });
    
    onSettingsChange(processedSettings);
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 w-full max-w-md">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Channel Settings</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <i className="fas fa-times"></i>
        </button>
      </div>
      
      {/* Channel tabs */}
      <div className="flex mb-4 overflow-x-auto">
        {selectedChannels.map(channelKey => (
          <button
            key={channelKey}
            className={`px-3 py-2 rounded-t-lg mr-1 ${activeTab === channelKey.toString() 
              ? 'bg-blue-100 border-b-2 border-blue-500 font-medium' 
              : 'bg-gray-50 hover:bg-gray-100'}`}
            onClick={() => setActiveTab(channelKey.toString())}
            style={{
              color: channelKey === 0 ? '#333' : settings[channelKey.toString()]?.color || '#333'
            }}
          >
            {channelLabels[channelKey.toString()] || `Channel ${channelKey}`}
          </button>
        ))}
      </div>
      
      {/* Settings for active channel */}
      {activeTab && settings[activeTab] && (
        <div className="space-y-4 p-2">
          {/* Brightness */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Brightness: {settings[activeTab].brightness.toFixed(1)}
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={settings[activeTab].brightness}
              onChange={(e) => handleSettingChange(activeTab, 'brightness', parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0.5</span>
              <span>2.0</span>
            </div>
          </div>
          
          {/* Contrast */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Contrast: {settings[activeTab].contrast.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="0.1"
              step="0.01"
              value={settings[activeTab].contrast}
              onChange={(e) => handleSettingChange(activeTab, 'contrast', parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>None (0)</span>
              <span>(0.1) More</span>
            </div>
          </div>
          
          {/* Threshold */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Min Threshold: {settings[activeTab].threshold.min}%
            </label>
            <input
              type="range"
              min="0"
              max="49"
              value={settings[activeTab].threshold.min}
              onChange={(e) => handleSettingChange(activeTab, 'threshold_min', parseInt(e.target.value))}
              className="w-full"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Max Threshold: {settings[activeTab].threshold.max}%
            </label>
            <input
              type="range"
              min="51"
              max="100"
              value={settings[activeTab].threshold.max}
              onChange={(e) => handleSettingChange(activeTab, 'threshold_max', parseInt(e.target.value))}
              className="w-full"
            />
          </div>
          
          {/* Color picker (for non-brightfield channels) */}
          {parseInt(activeTab) !== 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Channel Color
              </label>
              <div className="flex items-center">
                <div 
                  className="w-10 h-10 rounded-md border cursor-pointer"
                  style={{ backgroundColor: settings[activeTab].color }}
                  onClick={() => setShowColorPicker(!showColorPicker)}
                ></div>
                <span className="ml-2 text-gray-600">{settings[activeTab].color}</span>
              </div>
              
              {showColorPicker && (
                <div className="absolute mt-2 z-10">
                  <div 
                    className="fixed inset-0" 
                    onClick={() => setShowColorPicker(false)}
                  ></div>
                  <SketchPicker
                    color={settings[activeTab].color}
                    onChange={handleColorChange}
                  />
                </div>
              )}
            </div>
          )}
          
          {/* Reset button */}
          <div className="mt-4">
            <button
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-3 rounded text-sm"
              onClick={() => resetChannelSettings(activeTab)}
            >
              Reset to Default
            </button>
          </div>
        </div>
      )}
      
      <div className="mt-4 flex justify-end">
        <button
          className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
};

ChannelSettings.propTypes = {
  selectedChannels: PropTypes.array.isRequired,
  channelColors: PropTypes.object.isRequired,
  onSettingsChange: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  initialSettings: PropTypes.object
};

export default ChannelSettings; 