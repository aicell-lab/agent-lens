/**
 * Jupyter Output Component
 * Renders code execution outputs with support for ANSI, HTML, images, etc.
 */

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { processTextOutput } from '../../utils/ansi-utils';

const JupyterOutput = ({ outputs, className = '', wrapLongLines = false }) => {
  const containerRef = useRef(null);
  const [expandedOutputs, setExpandedOutputs] = useState({});

  // Skip rendering if no outputs
  if (!outputs || outputs.length === 0) {
    return null;
  }

  // Separate outputs by type
  const textAndErrorOutputs = outputs.filter(o =>
    o.type === 'stdout' || o.type === 'stderr' || o.type === 'text' || o.type === 'error' || o.type === 'result'
  );

  const htmlOutputs = outputs.filter(o => 
    o.type === 'html' && !o.attrs?.isRenderedDOM
  );

  const imageOutputs = outputs.filter(o => 
    o.type === 'img'
  );

  // Check for special DOM outputs
  const specialDomOutput = outputs.find(o => 
    o.type === 'html' && o.attrs?.isRenderedDOM
  );

  const toggleOutputExpansion = (outputId) => {
    setExpandedOutputs(prev => ({
      ...prev,
      [outputId]: !prev[outputId]
    }));
  };

  const renderOutput = (output, outputId, isExpanded, toggleExpansion) => {
    const wrapClass = wrapLongLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre';
    
    const LINE_COLLAPSE_THRESHOLD = 16;

    switch (output.type) {
      case 'stdout':
      case 'text': {
        const content = output.content || '';
        const lines = content.split('\n');
        const isLong = lines.length > LINE_COLLAPSE_THRESHOLD;
        const shouldTruncate = isLong && !isExpanded;
        const displayContent = shouldTruncate ? lines.slice(0, LINE_COLLAPSE_THRESHOLD).join('\n') : content;
        const isProcessedAnsi = output.attrs?.isProcessedAnsi;
        const hiddenLines = isLong ? lines.length - LINE_COLLAPSE_THRESHOLD : 0;

        if (isProcessedAnsi) {
          return (
            <div className={`output-content ${wrapClass}`}>
              <div
                className="ansi-processed"
                dangerouslySetInnerHTML={{ __html: processTextOutput(displayContent) }}
              />
              {shouldTruncate && (
                <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                  Show all outputs ({hiddenLines} more lines)
                </button>
              )}
              {isExpanded && isLong && (
                <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                  Show less
                </button>
              )}
            </div>
          );
        } else {
          return (
            <div className={`output-content ${wrapClass}`}>
              <pre className="output-text">{displayContent}</pre>
              {shouldTruncate && (
                <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                  Show all outputs ({hiddenLines} more lines)
                </button>
              )}
              {isExpanded && isLong && (
                <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                  Show less
                </button>
              )}
            </div>
          );
        }
      }

      case 'result': {
        const content = output.content || '';
        const lines = content.split('\n');
        const isLong = lines.length > LINE_COLLAPSE_THRESHOLD;
        const shouldTruncate = isLong && !isExpanded;
        const displayContent = shouldTruncate ? lines.slice(0, LINE_COLLAPSE_THRESHOLD).join('\n') : content;
        const hiddenLines = isLong ? lines.length - LINE_COLLAPSE_THRESHOLD : 0;

        return (
          <div className={`output-content ${wrapClass}`}>
            <pre className="output-text result-output">{displayContent}</pre>
            {shouldTruncate && (
              <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                Show all outputs ({hiddenLines} more lines)
              </button>
            )}
            {isExpanded && isLong && (
              <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                Show less
              </button>
            )}
          </div>
        );
      }

      case 'stderr':
      case 'error': {
        const errorContent = output.content || '';
        const errorLines = errorContent.split('\n');
        const errorIsLong = errorLines.length > LINE_COLLAPSE_THRESHOLD;
        const errorShouldTruncate = errorIsLong && !isExpanded;
        const errorDisplayContent = errorShouldTruncate ? errorLines.slice(0, LINE_COLLAPSE_THRESHOLD).join('\n') : errorContent;
        const errorIsProcessedAnsi = output.attrs?.isProcessedAnsi;
        const errorHiddenLines = errorIsLong ? errorLines.length - LINE_COLLAPSE_THRESHOLD : 0;

        return (
          <div className={`output-content output-error ${wrapClass}`}>
            {errorIsProcessedAnsi ? (
              <div
                className="ansi-processed error-output"
                dangerouslySetInnerHTML={{ __html: processTextOutput(errorDisplayContent) }}
              />
            ) : (
              <pre className="output-text error-text">{errorDisplayContent}</pre>
            )}
            {errorShouldTruncate && (
              <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                Show all outputs ({errorHiddenLines} more lines)
              </button>
            )}
            {isExpanded && errorIsLong && (
              <button onClick={() => toggleExpansion(outputId)} className="output-expand-button">
                Show less
              </button>
            )}
          </div>
        );
      }

      case 'html':
        return (
          <div className="output-content output-html">
            <div dangerouslySetInnerHTML={{ __html: output.content }} />
          </div>
        );

      case 'img':
        // Handle image data URLs
        const imageUrl = output.content;
        if (imageUrl && (imageUrl.startsWith('data:') || imageUrl.startsWith('http'))) {
          return (
            <div className="output-content output-image">
              <img src={imageUrl} alt="Output" className="output-image-element" />
            </div>
          );
        }
        return null;

      case 'svg':
        return (
          <div className="output-content output-svg">
            <div dangerouslySetInnerHTML={{ __html: output.content }} />
          </div>
        );

      default:
        return (
          <div className={`output-content ${wrapClass}`}>
            <pre className="output-text">{String(output.content)}</pre>
          </div>
        );
    }
  };

  return (
    <div 
      ref={containerRef} 
      className={`jupyter-output-container output-area ${className}`}
      tabIndex={-1}
    >
      {/* Render text and error outputs */}
      <div className="output-text-group">
        {textAndErrorOutputs.map((output, index) => {
          const outputId = `text-${index}`;
          return (
            <div 
              key={outputId} 
              className={`output-item ${output.attrs?.isProcessedAnsi ? 'ansi-processed' : ''}`}
            >
              {renderOutput(
                output, 
                outputId, 
                expandedOutputs[outputId], 
                () => toggleOutputExpansion(outputId)
              )}
            </div>
          );
        })}
      </div>

      {/* Render HTML outputs */}
      {htmlOutputs.length > 0 && (
        <div className="output-html-group">
          {htmlOutputs.map((output, index) => {
            const outputId = `html-${index}`;
            return (
              <div key={outputId} className="output-item">
                {renderOutput(
                  output, 
                  outputId, 
                  expandedOutputs[outputId], 
                  () => toggleOutputExpansion(outputId)
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Render image outputs */}
      {imageOutputs.length > 0 && (
        <div className="output-image-group">
          {imageOutputs.map((output, index) => {
            const outputId = `img-${index}`;
            return (
              <div key={outputId} className="output-item">
                {renderOutput(
                  output, 
                  outputId, 
                  expandedOutputs[outputId], 
                  () => toggleOutputExpansion(outputId)
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Render special DOM output */}
      {specialDomOutput && (
        <div 
          className="output-item output-rendered-dom output-area"
          dangerouslySetInnerHTML={{ __html: specialDomOutput.content }}
        />
      )}
    </div>
  );
};

JupyterOutput.propTypes = {
  outputs: PropTypes.arrayOf(PropTypes.shape({
    type: PropTypes.string.isRequired,
    content: PropTypes.any,
    attrs: PropTypes.object
  })).isRequired,
  className: PropTypes.string,
  wrapLongLines: PropTypes.bool
};

export default JupyterOutput;

