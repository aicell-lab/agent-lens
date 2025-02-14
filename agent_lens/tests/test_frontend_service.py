from unittest.mock import AsyncMock, MagicMock, patch, ANY
import pytest
from fastapi.testclient import TestClient

from agent_lens.register_frontend_service import get_frontend_api, setup_service


@pytest.fixture
def mock_server():
    server = MagicMock()
    server.register_service = AsyncMock()
    return server


@pytest.fixture
def test_client():
    app, _ = get_frontend_api()
    return TestClient(app)


@pytest.mark.asyncio
async def test_setup_service(mock_server):
    await setup_service(mock_server)
    mock_server.register_service.assert_called_once_with(
        {
            "id": "microscope-control",
            "name": "Microscope Control",
            "type": "asgi",
            "serve": ANY,  # Complex callable, we just verify it exists
            "config": {"visibility": "public"},
        }
    )


def test_frontend_api_root(test_client):
    with patch("fastapi.responses.FileResponse") as mock_file_response:
        mock_file_response.return_value = "<html>Test</html>"
        response = test_client.get("/")
        assert response.status_code == 200


def test_frontend_api_static_files():
    app, _ = get_frontend_api()
    static_routes = [
        route for route in app.routes if str(route.path).startswith("/assets")
    ]
    assert len(static_routes) > 0, "Static files route should be mounted"
