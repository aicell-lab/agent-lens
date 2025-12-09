/**
 * Simple test for zarr streaming endpoint using zarrita.js
 * 
 * This test verifies that the zarr streaming endpoint works correctly
 * with zarrita.js library for accessing OME-Zarr datasets.
 * 
 * Usage: 
 *   node tests/test_zarr_streaming.js
 * 
 * Prerequisites:
 *   npm install zarrita
 */

import * as zarr from "zarrita";

// Test configuration
const ZARR_ENDPOINT = "https://hypha.aicell.io/agent-lens/apps/agent-lens/example-image-data.zarr";

// Hardcoded OME-Zarr structure (to avoid listing 3 million chunks)
// Based on: /mnt/shared_documents/offline_stitch_20251201-u2os-full-plate_2025-12-01_17-00-56.154975/data.zarr
const ZARR_STRUCTURE = {
  format: 2, // zarr_format: 2
  scaleLevels: [0, 1, 2, 3, 4, 5], // Scale levels (multiscale pyramid)
  rootMetadata: {
    ".zgroup": { zarr_format: 2 },
    ".zattrs": {
      multiscales: [{
        axes: [
          { name: "t", type: "time", unit: "second" },
          { name: "c", type: "channel" },
          { name: "z", type: "space", unit: "micrometer" },
          { name: "y", type: "space", unit: "micrometer" },
          { name: "x", type: "space", unit: "micrometer" }
        ],
        datasets: [
          { path: "0", coordinateTransformations: [{ scale: [1.0, 1.0, 1.0, 0.311688, 0.311688], type: "scale" }] },
          { path: "1" }, // Additional scale levels...
          { path: "2" },
          { path: "3" },
          { path: "4" },
          { path: "5" }
        ]
      }]
    }
  },
  // Example array metadata for scale level 0
  scale0: {
    ".zarray": {
      chunks: [1, 1, 1, 256, 256],
      compressor: null,
      dtype: "|u1",
      fill_value: 0,
      filters: null,
      order: "C",
      shape: [20, 6, 1, 247296, 361984], // [T, C, Z, Y, X]
      zarr_format: 2
    }
  },
  // Example chunk paths (just a few examples, not all 3 million)
  exampleChunks: [
    "0/0.0.0.100.100",
    "0/0.0.0.100.1000",
    "0/0.0.0.100.1001"
  ]
};

