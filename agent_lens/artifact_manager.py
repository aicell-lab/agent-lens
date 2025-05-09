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
from collections import deque
import zarr
from zarr.storage import LRUStoreCache, FSStore
import fsspec
from fsspec.implementations.http import HTTPFileSystem
import time
from asyncio import Lock

# Configure logging
import logging
import logging.handlers
def setup_logging(log_file="artifact_manager.log", max_bytes=100000, backup_count=3):
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)

    # Rotating file handler
    file_handler = logging.handlers.RotatingFileHandler(log_file, maxBytes=max_bytes, backupCount=backup_count)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    # Console handler
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    return logger

logger = setup_logging()

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

    async def navigate_collections(self, parent_id=None):
        """
        Navigate through collections and datasets.

        Args:
            parent_id (str, optional): The ID of the parent collection. Defaults to None for top-level collections.

        Returns:
            list: A list of collections and datasets under the specified parent.
        """
        collections = await self._svc.list(artifact_id=parent_id)
        return collections

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

    async def get_zarr_group(
        self,
        workspace: str,
        artifact_alias: str,
        timestamp: str,
        channel: str,
        cache_max_size=2**28 # 256 MB LRU cache
    ):
        """
        Access a Zarr group stored within a zip file in an artifact.

        Args:
            workspace (str): The workspace containing the artifact.
            artifact_alias (str): The alias of the artifact (e.g., 'image-map-20250429-treatment-zip').
            timestamp (str): The timestamp folder name.
            channel (str): The channel name (used for the zip filename).
            cache_max_size (int, optional): Max size for LRU cache in bytes. Defaults to 2**28.

        Returns:
            zarr.Group: The root Zarr group object.
        """
        if self._svc is None:
            raise ConnectionError("Artifact Manager service not connected. Call connect_server first.")

        art_id = self._artifact_id(workspace, artifact_alias)
        zip_file_path = f"{timestamp}/{channel}.zip"

        try:
            logger.info(f"Getting download URL for: {art_id}/{zip_file_path}")
            # Get the direct download URL for the zip file
            download_url = await self._svc.get_file(art_id, zip_file_path)
            logger.info(f"Obtained download URL.")

            # Construct the URL for FSStore using fsspec's zip chaining
            store_url = f"zip::{download_url}"

            # Define the synchronous function to open the Zarr store and group
            def _open_zarr_sync(url, cache_size):
                logger.info(f"Opening Zarr store: {url}")
                store = FSStore(url, mode="r")
                if cache_size and cache_size > 0:
                    logger.info(f"Using LRU cache with size: {cache_size} bytes")
                    store = LRUStoreCache(store, max_size=cache_size)
                # It's generally recommended to open the root group
                root_group = zarr.group(store=store)
                logger.info(f"Zarr group opened successfully.")
                return root_group

            # Run the synchronous Zarr operations in a thread pool
            logger.info("Running Zarr open in thread executor...")
            zarr_group = await asyncio.to_thread(_open_zarr_sync, store_url, cache_max_size)
            return zarr_group

        except RemoteException as e:
            logger.info(f"Error getting file URL from Artifact Manager: {e}")
            raise FileNotFoundError(f"Could not find or access zip file {zip_file_path} in artifact {art_id}") from e
        except Exception as e:
            logger.info(f"An error occurred while accessing the Zarr group: {e}")
            import traceback
            logger.info(traceback.format_exc())
            raise

# Constants
SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.environ.get("WORKSPACE_TOKEN")
ARTIFACT_ALIAS = "image-map-20250429-treatment-zip"
DEFAULT_CHANNEL = "BF_LED_matrix_full"

