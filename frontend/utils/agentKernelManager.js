/**
 * Kernel Manager for Agent Panel
 * Manages Python kernel lifecycle and code execution via web-python-kernel
 */

import { loadWebPythonKernel } from './loadWebPythonKernel.js';

export class AgentKernelManager {
  constructor(server) {
    this.server = server; // Keep for API compatibility but won't be used
    this.kernelManager = null;
    this.kernelId = null;
    this.KernelMode = null;
    this.KernelLanguage = null;
    this.KernelEvents = null;
  }
  
  async initialize() {
    console.log('[AgentKernelManager] Starting initialization...');
    
    // Load web-python-kernel module
    const webPythonKernel = await loadWebPythonKernel();
    
    console.log('[AgentKernelManager] Extracting KernelManager from web-python-kernel');
    const { KernelManager, KernelMode, KernelLanguage, KernelEvents } = webPythonKernel;
    
    // Store for later use
    this.KernelMode = KernelMode;
    this.KernelLanguage = KernelLanguage;
    this.KernelEvents = KernelEvents;

    // Create kernel manager with local worker URL
    // Use relative URL construction to work in both dev and production
    const workerUrl = new URL('kernel.worker.js', document.baseURI).href;

    console.log('[AgentKernelManager] Creating kernel manager with worker:', workerUrl);
    console.log('[AgentKernelManager] Document base URI:', document.baseURI);
    this.kernelManager = new KernelManager({
      allowedKernelTypes: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ],
      interruptionMode: 'auto',
      workerUrl, // Use local worker file to avoid CORS issues
      pool: {
        enabled: false,
        poolSize: 0,
        autoRefill: false
      }
    });

    // Create a new kernel
    console.log('[AgentKernelManager] Creating Python kernel...');
    try {
      this.kernelId = await this.kernelManager.createKernel({
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON,
        autoSyncFs: true,
      });
      console.log('[AgentKernelManager] Kernel initialized successfully:', this.kernelId);
    } catch (error) {
      console.error('[AgentKernelManager] Failed to create kernel:', error);
      throw error;
    }
  }
  
  async executePython(code, callbacks = {}) {
    if (!this.kernelId || !this.kernelManager) {
      throw new Error('Kernel not initialized');
    }
    
    const { onOutput, onStatus } = callbacks;
    const outputs = [];
    const errors = [];
    let hasError = false;
    
    try {
      const stream = this.kernelManager.executeStream(this.kernelId, code);
      
      for await (const event of stream) {
        // Handle different event types
        switch (event.type) {
          case 'stream':
            if (event.data.name === 'stdout') {
              const outputItem = {
                type: 'stdout',
                content: event.data.text,
                short_content: event.data.text
              };
              outputs.push(outputItem);
              if (onOutput) onOutput(outputItem);
            } else if (event.data.name === 'stderr') {
              const outputItem = {
                type: 'stderr',
                content: event.data.text,
                short_content: event.data.text
              };
              errors.push(outputItem);
              if (onOutput) onOutput(outputItem);
            }
            break;

          case 'execute_result':
            if (event.data && event.data.data) {
              const textPlain = event.data.data['text/plain'];
              
              // Don't display None results (standard Jupyter behavior)
              if (textPlain && textPlain !== 'None') {
                const outputItem = {
                  type: 'stdout',
                  content: textPlain,
                  short_content: textPlain
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              }
            }
            break;

          case 'display_data':
            if (event.data && event.data.data) {
              if (event.data.data['image/png']) {
                const outputItem = {
                  type: 'stdout',
                  content: `data:image/png;base64,${event.data.data['image/png']}`,
                  short_content: '[Image]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['text/html']) {
                const outputItem = {
                  type: 'stdout',
                  content: event.data.data['text/html'],
                  short_content: '[HTML]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['text/plain']) {
                const plainText = event.data.data['text/plain'];
                const outputItem = {
                  type: 'stdout',
                  content: plainText,
                  short_content: plainText
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              }
            }
            break;

          case 'execute_error':
          case 'error':
            hasError = true;
            const errorMsg = event.data
              ? `${event.data.ename || 'Error'}: ${event.data.evalue || 'Unknown error'}`
              : 'Execution failed';
            const errorItem = {
              type: 'stderr',
              content: errorMsg,
              short_content: errorMsg
            };
            errors.push(errorItem);
            if (onOutput) onOutput(errorItem);
            
            if (event.data && event.data.traceback) {
              event.data.traceback.forEach((line) => {
                const traceItem = {
                  type: 'stderr',
                  content: line,
                  short_content: line
                };
                errors.push(traceItem);
                if (onOutput) onOutput(traceItem);
              });
            }
            break;
        }
      }
      
      if (onStatus) {
        if (hasError) {
          onStatus('Error');
        } else {
          onStatus('Completed');
        }
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
    if (this.kernelId && this.kernelManager) {
      try {
        await this.kernelManager.destroyKernel(this.kernelId);
        console.log('[AgentKernelManager] Kernel destroyed:', this.kernelId);
      } catch (error) {
        console.error('[AgentKernelManager] Error destroying kernel:', error);
      }
      this.kernelId = null;
    }
  }
}
