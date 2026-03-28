from agent_lens.register_frontend_service import get_frontend_api


def test_frontend_app_no_longer_exposes_legacy_example_zarr_routes():
    app = get_frontend_api()
    route_paths = {route.path for route in app.routes}

    assert "/example-image-data.zarr" not in route_paths
    assert "/example-image-data.zarr/{file_path:path}" not in route_paths
