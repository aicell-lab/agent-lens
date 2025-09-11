import { useState, useCallback, useMemo } from 'react';

export const useScanConfiguration = (microscopeConfiguration, showNotification) => {
  // Normal scan states
  const [showScanConfig, setShowScanConfig] = useState(false);
  const [isScanInProgress, setIsScanInProgress] = useState(false);
  const [scanParameters, setScanParameters] = useState({
    start_x_mm: 20,
    start_y_mm: 20,
    Nx: 5,
    Ny: 5,
    dx_mm: 0.85,
    dy_mm: 0.85,
    illumination_settings: [
      {
        channel: 'BF LED matrix full',
        intensity: 50,
        exposure_time: 100
      }
    ],
    do_contrast_autofocus: false,
    do_reflection_af: false,
    uploading: false
  });

  // Quick scan states
  const [showQuickScanConfig, setShowQuickScanConfig] = useState(false);
  const [isQuickScanInProgress, setIsQuickScanInProgress] = useState(false);
  const [quickScanParameters, setQuickScanParameters] = useState({
    wellplate_type: '96',
    exposure_time: 4,
    intensity: 100,
    fps_target: 5,
    n_stripes: 3,
    stripe_width_mm: 4,
    dy_mm: 0.85,
    velocity_scan_mm_per_s: 3.0,
    do_contrast_autofocus: false,
    do_reflection_af: false,
    uploading: false
  });

  // Rectangle selection states
  const [isRectangleSelection, setIsRectangleSelection] = useState(false);
  const [rectangleStart, setRectangleStart] = useState(null);
  const [rectangleEnd, setRectangleEnd] = useState(null);
  const [dragSelectedWell, setDragSelectedWell] = useState(null);

  // Well selection states
  const [selectedWells, setSelectedWells] = useState([]);
  const [wellPlateType, setWellPlateType] = useState('96');
  const [wellPaddingMm, setWellPaddingMm] = useState(1.0);

  // Grid drawing states
  const [gridDragStart, setGridDragStart] = useState(null);
  const [gridDragEnd, setGridDragEnd] = useState(null);
  const [isGridDragging, setIsGridDragging] = useState(false);

  // Calculate stage dimensions
  const stageDimensions = useMemo(() => {
    if (!microscopeConfiguration?.limits?.software_pos_limit) {
      return { width: 100, height: 70 }; // Default dimensions in mm
    }
    
    const limits = microscopeConfiguration.limits.software_pos_limit;
    return {
      width: limits.x_max - limits.x_min,
      height: limits.y_max - limits.y_min
    };
  }, [microscopeConfiguration]);

  // Calculate scan bounds
  const scanBounds = useMemo(() => {
    if (!stageDimensions || !microscopeConfiguration?.limits?.software_pos_limit) {
      return {
        xMin: 0,
        xMax: 100,
        yMin: 0,
        yMax: 70
      };
    }
    
    const limits = microscopeConfiguration.limits.software_pos_limit;
    return {
      xMin: limits.x_min,
      xMax: limits.x_max,
      yMin: limits.y_min,
      yMax: limits.y_max
    };
  }, [stageDimensions, microscopeConfiguration]);

  // Validation functions
  const validateStartPosition = useCallback((value, isX = true) => {
    const currentScanParams = scanParameters;
    const endPosition = isX 
      ? value + (currentScanParams.Nx - 1) * currentScanParams.dx_mm
      : value + (currentScanParams.Ny - 1) * currentScanParams.dy_mm;
    
    const maxAllowed = isX ? scanBounds.xMax : scanBounds.yMax;
    const minAllowed = isX ? scanBounds.xMin : scanBounds.yMin;
    
    if (value < minAllowed) {
      return { isValid: false, value: value, error: `Value must be at least ${minAllowed}` };
    }
    
    if (endPosition > maxAllowed) {
      const maxStartForGrid = maxAllowed - (isX ? (currentScanParams.Nx - 1) * currentScanParams.dx_mm : (currentScanParams.Ny - 1) * currentScanParams.dy_mm);
      return { 
        isValid: false, 
        value: value, 
        error: `Grid would extend beyond stage limits. Maximum start position: ${maxStartForGrid.toFixed(1)}` 
      };
    }
    
    return { isValid: true, value: value, error: null };
  }, [scanParameters, scanBounds]);

  const validateGridSize = useCallback((value, isNx = true) => {
    const currentScanParams = scanParameters;
    const startPos = isNx ? currentScanParams.start_x_mm : currentScanParams.start_y_mm;
    const stepSize = isNx ? currentScanParams.dx_mm : currentScanParams.dy_mm;
    const endPosition = startPos + (value - 1) * stepSize;
    
    const maxAllowed = isNx ? scanBounds.xMax : scanBounds.yMax;
    
    if (value < 1) {
      return { isValid: false, value: value, error: 'Grid size must be at least 1' };
    }
    
    if (endPosition > maxAllowed) {
      const maxGridSize = Math.floor((maxAllowed - startPos) / stepSize) + 1;
      return { 
        isValid: false, 
        value: value, 
        error: `Grid would extend beyond stage limits. Maximum grid size: ${maxGridSize}` 
      };
    }
    
    return { isValid: true, value: value, error: null };
  }, [scanParameters, scanBounds]);

  // Well plate configuration helpers
  const getWellPlateConfig = useCallback(() => {
    if (!microscopeConfiguration?.wellplate?.formats) return null;
    
    const formats = microscopeConfiguration.wellplate.formats;
    return formats[wellPlateType] || formats['96'] || null;
  }, [microscopeConfiguration, wellPlateType]);

  const getWellPlateLayout = useCallback(() => {
    const layouts = {
      '96': { rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], cols: Array.from({ length: 12 }, (_, i) => i + 1) },
      '48': { rows: ['A', 'B', 'C', 'D', 'E', 'F'], cols: Array.from({ length: 8 }, (_, i) => i + 1) },
      '24': { rows: ['A', 'B', 'C', 'D'], cols: Array.from({ length: 6 }, (_, i) => i + 1) }
    };
    return layouts[wellPlateType] || layouts['96'];
  }, [wellPlateType]);

  const getWellPlateGridLabels = useCallback(() => {
    const layout = getWellPlateLayout();
    return {
      rows: layout.rows,
      cols: layout.cols
    };
  }, [getWellPlateLayout]);

  const getWellIdFromIndex = useCallback((rowIdx, colIdx) => {
    const layout = getWellPlateLayout();
    const rowLabel = layout.rows[rowIdx];
    const colLabel = layout.cols[colIdx];
    return rowLabel && colLabel ? `${rowLabel}${colLabel}` : null;
  }, [getWellPlateLayout]);

  // Grid selection helpers
  const gridSelectedCells = useMemo(() => {
    if (!gridDragStart || !gridDragEnd) return {};
    const layout = getWellPlateLayout();
    const selected = {};
    
    const startRow = Math.min(gridDragStart.rowIdx, gridDragEnd.rowIdx);
    const endRow = Math.max(gridDragStart.rowIdx, gridDragEnd.rowIdx);
    const startCol = Math.min(gridDragStart.colIdx, gridDragEnd.colIdx);
    const endCol = Math.max(gridDragStart.colIdx, gridDragEnd.colIdx);
    
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        if (row < layout.rows.length && col < layout.cols.length) {
          selected[`${row}-${col}`] = true;
        }
      }
    }
    
    return selected;
  }, [gridDragStart, gridDragEnd, getWellPlateLayout]);

  // Grid interaction handlers
  const handleGridCellMouseDown = useCallback((rowIdx, colIdx) => {
    setGridDragStart({ rowIdx, colIdx });
    setGridDragEnd({ rowIdx, colIdx });
    setIsGridDragging(true);
  }, []);

  const handleGridCellMouseEnter = useCallback((rowIdx, colIdx) => {
    if (isGridDragging && gridDragStart) {
      setGridDragEnd({ rowIdx, colIdx });
    }
  }, [isGridDragging, gridDragStart]);

  const handleMouseUp = useCallback(() => {
    if (isGridDragging && gridDragStart && gridDragEnd) {
      // Compute all selected wells
      const layout = getWellPlateLayout();
      const newSelectedWells = [];
      
      const startRow = Math.min(gridDragStart.rowIdx, gridDragEnd.rowIdx);
      const endRow = Math.max(gridDragStart.rowIdx, gridDragEnd.rowIdx);
      const startCol = Math.min(gridDragStart.colIdx, gridDragEnd.colIdx);
      const endCol = Math.max(gridDragStart.colIdx, gridDragEnd.colIdx);
      
      for (let row = startRow; row <= endRow; row++) {
        for (let col = startCol; col <= endCol; col++) {
          if (row < layout.rows.length && col < layout.cols.length) {
            const wellId = getWellIdFromIndex(row, col);
            if (wellId) {
              newSelectedWells.push(wellId);
            }
          }
        }
      }
      
      setSelectedWells(prev => {
        // Add new wells to existing selection
        const combined = [...new Set([...prev, ...newSelectedWells])];
        return combined;
      });
      
      setGridDragStart(null);
      setGridDragEnd(null);
      setIsGridDragging(false);
    }
  }, [isGridDragging, gridDragStart, gridDragEnd, getWellPlateLayout, getWellIdFromIndex]);

  // Close handlers
  const closeScanConfig = useCallback(() => {
    setShowScanConfig(false);
    setIsRectangleSelection(false);
    setRectangleStart(null);
    setRectangleEnd(null);
    setDragSelectedWell(null);
    setGridDragStart(null);
    setGridDragEnd(null);
    setIsGridDragging(false);
  }, []);

  const closeQuickScanConfig = useCallback(() => {
    setShowQuickScanConfig(false);
  }, []);

  return {
    // Normal scan
    showScanConfig,
    setShowScanConfig,
    isScanInProgress,
    setIsScanInProgress,
    scanParameters,
    setScanParameters,
    
    // Quick scan
    showQuickScanConfig,
    setShowQuickScanConfig,
    isQuickScanInProgress,
    setIsQuickScanInProgress,
    quickScanParameters,
    setQuickScanParameters,
    
    // Rectangle selection
    isRectangleSelection,
    setIsRectangleSelection,
    rectangleStart,
    setRectangleStart,
    rectangleEnd,
    setRectangleEnd,
    dragSelectedWell,
    setDragSelectedWell,
    
    // Well selection
    selectedWells,
    setSelectedWells,
    wellPlateType,
    setWellPlateType,
    wellPaddingMm,
    setWellPaddingMm,
    
    // Grid drawing
    gridDragStart,
    setGridDragStart,
    gridDragEnd,
    setGridDragEnd,
    isGridDragging,
    setIsGridDragging,
    gridSelectedCells,
    
    // Configuration
    stageDimensions,
    scanBounds,
    validateStartPosition,
    validateGridSize,
    getWellPlateConfig,
    getWellPlateLayout,
    getWellPlateGridLabels,
    getWellIdFromIndex,
    
    // Handlers
    handleGridCellMouseDown,
    handleGridCellMouseEnter,
    handleMouseUp,
    closeScanConfig,
    closeQuickScanConfig
  };
};

export default useScanConfiguration;
