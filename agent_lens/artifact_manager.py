"""
This module provides the ArtifactManager class, which manages artifacts for the application.
and handling file uploads and downloads.
"""

import httpx
import asyncio
import os
import io
import dotenv
from hypha_rpc import connect_to_server
from PIL import Image
import numpy as np
import base64
import numcodecs
import aiohttp
import time
from asyncio import Lock
import json
import uuid
# Configure logging
from .log import setup_logging

logger = setup_logging("artifact_manager.log")

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

    def _artifact_id(self, workspace, name):
        """
        Generate the artifact ID.

        Args:
            workspace (str): The workspace.
            name (str): The artifact name.

        Returns:
            str: The artifact ID.
        """
        return f"{workspace}/{name}"

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
            content_size = len(file_content)
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

    async def list_files_in_dataset(self, dataset_id):
        """
        List all files in a dataset.

        Args:
            dataset_id (str): The ID of the dataset.

        Returns:
            list: A list of files in the dataset.
        """
        files = await self._svc.list_files(dataset_id)
        return files


    async def get_file_details(self, dataset_id, file_path):
        """
        Get details of a specific file in a dataset.

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file in the dataset.

        Returns:
            dict: Details of the file, including size, type, and last modified date.
        """
        files = await self._svc.list_files(dataset_id)
        for file in files:
            if file['name'] == file_path:
                return file
        return None

    async def download_file(self, dataset_id, file_path, local_path):
        """
        Download a file from a dataset.

        Args:
            dataset_id (str): The ID of the dataset.
            file_path (str): The path to the file in the dataset.
            local_path (str): The local path to save the downloaded file.
        """
        get_url = await self._svc.get_file(dataset_id, file_path)
        async with httpx.AsyncClient() as client:
            response = await client.get(get_url)
            response.raise_for_status()
            with open(local_path, 'wb') as f:
                f.write(response.content)

    async def search_datasets(self, keywords=None, filters=None):
        """
        Search and filter datasets based on keywords and filters.

        Args:
            keywords (list, optional): A list of keywords for searching datasets.
            filters (dict, optional): A dictionary of filters to apply.

        Returns:
            list: A list of datasets matching the search criteria.
        """
        datasets = await self._svc.list(keywords=keywords, filters=filters)
        return datasets

    async def list_subfolders(self, dataset_id, dir_path=None):
        """
        List all subfolders in a specified directory within a dataset.

        Args:
            dataset_id (str): The ID of the dataset.
            dir_path (str, optional): The directory path within the dataset to list subfolders. Defaults to None for the root directory.

        Returns:
            list: A list of subfolders in the specified directory.
        """
        try:
            logger.info(f"Listing files for dataset_id={dataset_id}, dir_path={dir_path}")
            files = await self._svc.list_files(dataset_id, dir_path=dir_path)
            logger.info(f"Files received, length: {len(files)}")
            subfolders = [file for file in files if file.get('type') == 'directory']
            logger.info(f"Subfolders filtered, length: {len(subfolders)}")
            return subfolders
        except Exception as e:
            logger.info(f"Error listing subfolders for {dataset_id}: {e}")
            import traceback
            logger.info(traceback.format_exc())
            return []

    async def list_microscope_galleries(self, microscope_service_id: str):
        """
        List all galleries (collections) available for a given microscope's service ID.
        This includes both standard microscope galleries and experiment-based galleries.
        Returns a list of gallery info dicts.
        """
        try:
            # List all collections in the agent-lens workspace (top-level)
            all_collections = await self._svc.list()
            logger.info(f"Microscope service ID: {microscope_service_id}")
            #logger.info(f"All collections: {all_collections}")
            galleries = []

            for coll in all_collections:
                manifest = coll.get('manifest', {})
                manifest_microscope_id = manifest.get('microscope_service_id')
                if manifest_microscope_id:
                    # Match if manifest id is a substring or suffix of the provided id
                    if manifest_microscope_id in microscope_service_id or microscope_service_id.endswith(manifest_microscope_id):
                        galleries.append(coll)
                        continue

            return {
                "success": True,
                "microscope_service_id": microscope_service_id,
                "galleries": galleries,
                "total": len(galleries)
            }
        except Exception as e:
            logger.error(f"Error listing galleries: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise e

    async def list_gallery_datasets(self, gallery_id: str = None, microscope_service_id: str = None, experiment_id: str = None):
        """
        List all datasets in a gallery (collection).
        You can specify the gallery by its artifact ID, or provide microscope_service_id and/or experiment_id to find the gallery.
        Returns a list of datasets in the gallery.
        """
        try:
            # Find the gallery if not given
            gallery = None
            if gallery_id:
                # Try to read the gallery directly
                gallery = await self._svc.read(artifact_id=gallery_id)
            else:
                # Use microscope_service_id and/or experiment_id to find the gallery
                if microscope_service_id is None and experiment_id is None:
                    raise Exception("You must provide either gallery_id, microscope_service_id, or experiment_id.")
                # Use the same logic as before to find the gallery
                galleries_result = await self.list_microscope_galleries(microscope_service_id)
                galleries = galleries_result.get('galleries', [])
                if not galleries:
                    raise Exception(f"No gallery found for microscope_service_id={microscope_service_id}")
                gallery = galleries[0]  # Use the first matching gallery
            if not gallery:
                raise Exception("Gallery not found.")
            # List datasets in the gallery
            datasets = await self._svc.list(gallery["id"])
            return {
                "success": True,
                "gallery_id": gallery["id"],
                "gallery_alias": gallery.get("alias"),
                "gallery_name": gallery.get("manifest", {}).get("name"),
                "datasets": datasets,
                "total": len(datasets)
            }
        except Exception as e:
            logger.error(f"Error listing gallery datasets: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise e

    async def delete_artifact(self, artifact_id: str, delete_files: bool = True, recursive: bool = True):
        """
        Delete a gallery or dataset (artifact) by its ID.
        Args:
            artifact_id (str): The ID of the artifact (gallery or dataset) to delete.
            delete_files (bool): Whether to delete the associated files. Default is True.
            recursive (bool): Whether to delete recursively (all children). Default is True.
        Returns:
            dict: Success status and message.
        """
        try:
            await self._svc.delete(
                artifact_id=artifact_id,
                delete_files=delete_files,
                recursive=recursive
            )
            return {"success": True, "artifact_id": artifact_id}
        except Exception as e:
            logger.error(f"Error deleting artifact {artifact_id}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            raise e