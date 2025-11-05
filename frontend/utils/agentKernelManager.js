/**
 * Kernel Manager for Agent Panel
 * Manages Deno kernel lifecycle and Python code execution via Pyodide
 */

export class AgentKernelManager {
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
    
    console.log('[AgentKernelManager] Kernel initialized:', this.kernelId);
  }
  
  async executePython(code, callbacks = {}) {
    if (!this.kernelId || !this.deno) {
      throw new Error('Kernel not initialized');
    }
    
    const { onOutput, onStatus } = callbacks;
    const outputs = [];
    const errors = [];
    
    try {
      const stream = await this.deno.streamExecution({
        kernelId: this.kernelId,
        code
      });
      
      for await (const output of stream) {
        if (output.type === 'stream' && output.data?.text) {
          const outputItem = {
            type: output.data.name === 'stderr' ? 'stderr' : 'stdout',
            content: output.data.text,
            short_content: output.data.text
          };
          outputs.push(outputItem);
          if (onOutput) onOutput(outputItem);
        } else if (output.type === 'execute_result' || output.type === 'display_data') {
          const text = output.data?.data?.['text/plain'] || output.data?.['text/plain'];
          if (text) {
            const outputItem = {
              type: 'stdout',
              content: text,
              short_content: text
            };
            outputs.push(outputItem);
            if (onOutput) onOutput(outputItem);
          }
        } else if (output.type === 'error') {
          const errorText = output.data?.traceback?.join('\n') || output.data?.evalue;
          const outputItem = {
            type: 'stderr',
            content: errorText,
            short_content: errorText
          };
          errors.push(outputItem);
          if (onOutput) onOutput(outputItem);
        } else if (output.type === 'complete') {
          if (onStatus) onStatus('Completed');
        }
      }
      
      if (onStatus && errors.length === 0) {
        onStatus('Completed');
      } else if (onStatus && errors.length > 0) {
        onStatus('Error');
      }
      
    } catch (error) {
      console.error('[AgentKernelManager] Execution error:', error);
      const errorItem = {
        type: 'stderr',
        content: error.message,
        short_content: error.message
      };
      errors.push(errorItem);
      if (onOutput) onOutput(errorItem);
      if (onStatus) onStatus('Error');
      throw error;
    }
    
    return { outputs, errors };
  }
  
  async destroy() {
    if (this.kernelId && this.deno) {
      try {
        await this.deno.destroyKernel({ kernelId: this.kernelId });
        console.log('[AgentKernelManager] Kernel destroyed:', this.kernelId);
      } catch (error) {
        console.error('[AgentKernelManager] Error destroying kernel:', error);
      }
      this.kernelId = null;
    }
  }
}

