/**
 * Utility to load web-python-kernel module and make it globally available
 */

let loadingPromise = null;

export async function loadWebPythonKernel() {
  // Return existing promise if already loading
  if (loadingPromise) {
    return loadingPromise;
  }

  // Check if already loaded
  if (window.WebPythonKernel) {
    console.log('[loadWebPythonKernel] Already loaded');
    return window.WebPythonKernel;
  }

  console.log('[loadWebPythonKernel] Starting to load web-python-kernel.mjs...');

  // Create and cache the loading promise
  loadingPromise = (async () => {
    try {
      // Construct URL relative to the document base
      // This works in both dev (http://localhost:5173/) and production (https://hypha.aicell.io/agent-lens/)
      const modulePath = new URL('web-python-kernel.mjs', document.baseURI).href;
      
      console.log('[loadWebPythonKernel] Loading from:', modulePath);
      console.log('[loadWebPythonKernel] Document base URI:', document.baseURI);
      
      const module = await import(/* @vite-ignore */ modulePath);
      
      console.log('[loadWebPythonKernel] Module loaded successfully');
      
      // Make it globally available
      window.WebPythonKernel = module;
      
      // Dispatch event for compatibility
      window.dispatchEvent(new Event('web-python-kernel-loaded'));
      
      return module;
    } catch (error) {
      console.error('[loadWebPythonKernel] Failed to load:', error);
      loadingPromise = null; // Reset so it can be retried
      throw error;
    }
  })();

  return loadingPromise;
}

