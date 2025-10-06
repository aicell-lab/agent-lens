#!/bin/bash

# Parallel curl test for 10 chunks
echo "🚀 Testing 10 parallel chunk requests..."

# Start all 10 requests in parallel
start_time=$(date +%s.%N)

curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.1" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.2" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.3" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.4" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.5" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.6" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.7" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.8" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.0.9" -o /dev/null &
curl -s "https://hypha.aicell.io/agent-lens/artifacts/example-cell-data-20250723-122839/zip-files/well_F5_96.zip/?path=data.zarr/3/0.0.0.1.0" -o /dev/null &

# Wait for all background jobs to complete
wait

end_time=$(date +%s.%N)
duration=$(echo "$end_time - $start_time" | bc)

echo "✅ All 10 chunks completed in ${duration}s"
echo "📊 Average time per chunk: $(echo "scale=3; $duration / 10" | bc)s"
echo "🚀 Chunks per second: $(echo "scale=1; 10 / $duration" | bc)"
