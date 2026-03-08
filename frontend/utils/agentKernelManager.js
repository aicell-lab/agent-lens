/**
 * Kernel Manager for Agent Panel
 * Manages Python kernel lifecycle and code execution via web-python-kernel,
 * with HyphaCore integration for api.createWindow() support.
 */

import { HyphaCore } from 'hypha-core';
import { loadWebPythonKernel } from './loadWebPythonKernel.js';
import OpenAI from 'openai';

export class AgentKernelManager {
  /**
   * @param {object|null} server - Hypha server (kept for API compatibility)
   * @param {object} options
   * @param {Function} options.onAddWindow - Called when Python calls api.createWindow()
   * @param {object} options.agentSettings - { model, apiKey, baseURL } for default services
   */
  constructor(server, { onAddWindow, agentSettings } = {}) {
    this.server = server;
    this.onAddWindow = onAddWindow;
    this.agentSettings = agentSettings || {};
    this.kernelManager = null;
    this.kernelId = null;
    this.hyphaCore = null;
    this.KernelMode = null;
    this.KernelLanguage = null;
    this.KernelEvents = null;
  }

  async initialize() {
    console.log('[AgentKernelManager] Starting initialization...');

    // --- 1. Initialize HyphaCore (must happen before kernel mounts) ---
    this.hyphaCore = new HyphaCore({
      defaultService: {
        // Vision inspection service
        inspectImages: async (options) => {
          const { agentSettings } = this;
          if (!agentSettings.apiKey) {
            return 'Error: API key not configured.';
          }
          try {
            const openai = new OpenAI({
              apiKey: agentSettings.apiKey,
              baseURL: agentSettings.baseURL,
              dangerouslyAllowBrowser: true,
            });
            const { images = [], query = '', contextDescription = '' } = options;
            const content = [
              { type: 'text', text: `${contextDescription}\n\n${query}` },
              ...images.map(img => ({ type: 'image_url', image_url: { url: img.url } }))
            ];
            const response = await openai.chat.completions.create({
              model: agentSettings.model || 'gpt-4o',
              messages: [{ role: 'user', content }],
              max_tokens: 1024,
            });
            return response.choices[0]?.message?.content || 'No response';
          } catch (error) {
            return `Error: ${error.message}`;
          }
        },

        // Chat completion service
        chatCompletion: async (options) => {
          const { agentSettings } = this;
          if (!agentSettings.apiKey) {
            return 'Error: API key not configured.';
          }
          try {
            const openai = new OpenAI({
              apiKey: agentSettings.apiKey,
              baseURL: agentSettings.baseURL,
              dangerouslyAllowBrowser: true,
            });
            const { messages, max_tokens = 1024, response_format } = options;
            const params = {
              model: agentSettings.model || 'gpt-4o-mini',
              messages,
              max_tokens,
              stream: false,
            };
            if (response_format) {
              params.response_format = response_format;
            }
            const response = await openai.chat.completions.create(params);
            const content = response.choices[0]?.message?.content || 'No response';
            if (response_format && (response_format.type === 'json_object' || response_format.type === 'json_schema')) {
              try { return JSON.parse(content); } catch { return content; }
            }
            return content;
          } catch (error) {
            return `Error: ${error.message}`;
          }
        },
      }
    });

    if (this.onAddWindow) {
      this.hyphaCore.on('add_window', this.onAddWindow);
    }

    await this.hyphaCore.start();
    console.log('[AgentKernelManager] HyphaCore started');

    // --- 2. Load web-python-kernel module ---
    const webPythonKernel = await loadWebPythonKernel();
    const { KernelManager, KernelMode, KernelLanguage, KernelEvents } = webPythonKernel;
    this.KernelMode = KernelMode;
    this.KernelLanguage = KernelLanguage;
    this.KernelEvents = KernelEvents;

    const workerUrl = new URL('kernel.worker.js', document.baseURI).href;
    console.log('[AgentKernelManager] Creating kernel manager with worker:', workerUrl);

    this.kernelManager = new KernelManager({
      allowedKernelTypes: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ],
      interruptionMode: 'auto',
      workerUrl,
      pool: { enabled: false, poolSize: 0, autoRefill: false }
    });

