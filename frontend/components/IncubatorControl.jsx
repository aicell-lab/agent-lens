import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';

const IncubatorControl = ({ incubatorControlService, appendLog }) => {
  // Example state for incubator parameters; adjust as needed.
  const [temperature, setTemperature] = useState(37);
  const [CO2, setCO2] = useState(5);
  const [isUpdating, setIsUpdating] = useState(false);
  const [slotsInfo, setSlotsInfo] = useState(Array(42).fill({}));
  // New state for selected slot details
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedSlotNumber, setSelectedSlotNumber] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Form state for sample information
  const [sampleForm, setSampleForm] = useState({
    name: '',
    status: '',
    location: 'incubator_slot',
    date_to_incubator: '',
    well_plate_type: '96'
  });

  const updateSettings = async () => {
    if (incubatorControlService) {
      try {
        const temp = await incubatorControlService.get_temperature();
        const co2 = await incubatorControlService.get_co2_level();
        setTemperature(temp);
        setCO2(co2);
        appendLog(`Incubator information updated: Temp ${temp}°C, CO2 ${co2}%`);
      } catch (error) {
        appendLog(`Failed to update incubator information: ${error.message}`);
      }
    } else {
      appendLog(`Updated incubator information locally: Temp ${temperature}°C, CO2 ${CO2}%`);
    }
  };

  const fetchSlotInformation = async () => {
    if (incubatorControlService) {
      try {
        const updatedSlotsInfo = [];
        for (let i = 1; i <= 42; i++) {
          const slotInfo = await incubatorControlService.get_slot_information(i);
          updatedSlotsInfo.push(slotInfo);
        }
        setSlotsInfo(updatedSlotsInfo);
        appendLog(`Slots information updated`);
      } catch (error) {
        appendLog(`Failed to update slots information: ${error.message}`);
      }
    }
  };

  useEffect(() => {
    // Call updateSettings and fetchSlotInformation once when the component mounts
    updateSettings();
    fetchSlotInformation();

    // Set an interval to update slots information every 10 seconds
    const interval = setInterval(fetchSlotInformation, 10000);

    return () => clearInterval(interval);
  }, []); // Empty dependency array ensures this runs only once on mount

  const handleOpen = () => {
    setIsUpdating(true);
  };

  const handleClose = () => {
    setIsUpdating(false);
  };

  const handleSlotDoubleClick = (slot, slotNumber) => {
    setSelectedSlot(slot);
    setSelectedSlotNumber(slotNumber);
    setSidebarOpen(true);
    setIsEditing(false);
    
    // If slot has data, populate the form for potential editing
    if (slot.name && slot.name.trim()) {
      setSampleForm({
        name: slot.name || '',
        status: slot.status || '',
        location: slot.location || 'incubator_slot',
        date_to_incubator: slot.date_to_incubator || '',
        well_plate_type: slot.well_plate_type || '96'
      });
    } else {
      // Reset form for empty slot
      setSampleForm({
        name: '',
        status: '',
        location: 'incubator_slot',
        date_to_incubator: '',
        well_plate_type: '96'
      });
    }
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
    setSelectedSlot(null);
    setSelectedSlotNumber(null);
    setIsEditing(false);
  };

  const handleFormChange = (field, value) => {
    setSampleForm(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddSample = async () => {
    if (!incubatorControlService) {
      appendLog('Incubator service not available');
      return;
    }

    try {
      const result = await incubatorControlService.add_sample(
        selectedSlotNumber,
        sampleForm.name,
        sampleForm.status,
        sampleForm.location,
        sampleForm.date_to_incubator,
        sampleForm.well_plate_type
      );
      appendLog(result);
      await fetchSlotInformation(); // Refresh slot data
      closeSidebar();
    } catch (error) {
      appendLog(`Failed to add sample: ${error.message}`);
    }
  };

  const handleRemoveSample = async () => {
    if (!incubatorControlService) {
      appendLog('Incubator service not available');
      return;
    }

    try {
      const result = await incubatorControlService.remove_sample(selectedSlotNumber);
      appendLog(result);
      await fetchSlotInformation(); // Refresh slot data
      closeSidebar();
    } catch (error) {
      appendLog(`Failed to remove sample: ${error.message}`);
    }
  };

  const handleEditSample = async () => {
    // For editing, we remove the old sample and add a new one
    try {
      await handleRemoveSample();
      await handleAddSample();
    } catch (error) {
      appendLog(`Failed to edit sample: ${error.message}`);
    }
  };

  const renderSlots = () => {
    return slotsInfo.map((slot, index) => {
      const slotNumber = index + 1;
      const isOrange = slot.name && slot.name.trim();
      const bgColor = isOrange ? '#f97316' : '#22c55e'; // orange vs green
      return (
        <button
          key={slotNumber}
          style={{ backgroundColor: bgColor }}
          className="w-8 h-8 m-1 rounded hover:opacity-80"
          onDoubleClick={() => handleSlotDoubleClick(slot, slotNumber)}
          title={`Slot ${slotNumber}${isOrange ? ` - ${slot.name}` : ' - Empty'}`}
        >
          {slotNumber}
        </button>
      );
    });
  };

  const isSlotEmpty = !selectedSlot || !selectedSlot.name || !selectedSlot.name.trim();

  return (
    <div className="flex relative">
      {/* Main incubator control panel */}
      <div className={`bg-white bg-opacity-95 p-6 rounded-lg shadow-lg border-l border-gray-300 box-border overflow-y-auto transition-all duration-300 ${sidebarOpen ? 'w-2/3' : 'w-full'}`}>
        <h3 className="text-xl font-medium mb-4">Incubator Control</h3>
        <div id="incubator-control-content">
          <div className="incubator-settings">
            <div className="mb-4">
              <label className="block text-sm font-medium">Temperature (°C):</label>
              <input
                type="number"
                className="mt-1 block w-full border border-gray-300 rounded p-2"
                value={temperature}
                readOnly
              />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium">CO2 (%):</label>
              <input
                type="number"
                className="mt-1 block w-full border border-gray-300 rounded p-2"
                value={CO2}
                readOnly
              />
            </div>
            <button
              className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600"
              onClick={updateSettings}
            >
              Update Settings
            </button>
            {/* New container for Microplate Racks */}
            <div className="rounded-lg border border-gray-300 p-4 mt-4">
              <h4 className="text-lg font-bold mb-2 text-center">Microplate Slots</h4>
              <p className="text-sm text-gray-600 mb-2 text-center">Double-click a slot to manage samples</p>
              <div className="grid grid-cols-2 gap-x-1 gap-y-1">
                <div className="grid grid-cols-1">
                  {renderSlots().slice(0, 21).reverse()}
                </div>
                <div className="grid grid-cols-1">
                  {renderSlots().slice(21).reverse()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right sidebar for slot management */}
      {sidebarOpen && (
        <div className="w-1/3 bg-white bg-opacity-95 shadow-lg border-l border-gray-300 p-4 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-bold">
              Slot {selectedSlotNumber} Management
            </h4>
            <button 
              onClick={closeSidebar} 
              className="text-red-500 hover:text-red-700 text-xl font-bold"
            >
              ×
            </button>
          </div>

          {isSlotEmpty ? (
            /* Add new sample form */
            <div>
              <h5 className="font-medium mb-3 text-green-600">Add New Sample</h5>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Sample Name:</label>
                  <input
                    type="text"
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    placeholder="Enter sample name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Status:</label>
                  <select
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.status}
                    onChange={(e) => handleFormChange('status', e.target.value)}
                  >
                    <option value="">Select status</option>
                    <option value="IN">IN</option>
                    <option value="OUT">OUT</option>
                    <option value="Not Available">Not Available</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Date to Incubator:</label>
                  <input
                    type="datetime-local"
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.date_to_incubator}
                    onChange={(e) => handleFormChange('date_to_incubator', e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Well Plate Type:</label>
                  <select
                    className="w-full border border-gray-300 rounded p-2"
                    value={sampleForm.well_plate_type}
                    onChange={(e) => handleFormChange('well_plate_type', e.target.value)}
                  >
                    <option value="96">96-well</option>
                    <option value="384">384-well</option>
                    <option value="24">24-well</option>
                    <option value="48">48-well</option>
                  </select>
                </div>
                <button
                  onClick={handleAddSample}
                  className="w-full bg-green-500 text-white p-2 rounded hover:bg-green-600"
                  disabled={!sampleForm.name.trim()}
                >
                  Add Sample
                </button>
              </div>
            </div>
          ) : (
            /* Existing sample management */
            <div>
              {!isEditing ? (
                /* Display mode */
                <div>
                  <h5 className="font-medium mb-3 text-blue-600">Sample Information</h5>
                  <div className="space-y-2 mb-4">
                    <p><strong>Name:</strong> {selectedSlot.name}</p>
                    <p><strong>Status:</strong> {selectedSlot.status}</p>
                    <p><strong>Location:</strong> {selectedSlot.location}</p>
                    <p><strong>Date to Incubator:</strong> {selectedSlot.date_to_incubator}</p>
                    <p><strong>Well Plate Type:</strong> {selectedSlot.well_plate_type}</p>
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={() => setIsEditing(true)}
                      className="w-full bg-blue-500 text-white p-2 rounded hover:bg-blue-600"
                    >
                      Edit Sample
                    </button>
                    <button
                      onClick={handleRemoveSample}
                      className="w-full bg-red-500 text-white p-2 rounded hover:bg-red-600"
                    >
                      Remove Sample
                    </button>
                  </div>
                </div>
              ) : (
                /* Edit mode */
                <div>
                  <h5 className="font-medium mb-3 text-orange-600">Edit Sample</h5>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium mb-1">Sample Name:</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.name}
                        onChange={(e) => handleFormChange('name', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Status:</label>
                      <select
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.status}
                        onChange={(e) => handleFormChange('status', e.target.value)}
                      >
                        <option value="">Select status</option>
                        <option value="IN">IN</option>
                        <option value="OUT">OUT</option>
                        <option value="Not Available">Not Available</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Date to Incubator:</label>
                      <input
                        type="datetime-local"
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.date_to_incubator}
                        onChange={(e) => handleFormChange('date_to_incubator', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Well Plate Type:</label>
                      <select
                        className="w-full border border-gray-300 rounded p-2"
                        value={sampleForm.well_plate_type}
                        onChange={(e) => handleFormChange('well_plate_type', e.target.value)}
                      >
                        <option value="96">96-well</option>
                        <option value="384">384-well</option>
                        <option value="24">24-well</option>
                        <option value="48">48-well</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <button
                        onClick={handleEditSample}
                        className="w-full bg-orange-500 text-white p-2 rounded hover:bg-orange-600"
                        disabled={!sampleForm.name.trim()}
                      >
                        Save Changes
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="w-full bg-gray-500 text-white p-2 rounded hover:bg-gray-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

IncubatorControl.propTypes = {
  incubatorControlService: PropTypes.object,
  appendLog: PropTypes.func.isRequired,
};

export default IncubatorControl;
