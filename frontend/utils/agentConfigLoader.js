/**
 * Agent Configuration Loader
 * Loads agent configuration files (system cell code) from public/agent-configs/
 */

/**
 * Inject authentication token into Python code, replacing the login() call
 * @param {string} code - Python code string
 * @param {string|null} token - Authentication token to inject, or null to keep original login
 * @returns {string} - Code with token injected
 */
function injectToken(code, token) {
  if (!token) {
    return code;
  }

  const escapedToken = token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // New pattern: workspace_token = "" (used in hpa-analysis / microscope-control.js)
  const workspaceTokenPattern = /workspace_token\s*=\s*"[^"]*"/g;
  if (workspaceTokenPattern.test(code)) {
    const modified = code.replace(/workspace_token\s*=\s*"[^"]*"/g, `workspace_token = "${escapedToken}"`);
    console.log('[AgentConfigLoader] Token injected into workspace_token');
    return modified;
  }

  // Legacy pattern: token = await login({"server_url": "https://hypha.aicell.io"})
  const loginPattern = /token\s*=\s*await\s+login\s*\(\s*\{[^}]*"server_url"[^}]*\}\s*\)/g;
  const modifiedCode = code.replace(loginPattern, `token = "${escapedToken}"`);

  if (modifiedCode === code) {
    console.warn('[AgentConfigLoader] Token provided but no injection pattern found in code');
  } else {
    console.log('[AgentConfigLoader] Token injected into system cell code');
  }

  return modifiedCode;
}

/**
 * Inject the microscope ID into the config code
 * @param {string} code - Python code string
 * @param {string} microscopeId - Full microscope service ID (e.g. "reef-imaging/microscope-squid-1")
 * @returns {string} - Code with microscope ID injected
 */
function injectMicroscopeId(code, microscopeId) {
  if (!microscopeId) return code;
  return code.replace('MICROSCOPE_ID_PLACEHOLDER', microscopeId);
}

/**
 * Inject the agent-lens tools service ID (test vs prod) into the config code
 * @param {string} code - Python code string
 * @returns {string} - Code with service ID injected
 */
function injectAgentLensServiceId(code) {
  const serviceId = window.location.href.includes('agent-lens-test')
    ? 'reef-imaging/agent-lens-tools-test'
    : 'reef-imaging/agent-lens-tools';
  return code.replace('AGENT_LENS_SERVICE_PLACEHOLDER', serviceId);
}

/**
 * Get the similarity search base URL based on current window location
 * @returns {string} - Base URL for similarity search endpoints
 */
function getSimilarityBaseUrl() {
  // Determine service ID based on URL (same logic as used in SimilaritySearchPanel)
  const serviceId = window.location.href.includes('agent-lens-test') ? 'agent-lens-test' : 'agent-lens';
  
  // Construct base URL: origin + pathname + /apps/{serviceId}/similarity
  const baseUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}/apps/${serviceId}/similarity`;
  return baseUrl;
}

/**
 * Inject base_url variable into Python code for similarity search API
 * @param {string} code - Python code string
 * @returns {string} - Code with base_url variable injected
 */
function injectBaseUrl(code) {
  const escapedBaseUrl = getSimilarityBaseUrl().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  
  // Replace existing base_url if present
  if (code.includes('base_url =')) {
    return code.replace(/base_url\s*=\s*["'][^"']*["']/g, `base_url = "${escapedBaseUrl}"`);
  }
  
  // Inject after server connection (standard pattern in all configs)
  const serverPattern = /(server\s*=\s*await\s+connect_to_server\s*\([^)]*\)\s*)/;
  const match = code.match(serverPattern);
  if (match) {
    const index = code.indexOf(match[0]) + match[0].length;
    return `${code.substring(0, index)}\n\n# Similarity search API base URL (injected by frontend)\nbase_url = "${escapedBaseUrl}"\n${code.substring(index)}`;
  }
  
  return code;
}

/**
 * Normalize microscope ID by removing workspace prefix
 * @param {string} microscopeId - Microscope ID (e.g., 'reef-imaging/squid-control-simulation' or 'squid-control-simulation')
 * @returns {string} - Normalized ID (e.g., 'squid-control-simulation')
 */
function normalizeMicroscopeId(microscopeId) {
  // Remove workspace prefix if present (e.g., 'reef-imaging/squid-control-simulation' -> 'squid-control-simulation')
  // Also handle other patterns like 'reef-imaging/microscope-squid-1' -> 'microscope-squid-1'
  if (microscopeId.includes('/')) {
    return microscopeId.split('/').pop();
  }
  return microscopeId;
}

/**
 * Load agent configuration for a specific microscope ID
 * @param {string} microscopeId - The microscope ID (e.g., 'squid-control-simulation', 'microscope-squid-1', or 'reef-imaging/squid-control-simulation')
 * @param {string|null} token - Optional authentication token to inject (replaces login() call)
 * @returns {Promise<string>} - The system cell code with token injected if provided
 */
