/**
 * Chat Input Component
 * Input field for user messages with send/stop controls
 */

import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';

const ChatInput = ({ 
  onSend, 
  onStop, 
  disabled = false, 
  placeholder = "Type your message...",
  isProcessing = false,
  kernelStatus = 'idle'
}) => {
  const [message, setMessage] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!isProcessing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isProcessing]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (message.trim() && !disabled && !isProcessing) {
      onSend(message);
      setMessage('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    }
  };

  const handleStop = () => {
    if (onStop) {
      onStop();
    }
  };

  const handleInput = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  const getStatusIndicator = () => {
    if (kernelStatus === 'starting') {
      return {
        color: 'text-gray-400',
        icon: '⏳',
        text: 'Initializing Kernel...'
      };
    }
    if (kernelStatus === 'error') {
      return {
        color: 'text-orange-500',
        icon: '⚠️',
        text: 'Kernel Unavailable (Chat Only)'
      };
    }
    if (isProcessing) {
      return {
        color: 'text-yellow-500',
        icon: '🔄',
        text: 'Processing...'
      };
    }
    return {
      color: 'text-green-500',
      icon: '✓',
      text: 'Ready'
    };
  };

  const status = getStatusIndicator();

  return (
    <div className="agent-chat-input-container">
      <div className="agent-chat-input-status">
        <span className={`status-indicator ${status.color}`}>
          <span className="status-icon">{status.icon}</span>
          <span className="status-text">{status.text}</span>
        </span>
      </div>
      
      <div className="agent-chat-input-wrapper">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={placeholder}
          disabled={disabled || kernelStatus === 'starting'}
          className="agent-chat-input-textarea"
          rows={1}
        />
        
        <div className="agent-chat-input-buttons">
          {isProcessing ? (
            <button
              onClick={handleStop}
              className="agent-chat-input-button agent-chat-stop-button"
              title="Stop generation"
            >
              <i className="fas fa-stop"></i>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!message.trim() || disabled || kernelStatus === 'starting'}
              className="agent-chat-input-button agent-chat-send-button"
              title="Send message (Enter)"
            >
              <i className="fas fa-paper-plane"></i>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

ChatInput.propTypes = {
  onSend: PropTypes.func.isRequired,
  onStop: PropTypes.func,
  disabled: PropTypes.bool,
  placeholder: PropTypes.string,
  isProcessing: PropTypes.bool,
  kernelStatus: PropTypes.oneOf(['idle', 'starting', 'ready', 'error'])
};

export default ChatInput;

