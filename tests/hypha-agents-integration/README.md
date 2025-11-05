# Hypha-Agents Backend Integration Tests

This directory contains JavaScript integration tests for connecting agent-lens to hypha-agents backend services.

## Prerequisites

1. **Install Dependencies**
   ```bash
   cd tests
   npm install
   ```

2. **Environment Configuration**

   Create a `.env` file in the project root with the following variables:

   ```bash
   # Existing agent-lens workspace token
   WORKSPACE_TOKEN=your_workspace_token_here
   
   # Hypha Server URL (default: https://hypha.aicell.io)
   HYPHA_SERVER_URL=https://hypha.aicell.io
   
   # Optional: Token for hypha-agents workspace (if using different workspace)
   # HYPHA_AGENTS_TOKEN=your_hypha_agents_workspace_token
   
   # LLM Configuration for Chat Completion
   OPENAI_API_KEY=your_openai_api_key_here
   LLM_MODEL=gpt-4o
   
   # Optional: Custom LLM Base URL (for local models or other providers)
   # LLM_BASE_URL=https://api.openai.com/v1/
   ```

## Running Tests

**Important**: All test commands must be run from the `tests/` directory.

### Individual Tests

```bash
# Navigate to tests directory first
cd tests

# Test 1: Hypha Server Connection
npm run test:hypha-agents:connection

# Test 2: Kernel Service (Python Execution via Deno/Pyodide)
npm run test:hypha-agents:kernel

# Test 3: Full Integration (Python + Microscope Control)
npm run test:hypha-agents:integration
```

### All Tests

```bash
# Run all tests sequentially from project root
./tests/hypha-agents-integration/run-all-tests.sh
```

Or from the tests directory:
```bash
cd tests
npm run test:hypha-agents:connection
npm run test:hypha-agents:kernel
npm run test:hypha-agents:integration
```

## Architecture Overview

### Key Components

1. **Hypha Server** - WebSocket-based RPC server for service orchestration
2. **Deno Kernel Service** (`hypha-agents/deno-app-engine`) - Executes Python code via Pyodide
3. **Microscope Services** - Hardware control services (e.g., `agent-lens/squid-control-simulation`)
4. **Chat Completion Service** - LLM API (OpenAI-compatible) for chatbot responses

### Data Flow

```
User → LLM (generates Python code) → Deno Service → Pyodide → Microscope Service
```

### Python Execution

- The Deno service hosts Pyodide (Python in WebAssembly)
- LLM generates Python code in `<py-script>` tags
- Code is executed via `deno.streamExecution({kernelId, code})`
- Python code can access microscope services via `hypha_rpc`

## Test Descriptions

### test-hypha-connection.js
- Verifies connection to Hypha server
- Checks workspace and user authentication
- Tests basic RPC connectivity

### test-kernel-service.js
- Gets the `hypha-agents/deno-app-engine` service
- Creates a Pyodide kernel
- Executes simple Python code
- Verifies output streaming
- Tests kernel cleanup

### test-integration.js
- Full end-to-end test combining all components
- Connects to Hypha server
- Initializes Python kernel
- Accesses microscope service
- Executes Python code that controls microscope via RPC
- Verifies complete workflow

## Using KernelManager in Frontend

The `kernel-manager.js` file can be copied to `frontend/utils/` for use in React components:

```javascript
import { KernelManager } from '../utils/kernelManager';

// In your component
const kernelManager = new KernelManager(hyphaManager.getServer('agent-lens'));
await kernelManager.initialize();
const { outputs, errors } = await kernelManager.executePython('print("Hello")');
```

## Troubleshooting

### Common Issues

1. **Connection timeout**
   - Check if Hypha server is running and accessible
   - Verify `HYPHA_SERVER_URL` in `.env`
   - Check network connectivity

2. **Service not found**
   - Ensure `hypha-agents/deno-app-engine` service is registered on the server
   - Verify you have access to the service (check workspace permissions)

3. **Kernel creation fails**
   - Check server logs for Pyodide initialization issues
   - Verify sufficient resources on the server

4. **Module not found errors**
   - Ensure `"type": "module"` is set in `package.json` for ES module support
   - Use `.js` extension in imports (e.g., `import { KernelManager } from './kernel-manager.js'`)

### Debug Mode

Enable verbose logging by setting environment variable:

```bash
cd tests
DEBUG=hypha-rpc:* npm run test:hypha-agents:integration
```

## Next Steps

After successful backend integration:

1. Copy `kernel-manager.js` to `frontend/utils/` for UI integration
2. Adapt React components from hypha-agents
3. Create AgentPanel component in agent-lens frontend
4. Integrate with existing microscope UI
5. Add system prompt configuration for microscope-specific agents

