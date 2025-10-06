import { useState, useEffect, useCallback } from 'react';

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

  // Method to update the token and clear existing connections
  async updateToken(newToken) {
    if (!newToken) {
      throw new Error("updateToken requires a valid token.");
    }
    console.log("[HyphaServerManager] Updating token and clearing existing connections...");
    this.token = newToken;
    // Clear existing connections since they were made with the old token
    try {
      await this.disconnectAll();
      console.log("[HyphaServerManager] Token update completed successfully");
    } catch (error) {
      console.error("[HyphaServerManager] Error during token update disconnect:", error);
      // Even if disconnect fails, we still want to use the new token
    }
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
        ping_interval: 60000,  // Send ping every 60 seconds to prevent idle timeout
        ping_timeout: 30000,   // Wait 30 seconds for pong response
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
            errorMessage.includes('no permission to access workspace') || // Hypha specific
            errorMessage.includes('token expired') ||
            errorMessage.includes('expired token')) {
          throw new Error(`Authentication failed for workspace '${workspace}'. This may be due to an expired or invalid token. Please try logging in again.`);
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

  // Method to get the current token (useful for debugging)
  getCurrentToken() {
    return this.token;
  }
}

export const initializeServices = async (
  hyphaManager, // Changed from server to hyphaManager
  setMicroscopeControlService,
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
    
    // Show notification for all types of service acquisition errors
    if (showNotification) {
      if (error.message && error.message.includes('Permission denied for workspace')) {
        showNotification(error.message, 'error');
      } else {
        // General service unavailability notification
        showNotification(`${name} service is currently unavailable. Please check if the service is running.`, 'error');
      }
    }
    
    return null;
  }
};

const login_callback = (context) => {
  console.log("[login_callback] Invoked. Login URL:", context.login_url);
  window.open(context.login_url);
}

const isTokenExpired = (token) => {
  try {
    if (!token || typeof token !== 'string') {
      console.log("[isTokenExpired] Invalid token format");
      return true;
    }
    
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log("[isTokenExpired] Token does not have 3 parts (invalid JWT format)");
      return true;
    }
    
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) {
      console.log("[isTokenExpired] Token has no expiration field");
      return true;
    }
    
    const expired = Date.now() >= (payload.exp * 1000);
    console.log("[isTokenExpired] Token check. Expired:", expired);
    return expired;
  } catch (error) {
    console.error("[isTokenExpired] Error parsing token:", error);
    return true; // Treat invalid tokens as expired
  }
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

// Input validation utilities
export const validateNumberInput = (value, options = {}) => {
  const {
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    allowFloat = true,
    allowEmpty = false,
    defaultValue = null,
    customValidation = null
  } = options;

  // Handle empty input
  if (value === '' || value === null || value === undefined) {
    if (allowEmpty) {
      return { isValid: true, value: null, error: null };
    }
    if (defaultValue !== null) {
      return { isValid: true, value: defaultValue, error: null };
    }
    return { isValid: false, value: null, error: 'Value is required' };
  }

  // Parse the value
  const parsedValue = allowFloat ? parseFloat(value) : parseInt(value, 10);

  // Check if parsing was successful
  if (isNaN(parsedValue)) {
    return { isValid: false, value: null, error: 'Invalid number format' };
  }

  // Check range constraints (basic validation)
  if (parsedValue < min) {
    return { isValid: false, value: null, error: `Value must be at least ${min}` };
  }

  if (parsedValue > max) {
    return { isValid: false, value: null, error: `Value must not exceed ${max}` };
  }

  // Apply custom validation if provided (for more complex constraints)
  if (customValidation && typeof customValidation === 'function') {
    try {
      const customResult = customValidation(parsedValue);
      if (customResult && !customResult.isValid) {
        return customResult;
      }
    } catch (error) {
      console.warn('Custom validation function threw an error:', error);
      // Fall back to basic validation if custom validation fails
    }
  }

  return { isValid: true, value: parsedValue, error: null };
};

// Hook for managing validated number inputs with "Enter to confirm" behavior
export const useValidatedNumberInput = (
  initialValue,
  onValidatedChange,
  validationOptions = {},
  showNotification = null
) => {
  const [inputValue, setInputValue] = useState(initialValue?.toString() || '');
  const [isValid, setIsValid] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Update input value when initialValue changes externally
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== null) {
      const newInputValue = initialValue.toString();
      if (inputValue !== newInputValue && !hasUnsavedChanges) {
        setInputValue(newInputValue);
      }
    }
  }, [initialValue, inputValue, hasUnsavedChanges]);

  const validateAndUpdate = useCallback((value) => {
    const validation = validateNumberInput(value, validationOptions);
    setIsValid(validation.isValid);

    if (validation.isValid) {
      if (onValidatedChange) {
        onValidatedChange(validation.value);
      }
      setHasUnsavedChanges(false);
      return true;
    } else {
      if (showNotification && validation.error) {
        showNotification(validation.error, 'warning');
      }
      return false;
    }
  }, [onValidatedChange, validationOptions, showNotification]);

  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Show validation status visually but don't update the actual value yet
    const validation = validateNumberInput(newValue, validationOptions);
    setIsValid(validation.isValid);
    setHasUnsavedChanges(true);
  }, [validationOptions]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateAndUpdate(inputValue);
    } else if (e.key === 'Escape') {
      // Reset to original value
      setInputValue(initialValue?.toString() || '');
      setIsValid(true);
      setHasUnsavedChanges(false);
    }
  }, [inputValue, validateAndUpdate, initialValue]);

  const handleBlur = useCallback(() => {
    if (hasUnsavedChanges) {
      validateAndUpdate(inputValue);
    }
  }, [hasUnsavedChanges, inputValue, validateAndUpdate]);

  return {
    inputValue,
    isValid,
    hasUnsavedChanges,
    handleInputChange,
    handleKeyDown,
    handleBlur,
    validateAndUpdate: () => validateAndUpdate(inputValue)
  };
};

