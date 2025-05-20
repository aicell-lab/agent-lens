import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';

const ImagingTasksControl = ({ orchestratorService, appendLog }) => {
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form state
  const [taskName, setTaskName] = useState('');
  const [incubatorSlot, setIncubatorSlot] = useState('');
  const [timeStartImaging, setTimeStartImaging] = useState('');
  const [timeEndImaging, setTimeEndImaging] = useState('');
  const [imagingInterval, setImagingInterval] = useState('');
  const [allocatedMicroscope, setAllocatedMicroscope] = useState('');
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);

  const fetchTasks = useCallback(async () => {
    if (!orchestratorService) {
      appendLog("Orchestrator service not available.");
      setTasks([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      appendLog("Fetching imaging tasks...");
      const result = await orchestratorService.get_all_imaging_tasks();
      if (Array.isArray(result)) {
        setTasks(result);
        appendLog(`Successfully fetched ${result.length} imaging tasks.`);
      } else if (result && result.error) {
        throw new Error(result.error);
      } 
      else if (result && result.success === false) {
        throw new Error(result.message || "Failed to fetch tasks due to server error.");
      }
      else {
        appendLog("Received unexpected data format for tasks list.");
        setTasks([]); // Clear tasks if data is not an array
      }
    } catch (err) {
      appendLog(`Error fetching imaging tasks: ${err.message}`);
      setError(err.message);
      setTasks([]); // Clear tasks on error
    } finally {
      setIsLoading(false);
    }
  }, [orchestratorService, appendLog]);

  useEffect(() => {
    fetchTasks();
    // Set up an interval to refresh tasks, e.g., every 30 seconds
    const intervalId = setInterval(fetchTasks, 30000);
    return () => clearInterval(intervalId);
  }, [fetchTasks]);

  const handleAddTask = async (e) => {
    e.preventDefault();
    if (!orchestratorService) {
      appendLog("Orchestrator service not available to add task.");
      return;
    }
    
    // Basic validation
    if (!taskName.trim()) {
        appendLog("Task Name is required.");
        return;
    }
    if (!incubatorSlot.trim() || !timeStartImaging.trim() || !timeEndImaging.trim() || !imagingInterval.trim() || !allocatedMicroscope.trim()) {
        appendLog("All task settings fields are required.");
        return;
    }

    // Validate ISO format for dates (simple check)
    try {
        new Date(timeStartImaging).toISOString();
        new Date(timeEndImaging).toISOString();
    } catch (error) {
        appendLog("Invalid date format. Please use ISO format (e.g., YYYY-MM-DDTHH:MM:SSZ).");
        return;
    }


    const taskDefinition = {
      name: taskName,
      settings: {
        incubator_slot: incubatorSlot,
        time_start_imaging: new Date(timeStartImaging).toISOString(), // Ensure ISO format
        time_end_imaging: new Date(timeEndImaging).toISOString(),   // Ensure ISO format
        imaging_interval: parseInt(imagingInterval, 10), // Assuming interval is in some unit like minutes/hours
        allocated_microscope: allocatedMicroscope,
      },
    };

    setIsLoading(true);
    try {
      appendLog(`Adding imaging task: ${taskName}...`);
      const response = await orchestratorService.add_imaging_task(taskDefinition);
      if (response.success) {
        appendLog(`Task '${taskName}' added successfully. Message: ${response.message}`);
        // Reset form and refresh tasks
        setTaskName('');
        setIncubatorSlot('');
        setTimeStartImaging('');
        setTimeEndImaging('');
        setImagingInterval('');
        setAllocatedMicroscope('');
        setShowAddTaskForm(false);
        fetchTasks();
      } else {
        throw new Error(response.message || "Failed to add task.");
      }
    } catch (err) {
      appendLog(`Error adding imaging task '${taskName}': ${err.message}`);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTask = async (taskNameToDelete) => {
    if (!orchestratorService) {
      appendLog("Orchestrator service not available to delete task.");
      return;
    }
    if (!window.confirm(`Are you sure you want to delete task: ${taskNameToDelete}?`)) {
        return;
    }
    setIsLoading(true);
    try {
      appendLog(`Deleting imaging task: ${taskNameToDelete}...`);
      const response = await orchestratorService.delete_imaging_task(taskNameToDelete);
      if (response.success) {
        appendLog(`Task '${taskNameToDelete}' deleted successfully. Message: ${response.message}`);
        fetchTasks(); // Refresh the list
      } else {
        throw new Error(response.message || "Failed to delete task.");
      }
    } catch (err) {
      appendLog(`Error deleting imaging task '${taskNameToDelete}': ${err.message}`);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };
  
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleString();
    } catch (e) {
      return dateString; // if already formatted or invalid
    }
  };


  return (
    <div className="bg-white bg-opacity-95 p-6 rounded-lg shadow-lg border-l border-gray-300 box-border overflow-y-auto h-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-xl font-medium">Imaging Task Management</h3>
        <button
          onClick={() => setShowAddTaskForm(!showAddTaskForm)}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 transition duration-150"
        >
          {showAddTaskForm ? 'Cancel' : 'Add New Task'}
        </button>
      </div>

      {showAddTaskForm && (
        <form onSubmit={handleAddTask} className="mb-6 p-4 border border-gray-200 rounded-lg shadow">
          <h4 className="text-lg font-semibold mb-3">Add New Imaging Task</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="taskName" className="block text-sm font-medium text-gray-700">Task Name</label>
              <input type="text" id="taskName" value={taskName} onChange={(e) => setTaskName(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="incubatorSlot" className="block text-sm font-medium text-gray-700">Incubator Slot</label>
              <input type="text" id="incubatorSlot" value={incubatorSlot} onChange={(e) => setIncubatorSlot(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="timeStartImaging" className="block text-sm font-medium text-gray-700">Start Imaging (YYYY-MM-DDTHH:MM:SSZ)</label>
              <input type="datetime-local" id="timeStartImaging" value={timeStartImaging} onChange={(e) => setTimeStartImaging(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="timeEndImaging" className="block text-sm font-medium text-gray-700">End Imaging (YYYY-MM-DDTHH:MM:SSZ)</label>
              <input type="datetime-local" id="timeEndImaging" value={timeEndImaging} onChange={(e) => setTimeEndImaging(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
            <div>
              <label htmlFor="imagingInterval" className="block text-sm font-medium text-gray-700">Imaging Interval (e.g., hours)</label>
              <input type="number" id="imagingInterval" value={imagingInterval} onChange={(e) => setImagingInterval(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="e.g., 1 for 1 hour" />
            </div>
            <div>
              <label htmlFor="allocatedMicroscope" className="block text-sm font-medium text-gray-700">Allocated Microscope</label>
              <input type="text" id="allocatedMicroscope" value={allocatedMicroscope} onChange={(e) => setAllocatedMicroscope(e.target.value)} required className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
            </div>
          </div>
          <button type="submit" disabled={isLoading} className="mt-4 w-full bg-green-500 text-white p-2 rounded hover:bg-green-600 disabled:bg-gray-400">
            {isLoading ? 'Adding...' : 'Add Task'}
          </button>
        </form>
      )}

      {error && <div className="mb-4 text-red-600 bg-red-100 p-3 rounded">Error: {error}</div>}
      
      <h4 className="text-lg font-semibold mb-3">Current Imaging Tasks</h4>
      {isLoading && !tasks.length && <p>Loading tasks...</p>}
      {!isLoading && !tasks.length && !error && <p>No imaging tasks found.</p>}
      
      {tasks.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Inc. Slot</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Start Time</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">End Time</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Interval</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Microscope</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tasks.map((task, index) => (
                <tr key={task.name || index}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{task.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.settings?.incubator_slot}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(task.settings?.time_start_imaging)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatDate(task.settings?.time_end_imaging)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.settings?.imaging_interval}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{task.settings?.allocated_microscope}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      task.operational_state?.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                      task.operational_state?.status === 'running' ? 'bg-blue-100 text-blue-800' :
                      task.operational_state?.status === 'completed' ? 'bg-green-100 text-green-800' :
                      task.operational_state?.status === 'failed' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {task.operational_state?.status || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    {/* Edit button can be added here later if needed */}
                    <button
                      onClick={() => handleDeleteTask(task.name)}
                      disabled={isLoading}
                      className="text-red-600 hover:text-red-900 disabled:text-gray-400"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
       {isLoading && tasks.length > 0 && <p className="mt-4">Refreshing tasks...</p>}
    </div>
  );
};

ImagingTasksControl.propTypes = {
  orchestratorService: PropTypes.object,
  appendLog: PropTypes.func.isRequired,
};

export default ImagingTasksControl; 