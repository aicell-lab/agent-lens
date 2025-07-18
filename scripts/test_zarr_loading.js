// scripts/test_zarr_loading.js
// Usage: node scripts/test_zarr_loading.js
// Requires: npm install node-fetch pngjs zarrita fs path

// This script previews scale 3 chunks as PNG images
// Following OME-Zarr 0.4 specification: 5D array (T, C, Z, Y, X)

import fetch from 'node-fetch';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://hypha.aicell.io/agent-lens/artifacts/test-20250718-115143/zip-files/well_A2_96.zip/~/data.zarr/';

// OME-Zarr 0.4 specification parameters
const T = 0;  // Time point
const C = 0;  // Channel
const Z = 0;  // Z-slice
const SCALE = 3;  // Scale level

// Create output directory
const OUTPUT_DIR = `./scale_${SCALE}_preview`;
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function fetchJSON(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching JSON from ${url}:`, error.message);
        return null;
    }
}

async function fetchArrayBuffer(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.arrayBuffer();
    } catch (error) {
        console.error(`Error fetching array buffer from ${url}:`, error.message);
        return null;
    }
}

function decodeChunk(chunkData, chunkShape, dataType = 'uint16') {
    // Convert ArrayBuffer to appropriate data type
    let array;
    switch (dataType) {
        case 'uint8':
        case '|u1':
            array = new Uint8Array(chunkData);
            break;
        case 'uint16':
        case '|u2':
            array = new Uint16Array(chunkData);
            break;
        default:
            throw new Error(`Unsupported data type: ${dataType}`);
    }
    
    // Reshape array to 2D for PNG creation
    const [height, width] = chunkShape;
    const pixels = new Uint8Array(width * height * 4); // RGBA
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIndex = y * width + x;
            const dstIndex = (y * width + x) * 4;
            
            // Get pixel value and handle different bit depths
            const value = array[srcIndex];
            let normalizedValue;
            
            if (dataType === 'uint8' || dataType === '|u1') {
                // 8-bit data is already in the correct range
                normalizedValue = value;
            } else {
                // 16-bit data needs normalization
                normalizedValue = Math.floor((value / 65535) * 255);
            }
            
            // Create grayscale image (R=G=B=value, A=255)
            pixels[dstIndex] = normalizedValue;     // R
            pixels[dstIndex + 1] = normalizedValue; // G
            pixels[dstIndex + 2] = normalizedValue; // B
            pixels[dstIndex + 3] = 255;             // A
        }
    }
    
    return { width, height, pixels };
}

function createPNG(width, height, pixels) {
    const png = new PNG({ width, height });
    png.data = pixels;
    return png;
}

async function saveChunkAsPNG(chunkData, chunkShape, filename, dataType = 'uint16') {
    try {
        const decoded = decodeChunk(chunkData, chunkShape, dataType);
        const png = createPNG(decoded.width, decoded.height, decoded.pixels);
        
        const outputPath = path.join(OUTPUT_DIR, filename);
        const buffer = PNG.sync.write(png);
        fs.writeFileSync(outputPath, buffer);
        
        console.log(`✓ Saved: ${filename} (${decoded.width}x${decoded.height})`);
        return true;
    } catch (error) {
        console.error(`✗ Error saving ${filename}:`, error.message);
        return false;
    }
}

async function getScaleInfo(scaleLevel) {
    const scaleUrl = `${BASE_URL}${scaleLevel}/`;
    console.log(`\n📊 Fetching scale ${scaleLevel} information...`);
    
    // Get .zarray metadata
    const zarrayUrl = `${scaleUrl}.zarray`;
    const zarray = await fetchJSON(zarrayUrl);
    
    if (!zarray) {
        console.error(`❌ Could not fetch .zarray for scale ${scaleLevel}`);
        return null;
    }
    
    console.log(`📐 Scale ${scaleLevel} dimensions:`, zarray.shape);
    console.log(`🔲 Chunk shape:`, zarray.chunks);
    console.log(`📦 Data type:`, zarray.dtype);
    
    return zarray;
}

async function getChunkCoordinates(scaleLevel) {
    const zarray = await getScaleInfo(scaleLevel);
    if (!zarray) return null;
    
    const [, , , ySize, xSize] = zarray.shape;
    const [, , , yChunk, xChunk] = zarray.chunks;
    
    // Calculate chunk coordinates for T=0, C=0, Z=0
    const tCoord = 0;  // Since T=0 and we're looking at the first chunk
    const cCoord = 0;  // Since C=0 and we're looking at the first chunk  
    const zCoord = 0;  // Since Z=0 and we're looking at the first chunk
    
    const chunks = [];
    
    // Calculate Y and X chunk coordinates
    for (let y = 0; y < Math.ceil(ySize / yChunk); y++) {
        for (let x = 0; x < Math.ceil(xSize / xChunk); x++) {
            chunks.push({
                coordinates: [tCoord, cCoord, zCoord, y, x],
                filename: `chunk_t${tCoord}_c${cCoord}_z${zCoord}_y${y}_x${x}.png`
            });
        }
    }
    
    console.log(`🔍 Found ${chunks.length} chunks for T=${T}, C=${C}, Z=${Z}`);
    return { zarray, chunks };
}

async function downloadAndSaveChunks(scaleLevel) {
    const scaleInfo = await getChunkCoordinates(scaleLevel);
    if (!scaleInfo) return;
    
    const { zarray, chunks } = scaleInfo;
    const [, , , yChunk, xChunk] = zarray.chunks;
    
    console.log(`\n📥 Downloading and saving chunks...`);
    
    let successCount = 0;
    let totalCount = chunks.length;
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const [t, c, z, y, x] = chunk.coordinates;
        
        // Construct chunk URL (flat file naming convention)
        const chunkUrl = `${BASE_URL}${scaleLevel}/${t}.${c}.${z}.${y}.${x}`;
        
        console.log(`\n[${i + 1}/${totalCount}] Downloading: ${chunk.filename}`);
        console.log(`   URL: ${chunkUrl}`);
        
        const chunkData = await fetchArrayBuffer(chunkUrl);
        if (chunkData) {
            const success = await saveChunkAsPNG(
                chunkData, 
                [yChunk, xChunk], 
                chunk.filename, 
                zarray.dtype
            );
            if (success) successCount++;
        }
        
        // Small delay to be respectful to the server
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`\n✅ Preview complete!`);
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);
    console.log(`📊 Successfully saved: ${successCount}/${totalCount} chunks`);
    
    if (successCount > 0) {
        console.log(`\n🎯 To view all images:`);
        console.log(`   open ${OUTPUT_DIR}`);
    }
}

async function main() {
    console.log(`🔬 OME-Zarr Scale ${SCALE} Preview Tool`);
    console.log(`📍 Base URL: ${BASE_URL}`);
    console.log(`🎯 Parameters: T=${T}, C=${C}, Z=${Z}, Scale=${SCALE}`);
    console.log(`📁 Output: ${OUTPUT_DIR}`);
    
    try {
        await downloadAndSaveChunks(SCALE);
    } catch (error) {
        console.error(`❌ Script failed:`, error.message);
        process.exit(1);
    }
}

// Run the script
main();
