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
        await self._svc.edit(artifact_id=art_id, version="stage")
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
WORKSPACE_TOKEN = os.environ.get("WORKSPACE_TOKEN")
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
        try:
            self.artifact_manager_server = await connect_to_server({
                "name": "test-client",
                "server_url": SERVER_URL,
                "token": WORKSPACE_TOKEN,
            })
            self.artifact_manager = await self.artifact_manager_server.get_service("public/artifact-manager")
        except Exception as e:
            print(f"Error connecting to artifact manager: {str(e)}")
            raise e

    async def list_files(self, channel: str, scale: int):
        """List available files for a specific channel and scale"""
        try:
            dir_path = f"{channel}/scale{scale}"
            files = await self.artifact_manager.list_files(ARTIFACT_ALIAS, dir_path=dir_path)
            return files
        except Exception as e:
            print(f"Error listing files: {str(e)}")
            return []

    async def get_tile_np_data(self, channel: str, scale: int, x: int, y: int) -> np.ndarray:
        """
        Get a specific tile from the artifact manager.

        Args:
            channel (str): Channel name (e.g., "BF_LED_matrix_full")
            scale (int): Scale level (0-3)
            x (int): X coordinate of the tile
            y (int): Y coordinate of the tile

        Returns:
            np.ndarray: The tile image as a numpy array
        """
        try:
            file_path = f"{channel}/scale{scale}/{y}.{x}"
            # Get the pre-signed URL for the file
            get_url = await self.artifact_manager.get_file(
                ARTIFACT_ALIAS, file_path=file_path
            )

            # Download the tile using aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.get(get_url) as response:
                    if response.status == 200:
                        # Read the compressed binary data
                        compressed_data = await response.read()

                        try:
                            # Decompress the data using blosc
                            decompressed_data = self.compressor.decode(compressed_data)

                            # Convert to numpy array with correct shape and dtype
                            tile_data = np.frombuffer(decompressed_data, dtype=np.uint8)
                            tile_data = tile_data.reshape(
                                (self.tile_size, self.tile_size)
                            )

                            return tile_data

                        except Exception:
                            # simple notification
                            print("Error processing tile data")
                            return np.zeros(
                                (self.tile_size, self.tile_size), dtype=np.uint8
                            )
                    else:
                        print(f"Didn't get file, path is {file_path}")
                        return np.zeros(
                            (self.tile_size, self.tile_size), dtype=np.uint8
                        )

        except FileNotFoundError:
            print(f"Didn't get file, path is {file_path}")
            return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
        except Exception:
            print(f"Couldn't get tile {file_path}")
            return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)

    async def get_tile_bytes(self, channel_name: str, z: int, x: int, y: int):
        """Serve a tile as bytes"""
        try:
            print(f"Backend: Fetching tile z={z}, x={x}, y={y}")
            if channel_name is None:
                channel_name = DEFAULT_CHANNEL

            # Get tile data using TileManager
            tile_data = await self.get_tile_np_data(channel_name, z, x, y)

            # Convert to PNG bytes
            image = Image.fromarray(tile_data)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()

        except Exception as e:
            print(f"Error in get_tile: {str(e)}")
            blank_image = Image.new("L", (self.tile_size, self.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
            return buffer.getvalue()

    async def get_tile_base64(self, channel_name: str, z: int, x: int, y: int):
        """Serve a tile as base64 string"""
        tile_bytes = await self.get_tile_bytes(channel_name, z, x, y)
        return base64.b64encode(tile_bytes).decode('utf-8')
