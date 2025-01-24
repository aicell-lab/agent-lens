"""
This module provides utility functions for connecting to the Hypha server,
retrieving tokens, and registering services.
"""

import os
import argparse
import dotenv
from hypha_rpc import connect_to_server

def get_token(workspace=None):
    """
    Retrieve the token from environment variables.

    Args:
        workspace (str, optional): The workspace name.

    Returns:
        str: The token.
    """
    dotenv.load_dotenv()

    token = os.environ.get("WORKSPACE_TOKEN")
    if token is None or workspace is None:
        token = os.environ.get("PERSONAL_TOKEN")

    return token


async def get_server(token, workspace=None, server_url="https://hypha.aicell.io"):
    """
    Connect to the Hypha server.

    Args:
        token (str): The token for authentication.
        workspace (str, optional): The workspace name.
        server_url (str): The server URL.

    Returns:
        Server: The connected server instance.
    """
    server = await connect_to_server({
        "server_url": server_url,
        "token": token,
        "method_timeout": 500,
        **({"workspace": workspace} if workspace else {}),
    })

    return server


async def register_service(service, workspace=None, server_url="https://hypha.aicell.io",
                           server=None):
    """
    Register a service with the Hypha server.

    Args:
        service (dict): The service configuration.
        workspace (str, optional): The workspace name.
        server_url (str): The server URL.
        server (Server, optional): The server instance.
    """
    if server is None:
        token = get_token(workspace)
        server = await get_server(token, workspace, server_url)
    else:
        server_url = "0.0.0.0:9527"

    await server.register_service(service)
    print(f"Service registered at: {server_url}/{server.config.workspace}/services/{service['id']}")


def get_service_args(service_id, default_server_url="https://hypha.aicell.io",
                     default_workspace=None):
    """
    Parse command-line arguments for the service.

    Args:
        service_id (str): The service ID.
        default_server_url (str): The default server URL.
        default_workspace (str, optional): The default workspace name.

    Returns:
        Namespace: The parsed arguments.
    """
    parser = argparse.ArgumentParser(
        description=f"Register {service_id} service on given workspace."
    )
    parser.add_argument(
        "--server_url",
        default=default_server_url,
        help="URL of the Hypha server",
    )
    parser.add_argument(
        "--workspace_name",
        default=default_workspace,
        help="Name of the workspace"
    )

    return parser.parse_args()


async def make_service(service, default_workspace=None,
                       default_server_url="https://hypha.aicell.io", server=None):
    """
    Create and register a service.

    Args:
        service (dict): The service configuration.
        default_workspace (str, optional): The default workspace name.
        default_server_url (str): The default server URL.
        server (Server, optional): The server instance.
    """
    if server is None:
        service_args = get_service_args(service["id"], default_server_url, default_workspace)
        await register_service(
            service,
            service_args.workspace_name,
            service_args.server_url,
            server
        )
    else:
        await register_service(service, server=server)
