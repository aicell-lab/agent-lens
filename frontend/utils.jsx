const getServerUrl = () => {
  return getUrlParam("server") || window.location.origin;
}

const getUrlParam = (param_name) => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param_name);
}

export const isLocal = () => {
  const serverUrl = getServerUrl();
  const localHosts = ["127.0.0.1", "localhost", "0.0.0.0"];
  const isLocalMachine = localHosts.includes(new URL(serverUrl).hostname);
  console.log(`[isLocal] Server URL: ${serverUrl}, Is local: ${isLocalMachine}`);
  return isLocalMachine;
}

const getService = async (server, remoteId, localId = null) => {
  const useLocal = localId && isLocal();
  const serviceId = useLocal ? localId : remoteId;
  console.log(`[getService] Attempting to get service. Remote ID: '${remoteId}', Local ID: '${localId}', Resolved to use local: ${useLocal}, Final Service ID: '${serviceId}'`);
  try {
    const svc = await server.getService(serviceId);
    console.log(`[getService] Successfully got service '${serviceId}':`, svc);
    return svc;
  } catch (error) {
    console.error(`[getService] Error getting service '${serviceId}':`, error);
    throw error; // Re-throw to be caught by tryGetService
  }
};

// HyphaServerManager Class
export class HyphaServerManager {
  constructor(token) {
    if (!token) {
      throw new Error("HyphaServerManager requires an authentication token.");
    }
    this.token = token;
    this.servers = {}; // Cache for server connections { workspace: serverPromise }
    this.serverConnections = {}; // Cache for actual server objects { workspace: serverObject }
    this.defaultServerUrl = "https://hypha.aicell.io/"; // Make configurable if needed
    this.defaultClientNamePrefix = "hypha-client";
  }

  async getServer(workspace) {
    if (!workspace) {
      console.warn("[HyphaServerManager] Workspace cannot be null or empty. Using default 'agent-lens'.");
      workspace = "agent-lens"; // Or handle as an error
    }

    if (this.serverConnections[workspace]) {
      console.log(`[HyphaServerManager] Returning existing connection for workspace: ${workspace}`);
      return this.serverConnections[workspace];
    }

    if (!this.servers[workspace]) {
      console.log(`[HyphaServerManager] Creating new connection promise for workspace: ${workspace}`);
      this.servers[workspace] = window.hyphaWebsocketClient.connectToServer({
        server_url: this.defaultServerUrl,
        token: workspace === 'agent-lens' ? null : this.token,
        workspace: workspace === 'agent-lens' ? null : workspace,
        method_timeout: 30000, // Increased timeout slightly
      }).then(server => {
        this.serverConnections[workspace] = server; // Cache the resolved server object
        console.log(`[HyphaServerManager] Successfully connected to workspace: ${workspace}`);
        return server;
      }).catch(error => {
        console.error(`[HyphaServerManager] Failed to connect to workspace ${workspace}:`, error);
        delete this.servers[workspace]; // Remove promise on failure to allow retry
        delete this.serverConnections[workspace];
        // Check for permission-related keywords in the error message
        const errorMessage = error.message ? error.message.toLowerCase() : '';
        if (errorMessage.includes('permission denied') || 
            errorMessage.includes('unauthorized') || 
            errorMessage.includes('forbidden') ||
            errorMessage.includes('token is not valid for workspace') || // Hypha specific
            errorMessage.includes('no permission to access workspace')) { // Hypha specific
          throw new Error(`Permission denied for workspace '${workspace}'. Please check your access rights.`);
        }
        throw error; // Re-throw original or a wrapped error if not permission-specific
      });
    }
    return this.servers[workspace]; // Return the promise
  }

