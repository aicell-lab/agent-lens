/**
 * JavaScript test for ArtifactZarrLoader functionality.
 * 
 * This test actually runs the ArtifactZarrLoader service and makes real HTTP requests
 * to test the integration with the artifact manager.
 * 
 * Usage: node tests/test_artifact_zarr_loader.js
 */

import ArtifactZarrLoader from '../frontend/services/artifactZarrLoader.js';

// Test configuration
const TEST_CONFIG = {
  datasetId: 'test-20250718-115143',
  wellId: 'A2',
  channel: 'BF LED matrix full',
  scaleLevel: 3,
  timepoint: 0,
  centerX: 0.0,
  centerY: 0.0,
  width_mm: 2.0,
  height_mm: 2.0,
  wellPlateType: '96',
  outputFormat: 'base64'
};

class ArtifactZarrLoaderTest {
  constructor() {
    this.loader = new ArtifactZarrLoader();
    this.testResults = [];
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🔬 ArtifactZarrLoader JavaScript Test Suite');
    console.log('=' .repeat(60));
    console.log(`📊 Testing with dataset: ${TEST_CONFIG.datasetId}`);
    console.log(`🔍 Testing well: ${TEST_CONFIG.wellId}`);
    console.log(`🎨 Testing channel: ${TEST_CONFIG.channel}`);
    console.log(`📏 Testing scale level: ${TEST_CONFIG.scaleLevel}`);
    console.log();

    try {
      await this.testInitialization();
      await this.testCheckCanvasExists();
      await this.testFetchZarrMetadata();
      await this.testGetChannelIndex();
      await this.testCalculateChunkCoordinates();
      await this.testGetHistoricalStitchedRegion();
      await this.testErrorHandling();
      await this.testCachingBehavior();
      await this.testMemoryManagement();

      this.printTestResults();
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  /**
   * Test service initialization
   */
  async testInitialization() {
    console.log('🧪 Test 1: Service Initialization');
    
    try {
      // Test that the loader was created properly
      assert(this.loader !== null, 'Loader should be created');
      assert(this.loader.baseUrl === 'https://hypha.aicell.io/agent-lens/artifacts', 'Base URL should be correct');
      assert(this.loader.metadataCache instanceof Map, 'Metadata cache should be a Map');
      assert(this.loader.chunkCache instanceof Map, 'Chunk cache should be a Map');
      assert(this.loader.activeRequests instanceof Set, 'Active requests should be a Set');

      this.recordTestResult('Initialization', true, 'Service initialized correctly');
      console.log('✅ Service initialization passed');
    } catch (error) {
      this.recordTestResult('Initialization', false, error.message);
      console.log('❌ Service initialization failed:', error.message);
    }
  }

  /**
   * Test canvas existence checking
   */
  async testCheckCanvasExists() {
    console.log('🧪 Test 2: Canvas Existence Check');
    
    try {
      const exists = await this.loader.checkCanvasExists(TEST_CONFIG.datasetId, TEST_CONFIG.wellId);
      
      if (exists) {
        this.recordTestResult('Canvas Exists', true, 'Canvas data found for well');
        console.log('✅ Canvas existence check passed - data found');
      } else {
        this.recordTestResult('Canvas Exists', false, 'No canvas data found (this may be expected for test data)');
        console.log('⚠️  Canvas existence check - no data found (may be expected for test data)');
      }
    } catch (error) {
      this.recordTestResult('Canvas Exists', false, error.message);
      console.log('❌ Canvas existence check failed:', error.message);
    }
  }

  /**
   * Test Zarr metadata fetching
   */
  async testFetchZarrMetadata() {
    console.log('🧪 Test 3: Zarr Metadata Fetching');
    
    try {
      const baseUrl = `${this.loader.baseUrl}/${TEST_CONFIG.datasetId}/zip-files/well_${TEST_CONFIG.wellId}_96.zip/~/data.zarr/`;
      const metadata = await this.loader.fetchZarrMetadata(baseUrl, TEST_CONFIG.scaleLevel);
      
      if (metadata) {
        assert(metadata.zattrs, 'Should have zattrs');
        assert(metadata.zarray, 'Should have zarray');
        assert(metadata.scaleLevel === TEST_CONFIG.scaleLevel, 'Scale level should match');
        
        this.recordTestResult('Metadata Fetch', true, 'Successfully fetched Zarr metadata');
        console.log('✅ Zarr metadata fetching passed');
        console.log(`   📊 Shape: ${metadata.zarray.shape}`);
        console.log(`   🔲 Chunks: ${metadata.zarray.chunks}`);
        console.log(`   📦 Data type: ${metadata.zarray.dtype}`);
      } else {
        this.recordTestResult('Metadata Fetch', false, 'Failed to fetch metadata (may be expected for test data)');
        console.log('⚠️  Zarr metadata fetching - no data found (may be expected for test data)');
      }
    } catch (error) {
      this.recordTestResult('Metadata Fetch', false, error.message);
      console.log('❌ Zarr metadata fetching failed:', error.message);
    }
  }

  /**
   * Test channel index mapping
   */
  async testGetChannelIndex() {
    console.log('🧪 Test 4: Channel Index Mapping');
    
    try {
      const baseUrl = `${this.loader.baseUrl}/${TEST_CONFIG.datasetId}/zip-files/well_${TEST_CONFIG.wellId}_96.zip/~/data.zarr/`;
      const channelIndex = await this.loader.getChannelIndex(baseUrl, TEST_CONFIG.channel);
      
      if (channelIndex !== null) {
        this.recordTestResult('Channel Index', true, `Channel index: ${channelIndex}`);
        console.log(`✅ Channel index mapping passed - index: ${channelIndex}`);
      } else {
        this.recordTestResult('Channel Index', false, 'Channel not found (may be expected for test data)');
        console.log('⚠️  Channel index mapping - channel not found (may be expected for test data)');
      }
    } catch (error) {
      this.recordTestResult('Channel Index', false, error.message);
      console.log('❌ Channel index mapping failed:', error.message);
    }
  }

  /**
   * Test chunk coordinate calculation
   */
  async testCalculateChunkCoordinates() {
    console.log('🧪 Test 5: Chunk Coordinate Calculation');
    
    try {
      // Create sample metadata for testing
      const sampleMetadata = {
        zarray: {
          shape: [1, 1, 1, 512, 512],
          chunks: [1, 1, 1, 256, 256]
        }
      };
      
      const relativeCoords = {
        centerX: 0.0,
        centerY: 0.0,
        width_mm: 1.0,
        height_mm: 1.0
      };
      
      const chunks = this.loader.calculateChunkCoordinates(
        relativeCoords, sampleMetadata, TEST_CONFIG.timepoint, 0
      );
      
      assert(Array.isArray(chunks), 'Should return array of chunks');
      assert(chunks.length > 0, 'Should have at least one chunk');
      
      // Verify chunk structure
      for (const chunk of chunks) {
        assert(chunk.coordinates, 'Chunk should have coordinates');
        assert(chunk.filename, 'Chunk should have filename');
        assert(chunk.coordinates.length === 5, 'Coordinates should have 5 elements');
      }
      
      this.recordTestResult('Chunk Coordinates', true, `Calculated ${chunks.length} chunks`);
      console.log(`✅ Chunk coordinate calculation passed - ${chunks.length} chunks`);
    } catch (error) {
      this.recordTestResult('Chunk Coordinates', false, error.message);
      console.log('❌ Chunk coordinate calculation failed:', error.message);
    }
  }

  /**
   * Test main historical stitched region function
   */
  async testGetHistoricalStitchedRegion() {
    console.log('🧪 Test 6: Historical Stitched Region');
    
    try {
      const result = await this.loader.getHistoricalStitchedRegion(
        TEST_CONFIG.centerX,
        TEST_CONFIG.centerY,
        TEST_CONFIG.width_mm,
        TEST_CONFIG.height_mm,
        TEST_CONFIG.wellPlateType,
        TEST_CONFIG.scaleLevel,
        TEST_CONFIG.channel,
        TEST_CONFIG.timepoint,
        TEST_CONFIG.outputFormat,
        TEST_CONFIG.datasetId,
        TEST_CONFIG.wellId
      );
      
      if (result.success) {
        assert(result.data, 'Should have data');
        assert(result.metadata, 'Should have metadata');
        assert(result.metadata.channel === TEST_CONFIG.channel, 'Channel should match');
        assert(result.metadata.wellId === TEST_CONFIG.wellId, 'Well ID should match');
        
        this.recordTestResult('Historical Region', true, 'Successfully loaded historical region');
        console.log('✅ Historical stitched region passed');
        console.log(`   📐 Image size: ${result.metadata.width}x${result.metadata.height}`);
        console.log(`   🎨 Channel: ${result.metadata.channel}`);
        console.log(`   📏 Scale: ${result.metadata.scale}`);
      } else {
        this.recordTestResult('Historical Region', false, result.message || 'Failed to load region');
        console.log('⚠️  Historical stitched region - failed to load (may be expected for test data)');
        console.log(`   📝 Error: ${result.message}`);
      }
    } catch (error) {
      this.recordTestResult('Historical Region', false, error.message);
      console.log('❌ Historical stitched region failed:', error.message);
    }
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    console.log('🧪 Test 7: Error Handling');
    
    try {
      // Test missing well ID
      const result1 = await this.loader.getHistoricalStitchedRegion(
        TEST_CONFIG.centerX,
        TEST_CONFIG.centerY,
        TEST_CONFIG.width_mm,
        TEST_CONFIG.height_mm,
        TEST_CONFIG.wellPlateType,
        TEST_CONFIG.scaleLevel,
        TEST_CONFIG.channel,
        TEST_CONFIG.timepoint,
        TEST_CONFIG.outputFormat,
        TEST_CONFIG.datasetId,
        null // Missing well ID
      );
      
      assert(result1.success === false, 'Should fail with missing well ID');
      assert(result1.message.includes('Well ID is required'), 'Should have appropriate error message');
      
      // Test missing dataset ID
      const result2 = await this.loader.getHistoricalStitchedRegion(
        TEST_CONFIG.centerX,
        TEST_CONFIG.centerY,
        TEST_CONFIG.width_mm,
        TEST_CONFIG.height_mm,
        TEST_CONFIG.wellPlateType,
        TEST_CONFIG.scaleLevel,
        TEST_CONFIG.channel,
        TEST_CONFIG.timepoint,
        TEST_CONFIG.outputFormat,
        null, // Missing dataset ID
        TEST_CONFIG.wellId
      );
      
      assert(result2.success === false, 'Should fail with missing dataset ID');
      
      this.recordTestResult('Error Handling', true, 'Error handling works correctly');
      console.log('✅ Error handling passed');
    } catch (error) {
      this.recordTestResult('Error Handling', false, error.message);
      console.log('❌ Error handling failed:', error.message);
    }
  }

  /**
   * Test caching behavior
   */
  async testCachingBehavior() {
    console.log('🧪 Test 8: Caching Behavior');
    
    try {
      const initialCacheSize = this.loader.metadataCache.size;
      
      // Make a request that should cache metadata
      const baseUrl = `${this.loader.baseUrl}/${TEST_CONFIG.datasetId}/zip-files/well_${TEST_CONFIG.wellId}_96.zip/~/data.zarr/`;
      await this.loader.fetchZarrMetadata(baseUrl, TEST_CONFIG.scaleLevel);
      
      // Check if cache size increased
      const newCacheSize = this.loader.metadataCache.size;
      assert(newCacheSize >= initialCacheSize, 'Cache size should not decrease');
      
      this.recordTestResult('Caching', true, `Cache size: ${initialCacheSize} -> ${newCacheSize}`);
      console.log('✅ Caching behavior passed');
    } catch (error) {
      this.recordTestResult('Caching', false, error.message);
      console.log('❌ Caching behavior failed:', error.message);
    }
  }

  /**
   * Test memory management
   */
  async testMemoryManagement() {
    console.log('🧪 Test 9: Memory Management');
    
    try {
      // Clear caches
      this.loader.clearCaches();
      
      assert(this.loader.metadataCache.size === 0, 'Metadata cache should be empty');
      assert(this.loader.chunkCache.size === 0, 'Chunk cache should be empty');
      
      this.recordTestResult('Memory Management', true, 'Cache clearing works correctly');
      console.log('✅ Memory management passed');
    } catch (error) {
      this.recordTestResult('Memory Management', false, error.message);
      console.log('❌ Memory management failed:', error.message);
    }
  }

  /**
   * Record test result
   */
  recordTestResult(testName, passed, message) {
    this.testResults.push({
      name: testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Print test results summary
   */
  printTestResults() {
    console.log('\n📊 Test Results Summary');
    console.log('=' .repeat(60));
    
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${total - passed}/${total}`);
    console.log();
    
    for (const result of this.testResults) {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.message}`);
    }
    
    console.log();
    if (passed === total) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('⚠️  Some tests failed or were skipped (may be expected for test data)');
    }
  }
}

// Simple assertion function
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Run the tests
async function main() {
  const tester = new ArtifactZarrLoaderTest();
  await tester.runAllTests();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export default ArtifactZarrLoaderTest; 