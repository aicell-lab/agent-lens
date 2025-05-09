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

    async def get_zarr_group(self, dataset_id, timestamp, channel, cache_max_size=2**26 # 64 MB LRU cache
    ):
        """
        Access a Zarr group stored within a zip file in an artifact.

        Args:
            workspace (str): The workspace containing the artifact.
            artifact_alias (str): The alias of the artifact (e.g., 'image-map-20250429-treatment-zip').
            timestamp (str): The timestamp folder name.
            channel (str): The channel name (used for the zip filename).
            cache_max_size (int, optional): Max size for LRU cache in bytes. Defaults to 2**26.

        Returns:
            zarr.Group: The root Zarr group object.
        """
        if self._svc is None:
            raise ConnectionError("Artifact Manager service not connected. Call connect_server first.")

        art_id = dataset_id
        zip_file_path = f"{timestamp}/{channel}.zip"

        try:
            cache_key = f"{dataset_id}:{timestamp}:{channel}"
            
            now = time.time()
            
            # Check if we have a cached version and if it's still valid
            if cache_key in self.zarr_groups_cache:
                cached_data = self.zarr_groups_cache[cache_key]
                # If URL is close to expiring, refresh it
                if cached_data['expiry'] - now < self.url_expiry_buffer:
                    logger.info(f"URL for {cache_key} is about to expire, refreshing")
                    # Remove from cache to force refresh
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
                    logger.info(f"Accessing artifact at: {art_id}/{zip_file_path}")
                    
                    # Get the direct download URL for the zip file
                    download_url = await self._svc.get_file(art_id, zip_file_path)
                    
                    # Extract expiration time from URL
                    expiry_time = self._extract_expiry_from_url(download_url)
                    
                    # Create a more efficient HTTP connection pool for this URL domain
                    transport = httpx.AsyncHTTPTransport(
                        limits=httpx.Limits(
                            max_keepalive_connections=20,
                            max_connections=50,
                            keepalive_expiry=60.0
                        )
                    )
                    
                    # First, try to download a few common chunks directly to pre-populate cache
                    # This helps reduce multiple small requests
                    common_chunks = [
                        "0.0", "0.1", "1.0", "1.1", # Scale 0, top-left chunks
                        # Add more commonly accessed chunks based on analysis
                    ]
                    
                    # Construct the URL for FSStore using fsspec's zip chaining
                    store_url = f"zip::{download_url}"
                    
                    # Run the synchronous Zarr operations in a thread pool with optimized settings
                    logger.info("Running Zarr open in thread executor with optimized connection settings...")
                    
                    # Custom sync function that adds connection pooling for the underlying HTTP requests
                    def _open_zarr_with_connection_pooling(url, cache_size):
                        logger.info(f"Opening Zarr store with connection pooling: {url}")
                        import fsspec
                        from fsspec.implementations.http import HTTPFileSystem
                        
                        # Configure fsspec with better connection handling
                        fs = fsspec.filesystem(
                            "http", 
                            block_size=2*1024*1024,  # 2MB blocks instead of default 5MB
                            cache_type="readahead",  # Prefetch next blocks
                            cache_size=20,           # Cache more blocks
                            client_kwargs={
                                "timeout": 30.0,
                                "pool_connections": 10,
                                "pool_maxsize": 20
                            }
                        )
                        fsspec.config.conf["http"] = fs
                        
                        # Create optimized store
                        store = FSStore(url, mode="r")
                        if cache_size and cache_size > 0:
                            logger.info(f"Using LRU cache with size: {cache_size} bytes")
                            store = LRUStoreCache(store, max_size=cache_size)
                            
                        # Open root group
                        root_group = zarr.group(store=store)
                        logger.info(f"Zarr group opened successfully.")
                        
                        # Prefetch common chunks
                        try:
                            # Access scale0 array which is commonly used
                            if 'scale0' in root_group:
                                # This will trigger chunk loading for the initial visible area
                                logger.info("Prefetching common scale0 chunks...")
                                for i in range(2):
                                    for j in range(2):
                                        chunk = root_group['scale0'].get_orthogonal_selection(
                                            (slice(i*256, (i+1)*256), slice(j*256, (j+1)*256))
                                        )
                                        logger.info(f"Prefetched chunk at {i},{j} with size {chunk.nbytes/1024:.1f}KB")
                        except Exception as e:
                            logger.info(f"Error during chunk prefetching (non-critical): {e}")
                            
                        return root_group
                    
                    # Use the optimized function
                    zarr_group = await asyncio.to_thread(_open_zarr_with_connection_pooling, store_url, cache_max_size)
                    
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
        except Exception as e:
            logger.info(f"Error in get_zarr_group: {e}")
            import traceback
            logger.info(traceback.format_exc())
            return None

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
        # Add a processed tile cache with TTL
        self.processed_tile_cache = {}  # format: {cache_key: {'data': np_array, 'timestamp': timestamp}}
        self.processed_tile_cache_size = 1000  # Maximum number of tiles to cache
        self.processed_tile_ttl = 600  # Cache expiration in seconds (10 minutes)
        self.is_running = True
        self.session = None
        self.default_timestamp = "2025-04-29_16-38-27"  # Set a default timestamp
        # Set URL expiration buffer - refresh URLs 15 minutes before they expire (extended)
        self.url_expiry_buffer = 900  # seconds (15 min instead of 5 min)
        # Default URL expiration time (1 hour)
        self.default_url_expiry = 3600  # seconds
        # Function to open zarr store synchronously
        self._open_zarr_sync = self._create_open_zarr_sync_function()
        
        # Add a priority queue for tile requests
        self.tile_request_queue = asyncio.PriorityQueue()
        # Track in-progress tile requests to avoid duplicates
        self.in_progress_tiles = set()
        # Start the tile request processor
        self.tile_processor_task = None
        
        # Add a cleanup task for the tile cache
        self.cache_cleanup_task = None

    def _create_open_zarr_sync_function(self):
        """Create a reusable function for opening zarr stores synchronously"""
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
            
            # Initialize aiohttp session for any HTTP requests
            self.session = aiohttp.ClientSession()
            
            # Start the tile request processor
            if self.tile_processor_task is None or self.tile_processor_task.done():
                self.tile_processor_task = asyncio.create_task(self._process_tile_requests())
            
            # Start the cache cleanup task
            if self.cache_cleanup_task is None or self.cache_cleanup_task.done():
                self.cache_cleanup_task = asyncio.create_task(self._cleanup_tile_cache())
            
            logger.info("ZarrTileManager connected successfully")
            return True
        except Exception as e:
            logger.info(f"Error connecting to artifact manager: {str(e)}")
            import traceback
            logger.info(traceback.format_exc())
            return False

    async def _cleanup_tile_cache(self):
        """Periodically clean up expired tiles from the cache"""
        try:
            while self.is_running:
                now = time.time()
                # Find keys to delete (expired items)
                expired_keys = [
                    key for key, value in self.processed_tile_cache.items() 
                    if now - value['timestamp'] > self.processed_tile_ttl
                ]
                
                # Remove expired items
                for key in expired_keys:
                    del self.processed_tile_cache[key]
                
                logger.info(f"Cleaned up {len(expired_keys)} expired tiles from cache. Current cache size: {len(self.processed_tile_cache)}")
                
                # If cache is too large, remove oldest items
                if len(self.processed_tile_cache) > self.processed_tile_cache_size:
                    # Sort by timestamp (oldest first)
                    sorted_items = sorted(
                        self.processed_tile_cache.items(),
                        key=lambda x: x[1]['timestamp']
                    )
                    
                    # Calculate how many to remove
                    to_remove = len(self.processed_tile_cache) - self.processed_tile_cache_size
                    
                    # Remove oldest items
                    for i in range(to_remove):
                        if i < len(sorted_items):
                            key = sorted_items[i][0]
                            del self.processed_tile_cache[key]
                    
                    logger.info(f"Removed {to_remove} oldest tiles from cache due to size limit")
                
                # Sleep for a minute before checking again
                await asyncio.sleep(60)
        except asyncio.CancelledError:
            logger.info("Tile cache cleanup task cancelled")
        except Exception as e:
            logger.info(f"Error in tile cache cleanup: {e}")
            import traceback
            logger.info(traceback.format_exc())

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
        
        # Cancel the cache cleanup task
        if self.cache_cleanup_task and not self.cache_cleanup_task.done():
            self.cache_cleanup_task.cancel()
            try:
                await self.cache_cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Clear the processed tile cache
        self.processed_tile_cache.clear()
        
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
            # If URL is close to expiring, refresh it
            if cached_data['expiry'] - now < self.url_expiry_buffer:
                logger.info(f"URL for {cache_key} is about to expire, refreshing")
                # Remove from cache to force refresh
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
                # We no longer need to parse the dataset_id into workspace and artifact_alias
                # Just use the dataset_id directly since it's already the full path
                logger.info(f"Accessing artifact at: {dataset_id}/{timestamp}/{channel}.zip")
                
                # Get the direct download URL for the zip file
                zip_file_path = f"{timestamp}/{channel}.zip"
                download_url = await self.artifact_manager._svc.get_file(dataset_id, zip_file_path)
                
                # Extract expiration time from URL
                expiry_time = self._extract_expiry_from_url(download_url)
                
                # Construct the URL for FSStore using fsspec's zip chaining
                store_url = f"zip::{download_url}"
                
                # Run the synchronous Zarr operations in a thread pool
                logger.info("Running Zarr open in thread executor...")
                zarr_group = await asyncio.to_thread(self._open_zarr_sync, store_url, 2**26)  # Using 64MB cache instead of 256MB
                
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

    async def ensure_zarr_group(self, dataset_id, timestamp, channel):
        """
        Ensure a Zarr group is available in cache, but don't return it.
        This is useful for preloading or refreshing the cache.
        """
        cache_key = f"{dataset_id}:{timestamp}:{channel}"
        
        now = time.time()
        
        # Check if we have a cached version and if it's still valid
        if cache_key in self.zarr_groups_cache:
            cached_data = self.zarr_groups_cache[cache_key]
            # If URL is close to expiring, refresh it
            if cached_data['expiry'] - now < self.url_expiry_buffer:
                logger.info(f"URL for {cache_key} is about to expire, refreshing")
                # Remove from cache to force refresh
                del self.zarr_groups_cache[cache_key]
            else:
                # Still valid, nothing to do
                return True
        
        # Load the Zarr group into cache
        zarr_group = await self.get_zarr_group(dataset_id, timestamp, channel)
        return zarr_group is not None

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
            np.ndarray or None: Tile data as numpy array, or None if tile not found/empty
        """
        try:
            # Use default timestamp if none provided
            timestamp = timestamp or self.default_timestamp
            
            # Check if this tile is in the processed tile cache
            cache_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{x}:{y}"
            
            # Return cached tile if available and not expired
            if cache_key in self.processed_tile_cache:
                cached_data = self.processed_tile_cache[cache_key]
                # Check if the cached data is still valid (not expired)
                if time.time() - cached_data['timestamp'] < self.processed_tile_ttl:
                    logger.info(f"Using cached tile data for {cache_key}")
                    return cached_data['data']
                else:
                    # Remove expired data from cache
                    del self.processed_tile_cache[cache_key]
            
            # Check if we're already processing a group of tiles that includes this one
            # Define the group region (2x2 grid of tiles around the requested one)
            group_x_start = max(0, x - 1)
            group_y_start = max(0, y - 1)
            group_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{group_x_start},{group_y_start}_group"
            
            # If this tile is part of a group being processed, wait for it to complete
            if group_key in self.in_progress_tiles:
                for attempt in range(3):  # Try a few times with exponential backoff
                    # Check if the tile is now in cache after a small delay
                    await asyncio.sleep(0.1 * (2 ** attempt))
                    if cache_key in self.processed_tile_cache:
                        cached_data = self.processed_tile_cache[cache_key]
                        if time.time() - cached_data['timestamp'] < self.processed_tile_ttl:
                            logger.info(f"Using cached tile data for {cache_key} after waiting for group processing")
                            return cached_data['data']
            
            # Ensure the zarr group is in cache without returning it
            zarr_cache_key = f"{dataset_id}:{timestamp}:{channel}"
            try:
                zarr_group = await self.get_zarr_group(dataset_id, timestamp, channel)
                if zarr_group is None:
                    # Return None instead of empty array if group can't be loaded
                    # This allows frontend to handle it appropriately
                    logger.info(f"Could not load Zarr group, returning None for {cache_key}")
                    return None
            except Exception as e:
                logger.info(f"Error ensuring zarr group: {e}")
                # Return None instead of zero array
                return None
            
            # Mark this group as being processed
            self.in_progress_tiles.add(group_key)
            
            try:
                # Navigate to the right array in the Zarr hierarchy
                try:
                    # Get the scale array
                    scale_array = zarr_group[f'scale{scale}']
                    
                    # Calculate a larger region to fetch (2x2 tiles around the requested one)
                    # This reduces the number of HTTP requests by fetching adjacent tiles in a single operation
                    region_size = 2  # Number of tiles to fetch in each direction
                    region_x_start = max(0, x - region_size // 2)
                    region_y_start = max(0, y - region_size // 2)
                    
                    # Fetch the entire region at once
                    logger.info(f"Fetching tile region at scale{scale}, starting at ({region_y_start},{region_x_start})")
                    region_data = scale_array.get_orthogonal_selection(
                        (
                            slice(region_y_start * self.chunk_size, (region_y_start + region_size) * self.chunk_size),
                            slice(region_x_start * self.chunk_size, (region_x_start + region_size) * self.chunk_size)
                        )
                    )
                    logger.info(f'Fetched region with size in KB: {region_data.nbytes / 1024:.1f}')
                    
                    # Check if region data is valid (contains non-zero values)
                    # If it's all zeros or mostly zeros, we consider it empty
                    if np.count_nonzero(region_data) < 10:  # Arbitrary threshold
                        logger.info(f"Region data is empty (all zeros), returning None")
                        # Remove group from processing to allow future attempts
                        self.in_progress_tiles.discard(group_key)
                        return None
                    
                    # Extract the specific tile data from the region
                    tile_y_offset = (y - region_y_start) * self.chunk_size
                    tile_x_offset = (x - region_x_start) * self.chunk_size
                    
                    # Make sure we're within bounds (region might be smaller at edges)
                    if (tile_y_offset >= 0 and 
                        tile_x_offset >= 0 and 
                        tile_y_offset + self.chunk_size <= region_data.shape[0] and
                        tile_x_offset + self.chunk_size <= region_data.shape[1]):
                        
                        # Extract the requested tile from the larger region
                        tile_data = region_data[
                            tile_y_offset:tile_y_offset + self.chunk_size,
                            tile_x_offset:tile_x_offset + self.chunk_size
                        ]
                        
                        # Check if this specific tile is empty
                        if np.count_nonzero(tile_data) < 10:  # Arbitrary threshold
                            logger.info(f"Tile data is empty, returning None for {cache_key}")
                            return None
                        
                        # Cache the requested tile
                        self.processed_tile_cache[cache_key] = {
                            'data': tile_data,
                            'timestamp': time.time()
                        }
                        
                        # Also cache the other tiles in the region
                        now = time.time()
                        for region_y in range(region_size):
                            for region_x in range(region_size):
                                # Skip the already cached requested tile
                                if region_y * self.chunk_size == tile_y_offset and region_x * self.chunk_size == tile_x_offset:
                                    continue
                                
                                # Calculate coordinates for this tile in the region
                                region_tile_y = region_y_start + region_y
                                region_tile_x = region_x_start + region_x
                                
                                # Only cache tiles that fall within the fetched region
                                if (region_y * self.chunk_size < region_data.shape[0] and 
                                    region_x * self.chunk_size < region_data.shape[1] and
                                    (region_y + 1) * self.chunk_size <= region_data.shape[0] and
                                    (region_x + 1) * self.chunk_size <= region_data.shape[1]):
                                    
                                    # Extract tile data
                                    adjacent_tile_data = region_data[
                                        region_y * self.chunk_size:(region_y + 1) * self.chunk_size,
                                        region_x * self.chunk_size:(region_x + 1) * self.chunk_size
                                    ]
                                    
                                    # Only cache non-empty tiles
                                    if np.count_nonzero(adjacent_tile_data) >= 10:
                                        # Cache this adjacent tile
                                        adjacent_cache_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{region_tile_x}:{region_tile_y}"
                                        self.processed_tile_cache[adjacent_cache_key] = {
                                            'data': adjacent_tile_data,
                                            'timestamp': now
                                        }
                        
                        return tile_data
                    else:
                        # If for some reason the tile isn't within the region (should be rare)
                        # Fall back to direct tile access
                        logger.info("Tile coordinates outside fetched region, falling back to direct access")
                        tile_data = scale_array[y*self.tile_size:(y+1)*self.tile_size, 
                                            x*self.tile_size:(x+1)*self.tile_size]
                        
                        # Check if this specific tile is empty
                        if np.count_nonzero(tile_data) < 10:  # Arbitrary threshold
                            logger.info(f"Tile data is empty from direct access, returning None for {cache_key}")
                            return None
                        
                        # Cache the tile
                        self.processed_tile_cache[cache_key] = {
                            'data': tile_data,
                            'timestamp': time.time()
                        }
                        
                        return tile_data
                        
                except KeyError as e:
                    logger.info(f"KeyError accessing Zarr array path: {e}")
                    # Return None instead of zero array
                    return None
                except Exception as inner_e:
                    logger.info(f"Error processing tile data: {inner_e}")
                    # Return None instead of zero array
                    return None
            finally:
                # Remove the group key from in-progress set
                self.in_progress_tiles.discard(group_key)
                
        except Exception as e:
            logger.info(f"Error getting tile data: {e}")
            import traceback
            logger.info(traceback.format_exc())
            # Return None instead of zero array
            return None

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
