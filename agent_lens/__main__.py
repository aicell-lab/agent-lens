"""
This script starts the Hypha server with specified command-line arguments and environment variables.
It loads environment variables from a .env file, parses command-line arguments, and constructs a command
to run the Hypha server with the specified options.
"""
import sys
import subprocess
import argparse
import os
import asyncio
from dotenv import load_dotenv
from hypha_rpc import connect_to_server
from agent_lens import (
    register_frontend_service,
    # register_sam_service,
    # register_similarity_search_service,
)


async def start_services(server):
    """
    Set up the services and connect to the server.

    Args:
        server (Server): The server instance.
    """
    await register_frontend_service.setup_service(server)
    # await register_sam_service.setup_service(server)
    # await register_similarity_search_service.setup_service(server)


def run_locally(args):
    """
    Parse command-line arguments and start the Hypha server.
    """
    # TODO: if server is running on {args.server_url}, then:
    #   connect_server(args)

    dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'minio.env')
    load_dotenv(dotenv_path)

    command = [
        sys.executable,
        "-m",
        "hypha.server",
        f"--host={args.server_url}",
        f"--port={args.port}",
        f"--public-base-url={args.public_base_url}",
        "--enable-s3",
        f"--access-key-id={os.getenv('MINIO_ROOT_USER')}",
        f"--secret-access-key={os.getenv('MINIO_ROOT_PASSWORD')}",
        f"--endpoint-url={os.getenv('MINIO_SERVER_URL')}",
        f"--endpoint-url-public={os.getenv('MINIO_SERVER_URL')}",
        "--s3-admin-type=minio",
        "--redis-uri=redis://localhost:6379/0",
        "--startup-functions=agent_lens.__main__:start_services"
    ]
    subprocess.run(command, check=True)

    print(f"Hypha server started. Access at {args.server_url}:{args.port}/public/apps/microscope-control")


def get_token(is_workspace=False):
    """
    Retrieve the token from environment variables.

    Args:
        workspace (boolean, optional): Whether to get the workspace token. Defaults to False.

    Returns:
        str: The token.
    """
    load_dotenv()

    if is_workspace:
        return os.environ.get("WORKSPACE_TOKEN")
    
    return os.environ.get("PERSONAL_TOKEN")


async def connect_server(args):
    is_workspace = args.workspace_name is not None
    token = get_token(is_workspace)

    server = await connect_to_server({
        "server_url": args.server_url,
        "token": token,
        "method_timeout": 500,
        "workspace": args.workspace_name,
    })
    
    await start_services(server)
    
    

def start_connect_server(args):
    loop = asyncio.get_event_loop()
    loop.create_task(connect_server(args))
    loop.run_forever()


def main():
    parser = argparse.ArgumentParser(description="Start the Hypha server")
    subparsers = parser.add_subparsers()

    parser_local = subparsers.add_parser("local")
    parser_local.add_argument("--server_url", type=str, default="localhost")
    parser_local.add_argument("--port", type=int, default=9527)
    parser_local.add_argument("--workspace_name", type=str, default=None, required=False)
    parser_local.add_argument("--public-base-url", type=str, default="")
    parser_local.set_defaults(func=run_locally)

    parser_remote = subparsers.add_parser("remote")
    parser_remote.add_argument("--server_url", type=str)
    parser_remote.add_argument("--workspace_name", type=str, default=None, required=False)
    parser_remote.set_defaults(func=start_connect_server)

    args = parser.parse_args()
    if hasattr(args, 'func'):
        args.func(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
