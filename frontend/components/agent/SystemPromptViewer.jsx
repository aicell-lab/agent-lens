/**
 * System Prompt Viewer Component
 * Displays the current system prompt in a modal window
 */

import React from 'react';
import PropTypes from 'prop-types';

const SystemPromptViewer = ({ isOpen, onClose, systemPrompt }) => {
  if (!isOpen) return null;

  const handleCopyToClipboard = () => {
    if (systemPrompt) {
      navigator.clipboard.writeText(systemPrompt).then(() => {
        // Could add a toast notification here
        console.log('System prompt copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
      });
    }
  };

  return (
    <div className="agent-settings-overlay" onClick={onClose}>
      <div className="agent-settings-panel system-prompt-viewer" onClick={(e) => e.stopPropagation()}>
        <div className="agent-settings-header">
          <h3>
            <i className="fas fa-file-alt"></i> System Prompt
          </h3>
          <button 
            className="agent-settings-close" 
            onClick={onClose}
            title="Close"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="agent-settings-content">
          <div className="agent-settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label>
                <i className="fas fa-info-circle"></i> Current System Prompt
              </label>
              <button
                type="button"
                className="agent-settings-button agent-settings-button-clear"
                onClick={handleCopyToClipboard}
                title="Copy to clipboard"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                <i className="fas fa-copy"></i> Copy
              </button>
            </div>
            {systemPrompt && systemPrompt.trim() ? (
              <div className="system-prompt-content">
                <pre style={{ 
                  whiteSpace: 'pre-wrap', 
                  wordWrap: 'break-word',
                  fontFamily: 'monospace',
                  fontSize: '13px',
                  lineHeight: '1.6',
                  color: '#374151',
                  backgroundColor: '#f9fafb',
                  padding: '16px',
                  borderRadius: '6px',
                  border: '1px solid #e5e7eb',
                  maxHeight: '60vh',
                  overflowY: 'auto',
                  margin: 0
                }}>
                  {systemPrompt}
                </pre>
                <p style={{ marginTop: '8px', fontSize: '12px', color: '#6b7280' }}>
                  Length: {systemPrompt.length} characters
                </p>
              </div>
            ) : (
              <div style={{ 
                padding: '16px', 
                textAlign: 'center', 
                color: '#6b7280',
                fontStyle: 'italic'
              }}>
                No system prompt loaded yet. The system prompt will appear here after the agent initializes.
                <br />
                <small style={{ fontSize: '11px', marginTop: '8px', display: 'block' }}>
                  Debug: systemPrompt = {systemPrompt === '' ? 'empty string' : systemPrompt === null ? 'null' : systemPrompt === undefined ? 'undefined' : `"${systemPrompt.substring(0, 50)}..."`}
                </small>
              </div>
            )}
            <p className="agent-settings-help">
              This is the system prompt that instructs the AI assistant. It is extracted from the agent configuration file when the agent initializes.
            </p>
          </div>
        </div>

        <div className="agent-settings-footer">
          <button 
            className="agent-settings-button agent-settings-button-save"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

SystemPromptViewer.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  systemPrompt: PropTypes.string
};

export default SystemPromptViewer;

