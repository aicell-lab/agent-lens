/**
 * Thinking Cell Component
 * Displays AI thinking/processing state with markdown rendering
 */

import React from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const ThinkingCell = ({ content, onStop }) => {
  return (
    <div className="thinking-cell">
      <div className="thinking-header">
        <i className="fas fa-brain fa-spin"></i>
        <span>Thinking...</span>
        {onStop && (
          <button
            onClick={onStop}
            className="thinking-stop-button"
            title="Stop generation"
          >
            <i className="fas fa-stop"></i>
          </button>
        )}
      </div>
      <div className="thinking-content">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code: ({ node, inline, className, children, ...props }) => {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? (
                <pre className="code-block">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              ) : (
                <code className="inline-code" {...props}>
                  {children}
                </code>
              );
            },
            p: ({ children }) => <p className="thinking-paragraph">{children}</p>
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

ThinkingCell.propTypes = {
  content: PropTypes.string.isRequired,
  onStop: PropTypes.func
};

export default ThinkingCell;

