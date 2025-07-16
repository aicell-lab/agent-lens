// scripts/test_zarr_loading.js
// Usage: node scripts/test_zarr_loading.js
// Requires: npm install zarr

// This script recursively prints the group structure of an OME-Zarr store
// and counts the number of chunks in each array (scale).

const BASE_URL = 'https://hypha.aicell.io/agent-lens/artifacts/default-20250716-141104/zip-files/well_A10_96.zip?path=data.zarr/';

async function fetchDirListing(url) {
  const res = await fetch(url);
  if (!res.ok) return [];
  return await res.json();
}

async function fetchZarray(url) {
  const res = await fetch(url + '.zarray');
  if (!res.ok) return null;
  return await res.json();
}

function countChunks(shape, chunks) {
  if (!shape || !chunks) return null;
  return shape.map((dim, i) => Math.ceil(dim / chunks[i])).reduce((a, b) => a * b, 1);
}

async function printGroupStructure(baseUrl, path = '', indent = '') {
  const url = baseUrl + path;
  const dirListing = await fetchDirListing(url);
  const isGroup = dirListing.some(e => e.name === '.zgroup');
  const isArray = dirListing.some(e => e.name === '.zarray');
  const zattrs = dirListing.some(e => e.name === '.zattrs');

  if (isGroup) {
    console.log(`${indent}Group: ${path || '/'}${zattrs ? ' (has .zattrs)' : ''}`);
  }
  if (isArray) {
    // Fetch .zarray metadata to count chunks
    const zarray = await fetchZarray(url);
    let chunkInfo = '';
    if (zarray && zarray.shape && zarray.chunks) {
      const nChunks = countChunks(zarray.shape, zarray.chunks);
      chunkInfo = ` | shape: [${zarray.shape.join(', ')}], chunks: [${zarray.chunks.join(', ')}], #chunks: ${nChunks}`;
    }
    console.log(`${indent}Array: ${path || '/'}${zattrs ? ' (has .zattrs)' : ''}${chunkInfo}`);
  }

  // Recurse into subdirectories
  for (const entry of dirListing) {
    if (entry.type === 'directory') {
      await printGroupStructure(baseUrl, path + entry.name + '/', indent + '  ');
    }
  }
}

async function main() {
  try {
    console.log('Printing OME-Zarr group structure for:', BASE_URL);
    await printGroupStructure(BASE_URL, '', '');
  } catch (err) {
    console.error('Error printing group structure:', err);
    process.exit(1);
  }
}

main(); 