    // --- 3. Create kernel ---
    console.log('[AgentKernelManager] Creating Python kernel...');
    this.kernelId = await this.kernelManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      autoSyncFs: true,
    });
    console.log('[AgentKernelManager] Kernel created:', this.kernelId);

    // --- 4. Mount kernel worker to HyphaCore ---
    const kernel = this.kernelManager.kernels?.[this.kernelId] ||
                   this.kernelManager.getKernel?.(this.kernelId);

    if (kernel?.worker) {
      console.log('[AgentKernelManager] Mounting kernel worker to HyphaCore...');
      const mountPromise = this.hyphaCore.mountWorker(kernel.worker, { passive: true });

      // Run setup_local_client() so Python gets the `api` object
      const setupPromise = this._executePythonRaw(`
import js
import micropip
await micropip.install('hypha-rpc')
from hypha_rpc import setup_local_client

# Start listening for initializeHyphaClient message
rpc_future = setup_local_client()

# Send hyphaClientReady event to trigger initializeHyphaClient message
msg = js.Object.new()
msg.type = "hyphaClientReady"
js.postMessage(msg)

# Wait for the RPC connection to be established
api = await rpc_future
print("HyphaCore api ready - api.createWindow() is now available")
`);

      await Promise.all([mountPromise, setupPromise]);
      console.log('[AgentKernelManager] HyphaCore connection established');
    } else {
      console.warn('[AgentKernelManager] Kernel worker not found - api.createWindow() will not be available');
    }

    console.log('[AgentKernelManager] Kernel initialized successfully:', this.kernelId);
  }

  /**
   * Execute Python code without output callbacks (used internally for setup)
   */
  async _executePythonRaw(code) {
    const stream = this.kernelManager.executeStream(this.kernelId, code);
    for await (const event of stream) {
      if (event.type === 'execute_error' || event.type === 'error') {
        const msg = event.data
          ? `${event.data.ename}: ${event.data.evalue}`
          : 'Execution error';
        console.warn('[AgentKernelManager] Setup execution warning:', msg);
      }
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
              // Priority: HTML > PNG > JPEG > SVG > text/plain
              if (event.data.data['text/html']) {
                const outputItem = {
                  type: 'html',
                  content: event.data.data['text/html'],
                  short_content: '[HTML]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/png']) {
                const outputItem = {
                  type: 'img',
                  content: `data:image/png;base64,${event.data.data['image/png']}`,
                  short_content: '[Image]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/jpeg']) {
                const outputItem = {
                  type: 'img',
                  content: `data:image/jpeg;base64,${event.data.data['image/jpeg']}`,
                  short_content: '[Image]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/svg+xml']) {
                const outputItem = {
                  type: 'html',
                  content: event.data.data['image/svg+xml'],
                  short_content: '[SVG]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['text/plain']) {
                const textPlain = event.data.data['text/plain'];
                if (textPlain && textPlain !== 'None') {
                  const outputItem = {
                    type: 'result',
                    content: textPlain,
                    short_content: textPlain
                  };
                  outputs.push(outputItem);
                  if (onOutput) onOutput(outputItem);
                }
              }
            }
            break;

          case 'display_data':
            if (event.data && event.data.data) {
              // Priority: HTML > PNG > JPEG > SVG > text/plain
              if (event.data.data['text/html']) {
                const outputItem = {
                  type: 'html',
                  content: event.data.data['text/html'],
                  short_content: '[HTML]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/png']) {
                const outputItem = {
                  type: 'img',
                  content: `data:image/png;base64,${event.data.data['image/png']}`,
                  short_content: '[Image]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/jpeg']) {
                const outputItem = {
                  type: 'img',
                  content: `data:image/jpeg;base64,${event.data.data['image/jpeg']}`,
                  short_content: '[Image]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['image/svg+xml']) {
                const outputItem = {
                  type: 'html',
                  content: event.data.data['image/svg+xml'],
                  short_content: '[SVG]'
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              } else if (event.data.data['text/plain']) {
                const plainText = event.data.data['text/plain'];
                const outputItem = {
                  type: 'result',
                  content: plainText,
                  short_content: plainText
                };
                outputs.push(outputItem);
                if (onOutput) onOutput(outputItem);
              }
            }
            break;

          case 'execute_error':
          case 'error': {
            hasError = true;
            const errorMsg = event.data
              ? `${event.data.ename || 'Error'}: ${event.data.evalue || 'Unknown error'}`
              : 'Execution failed';
            const errorItem = {
              type: 'error',
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
      }

      if (onStatus) {
        onStatus(hasError ? 'Error' : 'Completed');
      }

    } catch (error) {
      console.error('[AgentKernelManager] Execution error:', error);
      const errorItem = {
        type: 'error',
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
