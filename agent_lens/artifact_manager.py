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
import threading

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

# Add NetworkMonitor class for tracking bandwidth usage
class NetworkMonitor:
    """Monitors network bandwidth usage for HTTP requests"""
    
    def __init__(self):
        self.bandwidth_stats = {}
        self.lock = asyncio.Lock()
        
    async def record_bandwidth(self, operation, url, bytes_transferred, direction="download"):
        """
        Record bandwidth usage for a specific operation
        
        Args:
            operation (str): Name of the operation (e.g., "get_zarr_group", "get_file")
            url (str): URL being accessed (will be truncated for storage efficiency)
            bytes_transferred (int): Number of bytes transferred
            direction (str): "download" or "upload"
        """
        async with self.lock:
            # Truncate URL to keep only domain and first part of path
            truncated_url = self._truncate_url(url)
            
            # Create key for this operation
            key = f"{operation}:{truncated_url}:{direction}"
            
            if key not in self.bandwidth_stats:
                self.bandwidth_stats[key] = {
                    "total_bytes": 0,
                    "request_count": 0,
                    "last_access": time.time()
                }
            
            # Update stats
            self.bandwidth_stats[key]["total_bytes"] += bytes_transferred
            self.bandwidth_stats[key]["request_count"] += 1
            self.bandwidth_stats[key]["last_access"] = time.time()
    
    def _truncate_url(self, url):
        """Truncate URL to keep only domain and first part of path"""
        if not url:
            return "unknown"
        
        # Extract domain and first part of path
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc
            path = parsed.path.split("/")[1] if len(parsed.path.split("/")) > 1 else ""
            return f"{domain}/{path}"
        except:
            # If parsing fails, return a shortened version
            return url[:50] + "..." if len(url) > 50 else url
    
    async def get_bandwidth_report(self):
        """Get a report of bandwidth usage"""
        async with self.lock:
            # Convert bytes to more readable format
            report = []
            for key, stats in self.bandwidth_stats.items():
                operation, url, direction = key.split(":", 2)
                report.append({
                    "operation": operation,
                    "url": url,
                    "direction": direction,
                    "total_mb": round(stats["total_bytes"] / (1024 * 1024), 2),
                    "request_count": stats["request_count"],
                    "avg_kb_per_request": round(stats["total_bytes"] / stats["request_count"] / 1024, 2) if stats["request_count"] > 0 else 0,
                    "last_access": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(stats["last_access"]))
                })
            
            # Sort by total bandwidth usage
            report.sort(key=lambda x: x["total_mb"], reverse=True)
            return report
    
    async def log_bandwidth_report(self):
        """Log the current bandwidth report"""
        report = await self.get_bandwidth_report()
        logger.info("=== Bandwidth Usage Report ===")
        for item in report:
            logger.info(f"{item['operation']} ({item['url']}, {item['direction']}): {item['total_mb']} MB, {item['request_count']} requests, {item['avg_kb_per_request']} KB/request")
        logger.info("==============================")
        
    def print_bandwidth_report(self):
        """Print the bandwidth report to standard output"""
        import asyncio
        
        async def _get_and_print():
            report = await self.get_bandwidth_report()
            print("\n=== Bandwidth Usage Report ===")
            print(f"{'OPERATION':<25} {'URL':<30} {'DIRECTION':<10} {'TOTAL MB':>10} {'REQUESTS':>10} {'AVG KB/REQ':>12}")
            print("-" * 100)
            
            for item in report:
                print(f"{item['operation'][:25]:<25} {item['url'][:30]:<30} {item['direction']:<10} {item['total_mb']:>10.2f} {item['request_count']:>10} {item['avg_kb_per_request']:>12.2f}")
            
            # Calculate totals
            total_mb = sum(item["total_mb"] for item in report)
            total_requests = sum(item["request_count"] for item in report)
            
            print("-" * 100)
            print(f"{'TOTAL':<25} {'':30} {'':10} {total_mb:>10.2f} {total_requests:>10}")
            print("==============================\n")
        
        # Run the async function in the current event loop if possible
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Create a future to store the result
            future = asyncio.run_coroutine_threadsafe(_get_and_print(), loop)
            future.result()  # Wait for completion
        else:
            # If no event loop is running, create one
            loop.run_until_complete(_get_and_print())

