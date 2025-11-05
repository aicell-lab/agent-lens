/**
 * OpenAI Configuration Utility
 * Handles loading and retrieving OpenAI API configuration from localStorage
 */

const STORAGE_KEY = 'agent_lens_openai_api_key';
const STORAGE_BASE_URL_KEY = 'agent_lens_openai_base_url';

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
 * Check if OpenAI API key is configured
 * @returns {boolean} True if API key exists
 */
export function hasOpenAIConfig() {
  return !!getOpenAIApiKey();
}