  async disconnectAll() {
    console.log("[HyphaServerManager] Disconnecting all server connections...");
    const promises = [];
    for (const workspace in this.serverConnections) {
      if (this.serverConnections[workspace] && typeof this.serverConnections[workspace].disconnect === 'function') {
        console.log(`[HyphaServerManager] Disconnecting from workspace: ${workspace}`);
        promises.push(
          this.serverConnections[workspace].disconnect().catch(e => 
            console.error(`[HyphaServerManager] Error disconnecting from ${workspace}:`, e)
          )
        );
      }
    }
    await Promise.all(promises);
    this.servers = {};
    this.serverConnections = {};
    console.log("[HyphaServerManager] All server connections disconnected.");
  }
}

export const initializeServices = async (
  hyphaManager, // Changed from server to hyphaManager
  setMicroscopeControlService,
  setSimilarityService,
  setSegmentService,
  setIncubatorControlService,
  setRoboticArmService,
  setOrchestratorManagerService, // Added new service setter
  appendLog,
  selectedMicroscopeId, // This is the full ID like "workspace/service-name"
  showNotification = null // New optional parameter for showing notifications
) => {
  console.log(`[initializeServices] Starting with HyphaManager. Selected Microscope ID: ${selectedMicroscopeId}`);
  appendLog('Initializing services using HyphaManager...');

  const segmentationServiceRemoteId = "agent-lens/interactive-segmentation";
  const segmentationServiceLocalId = "interactive-segmentation";
  const segmentationService = await tryGetService(
    hyphaManager,
    "Segmentation",
    segmentationServiceRemoteId,
    segmentationServiceLocalId,
    appendLog,
    showNotification
  );
  setSegmentService(segmentationService);

  // For microscope, selectedMicroscopeId is already the full remote ID
  const microscopeLocalId = selectedMicroscopeId.startsWith("squid-control/") ? null : selectedMicroscopeId; 
  // This local ID logic might need refinement based on how local simulated vs real microscopes are identified.
  // Assuming squid-control based ones might have a specific local setup if localId is null for them.
  const microscopeControlService = await tryGetService(
    hyphaManager,
    "Microscope Control",
    selectedMicroscopeId, // Full remote ID
    microscopeLocalId,    // Potentially null or specific local ID
    appendLog,
    showNotification
  );
  setMicroscopeControlService(microscopeControlService);

  const similarityServiceRemoteId = "agent-lens/image-text-similarity-search";
  const similarityServiceLocalId = "image-text-similarity-search";
  const similarityService = await tryGetService(
    hyphaManager,
    "Similarity Search",
    similarityServiceRemoteId,
    similarityServiceLocalId,
    appendLog,
    showNotification
  );
  setSimilarityService(similarityService);
  
  const incubatorServiceIdFull = "reef-imaging/mirror-incubator-control";
  const incubatorControlService = await tryGetService(
    hyphaManager,
    "Incubator Control",
    incubatorServiceIdFull,
    null, // Assuming no special local ID for incubator, always remote via manager
    appendLog,
    showNotification
  );
  setIncubatorControlService(incubatorControlService);

  const roboticArmServiceIdFull = "reef-imaging/mirror-robotic-arm-control";
  const roboticArmService = await tryGetService(
    hyphaManager,
    "Robotic Arm Control",
    roboticArmServiceIdFull,
    null, // Assuming no special local ID for arm, always remote via manager
    appendLog,
    showNotification
  );
  setRoboticArmService(roboticArmService);

  const orchestratorManagerServiceIdFull = "reef-imaging/orchestrator-manager";
  const orchestratorManagerService = await tryGetService(
    hyphaManager,
    "Orchestrator Manager",
    orchestratorManagerServiceIdFull,
    null, // Assuming no special local ID, always remote via manager
    appendLog,
    showNotification
  );
  setOrchestratorManagerService(orchestratorManagerService);

  console.log("[initializeServices] Finished.");
};

