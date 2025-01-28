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
  return localHosts.includes(new URL(serverUrl).hostname);
}

const getService = async (server, remoteId, localId = null) => {
  const serviceId = localId && isLocal()? localId : remoteId;
  const svc = await server.getService(serviceId);
  return svc;
};

export const initializeServices = async (server, setMicroscopeControlService, setSimilarityService, setSegmentService, appendLog) => {
  appendLog('Initializing connection to server...');

  const segmentationService = await tryGetService(server, "Segmentation", "agent-lens/interactive-segmentation", "interactive-segmentation", appendLog);
  setSegmentService(segmentationService);
  const microscopeControlService = await tryGetService(server, "Microscope Control", "squid-control/microscope-control-squid-simulation", null, appendLog);
  setMicroscopeControlService(microscopeControlService);
  const similarityService = await tryGetService(server, "Similarity Search", "agent-lens/similarity-search", "similarity-search", appendLog);
  setSimilarityService(similarityService);
};

const tryGetService = async (server, name, remoteId, localId, appendLog) => {
  try {
    appendLog(`Acquiring ${name} service...`);
    const svc = await getService(server, remoteId, localId);
    appendLog(`${name} service acquired.`);
    return svc;
  } catch (error) {
    appendLog(`Error acquiring ${name} service: ${error.message}`);
    return null;
  }
};

export const getServer = async (token) => {
	return await hyphaWebsocketClient.connectToServer({
		server_url: getServerUrl(),
		token: token,
		method_timeout: 500,
	});
}

const login_callback = (context) => {
  window.open(context.login_url);
}

const isTokenExpired = (token) => {
return Date.now() >= (JSON.parse(atob(token.split('.')[1]))).exp * 1000
}

export const login = async () => {
  const serverUrl = getServerUrl();
  let token = localStorage.getItem("token");
  if (token && !isTokenExpired(token)) {
    console.log("Using saved token:", token);
    return token;
  }
  token = await hyphaWebsocketClient.login({
    server_url: serverUrl,
    login_callback: login_callback,
  });
  localStorage.setItem("token", token);
  return token;
}