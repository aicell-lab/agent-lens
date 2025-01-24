import asyncio
from agent_lens import register_similarity_search_service

async def setup(server):
    """
    Set up the service and connect to the server.

    Args:
        server (Server, optional): The server instance.
    """
    await register_similarity_search_service.setup_service(server)
    service = server.get_service("similarity-search")
    user_id = "test-user"

if __name__ == "__main__":
    server_to_use = None
    asyncio.run(setup(server_to_use))