/**
 * Notebook Content Component
 * Renders notebook cells (code, markdown, thinking)
 */

import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const NotebookContent = ({ 
  cells, 
  activeCellId, 
  onActiveCellChange,
  isReady 
}) => {
  const endRef = useRef(null);

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
          onClick={() => onActiveCellChange && onActiveCellChange(cell.id)}
        >
          {/* Cell role indicator */}
          {cell.role && (
            <div className={`cell-role-indicator cell-role-${cell.role}`}>
              {cell.role === 'user' && <i className="fas fa-user"></i>}
              {cell.role === 'assistant' && <i className="fas fa-robot"></i>}
              {cell.role === 'system' && <i className="fas fa-cog"></i>}
            </div>
          )}

          {/* Cell content based on type */}
          <div className="cell-content">
            {cell.type === 'thinking' && (
              <div className="thinking-cell">
                <div className="thinking-header">
                  <i className="fas fa-brain fa-spin"></i>
                  <span>Thinking...</span>
                </div>
                <div className="thinking-content">
                  {cell.content}
                </div>
              </div>
            )}

            {cell.type === 'markdown' && (
              <div className="markdown-cell">
                <div className="markdown-content">
                  {cell.content}
                </div>
              </div>
            )}

            {cell.type === 'code' && (
              <div className="code-cell">
                {/* Code editor will be rendered by CodeCell component */}
                {cell.metadata?.isCodeVisible !== false && (
                  <div className="code-cell-editor">
                    <pre className="code-content">
                      <code>{cell.content}</code>
                    </pre>
                  </div>
                )}

                {/* Execution counter */}
                {cell.executionCount !== undefined && (
                  <div className="execution-counter">
                    [{cell.executionCount}]
                  </div>
                )}

                {/* Output area */}
                {cell.output && cell.output.length > 0 && cell.metadata?.isOutputVisible !== false && (
                  <div className="code-cell-output">
                    {cell.output.map((output, index) => (
                      <div key={index} className={`output-item output-${output.type}`}>
                        {output.type === 'stdout' && (
                          <pre className="output-stdout">{output.content}</pre>
                        )}
                        {output.type === 'stderr' && (
                          <pre className="output-stderr">{output.content}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Execution state indicator */}
                {cell.executionState === 'running' && (
                  <div className="execution-status">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Executing...</span>
                  </div>
                )}
              </div>
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
    metadata: PropTypes.object
  })).isRequired,
  activeCellId: PropTypes.string,
  onActiveCellChange: PropTypes.func,
  isReady: PropTypes.bool
};

export default NotebookContent;

