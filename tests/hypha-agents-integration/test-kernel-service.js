import { hyphaWebsocketClient } from 'hypha-rpc';
import dotenv from 'dotenv';

dotenv.config();

async function testKernelService() {
  console.log('🐍 Testing Deno Kernel Service (Python Execution)...\n');
  
  const server = await hyphaWebsocketClient.connectToServer({
    server_url: process.env.HYPHA_SERVER_URL || 'https://hypha.aicell.io',
    token: process.env.WORKSPACE_TOKEN
  });
  
  try {
    // Get Deno service that hosts Pyodide
    console.log('   Getting deno-app-engine service...');
    const deno = await server.getService('hypha-agents/deno-app-engine', {
      mode: 'select:min:getEngineLoad'
    });
    console.log('   ✓ Service obtained');
    
    // Create Python kernel
    console.log('   Creating Pyodide kernel...');
    const kernelInfo = await deno.createKernel({});
    const kernelId = kernelInfo.kernelId || kernelInfo.id;
    console.log('   ✓ Kernel created:', kernelId);
    
    // Execute Python code (microscopy example)
    const pythonCode = `
import sys
print(f"Python version: {sys.version}")
print("Hello from Pyodide!")

# Simulate microscope calculation
stage_position = {"x": 10.5, "y": 20.3, "z": 5.1}
print(f"Stage position: {stage_position}")

result = sum(stage_position.values())
print(f"Sum of coordinates: {result:.2f}")
    `.trim();
    
    console.log('\n   Executing Python code...');
    console.log('   Code:', pythonCode.substring(0, 50) + '...');
    
    const outputs = [];
    const stream = await deno.streamExecution({ kernelId, code: pythonCode });
    
    for await (const output of stream) {
      if (output.type === 'stream' && output.data?.text) {
        outputs.push(output.data.text);
        console.log('   Output:', output.data.text.trim());
      } else if (output.type === 'error') {
        const error = output.data?.traceback?.join('\n') || output.data?.evalue;
        throw new Error(error);
      }
    }
    
    // Cleanup
    console.log('\n   Cleaning up kernel...');
    await deno.destroyKernel({ kernelId });
    
    console.log('\n✅ Python execution test passed!');
    return true;
    
  } catch (error) {
    console.error('\n❌ Kernel test failed:', error);
    return false;
  } finally {
    await server.disconnect();
  }
}

testKernelService()
  .then(success => process.exit(success ? 0 : 1));

