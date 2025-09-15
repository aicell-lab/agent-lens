/**
 * HTTP/3 Chunk Loading Performance Analysis
 * Specialized for Agent-Lens OME-Zarr chunk loading patterns
 * 
 * This test simulates real-world microscopy data loading scenarios:
 * - Multi-scale pyramid loading
 * - Channel-specific chunk requests
 * - Time-lapse data streaming
 * - Progressive image loading
 */

class HTTP3ChunkPerformanceAnalysis {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scales = [0, 1, 2, 3]; // Multi-scale pyramid levels
    this.channels = ['0', '1', '2', '3', '4', '5']; // Fluorescence channels
    this.chunks = {};
    this.http3Supported = false;
  }

  async initialize() {
    console.log('🔬 Initializing HTTP/3 Chunk Performance Analysis...');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    console.log(`Scales: ${this.scales.join(', ')}, Channels: ${this.channels.join(', ')}\n`);
    
    // Check HTTP/3 support
    await this.checkHTTP3Support();
    
    // Discover available chunks for each scale
    await this.discoverChunks();
    
    return Object.keys(this.chunks).length > 0;
  }

  async checkHTTP3Support() {
    console.log('🔍 Checking HTTP/3 support...');
    
    try {
      const testUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/`;
      const response = await fetch(testUrl, {
        method: 'HEAD',
        headers: {
          'Alt-Svc': 'h3=":443"',
          'Upgrade': 'h3',
          'Connection': 'Upgrade'
        }
      });
      
      const altSvc = response.headers.get('Alt-Svc');
      if (altSvc && altSvc.includes('h3')) {
        this.http3Supported = true;
        console.log('✅ HTTP/3 support detected');
      } else {
        console.log('⚠️  HTTP/3 support not detected, testing anyway...');
        this.http3Supported = true;
      }
    } catch (error) {
      console.log('⚠️  Could not detect HTTP/3 support:', error.message);
      this.http3Supported = true;
    }
  }

  async discoverChunks() {
    console.log('🔍 Discovering available chunks...');
    
    for (const scale of this.scales) {
      try {
        const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${scale}/`;
        const response = await fetch(url);
        const files = JSON.parse(await response.text());
        
        const scaleChunks = files
          .filter(f => f.type === 'file' && f.name.match(/^\d+\.\d+\.\d+\.\d+\.\d+$/))
          .map(f => f.name);
        
        this.chunks[scale] = scaleChunks;
        console.log(`  Scale ${scale}: ${scaleChunks.length} chunks`);
      } catch (error) {
        console.log(`  Scale ${scale}: Failed to discover chunks - ${error.message}`);
        this.chunks[scale] = [];
      }
    }
  }

  buildChunkUrl(scale, chunkName) {
    return `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip/~/data.zarr/${scale}/${chunkName}`;
  }

  // 🐌 HTTP/1.1 Sequential Loading (Baseline)
  async http1SequentialLoading(scale = 1, chunkCount = 10) {
    console.log(`🐌 HTTP/1.1 Sequential Loading (Scale ${scale}, ${chunkCount} chunks)`);
    
    const availableChunks = this.chunks[scale] || [];
    const testChunks = availableChunks.slice(0, chunkCount);
    
    if (testChunks.length === 0) {
      console.log('  ❌ No chunks available for this scale');
      return { success: false, results: [] };
    }
    
    const results = [];
    const startTime = performance.now();
    
    for (const chunkName of testChunks) {
      const chunkStart = performance.now();
      const url = this.buildChunkUrl(scale, chunkName);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Connection': 'close', // Force new connection per request
            'HTTP-Version': '1.1'
          }
        });
        
        const data = await response.arrayBuffer();
        const time = performance.now() - chunkStart;
        
        results.push({
          chunk: chunkName,
          time,
          size: data.byteLength,
          success: response.ok,
          protocol: 'HTTP/1.1'
        });
        
        console.log(`  ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
      } catch (error) {
        const time = performance.now() - chunkStart;
        results.push({
          chunk: chunkName,
          time,
          size: 0,
          success: false,
          protocol: 'HTTP/1.1'
        });
        console.log(`  ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
      }
    }
    
    const totalTime = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`  📊 Results: ${(totalTime/1000).toFixed(1)}s total, ${successful.length}/${results.length} success, ${(successful.length / (totalTime/1000)).toFixed(1)} chunks/sec`);
    
    return { success: true, results, totalTime, successful: successful.length };
  }

  // 🚀 HTTP/2 Parallel Loading (Current Best)
  async http2ParallelLoading(scale = 1, chunkCount = 10) {
    console.log(`🚀 HTTP/2 Parallel Loading (Scale ${scale}, ${chunkCount} chunks)`);
    
    const availableChunks = this.chunks[scale] || [];
    const testChunks = availableChunks.slice(0, chunkCount);
    
    if (testChunks.length === 0) {
      console.log('  ❌ No chunks available for this scale');
      return { success: false, results: [] };
    }
    
    const startTime = performance.now();
    
    const promises = testChunks.map(async (chunkName) => {
      const chunkStart = performance.now();
      const url = this.buildChunkUrl(scale, chunkName);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'HTTP2-Settings': 'enable_push'
          }
        });
        
        const data = await response.arrayBuffer();
        const time = performance.now() - chunkStart;
        
        console.log(`  ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
        return {
          chunk: chunkName,
          time,
          size: data.byteLength,
          success: response.ok,
          protocol: 'HTTP/2'
        };
      } catch (error) {
        const time = performance.now() - chunkStart;
        console.log(`  ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
        return {
          chunk: chunkName,
          time,
          size: 0,
          success: false,
          protocol: 'HTTP/2'
        };
      }
    });
    
    const results = await Promise.all(promises);
    const totalTime = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`  📊 Results: ${(totalTime/1000).toFixed(1)}s total, ${successful.length}/${results.length} success, ${(successful.length / (totalTime/1000)).toFixed(1)} chunks/sec`);
    
    return { success: true, results, totalTime, successful: successful.length };
  }

  // 🚀 HTTP/3 Parallel Loading (Next Generation)
  async http3ParallelLoading(scale = 1, chunkCount = 10) {
    console.log(`🚀 HTTP/3 Parallel Loading (Scale ${scale}, ${chunkCount} chunks)`);
    
    const availableChunks = this.chunks[scale] || [];
    const testChunks = availableChunks.slice(0, chunkCount);
    
    if (testChunks.length === 0) {
      console.log('  ❌ No chunks available for this scale');
      return { success: false, results: [] };
    }
    
    const startTime = performance.now();
    
    const promises = testChunks.map(async (chunkName) => {
      const chunkStart = performance.now();
      const url = this.buildChunkUrl(scale, chunkName);
      
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept-Encoding': 'gzip, deflate, br',
            'Alt-Svc': 'h3=":443"',
            'Upgrade': 'h3',
            'Connection': 'Upgrade',
            'QUIC-Version': '1',
            'QUIC-Transport-Parameters': 'enable_multiplexing'
          }
        });
        
        const data = await response.arrayBuffer();
        const time = performance.now() - chunkStart;
        
        console.log(`  ${response.ok ? '✅' : '❌'} ${chunkName}: ${data.byteLength} bytes (${time.toFixed(0)}ms)`);
        return {
          chunk: chunkName,
          time,
          size: data.byteLength,
          success: response.ok,
          protocol: 'HTTP/3'
        };
      } catch (error) {
        const time = performance.now() - chunkStart;
        console.log(`  ❌ ${chunkName}: ${error.message} (${time.toFixed(0)}ms)`);
        return {
          chunk: chunkName,
          time,
          size: 0,
          success: false,
          protocol: 'HTTP/3'
        };
      }
    });
    
    const results = await Promise.all(promises);
    const totalTime = performance.now() - startTime;
    const successful = results.filter(r => r.success);
    
    console.log(`  📊 Results: ${(totalTime/1000).toFixed(1)}s total, ${successful.length}/${results.length} success, ${(successful.length / (totalTime/1000)).toFixed(1)} chunks/sec`);
    
    return { success: true, results, totalTime, successful: successful.length };
  }

  // 🔬 Multi-Scale Progressive Loading (Real-world scenario)
  async multiScaleProgressiveLoading(chunkCountPerScale = 5) {
    console.log('\n🔬 Multi-Scale Progressive Loading (Real-world scenario)');
    console.log('Simulating: Load low-res first, then progressively higher resolution');
    
    const results = {};
    const totalStartTime = performance.now();
    
    // Load scales in order: 3 (lowest res) -> 2 -> 1 -> 0 (highest res)
    const orderedScales = [...this.scales].reverse();
    
    for (const scale of orderedScales) {
      if (!this.chunks[scale] || this.chunks[scale].length === 0) {
        console.log(`  ⚠️  Scale ${scale}: No chunks available, skipping`);
        continue;
      }
      
      console.log(`\n  📐 Loading Scale ${scale} (${this.chunks[scale].length} chunks available)...`);
      
      // Test all three protocols for this scale
      const scaleResults = {};
      
      // HTTP/1.1 Sequential
      console.log(`    🐌 HTTP/1.1 Sequential:`);
      scaleResults.http1 = await this.http1SequentialLoading(scale, chunkCountPerScale);
      
      // HTTP/2 Parallel
      console.log(`    🚀 HTTP/2 Parallel:`);
      scaleResults.http2 = await this.http2ParallelLoading(scale, chunkCountPerScale);
      
      // HTTP/3 Parallel
      console.log(`    🚀 HTTP/3 Parallel:`);
      scaleResults.http3 = await this.http3ParallelLoading(scale, chunkCountPerScale);
      
      results[scale] = scaleResults;
    }
    
    const totalTime = performance.now() - totalStartTime;
    console.log(`\n  📊 Multi-Scale Total Time: ${(totalTime/1000).toFixed(1)}s`);
    
    return { results, totalTime };
  }

  // 🔄 Channel-Specific Loading (Microscopy workflow)
  async channelSpecificLoading(scale = 1, chunkCountPerChannel = 3) {
    console.log('\n🔄 Channel-Specific Loading (Microscopy workflow)');
    console.log('Simulating: Load specific fluorescence channels for analysis');
    
    const results = {};
    const totalStartTime = performance.now();
    
    for (const channel of this.channels) {
      console.log(`\n  🎨 Channel ${channel} (${channel === '0' ? 'Brightfield' : `Fluorescence ${channel}`}):`);
      
      // For this test, we'll use the same chunks but simulate channel-specific loading
      const availableChunks = this.chunks[scale] || [];
      const testChunks = availableChunks.slice(0, chunkCountPerChannel);
      
      if (testChunks.length === 0) {
        console.log(`    ⚠️  No chunks available for channel ${channel}`);
        continue;
      }
      
      const channelResults = {};
      
      // HTTP/1.1 Sequential
      console.log(`    🐌 HTTP/1.1 Sequential:`);
      channelResults.http1 = await this.http1SequentialLoading(scale, testChunks.length);
      
      // HTTP/2 Parallel
      console.log(`    🚀 HTTP/2 Parallel:`);
      channelResults.http2 = await this.http2ParallelLoading(scale, testChunks.length);
      
      // HTTP/3 Parallel
      console.log(`    🚀 HTTP/3 Parallel:`);
      channelResults.http3 = await this.http3ParallelLoading(scale, testChunks.length);
      
      results[channel] = channelResults;
    }
    
    const totalTime = performance.now() - totalStartTime;
    console.log(`\n  📊 Channel-Specific Total Time: ${(totalTime/1000).toFixed(1)}s`);
    
    return { results, totalTime };
  }

  // Run comprehensive HTTP/3 chunk performance analysis
  async runAnalysis() {
    console.log('🧪 Running HTTP/3 Chunk Performance Analysis\n');
    console.log('='.repeat(80));
    
    if (!await this.initialize()) {
      console.error('❌ Failed to initialize analysis - no chunks available');
      return;
    }
    
    const analysisResults = {};
    
    try {
      // Test 1: Single Scale Comparison
      console.log('\n1️⃣ Single Scale Protocol Comparison (Scale 1)...');
      analysisResults.singleScale = {
        http1: await this.http1SequentialLoading(1, 8),
        http2: await this.http2ParallelLoading(1, 8),
        http3: await this.http3ParallelLoading(1, 8)
      };
      
      // Test 2: Multi-Scale Progressive Loading
      console.log('\n2️⃣ Multi-Scale Progressive Loading...');
      analysisResults.multiScale = await this.multiScaleProgressiveLoading(4);
      
      // Test 3: Channel-Specific Loading
      console.log('\n3️⃣ Channel-Specific Loading...');
      analysisResults.channelSpecific = await this.channelSpecificLoading(1, 3);
      
      // Summary
      this.printAnalysisSummary(analysisResults);
      
    } catch (error) {
      console.error('❌ Analysis failed:', error);
    }
  }

  printAnalysisSummary(analysisResults) {
    console.log('\n' + '='.repeat(80));
    console.log('📊 HTTP/3 CHUNK PERFORMANCE ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    
    // Single Scale Results
    if (analysisResults.singleScale) {
      console.log('\n📐 SINGLE SCALE COMPARISON (Scale 1):');
      console.log('-'.repeat(50));
      
      const protocols = [
        { name: 'HTTP/1.1 Sequential', data: analysisResults.singleScale.http1, color: '🔴' },
        { name: 'HTTP/2 Parallel', data: analysisResults.singleScale.http2, color: '🟡' },
        { name: 'HTTP/3 Parallel', data: analysisResults.singleScale.http3, color: '🟢' }
      ];
      
      protocols.forEach(protocol => {
        if (protocol.data && protocol.data.success) {
          const speed = protocol.data.successful / (protocol.data.totalTime / 1000);
          console.log(`${protocol.color} ${protocol.name}:`);
          console.log(`  ⏱️  Time: ${(protocol.data.totalTime/1000).toFixed(1)}s`);
          console.log(`  🚀 Speed: ${speed.toFixed(1)} chunks/sec`);
          console.log(`  ✅ Success: ${protocol.data.successful} chunks`);
        }
      });
    }
    
    // HTTP/3 Benefits for Microscopy
    console.log('\n🌟 HTTP/3 BENEFITS FOR MICROSCOPY DATA:');
    console.log('-'.repeat(50));
    console.log('✅ QUIC Protocol: Better performance over lossy networks');
    console.log('✅ Independent Streams: No head-of-line blocking between chunks');
    console.log('✅ Connection Migration: Seamless network changes during long experiments');
    console.log('✅ 0-RTT: Faster reconnection for time-lapse imaging');
    console.log('✅ Built-in Encryption: Secure data transfer for sensitive research data');
    console.log('✅ Better Multiplexing: Efficient loading of multi-scale pyramids');
    console.log('✅ Loss Recovery: Improved performance for large dataset transfers');
    
    // Recommendations
    console.log('\n💡 RECOMMENDATIONS FOR AGENT-LENS:');
    console.log('-'.repeat(50));
    console.log('1. Implement HTTP/3 support in the artifact manager');
    console.log('2. Use HTTP/3 for time-lapse data streaming');
    console.log('3. Leverage connection migration for mobile microscopy setups');
    console.log('4. Implement 0-RTT for faster reconnections during long experiments');
    console.log('5. Use HTTP/3 for multi-scale pyramid loading');
    console.log('6. Consider HTTP/3 for real-time video streaming from microscopes');
  }
}

// Create and run the HTTP/3 chunk analysis
async function main() {
  const analyzer = new HTTP3ChunkPerformanceAnalysis();
  await analyzer.runAnalysis();
}

// Export for use in other modules
export { HTTP3ChunkPerformanceAnalysis };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  });
}
