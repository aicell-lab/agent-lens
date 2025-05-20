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
import ImagingTasksControl from './components/ImagingTasksControl';
import { login, initializeServices, getServer } from './utils';
import 'ol/ol.css';
import './main.css';
import DataManagement from './components/DataManagement';

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
  const [orchestratorService, setOrchestratorService] = useState(null);
  const [activeTab, setActiveTab] = useState('microscope');
  const [currentMap, setCurrentMap] = useState(null);
  const [snapshotImage, setSnapshotImage] = useState(null);
  const [addTileLayer, setAddTileLayer] = useState(null);
  const [channelNames, setChannelNames] = useState(null);
  const [vectorLayer, setVectorLayer] = useState(null);
  const [loginError, setLoginError] = useState(null);

  useEffect(() => {
    const checkToken = async () => {
      if (localStorage.getItem("token")) {
        await handleLogin();
      }
    }

    // Clear any previous map setup on fresh page load
    const currentSession = sessionStorage.getItem('mapSetupSession');
    if (!currentSession) {
      // This is a fresh login/page load, clear any previous map setup
      localStorage.removeItem('imageMapDataset');
      sessionStorage.setItem('mapSetupSession', Date.now().toString());
    }

    checkToken();
  }, []);

  const handleLogin = async () => {
    try {
      setLoginError(null);
      const token = await login();
      const server = await getServer(token);
      await initializeServices(server,
        setMicroscopeControlService, setSimilarityService, setSegmentService,
        setIncubatorControlService,
        setOrchestratorService,
        appendLog);
      appendLog("Logged in.");
      setIsAuthenticated(true);
    } catch (error) {
      console.error("Login failed:", error);
      setLoginError(error.message);
      localStorage.removeItem("token");
    }
  };

  const appendLog = (message) => {
      setLog((prevLog) => prevLog + message + '\n');
  };  

  // Handle tab change with cleanup logic for image map
  const handleTabChange = (tab) => {
    // If navigating away from the image map tab, clean up resources
    if (activeTab === 'main' && tab !== 'main' && currentMap) {
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

  const renderContent = () => {
    switch (activeTab) {
      case 'main':
        // Only render MapDisplay when the Image Map tab is active
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
      case 'imaging-tasks':
        return (
          <div className="control-view">
            <ImagingTasksControl
              orchestratorService={orchestratorService}
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
      case 'data-management':
        return (
          <div className="control-view">
            <DataManagement appendLog={appendLog} />
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
          <LoginPrompt onLogin={handleLogin} error={loginError} />
        ) : (
          <div className="main-layout">
            <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />
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
