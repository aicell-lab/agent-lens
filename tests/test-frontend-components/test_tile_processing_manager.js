/**
 * JavaScript test for TileProcessingManager functionality
 * 
 * This test suite covers:
 * 1. Core processing logic for single and multi-channel tiles
 * 2. Data loading for different modes (FREE_PAN vs HISTORICAL)
 * 3. Color management and contrast adjustment
 * 4. Channel merging with additive blending
 * 5. Error handling and edge cases
 * 
 * Usage: node tests/test-frontend-components/test_tile_processing_manager.js
 */

// Mock browser APIs for Node.js environment
const mockBrowserAPIs = () => {
  global.document = {
    createElement: (tagName) => {
      if (tagName === 'canvas') {
        return {
          width: 512,
          height: 512,
          getContext: () => ({
            drawImage: () => {},
            getImageData: () => ({
              data: new Uint8ClampedArray(512 * 512 * 4).fill(128),
              width: 512,
              height: 512
            }),
            putImageData: () => {},
            globalCompositeOperation: 'source-over'
          }),
          toDataURL: () => 'data:image/png;base64,mockData'
        };
      }
      return {};
    }
  };

  global.Image = class {
    constructor() {
      this.width = 512;
      this.height = 512;
      this.onload = null;
      this.onerror = null;
    }
    
    set src(value) {
      // Simulate async image loading
      setTimeout(() => {
        if (this.onload) this.onload();
      }, 10);
    }
  };
};

// Import the TileProcessingManager (we'll need to adjust the import path)
let TileProcessingManager;

class TileProcessingManagerTest {
  constructor() {
    this.testResults = [];
    this.mockServices = this.createMockServices();
  }

  /**
   * Create mock services for testing
   */
  createMockServices() {
    return {
      microscopeControlService: {
        get_stitched_region: async (centerX, centerY, width_mm, height_mm, wellPlateType, scaleLevel, channel, timepoint, wellPaddingMm, outputFormat) => {
          // Simulate successful response
          return {
            success: true,
            data: 'mockBase64Data',
            metadata: {
              width: 512,
              height: 512,
              channel: channel
            }
          };
        }
      },
      artifactZarrLoader: {
        getWellRegion: async (wellId, centerX, centerY, width_mm, height_mm, channel, scaleLevel, timepoint, datasetId, outputFormat) => {
          // Simulate successful response
          return 'data:image/png;base64,mockZarrData';
        }
      }
    };
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log('🎨 TileProcessingManager Test Suite');
    console.log('=' .repeat(60));

    try {
      // Mock browser APIs
      mockBrowserAPIs();
      
      // Import the actual TileProcessingManager by creating a JS version
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const tileProcessingManagerPath = path.join(__dirname, '../../frontend/components/microscope/map/TileProcessingManager.jsx');
      
      // Read the JSX file and create a JS version for testing
      const jsxContent = fs.readFileSync(tileProcessingManagerPath, 'utf8');
      
      // Convert JSX to JS by removing React import and changing export
      const jsContent = jsxContent
        .replace(/import React from 'react';/g, '// React import removed for Node.js testing')
        .replace(/export default new TileProcessingManager\(\);/g, 'export default TileProcessingManager;');
      
      // Write temporary JS file
      const tempJsPath = path.join(__dirname, 'TileProcessingManager.temp.js');
      fs.writeFileSync(tempJsPath, jsContent);
      
      try {
        // Import the temporary JS file
        const module = await import(`./TileProcessingManager.temp.js?t=${Date.now()}`);
        const TileProcessingManagerClass = module.default;
        
        // Create an instance of the class
        TileProcessingManager = new TileProcessingManagerClass();
        
        // Clean up temporary file
        fs.unlinkSync(tempJsPath);
      } catch (error) {
        // Clean up temporary file even if import fails
        try { fs.unlinkSync(tempJsPath); } catch {}
        throw error;
      }

      await this.testInitialization();
      await this.testProcessTileChannels();
      await this.testProcessSingleChannel();
      await this.testLoadChannelData();
      await this.testGetChannelColor();
      await this.testApplyContrastAdjustment();
      await this.testMergeChannels();
      await this.testUtilityFunctions();
      await this.testErrorHandling();
      
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
      assert(TileProcessingManager !== null, 'TileProcessingManager should be available');
      assert(typeof TileProcessingManager.processTileChannels === 'function', 'Should have processTileChannels method');
      assert(typeof TileProcessingManager.processSingleChannel === 'function', 'Should have processSingleChannel method');
      assert(typeof TileProcessingManager.mergeChannels === 'function', 'Should have mergeChannels method');
      assert(TileProcessingManager.defaultColors, 'Should have default colors configuration');

      this.recordTestResult('Initialization', true, 'Service initialized correctly');
      console.log('✅ Service initialization passed');
    } catch (error) {
      this.recordTestResult('Initialization', false, error.message);
      console.log('❌ Service initialization failed:', error.message);
    }
  }

