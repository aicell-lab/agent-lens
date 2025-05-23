import React, { StrictMode, useEffect, useState } from 'react';
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
import { login, initializeServices, getServer, tryGetService } from './utils';
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

  useEffect(() => {
    const checkTokenAndInit = async () => {
      if (localStorage.getItem("token")) {
        await handleLogin(selectedMicroscopeId);
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
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const reinitializeMicroscope = async () => {
        console.log(`[Effect Hook] Attempting to switch microscope. Selected ID: ${selectedMicroscopeId}`);
        appendLog(`Switching microscope to: ${selectedMicroscopeId}`);
        try {
          const token = localStorage.getItem("token");
          if (!token) {
            console.error("[Effect Hook] No token found for re-initialization");
            throw new Error("No token found for re-initialization");
          }
          console.log("[Effect Hook] Token found. Getting server...");
          const server = await getServer(token);
          console.log("[Effect Hook] Server object obtained:", server);
          
          const remoteId = selectedMicroscopeId;
          const localIdToUse = selectedMicroscopeId === "squid-control/squid-control-reef" ? null : selectedMicroscopeId;
          console.log(`[Effect Hook] Calling tryGetService with server, name: "Microscope Control", remoteId: ${remoteId}, localId: ${localIdToUse}`);

          const newMicroscopeService = await tryGetService(
            server,
            "Microscope Control",
            remoteId,
            localIdToUse,
            (msg) => { console.log(`[tryGetService in Effect]: ${msg}`); appendLog(msg); }
          );
          
          if (newMicroscopeService) {
            console.log("[Effect Hook] Successfully obtained new microscope service:", newMicroscopeService);
            setMicroscopeControlService(newMicroscopeService);
            appendLog("Microscope service switched successfully.");
            console.log("[Effect Hook] Microscope service state updated.");
            
            // Add a small delay to ensure the service is fully updated in the component tree
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log("[Effect Hook] Microscope service initialization complete.");
          } else {
            console.error("[Effect Hook] Failed to obtain new microscope service. tryGetService returned null.");
            appendLog("Failed to switch microscope service. Service object was null.");
          }
        } catch (error) {
          console.error("[Effect Hook] Error during microscope switch:", error);
          appendLog(`Error switching microscope: ${error.message}`);
        }
      };
      reinitializeMicroscope();
    }
  }, [selectedMicroscopeId, isAuthenticated]);

  const handleLogin = async (microscopeIdToUse) => {
    console.log(`[handleLogin] Attempting login. Initial microscope ID to use: ${microscopeIdToUse}`);
    try {
      setLoginError(null);
      const token = await login();
      console.log("[handleLogin] Login successful, token obtained:", token);
      const server = await getServer(token);
      console.log("[handleLogin] Server object obtained:", server);
      
      console.log(`[handleLogin] Calling initializeServices with microscopeIdToUse: ${microscopeIdToUse}`);
      await initializeServices(server,
        setMicroscopeControlService, setSimilarityService, setSegmentService,
        setIncubatorControlService, setRoboticArmService,
        (msg) => { console.log(`[initializeServices in Login]: ${msg}`); appendLog(msg); },
        microscopeIdToUse
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

  const appendLog = (message) => {
      setLog((prevLog) => prevLog + message + '\n');
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
      case 'microscope':
        return (
          <div className="control-view">
            <MicroscopeControlPanel
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
            />
            <div className="content-area">
              {renderContent()}
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
