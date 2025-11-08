/**
 * Code Cell Component
 * Editable code cell with Monaco editor and execution output
 */

import React, { useState, useEffect, useRef, useImperativeHandle } from 'react';
import PropTypes from 'prop-types';
import Editor from '@monaco-editor/react';
import JupyterOutput from './JupyterOutput';

const CodeCell = ({
  code,
  language = 'python',
  onExecute,
  onAbort,
  isExecuting = false,
  executionCount,
  blockRef,
  isActive = false,
  role,
  onRoleChange,
  onChange,
  hideCode = false,
  onVisibilityChange,
  hideOutput = false,
  onOutputVisibilityChange,
  parent,
  output = [],
  isReady = false
}) => {
  const [codeValue, setCodeValue] = useState(code);
  const [editorHeight, setEditorHeight] = useState(50);
  const editorRef = useRef(null);

  // Update local value when prop changes
  useEffect(() => {
    setCodeValue(code);
  }, [code]);

  // Expose methods through ref
  useImperativeHandle(blockRef, () => ({
    getCurrentCode: () => {
      if (editorRef.current) {
        return editorRef.current.getValue();
      }
      return codeValue;
    },
    focus: () => {
      if (editorRef.current) {
        editorRef.current.focus();
      }
    },
    getContainerDomNode: () => {
      return editorRef.current?.getContainerDomNode?.() || null;
    }
  }));

  const handleEditorChange = (value) => {
    setCodeValue(value || '');
    if (onChange) {
      onChange(value || '');
    }
  };

  const handleEditorMount = (editor, monaco) => {
    editorRef.current = editor;
    
    // Configure editor
    editor.updateOptions({
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 10,
      lineHeight: 16,
      lineNumbers: 'on',
      wordWrap: 'on',
      automaticLayout: true,
      padding: { top: 4, bottom: 4 }
    });

    // Auto-resize editor
    const updateHeight = () => {
      const lineCount = editor.getModel().getLineCount();
      // Reduced minimum height and tighter line spacing for more compact cells
      const newHeight = Math.max(50, Math.min(lineCount * 14 + 8, 400));
      setEditorHeight(newHeight);
    };

    editor.getModel().onDidChangeContent(updateHeight);
    updateHeight();

    // Add keyboard shortcut for execution (Shift+Enter)
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyCode.Enter,
      () => {
        if (onExecute && isReady) {
          onExecute();
        }
      }
    );
  };

  const handleToggleCodeVisibility = () => {
    if (onVisibilityChange) {
      onVisibilityChange(!hideCode);
    }
  };

  const handleToggleOutputVisibility = () => {
    if (onOutputVisibilityChange) {
      onOutputVisibilityChange(!hideOutput);
    }
  };

  const handleExecute = () => {
    if (onExecute && isReady && !isExecuting) {
      onExecute();
    }
  };

  return (
    <div className={`code-cell-container ${isActive ? 'active' : ''} ${parent ? 'child-cell' : ''}`}>
      {/* Code Editor Section */}
      {!hideCode && (
        <div className="code-cell-editor-wrapper">
          <div className="code-cell-toolbar">
            <div className="code-cell-info">
              {executionCount !== undefined && (
                <span className="execution-counter">[{executionCount}]</span>
              )}
              <span className="code-language-badge">{language}</span>
            </div>
            <div className="code-cell-actions">
              {isExecuting ? (
                <button
                  onClick={onAbort}
                  className="cell-action-button abort-button"
                  title="Stop execution"
                >
                  <i className="fas fa-stop"></i>
                </button>
              ) : (
                <button
                  onClick={handleExecute}
                  disabled={!isReady}
                  className="cell-action-button execute-button"
                  title="Run cell (Shift+Enter)"
                >
                  <i className="fas fa-play"></i>
                </button>
              )}
              {output && output.length > 0 && (
                <button
                  onClick={handleToggleOutputVisibility}
                  className="cell-action-button toggle-button"
                  title={hideOutput ? "Show output" : "Hide output"}
                >
                  <i className={`fas ${hideOutput ? 'fa-eye' : 'fa-eye-slash'}`}></i>
                </button>
              )}
            </div>
          </div>
          <div className="code-cell-editor" style={{ height: `${editorHeight}px` }}>
            <Editor
              height={editorHeight}
              language={language}
              value={codeValue}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 10,
                lineHeight: 16,
                lineNumbers: 'on',
                wordWrap: 'on',
                automaticLayout: true,
                readOnly: role === 'system' && !isActive,
                padding: { top: 4, bottom: 4 }
              }}
            />
          </div>
          {isExecuting && (
            <div className="execution-status">
              <i className="fas fa-spinner fa-spin"></i>
              <span>Executing...</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsed Code Indicator */}
      {hideCode && (
        <div className="code-cell-collapsed">
          <button
            onClick={handleToggleCodeVisibility}
            className="show-code-button"
            title="Show code"
          >
            <i className="fas fa-code"></i>
            <span>Show code</span>
          </button>
          {executionCount !== undefined && (
            <span className="execution-counter-inline">[{executionCount}]</span>
          )}
        </div>
      )}

      {/* Output Section */}
      {output && output.length > 0 && !hideOutput && (
        <div className="code-cell-output-wrapper">
          <JupyterOutput outputs={output} />
        </div>
      )}
    </div>
  );
};

CodeCell.propTypes = {
  code: PropTypes.string.isRequired,
  language: PropTypes.string,
  onExecute: PropTypes.func,
  onAbort: PropTypes.func,
  isExecuting: PropTypes.bool,
  executionCount: PropTypes.number,
  blockRef: PropTypes.object,
  isActive: PropTypes.bool,
  role: PropTypes.oneOf(['user', 'assistant', 'system']),
  onRoleChange: PropTypes.func,
  onChange: PropTypes.func,
  hideCode: PropTypes.bool,
  onVisibilityChange: PropTypes.func,
  hideOutput: PropTypes.bool,
  onOutputVisibilityChange: PropTypes.func,
  parent: PropTypes.string,
  output: PropTypes.array,
  isReady: PropTypes.bool
};

export default CodeCell;

