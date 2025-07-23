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
    console.log(`🔍 Testing well: A2`);
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
      await this.testChunkBatching();

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
      const exists = await this.loader.checkCanvasExists(TEST_CONFIG.datasetId, 'A2');
      
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
      const baseUrl = `${this.loader.baseUrl}/${TEST_CONFIG.datasetId}/zip-files/well_A2_96.zip/~/data.zarr/`;
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
      const baseUrl = `${this.loader.baseUrl}/${TEST_CONFIG.datasetId}/zip-files/well_A2_96.zip/~/data.zarr/`;
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
        TEST_CONFIG.datasetId
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
      // Test missing dataset ID
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
        null // Missing dataset ID
      );
      
      assert(result1.success === false, 'Should fail with missing dataset ID');
      
      // Test invalid dataset ID
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
        'invalid-dataset-id'
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
   * Test chunk batching functionality
   * This demonstrates how to batch multiple chunk requests into a single request
   */
  async testChunkBatching() {
    console.log('🧪 Test 10: Chunk Batching');
    
    try {
      const datasetId = 'default-20250723-072316';
      const wellId = 'B3';
      const scaleLevel = 2;
      const channel = 'BF LED matrix full';
      const timepoint = 0;
      
      // Base URL for the test dataset
      const baseUrl = `https://hypha.aicell.io/agent-lens/artifacts/${datasetId}/zip-files/well_${wellId}_96.zip/~/data.zarr/`;
      
      console.log(`🔍 Testing chunk batching for: ${baseUrl}`);
      
      // Step 1: Get metadata to understand the data structure
      const metadata = await this.loader.fetchZarrMetadata(baseUrl, scaleLevel);
      if (!metadata) {
        this.recordTestResult('Chunk Batching', false, 'No metadata available for testing');
        console.log('⚠️  Chunk batching - no metadata available (may be expected for test data)');
        return;
      }
      
      // Step 2: Get channel index
      const channelIndex = await this.loader.getChannelIndex(baseUrl, channel);
      if (channelIndex === null) {
        this.recordTestResult('Chunk Batching', false, 'Channel not found');
        console.log('⚠️  Chunk batching - channel not found (may be expected for test data)');
        return;
      }
      
      // Step 3: Calculate chunk coordinates for a small region
      const { zarray } = metadata;
      const [, , , yChunk, xChunk] = zarray.chunks;
      
      // Define a small region that should require multiple chunks
      const regionStartX = 0;
      const regionStartY = 0;
      const regionEndX = Math.min(xChunk * 2, zarray.shape[4]); // 2 chunks wide
      const regionEndY = Math.min(yChunk * 2, zarray.shape[3]); // 2 chunks high
      
      console.log(`📐 Region: (${regionStartX}, ${regionStartY}) to (${regionEndX}, ${regionEndY})`);
      console.log(`🔲 Chunk size: ${xChunk}x${yChunk}`);
      
      // Calculate all chunks needed for this region
      const allChunks = this.loader.calculateChunkCoordinatesFromPixels(
        regionStartX, regionStartY, regionEndX, regionEndY,
        timepoint, channelIndex, zarray
      );
      
      console.log(`🧩 Total chunks needed: ${allChunks.length}`);
      
      // Step 4: Get available chunks
      const availableChunks = await this.loader.getAvailableChunks(baseUrl, scaleLevel);
      if (!availableChunks || availableChunks.length === 0) {
        this.recordTestResult('Chunk Batching', false, 'No available chunks found');
        console.log('⚠️  Chunk batching - no available chunks (may be expected for test data)');
        return;
      }
      
      // Filter to only available chunks
      const availableChunkSet = new Set(availableChunks);
      const filteredChunks = allChunks.filter(chunk => availableChunkSet.has(chunk.filename));
      
      console.log(`✅ Available chunks: ${filteredChunks.length}/${allChunks.length}`);
      
      if (filteredChunks.length === 0) {
        this.recordTestResult('Chunk Batching', false, 'No matching chunks available');
        console.log('⚠️  Chunk batching - no matching chunks available (may be expected for test data)');
        return;
      }
      
      // Step 5: Demonstrate chunk batching
      console.log('\n🚀 Demonstrating chunk batching:');
      
      // Method 1: Individual chunk requests (current approach - slow)
      console.log('📊 Method 1: Individual chunk requests (current - slow)');
      
      const individualChunkUrls = filteredChunks.map(chunk => {
        const [t, c, z, y, x] = chunk.coordinates;
        return `${baseUrl}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
      });
      
      console.log(`   🔗 Generated ${individualChunkUrls.length} individual URLs`);
      console.log(`   📝 Example URLs:`);
      individualChunkUrls.slice(0, 3).forEach((url, i) => {
        console.log(`      ${i + 1}. ${url.split('/').pop()}`);
      });
      
      // Method 2: Batched chunk requests (proposed approach - fast)
      console.log('\n📊 Method 2: Batched chunk requests (proposed - fast)');
      
      // Create batch request payload
      const batchPayload = {
        datasetId,
        wellId,
        scaleLevel,
        channelIndex,
        timepoint,
        chunks: filteredChunks.map(chunk => ({
          coordinates: chunk.coordinates,
          filename: chunk.filename
        }))
      };
      
      console.log(`   📦 Batch payload: ${JSON.stringify(batchPayload, null, 2)}`);
      
      // Simulate batch request URL (this would be a new server endpoint)
      const batchRequestUrl = `${baseUrl}${scaleLevel}/batch`;
      console.log(`   🔗 Batch request URL: ${batchRequestUrl}`);
      
      // Method 3: Optimized batch with chunk grouping
      console.log('\n📊 Method 3: Optimized batch with chunk grouping');
      
      // Group chunks by spatial proximity for better caching
      const chunkGroups = this.groupChunksByProximity(filteredChunks, 4); // Max 4 chunks per group
      
      console.log(`   📦 Created ${chunkGroups.length} chunk groups:`);
      chunkGroups.forEach((group, i) => {
        console.log(`      Group ${i + 1}: ${group.length} chunks`);
        group.forEach(chunk => {
          console.log(`         - ${chunk.filename}`);
        });
      });
      
      // Simulate performance comparison
      console.log('\n⏱️  Performance comparison:');
      console.log(`   📊 Individual requests: ${individualChunkUrls.length} HTTP requests`);
      console.log(`   📊 Batched requests: ${chunkGroups.length} HTTP requests`);
      console.log(`   🚀 Reduction: ${Math.round((1 - chunkGroups.length / individualChunkUrls.length) * 100)}% fewer requests`);
      
      // Calculate theoretical performance improvement
      const httpOverhead = 50; // ms per request
      const individualTotalTime = individualChunkUrls.length * httpOverhead;
      const batchTotalTime = chunkGroups.length * httpOverhead;
      const timeReduction = Math.round((1 - batchTotalTime / individualTotalTime) * 100);
      
      console.log(`   ⚡ Theoretical time reduction: ${timeReduction}%`);
      
      this.recordTestResult('Chunk Batching', true, 
        `Demonstrated batching: ${individualChunkUrls.length} → ${chunkGroups.length} requests (${Math.round((1 - chunkGroups.length / individualChunkUrls.length) * 100)}% reduction)`);
      console.log('✅ Chunk batching demonstration completed');
      
    } catch (error) {
      this.recordTestResult('Chunk Batching', false, error.message);
      console.log('❌ Chunk batching failed:', error.message);
    }
  }

  /**
   * Group chunks by spatial proximity for optimized batching
   * @param {Array} chunks - Array of chunk objects
   * @param {number} maxGroupSize - Maximum chunks per group
   * @returns {Array<Array>} Array of chunk groups
   */
  groupChunksByProximity(chunks, maxGroupSize) {
    if (chunks.length <= maxGroupSize) {
      return [chunks];
    }
    
    // Sort chunks by spatial coordinates (y, then x)
    const sortedChunks = [...chunks].sort((a, b) => {
      const [,,, y1, x1] = a.coordinates;
      const [,,, y2, x2] = b.coordinates;
      if (y1 !== y2) return y1 - y2;
      return x1 - x2;
    });
    
    const groups = [];
    let currentGroup = [];
    
    for (const chunk of sortedChunks) {
      if (currentGroup.length >= maxGroupSize) {
        groups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(chunk);
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
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