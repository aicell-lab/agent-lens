/**
 * Canvas Panel Component
 * Displays windows created by Python's api.createWindow() calls.
 * Supports HTML content (rendered in sandboxed iframes) and URLs.
 */

import React from 'react';
import PropTypes from 'prop-types';
import './CanvasPanel.css';

/**
 * Detect whether a string is HTML content (vs a URL)
 */
function isHtmlContent(src) {
  if (!src || typeof src !== 'string') return false;
  const trimmed = src.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  // Common HTML document patterns
  if (lower.startsWith('<!doctype html')) return true;
  if (lower.startsWith('<html')) return true;

  // Common HTML root elements
  const htmlStartPatterns = [
    '<head', '<body', '<div', '<span', '<p>',
    '<h1', '<h2', '<h3', '<h4', '<h5', '<h6',
    '<table', '<form', '<section', '<article',
    '<header', '<footer', '<nav', '<main',
    '<svg', '<canvas', '<ul', '<ol', '<script',
  ];
  if (htmlStartPatterns.some(pattern => lower.startsWith(pattern))) return true;

  // Generic HTML tag detection (not a URL)
  const urlPattern = /^(https?|ftp|file):\/\//i;
  const htmlTagPattern = /<\/?[a-z][\s\S]*>/i;
  return htmlTagPattern.test(trimmed) && !urlPattern.test(trimmed);
}

const CanvasPanel = ({ windows, activeWindowId, onSetActive, onClose }) => {
  if (!windows || windows.length === 0) return null;

  const activeWindow = windows.find(w => w.id === activeWindowId) || windows[0];

  return (
    <div className="canvas-panel">
      {/* Tab bar */}
      <div className="canvas-panel-tabs">
        {windows.map(win => (
          <button
            key={win.id}
            className={`canvas-tab ${activeWindowId === win.id ? 'active' : ''}`}
            onClick={() => onSetActive(win.id)}
            title={win.name}
          >
            <span className="canvas-tab-name">{win.name}</span>
            <span
              className="canvas-tab-close"
              onClick={(e) => { e.stopPropagation(); onClose(win.id); }}
              title="Close"
            >
              ×
            </span>
          </button>
        ))}
      </div>

      {/* Window content */}
      <div className="canvas-panel-content">
        {windows.map(win => (
          <div
            key={win.id}
            className={`canvas-window ${win.id === (activeWindow?.id) ? 'visible' : 'hidden'}`}
          >
            {win.component ? (
              win.component
            ) : win.src && isHtmlContent(win.src) ? (
              <iframe
                srcDoc={win.src}
                title={win.name || 'HTML Content'}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                className="canvas-iframe"
              />
            ) : win.src ? (
              <iframe
                src={win.src}
                title={win.name || 'Window'}
                className="canvas-iframe"
              />
            ) : (
              <div className="canvas-empty">No content</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

CanvasPanel.propTypes = {
  windows: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    src: PropTypes.string,
    component: PropTypes.node,
  })).isRequired,
  activeWindowId: PropTypes.string,
  onSetActive: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

export { isHtmlContent };
export default CanvasPanel;
