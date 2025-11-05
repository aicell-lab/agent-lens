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
    // No token provided, keep original login behavior
    return code;
  }

  // Escape token for Python string (JWT tokens are typically safe, but handle edge cases)
  // Replace any double quotes in token with escaped quotes, though JWT tokens shouldn't have them
  const escapedToken = token.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  // Pattern to match: token = await login({"server_url": "https://hypha.aicell.io"})
  // This handles variations in whitespace and parameter formatting
  const loginPattern = /token\s*=\s*await\s+login\s*\(\s*\{[^}]*"server_url"[^}]*\}\s*\)/g;
  
  const replacement = `token = "${escapedToken}"`;
  
  const modifiedCode = code.replace(loginPattern, replacement);
  
  if (modifiedCode === code) {
    // No replacement occurred, log warning but don't fail
    console.warn('[AgentConfigLoader] Token provided but login pattern not found in code');
  } else {
    console.log('[AgentConfigLoader] Token injected into system cell code');
  }
  
  return modifiedCode;
}

/**
 * Load agent configuration for a specific microscope ID
 * @param {string} microscopeId - The microscope ID (e.g., 'squid-control-simulation', 'microscope-squid-1')
 * @param {string|null} token - Optional authentication token to inject (replaces login() call)
 * @returns {Promise<string>} - The system cell code with token injected if provided
 */
export async function loadAgentConfig(microscopeId, token = null) {
  try {
    // Try to load microscope-specific config
    const configPath = `/agent-configs/${microscopeId}.js`;
    console.log(`[AgentConfigLoader] Loading config from:`, configPath);
    
    const response = await fetch(configPath);
    
    if (!response.ok) {
      console.warn(`[AgentConfigLoader] Config not found for ${microscopeId}, using default`);
      // Fall back to default config
      return await loadDefaultConfig();
    }
    
    const configModule = await response.text();
    
    // Extract systemCellCode from the module export
    // The file should export: export const systemCellCode = `...`;
    const match = configModule.match(/export\s+const\s+systemCellCode\s*=\s*`([\s\S]*?)`;/);
    
    if (!match || !match[1]) {
      console.error('[AgentConfigLoader] Invalid config format, missing systemCellCode export');
      return await loadDefaultConfig(token);
    }
    
    let systemCellCode = match[1];
    console.log(`[AgentConfigLoader] Loaded config for ${microscopeId}`);
    
    // Inject token if provided
    systemCellCode = injectToken(systemCellCode, token);
    
    return systemCellCode;
    
  } catch (error) {
    console.error('[AgentConfigLoader] Error loading config:', error);
    console.log('[AgentConfigLoader] Falling back to default config');
    return await loadDefaultConfig(token);
  }
}

/**
 * Load the default agent configuration
 * @param {string|null} token - Optional authentication token to inject
 * @returns {Promise<string>} - The default system cell code with token injected if provided
 */
async function loadDefaultConfig(token = null) {
  try {
    const configPath = `/agent-configs/microscope-assistant.js`;
    console.log(`[AgentConfigLoader] Loading default config from:`, configPath);
    
    const response = await fetch(configPath);
    
    if (!response.ok) {
      console.error('[AgentConfigLoader] Default config not found');
      // Return a minimal default configuration
      return getMinimalDefaultConfig();
    }
    
    const configModule = await response.text();
    const match = configModule.match(/export\s+const\s+systemCellCode\s*=\s*`([\s\S]*?)`;/);
    
    if (!match || !match[1]) {
      console.error('[AgentConfigLoader] Invalid default config format');
      return getMinimalDefaultConfig(token);
    }
    
    let systemCellCode = match[1];
    
    // Inject token if provided
    systemCellCode = injectToken(systemCellCode, token);
    
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

# Connect to Hypha server
token = await login({"server_url": "https://hypha.aicell.io"})
server = await connect_to_server({
  "server_url": "https://hypha.aicell.io", 
  "token": token, 
  "workspace": "agent-lens"
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
  return injectToken(code, token);
}