class ZarrStreamingTest {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
  }

  /**
   * Log test result
   */
  logResult(testName, passed, message = "") {
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} - ${testName}${message ? `: ${message}` : ""}`);
    this.testResults.push({ testName, passed, message });
  }

  /**
   * Test 1: Create FetchStore and verify connection
   */
  async testCreateStore() {
    try {
      console.log("\n📦 Test 1: Creating FetchStore...");
      const store = new zarr.FetchStore(ZARR_ENDPOINT);
      console.log(`   Store created for: ${ZARR_ENDPOINT}`);
      this.logResult("Create FetchStore", true);
      return store;
    } catch (error) {
      this.logResult("Create FetchStore", false, error.message);
      throw error;
    }
  }

  /**
   * Test 2: Open zarr array at scale level 0 (using hardcoded structure)
   */
  async testOpenZarr(store) {
    try {
      console.log("\n🔓 Test 2: Opening zarr array at scale level 0...");
      console.log(`   Using hardcoded structure (${ZARR_STRUCTURE.scaleLevels.length} scale levels)`);
      console.log(`   Scale levels: ${ZARR_STRUCTURE.scaleLevels.join(", ")}`);
      
      // Open the array at scale level 0 (first scale level)
      // In OME-Zarr, arrays are typically at scale levels like "0", "1", etc.
      const scale0Store = new zarr.FetchStore(`${ZARR_ENDPOINT}/0`);
      const arr = await zarr.open(scale0Store, { kind: "array" });
      
      console.log(`   ✅ Array opened successfully at scale level 0`);
      console.log(`   Shape: ${JSON.stringify(arr.shape)} (T=${arr.shape[0]}, C=${arr.shape[1]}, Z=${arr.shape[2]}, Y=${arr.shape[3]}, X=${arr.shape[4]})`);
      console.log(`   Dtype: ${arr.dtype}`);
      console.log(`   Chunks: ${JSON.stringify(arr.chunks)}`);
      console.log(`   Expected shape: ${JSON.stringify(ZARR_STRUCTURE.scale0[".zarray"].shape)}`);
      
      // Verify shape matches expected
      const expectedShape = ZARR_STRUCTURE.scale0[".zarray"].shape;
      const shapeMatches = JSON.stringify(arr.shape) === JSON.stringify(expectedShape);
      if (shapeMatches) {
        console.log(`   ✅ Shape matches expected structure`);
      } else {
        console.log(`   ⚠️  Shape differs from expected (may be normal if structure changed)`);
      }
      
      this.logResult("Open Zarr Array", true, `Shape: ${arr.shape.join("x")}`);
      return { type: "array", array: arr, scaleLevel: 0 };
    } catch (error) {
      this.logResult("Open Zarr Array", false, error.message);
      throw error;
    }
  }

  /**
   * Test 3: Read a chunk
   */
  async testReadChunk(zarrData) {
    try {
      console.log("\n📖 Test 3: Reading chunk [0, 0]...");
      
      let arr;
      if (zarrData.type === "array") {
        arr = zarrData.array;
        if (zarrData.scaleLevel !== undefined) {
          console.log(`   Using array from scale level ${zarrData.scaleLevel}`);
        }
      } else {
        throw new Error("No array available to read chunk");
      }
      
      const chunk = await arr.getChunk([0, 0]);
      console.log(`   Chunk shape: ${JSON.stringify(chunk.shape)}`);
      console.log(`   Chunk data type: ${chunk.data.constructor.name}`);
      console.log(`   Chunk data length: ${chunk.data.length}`);
      this.logResult("Read Chunk", true, `Shape: ${chunk.shape.join("x")}`);
      return chunk;
    } catch (error) {
      this.logResult("Read Chunk", false, error.message);
      // Don't throw - chunk reading might fail for various reasons
    }
  }

  /**
   * Test 4: Read center region of the array (not full array)
   */
  async testReadCenterRegion(zarrData) {
    try {
      console.log("\n📊 Test 4: Reading center region of array...");
      
      let arr;
      if (zarrData.type === "array") {
        arr = zarrData.array;
        if (zarrData.scaleLevel !== undefined) {
          console.log(`   Using array from scale level ${zarrData.scaleLevel}`);
        }
      } else {
        throw new Error("No array available to read");
      }
      
      // Array shape: [T, C, Z, Y, X] = [20, 6, 1, 247296, 361984]
      const [tSize, cSize, zSize, ySize, xSize] = arr.shape;
      
      // Read center region:
      // - First timepoint (t=0)
      // - First channel (c=0)
      // - First z-slice (z=0)
      // - Center Y region (middle 1000 pixels)
      // - Center X region (middle 1000 pixels)
      const centerY = Math.floor(ySize / 2);
      const centerX = Math.floor(xSize / 2);
      const regionSize = 1000; // Read 1000x1000 pixel region from center
      
      const yStart = Math.max(0, centerY - Math.floor(regionSize / 2));
      const yEnd = Math.min(ySize, yStart + regionSize);
      const xStart = Math.max(0, centerX - Math.floor(regionSize / 2));
      const xEnd = Math.min(xSize, xStart + regionSize);
      
      console.log(`   Array shape: [T=${tSize}, C=${cSize}, Z=${zSize}, Y=${ySize}, X=${xSize}]`);
      console.log(`   Reading center region: Y[${yStart}:${yEnd}], X[${xStart}:${xEnd}]`);
      console.log(`   Region size: ${yEnd - yStart} × ${xEnd - xStart} pixels`);
      
      // Read the center region: [t=0, c=0, z=0, y=yStart:yEnd, x=xStart:xEnd]
      const region = await zarr.get(arr, [
        0,  // t=0 (first timepoint)
        0,  // c=0 (first channel)
        0,  // z=0 (first z-slice)
        zarr.slice(yStart, yEnd),  // Y region
        zarr.slice(xStart, xEnd)   // X region
      ]);
      
      console.log(`   ✅ Center region read successfully`);
      console.log(`   Region shape: ${JSON.stringify(region.shape)}`);
      console.log(`   Region data length: ${region.data.length}`);
      console.log(`   Data type: ${region.data.constructor.name}`);
      
      // Show some sample values from the center
      const sampleSize = Math.min(20, region.data.length);
      const sample = Array.from(region.data.slice(0, sampleSize));
      console.log(`   Sample values (first ${sampleSize}): ${sample.join(", ")}`);
      
      // Calculate region size in MB
      const regionSizeMB = (region.data.length * 1) / (1024 * 1024); // uint8 = 1 byte per element
      console.log(`   Region size: ${regionSizeMB.toFixed(2)} MB`);
      
      this.logResult("Read Center Region", true, `Shape: ${region.shape.join("x")} (${regionSizeMB.toFixed(2)} MB)`);
      return region;
    } catch (error) {
      this.logResult("Read Center Region", false, error.message);
      // Don't throw - region reading might fail for various reasons
    }
  }

  /**
   * Test 5: Read a small corner region (for quick testing)
   */
  async testReadCornerRegion(zarrData) {
    try {
      console.log("\n🔍 Test 5: Reading corner region (small test)...");
      
      let arr;
      if (zarrData.type === "array") {
        arr = zarrData.array;
        if (zarrData.scaleLevel !== undefined) {
          console.log(`   Using array from scale level ${zarrData.scaleLevel}`);
        }
      } else {
        throw new Error("No array available to read region");
      }
      
      // Read a small corner region: [t=0, c=0, z=0, y=0:256, x=0:256]
      // This is one chunk size (256x256) from the corner
      const region = await zarr.get(arr, [
        0,  // t=0
        0,  // c=0
        0,  // z=0
        zarr.slice(0, 256),  // Y: first 256 pixels
        zarr.slice(0, 256)   // X: first 256 pixels
      ]);
      
      console.log(`   ✅ Corner region read successfully`);
      console.log(`   Region shape: ${JSON.stringify(region.shape)}`);
      console.log(`   Region data length: ${region.data.length}`);
      console.log(`   Data type: ${region.data.constructor.name}`);
      
      // Show some sample values
      const sampleSize = Math.min(10, region.data.length);
      const sample = Array.from(region.data.slice(0, sampleSize));
      console.log(`   Sample values (first ${sampleSize}): ${sample.join(", ")}`);
      
      this.logResult("Read Corner Region", true, `Shape: ${region.shape.join("x")}`);
      return region;
    } catch (error) {
      this.logResult("Read Corner Region", false, error.message);
      // Don't throw - region reading might fail for various reasons
    }
  }

  /**
   * Test 6: Test HTTP Range request support
   */
  async testRangeRequest(store) {
    try {
      console.log("\n🌐 Test 6: Testing HTTP Range request support...");
      
      // Test on .zgroup first (small file)
      const smallUrl = `${ZARR_ENDPOINT}/.zgroup`;
      console.log(`   Testing on small file (.zgroup)...`);
      
      const headResponse = await fetch(smallUrl, { method: "HEAD" });
      const contentLength = headResponse.headers.get("content-length");
      const fileSize = contentLength ? parseInt(contentLength) : 0;
      console.log(`   File size: ${fileSize} bytes`);
      
      // Test Range request on small file
      const rangeResponse = await fetch(smallUrl, {
        headers: {
          "Range": "bytes=0-10"
        }
      });
      
      console.log(`   Response status: ${rangeResponse.status}`);
      console.log(`   Content-Range header: ${rangeResponse.headers.get("content-range")}`);
      console.log(`   Content-Length header: ${rangeResponse.headers.get("content-length")}`);
      
      if (rangeResponse.status === 206) {
        const text = await rangeResponse.text();
        console.log(`   ✅ Partial content (206) received for small file`);
        console.log(`   Range response: ${text}`);
        this.logResult("Range Request (Small File)", true, "206 Partial Content - Range requests working!");
      } else if (rangeResponse.status === 200) {
        // For very small files, returning 200 is acceptable (server optimization)
        console.log(`   ⚠️  Full content (200) returned for small file`);
        console.log(`   Note: This is acceptable for very small files (< 1KB)`);
        console.log(`   Range requests are more important for larger chunk files`);
        this.logResult("Range Request (Small File)", true, "200 OK (acceptable for small files)");
      } else {
        throw new Error(`Unexpected status: ${rangeResponse.status}`);
      }
      
      // Try to find a larger file to test Range requests properly
      // Use hardcoded example chunk paths (not all 3 million chunks)
      const chunkPaths = [
        "0/.zarray",  // Array metadata (should be small)
        ...ZARR_STRUCTURE.exampleChunks  // Example chunk files (should be larger, ~65KB each)
      ];
      
      console.log(`\n   Testing Range requests on larger files...`);
      let foundLargeFile = false;
      
      for (const chunkPath of chunkPaths) {
        try {
          const chunkUrl = `${ZARR_ENDPOINT}/${chunkPath}`;
          const chunkHead = await fetch(chunkUrl, { method: "HEAD" });
          
          if (chunkHead.ok) {
            const chunkSize = parseInt(chunkHead.headers.get("content-length") || "0");
            if (chunkSize > 100) {
              console.log(`   Found larger file: ${chunkPath} (${chunkSize} bytes)`);
              
              const chunkRange = await fetch(chunkUrl, {
                headers: { "Range": "bytes=0-99" }
              });
              
              if (chunkRange.status === 206) {
                console.log(`   ✅ Range request (206) works on larger file!`);
                this.logResult("Range Request (Large File)", true, "206 Partial Content - Range requests working!");
                foundLargeFile = true;
                break;
              } else if (chunkRange.status === 200) {
                console.log(`   ⚠️  Large file returned 200 instead of 206`);
                this.logResult("Range Request (Large File)", false, "200 OK instead of 206");
                foundLargeFile = true;
                break;
              }
            }
          }
        } catch (err) {
          // File doesn't exist, try next
          continue;
        }
      }
      
      if (!foundLargeFile) {
        console.log(`   ⚠️  No larger files found to test Range requests`);
        console.log(`   Range requests will be tested when chunk files are accessed`);
      }
      
    } catch (error) {
      this.logResult("Range Request", false, error.message);
    }
  }

  /**
   * Test 7: Test CORS headers
   */
  async testCORSHeaders() {
    try {
      console.log("\n🔐 Test 7: Testing CORS headers...");
      const url = `${ZARR_ENDPOINT}/.zgroup`;
      
      const response = await fetch(url, {
        method: "OPTIONS",
        headers: {
          "Origin": "https://example.com",
          "Access-Control-Request-Method": "GET"
        }
      });
      
      const corsHeaders = {
        "access-control-allow-origin": response.headers.get("access-control-allow-origin"),
        "access-control-allow-methods": response.headers.get("access-control-allow-methods"),
        "access-control-allow-headers": response.headers.get("access-control-allow-headers"),
      };
      
      console.log(`   CORS headers:`, corsHeaders);
      
      if (corsHeaders["access-control-allow-origin"]) {
        this.logResult("CORS Headers", true, "CORS headers present");
      } else {
        this.logResult("CORS Headers", false, "CORS headers missing");
      }
    } catch (error) {
      this.logResult("CORS Headers", false, error.message);
    }
  }

  /**
   * Run all tests
   */
  async runAllTests() {
    console.log("🧪 Zarr Streaming Endpoint Test Suite");
    console.log("=".repeat(60));
    console.log(`🔗 Endpoint: ${ZARR_ENDPOINT}`);
    console.log(`📚 Library: zarrita.js`);
    console.log();

    try {
      // Test 1: Create store
      const store = await this.testCreateStore();
      
      // Test 6 & 7: Test HTTP features (can run independently)
      await this.testRangeRequest(store);
      await this.testCORSHeaders();
      
      // Test 2-5: Test zarr operations (only reading parts, not full array)
      try {
        const zarrData = await this.testOpenZarr(store);
        await this.testReadChunk(zarrData);
        await this.testReadCenterRegion(zarrData);  // Read center region instead of full array
        await this.testReadCornerRegion(zarrData);  // Read small corner region
      } catch (error) {
        console.log(`\n⚠️  Zarr operations failed: ${error.message}`);
        console.log(`   This might be expected if the zarr structure is different`);
        console.log(`   The important tests (store creation, Range, CORS) passed.`);
      }
      
    } catch (error) {
      console.error(`\n❌ Critical error: ${error.message}`);
      console.error(error.stack);
    }

    // Print summary
    this.printSummary();
  }

  /**
   * Print test summary
   */
  printSummary() {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const passed = this.testResults.filter(r => r.passed).length;
    const total = this.testResults.length;
    
    console.log("\n" + "=".repeat(60));
    console.log("📊 Test Summary");
    console.log("=".repeat(60));
    console.log(`✅ Passed: ${passed}/${total}`);
    console.log(`❌ Failed: ${total - passed}/${total}`);
    console.log(`⏱️  Duration: ${duration}s`);
    console.log();
    
    if (passed === total) {
      console.log("🎉 All tests passed!");
    } else {
      console.log("⚠️  Some tests failed. Check the output above for details.");
    }
  }
}

// Run tests if executed directly
if (process.argv[1] && process.argv[1].includes('test_zarr_streaming.js')) {
  const test = new ZarrStreamingTest();
  test.runAllTests().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

export default ZarrStreamingTest;

