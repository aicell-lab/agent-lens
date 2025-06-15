#!/bin/sh

# Function to check health and restart if needed
check_health() {
    local url=$1
    local service=$2
    
    # Try the health check
    if curl -s "$url" | jq -e '.status == "ok"' > /dev/null; then
        echo "Health check passed for $service"
        return 0
    else
        echo "Health check failed for $service, restarting..."
        # Send SIGTERM to the container to trigger a restart
        kill -TERM 1
        return 1
    fi
}

# Check agent-lens health
if [ "$SERVICE" = "agent-lens" ]; then
    check_health "https://hypha.aicell.io/agent-lens/services/probes/liveness-agent-lens" "agent-lens"
# Check squid-control health
elif [ "$SERVICE" = "squid-control" ]; then
    check_health "https://hypha.aicell.io/agent-lens/services/${MICROSCOPE_SERVICE_ID}/is_service_healthy" "squid-control"
fi