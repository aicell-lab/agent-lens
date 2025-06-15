import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for createPortal
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

// Updated Tutorial Tooltip Component using a Portal
const TutorialTooltip = ({ text }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const iconRef = useRef(null);

  if (!text) return null;

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      // Position tooltip above the icon
      // Adjustments might be needed based on tooltip size and desired offset
      setPosition({
        top: rect.top - 10, // 10px above the icon, adjust as needed
        left: rect.left + rect.width / 2, // Centered horizontally with the icon
      });
    }
    setIsVisible(true);
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };

  const tooltipStyle = {
    position: 'fixed', // Use fixed position for viewport relativity
    top: `${position.top}px`,
    left: `${position.left}px`,
    transform: 'translate(-50%, -100%)', // Adjust to center tooltip above and ensure it doesn't overlap icon
    zIndex: 1070, // Ensure it's above other content
    // visibility, width, etc., will come from CSS class .tooltip-text
  };

  const TooltipContent = (
    <div className="tooltip-text" style={{...tooltipStyle, visibility: isVisible ? 'visible' : 'hidden', opacity: isVisible ? 1 : 0}}>
      {text}
    </div>
  );

  return (
    <span 
      ref={iconRef} 
      className="tooltip-icon-container" // Changed from tooltip-container to avoid CSS conflict if any
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
    >
      <span className="tooltip-icon">?</span>
      {isVisible && ReactDOM.createPortal(TooltipContent, document.body)}
    </span>
  );
};

