import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoginPrompt from '../../components/LoginPrompt';

describe('LoginPrompt Component', () => {
  const mockProps = {
    onLogin: jest.fn(),
    error: null
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders login prompt with correct elements', () => {
    render(<LoginPrompt {...mockProps} />);
    
    expect(screen.getByText('Please log in to access the application.')).toBeInTheDocument();
    expect(screen.getByText('Log in to Hypha')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  test('calls onLogin when login button is clicked', () => {
    render(<LoginPrompt {...mockProps} />);
    
    const loginButton = screen.getByRole('button');
    fireEvent.click(loginButton);
    
    expect(mockProps.onLogin).toHaveBeenCalledTimes(1);
  });

  test('displays error message when error is provided', () => {
    const errorMessage = 'Login failed';
    render(<LoginPrompt {...mockProps} error={errorMessage} />);
    
    expect(screen.getByText('Connection Error')).toBeInTheDocument();
    expect(screen.getByText(errorMessage)).toBeInTheDocument();
  });

  test('does not display error when error is null', () => {
    render(<LoginPrompt {...mockProps} />);
    
    expect(screen.queryByText('Connection Error')).not.toBeInTheDocument();
  });
}); 