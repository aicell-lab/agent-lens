/**
 * ZIP Creation Test - Testing the create-zip-file endpoint for batch requests
 * Usage: node performance-analysis/zip_creation_test.js
 */

class ZipCreationTest {
  constructor() {
    this.baseUrl = 'https://hypha.aicell.io/agent-lens/artifacts';
    this.datasetId = '20250824-example-data-20250824-221822';
    this.well = 'B2';
    this.scaleLevel = 3;
  }

  async testZipCreation() {
    console.log('🔬 Testing ZIP Creation for Batch Requests');
    console.log(`Dataset: ${this.datasetId}, Well: ${this.well}`);
    
    const chunkPaths = [
      'data.zarr/3/0.2.0.21.21',
      'data.zarr/3/0.2.0.22.22', 
      'data.zarr/3/0.0.0.21.22'
    ];
    
    // Test 1: Create zip with specific files from the artifact
    console.log('\n🧪 Test 1: Create zip with specific files');
    await this.testCreateZipWithFiles(chunkPaths);
    
    // Test 2: Try different file parameter formats
    console.log('\n🧪 Test 2: Different file parameter formats');
    await this.testDifferentFileFormats(chunkPaths);
    
    // Test 3: Test if we can create a zip from zip-files endpoint
    console.log('\n🧪 Test 3: Create zip from zip-files endpoint');
    await this.testCreateZipFromZipFiles(chunkPaths);
    
    // Test 4: Test the files parameter response
    console.log('\n🧪 Test 4: Investigate files parameter response');
    await this.testFilesParameterResponse(chunkPaths);
  }
  
  async testCreateZipWithFiles(paths) {
    // Test different ways to specify files for zip creation
    const tests = [
      {
        name: 'Comma-separated files',
        url: `${this.baseUrl}/${this.datasetId}/create-zip-file?file=${paths.join(',')}`
      },
      {
        name: 'Array format files',
        url: `${this.baseUrl}/${this.datasetId}/create-zip-file?file=${JSON.stringify(paths)}`
      },
      {
        name: 'Multiple file parameters',
        url: `${this.baseUrl}/${this.datasetId}/create-zip-file?${paths.map(p => `file=${p}`).join('&')}`
      },
      {
        name: 'Files parameter (comma-separated)',
        url: `${this.baseUrl}/${this.datasetId}/create-zip-file?files=${paths.join(',')}`
      },
      {
        name: 'Files parameter (array)',
        url: `${this.baseUrl}/${this.datasetId}/create-zip-file?files=${JSON.stringify(paths)}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testDifferentFileFormats(paths) {
    // Test different ways to encode the file paths
    const baseUrl = `${this.baseUrl}/${this.datasetId}/create-zip-file`;
    
    const tests = [
      {
        name: 'URL encoded paths',
        url: `${baseUrl}?file=${paths.map(p => encodeURIComponent(p)).join(',')}`
      },
      {
        name: 'Space-separated paths',
        url: `${baseUrl}?file=${paths.join(' ')}`
      },
      {
        name: 'Semicolon-separated paths',
        url: `${baseUrl}?file=${paths.join(';')}`
      },
      {
        name: 'Pipe-separated paths',
        url: `${baseUrl}?file=${paths.join('|')}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testCreateZipFromZipFiles(paths) {
    // Try to create a zip from the zip-files endpoint
    const baseUrl = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip`;
    
    const tests = [
      {
        name: 'Create zip with create-zip parameter',
        url: `${baseUrl}?create-zip=true&file=${paths.join(',')}`
      },
      {
        name: 'Create zip with zip parameter',
        url: `${baseUrl}?zip=true&file=${paths.join(',')}`
      },
      {
        name: 'Create zip with format=zip',
        url: `${baseUrl}?format=zip&file=${paths.join(',')}`
      },
      {
        name: 'Create zip with action=create',
        url: `${baseUrl}?action=create&file=${paths.join(',')}`
      }
    ];
    
    for (const test of tests) {
      console.log(`\n🔗 ${test.name}: ${test.url}`);
      await this.testApproach(test.url, test.name);
    }
  }
  
  async testFilesParameterResponse(paths) {
    // Investigate what the files parameter actually returns
    const url = `${this.baseUrl}/${this.datasetId}/zip-files/well_${this.well}_96.zip?files=${paths.join(',')}`;
    console.log(`🔗 Files parameter URL: ${url}`);
    
    const startTime = performance.now();
    
    try {
      const response = await fetch(url);
      const endTime = performance.now();
      
      console.log(`📊 Response: ${response.status} ${response.statusText}`);
      console.log(`⏱️  Time: ${(endTime - startTime).toFixed(0)}ms`);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        console.log(`📄 Content-Type: ${contentType}`);
        
        const data = await response.text();
        console.log(`✅ Success: ${data.length} characters`);
        console.log(`📄 Content: ${data}`);
        
        // Try to parse as JSON
        try {
          const json = JSON.parse(data);
          console.log(`📁 JSON data:`, json);
        } catch (e) {
          console.log(`📄 Raw text data`);
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
        
        // If it's a zip file, we should see a zip signature
        if (data.byteLength > 4) {
          const view = new Uint8Array(data);
          const signature = Array.from(view.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
          console.log(`📦 File signature: ${signature}`);
          
          if (signature === '504b0304' || signature === '504b0506' || signature === '504b0708') {
            console.log(`🎉 This looks like a ZIP file!`);
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

  async run() {
    await this.testZipCreation();
  }
}

// Run the test
async function main() {
  const tester = new ZipCreationTest();
  await tester.run();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default ZipCreationTest;
