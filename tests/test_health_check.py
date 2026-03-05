"""
Test the liveness probe logic: artifact manager connectivity check.
Mirrors exactly what check_liveness() does in register_frontend_service.py.
"""

import os
import time
import pytest
import pytest_asyncio

SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "reef-imaging"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_artifact_manager_liveness_check():
    """
    Simulate the check_liveness() health probe logic:
      1. get_service("public/artifact-manager")
      2. call list() with limit=1
    Reports connection time and result.
    """
    token = os.environ.get("WORKSPACE_TOKEN")
    if not token:
        pytest.skip("WORKSPACE_TOKEN not set")

    from hypha_rpc import connect_to_server

    # --- Step 1: connect (mirrors get_artifact_manager()) ---
    t0 = time.monotonic()
    server = await connect_to_server({
        "server_url": SERVER_URL,
        "token": token,
        "workspace": WORKSPACE,
    })
    svc = await server.get_service("public/artifact-manager")
    connect_ms = (time.monotonic() - t0) * 1000
    print(f"\n  connect + get_service: {connect_ms:.0f} ms")

    # --- Step 2: list(limit=1) — mirrors the actual health check call ---
    t1 = time.monotonic()
    result = await svc.list(limit=1)
    list_ms = (time.monotonic() - t1) * 1000
    print(f"  list(limit=1):         {list_ms:.0f} ms")
    print(f"  result:                {result}")
    print(f"  total:                 {(time.monotonic() - t0) * 1000:.0f} ms")

    await server.disconnect()

    assert result is not None, "list() returned None — artifact manager not responding"
    print("\n✅ Liveness check passed")
