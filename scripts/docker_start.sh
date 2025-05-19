#!/bin/bash
npm run build --prefix frontend
python -m agent_lens connect-server --server_url="https://hypha.aicell.io"