// Helper function to get CSS classes for input validation state
export const getInputValidationClasses = (isValid, hasUnsavedChanges, baseClasses = '') => {
  let classes = baseClasses;
  
  if (hasUnsavedChanges) {
    if (isValid) {
      classes += ' border-yellow-400 bg-yellow-50'; // Valid but unsaved
    } else {
      classes += ' border-red-400 bg-red-50'; // Invalid
    }
  } else {
    classes += ' border-gray-300'; // Normal state
  }
  
  return classes;
};

// String validation utilities for names and IDs
export const validateStringInput = (value, options = {}) => {
  const {
    minLength = 1,
    maxLength = 100,
    allowEmpty = false,
    forbiddenChars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
    trim = true
  } = options;

  let processedValue = value;
  if (trim) {
    processedValue = value?.toString().trim() || '';
  }

  if (!processedValue) {
    if (allowEmpty) {
      return { isValid: true, value: processedValue, error: null };
    } else {
      return { isValid: false, value: processedValue, error: 'This field is required' };
    }
  }

  if (processedValue.length < minLength) {
    return { isValid: false, value: processedValue, error: `Must be at least ${minLength} characters long` };
  }

  if (processedValue.length > maxLength) {
    return { isValid: false, value: processedValue, error: `Must be no more than ${maxLength} characters long` };
  }

  // Check for forbidden characters
  const foundForbiddenChars = forbiddenChars.filter(char => processedValue.includes(char));
  if (foundForbiddenChars.length > 0) {
    return { 
      isValid: false, 
      value: processedValue, 
      error: `Cannot contain these characters: ${foundForbiddenChars.join(', ')}` 
    };
  }

  return { isValid: true, value: processedValue, error: null };
};

// Sanitize string by removing/replacing forbidden characters
export const sanitizeString = (value, options = {}) => {
  const {
    replacement = '_',
    forbiddenChars = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
    trim = true
  } = options;

  let sanitized = value?.toString() || '';
  if (trim) {
    sanitized = sanitized.trim();
  }

  // Replace forbidden characters with replacement
  forbiddenChars.forEach(char => {
    sanitized = sanitized.replace(new RegExp(`\\${char}`, 'g'), replacement);
  });

  // Remove multiple consecutive replacements
  sanitized = sanitized.replace(new RegExp(`\\${replacement}+`, 'g'), replacement);

  // Remove leading/trailing replacements
  sanitized = sanitized.replace(new RegExp(`^\\${replacement}+|\\${replacement}+$`, 'g'), '');

  return sanitized;
};

// Hook for managing validated string inputs with "Enter to confirm" behavior
export const useValidatedStringInput = (
  initialValue,
  onValidatedChange,
  validationOptions = {},
  showNotification = null
) => {
  const [inputValue, setInputValue] = useState(initialValue?.toString() || '');
  const [isValid, setIsValid] = useState(true);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // Update input value when initialValue changes externally
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== null) {
      const newInputValue = initialValue.toString();
      if (inputValue !== newInputValue && !hasUnsavedChanges) {
        setInputValue(newInputValue);
      }
    }
  }, [initialValue, inputValue, hasUnsavedChanges]);

  const validateAndUpdate = useCallback((value) => {
    const validation = validateStringInput(value, validationOptions);
    setIsValid(validation.isValid);

    if (validation.isValid) {
      if (onValidatedChange) {
        onValidatedChange(validation.value);
      }
      setHasUnsavedChanges(false);
      return true;
    } else {
      if (showNotification && validation.error) {
        showNotification(validation.error, 'warning');
      }
      return false;
    }
  }, [onValidatedChange, validationOptions, showNotification]);

  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Show validation status visually but don't update the actual value yet
    const validation = validateStringInput(newValue, validationOptions);
    setIsValid(validation.isValid);
    setHasUnsavedChanges(true);
  }, [validationOptions]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      validateAndUpdate(inputValue);
    } else if (e.key === 'Escape') {
      // Reset to original value
      setInputValue(initialValue?.toString() || '');
      setIsValid(true);
      setHasUnsavedChanges(false);
    }
  }, [inputValue, validateAndUpdate, initialValue]);

  const handleBlur = useCallback(() => {
    if (hasUnsavedChanges) {
      validateAndUpdate(inputValue);
    }
  }, [hasUnsavedChanges, inputValue, validateAndUpdate]);

  return {
    inputValue,
    isValid,
    hasUnsavedChanges,
    handleInputChange,
    handleKeyDown,
    handleBlur,
    validateAndUpdate: () => validateAndUpdate(inputValue)
  };
};