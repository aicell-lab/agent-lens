#!/bin/bash

# Build the frontend
npm run build --prefix frontend

# Run backend
export PYTHONPATH=$(pwd)
python agent_lens/start_services.py --workspace_name "agent-lens"

# Keep the container running
tail -f /dev/null