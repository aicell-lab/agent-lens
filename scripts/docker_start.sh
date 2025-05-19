#!/bin/bash
npm run build --prefix frontend
# Using connect-server mode with docker flag to maintain "agent-lens" service ID
python -m agent_lens connect-server --server_url="https://hypha.aicell.io" --workspace_name="agent-lens" --docker