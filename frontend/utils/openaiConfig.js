/**
 * OpenAI Configuration Utility
 * Handles loading and retrieving OpenAI API configuration from localStorage
 */

const STORAGE_KEY = 'agent_lens_openai_api_key';
const STORAGE_BASE_URL_KEY = 'agent_lens_openai_base_url';
const STORAGE_MODEL_KEY = 'agent_lens_openai_model';
const STORAGE_TEMPERATURE_KEY = 'agent_lens_openai_temperature';

// Model configuration - must match AgentSettings.jsx
const MODEL_CONFIG = {
  'gpt-5-mini': { supportsTemperature: true, defaultTemperature: 1.0, temperatureFixed: true },
  'gpt-5': { supportsTemperature: true, defaultTemperature: 1.0, temperatureFixed: true },
  'o3-mini': { supportsTemperature: false, defaultTemperature: null, temperatureFixed: false },
  'gpt-4o': { supportsTemperature: true, defaultTemperature: 0.7, temperatureFixed: false },
  'gpt-4o-mini': { supportsTemperature: true, defaultTemperature: 0.7, temperatureFixed: false },
  'gpt-4-turbo': { supportsTemperature: true, defaultTemperature: 0.7, temperatureFixed: false },
  'gpt-4': { supportsTemperature: true, defaultTemperature: 0.7, temperatureFixed: false },
};

/**
 * Get OpenAI API key from localStorage
 * @returns {string} API key or empty string
 */
export function getOpenAIApiKey() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) || '';
}

/**
 * Get OpenAI base URL from localStorage
 * @returns {string} Base URL or default
 */
export function getOpenAIBaseURL() {
  if (typeof window === 'undefined') return 'https://api.openai.com/v1/';
  return localStorage.getItem(STORAGE_BASE_URL_KEY) || 'https://api.openai.com/v1/';
}

/**
 * Get OpenAI model from localStorage
 * @returns {string} Model name or default 'gpt-5-mini' (fastest GPT-5)
 */
export function getOpenAIModel() {
  if (typeof window === 'undefined') return 'gpt-5-mini';
  return localStorage.getItem(STORAGE_MODEL_KEY) || 'gpt-5-mini';
}

/**
 * Get OpenAI temperature from localStorage
 * @returns {number} Temperature value based on model config
 */
export function getOpenAITemperature() {
  if (typeof window === 'undefined') return 1.0;
  const model = getOpenAIModel();
  const config = MODEL_CONFIG[model];
  
  if (!config || !config.supportsTemperature) {
    return null; // Model doesn't support temperature
  }
  
  if (config.temperatureFixed) {
    return config.defaultTemperature;
  }
  
  const savedTemp = localStorage.getItem(STORAGE_TEMPERATURE_KEY);
  return savedTemp !== null ? parseFloat(savedTemp) : config.defaultTemperature;
}

/**
 * Check if model supports temperature parameter
 * @returns {boolean} True if model supports temperature
 */
export function modelSupportsTemperature(model) {
  const config = MODEL_CONFIG[model];
  return config ? config.supportsTemperature : true;
}

/**
 * Check if OpenAI API key is configured
 * @returns {boolean} True if API key exists
 */
export function hasOpenAIConfig() {
  return !!getOpenAIApiKey();
}

