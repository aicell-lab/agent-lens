import os
import asyncio
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from src.backend.utils import make_service

def get_frontend_api():
    app = FastAPI()
    frontend_dir = os.path.join(os.path.dirname(__file__), "../frontend")
    tiles_dir = os.path.join(frontend_dir, "tiles_output")
    dist_dir = os.path.join(frontend_dir, "dist")
    assets_dir = os.path.join(dist_dir, "assets")
    app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    async def serve_fastapi(args, context=None):
        await app(args["scope"], args["receive"], args["send"])

    @app.get("/", response_class=HTMLResponse)
    async def root():
        return FileResponse(os.path.join(dist_dir, "index.html"))

    @app.get("/tiles")
    async def get_tile(tile):
        """
        Fetch the tile using the artifact_manager.get_tile function.
        The tile name is passed as a query parameter.
        """
        try:
            # Get the tile using the artifact_manager's get_tile function.
            tile_file = artifact_manager.get_file(tile)
            if tile_file:
                return FileResponse(tile_file)
            else:
                raise HTTPException(status_code=404, detail="Tile not found")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error retrieving tile: {str(e)}")

    return serve_fastapi
    
async def setup_service(server=None):
    serve_fastapi = get_frontend_api()
    service_id = "microscope-control"
    await make_service(
        service={
            "id": service_id,
            "name": "Microscope Control",
            "type": "asgi",
            "serve": serve_fastapi,
            "config": {"visibility": "public"},
        },
        server=server
    )
 
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(setup_service())
    loop.run_forever()