  /**
   * Test main tile processing with multiple channels
   */
  async testProcessTileChannels() {
    console.log('🧪 Test 2: Process Tile Channels');
    
    try {
      const enabledChannels = [
        { label: 'BF_LED_matrix_full', enabled: true },
        { label: 'Fluorescence_488_nm_Ex', enabled: true }
      ];
      
      const tileRequest = {
        centerX: 0.0,
        centerY: 0.0,
        width_mm: 2.0,
        height_mm: 2.0,
        wellPlateType: '96',
        scaleLevel: 3,
        timepoint: 0,
        bounds: { x: 0, y: 0, width: 512, height: 512 }
      };
      
      const channelConfigs = {
        'BF_LED_matrix_full': { min: 0, max: 255 },
        'Fluorescence_488_nm_Ex': { min: 50, max: 200 }
      };

      const result = await TileProcessingManager.processTileChannels(
        enabledChannels,
        tileRequest,
        'FREE_PAN',
        channelConfigs,
        this.mockServices
      );

      assert(result, 'Should return a result');
      assert(result.data, 'Should have image data');
      assert(result.channelsUsed, 'Should have channelsUsed array');
      assert(result.channelsUsed.length > 0, 'Should have at least one channel used');

      this.recordTestResult('Process Tile Channels', true, `Processed ${result.channelsUsed.length} channels`);
      console.log('✅ Process tile channels passed');
    } catch (error) {
      this.recordTestResult('Process Tile Channels', false, error.message);
      console.log('❌ Process tile channels failed:', error.message);
    }
  }

  /**
   * Test single channel processing
   */
  async testProcessSingleChannel() {
    console.log('🧪 Test 3: Process Single Channel');
    
    try {
      const channel = { label: 'BF_LED_matrix_full' };
      const tileRequest = {
        centerX: 0.0,
        centerY: 0.0,
        width_mm: 2.0,
        height_mm: 2.0,
        wellPlateType: '96',
        scaleLevel: 3,
        timepoint: 0
      };
      
      const channelConfigs = {
        'BF_LED_matrix_full': { min: 0, max: 255 }
      };

      const result = await TileProcessingManager.processSingleChannel(
        channel,
        tileRequest,
        'FREE_PAN',
        channelConfigs,
        this.mockServices
      );

      assert(result, 'Should return a result');
      assert(result.channelName, 'Should have channel name');
      assert(result.data, 'Should have image data');
      assert(result.color, 'Should have color');

      this.recordTestResult('Process Single Channel', true, `Processed channel: ${result.channelName}`);
      console.log('✅ Process single channel passed');
    } catch (error) {
      this.recordTestResult('Process Single Channel', false, error.message);
      console.log('❌ Process single channel failed:', error.message);
    }
  }

