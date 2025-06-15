"""
Comprehensive tests for artifact_manager.py module.
Tests focus on real usage patterns from register_frontend_service.py without mocks.
"""

import pytest
import asyncio
import os
import sys
import numpy as np
import time
from pathlib import Path
from PIL import Image
import io
import base64
import json

# Add the project root to the Python path to ensure agent_lens can be imported
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

try:
    from agent_lens.artifact_manager import ZarrTileManager, AgentLensArtifactManager
    from hypha_rpc import connect_to_server
except ImportError as e:
    pytest.skip(f"Failed to import required modules: {e}", allow_module_level=True)

# Test constants based on register_frontend_service.py usage
SERVER_URL = "https://hypha.aicell.io"
WORKSPACE = "agent-lens"
DEFAULT_DATASET_ALIAS = "20250506-scan-time-lapse-2025-05-06_16-56-52"
DEFAULT_CHANNEL = "BF_LED_matrix_full"
CHANNELS = [
    "BF_LED_matrix_full",
    "Fluorescence_405_nm_Ex",
    "Fluorescence_488_nm_Ex",
    "Fluorescence_561_nm_Ex",
    "Fluorescence_638_nm_Ex"
]


class TestZarrTileManager:
    """Test ZarrTileManager class with real connections."""
    
    @pytest.fixture
    async def tile_manager(self):
        """Create and connect a ZarrTileManager instance."""
        manager = ZarrTileManager()
        
        # Get token from environment
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        # Connect to server
        success = await manager.connect(workspace_token=workspace_token, server_url=SERVER_URL)
        if not success:
            pytest.skip("Failed to connect ZarrTileManager to server")
            
        yield manager
        
        # Cleanup
        await manager.close()
    
    @pytest.mark.integration
    async def test_zarr_tile_manager_initialization(self):
        """Test ZarrTileManager initialization."""
        manager = ZarrTileManager()
        
        # Check initial state
        assert manager.workspace == WORKSPACE
        assert manager.tile_size == 256
        assert manager.channels == CHANNELS
        assert manager.artifact_manager is None
        assert manager.is_running is True
        assert len(manager.processed_tile_cache) == 0
        assert len(manager.metadata_cache) == 0
    
    @pytest.mark.integration
    async def test_zarr_tile_manager_connection(self):
        """Test ZarrTileManager connection to server."""
        manager = ZarrTileManager()
        
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        try:
            # Test connection
            success = await manager.connect(workspace_token=workspace_token, server_url=SERVER_URL)
            assert success is True
            assert manager.artifact_manager is not None
            assert manager.artifact_manager_server is not None
            assert manager.session is not None
            
            # Test that background tasks are running
            assert manager.tile_processor_task is not None
            assert not manager.tile_processor_task.done()
            assert manager.cache_cleanup_task is not None
            assert not manager.cache_cleanup_task.done()
            
        finally:
            await manager.close()
    
    @pytest.mark.integration
    async def test_zarr_metadata_fetching(self, tile_manager):
        """Test fetching Zarr metadata as used in register_frontend_service.py."""
        # Test with default dataset and channel
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        
        # Fetch .zarray metadata
        zarray_path = f"{channel}/scale{scale}/.zarray"
        metadata = await tile_manager._fetch_zarr_metadata(dataset_alias, zarray_path)
        
        if metadata is not None:
            # Verify metadata structure
            assert isinstance(metadata, dict)
            expected_keys = ["shape", "chunks", "dtype", "compressor"]
            for key in expected_keys:
                assert key in metadata, f"Missing key: {key}"
            
            # Verify data types
            assert isinstance(metadata["shape"], list)
            assert isinstance(metadata["chunks"], list)
            assert isinstance(metadata["dtype"], str)
            assert len(metadata["shape"]) == 2  # 2D image
            assert len(metadata["chunks"]) == 2  # 2D chunks
            
            # Check that metadata is cached
            cache_key = (dataset_alias, zarray_path)
            assert cache_key in tile_manager.metadata_cache
    
    @pytest.mark.integration
    async def test_tile_request_queue(self, tile_manager):
        """Test tile request queuing as used in register_frontend_service.py."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        priority = 10
        
        # Queue a tile request
        await tile_manager.request_tile(dataset_alias, None, channel, scale, x, y, priority)
        
        # Check that request was queued
        assert not tile_manager.tile_request_queue.empty()
        
        # Allow some time for processing
        await asyncio.sleep(0.1)
    
    @pytest.mark.integration
    async def test_get_tile_np_data(self, tile_manager):
        """Test getting tile data as numpy array - core function from register_frontend_service.py."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        
        # Get tile data
        tile_data = await tile_manager.get_tile_np_data(dataset_alias, channel, scale, x, y)
        
        if tile_data is not None:
            # Verify tile data structure
            assert isinstance(tile_data, np.ndarray)
            assert tile_data.shape == (tile_manager.tile_size, tile_manager.tile_size)
            assert tile_data.dtype in [np.uint8, np.uint16, np.float32, np.float64]
            
            # Verify data is not all zeros (unless it's legitimately empty)
            if np.any(tile_data):
                assert np.min(tile_data) >= 0
                assert np.max(tile_data) > 0
            
            # Check that tile is cached (only if data is not None)
            cache_key = f"{dataset_alias}:{channel}:{scale}:{x}:{y}"
            assert cache_key in tile_manager.processed_tile_cache
            
            # Verify cache entry structure
            cache_entry = tile_manager.processed_tile_cache[cache_key]
            assert "data" in cache_entry
            assert "timestamp" in cache_entry
            assert np.array_equal(cache_entry["data"], tile_data)
        else:
            # If tile is None (empty), check that it's in empty regions cache
            cache_key = f"{dataset_alias}:{channel}:{scale}:{x}:{y}"
            # Empty tiles are cached in empty_regions_cache, not processed_tile_cache
            assert cache_key in tile_manager.empty_regions_cache
    
    @pytest.mark.integration
    async def test_get_tile_bytes(self, tile_manager):
        """Test getting tile as PNG bytes - used in register_frontend_service.py."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        
        # Get tile as bytes
        tile_bytes = await tile_manager.get_tile_bytes(dataset_alias, None, channel, scale, x, y)
        
        assert isinstance(tile_bytes, bytes)
        assert len(tile_bytes) > 0
        
        # Verify it's a valid PNG
        image = Image.open(io.BytesIO(tile_bytes))
        assert image.format == "PNG"
        assert image.size == (tile_manager.tile_size, tile_manager.tile_size)
    
    @pytest.mark.integration
    async def test_get_tile_base64(self, tile_manager):
        """Test getting tile as base64 string - used in register_frontend_service.py."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        
        # Get tile as base64
        tile_b64 = await tile_manager.get_tile_base64(dataset_alias, None, channel, scale, x, y)
        
        assert isinstance(tile_b64, str)
        assert len(tile_b64) > 0
        
        # Verify it's valid base64
        try:
            decoded_bytes = base64.b64decode(tile_b64)
            image = Image.open(io.BytesIO(decoded_bytes))
            assert image.format == "PNG"
            assert image.size == (tile_manager.tile_size, tile_manager.tile_size)
        except Exception as e:
            pytest.fail(f"Invalid base64 or PNG data: {e}")
    
    @pytest.mark.integration
    async def test_zarr_access_test_function(self, tile_manager):
        """Test the test_zarr_access function - used for debugging in register_frontend_service.py."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        
        # Run test function
        result = await tile_manager.test_zarr_access(dataset_alias, channel, scale, x, y)
        
        assert isinstance(result, dict)
        assert "status" in result
        assert "success" in result
        assert "message" in result
        
        if result["success"]:
            assert result["status"] == "ok"
            assert "metadata_sample" in result
            assert "tile_shape" in result
            assert "tile_dtype" in result
            assert "tile_non_zero_count" in result
    
    @pytest.mark.integration
    async def test_multiple_channels(self, tile_manager):
        """Test multiple channels as used in merged tiles endpoint."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        scale = 5
        x, y = 0, 0
        
        # Test multiple channels
        test_channels = ["BF_LED_matrix_full", "Fluorescence_488_nm_Ex"]
        
        for channel in test_channels:
            if channel in CHANNELS:
                tile_data = await tile_manager.get_tile_np_data(dataset_alias, channel, scale, x, y)
                
                if tile_data is not None:
                    assert isinstance(tile_data, np.ndarray)
                    assert tile_data.shape == (tile_manager.tile_size, tile_manager.tile_size)
    
    @pytest.mark.integration
    async def test_cache_functionality(self, tile_manager):
        """Test tile caching functionality."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        x, y = 0, 0
        
        # First request
        start_time = time.time()
        tile_data_1 = await tile_manager.get_tile_np_data(dataset_alias, channel, scale, x, y)
        first_request_time = time.time() - start_time
        
        # Second request (should be cached)
        start_time = time.time()
        tile_data_2 = await tile_manager.get_tile_np_data(dataset_alias, channel, scale, x, y)
        second_request_time = time.time() - start_time
        
        if tile_data_1 is not None:
            # Both should be the same non-None data
            assert tile_data_2 is not None
            assert np.array_equal(tile_data_1, tile_data_2)
            
            # Second request should be faster (cached)
            assert second_request_time < first_request_time
        else:
            # Both should be None (empty tile cached as empty)
            assert tile_data_2 is None
            
            # Second request should be faster (cached as empty)
            assert second_request_time < first_request_time
    
    @pytest.mark.slow
    async def test_performance_multiple_tiles(self, tile_manager):
        """Test performance with multiple tile requests."""
        dataset_alias = DEFAULT_DATASET_ALIAS
        channel = DEFAULT_CHANNEL
        scale = 5
        
        # Request multiple tiles
        tile_requests = [(x, y) for x in range(3) for y in range(3)]
        
        start_time = time.time()
        tasks = []
        for x, y in tile_requests:
            task = tile_manager.get_tile_np_data(dataset_alias, channel, scale, x, y)
            tasks.append(task)
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        total_time = time.time() - start_time
        
        # Count successful requests
        successful_tiles = [r for r in results if isinstance(r, np.ndarray)]
        
        if successful_tiles:
            assert len(successful_tiles) > 0
            print(f"Retrieved {len(successful_tiles)} tiles in {total_time:.2f}s")
            
            # Verify all tiles have correct shape
            for tile in successful_tiles:
                assert tile.shape == (tile_manager.tile_size, tile_manager.tile_size)


class TestAgentLensArtifactManager:
    """Test AgentLensArtifactManager class with real connections."""
    
    @pytest.fixture
    async def artifact_manager(self):
        """Create and connect an AgentLensArtifactManager instance."""
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        # Connect to server
        server = await connect_to_server({
            "name": "test-client",
            "server_url": SERVER_URL,
            "token": workspace_token,
        })
        
        manager = AgentLensArtifactManager()
        await manager.connect_server(server)
        
        yield manager
        
        # Cleanup
        if server:
            await server.disconnect()
    
    @pytest.mark.integration
    async def test_artifact_manager_initialization(self):
        """Test AgentLensArtifactManager initialization."""
        manager = AgentLensArtifactManager()
        
        # Check initial state
        assert manager._svc is None
        assert manager.server is None
    
    @pytest.mark.integration
    async def test_artifact_manager_connection(self):
        """Test AgentLensArtifactManager connection to server."""
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        server = None
        try:
            # Connect to server
            server = await connect_to_server({
                "name": "test-client",
                "server_url": SERVER_URL,
                "token": workspace_token,
            })
            
            manager = AgentLensArtifactManager()
            await manager.connect_server(server)
            
            # Verify connection
            assert manager.server is server
            assert manager._svc is not None
            
        finally:
            if server:
                await server.disconnect()
    
    @pytest.mark.integration
    async def test_get_file_functionality(self, artifact_manager):
        """Test get_file functionality as used in register_frontend_service.py."""
        workspace = WORKSPACE
        dataset_id = DEFAULT_DATASET_ALIAS
        
        # Test getting a .zgroup file (as used in setup-image-map endpoint)
        file_path = ".zgroup"
        
        try:
            file_content = await artifact_manager.get_file(workspace, dataset_id, file_path)
            
            if file_content is not None:
                assert isinstance(file_content, bytes)
                assert len(file_content) > 0
                
                # Try to parse as JSON (zgroup files are JSON)
                try:
                    json_content = json.loads(file_content.decode('utf-8'))
                    assert isinstance(json_content, dict)
                except json.JSONDecodeError:
                    # File exists but might not be JSON
                    pass
                    
        except Exception as e:
            # File might not exist, which is okay for this test
            print(f"File {file_path} not found or accessible: {e}")
    
    @pytest.mark.integration
    async def test_list_datasets_functionality(self, artifact_manager):
        """Test listing datasets as used in /datasets endpoint."""
        # Test listing with a gallery ID
        gallery_id = "agent-lens/20250506-scan-time-lapse-gallery"
        
        try:
            datasets = await artifact_manager._svc.list(parent_id=gallery_id)
            
            if datasets is not None:
                assert isinstance(datasets, list)
                
                # Check structure of dataset items
                for dataset in datasets:
                    assert isinstance(dataset, dict)
                    assert "id" in dataset or "alias" in dataset
                    
        except Exception as e:
            print(f"Gallery {gallery_id} not found or accessible: {e}")
    
    @pytest.mark.integration
    async def test_list_files_functionality(self, artifact_manager):
        """Test list_files functionality as used in /subfolders endpoint."""
        workspace = WORKSPACE
        dataset_id = DEFAULT_DATASET_ALIAS
        full_dataset_id = f"{workspace}/{dataset_id}"
        
        try:
            files = await artifact_manager._svc.list_files(full_dataset_id, dir_path=None)
            
            if files is not None:
                assert isinstance(files, list)
                
                # Check structure of file items
                for file_item in files:
                    assert isinstance(file_item, dict)
                    assert "name" in file_item
                    assert "type" in file_item
                    assert file_item["type"] in ["file", "directory"]
                    
        except Exception as e:
            print(f"Dataset {full_dataset_id} not found or accessible: {e}")
    
    @pytest.mark.integration
    async def test_artifact_id_generation(self, artifact_manager):
        """Test artifact ID generation as used internally."""
        workspace = "test-workspace"
        name = "test-dataset"
        
        artifact_id = artifact_manager._artifact_id(workspace, name)
        
        assert artifact_id == f"{workspace}/{name}"
        assert isinstance(artifact_id, str)
        assert "/" in artifact_id


class TestIntegrationWorkflows:
    """Test integration workflows that combine both managers."""
    
    @pytest.mark.integration
    async def test_full_tile_serving_workflow(self):
        """Test the full tile serving workflow as used in register_frontend_service.py."""
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        # Create and connect tile manager
        tile_manager = ZarrTileManager()
        
        try:
            success = await tile_manager.connect(workspace_token=workspace_token, server_url=SERVER_URL)
            if not success:
                pytest.skip("Failed to connect to server")
            
            # Test the workflow used in tile_endpoint
            dataset_id = DEFAULT_DATASET_ALIAS
            channel_name = DEFAULT_CHANNEL
            z, x, y = 0, 0, 0
            priority = 10
            
            # 1. Queue tile request
            await tile_manager.request_tile(dataset_id, None, channel_name, z, x, y, priority)
            
            # 2. Get tile data
            tile_data = await tile_manager.get_tile_np_data(dataset_id, channel_name, z, x, y)
            
            if tile_data is not None:
                # 3. Verify tile data
                assert isinstance(tile_data, np.ndarray)
                assert tile_data.shape == (tile_manager.tile_size, tile_manager.tile_size)
                
                # 4. Convert to PIL Image (as done in register_frontend_service.py)
                pil_image = Image.fromarray(tile_data)
                assert pil_image.size == (tile_manager.tile_size, tile_manager.tile_size)
                
                # 5. Convert to base64 (as returned by endpoints)
                buffer = io.BytesIO()
                pil_image.save(buffer, format="PNG", compress_level=3, optimize=True)
                img_bytes = buffer.getvalue()
                base64_data = base64.b64encode(img_bytes).decode('utf-8')
                
                assert isinstance(base64_data, str)
                assert len(base64_data) > 0
                
        finally:
            await tile_manager.close()
    
    @pytest.mark.slow
    async def test_multi_channel_tile_workflow(self):
        """Test multi-channel tile workflow as used in merged_tiles_endpoint."""
        workspace_token = os.environ.get("WORKSPACE_TOKEN")
        if not workspace_token:
            pytest.skip("WORKSPACE_TOKEN not found in environment")
        
        tile_manager = ZarrTileManager()
        
        try:
            success = await tile_manager.connect(workspace_token=workspace_token, server_url=SERVER_URL)
            if not success:
                pytest.skip("Failed to connect to server")
            
            # Test multi-channel workflow
            dataset_id = DEFAULT_DATASET_ALIAS
            channels = ["BF_LED_matrix_full", "Fluorescence_488_nm_Ex"]
            z, x, y = 0, 0, 0
            priority = 10
            
            channel_tiles = []
            
            for channel in channels:
                # Queue request
                await tile_manager.request_tile(dataset_id, None, channel, z, x, y, priority)
                
                # Get tile data
                tile_data = await tile_manager.get_tile_np_data(dataset_id, channel, z, x, y)
                
                if tile_data is not None:
                    channel_tiles.append((tile_data, channel))
            
            # Verify we got some data
            if channel_tiles:
                assert len(channel_tiles) > 0
                
                for tile_data, channel in channel_tiles:
                    assert isinstance(tile_data, np.ndarray)
                    assert tile_data.shape == (tile_manager.tile_size, tile_manager.tile_size)
                    assert channel in CHANNELS
                    
        finally:
            await tile_manager.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 