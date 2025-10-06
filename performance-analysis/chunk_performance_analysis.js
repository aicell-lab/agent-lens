/**
 * Chunk Loading Performance Test
 * Usage: node performance-analysis/chunk_test.js
 */

class ChunkTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 1;
  }

  async listChunks() {
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${this.scaleLevel}/`;
    const response = await fetch(url);
    const files = JSON.parse(await response.text());
    return files.filter(f => f.type === 'file' && f.name.match(/^\d+\.\d+\.\d+\.\d+\.\d+$/)).map(f => f.name);
  }

  async loadChunksSequential(chunks, count = 10) {
    const testChunks = chunks.slice(0, count);
    const startTime = performance.now();
    const results = [];

    for (const chunkName of testChunks) {
      const chunkStart = performance.now();
      const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${this.scaleLevel}/${chunkName}`;
      
      try {
        const response = await fetch(url);
        const chunkEnd = performance.now();
        const data = await response.arrayBuffer();
        
        results.push({
          success: response.ok,
          time: chunkEnd - chunkStart,
          size: data.byteLength
        });
        
        console.log(`${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
      } catch (error) {
        const chunkEnd = performance.now();
        results.push({ success: false, time: chunkEnd - chunkStart, size: 0 });
        console.log(`❌ ${chunkName}: ${error.message} (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
      }
    }

    const totalTime = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`\n📊 Sequential Results:`);
    console.log(`✅ Success: ${successful.length}/${results.length}`);
    console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`📈 Avg time: ${(totalTime / results.length).toFixed(0)}ms per chunk`);
    console.log(`🚀 Speed: ${(results.length / (totalTime / 1000)).toFixed(1)} chunks/sec`);
    
    return results;
  }

  async loadChunksParallel(chunks, count = 10) {
    const testChunks = chunks.slice(0, count);
    const startTime = performance.now();
    
    console.log(`🚀 Loading ${testChunks.length} chunks in parallel...`);
    
    // Send all requests at once
    const promises = testChunks.map(async (chunkName) => {
      const chunkStart = performance.now();
      const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${this.scaleLevel}/${chunkName}`;
      
      try {
        const response = await fetch(url);
        const chunkEnd = performance.now();
        const data = await response.arrayBuffer();
        
        const result = {
          success: response.ok,
          time: chunkEnd - chunkStart,
          size: data.byteLength,
          chunkName
        };
        
        console.log(`${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
        return result;
      } catch (error) {
        const chunkEnd = performance.now();
        const result = { success: false, time: chunkEnd - chunkStart, size: 0, chunkName };
        console.log(`❌ ${chunkName}: ${error.message} (${(chunkEnd - chunkStart).toFixed(0)}ms)`);
        return result;
      }
    });
    
    const results = await Promise.all(promises);
    const totalTime = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`\n📊 Parallel Results:`);
    console.log(`✅ Success: ${successful.length}/${results.length}`);
    console.log(`⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`📈 Avg time: ${(totalTime / results.length).toFixed(0)}ms per chunk`);
    console.log(`🚀 Speed: ${(results.length / (totalTime / 1000)).toFixed(1)} chunks/sec`);
    
    return results;
  }

  async run() {
    console.log('🔬 Chunk Loading Performance Test');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    
    const chunks = await this.listChunks();
    console.log(`Found ${chunks.length} chunks\n`);
    
    if (chunks.length > 0) {
      // Test sequential loading
      console.log('🔄 Testing Sequential Loading...');
      await this.loadChunksSequential(chunks, 10);
      
      console.log('\n' + '='.repeat(50) + '\n');
      
      // Test parallel loading
      console.log('🚀 Testing Parallel Loading...');
      await this.loadChunksParallel(chunks, 10);
    }
  }
}

// Run the test
async function main() {
  const tester = new ChunkTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default ChunkTest;