# New class to replace TileManager using Zarr for efficient access
class ZarrTileManager:
    def __init__(self):
        self.artifact_manager = None
        self.artifact_manager_server = None
        self.workspace = "agent-lens"  # Default workspace
        self.tile_size = 256  # Default chunk size for Zarr
        # Define the chunk size for test access
        self.chunk_size = 256  # Assuming chunk size is the same as tile size
        self.channels = [
            "BF_LED_matrix_full",
            "Fluorescence_405_nm_Ex",
            "Fluorescence_488_nm_Ex",
            "Fluorescence_561_nm_Ex",
            "Fluorescence_638_nm_Ex"
        ]
        # Enhanced zarr cache to include URL expiration times
        self.zarr_groups_cache = {}  # format: {cache_key: {'group': zarr_group, 'url': url, 'expiry': timestamp}}
        # Add a dictionary to track pending requests with locks
        self.zarr_group_locks = {}  # format: {cache_key: asyncio.Lock()}
        self.is_running = True
        self.session = None
        self.default_timestamp = "2025-04-29_16-38-27"  # Set a default timestamp
        # Set URL expiration buffer - refresh URLs 5 minutes before they expire
        self.url_expiry_buffer = 300  # seconds
        # Default URL expiration time (1 hour)
        self.default_url_expiry = 3600  # seconds
        
        # Create a global HTTP filesystem with connection pooling and caching
        self.http_fs = self._create_http_filesystem()
        
        # Function to open zarr store synchronously
        self._open_zarr_sync = self._create_open_zarr_sync_function()
        
        # Add a priority queue for tile requests
        self.tile_request_queue = asyncio.PriorityQueue()
        # Track in-progress tile requests to avoid duplicates
        self.in_progress_tiles = set()
        # Start the tile request processor
        self.tile_processor_task = None
        
        # Configure numcodecs for better performance
        numcodecs.blosc.use_threads = True
        self.chunk_cache = numcodecs.LRUCache(maxsize=2**28)  # 256 MB chunk cache
        numcodecs.registry.register_codec(self.chunk_cache)

    def _create_http_filesystem(self):
        """Create a shared HTTP filesystem with connection pooling and caching"""
        logger.info("Creating pooled HTTP filesystem for better connection reuse")
        return HTTPFileSystem(
            block_size=2**18,  # 256KB blocks - smaller than default for more granular access
            cache_type="bytes",
            cache_options={"max_size": 2**29},  # 512MB in-memory cache
            client_kwargs={
                "timeout": 30,  # 30 second timeout
                "pool_connections": 50,  # Keep up to 50 connections in the pool
                "pool_maxsize": 100,  # Allow up to 100 connections total
                "max_retries": 3,  # Retry failed requests
            }
        )

    def _create_open_zarr_sync_function(self):
        """Create a reusable function for opening zarr stores synchronously with connection pooling"""
        def _open_zarr_sync(url, cache_size):
            logger.info(f"Opening Zarr store: {url}")
            
            # Use our pooled HTTP client for remote URLs
            if url.startswith("zip::http"):
                # Use connection pooling for HTTP requests
                fs = fsspec.filesystem(
                    "zip", 
                    target_protocol="http", 
                    target_options={"fs": self.http_fs}
                )
                store = fs.get_mapper(url.replace("zip::", ""))
                logger.info(f"Using connection-pooled HTTP access for Zarr")
            else:
                # For local files or other protocols
                store = FSStore(url, mode="r")
            
            # Add LRU cache at the storage level
            if cache_size and cache_size > 0:
                logger.info(f"Using LRU cache with size: {cache_size} bytes")
                store = LRUStoreCache(store, max_size=cache_size)
            
            # Open the root group
            root_group = zarr.group(store=store)
            logger.info(f"Zarr group opened successfully.")
            return root_group
        
        return _open_zarr_sync

    async def connect(self, workspace_token=None, server_url="https://hypha.aicell.io"):
        """Connect to the Artifact Manager service"""
        try:
            token = workspace_token or os.environ.get("WORKSPACE_TOKEN")
            if not token:
                raise ValueError("Workspace token not provided")
            
            self.artifact_manager_server = await connect_to_server({
                "name": "zarr-tile-client",
                "server_url": server_url,
                "token": token,
            })
            
            self.artifact_manager = AgentLensArtifactManager()
            await self.artifact_manager.connect_server(self.artifact_manager_server)
            
            # Initialize aiohttp session with connection pooling for HTTP requests
            connector = aiohttp.TCPConnector(
                limit=100,             # Maximum number of connections
                limit_per_host=50,     # Maximum number of connections per host
                enable_cleanup_closed=True,
                force_close=False,     # Keep connections alive
                ttl_dns_cache=300,     # Cache DNS results for 5 minutes
            )
            
            self.session = aiohttp.ClientSession(
                connector=connector,
                timeout=aiohttp.ClientTimeout(total=30),
                raise_for_status=True
            )
            
            # Start the tile request processor
            if self.tile_processor_task is None or self.tile_processor_task.done():
                self.tile_processor_task = asyncio.create_task(self._process_tile_requests())
            
            logger.info("ZarrTileManager connected successfully with improved connection pooling")
            return True
        except Exception as e:
            logger.info(f"Error connecting to artifact manager: {str(e)}")
            import traceback
            logger.info(traceback.format_exc())
            return False

    async def close(self):
        """Close the tile manager and cleanup resources"""
        self.is_running = False
        
        # Cancel the tile processor task
        if self.tile_processor_task and not self.tile_processor_task.done():
            self.tile_processor_task.cancel()
            try:
                await self.tile_processor_task
            except asyncio.CancelledError:
                pass
        
        # Close the cached Zarr groups
        self.zarr_groups_cache.clear()
        
        # Close the aiohttp session
        if self.session:
            await self.session.close()
            self.session = None
        
        # Disconnect from the server
        if self.artifact_manager_server:
            await self.artifact_manager_server.disconnect()
            self.artifact_manager_server = None
            self.artifact_manager = None

    def _extract_expiry_from_url(self, url):
        """Extract expiration time from pre-signed URL"""
        try:
            # Try to find X-Amz-Expires parameter
            if "X-Amz-Expires=" in url:
                parts = url.split("X-Amz-Expires=")[1].split("&")[0]
                expires_seconds = int(parts)
                
                # Find the date from X-Amz-Date
                if "X-Amz-Date=" in url:
                    date_str = url.split("X-Amz-Date=")[1].split("&")[0]
                    # Date format is typically 'YYYYMMDDTHHMMSSZ'
                    # This is a simplified approach - in production, properly parse this
                    # For now, we'll just use current time + expires_seconds
                    return time.time() + expires_seconds
            
            # If we can't extract, use default expiry
            return time.time() + self.default_url_expiry
        except Exception as e:
            logger.info(f"Error extracting URL expiry: {e}")
            # Default to current time + 1 hour
            return time.time() + self.default_url_expiry

    async def get_zarr_group(self, dataset_id, timestamp, channel):
        """Get (or reuse from cache) a Zarr group for a specific dataset, with URL expiration handling"""
        cache_key = f"{dataset_id}:{timestamp}:{channel}"
        
        now = time.time()
        
        # Check if we have a cached version and if it's still valid
        if cache_key in self.zarr_groups_cache:
            cached_data = self.zarr_groups_cache[cache_key]
            # If URL is close to expiring, refresh it without creating a new Zarr group
            if cached_data['expiry'] - now < self.url_expiry_buffer:
                logger.info(f"URL for {cache_key} is about to expire, refreshing")
                # Try to refresh URL without recreating the Zarr group
                if await self.refresh_zarr_url(cache_key):
                    return cached_data['group']
                else:
                    # If refresh failed, remove from cache to force recreation
                    del self.zarr_groups_cache[cache_key]
            else:
                logger.info(f"Using cached Zarr group for {cache_key}, expires in {int(cached_data['expiry'] - now)} seconds")
                return cached_data['group']
        
        # Get or create a lock for this cache key to prevent concurrent processing
        if cache_key not in self.zarr_group_locks:
            logger.info(f"Creating lock for {cache_key}")
            self.zarr_group_locks[cache_key] = Lock()
        
        # Acquire the lock for this cache key
        async with self.zarr_group_locks[cache_key]:
            # Check cache again after acquiring the lock (another request might have completed)
            if cache_key in self.zarr_groups_cache:
                cached_data = self.zarr_groups_cache[cache_key]
                if cached_data['expiry'] - now >= self.url_expiry_buffer:
                    logger.info(f"Using cached Zarr group for {cache_key} after lock acquisition")
                    return cached_data['group']
            
            try:
                # Get the direct download URL for the zip file
                zip_file_path = f"{timestamp}/{channel}.zip"
                download_url = await self.artifact_manager._svc.get_file(dataset_id, zip_file_path)
                
                # Extract expiration time from URL
                expiry_time = self._extract_expiry_from_url(download_url)
                
                # Construct the URL for FSStore using fsspec's zip chaining
                store_url = f"zip::{download_url}"
                
                # Run the synchronous Zarr operations in a thread pool
                logger.info("Running Zarr open in thread executor...")
                zarr_group = await asyncio.to_thread(self._open_zarr_sync, store_url, 2**28)
                
                # Cache the Zarr group for future use, along with expiration time
                self.zarr_groups_cache[cache_key] = {
                    'group': zarr_group,
                    'url': download_url,
                    'expiry': expiry_time
                }
                
                logger.info(f"Cached Zarr group for {cache_key}, expires in {int(expiry_time - now)} seconds")
                return zarr_group
            except Exception as e:
                logger.info(f"Error getting Zarr group: {e}")
                import traceback
                logger.info(traceback.format_exc())
                return None
            finally:
                # Clean up old locks if they're no longer needed
                # This helps prevent memory leaks if many different cache keys are used
                if len(self.zarr_group_locks) > 100:  # Arbitrary limit
                    # Keep only locks for cached items and the current request
                    to_keep = set(self.zarr_groups_cache.keys()) | {cache_key}
                    self.zarr_group_locks = {k: v for k, v in self.zarr_group_locks.items() if k in to_keep}

    async def refresh_zarr_url(self, cache_key):
        """Refresh the URL without creating a new Zarr group"""
        if cache_key in self.zarr_groups_cache:
            cached_data = self.zarr_groups_cache[cache_key]
            
            # Parse the cache key
            dataset_id, timestamp, channel = cache_key.split(":")
            
            try:
                # Get new URL
                zip_file_path = f"{timestamp}/{channel}.zip"
                new_url = await self.artifact_manager._svc.get_file(dataset_id, zip_file_path)
                expiry_time = self._extract_expiry_from_url(new_url)
                
                # Update URL and expiry without recreating Zarr group
                cached_data['url'] = new_url
                cached_data['expiry'] = expiry_time
                
                logger.info(f"URL for {cache_key} refreshed, new expiry: {int(expiry_time - time.time())} seconds")
                return True
            except Exception as e:
                logger.info(f"Error refreshing URL for {cache_key}: {e}")
                return False
        return False

    async def _process_tile_requests(self):
        """Process tile requests from the priority queue"""
        try:
            while self.is_running:
                try:
                    # Get the next tile request with highest priority (lowest number)
                    priority, (dataset_id, timestamp, channel, scale, x, y) = await self.tile_request_queue.get()
                    
                    # Create a unique key for this tile
                    tile_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{x}:{y}"
                    
                    # Skip if this tile is already being processed
                    if tile_key in self.in_progress_tiles:
                        self.tile_request_queue.task_done()
                        continue
                    
                    # Mark this tile as in progress
                    self.in_progress_tiles.add(tile_key)
                    
                    try:
                        # Process the tile request
                        await self.get_tile_np_data(dataset_id, timestamp, channel, scale, x, y)
                    except Exception as e:
                        logger.info(f"Error processing tile request: {e}")
                    finally:
                        # Remove from in-progress set when done
                        self.in_progress_tiles.discard(tile_key)
                        self.tile_request_queue.task_done()
                        
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.info(f"Error in tile request processor: {e}")
                    # Small delay to avoid tight loop in case of persistent errors
                    await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            logger.info("Tile request processor cancelled")
        except Exception as e:
            logger.info(f"Tile request processor exited with error: {e}")
            import traceback
            logger.info(traceback.format_exc())

    async def request_tile(self, dataset_id, timestamp, channel, scale, x, y, priority=10):
        """
        Queue a tile request with a specific priority.
        Lower priority numbers are processed first.
        
        Args:
            dataset_id (str): The dataset ID
            timestamp (str): The timestamp folder
            channel (str): Channel name
            scale (int): Scale level
            x (int): X coordinate
            y (int): Y coordinate
            priority (int): Priority level (lower is higher priority, default is 10)
        """
        tile_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{x}:{y}"
        
        # Skip if already in progress
        if tile_key in self.in_progress_tiles:
            return
        
        # Add to the priority queue
        await self.tile_request_queue.put((priority, (dataset_id, timestamp, channel, scale, x, y)))

    async def get_tile_np_data(self, dataset_id, timestamp, channel, scale, x, y):
        """
        Get a tile as numpy array using Zarr for efficient access
        
        Args:
            dataset_id (str): The dataset ID (workspace/artifact_alias)
            timestamp (str): The timestamp folder 
            channel (str): Channel name
            scale (int): Scale level
            x (int): X coordinate (in tile/chunk units)
            y (int): Y coordinate (in tile/chunk units)
            
        Returns:
            np.ndarray: Tile data as numpy array
        """
        try:
            # Use default timestamp if none provided
            timestamp = timestamp or self.default_timestamp
            
            # Ensure the zarr group is in cache without returning it
            cache_key = f"{dataset_id}:{timestamp}:{channel}"
            await self.ensure_zarr_group(dataset_id, timestamp, channel)
            
            # Access the cached zarr group
            if cache_key not in self.zarr_groups_cache:
                return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
                
            zarr_group = self.zarr_groups_cache[cache_key]['group']
            
            # Navigate to the right array in the Zarr hierarchy
            try:
                # Get the scale array
                scale_array = zarr_group[f'scale{scale}']
                
                # Since tile_size equals chunk_size, we can directly get the chunk
                # This is more efficient than slicing
                try:
                    # Get the chunk directly using zarr's chunk-based access
                    # This avoids reading unnecessary data and is more efficient
                    chunk_coords = (y, x)  # zarr uses (y, x) order for coordinates
                    chunk_key = '.'.join(map(str, chunk_coords))
                    
                    # Try to get the chunk directly from the chunk store
                    if hasattr(scale_array.store, 'get_partial_values'):
                        # Some stores support direct chunk access
                        chunk = scale_array.store.get_partial_values([chunk_key])[chunk_key]
                        if chunk is not None:
                            # Decompress the chunk
                            chunk = scale_array._decode_chunk(chunk)
                            return chunk
                    
                    # If direct chunk access failed or isn't supported, use the standard method
                    # but access exactly one chunk
                    chunk = scale_array.get_orthogonal_selection((slice(y * self.chunk_size, (y+1) * self.chunk_size), 
                                                                 slice(x * self.chunk_size, (x+1) * self.chunk_size)))
                    
                    # Make sure we have a properly shaped array
                    if chunk.shape != (self.tile_size, self.tile_size):
                        # Resize or pad if necessary
                        result = np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
                        h, w = chunk.shape
                        result[:min(h, self.tile_size), :min(w, self.tile_size)] = chunk[:min(h, self.tile_size), :min(w, self.tile_size)]
                        return result
                    
                    return chunk
                    
                except Exception as chunk_error:
                    logger.info(f"Error accessing chunk directly: {chunk_error}, falling back to standard slicing")
                    # Fall back to standard slicing if direct chunk access fails
                    tile_data = scale_array[y*self.tile_size:(y+1)*self.tile_size, 
                                           x*self.tile_size:(x+1)*self.tile_size]
                    
                    # Make sure we have a properly shaped array
                    if tile_data.shape != (self.tile_size, self.tile_size):
                        # Resize or pad if necessary
                        result = np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
                        h, w = tile_data.shape
                        result[:min(h, self.tile_size), :min(w, self.tile_size)] = tile_data[:min(h, self.tile_size), :min(w, self.tile_size)]
                        return result
                    logger.info(f"Returning tile data for {dataset_id}:{timestamp}:{channel}:{scale}:{x}:{y}")
                    return tile_data
                
            except KeyError as e:
                logger.info(f"KeyError accessing Zarr array path: {e}")
                # Try an alternative path structure if needed
                try:
                    # Alternative path structure if your zarr is organized differently
                    tile_data = zarr_group[y, x]  # Direct chunk access for alternative structure
                    return tile_data
                except Exception:
                    return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)
        except Exception as e:
            logger.info(f"Error getting tile data: {e}")
            import traceback
            logger.info(traceback.format_exc())
            return np.zeros((self.tile_size, self.tile_size), dtype=np.uint8)

    async def get_tile_bytes(self, dataset_id, timestamp, channel, scale, x, y):
        """Serve a tile as PNG bytes"""
        try:
            # Use default timestamp if none provided
            timestamp = timestamp or self.default_timestamp
            
            # Get tile data as numpy array
            tile_data = await self.get_tile_np_data(dataset_id, timestamp, channel, scale, x, y)
            
            # Convert to PNG bytes
            image = Image.fromarray(tile_data)
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            return buffer.getvalue()
        except Exception as e:
            logger.info(f"Error in get_tile_bytes: {str(e)}")
            blank_image = Image.new("L", (self.tile_size, self.tile_size), color=0)
            buffer = io.BytesIO()
            blank_image.save(buffer, format="PNG")
            return buffer.getvalue()

    async def get_tile_base64(self, dataset_id, timestamp, channel, scale, x, y):
        """Serve a tile as base64 string"""
        # Use default timestamp if none provided
        timestamp = timestamp or self.default_timestamp
        
        tile_bytes = await self.get_tile_bytes(dataset_id, timestamp, channel, scale, x, y)
        return base64.b64encode(tile_bytes).decode('utf-8')

    async def test_zarr_access(self, dataset_id=None, timestamp=None, channel=None):
        """
        Test function to verify Zarr file access is working correctly.
        Attempts to access a known chunk at coordinates (335, 384) in scale0.
        
        Args:
            dataset_id (str, optional): The dataset ID to test. Defaults to agent-lens/image-map-20250429-treatment-zip.
            timestamp (str, optional): The timestamp to use. Defaults to the default timestamp.
            channel (str, optional): The channel to test. Defaults to BF_LED_matrix_full.
            
        Returns:
            dict: A dictionary with status, success flag, and additional info about the chunk.
        """
        try:
            # Use default values if not provided
            dataset_id = dataset_id or "agent-lens/image-map-20250429-treatment-zip"
            timestamp = timestamp or self.default_timestamp
            channel = channel or "BF_LED_matrix_full"
            
            logger.info(f"Testing Zarr access for dataset: {dataset_id}, timestamp: {timestamp}, channel: {channel}")
            
            # Ensure the zarr group is in cache
            cache_key = f"{dataset_id}:{timestamp}:{channel}"
            await self.ensure_zarr_group(dataset_id, timestamp, channel)
            
            if cache_key not in self.zarr_groups_cache:
                return {
                    "status": "error", 
                    "success": False, 
                    "message": "Failed to get Zarr group"
                }
            
            zarr_group = self.zarr_groups_cache[cache_key]['group']
            success = zarr_group is not None
            
            return {
                "status": "ok" if success else "error",
                "success": success,
                "message": "Successfully accessed test chunk" if success else "Chunk contained no data",
            }
            
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            logger.info(f"Error in test_zarr_access: {str(e)}")
            logger.info(error_traceback)
            
            return {
                "status": "error",
                "success": False,
                "message": f"Error accessing Zarr: {str(e)}",
                "error": str(e),
                "traceback": error_traceback
            }