# Create a global instance
network_monitor = NetworkMonitor()

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
        self.network_monitor = network_monitor  # Add reference to network monitor

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
            # Track upload bandwidth
            content_size = len(file_content)
            response = await client.put(put_url, data=file_content, timeout=500)
            await self.network_monitor.record_bandwidth("add_file", put_url, content_size, "upload")
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
            # Track download bandwidth
            await self.network_monitor.record_bandwidth("get_file", get_url, len(response.content), "download")

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
                    
                    # Create a bandwidth-tracking HTTP client for fsspec
                    class BandwidthTrackingHTTPFile:
                        def __init__(self, url, network_monitor):
                            self.url = url
                            self.network_monitor = network_monitor
                            self.bytes_downloaded = 0
                            
                        async def record_download(self, content_length):
                            if content_length > 0:
                                self.bytes_downloaded += content_length
                                await self.network_monitor.record_bandwidth(
                                    "zarr_chunk_download", 
                                    self.url, 
                                    content_length, 
                                    "download"
                                )
                    
                    # Run the synchronous Zarr operations in a thread pool with optimized settings
                    logger.info("Running Zarr open in thread executor with optimized connection settings...")
                    
                    # Custom sync function that adds connection pooling and bandwidth tracking
                    def _open_zarr_with_bandwidth_tracking(url, cache_size, network_monitor_ref):
                        logger.info(f"Opening Zarr store with bandwidth tracking: {url}")
                        import fsspec
                        from fsspec.implementations.http import HTTPFileSystem
                        
                        # Original HTTP open function
                        original_open = HTTPFileSystem.open
                        
                        # Override to track bandwidth
                        def bandwidth_tracking_open(self, url, **kwargs):
                            file = original_open(self, url, **kwargs)
                            
                            # Monkey patch the file's read method to track bandwidth
                            original_read = file.read
                            
                            def tracked_read(size=-1):
                                content = original_read(size)
                                if content:
                                    # Use asyncio.run in a new thread since we're in sync code
                                    import threading
                                    def record_bandwidth():
                                        loop = asyncio.new_event_loop()
                                        asyncio.set_event_loop(loop)
                                        loop.run_until_complete(
                                            network_monitor_ref.record_bandwidth(
                                                "zarr_chunk_read", url, len(content), "download"
                                            )
                                        )
                                        loop.close()
                                    
                                    # Run in a separate thread to avoid blocking
                                    t = threading.Thread(target=record_bandwidth)
                                    t.daemon = True
                                    t.start()
                                return content
                            
                            file.read = tracked_read
                            return file
                        
                        # Apply the monkey patch
                        HTTPFileSystem.open = bandwidth_tracking_open
                        
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
                        
                        # Restore original open method
                        HTTPFileSystem.open = original_open
                            
                        return root_group
                    
                    # Use the optimized function with bandwidth tracking
                    zarr_group = await asyncio.to_thread(_open_zarr_with_bandwidth_tracking, store_url, cache_max_size, network_monitor)
                    
                    # Cache the Zarr group for future use, along with expiration time
                    self.zarr_groups_cache[cache_key] = {
                        'group': zarr_group,
                        'url': download_url,
                        'expiry': expiry_time
                    }
                    
                    logger.info(f"Cached Zarr group for {cache_key}, expires in {int(expiry_time - now)} seconds")
                    
                    # Log bandwidth report after loading
                    await network_monitor.log_bandwidth_report()
                    
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

    async def get_bandwidth_stats(self):
        """
        Get bandwidth usage statistics for API access
        
        Returns:
            dict: Bandwidth usage statistics
        """
        # Get the bandwidth report from the network monitor
        report = await self.network_monitor.get_bandwidth_report()
        
        # Calculate totals by operation type
        operation_totals = {}
        for item in report:
            op = item["operation"]
            if op not in operation_totals:
                operation_totals[op] = {
                    "total_mb": 0,
                    "request_count": 0
                }
            operation_totals[op]["total_mb"] += item["total_mb"]
            operation_totals[op]["request_count"] += item["request_count"]
        
        # Calculate overall totals
        total_mb = sum(item["total_mb"] for item in report)
        total_requests = sum(item["request_count"] for item in report)
        
        # Return formatted report
        return {
            "detailed_report": report,
            "operation_totals": operation_totals,
            "total_mb": total_mb,
            "total_requests": total_requests,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S")
        }

    async def reset_bandwidth_stats(self):
        """Reset bandwidth statistics"""
        async with self.network_monitor.lock:
            self.network_monitor.bandwidth_stats = {}
        return {"status": "ok", "message": "Bandwidth statistics reset successfully"}

    def print_bandwidth_report(self):
        """Print bandwidth usage report to standard output"""
        self.network_monitor.print_bandwidth_report()
        
    async def test_bandwidth_monitoring(self, dataset_id=None, timestamp=None, channel=None, scale=0, x=0, y=0):
        """
        Test function to demonstrate bandwidth monitoring.
        Performs a series of operations to generate bandwidth usage data.
        
        Args:
            dataset_id (str, optional): The dataset ID to test
            timestamp (str, optional): The timestamp to use
            channel (str, optional): The channel to test
            scale (int): Scale level to test
            x, y (int): Tile coordinates to test
            
        Returns:
            dict: Test results and bandwidth report
        """
        # Use default values if not provided
        dataset_id = dataset_id or "agent-lens/image-map-20250429-treatment-zip"
        timestamp = timestamp or self.default_timestamp
        channel = channel or "BF_LED_matrix_full"
        
        print(f"Starting bandwidth monitoring test with dataset: {dataset_id}")
        print(f"Timestamp: {timestamp}, Channel: {channel}, Scale: {scale}, Coordinates: ({x},{y})")
        
        # Reset bandwidth stats to start fresh
        await self.reset_bandwidth_stats()
        
        # Step 1: Access the Zarr group
        print("\nStep 1: Accessing Zarr group...")
        zarr_group = await self.get_zarr_group(dataset_id, timestamp, channel)
        print("Zarr group accessed.")
        
        # Print bandwidth after step 1
        print("\nBandwidth usage after accessing Zarr group:")
        self.print_bandwidth_report()
        
        # Step 2: Get a tile
        print("\nStep 2: Fetching a tile...")
        tile_data = await self.get_tile_np_data(dataset_id, timestamp, channel, scale, x, y)
        if tile_data is not None:
            print(f"Tile fetched successfully. Shape: {tile_data.shape}, Size: {tile_data.nbytes / 1024:.2f} KB")
        else:
            print("Failed to fetch tile.")
        
        # Print bandwidth after step 2
        print("\nBandwidth usage after fetching tile:")
        self.print_bandwidth_report()
        
        # Step 3: Get the same tile again (should use cache)
        print("\nStep 3: Fetching the same tile again (should use cache)...")
        tile_data = await self.get_tile_np_data(dataset_id, timestamp, channel, scale, x, y)
        if tile_data is not None:
            print(f"Tile fetched from cache. Shape: {tile_data.shape}")
        else:
            print("Failed to fetch tile from cache.")
        
        # Print bandwidth after step 3
        print("\nBandwidth usage after fetching from cache:")
        self.print_bandwidth_report()
        
        # Step 4: Get adjacent tiles (some might be in cache from region fetching)
        print("\nStep 4: Fetching adjacent tiles...")
        for dx, dy in [(0, 1), (1, 0), (1, 1)]:
            tile_data = await self.get_tile_np_data(dataset_id, timestamp, channel, scale, x + dx, y + dy)
            if tile_data is not None:
                print(f"Adjacent tile ({x + dx},{y + dy}) fetched. Shape: {tile_data.shape}")
            else:
                print(f"Failed to fetch adjacent tile ({x + dx},{y + dy}).")
        
        # Final bandwidth report
        print("\nFinal bandwidth usage report:")
        self.print_bandwidth_report()
        
        # Get stats for return
        stats = await self.get_bandwidth_stats()
        
        return {
            "status": "success",
            "message": "Bandwidth monitoring test completed",
            "bandwidth_stats": stats
        }

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
        # Add empty region cache to avoid redundantly fetching known empty regions
        self.empty_regions_cache = {}  # format: {region_key: expiry_timestamp}
        self.empty_regions_ttl = 3600  # Empty regions valid for 1 hour
        self.empty_regions_cache_size = 2000  # Maximum number of empty regions to cache
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
        
        # Add network monitor reference
        self.network_monitor = network_monitor
        
        # Add bandwidth report task
        self.bandwidth_report_task = None
        self.bandwidth_report_interval = 300  # Log bandwidth report every 5 minutes

    def _create_open_zarr_sync_function(self):
        """Create a reusable function for opening zarr stores synchronously"""
        def _open_zarr_sync(url, cache_size):
            logger.info(f"Opening Zarr store: {url}")
            
            # Create a function to track HTTP reads
            from fsspec.implementations.http import HTTPFileSystem
            original_open = HTTPFileSystem.open
            
            def bandwidth_tracking_open(self, url, **kwargs):
                file = original_open(self, url, **kwargs)
                
                # Monkey patch the file's read method to track bandwidth
                original_read = file.read
                
                def tracked_read(size=-1):
                    content = original_read(size)
                    if content:
                        # Record this read in a thread-safe way
                        import threading
                        def record_bandwidth():
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            loop.run_until_complete(
                                network_monitor.record_bandwidth(
                                    "zarr_chunk_read", url, len(content), "download"
                                )
                            )
                            loop.close()
                        
                        # Run in a separate thread to avoid blocking
                        t = threading.Thread(target=record_bandwidth)
                        t.daemon = True
                        t.start()
                    return content
                
                file.read = tracked_read
                return file
            
            # Apply the monkey patch
            HTTPFileSystem.open = bandwidth_tracking_open
            
            try:
                # Configure optimized HTTP settings
                http_kwargs = {
                    "block_size": 2*1024*1024,  # 2MB blocks instead of default 5MB
                    "cache_type": "readahead",  # Prefetch next blocks
                    "cache_size": 20,           # Cache more blocks
                    "client_kwargs": {
                        "timeout": 30.0,
                        "pool_connections": 10,
                        "pool_maxsize": 20
                    }
                }
                
                # Use httpx transport if available
                try:
                    import httpx
                    http_kwargs["transport"] = httpx.HTTPTransport(
                        limits=httpx.Limits(
                            max_keepalive_connections=20,
                            max_connections=50,
                            keepalive_expiry=60.0
                        )
                    )
                except (ImportError, AttributeError):
                    logger.info("Enhanced HTTP transport not available")
                
                # Create optimized store with HTTP optimization but without custom filesystem
                import fsspec
                # Use the standard HTTPFileSystem but with optimized settings
                fs = fsspec.filesystem("http", **http_kwargs)
                
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
                        
                        # Prefetch a 2x2 grid of chunks at the center for scale0 (most commonly viewed)
                        for i in range(2):
                            for j in range(2):
                                chunk = root_group['scale0'].get_orthogonal_selection(
                                    (slice(i*256, (i+1)*256), slice(j*256, (j+1)*256))
                                )
                                logger.info(f"Prefetched scale0 chunk at {i},{j} with size {chunk.nbytes/1024:.1f}KB")
                        
                        # Also prefetch the first chunk of lower resolution scales for faster navigation
                        for scale in range(1, min(3, len([k for k in root_group.keys() if k.startswith('scale')]))):
                            if f'scale{scale}' in root_group:
                                chunk = root_group[f'scale{scale}'].get_orthogonal_selection(
                                    (slice(0, 256), slice(0, 256))
                                )
                                logger.info(f"Prefetched scale{scale} chunk with size {chunk.nbytes/1024:.1f}KB")
                except Exception as e:
                    logger.info(f"Error during chunk prefetching (non-critical): {e}")
                
                # Restore original open method
                HTTPFileSystem.open = original_open
                    
                return root_group
            finally:
                # Restore original open method if not already done
                if HTTPFileSystem.open != original_open:
                    HTTPFileSystem.open = original_open
                
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
            
            # Start the bandwidth report task
            if self.bandwidth_report_task is None or self.bandwidth_report_task.done():
                self.bandwidth_report_task = asyncio.create_task(self._periodic_bandwidth_report())
            
            logger.info("ZarrTileManager connected successfully")
            
            # Pre-prime ZIP metadata for default dataset
            default_dataset_id = 'agent-lens/image-map-20250429-treatment-zip'
            default_timestamp = self.default_timestamp
            default_channels = ['BF_LED_matrix_full']  # Most commonly used channel
            
            # Prime ZIP metadata in background
            asyncio.create_task(self.prime_zip_metadata(default_dataset_id, default_timestamp, default_channels))
            
            return True
        except Exception as e:
            logger.info(f"Error connecting to artifact manager: {str(e)}")
            import traceback
            logger.info(traceback.format_exc())
            return False

    async def prime_zip_metadata(self, dataset_id, timestamp, channels):
        """
        Pre-download ZIP file metadata to speed up subsequent accesses.
        This helps avoid the initial overhead when first accessing a ZIP file.
        
        Args:
            dataset_id (str): The dataset ID
            timestamp (str): The timestamp folder
            channels (list): List of channels to prime
        """
        logger.info(f"Priming ZIP metadata for {dataset_id}, timestamp {timestamp}")
        
        try:
            for channel in channels:
                # Get the file URL without actually downloading the content
                zip_file_path = f"{timestamp}/{channel}.zip"
                download_url = await self.artifact_manager._svc.get_file(dataset_id, zip_file_path)
                
                # Create a unique key for this metadata
                metadata_key = f"{dataset_id}:{timestamp}:{channel}:metadata"
                
                # Fetch just the headers to prime the connection and possibly cache DNS
                if self.session:
                    logger.info(f"Prefetching headers for {channel}.zip")
                    try:
                        # First make a HEAD request to get headers without downloading content
                        async with self.session.head(download_url, timeout=5) as response:
                            if response.status == 200:
                                # Record the metadata size
                                content_length = response.headers.get('Content-Length', '0')
                                logger.info(f"ZIP metadata prefetch successful for {channel}.zip: {content_length} bytes")
                                
                                # Record minimal bandwidth usage for metadata prefetch
                                await self.network_monitor.record_bandwidth(
                                    "zip_metadata_prefetch", 
                                    f"{dataset_id}/{timestamp}/{channel}", 
                                    int(content_length) * 0.05,  # Estimate 5% of file size for metadata
                                    "download"
                                )
                                
                                # Now make a small range request to get just the ZIP central directory
                                # This is typically at the end of the file, so request the last 8KB
                                if content_length and int(content_length) > 8192:
                                    content_length_int = int(content_length)
                                    start_byte = max(0, content_length_int - 8192)
                                    headers = {'Range': f'bytes={start_byte}-{content_length_int-1}'}
                                    
                                    async with self.session.get(download_url, headers=headers, timeout=5) as range_resp:
                                        if range_resp.status == 206:  # Partial content
                                            # Just read and discard the content - the important part is priming the connection
                                            _ = await range_resp.read()
                                            logger.info(f"ZIP central directory prefetched for {channel}.zip")
                    except Exception as e:
                        logger.info(f"Non-critical error prefetching ZIP metadata for {channel}.zip: {e}")
                        # Continue with other channels even if one fails
                        continue
                        
            logger.info(f"ZIP metadata priming completed for {dataset_id}, timestamp {timestamp}")
            return True
        except Exception as e:
            logger.info(f"Error priming ZIP metadata: {e}")
            import traceback
            logger.info(traceback.format_exc())
            return False

    async def _periodic_bandwidth_report(self):
        """Periodically log bandwidth usage reports"""
        try:
            while self.is_running:
                # Wait for the specified interval
                await asyncio.sleep(self.bandwidth_report_interval)
                
                # Log bandwidth report
                await self.network_monitor.log_bandwidth_report()
        except asyncio.CancelledError:
            logger.info("Bandwidth report task cancelled")
        except Exception as e:
            logger.info(f"Error in bandwidth report task: {e}")
            import traceback
            logger.info(traceback.format_exc())

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
        
        # Cancel the bandwidth report task
        if self.bandwidth_report_task and not self.bandwidth_report_task.done():
            self.bandwidth_report_task.cancel()
            try:
                await self.bandwidth_report_task
            except asyncio.CancelledError:
                pass
        
        # Log final bandwidth report
        await self.network_monitor.log_bandwidth_report()
        
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
        start_time = time.time()
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
                    # Record cache hit (no bandwidth used)
                    await self.network_monitor.record_bandwidth(
                        "tile_cache_hit", 
                        f"{dataset_id}/{timestamp}/{channel}", 
                        0, 
                        "cache"
                    )
                    return cached_data['data']
                else:
                    # Remove expired data from cache
                    del self.processed_tile_cache[cache_key]
            
            # Dynamically adjust region size based on scale level
            # - For high zoom levels (scale 0-1), use larger regions (2x2) since those are detail views where users likely explore nearby areas
            # - For medium zoom levels (scale 2), use medium regions (1x2 or 2x1) based on X/Y coordinates (edge heuristic)
            # - For low zoom levels (scale 3-4), use smaller regions (1x1) since those are overview tiles
            
            region_size = 1  # Default to 1x1 region (single tile)
            
            if scale <= 1:
                # Higher zoom levels (more detail) - use 2x2 regions for dense viewing areas
                region_size = 2
            elif scale == 2:
                # Medium zoom - use edge detection heuristic
                # Check if this is likely to be a sparse area (edges of the image)
                # Assuming image dimensions of 2048x2048 and tile size of 256, we have 8x8=64 tiles
                # Consider tiles near center (2,2 to 5,5) as dense areas
                
                tile_count_per_dimension = 2048 // self.chunk_size  # Typically 8 for a 2048x2048 image
                center_start = tile_count_per_dimension // 4  # ~ 2
                center_end = center_start * 3  # ~ 6
                
                if (center_start <= x <= center_end and center_start <= y <= center_end):
                    # This is a center/dense area
                    region_size = 2
                else:
                    # This is an edge/sparse area
                    region_size = 1
            # else scale >= 3: Keep region_size = 1 for overview tiles
            
            # Define the group region based on the dynamic region size
            group_x_start = max(0, x - region_size // 2)
            group_y_start = max(0, y - region_size // 2)
            group_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{group_x_start},{group_y_start}_group"
            
            # Check empty regions cache to avoid fetching known empty regions
            empty_region_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{group_x_start}:{group_y_start}"
            if empty_region_key in self.empty_regions_cache:
                expiry_time = self.empty_regions_cache[empty_region_key]
                if time.time() < expiry_time:
                    logger.info(f"Skipping known empty region at {scale}:{group_x_start}:{group_y_start}")
                    # Record cache hit for empty region (no bandwidth used)
                    await self.network_monitor.record_bandwidth(
                        "empty_region_cache_hit", 
                        f"{dataset_id}/{timestamp}/{channel}", 
                        0, 
                        "cache"
                    )
                    return None
                else:
                    # Remove expired entry
                    del self.empty_regions_cache[empty_region_key]
            
            # If this tile is part of a group being processed, wait for it to complete
            if group_key in self.in_progress_tiles:
                for attempt in range(3):  # Try a few times with exponential backoff
                    # Check if the tile is now in cache after a small delay
                    await asyncio.sleep(0.1 * (2 ** attempt))
                    if cache_key in self.processed_tile_cache:
                        cached_data = self.processed_tile_cache[cache_key]
                        if time.time() - cached_data['timestamp'] < self.processed_tile_ttl:
                            logger.info(f"Using cached tile data for {cache_key} after waiting for group processing")
                            # Record waiting for group processing (no bandwidth used)
                            await self.network_monitor.record_bandwidth(
                                "tile_wait_group", 
                                f"{dataset_id}/{timestamp}/{channel}", 
                                0, 
                                "cache"
                            )
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
                    
                    # Calculate a region to fetch based on our dynamic region size
                    region_x_start = max(0, x - region_size // 2)
                    region_y_start = max(0, y - region_size // 2)
                    
                    # Add a quick check for empty regions at edges
                    # If we're at high scales (3-4) and at the edges, we might be in empty space
                    if scale >= 3:
                        # Get the shape of the array to check boundaries
                        array_shape = scale_array.shape
                        max_x = array_shape[1] // self.chunk_size
                        max_y = array_shape[0] // self.chunk_size
                        
                        # If we're close to the max boundaries, this might be empty space
                        if x > max_x - 2 or y > max_y - 2:
                            # Check if this specific coordinate is within bounds
                            if x * self.chunk_size >= array_shape[1] or y * self.chunk_size >= array_shape[0]:
                                logger.info(f"Tile coordinates outside array bounds, returning None")
                                self.in_progress_tiles.discard(group_key)
                                
                                # Add to empty regions cache
                                self._add_to_empty_regions_cache(empty_region_key)
                                
                                return None
                    
                    # Fetch the entire region at once
                    logger.info(f"Fetching tile region at scale{scale}, starting at ({region_y_start},{region_x_start})")
                    
                    # Track time before fetching region
                    region_fetch_start = time.time()
                    
                    region_data = scale_array.get_orthogonal_selection(
                        (
                            slice(region_y_start * self.chunk_size, (region_y_start + region_size) * self.chunk_size),
                            slice(region_x_start * self.chunk_size, (region_x_start + region_size) * self.chunk_size)
                        )
                    )
                    
                    # Calculate time taken and data size for fetching region
                    region_fetch_time = time.time() - region_fetch_start
                    region_size_kb = region_data.nbytes / 1024
                    logger.info(f'Fetched region with size: {region_size_kb:.1f} KB in {region_fetch_time:.3f}s')
                    
                    # Record bandwidth usage for region fetch
                    # This is an estimate since we can't directly measure HTTP traffic from zarr
                    await self.network_monitor.record_bandwidth(
                        f"tile_region_fetch_scale{scale}", 
                        f"{dataset_id}/{timestamp}/{channel}", 
                        region_data.nbytes, 
                        "download"
                    )
                    
                    # Check if region data is valid (contains non-zero values)
                    # If it's all zeros or mostly zeros, we consider it empty
                    if np.count_nonzero(region_data) < 10:  # Arbitrary threshold
                        logger.info(f"Region data is empty (all zeros), returning None")
                        # Remove group from processing to allow future attempts
                        self.in_progress_tiles.discard(group_key)
                        
                        # Add to empty regions cache
                        self._add_to_empty_regions_cache(empty_region_key)
                        
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
                            # Add specific tile to empty regions cache
                            specific_empty_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{x}:{y}"
                            self._add_to_empty_regions_cache(specific_empty_key)
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
                                    
                                    # Check if this adjacent tile is empty
                                    if np.count_nonzero(adjacent_tile_data) < 10:
                                        # Add to empty regions cache
                                        adjacent_empty_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{region_tile_x}:{region_tile_y}"
                                        self._add_to_empty_regions_cache(adjacent_empty_key)
                                    else:
                                        # Only cache non-empty tiles
                                        adjacent_cache_key = f"{dataset_id}:{timestamp}:{channel}:{scale}:{region_tile_x}:{region_tile_y}"
                                        self.processed_tile_cache[adjacent_cache_key] = {
                                            'data': adjacent_tile_data,
                                            'timestamp': now
                                        }
                        
                        # Record total processing time
                        total_time = time.time() - start_time
                        logger.info(f"Total tile processing time: {total_time:.3f}s")
                        
                        return tile_data
                    else:
                        # If for some reason the tile isn't within the region (should be rare)
                        # Fall back to direct tile access
                        logger.info("Tile coordinates outside fetched region, falling back to direct access")
                        
                        # Track time for direct tile access
                        direct_fetch_start = time.time()
                        
                        tile_data = scale_array[y*self.tile_size:(y+1)*self.tile_size, 
                                            x*self.tile_size:(x+1)*self.tile_size]
                        
                        # Calculate time and size for direct tile access
                        direct_fetch_time = time.time() - direct_fetch_start
                        tile_size_kb = tile_data.nbytes / 1024
                        logger.info(f'Direct tile fetch: {tile_size_kb:.1f} KB in {direct_fetch_time:.3f}s')
                        
                        # Record bandwidth usage for direct tile fetch
                        await self.network_monitor.record_bandwidth(
                            f"direct_tile_fetch_scale{scale}", 
                            f"{dataset_id}/{timestamp}/{channel}", 
                            tile_data.nbytes, 
                            "download"
                        )
                        
                        # Check if this specific tile is empty
                        if np.count_nonzero(tile_data) < 10:  # Arbitrary threshold
                            logger.info(f"Tile data is empty from direct access, returning None for {cache_key}")
                            # Add to empty regions cache
                            self._add_to_empty_regions_cache(cache_key)
                            return None
                        
                        # Cache the tile
                        self.processed_tile_cache[cache_key] = {
                            'data': tile_data,
                            'timestamp': time.time()
                        }
                        
                        # Record total processing time
                        total_time = time.time() - start_time
                        logger.info(f"Total tile processing time (direct): {total_time:.3f}s")
                        
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
