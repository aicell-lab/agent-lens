import React, { useEffect } from 'react';
import PropTypes from 'prop-types';

const Notification = ({ message, type = 'error', onDismiss, duration = 3000 }) => {
  useEffect(() => {
    if (message && onDismiss) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [message, onDismiss, duration]);

  if (!message) return null;

  const getTypeStyles = () => {
    switch (type) {
      case 'error':
        return 'bg-red-500 border-red-600';
      case 'warning':
        return 'bg-yellow-500 border-yellow-600';
      case 'success':
        return 'bg-green-500 border-green-600';
      case 'info':
        return 'bg-blue-500 border-blue-600';
      default:
        return 'bg-red-500 border-red-600';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'error':
        return 'fas fa-exclamation-triangle';
      case 'warning':
        return 'fas fa-exclamation-circle';
      case 'success':
        return 'fas fa-check-circle';
      case 'info':
        return 'fas fa-info-circle';
      default:
        return 'fas fa-exclamation-triangle';
    }
  };

  return (
    <div className={`notification-popup ${getTypeStyles()}`}>
      <div className="notification-content">
        <i className={`${getIcon()} notification-icon`}></i>
        <span className="notification-message">{message}</span>
        <button 
          className="notification-close" 
          onClick={onDismiss}
          title="Dismiss"
        >
          <i className="fas fa-times"></i>
        </button>
      </div>
    </div>
  );
};

Notification.propTypes = {
  message: PropTypes.string,
  type: PropTypes.oneOf(['error', 'warning', 'success', 'info']),
  onDismiss: PropTypes.func.isRequired,
  duration: PropTypes.number,
};

export default Notification; 