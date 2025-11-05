/**
 * Markdown Cell Component
 * Renders markdown content with react-markdown
 */

import React from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MarkdownCell = ({ content, isEditing = false, onChange }) => {
  if (isEditing) {
    return (
      <div className="markdown-cell markdown-editing">
        <textarea
          value={content}
          onChange={(e) => onChange && onChange(e.target.value)}
          className="markdown-editor"
          placeholder="Enter markdown content..."
        />
      </div>
    );
  }

  return (
    <div className="markdown-cell">
      <div className="markdown-content">
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
            table: ({ children }) => (
              <div className="table-wrapper">
                <table className="markdown-table">{children}</table>
              </div>
            ),
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

MarkdownCell.propTypes = {
  content: PropTypes.string.isRequired,
  isEditing: PropTypes.bool,
  onChange: PropTypes.func
};

export default MarkdownCell;

