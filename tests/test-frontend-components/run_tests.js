#!/usr/bin/env node

/**
 * Test runner for frontend components
 * 
 * This script runs all frontend component tests and provides
 * a unified interface for testing TileProcessingManager and LayerPanel.
 * 
 * Usage: 
 *   node tests/test-frontend-components/run_tests.js
 *   node tests/test-frontend-components/run_tests.js --tile-processing
 *   node tests/test-frontend-components/run_tests.js --layer-panel
 *   node tests/test-frontend-components/run_tests.js --verbose
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FrontendComponentTestRunner {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    this.verbose = process.argv.includes('--verbose');
    this.tileProcessingOnly = process.argv.includes('--tile-processing');
    this.layerPanelOnly = process.argv.includes('--layer-panel');
  }

  /**
   * Run all frontend component tests
   */
  async runAllTests() {
    console.log('🧪 Frontend Components Test Suite');
    console.log('=' .repeat(60));
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`🔧 Verbose mode: ${this.verbose ? 'ON' : 'OFF'}`);
    console.log();

    try {
      if (this.tileProcessingOnly) {
        await this.runTileProcessingTests();
      } else if (this.layerPanelOnly) {
        await this.runLayerPanelTests();
      } else {
        // Run all tests
        await this.runTileProcessingTests();
        await this.runLayerPanelTests();
      }

      this.printSummary();
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  /**
   * Run TileProcessingManager tests
   */
  async runTileProcessingTests() {
    console.log('🎨 Running TileProcessingManager Tests...');
    console.log('-'.repeat(40));
    
    const testPath = join(__dirname, 'test_tile_processing_manager.js');
    await this.runTestFile('TileProcessingManager', testPath);
  }

  /**
   * Run LayerPanel tests
   */
  async runLayerPanelTests() {
    console.log('🎛️ Running LayerPanel Tests...');
    console.log('-'.repeat(40));
    
    const testPath = join(__dirname, 'test_layer_panel.js');
    await this.runTestFile('LayerPanel', testPath);
  }

  /**
   * Run a single test file
   */
  async runTestFile(testName, testPath) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      const child = spawn('node', [testPath], {
        stdio: this.verbose ? 'inherit' : 'pipe',
        cwd: process.cwd()
      });

      let stdout = '';
      let stderr = '';

      if (!this.verbose) {
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        const success = code === 0;
        
        this.testResults.push({
          name: testName,
          success,
          duration,
          code,
          stdout: this.verbose ? null : stdout,
          stderr: this.verbose ? null : stderr
        });

        if (success) {
          console.log(`✅ ${testName} tests passed (${duration}ms)`);
        } else {
          console.log(`❌ ${testName} tests failed (${duration}ms)`);
          if (!this.verbose && stderr) {
            console.log('Error output:', stderr);
          }
        }

        resolve();
      });

      child.on('error', (error) => {
        console.error(`❌ Failed to run ${testName} tests:`, error);
        reject(error);
      });
    });
  }

  /**
   * Print test summary
   */
  printSummary() {
    const totalDuration = Date.now() - this.startTime;
    const passed = this.testResults.filter(r => r.success).length;
    const total = this.testResults.length;
    
    console.log('\n📊 Frontend Components Test Summary');
    console.log('=' .repeat(60));
    console.log(`⏱️  Total duration: ${totalDuration}ms`);
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${total - passed}/${total}`);
    console.log();

    // Detailed results
    for (const result of this.testResults) {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.name}: ${result.duration}ms`);
      
      if (!result.success && result.stderr) {
        console.log(`   Error: ${result.stderr.split('\n')[0]}`);
      }
    }

    console.log();
    if (passed === total) {
      console.log('🎉 All frontend component tests passed!');
      process.exit(0);
    } else {
      console.log('⚠️  Some frontend component tests failed');
      process.exit(1);
    }
  }
}

// Run the test suite
async function main() {
  const runner = new FrontendComponentTestRunner();
  await runner.runAllTests();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test runner failed:', error);
    process.exit(1);
  });
}

export default FrontendComponentTestRunner;
