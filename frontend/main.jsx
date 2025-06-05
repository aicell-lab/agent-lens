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
import { login, initializeServices, getServer, tryGetService, HyphaServerManager } from './utils';
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
  const [selectedMicroscopeId, setSelectedMicroscopeId] = useState("squid-control/squid-control-reef");
  const [currentOperation, setCurrentOperation] = useState(null);
  const [hyphaManager, setHyphaManager] = useState(null);
  const [orchestratorManagerService, setOrchestratorManagerService] = useState(null);
  
  // Notification state
  const [notification, setNotification] = useState({ message: '', type: 'error' });

  const appendLog = useCallback((message) => {
    setLog((prevLog) => prevLog + message + '\n');
  }, []);

  // Function to show notifications
  const showNotification = useCallback((message, type = 'error') => {
    setNotification({ message, type });
  }, []);

  // Function to dismiss notifications
  const dismissNotification = useCallback(() => {
    setNotification({ message: '', type: 'error' });
  }, []);

  useEffect(() => {
    const checkTokenAndInit = async () => {
      const token = localStorage.getItem("token");
      if (token) {
        const manager = new HyphaServerManager(token);
        setHyphaManager(manager);
        await handleLogin(selectedMicroscopeId, manager);
      } else {
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
            (msg) => { console.log(`[tryGetService in Effect]: ${msg}`); appendLog(msg); }
          );
          
          if (newMicroscopeService) {
            console.log("[Effect Hook] Successfully obtained new microscope service:", newMicroscopeService);
            setMicroscopeControlService(newMicroscopeService);
            appendLog("Microscope service switched successfully.");
          } else {
            console.error("[Effect Hook] Failed to obtain new microscope service.");
            appendLog("Failed to switch microscope service. Service object was null.");
          }
        } catch (error) {
          console.error("[Effect Hook] Error during microscope service switch:", error);
          appendLog(`Error switching microscope service: ${error.message}`);
        }
      };
      reinitializeMicroscopeServiceOnly();
    }
  }, [selectedMicroscopeId, isAuthenticated, hyphaManager, appendLog]);

  const handleLogin = async (microscopeIdToUse, existingManager = null) => {
    console.log(`[handleLogin] Attempting login. Initial microscope ID to use: ${microscopeIdToUse}`);
    let managerToUse = existingManager;
    try {
      setLoginError(null);
      const token = await login();
      console.log("[handleLogin] Login successful, token obtained:", token);

      if (!managerToUse) {
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
    
    setActiveTab(tab);
  };

  const handleMicroscopeSelection = (microscopeId) => {
    if (microscopeId !== selectedMicroscopeId) {
      setSnapshotImage(null);
      appendLog(`Selected microscope ID: ${microscopeId}`);
      setSelectedMicroscopeId(microscopeId);
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'image-view':
        return (
          <div className="control-view">
            <ImageViewBrowser
              appendLog={appendLog}
            />
          </div>
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
          <div className="control-view">
            <ImageSearchPanel
              similarityService={similarityService}
              appendLog={appendLog}
              showNotification={showNotification}
            />
          </div>
        );
      case 'microscope':
        return (
          <div className="control-view">
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
              onClose={() => {}}
            />
          </div>
        );
      case 'incubator':
        return (
          <div className="control-view">
            <IncubatorControl
              incubatorControlService={incubatorControlService}
              appendLog={appendLog}
            />
          </div>
        );
      case 'dashboard':
        return (
          <div className="control-view">
            <LogSection log={log} />
          </div>
        );
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
            </div>
            {/* Notification popup */}
            <Notification 
              message={notification.message}
              type={notification.type}
              onDismiss={dismissNotification}
            />
          </div>
        )}
      </div>
    </StrictMode>
  );
};

// Render the application
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<MicroscopeControl />);
