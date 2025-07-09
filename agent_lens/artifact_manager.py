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
import time
from asyncio import Lock
import threading
import json
import uuid
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

# Constants
SERVER_URL = "https://hypha.aicell.io"
WORKSPACE_TOKEN = os.environ.get("WORKSPACE_TOKEN")
ARTIFACT_ALIAS = "20250506-scan-time-lapse-2025-05-06_16-56-52"
DEFAULT_CHANNEL = "BF_LED_matrix_full"

# New class to replace TileManager using Zarr for efficient access
class ZarrTileManager:
    def __init__(self):
        self.artifact_manager = None
        self.artifact_manager_server = None
        self.workspace = "agent-lens"  # Default workspace
        self.tile_size = 256  # Default chunk size for Zarr, should match .zarray chunks dimension
        self.channels = [
            "BF_LED_matrix_full",
            "Fluorescence_405_nm_Ex",
            "Fluorescence_488_nm_Ex",
            "Fluorescence_561_nm_Ex",
            "Fluorescence_638_nm_Ex"
        ]
        # Cache for .zarray or .zgroup metadata: {(dataset_id, metadata_path): metadata_dict}
        self.metadata_cache = {} 
        self.metadata_cache_lock = Lock()
        
        # Processed tile cache (final numpy arrays)
        self.processed_tile_cache = {}  # format: {cache_key: {'data': np_array, 'timestamp': timestamp}}
        self.processed_tile_cache_size = 1000
        self.processed_tile_ttl = 600  # 10 minutes

        # Empty regions cache
        self.empty_regions_cache = {}
        self.empty_regions_ttl = 3600
        self.empty_regions_cache_size = 2000

        self.is_running = True
        self.session = None # aiohttp.ClientSession
        self.http_session_lock = Lock()

        self.default_dataset_alias = "20250506-scan-time-lapse-2025-05-06_16-56-52" # Example, will be overridden by frontend

        self.tile_request_queue = asyncio.PriorityQueue()
        self.in_progress_tiles = set() # For individual tile processing locks, distinct from metadata locks
        self.tile_processor_task = None
        self.cache_cleanup_task = None

        # For per-tile processing locks in get_tile_np_data
        self.tile_processing_locks = {} 
        self.tile_processing_locks_lock = Lock() # Lock for accessing/modifying self.tile_processing_locks

    async def _get_http_session(self):
        """Get or create an aiohttp.ClientSession with increased connection pool."""
        async with self.http_session_lock:
            if self.session is None or self.session.closed:
                connector = aiohttp.TCPConnector(
                    limit_per_host=50,  # Max connections per host
                    limit=100,          # Total max connections
                    ssl=False           # Assuming HTTP for local/internal Hypha, adjust if HTTPS
                )
                self.session = aiohttp.ClientSession(connector=connector)
            return self.session

    async def _fetch_zarr_metadata(self, dataset_alias, metadata_path_in_dataset):
        """
        Fetch and cache Zarr metadata (.zgroup or .zarray) for a given dataset alias.
        Args:
            dataset_alias (str): The alias of the time-lapse dataset (e.g., "20250506-scan-timelapse-...")
            metadata_path_in_dataset (str): Path within the dataset (e.g., "Channel/scaleN/.zarray")
        """
        cache_key = (dataset_alias, metadata_path_in_dataset)
        async with self.metadata_cache_lock:
            if cache_key in self.metadata_cache:
                logger.info(f"Using cached metadata for {cache_key}")
                return self.metadata_cache[cache_key]

        if not self.artifact_manager:
            logger.error("Artifact manager not available in ZarrTileManager for metadata fetch.")
            # Attempt to connect if not already
            await self.connect()
            if not self.artifact_manager:
                 raise ConnectionError("Artifact manager connection failed.")

        try:
            logger.info(f"Fetching metadata: dataset_alias='{dataset_alias}', path='{metadata_path_in_dataset}'")
            
            metadata_content_bytes = await self.artifact_manager.get_file(
                self.workspace,  # "agent-lens"
                dataset_alias,
                metadata_path_in_dataset
            )
            metadata_str = metadata_content_bytes.decode('utf-8')
            metadata = json.loads(metadata_str)
            
            async with self.metadata_cache_lock:
                self.metadata_cache[cache_key] = metadata
            logger.info(f"Fetched and cached metadata for {cache_key}")
            return metadata
        except Exception as e:
            logger.error(f"Error fetching metadata for {dataset_alias} / {metadata_path_in_dataset}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None

    async def connect(self, workspace_token=None, server_url="https://hypha.aicell.io"):
        """Connect to the Artifact Manager service and initialize http session."""
        try:
            token = workspace_token or os.environ.get("WORKSPACE_TOKEN")
            if not token:
                # Try to load from .env if not in environment
                dotenv.load_dotenv()
                token = os.environ.get("WORKSPACE_TOKEN")
                if not token:
                    raise ValueError("Workspace token not provided and not found in .env")
            
            self.artifact_manager_server = await connect_to_server({
                "client_id": f"zarr-tile-client-{uuid.uuid4()}",
                "server_url": server_url,
                "token": token,
            })
            
            self.artifact_manager = AgentLensArtifactManager()
            await self.artifact_manager.connect_server(self.artifact_manager_server)
            
            # Initialize aiohttp session
            await self._get_http_session() # Ensures session is created
            
            if self.tile_processor_task is None or self.tile_processor_task.done():
                self.tile_processor_task = asyncio.create_task(self._process_tile_requests())
            
            if self.cache_cleanup_task is None or self.cache_cleanup_task.done():
                self.cache_cleanup_task = asyncio.create_task(self._cleanup_tile_cache())
            
            logger.info("ZarrTileManager connected successfully")
            
            # Example: Prime metadata for a default dataset if needed, or remove if priming is dynamic
            # await self.prime_metadata(self.default_dataset_alias, self.channels[0], scale=0)
            
            return True
        except Exception as e:
            logger.error(f"Error connecting ZarrTileManager: {str(e)}")
            import traceback
            logger.error(traceback.format_exc())
            self.artifact_manager = None # Ensure it's None on failure
            self.artifact_manager_server = None
            return False

    async def prime_metadata(self, dataset_alias, channel_name, scale):
        """Pre-fetch .zarray metadata for a given dataset, channel, and scale."""
        logger.info(f"Priming metadata for {dataset_alias}/{channel_name}/scale{scale}")
        try:
            zarray_path = f"{channel_name}/scale{scale}/.zarray"
            await self._fetch_zarr_metadata(dataset_alias, zarray_path)
            
            zgroup_channel_path = f"{channel_name}/.zgroup"
            await self._fetch_zarr_metadata(dataset_alias, zgroup_channel_path)

            zgroup_root_path = ".zgroup"
            await self._fetch_zarr_metadata(dataset_alias, zgroup_root_path)
            logger.info(f"Metadata priming complete for {dataset_alias}/{channel_name}/scale{scale}")
            return True
        except Exception as e:
            logger.error(f"Error priming metadata: {e}")
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
        
        if self.tile_processor_task and not self.tile_processor_task.done():
            self.tile_processor_task.cancel()
            try: await self.tile_processor_task
            except asyncio.CancelledError: pass
        
        if self.cache_cleanup_task and not self.cache_cleanup_task.done():
            self.cache_cleanup_task.cancel()
            try: await self.cache_cleanup_task
            except asyncio.CancelledError: pass
        
        self.processed_tile_cache.clear()
        async with self.metadata_cache_lock: # Protect access during clear
            self.metadata_cache.clear()
        self.empty_regions_cache.clear() # Clear this too
        
        async with self.http_session_lock: # Protect session access during close
            if self.session and not self.session.closed:
                await self.session.close()
                self.session = None
        
        if self.artifact_manager_server:
            try:
                await self.artifact_manager_server.disconnect()
            except Exception as e:
                logger.error(f"Error disconnecting artifact manager server: {e}")
            self.artifact_manager_server = None
            self.artifact_manager = None
        logger.info("ZarrTileManager closed.")

    async def _process_tile_requests(self):
        """Process tile requests from the priority queue"""
        try:
            while self.is_running:
                try:
                    # Get the next tile request with highest priority (lowest number)
                    priority, (dataset_id, channel, scale, x, y) = await self.tile_request_queue.get()
                    
                    # Create a unique key for this tile
                    tile_key = f"{dataset_id}:{channel}:{scale}:{x}:{y}" # Timestamp removed from key
                    
                    # Skip if this tile is already being processed
                    if tile_key in self.in_progress_tiles:
                        self.tile_request_queue.task_done()
                        continue
                    
                    # Mark this tile as in progress
                    self.in_progress_tiles.add(tile_key)
                    
                    try:
                        # Process the tile request
                        await self.get_tile_np_data(dataset_id, channel, scale, x, y)
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
        Queue a tile request. Timestamp is now mostly for context/logging, dataset_id is key.
        """
        # dataset_id is the time-lapse dataset alias
        tile_key = f"{dataset_id}:{channel}:{scale}:{x}:{y}" # Timestamp removed from key
        
        if tile_key in self.in_progress_tiles:
            return
        
        # The tuple in queue now omits timestamp from path-critical parts
        await self.tile_request_queue.put((priority, (dataset_id, channel, scale, x, y)))

    async def get_tile_np_data(self, dataset_id, channel, scale, x, y):
        """
        Get a tile as numpy array using new Hypha HTTP chunk access.
        Args:
            dataset_id (str): The alias of the time-lapse specific dataset.
            channel (str): Channel name
            scale (int): Scale level
            x (int): X coordinate of the chunk/tile for this scale.
            y (int): Y coordinate of the chunk/tile for this scale.
        Returns:
            np.ndarray or None: Tile data as numpy array, or None if not found/empty/error.
        """
        start_time = time.time()
        # Key for processed_tile_cache and empty_regions_cache
        # Timestamp is removed as dataset_alias is now specific to a time-lapse
        tile_cache_key = f"{dataset_id}:{channel}:{scale}:{x}:{y}"

        # 1. Check processed tile cache
        if tile_cache_key in self.processed_tile_cache:
            cached_data = self.processed_tile_cache[tile_cache_key]
            if time.time() - cached_data['timestamp'] < self.processed_tile_ttl:
                logger.info(f"Using cached processed tile data for {tile_cache_key}")
                return cached_data['data']
            else:
                del self.processed_tile_cache[tile_cache_key]

        # 2. Check empty regions cache
        if tile_cache_key in self.empty_regions_cache:
            expiry_time = self.empty_regions_cache[tile_cache_key]
            if time.time() < expiry_time:
                logger.info(f"Skipping known empty tile: {tile_cache_key}")
                return None
            else:
                del self.empty_regions_cache[tile_cache_key]
        
        # Acquire or create a lock for this specific tile
        async with self.tile_processing_locks_lock:
            if tile_cache_key not in self.tile_processing_locks:
                self.tile_processing_locks[tile_cache_key] = asyncio.Lock()
        
        tile_specific_lock = self.tile_processing_locks[tile_cache_key]

        async with tile_specific_lock:
            # Re-check caches now that we have the lock, as another task might have populated it
            if tile_cache_key in self.processed_tile_cache:
                cached_data = self.processed_tile_cache[tile_cache_key] # Re-fetch, it might have been updated
                if time.time() - cached_data['timestamp'] < self.processed_tile_ttl:
                    logger.info(f"Using cached processed tile data for {tile_cache_key} (after lock)")
                    return cached_data['data']
                else: # Expired while waiting for lock or by another thread
                    del self.processed_tile_cache[tile_cache_key]
            
            if tile_cache_key in self.empty_regions_cache: # Re-check empty cache
                expiry_time = self.empty_regions_cache[tile_cache_key]
                if time.time() < expiry_time:
                    logger.info(f"Skipping known empty tile: {tile_cache_key} (after lock)")
                    return None
                else:
                    del self.empty_regions_cache[tile_cache_key]

            # Construct path to .zarray metadata
            # Assuming scale_level is integer 0, 1, 2... corresponding to "scale0", "scale1"...
            zarray_path_in_dataset = f"{channel}/scale{scale}/.zarray"
            zarray_metadata = await self._fetch_zarr_metadata(dataset_id, zarray_path_in_dataset)

            if not zarray_metadata:
                logger.error(f"Failed to get .zarray metadata for {dataset_id}/{zarray_path_in_dataset}")
                self._add_to_empty_regions_cache(tile_cache_key) # Assume missing metadata means empty
                return None

            try:
                z_shape = zarray_metadata["shape"]         # [total_height, total_width]
                z_chunks = zarray_metadata["chunks"]       # [chunk_height, chunk_width]
                z_dtype_str = zarray_metadata["dtype"]
                z_dtype = np.dtype(z_dtype_str)
                z_compressor_meta = zarray_metadata["compressor"] # Can be null
                # z_filters_meta = zarray_metadata.get("filters") # numcodecs handles filters if part of codec
                z_fill_value = zarray_metadata.get("fill_value") # Important for empty/partial chunks

            except KeyError as e:
                logger.error(f"Incomplete .zarray metadata for {dataset_id}/{zarray_path_in_dataset}: Missing key {e}")
                return None

            # Check chunk coordinates are within bounds of the scale array
            num_chunks_y_total = (z_shape[0] + z_chunks[0] - 1) // z_chunks[0]
            num_chunks_x_total = (z_shape[1] + z_chunks[1] - 1) // z_chunks[1]

            if not (0 <= y < num_chunks_y_total and 0 <= x < num_chunks_x_total):
                logger.info(f"Chunk coordinates ({x}, {y}) out of bounds for {dataset_id}/{channel}/scale{scale} (max: {num_chunks_x_total-1}, {num_chunks_y_total-1})")
                self._add_to_empty_regions_cache(tile_cache_key)
                return None
            
            # Determine path to the zip file and the chunk name within that zip
            # Interpretation: {y}.zip contains a row of chunks, chunk file is named {x}
            zip_file_path_in_dataset = f"{channel}/scale{scale}/{y}.zip"
            chunk_name_in_zip = str(x)

            # Construct the full chunk download URL
            # SERVER_URL defined globally in the module, self.workspace="agent-lens"
            chunk_download_url = f"{SERVER_URL}/{self.workspace}/artifacts/{dataset_id}/zip-files/{zip_file_path_in_dataset}?path={chunk_name_in_zip}"
            
            logger.info(f"Attempting to fetch chunk: {chunk_download_url}")
            
            http_session = await self._get_http_session()
            raw_chunk_bytes = None
            try:
                async with http_session.get(chunk_download_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                    if response.status == 200:
                        raw_chunk_bytes = await response.read()
                    elif response.status == 404:
                        logger.warning(f"Chunk not found (404) at {chunk_download_url}. Treating as empty.")
                        self._add_to_empty_regions_cache(tile_cache_key)
                        # Create an empty tile using fill_value if available
                        empty_tile_data = np.full(z_chunks, z_fill_value if z_fill_value is not None else 0, dtype=z_dtype)
                        return empty_tile_data[:self.tile_size, :self.tile_size] # Ensure correct output size
                    else:
                        error_text = await response.text()
                        logger.error(f"Error fetching chunk {chunk_download_url}: HTTP {response.status} - {error_text}")
                        return None # Indicate error
            except asyncio.TimeoutError:
                logger.error(f"Timeout fetching chunk: {chunk_download_url}")
                return None
            except aiohttp.ClientError as e: # More specific aiohttp errors
                logger.error(f"ClientError fetching chunk {chunk_download_url}: {e}")
                return None
            except Exception as e: # Catch-all for other unexpected errors during fetch
                logger.error(f"Unexpected error fetching chunk {chunk_download_url}: {e}")
                import traceback
                logger.error(traceback.format_exc())
                return None

            if not raw_chunk_bytes: # Should be caught by 404 or other errors, but as a safeguard
                logger.warning(f"No data received for chunk: {chunk_download_url}, though HTTP status was not an error.")
                self._add_to_empty_regions_cache(tile_cache_key)
                empty_tile_data = np.full(z_chunks, z_fill_value if z_fill_value is not None else 0, dtype=z_dtype)
                return empty_tile_data[:self.tile_size, :self.tile_size]


            # 4. Decompress and decode chunk data
            try:
                if z_compressor_meta is None: # Raw, uncompressed data
                    decompressed_data = raw_chunk_bytes
                else:
                    codec = numcodecs.get_codec(z_compressor_meta) # Handles filters too if defined in compressor object
                    decompressed_data = codec.decode(raw_chunk_bytes)
                
                # Convert to NumPy array and reshape. Chunk shape from .zarray is [height, width]
                chunk_data = np.frombuffer(decompressed_data, dtype=z_dtype).reshape(z_chunks)
                
                # The Zarr chunk might be smaller than self.tile_size if it's a partial edge chunk.
                # Or it could be larger if .zarray chunks are not self.tile_size.
                # We need to return a tile of self.tile_size.
                
                final_tile_data = np.full((self.tile_size, self.tile_size), 
                                           z_fill_value if z_fill_value is not None else 0, 
                                           dtype=z_dtype)
                
                # Determine the slice to copy from chunk_data and where to place it in final_tile_data
                copy_height = min(chunk_data.shape[0], self.tile_size)
                copy_width = min(chunk_data.shape[1], self.tile_size)
                
                final_tile_data[:copy_height, :copy_width] = chunk_data[:copy_height, :copy_width]

            except Exception as e:
                logger.error(f"Error decompressing/decoding chunk from {chunk_download_url}: {e}")
                logger.error(f"Metadata: dtype={z_dtype_str}, compressor={z_compressor_meta}, chunk_shape={z_chunks}")
                import traceback
                logger.error(traceback.format_exc())
                return None # Indicate error

            # 5. Check if tile is effectively empty (e.g., all fill_value or zeros)
            # Use a small threshold for non-zero values if fill_value is 0 or not defined
            is_empty_threshold = 10 
            if z_fill_value is not None:
                if np.all(final_tile_data == z_fill_value):
                    logger.info(f"Tile data is all fill_value ({z_fill_value}), treating as empty: {tile_cache_key}")
                    self._add_to_empty_regions_cache(tile_cache_key) # Cache as empty
                    return None # Return None for empty tiles based on fill_value
            elif np.count_nonzero(final_tile_data) < is_empty_threshold:
                logger.info(f"Tile data is effectively empty (few non-zeros), treating as empty: {tile_cache_key}")
                self._add_to_empty_regions_cache(tile_cache_key) # Cache as empty
                return None

            # 6. Cache the processed tile
            self.processed_tile_cache[tile_cache_key] = {
                'data': final_tile_data,
                'timestamp': time.time()
            }
            
            total_time = time.time() - start_time
            logger.info(f"Total tile processing time for {tile_cache_key}: {total_time:.3f}s, size: {final_tile_data.nbytes/1024:.1f}KB")
            
            # final_tile_data is returned outside the lock by initial design, which is fine
            # as it's read from local var.

        return final_tile_data

    def _add_to_empty_regions_cache(self, key):
        """Add a region key to the empty regions cache with expiration"""
        # Set expiration time
        expiry_time = time.time() + self.empty_regions_ttl
        
        # Add to cache
        self.empty_regions_cache[key] = expiry_time
        
        # Clean up if cache is too large
        if len(self.empty_regions_cache) > self.empty_regions_cache_size:
            # Get the entries sorted by expiry time (oldest first)
            sorted_entries = sorted(
                self.empty_regions_cache.items(),
                key=lambda item: item[1]
            )
            
            # Remove oldest 25% of entries
            entries_to_remove = len(self.empty_regions_cache) // 4
            for i in range(entries_to_remove):
                if i < len(sorted_entries):
                    del self.empty_regions_cache[sorted_entries[i][0]]
            
            logger.info(f"Cleaned up {entries_to_remove} oldest entries from empty regions cache")

    async def get_tile_bytes(self, dataset_alias, timestamp, channel_name, scale, x, y):
        """Serve a tile as PNG bytes. Timestamp is for context if needed, not path."""
        # dataset_alias is the time-lapse specific dataset
        tile_data_np = await self.get_tile_np_data(dataset_alias, channel_name, scale, x, y) # Pass dataset_alias
        
        if tile_data_np is None: # Handle case where tile is empty or error occurred
            logger.info(f"No numpy data for tile {dataset_alias}/{channel_name}/{scale}/{x}/{y}, returning blank image.")
            # Create a blank image (e.g., black or based on fill_value if smart)
            # For simplicity, black for now.
            pil_image = Image.new("L", (self.tile_size, self.tile_size), color=0) 
        else:
            try:
                # Ensure data is in a suitable range for image conversion if necessary
                # For example, if data is float, it might need scaling. Assuming uint8 or uint16 for typical bioimages.
                if tile_data_np.dtype == np.uint16:
                    # Basic windowing for uint16: scale to uint8. This is a simple approach.
                    # More sophisticated windowing/LUT would be applied in frontend or FastAPI layer.
                    scaled_data = (tile_data_np / 256).astype(np.uint8)
                    pil_image = Image.fromarray(scaled_data)
                elif tile_data_np.dtype == np.float32 or tile_data_np.dtype == np.float64:
                    # Handle float data: normalize to 0-255 for PNG. This is a basic normalization.
                    min_val, max_val = np.min(tile_data_np), np.max(tile_data_np)
                    if max_val > min_val:
                        normalized_data = ((tile_data_np - min_val) / (max_val - min_val) * 255).astype(np.uint8)
                    else: # Flat data
                        normalized_data = np.zeros_like(tile_data_np, dtype=np.uint8)
                    pil_image = Image.fromarray(normalized_data)
                else: # Assume uint8 or other directly compatible types
                    pil_image = Image.fromarray(tile_data_np)
            except Exception as e:
                logger.error(f"Error converting numpy tile to PIL Image: {e}. Data type: {tile_data_np.dtype}, shape: {tile_data_np.shape}")
                pil_image = Image.new("L", (self.tile_size, self.tile_size), color=0) # Fallback to blank

        buffer = io.BytesIO()
        pil_image.save(buffer, format="PNG") # Default PNG compression
        return buffer.getvalue()

    async def get_tile_base64(self, dataset_alias, timestamp, channel, scale, x, y):
        """Serve a tile as base64 string. Timestamp for context."""
        tile_bytes = await self.get_tile_bytes(dataset_alias, timestamp, channel, scale, x, y)
        return base64.b64encode(tile_bytes).decode('utf-8')

    async def test_zarr_access(self, dataset_alias=None, channel=None, scale=0, x=0, y=0):
        """
        Test function to verify new Zarr chunk access via HTTP.
        Args:
            dataset_alias (str, optional): The dataset alias to test.
            channel (str, optional): The channel to test.
            scale (int): Scale level.
            x,y (int): Chunk coordinates.
        Returns:
            dict: Status and info.
        """
        dataset_alias = dataset_alias or self.default_dataset_alias # Use a default if none provided
        channel = channel or self.channels[0] # Default to first channel
        
        logger.info(f"Testing Zarr access for: {dataset_alias}/{channel}/scale{scale}/chunk({x},{y})")
        
        if not self.artifact_manager:
            await self.connect()
            if not self.artifact_manager:
                return {"status": "error", "success": False, "message": "Artifact manager not connected."}

        # 1. Test metadata fetching
        zarray_path = f"{channel}/scale{scale}/.zarray"
        metadata = await self._fetch_zarr_metadata(dataset_alias, zarray_path)
        if not metadata:
            return {
                "status": "error", 
                "success": False, 
                "message": f"Failed to fetch .zarray metadata from {dataset_alias}/{zarray_path}"
            }
        logger.info(f"Successfully fetched .zarray metadata: {metadata}")

        # 2. Test tile data fetching
        tile_data = await self.get_tile_np_data(dataset_alias, channel, scale, x, y)
        
        if tile_data is None:
            return {
                "status": "error",
                "success": False,
                "message": f"Failed to get tile data for {dataset_alias}/{channel}/scale{scale}/({x},{y}). Might be empty or error."
            }

        logger.info(f"Successfully fetched tile data. Shape: {tile_data.shape}, dtype: {tile_data.dtype}")
        
        non_zero_count = np.count_nonzero(tile_data)
        fill_value = metadata.get("fill_value")
        
        # Check if it's all fill_value (if fill_value is defined)
        is_all_fill = False
        if fill_value is not None and np.all(tile_data == fill_value):
            is_all_fill = True
            
        return {
            "status": "ok",
            "success": True,
            "message": "Successfully accessed test chunk and metadata.",
            "metadata_sample": dict(list(metadata.items())[:3]), # First 3 items of metadata
            "tile_shape": tile_data.shape,
            "tile_dtype": str(tile_data.dtype),
            "tile_non_zero_count": non_zero_count,
            "tile_is_all_fill_value": is_all_fill,
            "fill_value_in_metadata": fill_value
        }

# Constants
SERVER_URL = "https://hypha.aicell.io"
# WORKSPACE_TOKEN is loaded from .env by ZarrTileManager.connect or passed
# ARTIFACT_ALIAS is dataset specific, so it's passed as dataset_alias
DEFAULT_CHANNEL = "BF_LED_matrix_full" # Remains useful default

# The AgentLensArtifactManager class definition follows and remains largely unchanged by this specific ZarrTileManager refactor,
# as its get_file method is now used by ZarrTileManager for metadata.
# The `test_bandwidth_monitoring` in AgentLensArtifactManager would need an update if it relies on old Zarr access.
# And ensure `default_timestamp` in AgentLensArtifactManager is handled if used by test_bandwidth_monitoring.
# The old get_zarr_group in AgentLensArtifactManager should have been removed.
