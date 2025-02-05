#!/bin/bash
npm run build --prefix frontend
python -m agent_lens remote --server_url="https://hypha.aicell.io" --workspace_name="agent-lens"