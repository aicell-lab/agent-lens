import React from 'react';
import PropTypes from 'prop-types';

const WellPlateGrid = ({
  selectedWells,
  setSelectedWells,
  gridDragStart,
  setGridDragStart,
  gridDragEnd,
  setGridDragEnd,
  isGridDragging,
  setIsGridDragging,
  gridSelectedCells,
  getWellPlateGridLabels,
  getWellIdFromIndex,
  handleGridCellMouseDown,
  handleGridCellMouseEnter,
  handleMouseUp
}) => {
  return (
    <div className="scan-well-plate-grid-container">
      <div className="flex flex-col w-full items-center">
        <div className="flex w-full items-center mb-1">
          <span className="text-xs text-gray-300 mr-2">Selected: {selectedWells.length}</span>
          <button
            onClick={() => setSelectedWells([])}
            className="ml-auto px-2 py-1 text-xs bg-gray-600 hover:bg-gray-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title="Clear all well selections"
            disabled={selectedWells.length === 0}
          >
            <i className="fas fa-refresh mr-1"></i>Refresh
          </button>
        </div>
        <div className="scan-well-plate-grid">
          <div className="scan-grid-col-labels">
            <div></div>
            {getWellPlateGridLabels().cols.map((label, colIdx) => (
              <div key={`col-${label}`} className="scan-grid-label">{label}</div>
            ))}
          </div>
          {getWellPlateGridLabels().rows.map((rowLabel, rowIdx) => (
            <div key={`row-${rowIdx}`} className="scan-grid-row">
              <div className="scan-grid-label">{rowLabel}</div>
              {getWellPlateGridLabels().cols.map((colLabel, colIdx) => {
                const wellId = getWellIdFromIndex(rowIdx, colIdx);
                const isSelected = selectedWells.includes(wellId);
                const isDragSelected = gridSelectedCells[`${rowIdx}-${colIdx}`];
                return (
                  <div
                    key={`cell-${rowIdx}-${colIdx}`}
                    className={`scan-grid-cell${isSelected || isDragSelected ? ' selected' : ''}`}
                    onMouseDown={() => handleGridCellMouseDown(rowIdx, colIdx)}
                    onMouseEnter={() => handleGridCellMouseEnter(rowIdx, colIdx)}
                    style={{ userSelect: 'none' }}
                  >
                    {/* Optionally show wellId or leave blank for cleaner look */}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

WellPlateGrid.propTypes = {
  selectedWells: PropTypes.array.isRequired,
  setSelectedWells: PropTypes.func.isRequired,
  gridDragStart: PropTypes.object,
  setGridDragStart: PropTypes.func.isRequired,
  gridDragEnd: PropTypes.object,
  setGridDragEnd: PropTypes.func.isRequired,
  isGridDragging: PropTypes.bool.isRequired,
  setIsGridDragging: PropTypes.func.isRequired,
  gridSelectedCells: PropTypes.object.isRequired,
  getWellPlateGridLabels: PropTypes.func.isRequired,
  getWellIdFromIndex: PropTypes.func.isRequired,
  handleGridCellMouseDown: PropTypes.func.isRequired,
  handleGridCellMouseEnter: PropTypes.func.isRequired,
  handleMouseUp: PropTypes.func.isRequired
};

export default WellPlateGrid;
