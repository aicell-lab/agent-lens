#!/bin/bash
docker-compose -f docker/docker-compose.yml up -d minio
npm run build --prefix frontend
export JWT_SECRET="1337"
python -m agent_lens start-server --port=9527
echo "App is now running. Access it at http://localhost:9527/public/apps/microscope-control"