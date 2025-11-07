import { hyphaWebsocketClient } from 'hypha-rpc';
import { KernelManager } from './kernel-manager.js';
import dotenv from 'dotenv';

dotenv.config();

async function testFullIntegration() {
  console.log('🚀 Full Integration Test\n');
  console.log('='.repeat(60) + '\n');
  
  const results = {
    connection: false,
    kernel: false,
    microscope: false,
    pythonExecution: false
  };
  
  let server = null;
  let kernelManager = null;
  
  try {
    // Step 1: Connect to Hypha
    console.log('STEP 1: Hypha Connection');
    console.log('-'.repeat(60));
    server = await hyphaWebsocketClient.connectToServer({
      server_url: process.env.HYPHA_SERVER_URL || 'https://hypha.aicell.io',
      token: process.env.WORKSPACE_TOKEN
    });
    results.connection = true;
    console.log('✅ Connected to workspace:', server.config.workspace, '\n');
    
    // Step 2: Initialize Kernel
    console.log('STEP 2: Kernel Initialization');
    console.log('-'.repeat(60));
    kernelManager = new KernelManager(server);
    await kernelManager.initialize();
    results.kernel = true;
    console.log('✅ Python kernel ready\n');
    
    // Step 3: Test Microscope Service Access
    console.log('STEP 3: Microscope Service');
    console.log('-'.repeat(60));
    const microscope = await server.getService('agent-lens/squid-control-simulation');
    const status = await microscope.get_status();
    results.microscope = true;
    console.log('✅ Microscope accessible');
    console.log(`   Position: x=${status.current_x.toFixed(3)}, y=${status.current_y.toFixed(3)}, z=${status.current_z.toFixed(3)}\n`);
    
    // Step 4: Execute Python with Microscope Control
    console.log('STEP 4: Python Execution with Microscope Control');
    console.log('-'.repeat(60));
    
    const pythonCode = `
# Import hypha_rpc to access microscope service
from hypha_rpc import connect_to_server

# Connect to server and get microscope service
server = await connect_to_server(
    server_url="${server.config.public_base_url}",
    token="${await server.generateToken()}"
)
microscope = await server.get_service("agent-lens/squid-control-simulation")

# Get current status
status = await microscope.get_status()
print(f"Current position: x={status['current_x']:.3f}, y={status['current_y']:.3f}, z={status['current_z']:.3f}")
print("Python microscope control successful!")
    `.trim();
    
    const { outputs, errors } = await kernelManager.executePython(pythonCode);
    
    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
    
    results.pythonExecution = true;
    console.log('✅ Python execution with microscope control');
    console.log('   Output:', outputs.join('\n   '));
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('Hypha Connection:      ', results.connection ? '✅ PASS' : '❌ FAIL');
    console.log('Kernel Service:        ', results.kernel ? '✅ PASS' : '❌ FAIL');
    console.log('Microscope Service:    ', results.microscope ? '✅ PASS' : '❌ FAIL');
    console.log('Python Execution:      ', results.pythonExecution ? '✅ PASS' : '❌ FAIL');
    console.log('='.repeat(60));
    
    const allPassed = Object.values(results).every(v => v);
    console.log(allPassed ? '\n🎉 All tests passed!' : '\n⚠️  Some tests failed');
    
    return allPassed;
    
  } catch (error) {
    console.error('\n❌ Integration test failed:', error);
    return false;
  } finally {
    if (kernelManager) await kernelManager.destroy();
    if (server) await server.disconnect();
  }
}

testFullIntegration()
  .then(success => process.exit(success ? 0 : 1));

