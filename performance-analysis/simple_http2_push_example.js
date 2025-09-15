/**
 * HTTP/2 Performance Test with Real Agent-Lens Data
 * Demonstrates HTTP/2 advantages over sequential loading
 */

class HTTP2PerformanceTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 1; // Use scale 1 for faster testing
    this.chunks = [];
  }

  async initialize() {
    console.log('🔬 Initializing HTTP/2 Performance Test...');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}, Scale: ${this.scaleLevel}`);
    
    // Get real chunk list
    this.chunks = await this.listChunks();
    console.log(`Found ${this.chunks.length} real chunks\n`);
    
    return this.chunks.length > 0;
  }

  async listChunks() {
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${this.scaleLevel}/`;
    try {
      const response = await fetch(url);
      const files = JSON.parse(await response.text());
      return files.filter(f => f.type === 'file' && f.name.match(/^\d+\.\d+\.\d+\.\d+\.\d+$/)).map(f => f.name);
    } catch (error) {
      console.error('Failed to list chunks:', error);
      return [];
    }
  }

  buildChunkUrl(chunkName) {
    return `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${this.scaleLevel}/${chunkName}`;
  }

  // 🚫 CURRENT WAY (Sequential - Slow)
  async currentWaySequential(chunkCount = 6) {
    console.log('🐌 Current Way: Sequential HTTP/2 Requests');
    
    const testChunks = this.chunks.slice(0, chunkCount);
    const results = [];
    
    for (const chunkName of testChunks) {
      const start = performance.now();
      const url = this.buildChunkUrl(chunkName);
      
      try {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        const time = performance.now() - start;
        
        results.push({ 
          chunk: chunkName, 
          time, 
          size: data.byteLength,
          success: response.ok 
        });
        console.log(`  ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
      } catch (error) {
        const time = performance.now() - start;
        results.push({ chunk: chunkName, time, size: 0, success: false });
        console.log(`  ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
      }
    }
    
    const total = results.reduce((sum, r) => sum + r.time, 0);
    const successful = results.filter(r => r.success);
    console.log(`Total: ${(total/1000).toFixed(1)}s (${successful.length}/${results.length} success, ${(successful.length / (total/1000)).toFixed(1)} chunks/sec)`);
    
    return results;
  }

  // 🚀 HTTP/2 PARALLEL WAY (Current Best)
  async http2ParallelWay(chunkCount = 6) {
    console.log('\n🚀 HTTP/2 Parallel: Current Best Method');
    
    const testChunks = this.chunks.slice(0, chunkCount);
    const startTime = performance.now();
    
    const promises = testChunks.map(async (chunkName) => {
      const chunkStart = performance.now();
      const url = this.buildChunkUrl(chunkName);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          // HTTP/2 automatically handles:
          // - Connection reuse
          // - Multiplexing
          // - Compression
        });
        
        const data = await response.arrayBuffer();
        const time = performance.now() - chunkStart;
        
        console.log(`  ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
        return { chunk: chunkName, time, size: data.byteLength, success: response.ok };
      } catch (error) {
        const time = performance.now() - chunkStart;
        console.log(`  ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
        return { chunk: chunkName, time, size: 0, success: false };
      }
    });
    
    const results = await Promise.all(promises);
    const total = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`Total: ${(total/1000).toFixed(1)}s (${successful.length}/${results.length} success, ${(successful.length / (total/1000)).toFixed(1)} chunks/sec)`);
    
    return results;
  }

  // 🚀 HTTP/2 PUSH WAY (Theoretical - If server supported it)
  async http2PushWay(chunkCount = 6) {
    console.log('\n🚀 HTTP/2 Push: Theoretical Single Request (Simulated)');
    
    const testChunks = this.chunks.slice(0, chunkCount);
    const startTime = performance.now();
    
    // Simulate HTTP/2 push by loading chunks in optimized batches
    const batchSize = 2; // Process 2 chunks at a time to simulate push
    const results = [];
    
    for (let i = 0; i < testChunks.length; i += batchSize) {
      const batch = testChunks.slice(i, i + batchSize);
      console.log(`  Push batch ${Math.floor(i/batchSize) + 1}: ${batch.join(', ')}`);
      
      const batchPromises = batch.map(async (chunkName) => {
        const chunkStart = performance.now();
        const url = this.buildChunkUrl(chunkName);
        
        try {
          const response = await fetch(url, {
            method: 'GET',
            // Simulate HTTP/2 push optimizations
            headers: {
              'Accept-Encoding': 'gzip, deflate, br',
              'Connection': 'keep-alive',
              'HTTP2-Settings': 'enable_push'
            }
          });
          
          const data = await response.arrayBuffer();
          const time = performance.now() - chunkStart;
          
          console.log(`    ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
          return { chunk: chunkName, time, size: data.byteLength, success: response.ok };
        } catch (error) {
          const time = performance.now() - chunkStart;
          console.log(`    ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
          return { chunk: chunkName, time, size: 0, success: false };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    const total = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`Total: ${(total/1000).toFixed(1)}s (${successful.length}/${results.length} success, ${(successful.length / (total/1000)).toFixed(1)} chunks/sec)`);
    
    return results;
  }

  // Run comprehensive HTTP/2 performance test
  async runHTTP2Test(chunkCount = 6) {
    console.log('🧪 Running HTTP/2 Performance Test\n');
    console.log('='.repeat(60));
    
    if (!await this.initialize()) {
      console.error('❌ Failed to initialize test - no chunks available');
      return;
    }
    
    const results = {};
    
    try {
      // Test 1: Sequential (baseline)
      console.log('\n1️⃣ Testing Sequential HTTP/2 (Baseline)...');
      results.sequential = await this.currentWaySequential(chunkCount);
      
      // Test 2: Parallel (current best)
      console.log('\n2️⃣ Testing Parallel HTTP/2 (Current Best)...');
      results.parallel = await this.http2ParallelWay(chunkCount);
      
      // Test 3: Push simulation (theoretical)
      console.log('\n3️⃣ Testing HTTP/2 Push (Simulated)...');
      results.push = await this.http2PushWay(chunkCount);
      
      // Summary
      this.printSummary(results, chunkCount);
      
    } catch (error) {
      console.error('❌ Test failed:', error);
    }
  }

  printSummary(results, chunkCount) {
    console.log('\n' + '='.repeat(60));
    console.log('📊 HTTP/2 PERFORMANCE SUMMARY');
    console.log('='.repeat(60));
    
    const methods = [
      { name: 'Sequential HTTP/2', data: results.sequential },
      { name: 'Parallel HTTP/2', data: results.parallel },
      { name: 'HTTP/2 Push (Sim)', data: results.push }
    ];
    
    methods.forEach(method => {
      if (method.data && method.data.length > 0) {
        const successful = method.data.filter(r => r.success);
        const totalTime = Math.max(...method.data.map(r => r.time));
        const avgTime = method.data.reduce((sum, r) => sum + r.time, 0) / method.data.length;
        const speed = successful.length / (totalTime / 1000);
        const totalData = successful.reduce((sum, r) => sum + r.size, 0);
        
        console.log(`${method.name}:`);
        console.log(`  ✅ Success: ${successful.length}/${method.data.length} chunks`);
        console.log(`  ⏱️  Total time: ${(totalTime/1000).toFixed(1)}s`);
        console.log(`  📈 Avg time: ${avgTime.toFixed(0)}ms per chunk`);
        console.log(`  🚀 Speed: ${speed.toFixed(1)} chunks/sec`);
        console.log(`  📦 Data: ${(totalData/1024).toFixed(1)} KB`);
        console.log('');
      }
    });
    
    // Calculate improvements
    if (results.sequential && results.parallel) {
      const seqTime = Math.max(...results.sequential.map(r => r.time));
      const parTime = Math.max(...results.parallel.map(r => r.time));
      const improvement = ((seqTime - parTime) / seqTime * 100).toFixed(1);
      console.log(`🚀 Parallel HTTP/2 is ${improvement}% faster than Sequential`);
    }
  }
}

// Create and run the HTTP/2 test
async function main() {
  const tester = new HTTP2PerformanceTest();
  await tester.runHTTP2Test(6); // Test with 6 chunks
}

// Export for use in other modules
export { HTTP2PerformanceTest };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}
