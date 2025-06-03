import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import './ImagingTasksModal.css'; // We will create this CSS file

const ImagingTasksModal = ({
  isOpen,
  onClose,
  task, // This will be null when creating a new task
  orchestratorManagerService,
  appendLog,
  showNotification,
  selectedMicroscopeId,
}) => {
  // State for new task form fields
  const [taskName, setTaskName] = useState('');
  const [incubatorSlot, setIncubatorSlot] = useState('1'); // Default to 1
  const [illuminationChannels, setIlluminationChannels] = useState(['BF LED matrix full']);
  const [nx, setNx] = useState('1');
  const [ny, setNy] = useState('1');
  const [doReflectionAf, setDoReflectionAf] = useState(true);
  const [imagingZone, setImagingZone] = useState('[[0,0],[0,0]]'); // Default to A1

  // State for time point generation
  const [startTime, setStartTime] = useState(''); // ISO string e.g., 2024-07-01T10:00:00
  const [endTime, setEndTime] = useState('');   // ISO string e.g., 2024-07-01T12:00:00
  const [intervalMinutes, setIntervalMinutes] = useState('30'); // In minutes
  const [pendingTimePoints, setPendingTimePoints] = useState(''); // Text area for ISO strings

  useEffect(() => {
    if (isOpen && !task) { // Reset form when opening for a new task
      setTaskName('');
      setIncubatorSlot('1');
      setIlluminationChannels(['BF LED matrix full']);
      setNx('1');
      setNy('1');
      setDoReflectionAf(true);
      setImagingZone('[[0,0],[0,0]]'); // Default to A1, e.g. for a single well A1
      setStartTime('');
      setEndTime('');
      setIntervalMinutes('30');
      setPendingTimePoints('');
    }
  }, [isOpen, task]);

  if (!isOpen) {
    return null;
  }

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
    if (!incubatorSlot.trim()){
      showNotification('Incubator Slot is required.', 'warning');
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
    if (illuminationChannels.length === 0) {
        showNotification('At least one Illumination Channel is required.', 'warning');
        return;
    }
    if (!imagingZone.trim()) {
        showNotification('Imaging Zone is required.', 'warning');
        return;
    }

    const timePointsArray = pendingTimePoints.split('\n').map(tp => tp.trim()).filter(tp => tp);
    if (timePointsArray.length === 0) {
        showNotification('At least one Pending Time Point is required.', 'warning');
        return;
    }

    const microscopeNumber = selectedMicroscopeId.endsWith("1") ? "1" : selectedMicroscopeId.endsWith("2") ? "2" : null;
    if (!microscopeNumber) {
      showNotification('Could not determine allocated microscope from selected ID.', 'error');
      return;
    }

    let parsedImagingZone;
    try {
      parsedImagingZone = JSON.parse(imagingZone);
      if (!Array.isArray(parsedImagingZone) || parsedImagingZone.length !== 2 || 
          !Array.isArray(parsedImagingZone[0]) || parsedImagingZone[0].length !== 2 ||
          !Array.isArray(parsedImagingZone[1]) || parsedImagingZone[1].length !== 2 ||
          !parsedImagingZone.every(p => p.every(coord => typeof coord === 'number'))){
        throw new Error('Imaging zone must be an array of two [row,col] index pairs, e.g., [[0,0],[0,0]] for A1 or [[0,0],[2,2]] for A1-C3 region.');
      }
    } catch (e) {
      showNotification(`Invalid Imaging Zone format: ${e.message}`, 'error');
      return;
    }

    // Basic validation for ISO format of each time point (server will do more thorough validation)
    for (const tp of timePointsArray) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(tp)) {
            showNotification(`Invalid time point format: ${tp}. Expected YYYY-MM-DDTHH:mm:ss (naive local time).`, 'error');
            return;
        }
    }

    const taskDefinition = {
      name: taskName.trim(),
      settings: {
        incubator_slot: parseInt(incubatorSlot, 10),
        allocated_microscope: microscopeNumber,
        pending_time_points: timePointsArray,
        imaged_time_points: [], // Always empty for new tasks
        imaging_zone: parsedImagingZone,
        Nx: parseInt(nx, 10),
        Ny: parseInt(ny, 10),
        illuminate_channels: illuminationChannels, // Assuming this is already an array of strings
        do_reflection_af: doReflectionAf,
        // imaging_completed and imaging_started will be set by the server
      },
    };

    appendLog(`Creating new task: ${JSON.stringify(taskDefinition, null, 2)}`);
    try {
      const result = await orchestratorManagerService.add_imaging_task(taskDefinition);
      if (result && result.success) {
        showNotification(`Task '${taskDefinition.name}' created successfully.`, 'success');
        appendLog(`Task '${taskDefinition.name}' created: ${result.message}`);
        onClose(); // Close modal after action
        // Optionally trigger a refresh of tasks in the parent component here
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
          // Optionally trigger a refresh of tasks in the parent component here
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

  const handleChannelChange = (channelName) => {
    setIlluminationChannels(prev => 
      prev.includes(channelName) 
        ? prev.filter(c => c !== channelName) 
        : [...prev, channelName]
    );
  };

  const availableChannels = [
    "BF LED matrix full", 
    "Fluorescence 405 nm Ex", 
    "Fluorescence 488 nm Ex", 
    "Fluorescence 561nm Ex", 
    "Fluorescence 638nm Ex", 
    "Fluorescence 730nm Ex"
  ];

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
              <p><strong>Imaging Started:</strong> {task.settings?.imaging_started ? 'Yes' : 'No'}</p>
              <p><strong>Imaging Completed:</strong> {task.settings?.imaging_completed ? 'Yes' : 'No'}</p>
              <p><strong>Illumination Channels:</strong> {task.settings?.illuminate_channels?.join(', ') || 'N/A'}</p>
              <p><strong>Nx, Ny:</strong> {task.settings?.Nx}, {task.settings?.Ny}</p>
              <p><strong>Imaging Zone:</strong> {JSON.stringify(task.settings?.imaging_zone)}</p>
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
                Configure a new time-lapse imaging task. Currently supports glass bottom 96 well plates.
              </p>
              <div className="form-group mb-3">
                <label htmlFor="taskName" className="block font-medium mb-1">Task Name:<span className="text-red-500">*</span></label>
                <input type="text" id="taskName" value={taskName} onChange={(e) => setTaskName(e.target.value)} className="modal-input" required />
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="form-group">
                  <label htmlFor="incubatorSlot" className="block font-medium mb-1" title="The sample is located in this slot within the incubator.">
                    Incubator Slot:<span className="text-red-500">*</span>
                  </label>
                  <input type="number" id="incubatorSlot" value={incubatorSlot} onChange={(e) => setIncubatorSlot(e.target.value)} min="1" className="modal-input" required />
                </div>
                <div className="form-group">
                    <label htmlFor="imagingZone" className="block font-medium mb-1" title="Define well/region, e.g., A1 is [[0,0],[0,0]], B1 is [[1,0],[1,0]]. A1-A3 is [[0,0],[0,2]]. Uses 0-indexed [row,col].">
                        Imaging Zone (JSON):<span className="text-red-500">*</span>
                    </label>
                    <input type="text" id="imagingZone" value={imagingZone} onChange={(e) => setImagingZone(e.target.value)} className="modal-input" placeholder='[[0,0],[0,0]] for A1' required />
                </div>
                <div className="form-group">
                  <label htmlFor="nx" className="block font-medium mb-1" title="Number of scan FOVs for each well. Distance between FOVs is 0.9mm.">
                    Nx:<span className="text-red-500">*</span>
                    </label>
                  <input type="number" id="nx" value={nx} onChange={(e) => setNx(e.target.value)} min="1" className="modal-input" required />
                </div>
                <div className="form-group">
                  <label htmlFor="ny" className="block font-medium mb-1" title="Number of scan FOVs for each well. Distance between FOVs is 0.9mm.">
                    Ny:<span className="text-red-500">*</span>
                    </label>
                  <input type="number" id="ny" value={ny} onChange={(e) => setNy(e.target.value)} min="1" className="modal-input" required />
                </div>
              </div>
              
              <div className="form-group mb-3">
                <label className="block font-medium mb-1">Illumination Channels:<span className="text-red-500">*</span></label>
                <div className="channel-checkboxes grid grid-cols-2 gap-x-4 gap-y-1">
                  {availableChannels.map(channel => (
                    <label key={channel} className="flex items-center space-x-2">
                      <input 
                        type="checkbox" 
                        checked={illuminationChannels.includes(channel)}
                        onChange={() => handleChannelChange(channel)}
                        className="form-checkbox h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span>{channel}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group mb-4">
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
                        <label htmlFor="startTime" className="block text-xs font-medium mb-0.5">Start (YYYY-MM-DDTHH:mm:ss)</label>
                        <input type="text" id="startTime" value={startTime} onChange={e => setStartTime(e.target.value)} className="modal-input text-xs" placeholder="2024-07-01T10:00:00" />
                    </div>
                    <div>
                        <label htmlFor="endTime" className="block text-xs font-medium mb-0.5">End (YYYY-MM-DDTHH:mm:ss)</label>
                        <input type="text" id="endTime" value={endTime} onChange={e => setEndTime(e.target.value)} className="modal-input text-xs" placeholder="2024-07-01T12:00:00" />
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
  task: PropTypes.object, // The task object to manage, or null for new task
  orchestratorManagerService: PropTypes.object, // For API calls
  appendLog: PropTypes.func.isRequired,
  showNotification: PropTypes.func.isRequired,
  selectedMicroscopeId: PropTypes.string.isRequired,
};

export default ImagingTasksModal; 