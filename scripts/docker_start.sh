#!/bin/bash

echo "🚀 Starting Agent-Lens Docker container..."

# Build frontend
echo "📦 Building frontend application..."
npm run build --prefix frontend

echo "🤖 Starting Agent-Lens service with CLIP preloading..."
# Using connect-server mode with docker flag to maintain "agent-lens" service ID
# The CLIP preloading will happen automatically in Docker mode
python -m agent_lens connect-server --server_url="https://hypha.aicell.io" --workspace_name="agent-lens" --docker