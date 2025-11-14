/**
 * Agent Settings Component
 * Settings panel for configuring OpenAI API key
 */

import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const STORAGE_KEY = 'agent_lens_openai_api_key';
const STORAGE_BASE_URL_KEY = 'agent_lens_openai_base_url';
const STORAGE_MODEL_KEY = 'agent_lens_openai_model';
const STORAGE_TEMPERATURE_KEY = 'agent_lens_openai_temperature';

// Available OpenAI models with configuration (ordered by speed, fastest first)
const AVAILABLE_MODELS = [
  { 
    value: 'gpt-5-mini', 
    label: 'GPT-5 Mini (Fastest)',
    supportsTemperature: true,
    defaultTemperature: 1.0,
    temperatureFixed: true
  },
  {
    value: 'gpt-5.1',
    label: 'GPT-5.1 (Best for long context)',
    supportsTemperature: true,
    defaultTemperature: 1.0,
    temperatureFixed: true
  },
  { 
    value: 'gpt-5', 
    label: 'GPT-5 (Standard)',
    supportsTemperature: true,
    defaultTemperature: 1.0,
    temperatureFixed: true
  },
  { 
    value: 'o3-mini', 
    label: 'O3 Mini',
    supportsTemperature: false,
    defaultTemperature: null,
    temperatureFixed: false
  },
  { 
    value: 'gpt-4o', 
    label: 'GPT-4o',
    supportsTemperature: true,
    defaultTemperature: 0.7,
    temperatureFixed: false
  },
  { 
    value: 'gpt-4o-mini', 
    label: 'GPT-4o Mini',
    supportsTemperature: true,
    defaultTemperature: 0.7,
    temperatureFixed: false
  },
  { 
    value: 'gpt-4-turbo', 
    label: 'GPT-4 Turbo',
    supportsTemperature: true,
    defaultTemperature: 0.7,
    temperatureFixed: false
  },
  { 
    value: 'gpt-4', 
    label: 'GPT-4',
    supportsTemperature: true,
    defaultTemperature: 0.7,
    temperatureFixed: false
  },
];

// Helper: Get model config
const getModelConfig = (modelValue) => {
  return AVAILABLE_MODELS.find(m => m.value === modelValue) || null;
};

