"""
This module serves as the entry point for setting up and running the backend services.
It connects to the server and registers the necessary services.
"""

import asyncio
from agent_lens import (
    register_frontend_service,
    # register_sam_service,
    # register_similarity_search_service,
)

async def setup(server=None):
    """
    Set up the services and connect to the server.

    Args:
        server (Server, optional): The server instance.
    """
    await register_frontend_service.setup_service(server)
    # await register_sam_service.setup_service(server)
    # await register_similarity_search_service.setup_service(server)

if __name__ == "__main__":
    asyncio.run(setup())
