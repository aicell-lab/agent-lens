/**
 * True Batch Request Test - Finding efficient batch file requests
 * Usage: node performance-analysis/true_batch_test.js
 */

class TrueBatchTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 3;
  }

  async testTrueBatchRequests() {
    console.log('🔬 Testing True Batch Request Solutions');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    
    const chunkPaths = [
      'data.zarr/3/0.2.0.21.21',
      'data.zarr/3/0.2.0.22.22', 
      'data.zarr/3/0.0.0.21.22'
    ];
    
    // Test 1: Verify single file access works (baseline)
    console.log('\n🧪 Test 1: Single file access (baseline)');
    await this.testSingleFile(chunkPaths[0]);
    
    // Test 2: Test if we can request multiple files in one zip-files request
    console.log('\n🧪 Test 2: Multiple files in zip-files request');
    await this.testMultipleFilesInZipFiles(chunkPaths);
    
    // Test 3: Test different approaches for batch requests
    console.log('\n🧪 Test 3: Alternative batch request approaches');
    await this.testAlternativeBatchApproaches(chunkPaths);
    
    // Test 4: Test if we can use HTTP/2 multiplexing or other techniques
    console.log('\n🧪 Test 4: HTTP/2 and connection reuse');
    await this.testConnectionReuse(chunkPaths);
    
    // Test 5: Test if we can use range requests for multiple files
    console.log('\n🧪 Test 5: Range requests for multiple files');
    await this.testRangeRequestsForMultipleFiles(chunkPaths);
  }
  
  async testSingleFile(path) {
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${path}`;
    console.log(`🔗 Single file URL: ${url}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes`);
        return true;
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
        return false;
      }
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
      return false;
    }
  }
  
  async testMultipleFilesInZipFiles(paths) {
    const baseUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip`;
    
    const tests = [
      {
        name: 'Multiple path parameters',
        url: `${baseUrl}?${paths.map(p => `path=${p}`).join('&')}`
      },
      {
        name: 'Comma-separated in path',
        url: `${baseUrl}?path=${paths.join(',')}`
      },
      {
        name: 'Semicolon-separated in path',
        url: `${baseUrl}?path=${paths.join(';')}`
      },
      {
        name: 'Pipe-separated in path',
        url: `${baseUrl}?path=${paths.join('|')}`
      },
      {
        name: 'Array format in path',
        url: `${baseUrl}?path=${JSON.stringify(paths)}`
      },
      {
        name: 'Files parameter',
        url: `${baseUrl}?files=${paths.join(',')}`
      },
      {
        name: 'Multiple files parameters',
        url: `${baseUrl}?${paths.map(p => `files=${p}`).join('&')}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testAlternativeBatchApproaches(paths) {
    const baseUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip`;
    
    const tests = [
      {
        name: 'Batch parameter',
        url: `${baseUrl}?batch=true&path=${paths.join(',')}`
      },
      {
        name: 'Multiple parameter',
        url: `${baseUrl}?multiple=true&path=${paths.join(',')}`
      },
      {
        name: 'Format multipart',
        url: `${baseUrl}?format=multipart&path=${paths.join(',')}`
      },
      {
        name: 'Format json',
        url: `${baseUrl}?format=json&path=${paths.join(',')}`
      },
      {
        name: 'Action batch',
        url: `${baseUrl}?action=batch&path=${paths.join(',')}`
      },
      {
        name: 'Mode batch',
        url: `${baseUrl}?mode=batch&path=${paths.join(',')}`
      },
      {
        name: 'Type files',
        url: `${baseUrl}?type=files&path=${paths.join(',')}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testConnectionReuse(paths) {
    console.log('\n🔗 Testing connection reuse with parallel requests');
    
    const startTime = performance.now();
    
    try {
      // Make parallel requests to the same endpoint
      const requests = paths.map(path => 
        fetch(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${path}`)
      );
      
      const responses = await Promise.all(requests);
      const endTime = performance.now();
      
      console.log(`📊 All requests completed in ${(endTime - startTime).toFixed(0)}ms`);
      
      let totalBytes = 0;
      let successCount = 0;
      
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];
        if (response.ok) {
          const data = await response.arrayBuffer();
          totalBytes += data.byteLength;
          successCount++;
          console.log(`✅ File ${i + 1}: ${data.byteLength} bytes`);
        } else {
          console.log(`❌ File ${i + 1}: ${response.status} ${response.statusText}`);
        }
      }
      
      console.log(`📊 Total: ${successCount}/${paths.length} files, ${totalBytes} bytes`);
      console.log(`⏱️  Average per file: ${((endTime - startTime) / paths.length).toFixed(0)}ms`);
      
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
    }
  }
  
  async testRangeRequestsForMultipleFiles(paths) {
    console.log('\n🔗 Testing range requests for multiple files');
    
    // Test if we can use range requests to get multiple files
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${paths[0]}`;
    
    const tests = [
      {
        name: 'Single range request',
        headers: { 'Range': 'bytes=0-65535' }
      },
      {
        name: 'Multiple range request',
        headers: { 'Range': 'bytes=0-65535,131072-196607' }
      },
      {
        name: 'Custom range request',
        headers: { 'Range': 'bytes=0-32767,32768-65535,65536-98303' }
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${url}`);
      await this.testApproachWithHeaders(url, test.name, test.headers);
    }
  }
  
  async testApproach(url, name) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        console.log(`📄 Content-Type: ${contentType}`);
        
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes`);
        
        // Check if it's a zip file
        if (data.byteLength > 4) {
          const view = new Uint8Array(data);
          const signature = Array.from(view.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
          if (signature === '504b0304' || signature === '504b0506' || signature === '504b0708') {
            console.log(`📦 ZIP file detected`);
          }
        }
        
        // Check if it's JSON
        if (contentType && contentType.includes('json')) {
          try {
            const text = new TextDecoder().decode(data);
            const json = JSON.parse(text);
            console.log(`📁 JSON data:`, json);
          } catch (e) {
            console.log(`📄 Text data (first 200 chars):`, new TextDecoder().decode(data).substring(0, 200));
          }
        }
        
        return true;
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
        return false;
      }
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
      return false;
    }
  }
  
  async testApproachWithHeaders(url, name, headers) {
    const startTime = performance.now();
    
    try {
      const response = await fetch(url, { headers });
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok || response.status === 206) {
        const contentType = response.headers.get('content-type');
        const contentRange = response.headers.get('content-range');
        console.log(`📄 Content-Type: ${contentType}`);
        if (contentRange) console.log(`📄 Content-Range: ${contentRange}`);
        
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes`);
        
        return true;
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
        return false;
      }
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
      return false;
    }
  }

  async run() {
    await this.testTrueBatchRequests();
  }
}

// Run the test
async function main() {
  const tester = new TrueBatchTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default TrueBatchTest;