const AgentSettings = ({ isOpen, onClose }) => {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1/');
  const [model, setModel] = useState('gpt-5-mini');
  const [temperature, setTemperature] = useState(1.0);
  const [showKey, setShowKey] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem(STORAGE_KEY) || '';
    const savedBaseURL = localStorage.getItem(STORAGE_BASE_URL_KEY) || 'https://api.openai.com/v1/';
    const savedModel = localStorage.getItem(STORAGE_MODEL_KEY) || 'gpt-5-mini';
    const modelConfig = getModelConfig(savedModel);
    const savedTemp = localStorage.getItem(STORAGE_TEMPERATURE_KEY);
    const defaultTemp = modelConfig?.defaultTemperature ?? 0.7;
    setApiKey(savedKey);
    setBaseURL(savedBaseURL);
    setModel(savedModel);
    setTemperature(savedTemp !== null ? parseFloat(savedTemp) : defaultTemp);
  }, []);

  // Update temperature when model changes
  useEffect(() => {
    const modelConfig = getModelConfig(model);
    if (modelConfig?.temperatureFixed) {
      // Fixed temperature models: always use their default
      setTemperature(modelConfig.defaultTemperature);
    } else if (modelConfig?.supportsTemperature && modelConfig.defaultTemperature !== undefined) {
      // For models with adjustable temperature, update to model's default when switching
      // This ensures GPT-4 models get 0.5, GPT-5 models get 1.0, etc.
      setTemperature(modelConfig.defaultTemperature);
    }
  }, [model]);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, apiKey);
    localStorage.setItem(STORAGE_BASE_URL_KEY, baseURL);
    localStorage.setItem(STORAGE_MODEL_KEY, model);
    const modelConfig = getModelConfig(model);
    if (modelConfig?.supportsTemperature) {
      const tempToSave = modelConfig.temperatureFixed ? modelConfig.defaultTemperature : temperature;
      localStorage.setItem(STORAGE_TEMPERATURE_KEY, tempToSave.toString());
    }
    if (onClose) {
      onClose();
    }
  };

  const handleClear = () => {
    setApiKey('');
    setBaseURL('https://api.openai.com/v1/');
    setModel('gpt-5-mini');
    setTemperature(1.0);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_BASE_URL_KEY);
    localStorage.removeItem(STORAGE_MODEL_KEY);
    localStorage.removeItem(STORAGE_TEMPERATURE_KEY);
  };

  if (!isOpen) return null;

  return (
    <div className="agent-settings-overlay" onClick={onClose}>
      <div className="agent-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="agent-settings-header">
          <h3>
            <i className="fas fa-cog"></i> Agent Settings
          </h3>
          <button 
            className="agent-settings-close" 
            onClick={onClose}
            title="Close settings"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="agent-settings-content">
          <div className="agent-settings-section">
            <label htmlFor="api-key">
              <i className="fas fa-key"></i> OpenAI API Key
            </label>
            <div className="agent-settings-input-group">
              <input
                id="api-key"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="agent-settings-input"
              />
              <button
                type="button"
                className="agent-settings-toggle"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                <i className={`fas ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              </button>
            </div>
            <p className="agent-settings-help">
              Your API key is stored locally in your browser and never sent to our servers.
              Get your key from{' '}
              <a 
                href="https://platform.openai.com/account/api-keys" 
                target="_blank" 
                rel="noopener noreferrer"
              >
                OpenAI Platform
              </a>
            </p>
          </div>

          <div className="agent-settings-section">
            <label htmlFor="base-url">
              <i className="fas fa-link"></i> API Base URL (Optional)
            </label>
            <input
              id="base-url"
              type="text"
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.openai.com/v1/"
              className="agent-settings-input"
            />
            <p className="agent-settings-help">
              Leave as default unless using a custom OpenAI-compatible API endpoint
            </p>
          </div>

          <div className="agent-settings-section">
            <label htmlFor="model">
              <i className="fas fa-brain"></i> Model
            </label>
            <select
              id="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="agent-settings-input"
            >
              {AVAILABLE_MODELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="agent-settings-help">
              Choose the model to use. GPT-5 Mini is fastest, GPT-5 Standard provides deeper reasoning but may be slower, and GPT-4o offers a good balance.
            </p>
          </div>

          {(() => {
            const modelConfig = getModelConfig(model);
            if (!modelConfig?.supportsTemperature) return null;
            
            return (
              <div className="agent-settings-section">
                <label htmlFor="temperature">
                  <i className="fas fa-thermometer-half"></i> Temperature
                  {modelConfig.temperatureFixed && (
                    <span className="agent-settings-locked-badge" title="Fixed temperature for this model">
                      <i className="fas fa-lock"></i> Fixed at {modelConfig.defaultTemperature}
                    </span>
                  )}
                </label>
                <input
                  id="temperature"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)))}
                  disabled={modelConfig.temperatureFixed}
                  className={`agent-settings-input ${modelConfig.temperatureFixed ? 'agent-settings-input-disabled' : ''}`}
                  style={{
                    opacity: modelConfig.temperatureFixed ? 0.6 : 1,
                    cursor: modelConfig.temperatureFixed ? 'not-allowed' : 'text'
                  }}
                />
                <p className="agent-settings-help">
                  {modelConfig.temperatureFixed
                    ? `${modelConfig.label} requires temperature = ${modelConfig.defaultTemperature} and cannot be adjusted.`
                    : 'Controls randomness in responses (0 = deterministic, 2 = very creative).'}
                </p>
              </div>
            );
          })()}
        </div>

        <div className="agent-settings-footer">
          <button 
            className="agent-settings-button agent-settings-button-clear"
            onClick={handleClear}
          >
            <i className="fas fa-trash"></i> Clear
          </button>
          <button 
            className="agent-settings-button agent-settings-button-save"
            onClick={handleSave}
            disabled={!apiKey.trim()}
          >
            <i className="fas fa-save"></i> Save
          </button>
        </div>
      </div>
    </div>
  );
};

AgentSettings.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired
};

export default AgentSettings;

