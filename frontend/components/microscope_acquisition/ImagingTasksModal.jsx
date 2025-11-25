import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom'; // Import ReactDOM for createPortal
import PropTypes from 'prop-types';
import { 
  useValidatedNumberInput, 
  useValidatedStringInput, 
  getInputValidationClasses, 
  validateStringInput,
  getOrchestratorMicroscopeId,
  isSimulatedMicroscope,
} from '../../utils'; // Import validation utilities
import './ImagingTasksModal.css'; // We will create this CSS file

const ROW_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const COL_LABELS = Array.from({ length: 12 }, (_, i) => i + 1);

const DEFAULT_ILLUMINATION_SETTINGS = [
  { channel: 'BF LED matrix full', intensity: 28.0, exposure_time: 20.0, enabled: true },
  { channel: 'Fluorescence 405 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false },
  { channel: 'Fluorescence 488 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: true },
  { channel: 'Fluorescence 561 nm Ex', intensity: 98.0, exposure_time: 100.0, enabled: true },
  { channel: 'Fluorescence 638 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false },
  { channel: 'Fluorescence 730 nm Ex', intensity: 27.0, exposure_time: 60.0, enabled: false }
];

// Channel mapping from channel names to microscope channel IDs
const CHANNEL_MAPPING = {
  'BF LED matrix full': '0',
  'Fluorescence 405 nm Ex': '11', 
  'Fluorescence 488 nm Ex': '12',
  'Fluorescence 561 nm Ex': '14',
  'Fluorescence 638 nm Ex': '13',
  'Fluorescence 730 nm Ex': '15'
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
  // Helper function to get default dx/dy values based on microscope type
  const getDefaultSpacing = () => {
    if (selectedMicroscopeId && selectedMicroscopeId.includes('squid-plus')) {
      return { dx: '0.7', dy: '0.7' }; // Squid plus microscopes use 0.7mm
    }
    return { dx: '0.8', dy: '0.8' }; // Default for other microscopes
  };
  // State for new task form fields
  const [taskName, setTaskName] = useState('');
  const [scanMode, setScanMode] = useState('full_automation'); // 'full_automation' or 'microscope_only'
  const [savedDataType, setSavedDataType] = useState('raw_images_well_plate'); // 'raw_images_well_plate' or 'raw_image_flexible'
  const [positions, setPositions] = useState([]); // Array of position objects for flexible positioning
  const [isCapturingPosition, setIsCapturingPosition] = useState(false);
  const [incubatorSlot, setIncubatorSlot] = useState(''); // Default to empty, will be populated
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(null);

  const [illuminationSettings, setIlluminationSettings] = useState(DEFAULT_ILLUMINATION_SETTINGS);
  const [illuminationLoading, setIlluminationLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [doContrastAutofocus, setDoContrastAutofocus] = useState(false);
  const [doReflectionAf, setDoReflectionAf] = useState(true);
  
  // State for visual well selection
  const [selectedWells, setSelectedWells] = useState([]); // Array of well IDs like ["A1", "B2", "C3"]
  const [selectionStartCell, setSelectionStartCell] = useState(null); // [rowIdx, colIdx]
  const [selectionEndCell, setSelectionEndCell] = useState(null); // [rowIdx, colIdx]
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartTime, setDragStartTime] = useState(null); // Track timing for click vs drag
  const [nx, setNx] = useState('3'); // Default Nx for FOV grid
  const [ny, setNy] = useState('3'); // Default Ny for FOV grid
  const defaultSpacing = getDefaultSpacing();
  const [dx, setDx] = useState(defaultSpacing.dx); // Default dx for FOV spacing in mm
  const [dy, setDy] = useState(defaultSpacing.dy); // Default dy for FOV spacing in mm

  // Helper functions for well selection
  const getWellIdFromIndices = (rowIdx, colIdx) => {
    return `${ROW_LABELS[rowIdx]}${COL_LABELS[colIdx]}`;
  };

  const convertRectangleToWells = (r1, c1, r2, c2) => {
    const wells = [];
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        wells.push(getWellIdFromIndices(r, c));
      }
    }
    return wells;
  };

  // State for time point generation
  const [minDateTime, setMinDateTime] = useState('');
  const [startTime, setStartTime] = useState(''); // ISO string e.g., 2024-07-01T10:00:00
  const [endTime, setEndTime] = useState('');   // ISO string e.g., 2024-07-01T12:00:00
  const [intervalMinutes, setIntervalMinutes] = useState('30'); // In minutes
  const [pendingTimePoints, setPendingTimePoints] = useState(''); // Text area for ISO strings

  // Validated input hooks for better UX and error handling
  const nxInput = useValidatedNumberInput(
    parseInt(nx) || 3,
    (value) => setNx(value.toString()),
    {
      min: 1,
      max: 20,
      allowFloat: false,
      defaultValue: 3
    },
    showNotification
  );

  const nyInput = useValidatedNumberInput(
    parseInt(ny) || 3,
    (value) => setNy(value.toString()),
    {
      min: 1,
      max: 20,
      allowFloat: false,
      defaultValue: 3
    },
    showNotification
  );

  const intervalInput = useValidatedNumberInput(
    parseInt(intervalMinutes) || 30,
    (value) => setIntervalMinutes(value.toString()),
    {
      min: 1,
      max: 1440, // Max 24 hours in minutes
      allowFloat: false,
      defaultValue: 30
    },
    showNotification
  );

  const dxInput = useValidatedNumberInput(
    parseFloat(dx) || parseFloat(defaultSpacing.dx),
    (value) => setDx(value.toString()),
    {
      min: 0.1,
      max: 5.0,
      allowFloat: true,
      defaultValue: parseFloat(defaultSpacing.dx)
    },
    showNotification
  );

  const dyInput = useValidatedNumberInput(
    parseFloat(dy) || parseFloat(defaultSpacing.dy),
    (value) => setDy(value.toString()),
    {
      min: 0.1,
      max: 5.0,
      allowFloat: true,
      defaultValue: parseFloat(defaultSpacing.dy)
    },
    showNotification
  );

  // Validated string input for task name to prevent filesystem issues
  const taskNameInput = useValidatedStringInput(
    taskName,
    (value) => setTaskName(value),
    {
      minLength: 1,
      maxLength: 50,
      allowEmpty: false,
      forbiddenChars: ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
      trim: true
    },
    showNotification
  );

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
          const wellPlateType = slot.well_plate_type || '96'; // Extract well plate type from slot info
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
            wellPlateType: wellPlateType, // Store well plate type from slot
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
      setScanMode('full_automation'); // Reset to default scan mode
      setSavedDataType('raw_images_well_plate'); // Reset to default data type
      setPositions([]); // Clear positions array
      setDoContrastAutofocus(false);
      setDoReflectionAf(true);
      setIntervalMinutes('30');
      setPendingTimePoints('');
      
      // Reset well selection
      setSelectedWells([]);
      setSelectionStartCell(null);
      setSelectionEndCell(null);
      setIsDragging(false);
      setDragStartTime(null);
      setNx('3'); // Reset Nx for new task
      setNy('3'); // Reset Ny for new task
      const resetSpacing = getDefaultSpacing();
      setDx(resetSpacing.dx); // Reset dx for new task based on microscope type
      setDy(resetSpacing.dy); // Reset dy for new task based on microscope type

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

  // Update selectedWells when drag selection completes
  useEffect(() => {
    if (!isDragging && selectionStartCell && selectionEndCell) {
      const r1 = Math.min(selectionStartCell[0], selectionEndCell[0]);
      const c1 = Math.min(selectionStartCell[1], selectionEndCell[1]);
      const r2 = Math.max(selectionStartCell[0], selectionEndCell[0]);
      const c2 = Math.max(selectionStartCell[1], selectionEndCell[1]);
      const newWells = convertRectangleToWells(r1, c1, r2, c2);
      setSelectedWells(prev => {
        // Add new wells to existing selection
        const combined = [...new Set([...prev, ...newWells])];
        return combined;
      });
    }
  }, [selectionStartCell, selectionEndCell, isDragging]);

  if (!isOpen) {
    return null;
  }

  const handleCellMouseDown = (rowIndex, colIndex) => {
    setSelectionStartCell([rowIndex, colIndex]);
    setSelectionEndCell([rowIndex, colIndex]);
    setIsDragging(true);
    setDragStartTime(Date.now());
  };

  const handleCellMouseEnter = (rowIndex, colIndex) => {
    if (isDragging) {
      setSelectionEndCell([rowIndex, colIndex]);
    }
  };

  const handleCellClick = (rowIndex, colIndex) => {
    const wellId = getWellIdFromIndices(rowIndex, colIndex);
    setSelectedWells(prev => {
      if (prev.includes(wellId)) {
        // Remove well if already selected
        return prev.filter(id => id !== wellId);
      } else {
        // Add well if not selected
        return [...prev, wellId];
      }
    });
  };

  const handleMouseUpWindow = useCallback(() => {
    if(isDragging) {
      const dragDuration = Date.now() - dragStartTime;
      const startCell = selectionStartCell;
      const endCell = selectionEndCell;
      
      // If drag was very short (< 200ms) and no movement, treat as click
      if (dragDuration < 200 && startCell && endCell && 
          startCell[0] === endCell[0] && startCell[1] === endCell[1]) {
        handleCellClick(startCell[0], startCell[1]);
      }
      
      setIsDragging(false);
      setDragStartTime(null);
    }
  }, [isDragging, dragStartTime, selectionStartCell, selectionEndCell]);

  useEffect(() => {
    window.addEventListener('mouseup', handleMouseUpWindow);
    return () => {
      window.removeEventListener('mouseup', handleMouseUpWindow);
    };
  }, [handleMouseUpWindow]);

  const getSelectedCells = () => {
    const selected = {};
    
    // Add permanently selected wells
    selectedWells.forEach(wellId => {
      // Find row/col indices for this well ID
      for (let r = 0; r < ROW_LABELS.length; r++) {
        for (let c = 0; c < COL_LABELS.length; c++) {
          if (getWellIdFromIndices(r, c) === wellId) {
            selected[`${r}-${c}`] = true;
          }
        }
      }
    });
    
    // Add drag selection preview
    if (isDragging && selectionStartCell && selectionEndCell) {
      const r1 = Math.min(selectionStartCell[0], selectionEndCell[0]);
      const c1 = Math.min(selectionStartCell[1], selectionEndCell[1]);
      const r2 = Math.max(selectionStartCell[0], selectionEndCell[0]);
      const c2 = Math.max(selectionStartCell[1], selectionEndCell[1]);
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          selected[`${r}-${c}`] = true;
        }
      }
    }
    
    return selected;
  };
  const currentSelectedCells = getSelectedCells();

  const handleIlluminationSettingChange = (index, field, value) => {
    setIlluminationSettings(prev => {
      const newSettings = [...prev];
      
      // Add validation for numeric fields
      if (field === 'intensity' || field === 'exposure_time') {
        // Only update if the value is a valid number
        if (typeof value === 'number' && !isNaN(value)) {
          // Apply constraints
          if (field === 'intensity') {
            value = Math.max(0, Math.min(100, value)); // Clamp intensity to 0-100
          } else if (field === 'exposure_time') {
            value = Math.max(1, Math.min(900, value)); // Clamp exposure to 1-900ms
          }
          newSettings[index] = { ...newSettings[index], [field]: value };
        }
        // If invalid number, don't update (keep previous value)
      } else {
        // For non-numeric fields (like enabled checkbox)
        newSettings[index] = { ...newSettings[index], [field]: value };
      }
      
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

  const handleCapturePosition = async () => {
    if (!microscopeControlService) {
      showNotification('Microscope service not available.', 'error');
      return;
    }

    setIsCapturingPosition(true);
    try {
      appendLog('Capturing current microscope position...');
      const status = await microscopeControlService.get_status();
      
      if (!status || status.current_x === undefined || status.current_y === undefined) {
        showNotification('Failed to get microscope position.', 'error');
        appendLog('Error: Could not retrieve microscope position from status.');
        return;
      }

      // Prompt for position name
      const positionName = window.prompt(
        'Enter a name for this position (optional):',
        `Position_${positions.length + 1}`
      );
      
      // User cancelled
      if (positionName === null) {
        appendLog('Position capture cancelled by user.');
        return;
      }

      // Prompt for Nx
      const nxStr = window.prompt('Enter Nx (number of FOVs in X direction):', '3');
      if (nxStr === null) return;
      const nxVal = parseInt(nxStr, 10);
      if (isNaN(nxVal) || nxVal < 1 || nxVal > 20) {
        showNotification('Invalid Nx value. Must be between 1 and 20.', 'error');
        return;
      }

      // Prompt for Ny
      const nyStr = window.prompt('Enter Ny (number of FOVs in Y direction):', '3');
      if (nyStr === null) return;
      const nyVal = parseInt(nyStr, 10);
      if (isNaN(nyVal) || nyVal < 1 || nyVal > 20) {
        showNotification('Invalid Ny value. Must be between 1 and 20.', 'error');
        return;
      }

      // Prompt for dx
      const defaultSpacingVal = getDefaultSpacing();
      const dxStr = window.prompt(`Enter dx (X spacing in mm):`, defaultSpacingVal.dx);
      if (dxStr === null) return;
      const dxVal = parseFloat(dxStr);
      if (isNaN(dxVal) || dxVal < 0.1 || dxVal > 5.0) {
        showNotification('Invalid dx value. Must be between 0.1 and 5.0 mm.', 'error');
        return;
      }

      // Prompt for dy
      const dyStr = window.prompt(`Enter dy (Y spacing in mm):`, defaultSpacingVal.dy);
      if (dyStr === null) return;
      const dyVal = parseFloat(dyStr);
      if (isNaN(dyVal) || dyVal < 0.1 || dyVal > 5.0) {
        showNotification('Invalid dy value. Must be between 0.1 and 5.0 mm.', 'error');
        return;
      }

      const newPosition = {
        x: status.current_x,
        y: status.current_y,
        z: status.current_z || 0,
        Nx: nxVal,
        Ny: nyVal,
        dx: dxVal,
        dy: dyVal,
        name: positionName.trim() || `Position_${positions.length + 1}`
      };

      setPositions(prev => [...prev, newPosition]);
      showNotification(`Position "${newPosition.name}" captured successfully.`, 'success');
      appendLog(`Captured position: ${JSON.stringify(newPosition)}`);
    } catch (error) {
      showNotification(`Error capturing position: ${error.message}`, 'error');
      appendLog(`Error capturing position: ${error.message}`);
      console.error('Error capturing position:', error);
    } finally {
      setIsCapturingPosition(false);
    }
  };

  const handleAddManualPosition = () => {
    // Prompt for position name
    const positionName = window.prompt(
      'Enter a name for this position (optional):',
      `Position_${positions.length + 1}`
    );
    
    // User cancelled
    if (positionName === null) {
      return;
    }

    // Prompt for X coordinate
    const xStr = window.prompt('Enter X coordinate (mm):', '0');
    if (xStr === null) return;
    const xVal = parseFloat(xStr);
    if (isNaN(xVal)) {
      showNotification('Invalid X coordinate. Must be a number.', 'error');
      return;
    }

    // Prompt for Y coordinate
    const yStr = window.prompt('Enter Y coordinate (mm):', '0');
    if (yStr === null) return;
    const yVal = parseFloat(yStr);
    if (isNaN(yVal)) {
      showNotification('Invalid Y coordinate. Must be a number.', 'error');
      return;
    }

    // Prompt for Z coordinate
    const zStr = window.prompt('Enter Z coordinate (mm, optional):', '0');
    if (zStr === null) return;
    const zVal = parseFloat(zStr);
    if (isNaN(zVal)) {
      showNotification('Invalid Z coordinate. Must be a number.', 'error');
      return;
    }

    // Prompt for Nx
    const nxStr = window.prompt('Enter Nx (number of FOVs in X direction):', '3');
    if (nxStr === null) return;
    const nxVal = parseInt(nxStr, 10);
    if (isNaN(nxVal) || nxVal < 1 || nxVal > 20) {
      showNotification('Invalid Nx value. Must be between 1 and 20.', 'error');
      return;
    }

    // Prompt for Ny
    const nyStr = window.prompt('Enter Ny (number of FOVs in Y direction):', '3');
    if (nyStr === null) return;
    const nyVal = parseInt(nyStr, 10);
    if (isNaN(nyVal) || nyVal < 1 || nyVal > 20) {
      showNotification('Invalid Ny value. Must be between 1 and 20.', 'error');
      return;
    }

    // Prompt for dx
    const defaultSpacingVal = getDefaultSpacing();
    const dxStr = window.prompt(`Enter dx (X spacing in mm):`, defaultSpacingVal.dx);
    if (dxStr === null) return;
    const dxVal = parseFloat(dxStr);
    if (isNaN(dxVal) || dxVal < 0.1 || dxVal > 5.0) {
      showNotification('Invalid dx value. Must be between 0.1 and 5.0 mm.', 'error');
      return;
    }

    // Prompt for dy
    const dyStr = window.prompt(`Enter dy (Y spacing in mm):`, defaultSpacingVal.dy);
    if (dyStr === null) return;
    const dyVal = parseFloat(dyStr);
    if (isNaN(dyVal) || dyVal < 0.1 || dyVal > 5.0) {
      showNotification('Invalid dy value. Must be between 0.1 and 5.0 mm.', 'error');
      return;
    }

    const newPosition = {
      x: xVal,
      y: yVal,
      z: zVal,
      Nx: nxVal,
      Ny: nyVal,
      dx: dxVal,
      dy: dyVal,
      name: positionName.trim() || `Position_${positions.length + 1}`
    };

    setPositions(prev => [...prev, newPosition]);
    showNotification(`Position "${newPosition.name}" added successfully.`, 'success');
    appendLog(`Added manual position: ${JSON.stringify(newPosition)}`);
  };

  const handleDeletePosition = (index) => {
    const positionName = positions[index].name;
    if (window.confirm(`Delete position "${positionName}"?`)) {
      setPositions(prev => prev.filter((_, i) => i !== index));
      showNotification(`Position "${positionName}" deleted.`, 'success');
      appendLog(`Deleted position: ${positionName}`);
    }
  };

  const handleEditPosition = (index) => {
    const position = positions[index];
    
    // Prompt for new values with current values as defaults
    const nxStr = window.prompt('Enter Nx (number of FOVs in X direction):', position.Nx.toString());
    if (nxStr === null) return;
    const nxVal = parseInt(nxStr, 10);
    if (isNaN(nxVal) || nxVal < 1 || nxVal > 20) {
      showNotification('Invalid Nx value. Must be between 1 and 20.', 'error');
      return;
    }

    const nyStr = window.prompt('Enter Ny (number of FOVs in Y direction):', position.Ny.toString());
    if (nyStr === null) return;
    const nyVal = parseInt(nyStr, 10);
    if (isNaN(nyVal) || nyVal < 1 || nyVal > 20) {
      showNotification('Invalid Ny value. Must be between 1 and 20.', 'error');
      return;
    }

    const dxStr = window.prompt('Enter dx (X spacing in mm):', position.dx.toString());
    if (dxStr === null) return;
    const dxVal = parseFloat(dxStr);
    if (isNaN(dxVal) || dxVal < 0.1 || dxVal > 5.0) {
      showNotification('Invalid dx value. Must be between 0.1 and 5.0 mm.', 'error');
      return;
    }

    const dyStr = window.prompt('Enter dy (Y spacing in mm):', position.dy.toString());
    if (dyStr === null) return;
    const dyVal = parseFloat(dyStr);
    if (isNaN(dyVal) || dyVal < 0.1 || dyVal > 5.0) {
      showNotification('Invalid dy value. Must be between 0.1 and 5.0 mm.', 'error');
      return;
    }

    const updatedPosition = {
      ...position,
      Nx: nxVal,
      Ny: nyVal,
      dx: dxVal,
      dy: dyVal
    };

    setPositions(prev => prev.map((p, i) => i === index ? updatedPosition : p));
    showNotification(`Position "${position.name}" updated.`, 'success');
    appendLog(`Updated position: ${JSON.stringify(updatedPosition)}`);
  };

  const handleCreateTask = async () => {
    console.log('[ImagingTasksModal] handleCreateTask started.'); // DIAGNOSTIC LOG
    
    // Validate task name using the validated input
    if (!taskNameInput.validateAndUpdate()) {
      showNotification('Please fix the task name validation errors before creating the task.', 'warning');
      return;
    }
    
    if (!taskName.trim()) {
      showNotification('Task Name is required.', 'warning');
      return;
    }

    // Validation based on scan mode
    if (scanMode === 'full_automation') {
      // Full automation mode requires incubator slot
      if (!incubatorSlot) {
        showNotification('A Sample/Slot selection is required for Full Automation mode.', 'warning');
        return;
      }
      // Ensure the selected incubatorSlot is actually available
      const selectedSlotData = availableSlots.find(s => s.value === incubatorSlot);
      if (!selectedSlotData || !selectedSlotData.isAvailableForTask) {
        showNotification('The selected sample is not available in the incubator. Please choose an available sample from an incubator slot.', 'warning');
        return;
      }
    }
    
    // Validation based on scan type (applies to both modes)
    if (savedDataType === 'raw_images_well_plate') {
      // Well plate scan validation
      if (selectedWells.length === 0) {
        showNotification('At least one well must be selected for Well Plate Scan.', 'warning');
        return;
      }
      if (!nx.trim()) {
        showNotification('Nx is required.', 'warning');
        return;
      }
      if (!ny.trim()) {
        showNotification('Ny is required.', 'warning');
        return;
      }
      if (!dx.trim()) {
        showNotification('dx is required.', 'warning');
        return;
      }
      if (!dy.trim()) {
        showNotification('dy is required.', 'warning');
        return;
      }
    } else if (savedDataType === 'raw_image_flexible') {
      // Flexible positions validation
      if (positions.length === 0) {
        showNotification('At least one position must be captured for Flexible Positions scan.', 'warning');
        return;
      }
    }
    
    const enabledIlluminationSettings = illuminationSettings.filter(setting => setting.enabled);
    if (enabledIlluminationSettings.length === 0) { 
      showNotification('At least one Illumination Channel must be enabled.', 'warning'); 
      return; 
    }
    
    const timePointsArray = pendingTimePoints.split('\n').map(tp => tp.trim()).filter(tp => tp);
    if (timePointsArray.length === 0) { showNotification('At least one Pending Time Point is required.', 'warning'); return; }

    // Format illumination settings for the new API
    const formattedIlluminationSettings = enabledIlluminationSettings.map(setting => ({
      channel: setting.channel,
      intensity: parseFloat(setting.intensity),
      exposure_time: parseFloat(setting.exposure_time)
    }));

    // Build task definition based on scan mode and scan type
    const taskDefinition = {
      name: taskName.trim(),
      settings: {
        scan_mode: scanMode,
        allocated_microscope: getOrchestratorMicroscopeId(selectedMicroscopeId),
        pending_time_points: timePointsArray,
        imaged_time_points: [],
        illumination_settings: formattedIlluminationSettings,
        do_contrast_autofocus: doContrastAutofocus,
        do_reflection_af: doReflectionAf,
        action_ID: taskName.trim(),
      },
    };

    // Add incubator slot for full automation mode
    if (scanMode === 'full_automation') {
      const selectedSlotInfo = availableSlots.find(s => s.value === incubatorSlot);
      const wellPlateType = selectedSlotInfo?.wellPlateType || '96';
      
      taskDefinition.settings.incubator_slot = parseInt(incubatorSlot, 10);
      taskDefinition.settings.well_plate_type = wellPlateType;
      
      // Always add saved_data_type for full automation (backend requires it)
      taskDefinition.settings.saved_data_type = savedDataType;
    }
    
    // Add saved_data_type for microscope_only mode (always needed)
    if (scanMode === 'microscope_only') {
      taskDefinition.settings.saved_data_type = savedDataType;
    }
    
    // Add scan type specific fields (applies to both modes)
    if (savedDataType === 'raw_images_well_plate') {
      // Well plate scan fields
      if (scanMode === 'microscope_only') {
        // For microscope_only, add well_plate_type if not already set
        taskDefinition.settings.well_plate_type = '96'; // Default, could be made configurable
      }
      taskDefinition.settings.wells_to_scan = selectedWells;
      taskDefinition.settings.Nx = parseInt(nx, 10);
      taskDefinition.settings.Ny = parseInt(ny, 10);
      taskDefinition.settings.dx = parseFloat(dx);
      taskDefinition.settings.dy = parseFloat(dy);
    } else if (savedDataType === 'raw_image_flexible') {
      // Flexible positions fields
      taskDefinition.settings.positions = positions;
    }

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

  const handleUploadTask = async () => {
    if (task && task.name) {
      setUploadLoading(true);
      appendLog(`Starting upload process for task '${task.name}'...`);
      try {
        // Extract experiment_id from task name (assuming task name contains experiment_id)
        const experiment_id = task.name;
        
        const result = await orchestratorManagerService.process_timelapse_offline(
          experiment_id,
          true,  // upload_immediately
          true   // cleanup_temp_files
        );
        
        if (result && result.success) {
          showNotification(`Task '${task.name}' upload completed successfully.`, 'success');
          appendLog(`Task '${task.name}' upload completed: ${result.message}`);
          if(onTaskChange) onTaskChange(); // Refresh tasks in parent
        } else {
          showNotification(`Failed to upload task '${task.name}': ${result ? result.message : 'Unknown error'}`, 'error');
          appendLog(`Failed to upload task '${task.name}': ${result ? result.message : 'Unknown error'}`);
        }
      } catch (error) {
        showNotification(`Error uploading task '${task.name}': ${error.message}`, 'error');
        appendLog(`Error uploading task '${task.name}': ${error.message}`);
        console.error("Error uploading task:", error);
      } finally {
        setUploadLoading(false);
      }
    } else {
      showNotification('No task selected for upload or task name is missing.', 'warning');
    }
  };

  const handlePauseTask = async () => {
    if (task && task.name) {
      appendLog(`Attempting to pause task '${task.name}'...`);
      try {
        const result = await orchestratorManagerService.pause_imaging_task(task.name);
        if (result && result.success) {
          showNotification(`Task '${task.name}' paused successfully.`, 'success');
          appendLog(`Task '${task.name}' paused: ${result.message}`);
          if(onTaskChange) onTaskChange(); // Refresh tasks in parent
        } else {
          showNotification(`Failed to pause task '${task.name}': ${result ? result.message : 'Unknown error'}`, 'error');
          appendLog(`Failed to pause task '${task.name}': ${result ? result.message : 'Unknown error'}`);
        }
      } catch (error) {
        showNotification(`Error pausing task '${task.name}': ${error.message}`, 'error');
        appendLog(`Error pausing task '${task.name}': ${error.message}`);
        console.error("Error pausing task:", error);
      }
    } else {
      showNotification('No task selected for pausing or task name is missing.', 'warning');
    }
  };

  const handleResumeTask = async () => {
    if (task && task.name) {
      appendLog(`Attempting to resume task '${task.name}'...`);
      try {
        const result = await orchestratorManagerService.resume_imaging_task(task.name);
        if (result && result.success) {
          showNotification(`Task '${task.name}' resumed successfully.`, 'success');
          appendLog(`Task '${task.name}' resumed: ${result.message}`);
          if(onTaskChange) onTaskChange(); // Refresh tasks in parent
        } else {
          showNotification(`Failed to resume task '${task.name}': ${result ? result.message : 'Unknown error'}`, 'error');
          appendLog(`Failed to resume task '${task.name}': ${result ? result.message : 'Unknown error'}`);
        }
      } catch (error) {
        showNotification(`Error resuming task '${task.name}': ${error.message}`, 'error');
        appendLog(`Error resuming task '${task.name}': ${error.message}`);
        console.error("Error resuming task:", error);
      }
    } else {
      showNotification('No task selected for resuming or task name is missing.', 'warning');
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
          {isSimulatedMicroscope(selectedMicroscopeId) ? (
            <p>Time-lapse imaging is not supported for the simulated microscope.</p>
          ) : task ? (
            // Display existing task details (read-only view)
            <div className="task-details mb-4 text-xs">
              <p><strong>Status:</strong> {task.operational_state?.status || 'N/A'}</p>
              <p><strong>Scan Mode:</strong> {task.settings?.scan_mode === 'microscope_only' ? 'Microscope Only' : 'Full Automation'}</p>
              {task.settings?.saved_data_type && (
                <p><strong>Scan Type:</strong> {task.settings.saved_data_type === 'raw_images_well_plate' ? 'Well Plate Scan' : task.settings.saved_data_type === 'raw_image_flexible' ? 'Flexible Positions' : task.settings.saved_data_type}</p>
              )}
              <p><strong>Allocated Microscope:</strong> {task.settings?.allocated_microscope || 'N/A'}</p>
              {task.settings?.incubator_slot && (
                <p><strong>Incubator Slot:</strong> {task.settings.incubator_slot}</p>
              )}
              {task.settings?.well_plate_type && (
                <p><strong>Well Plate Type:</strong> {task.settings.well_plate_type}</p>
              )}
              <p><strong>Action ID:</strong> {task.settings?.action_ID || 'N/A'}</p>
              <p><strong>Imaging Started:</strong> {task.settings?.imaging_started ? 'Yes' : 'No'}</p>
              <p><strong>Imaging Completed:</strong> {task.settings?.imaging_completed ? 'Yes' : 'No'}</p>
              <p><strong>Illumination Settings:</strong> {task.settings?.illumination_settings ? JSON.stringify(task.settings.illumination_settings) : 'N/A'}</p>
              
              {/* Display positions for flexible positioning tasks */}
              {task.settings?.positions && task.settings.positions.length > 0 && (
                <>
                  <p><strong>Positions:</strong> {task.settings.positions.length} position(s)</p>
                  <ul className="list-disc pl-5 max-h-32 overflow-y-auto">
                    {task.settings.positions.map((pos, idx) => (
                      <li key={idx}>
                        {pos.name || `Position ${idx + 1}`}: 
                        X={pos.x?.toFixed(2)}mm, Y={pos.y?.toFixed(2)}mm, Z={pos.z?.toFixed(2)}mm, 
                        Grid={pos.Nx}×{pos.Ny}, Spacing={pos.dx}×{pos.dy}mm
                      </li>
                    ))}
                  </ul>
                </>
              )}
              
              {/* Display well plate scan parameters */}
              {task.settings?.Nx && task.settings?.Ny && (
                <>
                  <p><strong>Nx, Ny:</strong> {task.settings.Nx}, {task.settings.Ny}</p>
                  <p><strong>dx, dy:</strong> {task.settings?.dx || 'N/A'}, {task.settings?.dy || 'N/A'} mm</p>
                </>
              )}
              {task.settings?.wells_to_scan && task.settings.wells_to_scan.length > 0 && (
                <p><strong>Wells to Scan:</strong> {task.settings.wells_to_scan.join(', ')}</p>
              )}
              
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
                
                {/* Scan Mode Selection */}
                <div className="form-group">
                  <label className="form-label">
                    Scan Mode
                    <TutorialTooltip text="Choose between Full Automation (uses robotic arm and incubator) or Microscope Only (direct scanning without automation hardware)." />
                  </label>
                  <div className="scan-mode-radio-group">
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="scanMode"
                        value="full_automation"
                        checked={scanMode === 'full_automation'}
                        onChange={(e) => setScanMode(e.target.value)}
                        disabled={slotsLoading || illuminationLoading}
                      />
                      <span>Full Automation</span>
                      <TutorialTooltip text="Uses robotic arm to load samples from incubator. Requires an incubator slot selection." />
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        name="scanMode"
                        value="microscope_only"
                        checked={scanMode === 'microscope_only'}
                        onChange={(e) => setScanMode(e.target.value)}
                        disabled={slotsLoading || illuminationLoading}
                      />
                      <span>Microscope Only</span>
                      <TutorialTooltip text="Direct microscope scanning without robotic arm. Sample must be manually placed on the microscope stage." />
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="taskName" className="form-label">
                    Task Name
                    <TutorialTooltip text="Enter a descriptive name for your imaging task. This will help you identify it later." />
                  </label>
                  <div className="input-container">
                    <input
                      id="taskName"
                      type="text"
                      className={`modal-input ${getInputValidationClasses(
                        taskNameInput.isValid,
                        taskNameInput.hasUnsavedChanges,
                        ''
                      )}`}
                      value={taskNameInput.inputValue}
                      onChange={taskNameInput.handleInputChange}
                      onKeyDown={taskNameInput.handleKeyDown}
                      onBlur={taskNameInput.handleBlur}
                      required
                      disabled={slotsLoading || illuminationLoading}
                      placeholder="Enter task name (no special characters)"
                    />
                  </div>
                  {!taskNameInput.isValid && taskNameInput.hasUnsavedChanges && (
                    <p className="text-xs text-red-500 mt-1">
                      {(() => {
                        const validation = validateStringInput(taskNameInput.inputValue, {
                          minLength: 1,
                          maxLength: 50,
                          allowEmpty: false,
                          forbiddenChars: ['/', '\\', ':', '*', '?', '"', '<', '>', '|'],
                          trim: true
                        });
                        return validation.error || 'Invalid task name';
                      })()}
                    </p>
                  )}
                </div>

                {/* Saved Data Type Selection - Available for both modes */}
                <div className="form-group">
                  <label htmlFor="savedDataType" className="form-label">
                    Scan Type
                    <TutorialTooltip text="Choose between Well Plate Scan (scan specific wells on a plate) or Flexible Positions (scan arbitrary stage positions)." />
                  </label>
                  <select
                    id="savedDataType"
                    className="modal-input"
                    value={savedDataType}
                    onChange={(e) => setSavedDataType(e.target.value)}
                    disabled={slotsLoading || illuminationLoading}
                  >
                    <option value="raw_images_well_plate">Well Plate Scan</option>
                    <option value="raw_image_flexible">Flexible Positions</option>
                  </select>
                  <p className="text-xs text-gray-600 mt-1">
                    {savedDataType === 'raw_images_well_plate' 
                      ? 'Scan specific wells on a well plate using the grid below.' 
                      : 'Scan arbitrary stage positions captured from the microscope.'}
                  </p>
                </div>

                {/* Incubator Slot Selection - Only for Full Automation mode */}
                {scanMode === 'full_automation' && (
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
                    {incubatorSlot && availableSlots.find(s => s.value === incubatorSlot) && (
                      <p className="text-xs text-gray-600 mt-1">
                        Well Plate Type: {availableSlots.find(s => s.value === incubatorSlot)?.wellPlateType || '96'} (from sample configuration)
                      </p>
                    )}
                  </div>
                )}
              </fieldset>

              <fieldset className="modal-fieldset">
                  <legend className="modal-legend">
                      Imaging Zone & FOV
                      <TutorialTooltip text="Define the area to be imaged and the number of fields of view (FOVs). For well plates, select wells on the grid. For flexible positions, capture stage positions from the microscope."/>
                  </legend>

                  {/* Show well plate grid for raw_images_well_plate scan type */}
                  {savedDataType === 'raw_images_well_plate' && (
                    <>
                      <p className="text-sm mb-2 form-label">
                          Select imaging area by clicking and dragging on the grid below.
                          <TutorialTooltip text="Click individual wells to select them, or drag to select a rectangular area. The selected wells will be highlighted." />
                      </p>
                  <p className="text-sm mb-2 form-label">
                    Selected Wells: {selectedWells.length > 0 ? selectedWells.join(', ') : 'None'}
                    {selectedWells.length > 0 && (
                      <button 
                        onClick={() => setSelectedWells([])} 
                        className="ml-2 px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded"
                        title="Clear all selected wells"
                      >
                        Clear All
                      </button>
                    )}
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
                          Selected Wells: {selectedWells.length} wells ({selectedWells.length > 0 ? selectedWells.join(', ') : 'None'})
                      </p>
                    </>
                  )}

                  {/* Show flexible positions interface for raw_image_flexible scan type */}
                  {savedDataType === 'raw_image_flexible' && (
                    <>
                      <p className="text-sm mb-2 form-label">
                        Capture stage positions from the microscope or manually input coordinates.
                        <TutorialTooltip text="Move the microscope stage to desired positions and click 'Capture Current Position', or manually enter coordinates with 'Add Manual Position'." />
                      </p>
                      
                      <div className="position-buttons-group mb-3">
                        <button
                          type="button"
                          onClick={handleCapturePosition}
                          className="position-capture-btn"
                          disabled={isCapturingPosition || slotsLoading || illuminationLoading || !microscopeControlService}
                        >
                          <i className="fas fa-crosshairs mr-1"></i>
                          {isCapturingPosition ? 'Capturing...' : 'Capture Current Position'}
                        </button>
                        <button
                          type="button"
                          onClick={handleAddManualPosition}
                          className="position-manual-btn"
                          disabled={slotsLoading || illuminationLoading}
                        >
                          <i className="fas fa-keyboard mr-1"></i>
                          Add Manual Position
                        </button>
                      </div>

                      {positions.length > 0 && (
                        <div className="position-list">
                          <p className="text-sm font-semibold mb-2">Captured Positions ({positions.length}):</p>
                          {positions.map((position, index) => (
                            <div key={index} className="position-item">
                              <div className="position-info">
                                <span className="position-name">{position.name}</span>
                                <span className="position-coords">
                                  X: {position.x.toFixed(2)}mm, Y: {position.y.toFixed(2)}mm, Z: {position.z.toFixed(2)}mm
                                </span>
                                <span className="position-grid">
                                  Grid: {position.Nx}×{position.Ny}, Spacing: {position.dx}×{position.dy}mm
                                </span>
                              </div>
                              <div className="position-actions">
                                <button
                                  type="button"
                                  onClick={() => handleEditPosition(index)}
                                  className="btn-edit"
                                  title="Edit position parameters"
                                  disabled={slotsLoading || illuminationLoading}
                                >
                                  <i className="fas fa-edit"></i>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeletePosition(index)}
                                  className="btn-delete"
                                  title="Delete position"
                                  disabled={slotsLoading || illuminationLoading}
                                >
                                  <i className="fas fa-trash"></i>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {positions.length === 0 && (
                        <p className="text-xs text-gray-600 mt-2">
                          No positions captured yet. Move the microscope stage to a desired location and click "Capture Current Position".
                        </p>
                      )}
                    </>
                  )}

                  {/* FOV Grid Settings - Only show for well plate scans */}
                  {savedDataType === 'raw_images_well_plate' && (
                    <>
                      <div className="form-grid mt-3">
                        <div className="form-group">
                            <label htmlFor="nx" className="form-label">
                                Nx (FOVs per well)
                                <TutorialTooltip text="Number of Fields of View (FOVs) to capture along the X-axis within each selected well. E.g., 3 for a 3xM grid." />
                            </label>
                            <div className="input-container">
                              <input
                                  id="nx"
                                  type="number"
                                  className={`modal-input ${getInputValidationClasses(
                                    nxInput.isValid,
                                    nxInput.hasUnsavedChanges,
                                    ''
                                  )}`}
                                  value={nxInput.inputValue}
                                  onChange={nxInput.handleInputChange}
                                  onKeyDown={nxInput.handleKeyDown}
                                  onBlur={nxInput.handleBlur}
                                  min="1"
                                  max="20"
                                  required
                                  disabled={slotsLoading || illuminationLoading}
                                  placeholder="1-20"
                              />
                            </div>
                        </div>
                        <div className="form-group">
                            <label htmlFor="ny" className="form-label">
                                Ny (FOVs per well)
                                <TutorialTooltip text="Number of Fields of View (FOVs) to capture along the Y-axis within each selected well. E.g., M for an Mx3 grid." />
                            </label>
                            <div className="input-container">
                              <input
                                  id="ny"
                                  type="number"
                                  className={`modal-input ${getInputValidationClasses(
                                    nyInput.isValid,
                                    nyInput.hasUnsavedChanges,
                                    ''
                                  )}`}
                                  value={nyInput.inputValue}
                                  onChange={nyInput.handleInputChange}
                                  onKeyDown={nyInput.handleKeyDown}
                                  onBlur={nyInput.handleBlur}
                                  min="1"
                                  max="20"
                                  required
                                  disabled={slotsLoading || illuminationLoading}
                                  placeholder="1-20"
                              />
                            </div>
                        </div>
                      </div>

                      <div className="form-grid mt-3">
                      <div className="form-group">
                          <label htmlFor="dx" className="form-label">
                              dx (X spacing in mm)
                              <TutorialTooltip text={`Distance between Fields of View along the X-axis in millimeters. Smaller values provide more overlap, larger values provide wider coverage. Default is ${defaultSpacing.dx}mm with ~10% overlap for this microscope type.`} />
                          </label>
                          <div className="input-container">
                            <input
                                id="dx"
                                type="number"
                                className={`modal-input ${getInputValidationClasses(
                                  dxInput.isValid,
                                  dxInput.hasUnsavedChanges,
                                  ''
                                )}`}
                                value={dxInput.inputValue}
                                onChange={dxInput.handleInputChange}
                                onKeyDown={dxInput.handleKeyDown}
                                onBlur={dxInput.handleBlur}
                                min="0.1"
                                max="5.0"
                                step="0.1"
                                required
                                disabled={slotsLoading || illuminationLoading}
                                placeholder="0.1-5.0"
                            />
                          </div>
                      </div>
                      <div className="form-group">
                          <label htmlFor="dy" className="form-label">
                              dy (Y spacing in mm)
                              <TutorialTooltip text={`Distance between Fields of View along the Y-axis in millimeters. Smaller values provide more overlap, larger values provide wider coverage. Default is ${defaultSpacing.dy}mm with ~10% overlap for this microscope type.`} />
                          </label>
                          <div className="input-container">
                            <input
                                id="dy"
                                type="number"
                                className={`modal-input ${getInputValidationClasses(
                                  dyInput.isValid,
                                  dyInput.hasUnsavedChanges,
                                  ''
                                )}`}
                                value={dyInput.inputValue}
                                onChange={dyInput.handleInputChange}
                                onKeyDown={dyInput.handleKeyDown}
                                onBlur={dyInput.handleBlur}
                                min="0.1"
                                max="5.0"
                                step="0.1"
                                required
                                disabled={slotsLoading || illuminationLoading}
                                placeholder="0.1-5.0"
                            />
                          </div>
                      </div>
                      </div>
                      <p className="text-xs mt-1 form-label">
                          FOV dx, dy defaults to {defaultSpacing.dx}mm, with ~10% overlap.
                          <TutorialTooltip text={`The distance (dx, dy) between adjacent Fields of View (FOVs) defaults to ${defaultSpacing.dx}mm for this microscope type. This typically provides about 10% overlap between FOVs, ensuring complete coverage of the target area within the well. You can adjust these values above for different overlap requirements.`} />
                      </p>
                    </>
                  )}
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
                          <div className="input-container">
                            <input
                                id="intervalMinutes"
                                type="number"
                                className={`modal-input ${getInputValidationClasses(
                                  intervalInput.isValid,
                                  intervalInput.hasUnsavedChanges,
                                  ''
                                )}`}
                                value={intervalInput.inputValue}
                                onChange={intervalInput.handleInputChange}
                                onKeyDown={intervalInput.handleKeyDown}
                                onBlur={intervalInput.handleBlur}
                                min="1"
                                max="1440"
                                disabled={slotsLoading || illuminationLoading || !startTime}
                                placeholder="1-1440 minutes"
                            />
                          </div>
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
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (!isNaN(value) || e.target.value === '') {
                                          handleIlluminationSettingChange(index, 'intensity', value);
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.target.blur(); // Trigger validation on Enter
                                        }
                                      }}
                                      onBlur={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (isNaN(value)) {
                                          // Reset to previous valid value
                                          e.target.value = setting.intensity;
                                          if (showNotification) {
                                            showNotification('Invalid intensity value. Please enter a number between 0-100.', 'warning');
                                          }
                                        }
                                      }}
                                      min="0" max="100" step="0.1"
                                      disabled={!setting.enabled || slotsLoading || illuminationLoading}
                                      title="Intensity (%)"
                                      placeholder="0-100%"
                                  />
                              </div>
                              <div className="form-group mb-0 illumination-input-group">
                                  <label htmlFor={`exposure-${index}`} className="text-xs mb-0 sr-only form-label">Exposure (ms)</label>
                                  <input
                                      id={`exposure-${index}`}
                                      type="number"
                                      className="modal-input text-xs illumination-input"
                                      value={setting.exposure_time}
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (!isNaN(value) || e.target.value === '') {
                                          handleIlluminationSettingChange(index, 'exposure_time', value);
                                        }
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.target.blur(); // Trigger validation on Enter
                                        }
                                      }}
                                      onBlur={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (isNaN(value)) {
                                          // Reset to previous valid value
                                          e.target.value = setting.exposure_time;
                                          if (showNotification) {
                                            showNotification('Invalid exposure time. Please enter a number between 1-5000ms.', 'warning');
                                          }
                                        }
                                      }}
                                      min="1" max="900" step="0.1"
                                      disabled={!setting.enabled || slotsLoading || illuminationLoading}
                                      title="Exposure Time (ms)"
                                      placeholder="1-900ms"
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
        {!isSimulatedMicroscope(selectedMicroscopeId) && (
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
                <>
                    {/* Pause/Resume buttons - shown for active tasks */}
                    {task.operational_state?.status !== 'completed' && task.operational_state?.status !== 'failed' && (
                      <>
                        {task.operational_state?.status === 'paused' ? (
                          <button 
                            onClick={handleResumeTask} 
                            className="action-button primary mr-2"
                            title="Resume the paused imaging task"
                          >
                            <i className="fas fa-play mr-1"></i> Resume Task
                            <TutorialTooltip text="Resume this paused task. The task will continue processing from where it was paused." />
                          </button>
                        ) : (
                          <button 
                            onClick={handlePauseTask} 
                            className="action-button warning mr-2"
                            title="Pause the imaging task"
                          >
                            <i className="fas fa-pause mr-1"></i> Pause Task
                            <TutorialTooltip text="Pause this task to temporarily stop it from being processed. You can resume it later." />
                          </button>
                        )}
                      </>
                    )}
                    
                    {/* Upload button - only for completed tasks */}
                    {task.operational_state?.status === 'completed' && (
                        <button 
                            onClick={handleUploadTask} 
                            className="action-button primary mr-2"
                            disabled={uploadLoading}
                            title="Upload and stitch time-lapse images to artifact manager"
                        >
                            {uploadLoading ? 'Uploading...' : 'Upload Task'}
                            <TutorialTooltip text="Upload and stitch completed time-lapse images to the artifact manager for viewing and analysis. This process will combine all time points into a single dataset." />
                        </button>
                    )}
                    
                    {/* Delete button - always available for existing tasks */}
                    <button 
                        onClick={handleDeleteTask} 
                        className="action-button danger"
                    >
                        Delete Task
                    </button>
                </>
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