import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';

/**
 * useExperimentZarrManager - React hook for managing local experiment zarr fileset operations
 * Handles experiment creation, activation, deletion, and reset for zarr-based data storage
 * on the local microscope system.
 */
const useExperimentZarrManager = ({
  microscopeControlService,
  isSimulatedMicroscope,
  showNotification,
  appendLog,
  onExperimentChange,
  onExperimentReset,
}) => {
  // Experiment management state
  const [experiments, setExperiments] = useState([]);
  const [activeExperiment, setActiveExperiment] = useState(null);
  const [isLoadingExperiments, setIsLoadingExperiments] = useState(false);
  const [showCreateExperimentDialog, setShowCreateExperimentDialog] = useState(false);
  const [newExperimentName, setNewExperimentName] = useState('');
  const [experimentInfo, setExperimentInfo] = useState(null);
  const [showClearCanvasConfirmation, setShowClearCanvasConfirmation] = useState(false);
  const [experimentToReset, setExperimentToReset] = useState(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [experimentToDelete, setExperimentToDelete] = useState(null);

  // Load experiments from microscope service
  const loadExperiments = useCallback(async () => {
    if (!microscopeControlService || isSimulatedMicroscope) return;
    
    // Prevent multiple simultaneous calls
    if (isLoadingExperiments) return;
    
    setIsLoadingExperiments(true);
    try {
      const result = await microscopeControlService.list_experiments();
      if (result.success !== false) {
        setExperiments(result.experiments || []);
        setActiveExperiment(result.active_experiment || null);
        if (appendLog) {
          appendLog(`Loaded ${result.total_count} experiments, active: ${result.active_experiment || 'none'}`);
        }
        if (onExperimentChange) {
          onExperimentChange({
            experiments: result.experiments || [],
            activeExperiment: result.active_experiment || null
          });
        }
      }
    } catch (error) {
      console.error('Failed to load experiments:', error);
      // Check if it's a connection error
      if (error.message && error.message.includes('Client disconnected')) {
        if (appendLog) appendLog('Microscope service disconnected. Please check connection and try again.');
        if (showNotification) showNotification('Microscope service disconnected. Please check connection.', 'error');
      } else {
        if (appendLog) appendLog(`Failed to load experiments: ${error.message}`);
      }
      // Reset to empty state on error
      setExperiments([]);
      setActiveExperiment(null);
    } finally {
      setIsLoadingExperiments(false);
    }
  }, [microscopeControlService, isSimulatedMicroscope, appendLog, onExperimentChange, isLoadingExperiments, showNotification]);

  // Create new experiment
  const createExperiment = useCallback(async (name) => {
    if (!microscopeControlService || !name.trim()) return;
    
    try {
      const result = await microscopeControlService.create_experiment(name.trim());
      if (result.success !== false) {
        if (showNotification) showNotification(`Created experiment: ${name}`, 'success');
        if (appendLog) appendLog(`Created experiment: ${name}`);
        await loadExperiments(); // Refresh the list
      } else {
        if (showNotification) showNotification(`Failed to create experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to create experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error creating experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error creating experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments]);

  // Set active experiment
  const setActiveExperimentHandler = useCallback(async (experimentName) => {
    if (!microscopeControlService || !experimentName) return;
    
    try {
      const result = await microscopeControlService.set_active_experiment(experimentName);
      if (result.success !== false) {
        if (showNotification) showNotification(`Activated experiment: ${experimentName}`, 'success');
        if (appendLog) appendLog(`Set active experiment: ${experimentName}`);
        await loadExperiments(); // Refresh the list
        if (onExperimentChange) {
          onExperimentChange({
            experiments,
            activeExperiment: experimentName
          });
        }
      } else {
        if (showNotification) showNotification(`Failed to activate experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to activate experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error activating experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error activating experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments, experiments, onExperimentChange]);

  // Remove experiment
  const removeExperiment = useCallback(async (experimentName) => {
    console.log(`[removeExperiment] Attempting to remove experiment: ${experimentName}`);
    if (!microscopeControlService || !experimentName) {
      console.log(`[removeExperiment] Missing service or experiment name. Service: ${!!microscopeControlService}, Name: ${experimentName}`);
      return;
    }
    
    try {
      console.log(`[removeExperiment] Calling microscopeControlService.remove_experiment(${experimentName})`);
      const result = await microscopeControlService.remove_experiment(experimentName);
      console.log(`[removeExperiment] Service response:`, result);
      
      if (result.success !== false) {
        if (showNotification) showNotification(`Removed experiment: ${experimentName}`, 'success');
        if (appendLog) appendLog(`Removed experiment: ${experimentName}`);
        await loadExperiments(); // Refresh the list
      } else {
        if (showNotification) showNotification(`Failed to remove experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to remove experiment: ${result.message}`);
      }
    } catch (error) {
      console.error(`[removeExperiment] Error:`, error);
      if (showNotification) showNotification(`Error removing experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error removing experiment: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog, loadExperiments]);

  // Get experiment info
  const getExperimentInfo = useCallback(async (experimentName) => {
    if (!microscopeControlService || !experimentName) return;
    
    try {
      const result = await microscopeControlService.get_experiment_info(experimentName);
      if (result.success !== false) {
        setExperimentInfo(result);
        if (appendLog) appendLog(`Loaded experiment info for: ${experimentName}`);
      } else {
        if (showNotification) showNotification(`Failed to get experiment info: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to get experiment info: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error getting experiment info: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error getting experiment info: ${error.message}`);
    }
  }, [microscopeControlService, showNotification, appendLog]);

  // Auto-create experiment when sample is loaded
  const autoCreateExperiment = useCallback(async (sampleId, sampleName) => {
    if (!microscopeControlService || !sampleId || isSimulatedMicroscope || !sampleName) return;
    
    // Use the actual sample name
    const experimentName = sampleName;
    
    try {
      // Check if experiment already exists
      const result = await microscopeControlService.list_experiments();
      if (result.success !== false) {
        const existingExperiment = result.experiments?.find(exp => exp.name === experimentName);
        if (existingExperiment) {
          // If experiment exists, just activate it
          await setActiveExperimentHandler(experimentName);
          if (appendLog) appendLog(`Activated existing experiment: ${experimentName}`);
          return;
        }
      }
      
      // Create new experiment with sample name
      const createResult = await microscopeControlService.create_experiment(experimentName);
      if (createResult.success !== false) {
        if (showNotification) showNotification(`Auto-created experiment: ${experimentName}`, 'success');
        if (appendLog) appendLog(`Auto-created experiment: ${experimentName} for sample: ${sampleId}`);
        await loadExperiments(); // Refresh the list
      } else {
        if (showNotification) showNotification(`Failed to auto-create experiment: ${createResult.message}`, 'error');
        if (appendLog) appendLog(`Failed to auto-create experiment: ${createResult.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Error auto-creating experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Error auto-creating experiment: ${error.message}`);
    }
  }, [microscopeControlService, isSimulatedMicroscope, showNotification, appendLog, setActiveExperimentHandler, loadExperiments]);

  // Reset experiment after confirmation
  const handleResetExperiment = useCallback(async () => {
    if (!microscopeControlService || !experimentToReset) return;
    
    try {
      const result = await microscopeControlService.reset_experiment(experimentToReset);
      if (result.success !== false) {
        if (showNotification) showNotification(`Experiment '${experimentToReset}' reset successfully`, 'success');
        if (appendLog) appendLog(`Experiment '${experimentToReset}' reset successfully`);
        await loadExperiments(); // Refresh the list
        if (onExperimentReset) {
          onExperimentReset(experimentToReset);
        }
      } else {
        if (showNotification) showNotification(`Failed to reset experiment: ${result.message}`, 'error');
        if (appendLog) appendLog(`Failed to reset experiment: ${result.message}`);
      }
    } catch (error) {
      if (showNotification) showNotification(`Failed to reset experiment: ${error.message}`, 'error');
      if (appendLog) appendLog(`Failed to reset experiment: ${error.message}`);
    } finally {
      setShowClearCanvasConfirmation(false);
      setExperimentToReset(null);
    }
  }, [microscopeControlService, experimentToReset, showNotification, appendLog, loadExperiments, onExperimentReset]);

  // Handle delete experiment confirmation
  const handleDeleteExperiment = useCallback(async () => {
    if (!experimentToDelete || !microscopeControlService) return;
    
    try {
      const result = await microscopeControlService.remove_experiment(experimentToDelete);
      if (result.success !== false) {
        if (appendLog) appendLog(`Experiment "${experimentToDelete}" deleted successfully`);
        if (showNotification) showNotification(`Experiment "${experimentToDelete}" deleted successfully`, 'success');
        
        // Reload experiments to get updated list
        await loadExperiments();
        
        // If the deleted experiment was active, clear the active experiment
        if (activeExperiment === experimentToDelete) {
          setActiveExperiment(null);
          if (onExperimentChange) {
            onExperimentChange({
              experiments: experiments.filter(exp => exp.name !== experimentToDelete),
              activeExperiment: null
            });
          }
        }
      } else {
        if (appendLog) appendLog(`Failed to delete experiment: ${result.message || 'Unknown error'}`);
        if (showNotification) showNotification(`Failed to delete experiment: ${result.message || 'Unknown error'}`, 'error');
      }
    } catch (error) {
      console.error('Failed to delete experiment:', error);
      if (appendLog) appendLog(`Failed to delete experiment: ${error.message}`);
      if (showNotification) showNotification(`Failed to delete experiment: ${error.message}`, 'error');
    } finally {
      setShowDeleteConfirmation(false);
      setExperimentToDelete(null);
    }
  }, [experimentToDelete, microscopeControlService, appendLog, showNotification, loadExperiments, activeExperiment, experiments, onExperimentChange]);

  // Render UI dialogs
  const renderDialogs = () => (
    <>
      {/* Reset Experiment Confirmation Dialog */}
      {showClearCanvasConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md w-full text-white">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-exclamation-triangle text-red-400 mr-2"></i>
                Reset Experiment
              </h3>
              <button
                onClick={() => setShowClearCanvasConfirmation(false)}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4">
              <p className="text-gray-300 mb-4">
                Are you sure you want to reset experiment "{experimentToReset}"? This will permanently delete all experiment data and cannot be undone.
              </p>
              <div className="bg-yellow-900 bg-opacity-30 border border-yellow-500 rounded-lg p-3 mb-4">
                <div className="flex items-start">
                  <i className="fas fa-info-circle text-yellow-400 mr-2 mt-0.5"></i>
                  <div className="text-sm text-yellow-200">
                    <p className="font-medium mb-1">This action will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Remove all scan result images from all wells</li>
                      <li>Clear all experiment data from storage</li>
                      <li>Reset the experiment to empty state</li>
                      <li>Keep the experiment structure for future use</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end space-x-3 p-4 border-t border-gray-600">
              <button
                onClick={() => {
                  setShowClearCanvasConfirmation(false);
                  setExperimentToReset(null);
                }}
                className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                <i className="fas fa-times mr-1"></i>
                Cancel
              </button>
              <button
                onClick={handleResetExperiment}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                <i className="fas fa-undo mr-1"></i>
                Reset Experiment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Experiment Dialog */}
      {showCreateExperimentDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md w-full text-white">
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-plus text-green-400 mr-2"></i>
                Create New Experiment
              </h3>
              <button
                onClick={() => {
                  setShowCreateExperimentDialog(false);
                  setNewExperimentName('');
                }}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="p-4">
              <div className="mb-4">
                <label className="block text-gray-300 font-medium mb-2">Experiment Name</label>
                <input
                  type="text"
                  value={newExperimentName}
                  onChange={(e) => setNewExperimentName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter experiment name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newExperimentName.trim()) {
                      createExperiment(newExperimentName);
                      setShowCreateExperimentDialog(false);
                      setNewExperimentName('');
                    }
                  }}
                />
              </div>
              <div className="bg-blue-900 bg-opacity-30 border border-blue-500 rounded-lg p-3 mb-4">
                <div className="flex items-start">
                  <i className="fas fa-info-circle text-blue-400 mr-2 mt-0.5"></i>
                  <div className="text-sm text-blue-200">
                    <p className="font-medium mb-1">About Experiments:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Experiments organize well-separated microscopy data</li>
                      <li>Each well has its own canvas within the experiment</li>
                      <li>Only one experiment can be active at a time</li>
                      <li>Better scalability and data organization</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 p-4 border-t border-gray-600">
              <button
                onClick={() => {
                  setShowCreateExperimentDialog(false);
                  setNewExperimentName('');
                }}
                className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newExperimentName.trim()) {
                    createExperiment(newExperimentName);
                    setShowCreateExperimentDialog(false);
                    setNewExperimentName('');
                  }
                }}
                className="px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
                disabled={!newExperimentName.trim()}
              >
                <i className="fas fa-plus mr-1"></i>
                Create Experiment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Experiment Confirmation Dialog */}
      {showDeleteConfirmation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-w-md w-full text-white">
            {/* Modal Header */}
            <div className="flex justify-between items-center p-4 border-b border-gray-600">
              <h3 className="text-lg font-semibold text-gray-200 flex items-center">
                <i className="fas fa-trash text-red-400 mr-2"></i>
                Delete Experiment
              </h3>
              <button
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  setExperimentToDelete(null);
                }}
                className="text-gray-400 hover:text-white text-xl font-bold w-6 h-6 flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-4">
              <p className="text-gray-300 mb-4">
                Are you sure you want to delete experiment "{experimentToDelete}"? This will permanently remove the experiment and all its data. This action cannot be undone.
              </p>
              <div className="bg-red-900 bg-opacity-30 border border-red-500 rounded-lg p-3 mb-4">
                <div className="flex items-start">
                  <i className="fas fa-exclamation-triangle text-red-400 mr-2 mt-0.5"></i>
                  <div className="text-sm text-red-200">
                    <p className="font-medium mb-1">This action will:</p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Permanently delete the experiment</li>
                      <li>Remove all associated data and files</li>
                      <li>Clear the experiment from the list</li>
                      <li>Cannot be undone</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex justify-end space-x-3 p-4 border-t border-gray-600">
              <button
                onClick={() => {
                  setShowDeleteConfirmation(false);
                  setExperimentToDelete(null);
                }}
                className="px-4 py-2 text-sm bg-gray-600 hover:bg-gray-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                <i className="fas fa-times mr-1"></i>
                Cancel
              </button>
              <button
                onClick={handleDeleteExperiment}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              >
                <i className="fas fa-trash mr-1"></i>
                Delete Experiment
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  // Return the manager object with all functions, state, and UI
  return {
    // State
    experiments,
    activeExperiment,
    isLoadingExperiments,
    showCreateExperimentDialog,
    setShowCreateExperimentDialog,
    newExperimentName,
    setNewExperimentName,
    experimentInfo,
    showClearCanvasConfirmation,
    setShowClearCanvasConfirmation,
    experimentToReset,
    setExperimentToReset,
    showDeleteConfirmation,
    setShowDeleteConfirmation,
    experimentToDelete,
    setExperimentToDelete,
    
    // Functions
    loadExperiments,
    createExperiment,
    setActiveExperimentHandler,
    removeExperiment,
    getExperimentInfo,
    autoCreateExperiment,
    handleResetExperiment,
    handleDeleteExperiment,
    
    // UI
    renderDialogs,
  };
};

useExperimentZarrManager.propTypes = {
  microscopeControlService: PropTypes.object,
  isSimulatedMicroscope: PropTypes.bool,
  showNotification: PropTypes.func,
  appendLog: PropTypes.func,
  onExperimentChange: PropTypes.func,
  onExperimentReset: PropTypes.func,
};

export default useExperimentZarrManager;