  /**
   * Test data loading for different modes
   */
  async testLoadChannelData() {
    console.log('🧪 Test 4: Load Channel Data');
    
    try {
      const tileRequest = {
        centerX: 0.0,
        centerY: 0.0,
        width_mm: 2.0,
        height_mm: 2.0,
        wellPlateType: '96',
        scaleLevel: 3,
        timepoint: 0,
        wellId: 'A2',
        datasetId: 'test-dataset'
      };

      // Test FREE_PAN mode
      const freePanResult = await TileProcessingManager.loadChannelData(
        'BF_LED_matrix_full',
        tileRequest,
        'FREE_PAN',
        this.mockServices
      );
      
      assert(freePanResult, 'Should return data for FREE_PAN mode');
      assert(freePanResult.startsWith('data:image/'), 'Should return data URL');

      // Test HISTORICAL mode
      const historicalResult = await TileProcessingManager.loadChannelData(
        'BF_LED_matrix_full',
        tileRequest,
        'HISTORICAL',
        this.mockServices
      );
      
      assert(historicalResult, 'Should return data for HISTORICAL mode');
      assert(historicalResult.startsWith('data:image/'), 'Should return data URL');

      this.recordTestResult('Load Channel Data', true, 'Both modes work correctly');
      console.log('✅ Load channel data passed');
    } catch (error) {
      this.recordTestResult('Load Channel Data', false, error.message);
      console.log('❌ Load channel data failed:', error.message);
    }
  }

  /**
   * Test color management
   */
  async testGetChannelColor() {
    console.log('🧪 Test 5: Get Channel Color');
    
    try {
      // Test with default colors
      const defaultColor = TileProcessingManager.getChannelColor('BF_LED_matrix_full', 'FREE_PAN');
      assert(defaultColor === '#FFFFFF', 'Should return default color for BF_LED_matrix_full');

      const fluorescenceColor = TileProcessingManager.getChannelColor('Fluorescence_488_nm_Ex', 'FREE_PAN');
      assert(fluorescenceColor === '#00FF00', 'Should return green for Fluorescence_488_nm_Ex');

      // Test with zarr metadata
      const metadata = {
        zarrMetadata: {
          activeChannels: [
            { label: 'BF_LED_matrix_full', color: 'FF0000' }
          ]
        }
      };
      
      const zarrColor = TileProcessingManager.getChannelColor('BF_LED_matrix_full', 'HISTORICAL', metadata);
      assert(zarrColor === '#FF0000', 'Should return color from zarr metadata');

      this.recordTestResult('Get Channel Color', true, 'Color management works correctly');
      console.log('✅ Get channel color passed');
    } catch (error) {
      this.recordTestResult('Get Channel Color', false, error.message);
      console.log('❌ Get channel color failed:', error.message);
    }
  }

  /**
   * Test contrast adjustment
   */
  async testApplyContrastAdjustment() {
    console.log('🧪 Test 6: Apply Contrast Adjustment');
    
    try {
      const dataUrl = 'data:image/png;base64,mockData';
      const config = { min: 50, max: 200 };
      const color = '#FF0000';

      const result = await TileProcessingManager.applyContrastAdjustment(dataUrl, config, color);
      
      assert(result, 'Should return processed data');
      assert(result.startsWith('data:image/'), 'Should return data URL');

      // Test with no adjustment needed
      const noAdjustmentConfig = { min: 0, max: 255 };
      const noAdjustmentResult = await TileProcessingManager.applyContrastAdjustment(dataUrl, noAdjustmentConfig, color);
      assert(noAdjustmentResult === dataUrl, 'Should return original data when no adjustment needed');

      this.recordTestResult('Apply Contrast Adjustment', true, 'Contrast adjustment works correctly');
      console.log('✅ Apply contrast adjustment passed');
    } catch (error) {
      this.recordTestResult('Apply Contrast Adjustment', false, error.message);
      console.log('❌ Apply contrast adjustment failed:', error.message);
    }
  }

