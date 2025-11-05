/**
 * OpenAI Configuration Utility
 * Handles loading and retrieving OpenAI API configuration from localStorage
 */

const STORAGE_KEY = 'agent_lens_openai_api_key';
const STORAGE_BASE_URL_KEY = 'agent_lens_openai_base_url';
const STORAGE_MODEL_KEY = 'agent_lens_openai_model';

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
 * @returns {string} Model name or default 'gpt-4o'
 */
export function getOpenAIModel() {
  if (typeof window === 'undefined') return 'gpt-4o';
  return localStorage.getItem(STORAGE_MODEL_KEY) || 'gpt-4o';
}

/**
 * Check if OpenAI API key is configured
 * @returns {boolean} True if API key exists
 */
export function hasOpenAIConfig() {
  return !!getOpenAIApiKey();
}

