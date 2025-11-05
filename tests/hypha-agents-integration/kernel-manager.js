export class KernelManager {
  constructor(server) {
    this.server = server;
    this.deno = null;
    this.kernelId = null;
  }
  
  async initialize() {
    // Get Deno service that hosts Pyodide
    this.deno = await this.server.getService('hypha-agents/deno-app-engine', {
      mode: 'select:min:getEngineLoad'
    });
    
    // Create Python kernel
    const kernelInfo = await this.deno.createKernel({});
    this.kernelId = kernelInfo.kernelId || kernelInfo.id;
  }
  
  async executePython(code) {
    if (!this.kernelId || !this.deno) {
      throw new Error('Kernel not initialized');
    }
    
    const outputs = [];
    const errors = [];
    
    const stream = await this.deno.streamExecution({
      kernelId: this.kernelId,
      code
    });
    
    for await (const output of stream) {
      if (output.type === 'stream' && output.data?.text) {
        outputs.push(output.data.text);
      } else if (output.type === 'execute_result' || output.type === 'display_data') {
        const text = output.data?.data?.['text/plain'] || output.data?.['text/plain'];
        if (text) outputs.push(text);
      } else if (output.type === 'error') {
        const errorText = output.data?.traceback?.join('\n') || output.data?.evalue;
        errors.push(errorText);
      }
    }
    
    return { outputs, errors };
  }
  
  async destroy() {
    if (this.kernelId && this.deno) {
      await this.deno.destroyKernel({ kernelId: this.kernelId });
      this.kernelId = null;
    }
  }
}

