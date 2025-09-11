/**
 * Multi-Path Test - Testing multiple path parameters approach
 * Usage: node performance-analysis/multi_path_test.js
 */

class MultiPathTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 3;
  }

  async testMultiPath(chunkPaths) {
    console.log(`🧪 Testing ${chunkPaths.length} chunks with multiple path parameters...`);
    
    const multiPathUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?${chunkPaths.map(p => `path=${p}`).join('&')}`;
    console.log(`🔗 URL: ${multiPathUrl}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(multiPathUrl);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes`);
        console.log(`📈 Average per chunk: ${(data.byteLength / chunkPaths.length / 1024).toFixed(1)} KB`);
        console.log(`🚀 Speed: ${(chunkPaths.length / ((endTime - startTime) / 1000)).toFixed(1)} chunks/sec`);
        return { success: true, time: endTime - startTime, size: data.byteLength };
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
        return { success: false, time: endTime - startTime, size: 0 };
      }
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
      return { success: false, time: endTime - startTime, size: 0 };
    }
  }

  async compareApproaches() {
    console.log('🔬 Comparing Multi-Path vs Individual Requests');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}\n`);
    
    const chunkPaths = [
      'data.zarr/3/0.2.0.21.21',
      'data.zarr/3/0.2.0.22.22', 
      'data.zarr/3/0.0.0.21.22',
      'data.zarr/3/0.2.0.22.21',
      'data.zarr/3/0.4.0.21.21'
    ];
    
    // Test 1: Multi-path approach
    console.log('🚀 Test 1: Multi-path approach (all chunks in one request)');
    const multiResult = await this.testMultiPath(chunkPaths);
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Test 2: Individual requests
    console.log('🔄 Test 2: Individual requests (sequential)');
    const individualStart = performance.now();
    const individualResults = [];
    
    for (const chunkPath of chunkPaths) {
      const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${chunkPath}`;
      const chunkStart = performance.now();
      
      try {
        const response = await fetch(url);
        const chunkEnd = performance.now();
        const data = await response.arrayBuffer();
        
        individualResults.push({
          success: response.ok,
          time: chunkEnd - chunkStart,
          size: data.byteLength
        });
        
        console.log(`${response.ok ? '✅' : '❌'} ${chunkPath}: ${data.byteLength} bytes (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
      } catch (error) {
        const chunkEnd = performance.now();
        individualResults.push({ success: false, time: chunkEnd - chunkStart, size: 0 });
        console.log(`❌ ${chunkPath}: ${error.message} (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
      }
    }
    
    const individualEnd = performance.now();
    const individualTime = individualEnd - individualStart;
    const individualSuccessful = individualResults.filter(r => r.success);
    
    console.log(`\n📊 Individual Results:`);
    console.log(`✅ Success: ${individualSuccessful.length}/${individualResults.length}`);
    console.log(`⏱️  Total time: ${(individualTime / 1000).toFixed(1)}s`);
    console.log(`📈 Avg time: ${(individualTime / individualResults.length).toFixed(0)}ms per chunk`);
    console.log(`🚀 Speed: ${(individualResults.length / (individualTime / 1000)).toFixed(1)} chunks/sec`);
    
    // Comparison
    console.log('\n📈 Performance Comparison:');
    if (multiResult.success && individualSuccessful.length > 0) {
      const speedup = individualTime / multiResult.time;
      console.log(`🚀 Multi-path is ${speedup.toFixed(1)}x faster than individual requests`);
      console.log(`⏱️  Time saved: ${((individualTime - multiResult.time) / 1000).toFixed(1)}s`);
    }
  }

  async run() {
    await this.compareApproaches();
  }
}

// Run the test
async function main() {
  const tester = new MultiPathTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default MultiPathTest;
