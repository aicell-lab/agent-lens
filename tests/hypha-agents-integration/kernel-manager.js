/**
 * Kernel Manager for Testing
 * Manages Python kernel lifecycle and code execution via web-python-kernel
 */

import { loadWebPythonKernel } from '../../frontend/utils/loadWebPythonKernel.js';

export class KernelManager {
  constructor(server) {
    this.server = server; // Keep for API compatibility but won't be used
    this.kernelManager = null;
    this.kernelId = null;
    this.KernelMode = null;
    this.KernelLanguage = null;
    this.KernelEvents = null;
  }
  
  async initialize() {
    // Load web-python-kernel module
    const webPythonKernel = await loadWebPythonKernel();
    
    const { KernelManager, KernelMode, KernelLanguage, KernelEvents } = webPythonKernel;
    
    // Store for later use
    this.KernelMode = KernelMode;
    this.KernelLanguage = KernelLanguage;
    this.KernelEvents = KernelEvents;

    // Create kernel manager with local worker URL
    // Use relative URL construction to work in both dev and production
    const workerUrl = new URL('kernel.worker.js', document.baseURI).href;

    console.log('[KernelManager] Creating kernel manager with worker:', workerUrl);
    console.log('[KernelManager] Document base URI:', document.baseURI);
    this.kernelManager = new KernelManager({
      allowedKernelTypes: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ],
      interruptionMode: 'auto',
      workerUrl,
      pool: {
        enabled: false,
        poolSize: 0,
        autoRefill: false
      }
    });

    // Create a new kernel
    this.kernelId = await this.kernelManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      autoSyncFs: true,
    });

    console.log('[KernelManager] Kernel initialized:', this.kernelId);
  }
  
  async executePython(code) {
    if (!this.kernelId || !this.kernelManager) {
      throw new Error('Kernel not initialized');
    }
    
    const outputs = [];
    const errors = [];
    
    const stream = this.kernelManager.executeStream(this.kernelId, code);
    
    for await (const event of stream) {
      if (event.type === 'stream' && event.data?.text) {
        outputs.push(event.data.text);
      } else if (event.type === 'execute_result' || event.type === 'display_data') {
        const text = event.data?.data?.['text/plain'] || event.data?.['text/plain'];
        if (text) outputs.push(text);
      } else if (event.type === 'error' || event.type === 'execute_error') {
        const errorText = event.data?.traceback?.join('\n') || event.data?.evalue;
        errors.push(errorText);
      }
    }
    
    return { outputs, errors };
  }
  
  async destroy() {
    if (this.kernelId && this.kernelManager) {
      await this.kernelManager.destroyKernel(this.kernelId);
      this.kernelId = null;
    }
  }
}