export async function loadAgentConfig(microscopeId, token = null) {
  try {
    // Normalize microscope ID (remove workspace prefix if present)
    const normalizedId = normalizeMicroscopeId(microscopeId);

    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');

    // Try per-microscope override file first (for microscope-specific customisation)
    let configModule = null;
    const overridePath = `${baseUrl}/agent-configs/${normalizedId}.js`;
    console.log(`[AgentConfigLoader] Looking for override config at:`, overridePath);
    const overrideResponse = await fetch(overridePath);
    if (overrideResponse.ok) {
      configModule = await overrideResponse.text();
      console.log(`[AgentConfigLoader] Using per-microscope override for "${normalizedId}"`);
    } else {
      // Fall back to shared microscope-control.js
      const sharedPath = `${baseUrl}/agent-configs/microscope-control.js`;
      console.log(`[AgentConfigLoader] No override found, loading shared config from:`, sharedPath);
      const sharedResponse = await fetch(sharedPath);
      if (sharedResponse.ok) {
        configModule = await sharedResponse.text();
        console.log(`[AgentConfigLoader] Using shared microscope-control.js for "${microscopeId}"`);
      } else {
        console.error('[AgentConfigLoader] Shared config not found');
        return getMinimalDefaultConfig(token);
      }
    }

    // Extract systemCellCode from the module export
    const match = configModule.match(/export\s+const\s+systemCellCode\s*=\s*`([\s\S]*?)`;/);
    if (!match || !match[1]) {
      console.error('[AgentConfigLoader] Invalid config format, missing systemCellCode export');
      return getMinimalDefaultConfig(token);
    }

    let systemCellCode = match[1];

    // Inject full microscope ID (before normalization strips workspace prefix)
    systemCellCode = injectMicroscopeId(systemCellCode, microscopeId);

    // Inject agent-lens tools service ID (test vs prod)
    systemCellCode = injectAgentLensServiceId(systemCellCode);

    // Inject token if provided
    systemCellCode = injectToken(systemCellCode, token);

    // Inject base_url for similarity search API
    systemCellCode = injectBaseUrl(systemCellCode);

    return systemCellCode;

  } catch (error) {
    console.error('[AgentConfigLoader] Error loading config:', error);
    return getMinimalDefaultConfig(token);
  }
}

/**
 * Load the default agent configuration
 * @param {string|null} token - Optional authentication token to inject
 * @returns {Promise<string>} - The default system cell code with token injected if provided
 */
async function loadDefaultConfig(token = null) {
  try {
    const baseUrl = window.location.origin + window.location.pathname.replace(/\/$/, '');
    const configPath = `${baseUrl}/agent-configs/microscope-control.js`;
    console.log(`[AgentConfigLoader] Loading default config from:`, configPath);

    const response = await fetch(configPath);
    if (!response.ok) {
      console.error('[AgentConfigLoader] Default config not found');
      return getMinimalDefaultConfig(token);
    }

    const configModule = await response.text();
    const match = configModule.match(/export\s+const\s+systemCellCode\s*=\s*`([\s\S]*?)`;/);
    if (!match || !match[1]) {
      console.error('[AgentConfigLoader] Invalid default config format');
      return getMinimalDefaultConfig(token);
    }

    let systemCellCode = match[1];
    systemCellCode = injectAgentLensServiceId(systemCellCode);
    systemCellCode = injectToken(systemCellCode, token);
    systemCellCode = injectBaseUrl(systemCellCode);
    return systemCellCode;

  } catch (error) {
    console.error('[AgentConfigLoader] Error loading default config:', error);
    return getMinimalDefaultConfig(token);
  }
}

/**
 * Get minimal default configuration as fallback
 * @param {string|null} token - Optional authentication token to inject
 * @returns {string} - Minimal system cell code with token injected if provided
 */
function getMinimalDefaultConfig(token = null) {
  let code = `# Agent System Cell
# Startup code and system prompt for microscope control

import micropip
await micropip.install(["hypha-rpc"])
from hypha_rpc import connect_to_server, login

# Connect to Hypha server (This is your token acquired when you login)
token = await login({"server_url": "https://hypha.aicell.io"})
server = await connect_to_server({
  "server_url": "https://hypha.aicell.io", 
  "token": token, 
  "workspace": "reef-imaging"
})

SYSTEM_PROMPT = """You are a microscopy assistant for the Agent-Lens platform.
You can help users control microscopes and analyze microscopy data.

Available capabilities:
- Connect to microscope services via Hypha-RPC
- Control microscope stage movement
- Capture images
- Process and analyze microscopy data

To get started, connect to a microscope service:
microscope = await server.get_service("microscope-service-id")
"""

print(SYSTEM_PROMPT)
`;
  
  // Inject token if provided
  let modifiedCode = injectToken(code, token);
  
  // Inject base_url for similarity search API
  modifiedCode = injectBaseUrl(modifiedCode);
  
  return modifiedCode;
}

