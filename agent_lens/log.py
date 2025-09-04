"""
Centralized logging configuration for Agent-Lens.
Provides a shared setup_logging function to avoid code duplication.
"""

import logging
import logging.handlers
import os


def setup_logging(log_file, max_bytes=100000, backup_count=3):
    """
    Set up logging with rotating file handler and console output.
    
    Args:
        log_file (str): Name of the log file (will be placed in 'logs' directory)
        max_bytes (int): Maximum size of each log file before rotation
        backup_count (int): Number of backup files to keep
    
    Returns:
        logging.Logger: Configured logger instance
    """
    # Create logs directory if it doesn't exist
    logs_dir = "logs"
    if not os.path.exists(logs_dir):
        os.makedirs(logs_dir)
    
    # Update log file path to be in logs directory
    log_file_path = os.path.join(logs_dir, log_file)
    
    # Create formatter
    formatter = logging.Formatter(
        '%(asctime)s - %(levelname)s - %(message)s', 
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Get logger
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    
    # Clear any existing handlers to avoid duplicates
    logger.handlers.clear()
    
    # Rotating file handler
    file_handler = logging.handlers.RotatingFileHandler(
        log_file_path, 
        maxBytes=max_bytes, 
        backupCount=backup_count
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    return logger
