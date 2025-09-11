/**
 * Bulk Fetch Test - Testing multiple chunks in one request
 * Usage: node performance-analysis/bulk_fetch_test.js
 */

class BulkFetchTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 3;
  }

  async testBulkFetch() {
    console.log('🔬 Testing Different Bulk Fetch Approaches');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    
    const chunkPaths = [
      'data.zarr/3/0.2.0.21.21',
      'data.zarr/3/0.2.0.22.22', 
      'data.zarr/3/0.0.0.21.22'
    ];
    
    // Test 1: Comma-separated paths
    console.log('\n🧪 Test 1: Comma-separated paths');
    await this.testApproach(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${chunkPaths.join(',')}`, 'Comma-separated');
    
    // Test 2: Semicolon-separated paths
    console.log('\n🧪 Test 2: Semicolon-separated paths');
    await this.testApproach(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${chunkPaths.join(';')}`, 'Semicolon-separated');
    
    // Test 3: Pipe-separated paths
    console.log('\n🧪 Test 3: Pipe-separated paths');
    await this.testApproach(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${chunkPaths.join('|')}`, 'Pipe-separated');
    
    // Test 4: Multiple path parameters
    console.log('\n🧪 Test 4: Multiple path parameters');
    const multiPathUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?${chunkPaths.map(p => `path=${p}`).join('&')}`;
    await this.testApproach(multiPathUrl, 'Multiple path params');
    
    // Test 5: JSON array in path
    console.log('\n🧪 Test 5: JSON array in path');
    const jsonPath = encodeURIComponent(JSON.stringify(chunkPaths));
    await this.testApproach(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=${jsonPath}`, 'JSON array');
    
    // Test 6: Directory-level request
    console.log('\n🧪 Test 6: Directory-level request');
    await this.testApproach(`${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?path=data.zarr/3/`, 'Directory level');
  }
  
  async testApproach(url, name) {
    console.log(`🔗 ${name} URL: ${url}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const data = await response.arrayBuffer();
        console.log(`✅ Success: ${data.byteLength} bytes`);
      } else {
        console.log(`❌ Failed: ${response.statusText}`);
      }
    } catch (error) {
      const endTime = performance.now();
      console.log(`❌ Error: ${error.message} (${(endTime - startTime).toFixed(0)}ms)`);
    }
  }

  async run() {
    await this.testBulkFetch();
  }
}

// Run the test
async function main() {
  const tester = new BulkFetchTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default BulkFetchTest;
