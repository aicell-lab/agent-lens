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

export const initializeServices = async (
  server,
  setMicroscopeControlService,
  setSimilarityService,
  setSegmentService,
  setIncubatorControlService,
  setRoboticArmService,
  appendLog,
  selectedMicroscopeId
) => {
  console.log(`[initializeServices] Starting. Selected Microscope ID: ${selectedMicroscopeId}`);
  appendLog('Initializing connection to server...');

  const segmentationServiceRemoteId = "agent-lens/interactive-segmentation";
  const segmentationServiceLocalId = "interactive-segmentation";
  console.log(`[initializeServices] Attempting to get Segmentation service. Remote: ${segmentationServiceRemoteId}, Local: ${segmentationServiceLocalId}`);
  const segmentationService = await tryGetService(
    server,
    "Segmentation",
    segmentationServiceRemoteId,
    segmentationServiceLocalId,
    appendLog
  );
  setSegmentService(segmentationService);
  console.log("[initializeServices] Segmentation service initialized.", segmentationService);

  const microscopeRemoteId = selectedMicroscopeId;
  const microscopeLocalId = selectedMicroscopeId === "squid-control/squid-control-reef" ? null : selectedMicroscopeId;
  console.log(`[initializeServices] Attempting to get Microscope Control service. Remote: ${microscopeRemoteId}, Local: ${microscopeLocalId}`);
  const microscopeControlService = await tryGetService(
    server,
    "Microscope Control",
    microscopeRemoteId,
    microscopeLocalId,
    appendLog
  );
  setMicroscopeControlService(microscopeControlService);
  console.log("[initializeServices] Microscope Control service initialized.", microscopeControlService);

  const similarityServiceRemoteId = "agent-lens/similarity-search";
  const similarityServiceLocalId = "similarity-search";
  console.log(`[initializeServices] Attempting to get Similarity Search service. Remote: ${similarityServiceRemoteId}, Local: ${similarityServiceLocalId}`);
  const similarityService = await tryGetService(
    server,
    "Similarity Search",
    similarityServiceRemoteId,
    similarityServiceLocalId,
    appendLog
  );
  setSimilarityService(similarityService);
  console.log("[initializeServices] Similarity Search service initialized.", similarityService);
  
  // Connect to the separate incubator server
  const incubatorServiceId = "reef-imaging/mirror-incubator-control";
  console.log(`[initializeServices] Attempting to get Incubator Control service: ${incubatorServiceId}`);
  try {
    appendLog(`Acquiring Incubator Control service from local server...`);
    const incubatorServer = server; // Assuming same server for now, as per original logic
    const incubatorControlService = await incubatorServer.getService(incubatorServiceId);
    appendLog(`Incubator Control service acquired from local server.`);
    setIncubatorControlService(incubatorControlService);
    console.log("[initializeServices] Incubator Control service acquired.", incubatorControlService);
  } catch (error) {
    appendLog(`Error acquiring Incubator Control service: ${error.message}`);
    console.error(`[initializeServices] Error acquiring Incubator Control service '${incubatorServiceId}':`, error);
    setIncubatorControlService(null);
  }

  // Connect to the robotic arm service
  const roboticArmServiceId = "reef-imaging/mirror-robotic-arm-control";
  console.log(`[initializeServices] Attempting to get Robotic Arm Control service: ${roboticArmServiceId}`);
  try {
    appendLog(`Acquiring Robotic Arm Control service from local server...`);
    const roboticArmService = await server.getService(roboticArmServiceId);
    appendLog(`Robotic Arm Control service acquired from local server.`);
    setRoboticArmService(roboticArmService);
    console.log("[initializeServices] Robotic Arm Control service acquired.", roboticArmService);
  } catch (error) {
    appendLog(`Error acquiring Robotic Arm Control service: ${error.message}`);
    console.error(`[initializeServices] Error acquiring Robotic Arm Control service '${roboticArmServiceId}':`, error);
    setRoboticArmService(null);
  }

  console.log("[initializeServices] Finished.");
};

export const tryGetService = async (server, name, remoteId, localId, appendLog) => {
  console.log(`[tryGetService] For service '${name}'. Remote ID: '${remoteId}', Local ID: '${localId}'`);
  try {
    appendLog(`Acquiring ${name} service...`);
    const svc = await getService(server, remoteId, localId);
    appendLog(`${name} service acquired.`);
    console.log(`[tryGetService] Successfully acquired '${name}' service.`);
    return svc;
  } catch (error) {
    appendLog(`Error acquiring ${name} service: ${error.message}`);
    console.error(`[tryGetService] Error acquiring '${name}' service (Remote: '${remoteId}', Local: '${localId}'):`, error);
    return null;
  }
};

export const getServer = async (token) => {
  console.log("[getServer] Attempting to connect to Hypha server with token:", token ? "Token Provided" : "No Token");
	try {
    const server = await hyphaWebsocketClient.connectToServer({
      server_url: "https://hypha.aicell.io/",
      token: token,
      workspace: "agent-lens",
      method_timeout: 500,
    });
    console.log("[getServer] Successfully connected to Hypha server:", server);
    return server;
  } catch (error) {
    console.error("[getServer] Error connecting to Hypha server:", error);
    throw error;
  }
}

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