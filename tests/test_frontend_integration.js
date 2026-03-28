#!/usr/bin/env node

/**
 * Frontend Integration Test for ArtifactZarrLoader
 * 
 * This test verifies that the ArtifactZarrLoader can be properly imported
 * and used in a frontend-like environment, simulating how it would be used
 * in the MicroscopeMapDisplay component.
 */

import ArtifactZarrLoader from '../frontend/utils/artifactZarrLoader.js';

console.log('🔬 Frontend Integration Test for ArtifactZarrLoader');
console.log('============================================================');

const simulationZarrEndpoint = process.env.SIMULATION_ZARR_ENDPOINT || null;

async function testFrontendIntegration() {
  try {
    // Test 1: Import and instantiation
    console.log('🧪 Test 1: Import and Instantiation');
    const loader = new ArtifactZarrLoader(simulationZarrEndpoint);
    console.log('✅ ArtifactZarrLoader imported and instantiated successfully');
    
    // Test 2: Check if methods exist (simulating React component usage)
    console.log('🧪 Test 2: Method Availability');
    const requiredMethods = [
      'loadRegion',
      'getMultipleWellRegionsRealTimeCancellable',
      'clearCaches',
      'resetState',
      'cancelActiveRequests',
      'configure',
      'setBaseUrl',
      'getImageExtent',
      'openArray'
    ];
    
    for (const method of requiredMethods) {
      if (typeof loader[method] === 'function') {
        console.log(`✅ Method '${method}' is available`);
      } else {
        console.log(`❌ Method '${method}' is missing`);
        return false;
      }
    }
    
    // Test 3: Simulate React component lifecycle
    console.log('🧪 Test 3: React Component Lifecycle Simulation');
    
    // Simulate component mount
    console.log('📱 Simulating component mount...');
    const loaderRef = { current: loader };
    console.log('✅ Loader reference created');
    
    // Simulate component unmount cleanup
    console.log('📱 Simulating component unmount...');
    if (loaderRef.current) {
      loaderRef.current.clearCaches();
      loaderRef.current.cancelActiveRequests();
      loaderRef.current = null;
    }
    console.log('✅ Cleanup completed');
    
    // Test 4: Test basic functionality
    console.log('🧪 Test 4: Basic Functionality Test');
    const newLoader = new ArtifactZarrLoader();
    newLoader.setBaseUrl('https://example.test/simulation-zarr/');
    console.log(`✅ Base URL configured: ${newLoader.baseUrl}`);
    newLoader.resetState();
    console.log('✅ Loader reset without errors');

    if (simulationZarrEndpoint) {
      console.log(`🌐 Optional metadata test enabled via SIMULATION_ZARR_ENDPOINT=${simulationZarrEndpoint}`);
      await newLoader.configure(simulationZarrEndpoint, { forceReload: true });

      const extent = newLoader.getImageExtent();
      console.log(`✅ Image extent: X[${extent.xMin}, ${extent.xMax}]mm, Y[${extent.yMin}, ${extent.yMax}]mm`);

      const dims = newLoader.getImageDimensions(0);
      console.log(`✅ Image dimensions at scale 0: ${dims.x}×${dims.y} pixels`);

      const pixelSize = newLoader.getPixelSize(0);
      console.log(`✅ Pixel size at scale 0: ${pixelSize.toFixed(3)} µm/pixel`);
    } else {
      console.log('ℹ️ Skipping remote metadata fetch (set SIMULATION_ZARR_ENDPOINT to enable it)');
    }
    
    // Note: We skip actual data loading in Node.js environment since it requires DOM APIs (canvas, document).
    console.log('✅ Basic functionality tests completed (data loading requires browser environment)');
    
    // Cleanup
    newLoader.clearCaches();
    newLoader.cancelActiveRequests();
    
    console.log('\n📊 Frontend Integration Test Results');
    console.log('============================================================');
    console.log('✅ All integration tests passed!');
    console.log('✅ ArtifactZarrLoader is ready for frontend integration');
    console.log('✅ React component lifecycle simulation successful');
    console.log('✅ Method availability verified');
    console.log('✅ Basic functionality verified');
    
    return true;
    
  } catch (error) {
    console.error('❌ Frontend integration test failed:', error);
    return false;
  }
}

// Run the test
testFrontendIntegration().then(success => {
  process.exit(success ? 0 : 1);
});
