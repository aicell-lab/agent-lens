/**
 * Notebook Content Component
 * Renders notebook cells (code, markdown, thinking) with full functionality
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import CodeCell from './CodeCell';
import MarkdownCell from './MarkdownCell';
import ThinkingCell from './ThinkingCell';

const NotebookContent = ({ 
  cells, 
  activeCellId, 
  onActiveCellChange,
  onExecuteCell,
  onDeleteCell,
  onToggleCodeVisibility,
  onToggleOutputVisibility,
  onStopGeneration,
  isReady,
  cellManager
}) => {
  const endRef = useRef(null);
  const editorRefs = useRef({});

  // Get or create editor ref for a cell
  const getEditorRef = (cellId) => {
    if (!editorRefs.current[cellId]) {
      editorRefs.current[cellId] = React.createRef();
    }
    return editorRefs.current[cellId];
  };

  // Auto-scroll to bottom when new cells are added
  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [cells.length]);

  if (!cells || cells.length === 0) {
    return (
      <div className="notebook-empty-state">
        <div className="empty-state-icon">
          <i className="fas fa-robot fa-3x"></i>
        </div>
        <p className="empty-state-text">
          {isReady 
            ? "Start a conversation with the AI assistant by typing a message below." 
            : "Initializing kernel..."}
        </p>
      </div>
    );
  }

  const handleCellClick = (cellId) => {
    if (onActiveCellChange) {
      onActiveCellChange(cellId);
    }
  };

  const handleExecuteCell = async (cellId) => {
    if (onExecuteCell && cellManager) {
      await onExecuteCell(cellId);
    }
  };

  const handleDeleteCell = (cellId, e) => {
    e.stopPropagation();
    if (onDeleteCell) {
      onDeleteCell(cellId);
    }
  };

  const handleToggleCodeVisibility = (cellId, e) => {
    e.stopPropagation();
    if (onToggleCodeVisibility) {
      onToggleCodeVisibility(cellId);
    }
  };

  const handleToggleOutputVisibility = (cellId, e) => {
    e.stopPropagation();
    if (onToggleOutputVisibility) {
      onToggleOutputVisibility(cellId);
    }
  };

  return (
    <div className="notebook-content-container">
      {cells.map((cell) => (
        <div
          key={cell.id}
          data-cell-id={cell.id}
          className={`notebook-cell-wrapper ${cell.type} ${
            cell.executionState === 'error' ? 'cell-error' : ''
          } ${cell.metadata?.parent ? 'child-cell' : ''} ${
            activeCellId === cell.id ? 'active-cell' : ''
          }`}
          onClick={() => handleCellClick(cell.id)}
        >
          {/* Cell role indicator */}
          {cell.role && (
            <div className={`cell-role-indicator cell-role-${cell.role}`}>
              {cell.role === 'user' && <i className="fas fa-user"></i>}
              {cell.role === 'assistant' && <i className="fas fa-robot"></i>}
              {cell.role === 'system' && <i className="fas fa-cog"></i>}
            </div>
          )}

          {/* Cell operations toolbar */}
          <div className="cell-operations-toolbar">
            <button
              onClick={(e) => handleDeleteCell(cell.id, e)}
              className="cell-operation-button delete-button"
              title="Delete cell"
            >
              <i className="fas fa-trash"></i>
            </button>
            {cell.type === 'code' && (
              <>
                <button
                  onClick={(e) => handleToggleCodeVisibility(cell.id, e)}
                  className="cell-operation-button toggle-button"
                  title={cell.metadata?.isCodeVisible !== false ? "Hide code" : "Show code"}
                >
                  <i className={`fas ${cell.metadata?.isCodeVisible !== false ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
                {cell.output && cell.output.length > 0 && (
                  <button
                    onClick={(e) => handleToggleOutputVisibility(cell.id, e)}
                    className="cell-operation-button toggle-button"
                    title={cell.metadata?.isOutputVisible !== false ? "Hide output" : "Show output"}
                  >
                    <i className={`fas ${cell.metadata?.isOutputVisible !== false ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                  </button>
                )}
              </>
            )}
          </div>

          {/* Cell content based on type */}
          <div className="cell-content">
            {cell.type === 'thinking' && (
              <ThinkingCell
                content={cell.content}
                onStop={onStopGeneration}
              />
            )}

            {cell.type === 'markdown' && (
              <MarkdownCell
                content={cell.content}
                isEditing={cell.metadata?.isEditing || false}
              />
            )}

            {cell.type === 'code' && (
              <CodeCell
                code={cell.content}
                language="python"
                onExecute={() => handleExecuteCell(cell.id)}
                onAbort={() => {}}
                isExecuting={cell.executionState === 'running'}
                executionCount={cell.executionCount}
                blockRef={getEditorRef(cell.id)}
                isActive={activeCellId === cell.id}
                role={cell.role}
                hideCode={cell.metadata?.isCodeVisible === false}
                onVisibilityChange={(visible) => {
                  if (cellManager) {
                    if (visible) {
                      cellManager.toggleCodeVisibility(cell.id);
                    } else {
                      cellManager.toggleCodeVisibility(cell.id);
                    }
                  }
                }}
                hideOutput={cell.metadata?.isOutputVisible === false}
                onOutputVisibilityChange={(visible) => {
                  if (cellManager) {
                    if (visible) {
                      cellManager.toggleOutputVisibility(cell.id);
                    } else {
                      cellManager.toggleOutputVisibility(cell.id);
                    }
                  }
                }}
                parent={cell.metadata?.parent}
                output={cell.output || []}
                isReady={isReady}
              />
            )}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
};

NotebookContent.propTypes = {
  cells: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['code', 'markdown', 'thinking']).isRequired,
    content: PropTypes.string.isRequired,
    executionState: PropTypes.oneOf(['idle', 'running', 'success', 'error']),
    role: PropTypes.oneOf(['user', 'assistant', 'system']),
    output: PropTypes.array,
    metadata: PropTypes.object,
    executionCount: PropTypes.number
  })).isRequired,
  activeCellId: PropTypes.string,
  onActiveCellChange: PropTypes.func,
  onExecuteCell: PropTypes.func,
  onDeleteCell: PropTypes.func,
  onToggleCodeVisibility: PropTypes.func,
  onToggleOutputVisibility: PropTypes.func,
  onStopGeneration: PropTypes.func,
  isReady: PropTypes.bool,
  cellManager: PropTypes.object
};

export default NotebookContent;