export const tryGetService = async (hyphaManager, name, remoteIdWithWorkspace, localId, appendLog, showNotification = null) => {
  console.log(`[tryGetService] For service '${name}'. Remote ID (full): '${remoteIdWithWorkspace}', Local ID: '${localId}'`);
  appendLog(`Acquiring ${name} service (${remoteIdWithWorkspace})...`);
  try {
    const parts = remoteIdWithWorkspace.split('/');
    if (parts.length < 2 && !isLocal()) {
        // If not local and no workspace specified, this is an issue unless it's a public service meant to be in default workspace
        // However, our manager always needs a workspace. Assume default if not parseable.
        console.warn(`[tryGetService] Remote ID '${remoteIdWithWorkspace}' for '${name}' does not seem to contain a workspace. Defaulting to 'agent-lens'.`);
    }
    const workspaceName = parts.length > 1 ? parts[0] : 'agent-lens'; // Default to agent-lens if no workspace in ID
    let serviceIdToGet; // MODIFIED: Declare serviceIdToGet; initial assignment is now conditional.

    const useLocal = localId && isLocal();
    if (useLocal) {
      serviceIdToGet = localId; // If local and localId provided, workspace might not be relevant for local getService
      console.log(`[tryGetService] Attempting to get LOCAL service '${serviceIdToGet}' in workspace '${workspaceName}' for '${name}'`);
    } else {
      // MODIFIED: Logic for remote service ID determination based on workspaceName.
      if (workspaceName === 'agent-lens') {
        // For 'agent-lens', use the full remoteIdWithWorkspace, as per user's request for getService.
        // This ensures "agent-lens/service-name" is passed if remoteIdWithWorkspace is such.
        serviceIdToGet = remoteIdWithWorkspace;
      } else {
        // For other remote workspaces, strip the workspace prefix.
        serviceIdToGet = parts.length > 1 ? parts.slice(1).join('/') : remoteIdWithWorkspace;
      }
      console.log(`[tryGetService] Attempting to get REMOTE service '${serviceIdToGet}' in workspace '${workspaceName}' for '${name}'`);
    }

    const server = await hyphaManager.getServer(workspaceName);
    if (!server) {
        throw new Error(`Failed to get server for workspace ${workspaceName}`);
    }

    const svc = await server.getService(serviceIdToGet);
    appendLog(`${name} service acquired from ${workspaceName}.`);
    console.log(`[tryGetService] Successfully acquired '${name}' service from ${workspaceName}.`);
    return svc;
  } catch (error) {
    const errorMessage = `Error acquiring ${name} service (${remoteIdWithWorkspace}): ${error.message}`;
    appendLog(errorMessage);
    console.error(`[tryGetService] Error acquiring '${name}' (Remote: '${remoteIdWithWorkspace}', Local: '${localId}'):`, error);
    
    // Check if this is a permission error and show notification
    if (showNotification && error.message && error.message.includes('Permission denied for workspace')) {
      showNotification(error.message, 'error');
    }
    
    return null;
  }
};

const login_callback = (context) => {
  console.log("[login_callback] Invoked. Login URL:", context.login_url);
  window.open(context.login_url);
}

const isTokenExpired = (token) => {
  const expired = Date.now() >= (JSON.parse(atob(token.split('.')[1]))).exp * 1000;
  console.log("[isTokenExpired] Token check. Expired:", expired);
  return expired;
}

export const login = async () => {
  const serverUrl = getServerUrl();
  console.log(`[login] Starting login process. Server URL: ${serverUrl}`);
  let token = localStorage.getItem("token");
  console.log("[login] Token from localStorage:", token ? "Exists" : "Not Found");
  if (token && !isTokenExpired(token)) {
    console.log("[login] Using existing valid token.");
    return token;
  }
  console.log("[login] Existing token is invalid or not found. Requesting new token...");
  token = await hyphaWebsocketClient.login({
    server_url: serverUrl,
    login_callback: login_callback,
  });
  console.log("[login] New token obtained:", token);
  localStorage.setItem("token", token);
  return token;
}