#!/bin/bash
docker-compose -f docker/docker-compose-local-hypha.yml up -d minio
npm run build --prefix frontend
export JWT_SECRET="1337"
python -m agent_lens start-server --port=9527
echo "App is now running. Access it at http://localhost:9527/agent-lens/apps/agent-lens"