TutorialTooltip.propTypes = {
  text: PropTypes.string.isRequired,
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
  const [doContrastAutofocus, setDoContrastAutofocus] = useState(false);
  const [doReflectionAf, setDoReflectionAf] = useState(true);
  const [wellPlateType, setWellPlateType] = useState('96');
  
  // State for visual imaging zone selection
  const [scanningZoneString, setScanningZoneString] = useState('[[0,0],[0,0]]'); // Keep this for the final JSON string
  const [selectionStartCell, setSelectionStartCell] = useState(null); // [rowIdx, colIdx]
  const [selectionEndCell, setSelectionEndCell] = useState(null); // [rowIdx, colIdx]
  const [isDragging, setIsDragging] = useState(false);
  const [nx, setNx] = useState('3'); // Default Nx for FOV grid
  const [ny, setNy] = useState('3'); // Default Ny for FOV grid

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
          const sampleName = slot.name; // Name is guaranteed to be non-empty here
          const currentLocation = slot.location; // e.g., 'incubator_slot', 'microscope1', 'robotic_arm'
          // const originalOccupied = slot.metadata?.occupied || false; // Original occupied flag

          let displayLabel;
          const isActuallyInIncubator = currentLocation === 'incubator_slot';

          if (isActuallyInIncubator) {
            displayLabel = `Slot ${slotNumber}: ${sampleName} (In Incubator)`;
          } else {
            displayLabel = `Slot ${slotNumber}: ${sampleName} (Not Available - Location: ${currentLocation || 'Unknown'})`;
          }

          return {
            value: String(slotNumber),
            label: displayLabel,
            isAvailableForTask: isActuallyInIncubator,
            // originalOccupied: originalOccupied, // Kept for reference, but not used in new disabling logic
            slotNumber: slotNumber,
            currentLocation: currentLocation,
          };
        })
        .filter(slot => slot.slotNumber !== undefined && !isNaN(slot.slotNumber))
        .sort((a, b) => a.slotNumber - b.slotNumber);

      setAvailableSlots(processedSlots);

      if (processedSlots.length > 0) {
        const firstTaskReadySlot = processedSlots.find(s => s.isAvailableForTask);
        if (firstTaskReadySlot) {
          setIncubatorSlot(firstTaskReadySlot.value);
          setSlotsError(null); // Clear error if a suitable default is found
        } else {
          setIncubatorSlot(''); // Don't pre-select a non-viable option
          if (processedSlots.some(s => !s.isAvailableForTask)) {
            setSlotsError('No samples currently in an incubator slot. Samples must be in the incubator to be selected for a new task.');
          } else { // Should imply no named slots if this branch is hit, but check allSlotInfo
            setSlotsError('No named samples found in incubator slots or all are unavailable.');
          }
        }
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
      setNx('3'); // Reset Nx for new task
      setNy('3'); // Reset Ny for new task

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
    console.log('[ImagingTasksModal] handleCreateTask started.'); // DIAGNOSTIC LOG
    if (!taskName.trim()) {
      showNotification('Task Name is required.', 'warning');
      return;
    }
    if (!incubatorSlot) { // Check if incubatorSlot is selected
        showNotification('A Sample/Slot selection is required.', 'warning');
        return;
    }
    // NEW CHECK: ensure the selected incubatorSlot is actually available.
    const selectedSlotData = availableSlots.find(s => s.value === incubatorSlot);
    if (!selectedSlotData || !selectedSlotData.isAvailableForTask) {
        showNotification('The selected sample is not available in the incubator. Please choose an available sample from an incubator slot.', 'warning');
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
          {selectedMicroscopeId === 'agent-lens/squid-control-reef' ? (
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
            <form 
              onSubmit={(e) => { 
                console.log('[ImagingTasksModal] Form onSubmit triggered. Event:', e); // DIAGNOSTIC LOG
                e.preventDefault(); 
                console.log('[ImagingTasksModal] Calling handleCreateTask...'); // DIAGNOSTIC LOG
                handleCreateTask(); 
              }}
              id="imaging-tasks-modal-form"
            >
              <fieldset className="modal-fieldset">
                <legend className="modal-legend">Task Setup</legend>
                <div className="form-group">
                  <label htmlFor="taskName" className="form-label">
                    Task Name
                    <TutorialTooltip text="Enter a descriptive name for your imaging task. This will help you identify it later." />
                  </label>
                  <input
                    id="taskName"
                    type="text"
                    className="modal-input"
                    value={taskName}
                    onChange={(e) => setTaskName(e.target.value)}
                    required
                    disabled={slotsLoading || illuminationLoading}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="incubatorSlot" className="form-label">
                    Select Sample (from Incubator)
                    <TutorialTooltip text="Choose the sample from the incubator that you want to image. Only named and available slots are shown." />
                  </label>
                  <select
                    id="incubatorSlot"
                    className="modal-input"
                    value={incubatorSlot}
                    onChange={(e) => setIncubatorSlot(e.target.value)}
                    required
                    disabled={slotsLoading || availableSlots.length === 0 || illuminationLoading}
                  >
                    <option value="" disabled>
                      {slotsLoading ? 'Loading samples...' : (availableSlots.length === 0 ? 'No named samples available' : 'Select a sample')}
                    </option>
                    {availableSlots.map(slot => (
                      <option key={slot.value} value={slot.value} disabled={!slot.isAvailableForTask}>
                        {slot.label}
                      </option>
                    ))}
                  </select>
                  {slotsError && <p className="text-xs text-red-500 mt-1">{slotsError}</p>}
                </div>
              </fieldset>

              <fieldset className="modal-fieldset">
                  <legend className="modal-legend">
                      Imaging Zone & FOV
                      <TutorialTooltip text="Define the area on the well plate to be imaged and the number of fields of view (FOVs) within each selected well."/>
                  </legend>
                  <div className="form-group">
                      <label htmlFor="wellPlateType" className="form-label">
                          Well Plate Type
                          <TutorialTooltip text="Select the type of well plate being used (e.g., 96-well). This helps in visualizing the imaging area." />
                      </label>
                      <select
                          id="wellPlateType"
                          className="modal-input"
                          value={wellPlateType}
                          onChange={(e) => setWellPlateType(e.target.value)}
                          disabled={slotsLoading || illuminationLoading}
                      >
                          <option value="96">96 Well Plate</option>
                          {/* Add other plate types if needed */}
                      </select>
                  </div>

                  <p className="text-sm mb-2 form-label">
                      Select imaging area by clicking and dragging on the grid below.
                      <TutorialTooltip text="Click and drag on the grid to select the wells for imaging. The selected area will be highlighted." />
                  </p>
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
                   <p className="text-xs mt-1">
                      Selected Zone: {selectionStartCell && selectionEndCell ? `${ROW_LABELS[selectionStartCell[0]]}${COL_LABELS[selectionStartCell[1]]} to ${ROW_LABELS[selectionEndCell[0]]}${COL_LABELS[selectionEndCell[1]]}` : 'None'}
                  </p>

                  <div className="form-grid mt-3">
                      <div className="form-group">
                          <label htmlFor="nx" className="form-label">
                              Nx (FOVs per well)
                              <TutorialTooltip text="Number of Fields of View (FOVs) to capture along the X-axis within each selected well. E.g., 3 for a 3xM grid. Current default dx is ~0.9mm with ~10% overlap." />
                          </label>
                          <input
                              id="nx"
                              type="number"
                              className="modal-input"
                              value={nx}
                              onChange={(e) => setNx(e.target.value)}
                              min="1"
                              required
                              disabled={slotsLoading || illuminationLoading}
                          />
                      </div>
                      <div className="form-group">
                          <label htmlFor="ny" className="form-label">
                              Ny (FOVs per well)
                              <TutorialTooltip text="Number of Fields of View (FOVs) to capture along the Y-axis within each selected well. E.g., M for an Mx3 grid. Current default dy is ~0.9mm with ~10% overlap." />
                          </label>
                          <input
                              id="ny"
                              type="number"
                              className="modal-input"
                              value={ny}
                              onChange={(e) => setNy(e.target.value)}
                              min="1"
                              required
                              disabled={slotsLoading || illuminationLoading}
                          />
                      </div>
                  </div>
                   <p className="text-xs mt-1 form-label">
                      FOV dx, dy is default 0.9mm, with ~10% overlap.
                      <TutorialTooltip text="The distance (dx, dy) between adjacent Fields of View (FOVs) is automatically set to 0.9mm. This typically provides about 10% overlap between FOVs, ensuring complete coverage of the target area within the well." />
                  </p>
              </fieldset>
              
              <fieldset className="modal-fieldset">
                  <legend className="modal-legend">
                      Time Points
                      <TutorialTooltip text="Set up the schedule for time-lapse imaging. You can define a start time, end time, and interval, or manually input specific time points." />
                  </legend>
                  <div className="form-grid">
                      <div className="form-group">
                          <label htmlFor="startTime" className="form-label">
                              Start Time
                              <TutorialTooltip text="Select the date and time for the first imaging point. Use the calendar and time picker." />
                          </label>
                          <input
                              id="startTime"
                              type="datetime-local"
                              className="modal-input"
                              value={startTime}
                              min={minDateTime}
                              onChange={(e) => setStartTime(e.target.value)}
                              required
                              disabled={slotsLoading || illuminationLoading}
                          />
                      </div>
                      <div className="form-group">
                          <label htmlFor="endTime" className="form-label">
                              End Time
                              <TutorialTooltip text="Select the date and time for the last imaging point. Use the calendar and time picker." />
                          </label>
                          <input
                              id="endTime"
                              type="datetime-local"
                              className="modal-input"
                              value={endTime}
                              min={startTime || minDateTime}
                              onChange={(e) => setEndTime(e.target.value)}
                              required
                              disabled={slotsLoading || illuminationLoading}
                          />
                      </div>
                      <div className="form-group">
                          <label htmlFor="intervalMinutes" className="form-label">
                              Interval (minutes)
                              <TutorialTooltip text="Set the time interval in minutes between consecutive imaging points. E.g., 30 for imaging every 30 minutes." />
                          </label>
                          <input
                              id="intervalMinutes"
                              type="number"
                              className="modal-input"
                              value={intervalMinutes}
                              onChange={(e) => setIntervalMinutes(e.target.value)}
                              min="1"
                              disabled={slotsLoading || illuminationLoading || !startTime}
                          />
                      </div>
                  </div>
                  <button 
                      type="button" 
                      onClick={generateTimePoints} 
                      className="action-button secondary"
                      style={{fontSize: '0.8rem', padding: '0.4rem 0.8rem', marginTop: '0.5rem', marginBottom: '0.5rem'}}
                      disabled={slotsLoading || illuminationLoading || !startTime }
                  >
                      Generate Time Points
                      <TutorialTooltip text="Click to automatically generate a list of time points based on the Start Time, End Time, and Interval. These will appear in the text area below." />
                  </button>
                  <div className="form-group mt-2">
                      <label htmlFor="pendingTimePoints" className="form-label">
                          Scheduled Time Points (ISO Format)
                          <TutorialTooltip text="Review or manually edit the list of scheduled time points. Each time point should be on a new line in ISO 8601 format (e.g., 2024-07-15T10:00:00). You can paste a list here too." />
                      </label>
                      <textarea
                          id="pendingTimePoints"
                          className="modal-input text-xs"
                          rows="4"
                          value={pendingTimePoints}
                          onChange={(e) => setPendingTimePoints(e.target.value)}
                          placeholder="Example: 2024-07-15T10:00:00\n2024-07-15T10:30:00"
                          disabled={slotsLoading || illuminationLoading}
                          required // Make sure this is required for task creation
                      />
                  </div>
              </fieldset>

              {/* Placeholder for Autofocus and Illumination settings, to be added next */}
              <fieldset className="modal-fieldset">
                <legend className="modal-legend">
                  Autofocus Settings
                  <TutorialTooltip text="Configure autofocus options for the imaging task. Reflection AF is generally recommended." />
                </legend>
                <div className="form-group">
                  <label className="flex items-center form-label">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                      checked={doReflectionAf}
                      onChange={(e) => setDoReflectionAf(e.target.checked)}
                      disabled={slotsLoading || illuminationLoading}
                    />
                    <span>
                      Enable Reflection Autofocus (Recommended)
                      <TutorialTooltip text="Uses a reflected light pattern to find the optimal focus. This is generally faster and more reliable for most samples." />
                    </span>
                  </label>
                </div>
                <div className="form-group">
                  <label className="flex items-center form-label">
                    <input
                      type="checkbox"
                      className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                      checked={doContrastAutofocus}
                      onChange={(e) => setDoContrastAutofocus(e.target.checked)}
                      disabled={slotsLoading || illuminationLoading}
                    />
                    <span>
                      Enable Contrast Autofocus (Slower, use if Reflection AF fails)
                      <TutorialTooltip text="Analyzes image contrast to find the best focus. This can be slower and is typically used as a fallback or for specific sample types where Reflection AF might struggle." />
                    </span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="modal-fieldset">
                  <legend className="modal-legend">
                      Illumination Settings
                      <TutorialTooltip text="Configure intensity and exposure time for each available illumination channel. Settings are fetched from the microscope if connected, otherwise defaults are used." />
                  </legend>
                  {illuminationLoading && <p className="text-sm text-gray-600">Loading current illumination settings from microscope...</p>}
                  {!illuminationLoading && illuminationSettings.map((setting, index) => (
                      <div key={index} className="illumination-setting-row mb-2">
                          <div className="illumination-channel-label-container">
                              <input
                                  type="checkbox"
                                  className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500 mr-2"
                                  checked={setting.enabled}
                                  onChange={(e) => handleIlluminationSettingChange(index, 'enabled', e.target.checked)}
                                  disabled={slotsLoading || illuminationLoading}
                              />
                              <span className="text-xs channel-name-text">
                                  {setting.channel}
                              </span>
                              <TutorialTooltip text={`Enable this channel for imaging. Current settings: Intensity: ${setting.intensity}%, Exposure: ${setting.exposure_time}ms.`} />
                          </div>
                          <div className="illumination-inputs-container">
                              <div className="form-group mb-0 illumination-input-group">
                                  <label htmlFor={`intensity-${index}`} className="text-xs mb-0 sr-only form-label">Intensity (%)</label>
                                  <input
                                      id={`intensity-${index}`}
                                      type="number"
                                      className="modal-input text-xs illumination-input"
                                      value={setting.intensity}
                                      onChange={(e) => handleIlluminationSettingChange(index, 'intensity', parseFloat(e.target.value))}
                                      min="0" max="100" step="0.1"
                                      disabled={!setting.enabled || slotsLoading || illuminationLoading}
                                      title="Intensity (%)"
                                  />
                              </div>
                              <div className="form-group mb-0 illumination-input-group">
                                  <label htmlFor={`exposure-${index}`} className="text-xs mb-0 sr-only form-label">Exposure (ms)</label>
                                  <input
                                      id={`exposure-${index}`}
                                      type="number"
                                      className="modal-input text-xs illumination-input"
                                      value={setting.exposure_time}
                                      onChange={(e) => handleIlluminationSettingChange(index, 'exposure_time', parseFloat(e.target.value))}
                                      min="1" step="0.1"
                                      disabled={!setting.enabled || slotsLoading || illuminationLoading}
                                      title="Exposure Time (ms)"
                                  />
                              </div>
                          </div>
                      </div>
                  ))}
              </fieldset>
              
              {/* Add other form fields here, e.g., for advanced settings */}

            </form>
          )}
        </div>
        {selectedMicroscopeId !== 'agent-lens/squid-control-reef' && (
          <div className="imaging-tasks-modal-footer">
            {!task && (
              <button 
                type="submit" 
                form="imaging-tasks-modal-form"
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