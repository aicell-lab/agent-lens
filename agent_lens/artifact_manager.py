"""
This module provides the ArtifactManager class, which manages artifacts for the application.
It includes methods for creating vector collections, adding vectors, searching vectors,
and handling file uploads and downloads.
"""

import httpx
from hypha_rpc.rpc import RemoteException
import asyncio
import os
import io
import dotenv
from hypha_rpc import connect_to_server
from PIL import Image
import numpy as np
import base64
import numcodecs
import blosc
import aiohttp

dotenv.load_dotenv()  
ENV_FILE = dotenv.find_dotenv()  
if ENV_FILE:  
    dotenv.load_dotenv(ENV_FILE)  

class AgentLensArtifactManager:
    """
    Manages artifacts for the application.
    """

    def __init__(self):
        self._svc = None
        self.server = None

    async def connect_server(self, server):
        """
        Connect to the server.

        Args:
            server (Server): The server instance.
        """
        self.server = server
        self._svc = await server.get_service("public/artifact-manager")

    def _artifact_alias(self, name):
        """
        Generate an alias for the artifact.

        Args:
            name (str): The artifact name.

        Returns:
            str: The artifact alias.
        """
        return f"agent-lens-{name}"

    def _artifact_id(self, workspace, name):
        """
        Generate the artifact ID.

        Args:
            workspace (str): The workspace.
            name (str): The artifact name.

        Returns:
            str: The artifact ID.
        """
        return f"{workspace}/{self._artifact_alias(name)}"

    async def create_vector_collection(
        self, workspace, name, manifest, config, overwrite=False, exists_ok=False
    ):
        """
        Create a vector collection.

        Args:
            workspace (str): The workspace.
            name (str): The collection name.
            manifest (dict): The collection manifest.
            config (dict): The collection configuration.
            overwrite (bool, optional): Whether to overwrite the existing collection.
        """
        art_id = self._artifact_id(workspace, name)
        try:
            await self._svc.create(
                alias=art_id,
                type="vector-collection",
                manifest=manifest,
                config=config,
                overwrite=overwrite,
            )
        except RemoteException as e:
            if not exists_ok:
                raise e

    async def add_vectors(self, workspace, coll_name, vectors):
        """
        Add vectors to the collection.

        Args:
            workspace (str): The workspace.
            coll_name (str): The collection name.
            vectors (list): The vectors to add.
        """
        art_id = self._artifact_id(workspace, coll_name)
        await self._svc.add_vectors(artifact_id=art_id, vectors=vectors)
        await self._svc.commit(art_id)

    async def search_vectors(self, workspace, coll_name, vector, top_k=None):
        """
        Search for vectors in the collection.

        Args:
            workspace (str): The workspace.
            coll_name (str): The collection name.
            vector (ndarray): The query vector.
            top_k (int, optional): The number of top results to return.

        Returns:
            list: The search results.
        """
        art_id = self._artifact_id(workspace, coll_name)
        return await self._svc.search_vectors(
            artifact_id=art_id, query={"cell_image_vector": vector}, limit=top_k
        )

    async def add_file(self, workspace, coll_name, file_content, file_path):
        """
        Add a file to the collection.

        Args:
            workspace (str): The workspace.
            coll_name (str): The collection name.
            file_content (bytes): The file content.
            file_path (str): The file path.
        """
        art_id = self._artifact_id(workspace, coll_name)
        put_url = await self._svc.put_file(art_id, file_path, download_weight=1.0)
        async with httpx.AsyncClient() as client:
            response = await client.put(put_url, data=file_content, timeout=500)
        response.raise_for_status()
        await self._svc.commit(art_id)

    async def get_file(self, workspace, coll_name, file_path):
        """
        Retrieve a file from the collection.

        Args:
            workspace (str): The workspace.
            coll_name (str): The collection name.
            file_path (str): The file path.

        Returns:
            bytes: The file content.
        """
        art_id = self._artifact_id(workspace, coll_name)
        get_url = await self._svc.get_file(art_id, file_path)

        async with httpx.AsyncClient() as client:
            response = await client.get(get_url, timeout=500)
        response.raise_for_status()

        return response.content

    async def remove_vectors(self, workspace, coll_name, vector_ids=None):
        """
        Clear the vectors in the collection.

        Args:
            workspace (str): The workspace.
            coll_name (str): The collection name.
        """
        art_id = self._artifact_id(workspace, coll_name)
        if vector_ids is None:
            all_vectors = await self._svc.list_vectors(art_id)
            while len(all_vectors) > 0:
                vector_ids = [vector["id"] for vector in all_vectors]
                await self._svc.remove_vectors(art_id, vector_ids)
                all_vectors = await self._svc.list_vectors(art_id)
        else:
            await self._svc.remove_vectors(art_id, vector_ids)


# Constants
SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.environ.get("AGENT_LENS_WORKSPACE_TOKEN")
ARTIFACT_ALIAS = "microscopy-tiles-complete"
DEFAULT_CHANNEL = "BF_LED_matrix_full"

class TileManager:
    def __init__(self):
        self.artifact_manager_server = None
        self.artifact_manager = None
        self.tile_size = 2048
        self.channels = [
            "BF_LED_matrix_full",
            "Fluorescence_405_nm_Ex",
            "Fluorescence_488_nm_Ex",
            "Fluorescence_561_nm_Ex",
            "Fluorescence_638_nm_Ex"
        ]
        self.compressor = numcodecs.Blosc(
            cname='zstd',
            clevel=5,
            shuffle=blosc.SHUFFLE,
            blocksize=0
        )

    async def connect(self):
        """Connect to the Artifact Manager service"""
        self.artifact_manager_server = await connect_to_server({
            "name": "test-client",
            "server_url": SERVER_URL,
            "token": WORKSPACE_TOKEN,
        })
        self.artifact_manager = await self.artifact_manager_server.get_service("public/artifact-manager")
        print(f'Connected to Artifact Manager: {self.artifact_manager}')

    async def list_files(self, channel: str, scale: int):
        """List available files for a specific channel and scale"""
        try:
            dir_path = f"{channel}/scale{scale}"
            files = await self.artifact_manager.list_files(ARTIFACT_ALIAS, dir_path=dir_path)
            return files
        except Exception as e:
            print(f"Error listing files: {str(e)}")
            return []

    async def get_tile(self, channel: str, scale: int, x: int, y: int) -> np.ndarray:
        """Get a specific tile from the artifact manager."""
        try:
            files = await self.list_files(channel, scale)
            file_path = f"{channel}/scale{scale}/{y}.{x}"

            if not any(f['name'] == f"{y}.{x}" for f in files):
                print(f"Tile not found: {file_path}")
                return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)

            get_url = await self.artifact_manager.get_file(
                ARTIFACT_ALIAS,
                file_path=file_path
            )

            async with aiohttp.ClientSession() as session:
                async with session.get(get_url) as response:
                    if response.status == 200:
                        compressed_data = await response.read()
                        try:
                            decompressed_data = self.compressor.decode(compressed_data)
                            tile_data = np.frombuffer(decompressed_data, dtype=np.uint8)
                            tile_data = tile_data.reshape((self.tile_size, self.tile_size))
                            return tile_data
                        except Exception as e:
                            print(f"Error processing tile data: {str(e)}")
                            return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
                    else:
                        print(f"Failed to download tile: {response.status}")
                        return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)

        except Exception as e:
            print(f"Error getting tile {file_path}: {str(e)}")
            return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)

