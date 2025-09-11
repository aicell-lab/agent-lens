/**
 * Enhanced Bulk Fetch Test - Testing true batch file requests
 * Usage: node performance-analysis/enhanced_bulk_fetch_test.js
 */

class EnhancedBulkFetchTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 3;
  }

  async testBulkFetch() {
    console.log('🔬 Testing Enhanced Bulk Fetch Approaches');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    
    const chunkPaths = [
      'data.zarr/3/0.2.0.21.21',
      'data.zarr/3/0.2.0.22.22', 
      'data.zarr/3/0.0.0.21.22'
    ];
    
    // Test 1: Verify single file access works
    console.log('\n🧪 Test 1: Single file access (baseline)');
    await this.testSingleFile(chunkPaths[0]);
    
    // Test 2: Directory listing with multiple paths (what we know works)
    console.log('\n🧪 Test 2: Directory listing with multiple paths');
    await this.testDirectoryListing(chunkPaths);
    
    // Test 3: Try to fetch multiple files as a zip archive
    console.log('\n🧪 Test 3: Create zip with specific files');
    await this.testCreateZipWithFiles(chunkPaths);
    
    // Test 4: Try different batch request formats
    console.log('\n🧪 Test 4: Alternative batch request formats');
    await this.testAlternativeFormats(chunkPaths);
    
    // Test 5: Test if we can request multiple files in one request
    console.log('\n🧪 Test 5: Multiple file requests in one call');
    await this.testMultipleFileRequests(chunkPaths);
    
    // Test 6: Test range requests for batch data
    console.log('\n🧪 Test 6: Range requests for batch data');
    await this.testRangeRequests(chunkPaths);
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
  
  async testDirectoryListing(paths) {
    const multiPathUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?${paths.map(p => `path=${p}`).join('&')}`;
    console.log(`🔗 Directory listing URL: ${multiPathUrl}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(multiPathUrl);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const data = await response.text();
        console.log(`✅ Success: ${data.length} characters`);
        try {
          const json = JSON.parse(data);
          console.log(`📁 Directory contents:`, json);
        } catch (e) {
          console.log(`📄 Raw data (first 200 chars):`, data.substring(0, 200));
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
  
  async testCreateZipWithFiles(paths) {
    // Try to create a zip file containing only the specified files
    const url = `${this.baseUrl}/${this.datasetId}/create-zip-file?file=${paths.join(',')}`;
    console.log(`🔗 Create zip URL: ${url}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes (zip file)`);
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
  
  async testAlternativeFormats(paths) {
    const baseUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip`;
    
    // Test different ways to specify multiple files
    const tests = [
      {
        name: 'Array format in path',
        url: `${baseUrl}?path=[${paths.map(p => `"${p}"`).join(',')}]`
      },
      {
        name: 'Space-separated paths',
        url: `${baseUrl}?path=${paths.join(' ')}`
      },
      {
        name: 'Newline-separated paths',
        url: `${baseUrl}?path=${paths.join('\n')}`
      },
      {
        name: 'URL-encoded array',
        url: `${baseUrl}?path=${encodeURIComponent(JSON.stringify(paths))}`
      },
      {
        name: 'Files parameter',
        url: `${baseUrl}?files=${paths.join(',')}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testMultipleFileRequests(paths) {
    // Try to make a single request that returns multiple files
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${paths.join(',')}&format=multipart`;
    console.log(`🔗 Multipart format URL: ${url}`);
    
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
        
        if (contentType && contentType.includes('multipart')) {
          console.log(`🎉 Found multipart response!`);
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
  
  async testRangeRequests(paths) {
    // Test if we can use range requests to get multiple files
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${paths[0]}`;
    console.log(`🔗 Range request test URL: ${url}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(url, {
        headers: {
          'Range': 'bytes=0-65535' // Request first 64KB
        }
      });
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok || response.status === 206) {
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes (range request)`);
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
  
  async testApproach(url, name) {
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

  async run() {
    await this.testBulkFetch();
  }
}

// Run the test
async function main() {
  const tester = new EnhancedBulkFetchTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default EnhancedBulkFetchTest;
