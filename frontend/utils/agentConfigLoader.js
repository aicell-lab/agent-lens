/**
 * Agent Configuration Loader
 * Loads agent configuration files (system cell code) from public/agent-configs/
 */

/**
 * Load agent configuration for a specific microscope ID
 * @param {string} microscopeId - The microscope ID (e.g., 'squid-control-simulation', 'microscope-squid-1')
 * @returns {Promise<string>} - The system cell code
 */
export async function loadAgentConfig(microscopeId) {
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
      return await loadDefaultConfig();
    }
    
    const systemCellCode = match[1];
    console.log(`[AgentConfigLoader] Loaded config for ${microscopeId}`);
    
    return systemCellCode;
    
  } catch (error) {
    console.error('[AgentConfigLoader] Error loading config:', error);
    console.log('[AgentConfigLoader] Falling back to default config');
    return await loadDefaultConfig();
  }
}

/**
 * Load the default agent configuration
 * @returns {Promise<string>} - The default system cell code
 */
async function loadDefaultConfig() {
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
      return getMinimalDefaultConfig();
    }
    
    return match[1];
    
  } catch (error) {
    console.error('[AgentConfigLoader] Error loading default config:', error);
    return getMinimalDefaultConfig();
  }
}

/**
 * Get minimal default configuration as fallback
 * @returns {string} - Minimal system cell code
 */
function getMinimalDefaultConfig() {
  return `# Agent System Cell
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
}

