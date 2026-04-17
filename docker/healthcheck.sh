#!/bin/sh
# Healthcheck script for agent-lens service.
# Reads WORKSPACE_TOKEN from the environment internally to avoid
# exposing the token in docker inspect / process listings.

set -e

TOKEN="${WORKSPACE_TOKEN}"
if [ -z "$TOKEN" ]; then
    echo "WORKSPACE_TOKEN is not set" >&2
    exit 1
fi

check_service() {
    url="$1"
    curl -sf -H "Authorization: Bearer ${TOKEN}" "$url" | jq -e '.status == "ok"' > /dev/null 2>&1
}

APP_URL="https://hypha.aicell.io/reef-imaging/apps/agent-lens/is_service_healthy"
TOOLS_URL="https://hypha.aicell.io/reef-imaging/services/agent-lens-tools/is_service_healthy"

if ! check_service "$APP_URL"; then
    echo "App service health check failed" >&2
    exit 1
fi

if ! check_service "$TOOLS_URL"; then
    echo "Tools service health check failed" >&2
    exit 1
fi

echo "ok"
