import React, { StrictMode, useEffect, useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import 'bootstrap/dist/css/bootstrap.min.css';
import '@fortawesome/fontawesome-free/css/all.min.css';
import LogSection from './components/LogSection';
import LoginPrompt from './components/LoginPrompt';
import MapDisplay from './components/MapDisplay';
import IncubatorControl from './components/IncubatorControl';
import MicroscopeControlPanel from './components/MicroscopeControlPanel';
import Sidebar from './components/Sidebar';
import ImageViewBrowser from './components/ImageViewBrowser';
import ImageSearchPanel from './components/ImageSearchPanel';
import Notification from './components/Notification';
import ImageJPanel from './components/ImageJPanel';
import { login, initializeServices, tryGetService, HyphaServerManager } from './utils';
import 'ol/ol.css';
import './main.css';

// Import packages that might cause issues
// to handle them safely with error boundaries
const loadExternalDependencies = () => {
  try {
    // Pre-load any problematic dependencies
    require('react-color');
    console.log('External dependencies loaded successfully');
  } catch (e) {
    console.warn('Some external dependencies could not be loaded:', e);
  }
};

// Call the function to preload dependencies
loadExternalDependencies();

const MicroscopeControl = () => {    
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [microscopeControlService, setMicroscopeControlService] = useState(null);
  const [similarityService, setSimilarityService] = useState(null);
  const [log, setLog] = useState('');
  const [segmentService, setSegmentService] = useState(null);
  const [incubatorControlService, setIncubatorControlService] = useState(null);
  const [roboticArmService, setRoboticArmService] = useState(null);
  const [activeTab, setActiveTab] = useState('image-view');
  const [currentMap, setCurrentMap] = useState(null);
  const [snapshotImage, setSnapshotImage] = useState(null);
  const [addTileLayer, setAddTileLayer] = useState(null);
  const [channelNames, setChannelNames] = useState(null);
  const [vectorLayer, setVectorLayer] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [selectedMicroscopeId, setSelectedMicroscopeId] = useState("agent-lens/squid-control-reef");
  const [currentOperation, setCurrentOperation] = useState(null);
  const [hyphaManager, setHyphaManager] = useState(null);
  const [orchestratorManagerService, setOrchestratorManagerService] = useState(null);
  
  // ImageJ state
  const [isImageJPanelOpen, setIsImageJPanelOpen] = useState(false);
  const [imageForImageJ, setImageForImageJ] = useState(null);
  const [imjoyApi, setImjoyApi] = useState(null);
  
  // Notification state - now supports multiple notifications
  const [notifications, setNotifications] = useState([]);

  const appendLog = useCallback((message) => {
    setLog((prevLog) => prevLog + message + '\n');
  }, []);

  // Function to show notifications - adds new notification to the stack
  const showNotification = useCallback((message, type = 'error') => {
    const newNotification = { 
      id: Date.now() + Math.random(), // Unique ID for each notification
      message, 
      type 
    };
    setNotifications(prev => {
      const updated = [...prev, newNotification];
      // Limit to maximum 2 notifications to prevent UI clutter
      if (updated.length > 2) {
        return updated.slice(-2); // Keep only the last 5 notifications
      }
      return updated;
    });
  }, []);

  // Function to dismiss a specific notification by ID
  const dismissNotification = useCallback((notificationId) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  useEffect(() => {
    const initializeImJoy = async () => {
      if (!window.loadImJoyCore || imjoyApi) return;
      try {
        appendLog('Initializing ImJoy Core for ImageJ.js...');
        const imjoyCore = await window.loadImJoyCore();
        const imjoy = new imjoyCore.ImJoy({ imjoy_api: {} });
        await imjoy.start({ workspace: 'default' });
        setImjoyApi(imjoy.api);
        appendLog('ImJoy Core for ImageJ.js initialized successfully.');
      } catch (err) {
        console.error('Error initializing ImJoy Core:', err);
        appendLog(`Error initializing ImJoy Core: ${err.message}`);
        showNotification(`Failed to initialize ImageJ.js integration: ${err.message}`, 'error');
      }
    };
    initializeImJoy();
  }, []); // Run only once

  useEffect(() => {
    const checkTokenAndInit = async () => {
      const token = localStorage.getItem("token");
      if (token) {
        console.log("[checkTokenAndInit] Found token in localStorage, initializing...");
        const manager = new HyphaServerManager(token);
        setHyphaManager(manager);
        await handleLogin(selectedMicroscopeId, manager);
      } else {
        console.log("[checkTokenAndInit] No token found, user needs to log in");
        // No token, user needs to log in, LoginPrompt will be shown
      }
    }

    // Clear any previous map setup on fresh page load
    const currentSession = sessionStorage.getItem('mapSetupSession');
    if (!currentSession) {
      // This is a fresh login/page load, clear any previous map setup
      localStorage.removeItem('imageMapDataset');
      sessionStorage.setItem('mapSetupSession', Date.now().toString());
    }

    checkTokenAndInit();
    
    // Cleanup manager on component unmount
    return () => {
      if (hyphaManager) {
        console.log("[Main Unmount] Disconnecting all Hypha servers via manager.");
        hyphaManager.disconnectAll();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated && hyphaManager) {
      const reinitializeMicroscopeServiceOnly = async () => {
        console.log(`[Effect Hook] Attempting to reinitialize microscope service for: ${selectedMicroscopeId}`);
        appendLog(`Switching microscope to: ${selectedMicroscopeId}`);
        try {
          const microscopeLocalId = selectedMicroscopeId.startsWith("squid-control/") ? null : selectedMicroscopeId;
          const newMicroscopeService = await tryGetService(
            hyphaManager,
            "Microscope Control",
            selectedMicroscopeId, 
            microscopeLocalId,    
            (msg) => { console.log(`[tryGetService in Effect]: ${msg}`); appendLog(msg); },
            showNotification // Pass showNotification to display errors to user
          );
          
          if (newMicroscopeService) {
            console.log("[Effect Hook] Successfully obtained new microscope service:", newMicroscopeService);
            setMicroscopeControlService(newMicroscopeService);
            appendLog("Microscope service switched successfully.");
            showNotification("Microscope service connected successfully.", "success");
          } else {
            // Service failed to load - clear any previous service and show error
            console.error("[Effect Hook] Failed to obtain new microscope service.");
            setMicroscopeControlService(null); // Clear previous service
            appendLog(`Failed to connect to microscope service: ${selectedMicroscopeId}`);
            showNotification(`Failed to connect to microscope: ${selectedMicroscopeId}. Service may be unavailable.`, "error");
          }
        } catch (error) {
          console.error("[Effect Hook] Error during microscope service switch:", error);
          setMicroscopeControlService(null); // Clear previous service on error
          appendLog(`Error switching microscope service: ${error.message}`);
          showNotification(`Error connecting to microscope: ${error.message}`, "error");
        }
      };
      reinitializeMicroscopeServiceOnly();
    }
  }, [selectedMicroscopeId, isAuthenticated, hyphaManager, appendLog, showNotification]);

  const handleLogin = async (microscopeIdToUse, existingManager = null) => {
    console.log(`[handleLogin] Attempting login. Initial microscope ID to use: ${microscopeIdToUse}`);
    let managerToUse = existingManager;
    try {
      setLoginError(null);
      const token = await login();
      console.log("[handleLogin] Login successful, token obtained:", token);

      // Check if we need to update the existing manager's token or create a new one
      if (managerToUse) {
        const currentToken = managerToUse.getCurrentToken();
        if (currentToken !== token) {
          console.log("[handleLogin] Token changed, updating HyphaServerManager with new token");
          await managerToUse.updateToken(token);
        }
      } else {
        console.log("[handleLogin] Creating new HyphaServerManager with fresh token");
        managerToUse = new HyphaServerManager(token);
        setHyphaManager(managerToUse); 
      }
      
      console.log(`[handleLogin] Calling initializeServices with microscopeIdToUse: ${microscopeIdToUse}`);
      await initializeServices(managerToUse,
        setMicroscopeControlService, setSimilarityService, setSegmentService,
        setIncubatorControlService, setRoboticArmService, setOrchestratorManagerService,
        (msg) => { console.log(`[initializeServices in Login]: ${msg}`); appendLog(msg); },
        microscopeIdToUse,
        showNotification
      );
      appendLog("Logged in.");
      setIsAuthenticated(true);
      console.log("[handleLogin] Login and service initialization complete. isAuthenticated set to true.");
    } catch (error) {
      console.error("[handleLogin] Login failed:", error);
      setLoginError(error.message);
      localStorage.removeItem("token");
    }
  };

  // Handle tab change with cleanup logic for image map
  const handleTabChange = (tab) => {
    // If navigating away from the image map view, clean up resources
    if ((activeTab === 'image-view-map') && (tab !== 'image-view' && tab !== 'image-view-map') && currentMap) {
      // Clean up the map resources
      appendLog("Stopping image map access");
      
      // Remove all layers from the map
      if (currentMap) {
        const layers = currentMap.getLayers().getArray().slice();
        layers.forEach(layer => {
          if (layer && layer !== vectorLayer) {
            currentMap.removeLayer(layer);
          }
        });
      }
    }
    
    // If switching to ImageJ tab, initialize the panel
    if (tab === 'imagej' && !isImageJPanelOpen) {
      setIsImageJPanelOpen(true);
      appendLog('Initializing ImageJ.js panel...');
    }
    
    setActiveTab(tab);
  };

  const handleMicroscopeSelection = (microscopeId) => {
    if (microscopeId !== selectedMicroscopeId) {
      setSnapshotImage(null);
      appendLog(`Selected microscope ID: ${microscopeId}`);
      setSelectedMicroscopeId(microscopeId);
    }
  };

  const handleOpenImageJ = useCallback((imageData) => {
    setImageForImageJ(imageData);
    setActiveTab('imagej');
    setIsImageJPanelOpen(true);
    appendLog('Sending image to ImageJ.js...');
  }, [setActiveTab]);

  const renderContent = () => {
    switch (activeTab) {
      case 'image-view':
        return (
          <ImageViewBrowser
            appendLog={appendLog}
          />
        );
      case 'image-view-map':
        // Only render MapDisplay when in image-view-map mode
        return (
          <MapDisplay
            appendLog={appendLog}
            segmentService={segmentService}
            microscopeControlService={microscopeControlService}
            incubatorControlService={incubatorControlService}
            setCurrentMap={setCurrentMap}
          />
        );
      case 'image-search':
        return (
          <ImageSearchPanel
            similarityService={similarityService}
            appendLog={appendLog}
            showNotification={showNotification}
          />
        );
      case 'microscope':
        return (
          <MicroscopeControlPanel
            key={selectedMicroscopeId}
            microscopeControlService={microscopeControlService}
            appendLog={appendLog}
            map={currentMap}
            setSnapshotImage={setSnapshotImage}
            snapshotImage={snapshotImage}
            segmentService={segmentService}
            addTileLayer={addTileLayer}
            channelNames={channelNames}
            vectorLayer={vectorLayer}
            selectedMicroscopeId={selectedMicroscopeId}
            incubatorControlService={incubatorControlService}
            roboticArmService={roboticArmService}
            orchestratorManagerService={orchestratorManagerService}
            currentOperation={currentOperation}
            setCurrentOperation={setCurrentOperation}
            hyphaManager={hyphaManager}
            showNotification={showNotification}
            onOpenImageJ={handleOpenImageJ}
            imjoyApi={imjoyApi}
            onClose={() => {}}
          />
        );
      case 'incubator':
        return (
          <IncubatorControl
            incubatorControlService={incubatorControlService}
            appendLog={appendLog}
            microscopeControlService={microscopeControlService}
            roboticArmService={roboticArmService}
            selectedMicroscopeId={selectedMicroscopeId}
            hyphaManager={hyphaManager}
            currentOperation={currentOperation}
            setCurrentOperation={setCurrentOperation}
          />
        );
      case 'dashboard':
        return (
          <LogSection log={log} />
        );
      case 'imagej':
        // ImageJ content is now rendered separately as a persistent panel
        return null;
      default:
        return null;
    }
  };

  return (
    <StrictMode>
      <div className="app-container">
        {!isAuthenticated ? (
          <LoginPrompt onLogin={() => handleLogin(selectedMicroscopeId)} error={loginError} />
        ) : (
          <div className="main-layout">
            <Sidebar 
              activeTab={activeTab} 
              onTabChange={handleTabChange} 
              onMicroscopeSelect={handleMicroscopeSelection} 
              selectedMicroscopeId={selectedMicroscopeId} 
              incubatorControlService={incubatorControlService}
              microscopeControlService={microscopeControlService}
              roboticArmService={roboticArmService}
              currentOperation={currentOperation}
            />
            <div className="content-area">
              {renderContent()}
              {/* Persistent ImageJ Panel - always mounted but conditionally visible */}
              {isImageJPanelOpen && (
                <div 
                  className={`imagej-persistent-panel ${activeTab === 'imagej' ? 'visible' : 'hidden'}`}
                  style={{ 
                    position: activeTab === 'imagej' ? 'relative' : 'absolute',
                    top: activeTab === 'imagej' ? 'auto' : '-9999px',
                    left: activeTab === 'imagej' ? 'auto' : '-9999px',
                    width: activeTab === 'imagej' ? '100%' : '0',
                    height: activeTab === 'imagej' ? '100%' : '0',
                    overflow: 'hidden',
                    zIndex: activeTab === 'imagej' ? 1 : -1
                  }}
                >
                  <ImageJPanel
                    isOpen={isImageJPanelOpen}
                    image={imageForImageJ}
                    imjoyApi={imjoyApi}
                    onClose={() => {
                      setIsImageJPanelOpen(false);
                      setActiveTab('microscope'); // Return to microscope tab
                    }}
                    appendLog={appendLog}
                  />
                </div>
              )}
            </div>
            {/* Notification popups - multiple notifications stack */}
            <div className="notifications-container">
              {notifications.map((notification) => (
                <Notification 
                  key={notification.id}
                  message={notification.message}
                  type={notification.type}
                  onDismiss={() => dismissNotification(notification.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </StrictMode>
  );
};

// Render the application
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<MicroscopeControl />);
