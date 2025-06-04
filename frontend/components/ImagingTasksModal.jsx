import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import './ImagingTasksModal.css'; // We will create this CSS file

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const COL_LABELS = Array.from({ length: 12 }, (_, i) => i + 1);

const DEFAULT_ILLUMINATION_SETTINGS = [
  { channel: 'BF LED matrix full', intensity: 28.0, exposure_time: 20.0, enabled: true },
  { channel: 'Fluorescence 405 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false },
  { channel: 'Fluorescence 488 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: true },
  { channel: 'Fluorescence 561nm Ex', intensity: 98.0, exposure_time: 100.0, enabled: true },
  { channel: 'Fluorescence 638nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false },
  { channel: 'Fluorescence 730nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false }
];

// Channel mapping from channel names to microscope channel IDs
const CHANNEL_MAPPING = {
  'BF LED matrix full': '0',
  'Fluorescence 405 nm Ex': '11', 
  'Fluorescence 488 nm Ex': '12',
  'Fluorescence 561nm Ex': '14',
  'Fluorescence 638nm Ex': '13',
  'Fluorescence 730nm Ex': '15'
};

const ImagingTasksModal = ({
  isOpen,
  onClose,
  task, // This will be null when creating a new task
  orchestratorManagerService,
  appendLog,
  showNotification,
  selectedMicroscopeId,
  onTaskChange, // Callback to refresh tasks in parent
  incubatorControlService, // New prop
  microscopeControlService, // New prop
}) => {
  // State for new task form fields
  const [taskName, setTaskName] = useState('');
  const [incubatorSlot, setIncubatorSlot] = useState(''); // Default to empty, will be populated
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(null);

  const [illuminationSettings, setIlluminationSettings] = useState(DEFAULT_ILLUMINATION_SETTINGS);
  const [illuminationLoading, setIlluminationLoading] = useState(false);
  const [nx, setNx] = useState('3');
  const [ny, setNy] = useState('3');
  const [doContrastAutofocus, setDoContrastAutofocus] = useState(false);
  const [doReflectionAf, setDoReflectionAf] = useState(true);
  const [wellPlateType, setWellPlateType] = useState('96');
  
  // State for visual imaging zone selection
  const [scanningZoneString, setScanningZoneString] = useState('[[0,0],[0,0]]'); // Keep this for the final JSON string
  const [selectionStartCell, setSelectionStartCell] = useState(null); // [rowIdx, colIdx]
  const [selectionEndCell, setSelectionEndCell] = useState(null); // [rowIdx, colIdx]
  const [isDragging, setIsDragging] = useState(false);

  // State for time point generation
  const [minDateTime, setMinDateTime] = useState('');
  const [startTime, setStartTime] = useState(''); // ISO string e.g., 2024-07-01T10:00:00
  const [endTime, setEndTime] = useState('');   // ISO string e.g., 2024-07-01T12:00:00
  const [intervalMinutes, setIntervalMinutes] = useState('30'); // In minutes
  const [pendingTimePoints, setPendingTimePoints] = useState(''); // Text area for ISO strings

  const fetchCurrentIlluminationSettings = useCallback(async () => {
    if (!microscopeControlService) {
      appendLog('Microscope service not available, using default illumination settings.');
      return DEFAULT_ILLUMINATION_SETTINGS;
    }

    setIlluminationLoading(true);
    try {
      appendLog('Fetching current illumination settings from microscope...');
      const status = await microscopeControlService.get_status();
      
      const updatedSettings = DEFAULT_ILLUMINATION_SETTINGS.map(setting => {
        const channelId = CHANNEL_MAPPING[setting.channel];
        let intensityExposurePair;
        
        switch (channelId) {
          case '0': intensityExposurePair = status.BF_intensity_exposure; break;
          case '11': intensityExposurePair = status.F405_intensity_exposure; break;
          case '12': intensityExposurePair = status.F488_intensity_exposure; break;
          case '14': intensityExposurePair = status.F561_intensity_exposure; break;
          case '13': intensityExposurePair = status.F638_intensity_exposure; break;
          case '15': intensityExposurePair = status.F730_intensity_exposure; break;
          default:
            console.warn(`[ImagingTasksModal] Unknown channel mapping: ${setting.channel} -> ${channelId}`);
            intensityExposurePair = [setting.intensity, setting.exposure_time];
        }

        if (intensityExposurePair && intensityExposurePair.length === 2) {
          return {
            ...setting,
            intensity: intensityExposurePair[0],
            exposure_time: intensityExposurePair[1]
          };
        } else {
          console.warn(`[ImagingTasksModal] Could not parse intensity/exposure for ${setting.channel}, using defaults`);
          return setting;
        }
      });

      appendLog(`Successfully fetched illumination settings from microscope.`);
      return updatedSettings;
    } catch (error) {
      appendLog(`Error fetching illumination settings: ${error.message}. Using defaults.`);
      console.error('[ImagingTasksModal] Error fetching illumination settings:', error);
      return DEFAULT_ILLUMINATION_SETTINGS;
    } finally {
      setIlluminationLoading(false);
    }
  }, [microscopeControlService, appendLog]);

  const fetchIncubatorSlots = useCallback(async () => {
    if (!incubatorControlService) {
      setSlotsError('Incubator control service not available.');
      setAvailableSlots([]);
      return;
    }
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      appendLog('Fetching incubator slot information...');
      const allSlotInfo = await incubatorControlService.get_slot_information();
      appendLog(`Received slot information for ${allSlotInfo.length} slots.`);
      
      const processedSlots = allSlotInfo
        .filter(slot => slot.name && slot.name.trim() !== '') // Only include slots with a non-empty name
        .map(slot => {
          const slotNumber = slot.incubator_slot;
          const isOccupied = slot.metadata?.occupied || false;
          const sampleName = slot.name; // Name is guaranteed to be non-empty here

          return {
            value: String(slotNumber),
            label: `Slot ${slotNumber}: ${sampleName} (${isOccupied ? 'Occupied' : 'Free'})`,
            occupied: isOccupied,
            slotNumber: slotNumber,
          };
        })
        .filter(slot => slot.slotNumber !== undefined && !isNaN(slot.slotNumber))
        .sort((a, b) => a.slotNumber - b.slotNumber);

      setAvailableSlots(processedSlots);
      if (processedSlots.length > 0) {
        const firstFreeSlot = processedSlots.find(s => !s.occupied);
        setIncubatorSlot(firstFreeSlot ? firstFreeSlot.value : processedSlots[0].value);
      } else {
        setIncubatorSlot('');
        setSlotsError('No named samples found in incubator slots or service issue.');
      }
      appendLog(`Processed ${processedSlots.length} named slots for selection dropdown.`);
    } catch (error) {
      appendLog(`Error fetching incubator slots: ${error.message}`);
      showNotification(`Error fetching incubator slots: ${error.message}`, 'error');
      setSlotsError(`Failed to fetch slots: ${error.message}`);
      setAvailableSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [incubatorControlService, appendLog, showNotification]);

  useEffect(() => {
    if (isOpen && !task) { // Reset form and fetch slots when opening for a new task
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const localISOTime = new Date(now.getTime() - offset).toISOString().slice(0, 16);
      setMinDateTime(localISOTime);
      setStartTime(localISOTime);
      setEndTime('');
      setTaskName('');
      setNx('3');
      setNy('3');
      setDoContrastAutofocus(false);
      setDoReflectionAf(true);
      setWellPlateType('96');
      setIntervalMinutes('30');
      setPendingTimePoints('');
      
      // Reset imaging zone selection
      setSelectionStartCell([0,0]); // Default to A1
      setSelectionEndCell([0,0]); // Default to A1
      setScanningZoneString('[[0,0],[0,0]]');
      setIsDragging(false);

      // Fetch current illumination settings from microscope
      const loadIlluminationSettings = async () => {
        const currentSettings = await fetchCurrentIlluminationSettings();
        setIlluminationSettings(currentSettings);
      };
      loadIlluminationSettings();

      if (incubatorControlService) {
        fetchIncubatorSlots();
      } else {
        setAvailableSlots([]);
        setIncubatorSlot('');
        // setSlotsError('Incubator service not available on open.'); // Optional: inform user
      }
    } else if (isOpen && task) {
      const now = new Date();
      const offset = now.getTimezoneOffset() * 60000;
      const localISOTime = new Date(now.getTime() - offset).toISOString().slice(0, 16);
      setMinDateTime(localISOTime);
      // If viewing an existing task, you might want to display its imaging zone visually too.
      // For now, the grid is primarily for new task creation.
      // And also fetch/set incubator slot if needed for display.
    }
  }, [isOpen, task, incubatorControlService, fetchIncubatorSlots, fetchCurrentIlluminationSettings]);

  // Update imagingZoneString whenever selection changes and dragging stops
  useEffect(() => {
    if (!isDragging && selectionStartCell && selectionEndCell) {
      const r1 = Math.min(selectionStartCell[0], selectionEndCell[0]);
      const c1 = Math.min(selectionStartCell[1], selectionEndCell[1]);
      const r2 = Math.max(selectionStartCell[0], selectionEndCell[0]);
      const c2 = Math.max(selectionStartCell[1], selectionEndCell[1]);
      setScanningZoneString(JSON.stringify([[r1, c1], [r2, c2]]));
    }
  }, [selectionStartCell, selectionEndCell, isDragging]);

  if (!isOpen) {
    return null;
  }

  const handleCellMouseDown = (rowIndex, colIndex) => {
    setSelectionStartCell([rowIndex, colIndex]);
    setSelectionEndCell([rowIndex, colIndex]);
    setIsDragging(true);
  };

  const handleCellMouseEnter = (rowIndex, colIndex) => {
    if (isDragging) {
      setSelectionEndCell([rowIndex, colIndex]);
    }
  };

  const handleMouseUpWindow = useCallback(() => {
    if(isDragging) {
        setIsDragging(false);
        // imagingZoneString is updated by the useEffect dependent on isDragging
    }
  }, [isDragging]);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUpWindow);
    return () => {
      window.removeEventListener('mouseup', handleMouseUpWindow);
    };
  }, [handleMouseUpWindow]);

  const getSelectedCells = () => {
    if (!selectionStartCell || !selectionEndCell) return {};
    const r1 = Math.min(selectionStartCell[0], selectionEndCell[0]);
    const c1 = Math.min(selectionStartCell[1], selectionEndCell[1]);
    const r2 = Math.max(selectionStartCell[0], selectionEndCell[0]);
    const c2 = Math.max(selectionStartCell[1], selectionEndCell[1]);
    const selected = {};
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        selected[`${r}-${c}`] = true;
      }
    }
    return selected;
  };
  const currentSelectedCells = getSelectedCells();

  const handleIlluminationSettingChange = (index, field, value) => {
    setIlluminationSettings(prev => {
      const newSettings = [...prev];
      newSettings[index] = { ...newSettings[index], [field]: value };
      return newSettings;
    });
  };

  const generateTimePoints = () => {
    if (!startTime || !endTime || !intervalMinutes) {
      showNotification('Please fill in Start Time, End Time, and Interval for time points.', 'warning');
      return;
    }
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);
      const intervalMs = parseInt(intervalMinutes, 10) * 60 * 1000;

      if (isNaN(start.getTime()) || isNaN(end.getTime()) || isNaN(intervalMs) || intervalMs <= 0) {
        showNotification('Invalid date/time or interval values.', 'error');
        return;
      }
      if (start >= end) {
        showNotification('Start time must be before end time.', 'warning');
        return;
      }

      const points = [];
      let current = start;
      while (current <= end) {
        // Format to local ISO string without timezone (YYYY-MM-DDTHH:mm:ss)
        const year = current.getFullYear();
        const month = (current.getMonth() + 1).toString().padStart(2, '0');
        const day = current.getDate().toString().padStart(2, '0');
        const hours = current.getHours().toString().padStart(2, '0');
        const minutes = current.getMinutes().toString().padStart(2, '0');
        const seconds = current.getSeconds().toString().padStart(2, '0');
        points.push(`${year}-${month}-${day}T${hours}:${minutes}:${seconds}`);
        current = new Date(current.getTime() + intervalMs);
      }
      setPendingTimePoints(points.join('\n'));
      showNotification(`Generated ${points.length} time points.`, 'success');
    } catch (e) {
      showNotification(`Error generating time points: ${e.message}`, 'error');
      console.error("Error generating time points:", e);
    }
  };

  const handleCreateTask = async () => {
    if (!taskName.trim()) {
      showNotification('Task Name is required.', 'warning');
      return;
    }
    if (!incubatorSlot) { // Check if incubatorSlot is selected
        showNotification('A Sample/Slot selection is required.', 'warning');
        return;
    }
    if (!nx.trim()){
        showNotification('Nx is required.', 'warning');
        return;
    }
    if (!ny.trim()){
        showNotification('Ny is required.', 'warning');
        return;
    }
    
    const enabledIlluminationSettings = illuminationSettings.filter(setting => setting.enabled);
    if (enabledIlluminationSettings.length === 0) { 
      showNotification('At least one Illumination Channel must be enabled.', 'warning'); 
      return; 
    }
    
    if (!scanningZoneString.trim()) { showNotification('Scanning Zone is required.', 'warning'); return; }
    
    const timePointsArray = pendingTimePoints.split('\n').map(tp => tp.trim()).filter(tp => tp);
    if (timePointsArray.length === 0) { showNotification('At least one Pending Time Point is required.', 'warning'); return; }

    let parsedScanningZone;
    try {
      parsedScanningZone = JSON.parse(scanningZoneString);
      if (!Array.isArray(parsedScanningZone) || parsedScanningZone.length !== 2 || 
          !Array.isArray(parsedScanningZone[0]) || parsedScanningZone[0].length !== 2 ||
          !Array.isArray(parsedScanningZone[1]) || parsedScanningZone[1].length !== 2 ||
          !parsedScanningZone.every(p => p.every(coord => typeof coord === 'number'))){
        throw new Error('Scanning zone must be an array of two [row,col] index pairs.');
      }
    } catch (e) {
      showNotification(`Invalid Scanning Zone format: ${e.message}`, 'error'); return;
    }

    // Format illumination settings for the new API
    const formattedIlluminationSettings = enabledIlluminationSettings.map(setting => ({
      channel: setting.channel,
      intensity: parseFloat(setting.intensity),
      exposure_time: parseFloat(setting.exposure_time)
    }));

    const taskDefinition = {
      name: taskName.trim(),
      settings: {
        incubator_slot: parseInt(incubatorSlot, 10),
        allocated_microscope: selectedMicroscopeId.includes('microscope-control-squid')
          ? `microscope-control-squid-${selectedMicroscopeId.endsWith('1') ? '1' : '2'}`
          : null,
        pending_time_points: timePointsArray,
        imaged_time_points: [],
        well_plate_type: wellPlateType,
        illumination_settings: formattedIlluminationSettings,
        do_contrast_autofocus: doContrastAutofocus,
        do_reflection_af: doReflectionAf,
        imaging_zone: parsedScanningZone,
        Nx: parseInt(nx, 10),
        Ny: parseInt(ny, 10),
        action_ID: taskName.trim(),
      },
    };

    appendLog(`Creating new task: ${JSON.stringify(taskDefinition, null, 2)}`);
    try {
      const result = await orchestratorManagerService.add_imaging_task(taskDefinition);
      if (result && result.success) {
        showNotification(`Task '${taskDefinition.name}' created successfully.`, 'success');
        appendLog(`Task '${taskDefinition.name}' created: ${result.message}`);
        onClose(); // Close modal after action
        if(onTaskChange) onTaskChange(); // Refresh tasks in parent
      } else {
        showNotification(`Failed to create task: ${result ? result.message : 'Unknown error'}`, 'error');
        appendLog(`Failed to create task '${taskDefinition.name}': ${result ? result.message : 'Unknown error'}`);
      }
    } catch (error) {
      showNotification(`Error creating task: ${error.message}`, 'error');
      appendLog(`Error creating task '${taskDefinition.name}': ${error.message}`);
      console.error("Error creating task:", error);
    }
  };

  const handleDeleteTask = async () => {
    if (task && task.name) {
      appendLog(`Attempting to delete task '${task.name}'...`);
      try {
        const result = await orchestratorManagerService.delete_imaging_task(task.name);
        if (result && result.success) {
          showNotification(`Task '${task.name}' deleted successfully.`, 'success');
          appendLog(`Task '${task.name}' deleted: ${result.message}`);
          onClose();
          if(onTaskChange) onTaskChange(); // Refresh tasks in parent
        } else {
          showNotification(`Failed to delete task '${task.name}': ${result ? result.message : 'Unknown error'}`, 'error');
          appendLog(`Failed to delete task '${task.name}': ${result ? result.message : 'Unknown error'}`);
        }
      } catch (error) {
        showNotification(`Error deleting task '${task.name}': ${error.message}`, 'error');
        appendLog(`Error deleting task '${task.name}': ${error.message}`);
        console.error("Error deleting task:", error);
      }
    } else {
      showNotification('No task selected for deletion or task name is missing.', 'warning');
    }
  };

  return (
    <div className="imaging-tasks-modal-overlay">
      <div className="imaging-tasks-modal-content">
        <div className="imaging-tasks-modal-header">
          <h3 className="text-lg font-semibold">{task ? `Task: ${task.name}` : 'Create New Imaging Task'}</h3>
          <button onClick={onClose} className="modal-close-button">
            <i className="fas fa-times"></i>
          </button>
        </div>
        <div className="imaging-tasks-modal-body">
          {selectedMicroscopeId === 'squid-control/squid-control-reef' ? (
            <p>Time-lapse imaging is not supported for the simulated microscope.</p>
          ) : task ? (
            // Display existing task details (read-only view)
            <div className="task-details mb-4 text-xs">
              <p><strong>Status:</strong> {task.operational_state?.status || 'N/A'}</p>
              <p><strong>Allocated Microscope:</strong> {task.settings?.allocated_microscope || 'N/A'}</p>
              <p><strong>Incubator Slot:</strong> {task.settings?.incubator_slot || 'N/A'}</p>
              <p><strong>Well Plate Type:</strong> {task.settings?.well_plate_type || 'N/A'}</p>
              <p><strong>Action ID:</strong> {task.settings?.action_ID || 'N/A'}</p>
              <p><strong>Imaging Started:</strong> {task.settings?.imaging_started ? 'Yes' : 'No'}</p>
              <p><strong>Imaging Completed:</strong> {task.settings?.imaging_completed ? 'Yes' : 'No'}</p>
              <p><strong>Illumination Settings:</strong> {task.settings?.illumination_settings ? JSON.stringify(task.settings.illumination_settings) : 'N/A'}</p>
              <p><strong>Nx, Ny:</strong> {task.settings?.Nx}, {task.settings?.Ny}</p>
              <p><strong>Imaging Zone:</strong> {JSON.stringify(task.settings?.imaging_zone || task.settings?.scanning_zone)}</p>
              <p><strong>Contrast AF:</strong> {task.settings?.do_contrast_autofocus ? 'Yes' : 'No'}</p>
              <p><strong>Reflection AF:</strong> {task.settings?.do_reflection_af ? 'Yes' : 'No'}</p>
              <p><strong>Pending Time Points:</strong> {task.settings?.pending_time_points?.length || 0}</p>
              <ul className="list-disc pl-5 max-h-20 overflow-y-auto">
                {task.settings?.pending_time_points?.map(tp => <li key={tp}>{tp}</li>)}
              </ul>
              <p><strong>Imaged Time Points:</strong> {task.settings?.imaged_time_points?.length || 0}</p>
              <ul className="list-disc pl-5 max-h-20 overflow-y-auto">
                {task.settings?.imaged_time_points?.map(tp => <li key={tp}>{tp}</li>)}
              </ul>
            </div>
          ) : (
            // Form for creating a new task
            <div className="new-task-form text-sm">
              <p className="text-xs text-gray-600 mb-3 italic">
                Configure a new time-lapse imaging task using the updated scan_well_plate API.
              </p>
              <div className="form-group mb-3">
                <label htmlFor="taskName" className="block font-medium mb-1">Task Name:<span className="text-red-500">*</span></label>
                <input type="text" id="taskName" value={taskName} onChange={(e) => setTaskName(e.target.value)} className="modal-input" required />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="form-group">
                  <label htmlFor="incubatorSlot" className="block font-medium mb-1">Select Sample:<span className="text-red-500">*</span></label>
                  {slotsLoading && <p className="text-xs text-gray-500">Loading slots...</p>}
                  {slotsError && <p className="text-xs text-red-500">{slotsError}</p>}
                  {!slotsLoading && !slotsError && availableSlots.length === 0 && <p className="text-xs text-gray-500">No named samples found in incubator slots or service issue.</p>}
                  {!slotsLoading && !slotsError && availableSlots.length > 0 && (
                    <select 
                      id="incubatorSlot" 
                      value={incubatorSlot} 
                      onChange={(e) => setIncubatorSlot(e.target.value)} 
                      className="modal-input" 
                      required
                    >
                      {availableSlots.map(slot => (
                        <option key={slot.value} value={slot.value} disabled={slot.occupied}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="form-group">
                  <label htmlFor="nx" className="block font-medium mb-1">Nx:<span className="text-red-500">*</span></label>
                  <input type="number" id="nx" value={nx} onChange={(e) => setNx(e.target.value)} min="1" className="modal-input" required />
                </div>
                <div className="form-group">
                  <label htmlFor="ny" className="block font-medium mb-1">Ny:<span className="text-red-500">*</span></label>
                  <input type="number" id="ny" value={ny} onChange={(e) => setNy(e.target.value)} min="1" className="modal-input" required />
                </div>
              </div>
              
              <div className="form-group mb-3">
                <label className="block font-medium mb-1">Imaging Zone:<span className="text-red-500">*</span> <span className='text-xs text-gray-500'> (Selected: {scanningZoneString})</span></label>
                <div className="well-plate-grid-container" onMouseLeave={() => { if (isDragging) setIsDragging(false); /* Stop drag if mouse leaves grid */ }}>
                  <div className="well-plate-grid">
                    <div className="grid-col-labels">{/* Empty corner */}
                        <div></div> 
                        {COL_LABELS.map(label => <div key={`col-${label}`} className="grid-label">{label}</div>)}
                    </div>
                    {ROW_LABELS.map((rowLabel, rowIndex) => (
                      <div key={`row-${rowIndex}`} className="grid-row">
                        <div className="grid-label">{rowLabel}</div>
                        {COL_LABELS.map((colLabel, colIndex) => (
                          <div 
                            key={`cell-${rowIndex}-${colIndex}`}
                            className={`grid-cell ${currentSelectedCells[`${rowIndex}-${colIndex}`] ? 'selected' : ''}`}
                            onMouseDown={() => handleCellMouseDown(rowIndex, colIndex)}
                            onMouseEnter={() => handleCellMouseEnter(rowIndex, colIndex)}
                          >
                            {/* Optional: display cell content or identifier */}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              <div className="form-group mb-3">
                <label className="block font-medium mb-1">
                  Illumination Settings:<span className="text-red-500">*</span>
                  {illuminationLoading && <span className="text-xs text-gray-500 ml-2">(Loading current settings...)</span>}
                </label>
                <div className="illumination-settings-grid">
                  {illuminationSettings.map((setting, index) => (
                    <div key={setting.channel} className="illumination-setting-row flex items-center gap-2 mb-2 p-2 border rounded">
                      <input 
                        type="checkbox" 
                        checked={setting.enabled}
                        onChange={(e) => handleIlluminationSettingChange(index, 'enabled', e.target.checked)}
                        className="form-checkbox h-4 w-4 text-blue-600"
                      />
                      <span className="text-xs font-medium w-32">{setting.channel}</span>
                      <div className="flex gap-1">
                        <label className="text-xs">Intensity:</label>
                        <input 
                          type="number" 
                          value={setting.intensity}
                          onChange={(e) => handleIlluminationSettingChange(index, 'intensity', parseFloat(e.target.value) || 0)}
                          min="0" max="100" step="0.1"
                          className="w-16 px-1 py-0.5 text-xs border rounded"
                          disabled={!setting.enabled}
                        />
                      </div>
                      <div className="flex gap-1">
                        <label className="text-xs">Exposure:</label>
                        <input 
                          type="number" 
                          value={setting.exposure_time}
                          onChange={(e) => handleIlluminationSettingChange(index, 'exposure_time', parseFloat(e.target.value) || 0)}
                          min="0" step="0.1"
                          className="w-16 px-1 py-0.5 text-xs border rounded"
                          disabled={!setting.enabled}
                        />
                        <span className="text-xs text-gray-500">ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="form-group mb-4 flex gap-4">
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    checked={doContrastAutofocus} 
                    onChange={(e) => setDoContrastAutofocus(e.target.checked)} 
                    className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span>Do Contrast Autofocus</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input 
                    type="checkbox" 
                    checked={doReflectionAf} 
                    onChange={(e) => setDoReflectionAf(e.target.checked)} 
                    className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span>Do Reflection Autofocus <span className="text-gray-500 text-xs">(recommended)</span></span>
                </label>
              </div>

              <div className="border-t pt-3 mt-3">
                <h4 className="font-medium mb-2 text-gray-700">Time Points Generation<span className="text-red-500">*</span></h4>
                 <p className="text-xs text-gray-500 mb-2 italic">Enter start time, end time (local, YYYY-MM-DDTHH:mm:ss), and interval to generate points. Or paste points directly below.</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                        <label htmlFor="startTime" className="block text-xs font-medium mb-0.5">Start Time</label>
                        <input type="datetime-local" id="startTime" value={startTime} min={minDateTime} onChange={e => setStartTime(e.target.value)} className="modal-input text-xs" />
                    </div>
                    <div>
                        <label htmlFor="endTime" className="block text-xs font-medium mb-0.5">End Time</label>
                        <input type="datetime-local" id="endTime" value={endTime} min={startTime || minDateTime} onChange={e => setEndTime(e.target.value)} className="modal-input text-xs" />
                    </div>
                    <div>
                        <label htmlFor="intervalMinutes" className="block text-xs font-medium mb-0.5">Interval (minutes)</label>
                        <input type="number" id="intervalMinutes" value={intervalMinutes} onChange={e => setIntervalMinutes(e.target.value)} min="1" className="modal-input text-xs" placeholder="30" />
                    </div>
                </div>
                <button onClick={generateTimePoints} className="action-button secondary text-xs px-3 py-1 mb-2">Generate Points</button>

                <div className="form-group">
                  <label htmlFor="pendingTimePoints" className="block font-medium mb-1">Pending Time Points (YYYY-MM-DDTHH:mm:ss, one per line):<span className="text-red-500">*</span></label>
                  <textarea 
                    id="pendingTimePoints" 
                    value={pendingTimePoints} 
                    onChange={(e) => setPendingTimePoints(e.target.value)} 
                    rows="5" 
                    className="modal-input w-full text-xs" 
                    placeholder="2024-07-01T10:00:00\n2024-07-01T10:30:00"
                    required 
                  />
                </div>
              </div>
              
            </div>
          )}
        </div>
        {selectedMicroscopeId !== 'squid-control/squid-control-reef' && (
          <div className="imaging-tasks-modal-footer">
            {!task && (
              <button 
                onClick={handleCreateTask} 
                className="action-button primary mr-2"
              >
                Create Task
              </button>
            )}
            {task && (
                <button 
                    onClick={handleDeleteTask} 
                    className="action-button danger"
                >
                    Delete Task
                </button>
            )}
            <button onClick={onClose} className="action-button secondary ml-auto">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

ImagingTasksModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  task: PropTypes.object,
  orchestratorManagerService: PropTypes.object,
  appendLog: PropTypes.func.isRequired,
  showNotification: PropTypes.func.isRequired,
  selectedMicroscopeId: PropTypes.string.isRequired,
  onTaskChange: PropTypes.func,
  incubatorControlService: PropTypes.object, // Added prop type
  microscopeControlService: PropTypes.object, // Added prop type
};

export default ImagingTasksModal; 