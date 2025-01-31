"""
This module provides the ArtifactManager class, which manages artifacts for the application.
It includes methods for creating vector collections, adding vectors, searching vectors,
and handling file uploads and downloads.
"""

import httpx

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

    def _workspace_id(self, user_id):
        """
        Generate the workspace ID.

        Args:
            user_id (str): The user ID.

        Returns:
            str: The workspace ID.
        """
        return f"ws-user-{user_id}"

    def _artifact_id(self, user_id, name):
        """
        Generate the artifact ID.

        Args:
            user_id (str): The user ID.
            name (str): The artifact name.

        Returns:
            str: The artifact ID.
        """
        return f"{self._workspace_id(user_id)}/{self._artifact_alias(name)}"

    async def create_vector_collection(self, user_id, name, manifest, config, overwrite=False, exists_ok=False):
        """
        Create a vector collection.

        Args:
            user_id (str): The user ID.
            name (str): The collection name.
            manifest (dict): The collection manifest.
            config (dict): The collection configuration.
            overwrite (bool, optional): Whether to overwrite the existing collection.
        """
        art_id = self._artifact_id(user_id, name)
        try:
            await self._svc.create(
                alias=art_id,
                type="vector-collection",
                manifest=manifest,
                config=config,
                overwrite=overwrite
            )
        except FileExistsError as e:
            if not exists_ok:
                raise e

    async def add_vectors(self, user_id, coll_name, *vectors):
        """
        Add vectors to the collection.

        Args:
            user_id (str): The user ID.
            coll_name (str): The collection name.
            vectors (list): The vectors to add.
        """
        art_id = self._artifact_id(user_id, coll_name)
        await self._svc.add_vectors(
            artifact_id=art_id,
            vectors=vectors
        )
        await self._svc.commit(art_id)

    async def search_vectors(self, user_id, coll_name, vector, top_k=None):
        """
        Search for vectors in the collection.

        Args:
            user_id (str): The user ID.
            coll_name (str): The collection name.
            vector (ndarray): The query vector.
            top_k (int, optional): The number of top results to return.

        Returns:
            list: The search results.
        """
        art_id = self._artifact_id(user_id, coll_name)
        return await self._svc.search_vectors(
            artifact_id=art_id,
            query={"vector": vector},
            limit=top_k
        )

    async def add_file(self, user_id, coll_name, file_content, file_path):
        """
        Add a file to the collection.

        Args:
            user_id (str): The user ID.
            coll_name (str): The collection name.
            file_content (bytes): The file content.
            file_path (str): The file path.
        """
        art_id = self._artifact_id(user_id, coll_name)
        put_url = await self._svc.put_file(art_id, file_path, download_weight=1.0)
        async with httpx.AsyncClient() as client:
            response = await client.put(put_url, data=file_content, timeout=500)
        response.raise_for_status()
        await self._svc.commit(art_id)

    async def get_file(self, user_id, coll_name, file_path):
        """
        Retrieve a file from the collection.

        Args:
            user_id (str): The user ID.
            coll_name (str): The collection name.
            file_path (str): The file path.

        Returns:
            bytes: The file content.
        """
        art_id = self._artifact_id(user_id, coll_name)
        get_url = await self._svc.get_file(art_id, file_path)
        
        async with httpx.AsyncClient() as client:
            response = await client.get(get_url, timeout=500)
        response.raise_for_status()
        
        return response.content
