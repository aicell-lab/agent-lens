import { 
  HyphaServerManager, 
  isLocal, 
  initializeServices, 
  tryGetService, 
  login 
} from '../../utils';

// Mock hypha-rpc
jest.mock('hypha-rpc', () => ({
  connect_to_server: jest.fn()
}));

// Mock window and localStorage
Object.defineProperty(window, 'location', {
  value: {
    origin: 'http://localhost:3000',
    search: ''
  },
  writable: true
});

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  },
  writable: true
});

// Mock hyphaWebsocketClient
Object.defineProperty(window, 'hyphaWebsocketClient', {
  value: {
    connectToServer: jest.fn(),
    login: jest.fn()
  },
  writable: true
});

describe('Utility Functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete window.location.search;
  });

  describe('isLocal', () => {
    test('returns true for localhost', () => {
      Object.defineProperty(window, 'location', {
        value: { origin: 'http://localhost:3000', search: '' },
        writable: true
      });
      expect(isLocal()).toBe(true);
    });

    test('returns false for remote server', () => {
      Object.defineProperty(window, 'location', {
        value: { origin: 'https://example.com', search: '' },
        writable: true
      });
      expect(isLocal()).toBe(false);
    });
  });

  describe('login', () => {
    test('returns existing valid token', async () => {
      const validToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJleHAiOjk5OTk5OTk5OTl9.fake';
      window.localStorage.getItem.mockReturnValue(validToken);
      
      const result = await login();
      expect(result).toBe(validToken);
      expect(window.localStorage.getItem).toHaveBeenCalledWith('token');
    });

    test('requests new token when none exists', async () => {
      window.localStorage.getItem.mockReturnValue(null);
      const newToken = 'new-token';
      window.hyphaWebsocketClient.login.mockResolvedValue(newToken);
      
      const result = await login();
      expect(result).toBe(newToken);
      expect(window.localStorage.setItem).toHaveBeenCalledWith('token', newToken);
    });
  });
});

describe('HyphaServerManager', () => {
  let manager;
  const testToken = 'test-token';

  beforeEach(() => {
    manager = new HyphaServerManager(testToken);
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    test('creates instance with provided token', () => {
      expect(manager.token).toBe(testToken);
      expect(manager.servers).toEqual({});
      expect(manager.serverConnections).toEqual({});
    });

    test('throws error when no token provided', () => {
      expect(() => new HyphaServerManager()).toThrow('HyphaServerManager requires an authentication token.');
    });
  });

  describe('disconnectAll', () => {
    test('disconnects all connections', async () => {
      const mockDisconnect = jest.fn().mockResolvedValue();
      manager.serverConnections = {
        'test-workspace': { disconnect: mockDisconnect }
      };
      
      await manager.disconnectAll();
      
      expect(mockDisconnect).toHaveBeenCalledTimes(1);
      expect(manager.servers).toEqual({});
      expect(manager.serverConnections).toEqual({});
    });

    test('handles disconnect errors gracefully', async () => {
      const mockDisconnect = jest.fn().mockRejectedValue(new Error('Disconnect failed'));
      manager.serverConnections = {
        'test-workspace': { disconnect: mockDisconnect }
      };
      
      await expect(manager.disconnectAll()).resolves.not.toThrow();
      expect(manager.servers).toEqual({});
      expect(manager.serverConnections).toEqual({});
    });
  });
}); 