  /**
   * Test channel merging
   */
  async testMergeChannels() {
    console.log('🧪 Test 7: Merge Channels');
    
    try {
      const channelDataArray = [
        {
          channelName: 'BF_LED_matrix_full',
          data: 'data:image/png;base64,mockData1',
          color: '#FFFFFF',
          config: { min: 0, max: 255 }
        },
        {
          channelName: 'Fluorescence_488_nm_Ex',
          data: 'data:image/png;base64,mockData2',
          color: '#00FF00',
          config: { min: 50, max: 200 }
        }
      ];

      const tileRequest = {
        bounds: { x: 0, y: 0, width: 512, height: 512 },
        width_mm: 2.0,
        height_mm: 2.0,
        scaleLevel: 3
      };

      const result = await TileProcessingManager.mergeChannels(channelDataArray, tileRequest);
      
      assert(result, 'Should return merged result');
      assert(result.data, 'Should have merged image data');
      assert(result.channelsUsed, 'Should have channelsUsed array');
      assert(result.channelsUsed.length === 2, 'Should have 2 channels used');
      assert(result.isMerged, 'Should be marked as merged');

      this.recordTestResult('Merge Channels', true, `Merged ${result.channelsUsed.length} channels`);
      console.log('✅ Merge channels passed');
    } catch (error) {
      this.recordTestResult('Merge Channels', false, error.message);
      console.log('❌ Merge channels failed:', error.message);
    }
  }

  /**
   * Test utility functions
   */
  async testUtilityFunctions() {
    console.log('🧪 Test 8: Utility Functions');
    
    try {
      // Test hexToRgb
      const rgb1 = TileProcessingManager.hexToRgb('#FF0000');
      assert(rgb1.r === 255 && rgb1.g === 0 && rgb1.b === 0, 'Should convert red hex to RGB');

      const rgb2 = TileProcessingManager.hexToRgb('#00FF00');
      assert(rgb2.r === 0 && rgb2.g === 255 && rgb2.b === 0, 'Should convert green hex to RGB');

      const rgb3 = TileProcessingManager.hexToRgb('#0000FF');
      assert(rgb3.r === 0 && rgb3.g === 0 && rgb3.b === 255, 'Should convert blue hex to RGB');

      // Test createEmptyTile
      const tileRequest = {
        bounds: { x: 0, y: 0, width: 512, height: 512 },
        width_mm: 2.0,
        height_mm: 2.0,
        scaleLevel: 3
      };

      const emptyTile = TileProcessingManager.createEmptyTile(tileRequest);
      assert(emptyTile.data === null, 'Empty tile should have null data');
      assert(emptyTile.channelsUsed.length === 0, 'Empty tile should have no channels used');
      assert(emptyTile.channel === 'none', 'Empty tile should have channel "none"');

      this.recordTestResult('Utility Functions', true, 'Utility functions work correctly');
      console.log('✅ Utility functions passed');
    } catch (error) {
      this.recordTestResult('Utility Functions', false, error.message);
      console.log('❌ Utility functions failed:', error.message);
    }
  }

  /**
   * Test error handling
   */
  async testErrorHandling() {
    console.log('🧪 Test 9: Error Handling');
    
    try {
      // Test with empty channels array
      const emptyChannelsResult = await TileProcessingManager.processTileChannels(
        [],
        { centerX: 0, centerY: 0, width_mm: 2, height_mm: 2, wellPlateType: '96', scaleLevel: 3, bounds: {} },
        'FREE_PAN',
        {},
        this.mockServices
      );
      
      assert(emptyChannelsResult.data === null, 'Should return empty tile for no channels');

      // Test with invalid mode
      try {
        await TileProcessingManager.loadChannelData(
          'BF_LED_matrix_full',
          { centerX: 0, centerY: 0, width_mm: 2, height_mm: 2, wellPlateType: '96', scaleLevel: 3 },
          'INVALID_MODE',
          this.mockServices
        );
        assert(false, 'Should throw error for invalid mode');
      } catch (error) {
        assert(error.message.includes('Unknown mode'), 'Should throw appropriate error for invalid mode');
      }

      this.recordTestResult('Error Handling', true, 'Error handling works correctly');
      console.log('✅ Error handling passed');
    } catch (error) {
      this.recordTestResult('Error Handling', false, error.message);
      console.log('❌ Error handling failed:', error.message);
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
    console.log('\n📊 TileProcessingManager Test Results Summary');
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
      console.log('🎉 All TileProcessingManager tests passed!');
    } else {
      console.log('⚠️  Some TileProcessingManager tests failed');
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
  const tester = new TileProcessingManagerTest();
  await tester.runAllTests();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ TileProcessingManager test runner failed:', error);
    process.exit(1);
  });
}

export default TileProcessingManagerTest;
