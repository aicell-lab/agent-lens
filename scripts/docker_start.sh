#!/bin/bash

echo "🚀 Starting Agent-Lens Docker container..."

echo "🤖 Starting Agent-Lens service with BiomedCLIP preloading..."
# Using connect-server mode with docker flag to maintain "agent-lens" service ID
# The BiomedCLIP preloading will happen automatically in Docker mode
python -m agent_lens connect-server --server_url="https://hypha.aicell.io" --workspace_name="agent-lens" --docker