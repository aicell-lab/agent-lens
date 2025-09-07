"""
Test configuration and fixtures for Agent-Lens microscopy platform.
"""

import pytest
import pytest_asyncio
import asyncio
import tempfile
import shutil
import os
import sys
import logging
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List
import numpy as np
from PIL import Image
import io
import base64
import zarr

# Add the project root to the Python path to ensure agent_lens can be imported
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

# Configure test logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global list to track open connections for cleanup
_open_connections = []


@pytest.fixture
def temp_dir():
    """Create a temporary directory for test files."""
    temp_dir = tempfile.mkdtemp()
    yield Path(temp_dir)
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def sample_zarr_path(temp_dir):
    """Create a sample Zarr array for testing."""
    zarr_path = temp_dir / "test_data.zarr"
    
    # Create sample multi-dimensional microscopy data (T, C, Z, Y, X)
    data = np.random.randint(0, 255, (2, 3, 5, 512, 512), dtype=np.uint8)
    
    zarr_group = zarr.open(str(zarr_path), mode='w')
    zarr_group.create_dataset('data', data=data, chunks=(1, 1, 1, 256, 256))
    
    # Add metadata
    zarr_group.attrs['dimensions'] = ['t', 'c', 'z', 'y', 'x']
    zarr_group.attrs['channels'] = ['BF', 'F488', 'F561']
    zarr_group.attrs['pixel_size_um'] = 0.325
    
    return zarr_path


@pytest.fixture
def sample_image():
    """Generate a sample microscopy image."""
    # Create a realistic-looking cell image
    image_array = np.zeros((512, 512, 3), dtype=np.uint8)
    
    # Add some cell-like structures
    center_y, center_x = 256, 256
    radius = 80
    
    # Cell body (circular gradient)
    y, x = np.ogrid[:512, :512]
    mask = (x - center_x)**2 + (y - center_y)**2 <= radius**2
    gradient = 1 - np.sqrt((x - center_x)**2 + (y - center_y)**2) / radius
    gradient = np.clip(gradient, 0, 1)
    
    image_array[mask] = (gradient[mask, np.newaxis] * [100, 150, 200]).astype(np.uint8)
    
    # Add some noise
    noise = np.random.normal(0, 10, image_array.shape).astype(np.int16)
    image_array = np.clip(image_array.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    
    return Image.fromarray(image_array)


@pytest.fixture
def sample_image_base64(sample_image):
    """Convert sample image to base64 string."""
    buffered = io.BytesIO()
    sample_image.save(buffered, format="PNG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")


@pytest_asyncio.fixture
async def hypha_server():
    """Create a managed Hypha server connection for testing."""
    # Check for token first
    token = os.environ.get("WORKSPACE_TOKEN")
    if not token:
        raise ValueError("WORKSPACE_TOKEN not set in environment - required for Hypha server tests")
    
    from hypha_rpc import connect_to_server
    
    server = None
    try:
        # Create connection with minimal background tasks
        connection_config = {
            "server_url": "https://hypha.aicell.io",
            "token": token,
            "workspace": "agent-lens",
            "ping_interval": None,  # Disable ping to avoid background tasks
            "ping_timeout": None,   # Disable ping timeout
        }
        
        server = await connect_to_server(connection_config)
        _open_connections.append(server)
        
        yield server
        
    except Exception as e:
        logger.warning(f"Failed to create Hypha connection: {e}")
        pytest.skip(f"Could not connect to Hypha: {e}")
    finally:
        # Enhanced cleanup with proper task cancellation
        if server:
            try:
                # Cancel any pending tasks before disconnecting
                if hasattr(server, '_websocket') and server._websocket:
                    # Get all tasks related to this connection
                    current_tasks = [task for task in asyncio.all_tasks() 
                                   if not task.done() and 'websocket' in str(task.get_coro()).lower()]
                    
                    # Cancel websocket-related tasks
                    for task in current_tasks:
                        if not task.done():
                            task.cancel()
                    
                    # Wait briefly for cancellation
                    if current_tasks:
                        await asyncio.gather(*current_tasks, return_exceptions=True)
                
                # Disconnect the server
                if hasattr(server, 'disconnect'):
                    await asyncio.wait_for(server.disconnect(), timeout=5.0)
                elif hasattr(server, 'close'):
                    await asyncio.wait_for(server.close(), timeout=5.0)
                    
            except (asyncio.TimeoutError, asyncio.CancelledError, RuntimeError) as e:
                logger.warning(f"Expected error during connection cleanup: {e}")
            except Exception as e:
                logger.warning(f"Unexpected error closing connection: {e}")
            
            # Remove from global list
            if server in _open_connections:
                _open_connections.remove(server)
        
        # Give time for cleanup to complete
        await asyncio.sleep(0.1)

@pytest.fixture
def mock_hypha_server():
    """Mock Hypha server for testing service interactions."""
    server_mock = AsyncMock()
    server_mock.config = MagicMock()
    server_mock.config.workspace = "test-workspace"
    server_mock.config.token = "test-token"
    
    # Mock service registration
    server_mock.register_service = AsyncMock()
    server_mock.get_service = AsyncMock()
    
    return server_mock


@pytest.fixture
def mock_artifact_manager():
    """Mock artifact manager for testing data operations."""
    with patch('agent_lens.artifact_manager.AgentLensArtifactManager') as mock:
        instance = AsyncMock()
        mock.return_value = instance
        
        # Mock common methods
        instance.upload_file = AsyncMock()
        instance.download_file = AsyncMock()
        instance.list_files = AsyncMock(return_value=[])
        instance.get_manifest = AsyncMock(return_value={})
        instance.put_manifest = AsyncMock()
        
        yield instance


@pytest.fixture
def microscopy_metadata():
    """Sample microscopy metadata for testing."""
    return {
        "acquisition": {
            "timestamp": "2024-01-01T12:00:00Z",
            "objective": "20x",
            "pixel_size_um": 0.325,
            "exposure_times": {
                "BF": 50,
                "F488": 100,
                "F561": 150,
                "F638": 200
            },
            "illumination_intensities": {
                "BF": 50,
                "F488": 75,
                "F561": 80,
                "F638": 90
            }
        },
        "sample": {
            "name": "test_sample",
            "well": "A1",
            "position": {"x": 1000, "y": 2000, "z": 150}
        },
        "imaging": {
            "channels": ["BF", "F488", "F561"],
            "z_stack": True,
            "z_range_um": 20,
            "z_step_um": 2,
            "time_points": 5,
            "time_interval_min": 30
        }
    }


@pytest.fixture
def sample_tile_data():
    """Generate sample tile data for testing."""
    def _generate_tile(tile_size=256, channels=3):
        """Generate a single tile with realistic microscopy data."""
        tile = np.random.randint(0, 255, (tile_size, tile_size, channels), dtype=np.uint8)
        
        # Add some structure to make it realistic
        center = tile_size // 2
        y, x = np.ogrid[:tile_size, :tile_size]
        
        # Add circular features
        for _ in range(3):
            cx, cy = np.random.randint(0, tile_size, 2)
            r = np.random.randint(10, 50)  
            mask = (x - cx)**2 + (y - cy)**2 <= r**2
            intensity = np.random.randint(100, 200)
            tile[mask] = intensity
            
        return tile
    
    return _generate_tile


@pytest.fixture
def mock_microscope_hardware():
    """Mock microscope hardware for testing."""
    hardware_mock = AsyncMock()
    
    # Stage control
    hardware_mock.move_stage = AsyncMock()
    hardware_mock.get_stage_position = AsyncMock(return_value={"x": 0, "y": 0, "z": 0})
    hardware_mock.home_stage = AsyncMock()
    
    # Camera control
    hardware_mock.snap_image = AsyncMock()
    hardware_mock.set_exposure = AsyncMock()
    hardware_mock.get_camera_properties = AsyncMock(return_value={"width": 2048, "height": 2048})
    
    # Illumination control
    hardware_mock.set_illumination = AsyncMock()
    hardware_mock.get_illumination = AsyncMock(return_value={"BF": 50, "F488": 0})
    
    # Autofocus
    hardware_mock.run_autofocus = AsyncMock(return_value={"success": True, "z_position": 150.5})
    
    return hardware_mock

class MockImageData:
    """Helper class for generating test image data."""
    
    @staticmethod
    def create_multi_channel_image(width=512, height=512, channels=None):
        """Create a multi-channel microscopy image."""
        if channels is None:
            channels = ['BF', 'F488', 'F561']
        
        image_data = {}
        for i, channel in enumerate(channels):
            # Generate channel-specific data
            if channel == 'BF':
                # Bright field - more uniform with some cells
                data = np.full((height, width), 120, dtype=np.uint8)
                # Add some cell-like structures
                for _ in range(5):
                    cx, cy = np.random.randint(50, width-50), np.random.randint(50, height-50)
                    r = np.random.randint(20, 40)
                    y, x = np.ogrid[:height, :width]
                    mask = (x - cx)**2 + (y - cy)**2 <= r**2
                    data[mask] = np.random.randint(80, 160)
            else:
                # Fluorescence - sparse bright spots
                data = np.random.poisson(5, (height, width)).astype(np.uint8)
                # Add some bright fluorescent spots
                for _ in range(np.random.randint(3, 8)):
                    cx, cy = np.random.randint(0, width), np.random.randint(0, height)
                    data[cy:cy+5, cx:cx+5] = np.random.randint(200, 255)
            
            image_data[channel] = data
            
        return image_data


@pytest.fixture(scope="session", autouse=True)
def cleanup_connections():
    """Automatically cleanup any remaining connections at session end."""
    yield
    
    # Simple cleanup without async operations to avoid cancellation issues
    if _open_connections:
        logger.info(f"Marking {len(_open_connections)} connections for cleanup...")
        # Just clear the list - connections should be cleaned up by individual fixtures
        _open_connections.clear()
        
    # Cancel any remaining tasks to prevent warnings
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        if loop and not loop.is_closed():
            pending_tasks = [task for task in asyncio.all_tasks(loop) if not task.done()]
            if pending_tasks:
                logger.info(f"Cancelling {len(pending_tasks)} pending tasks...")
                for task in pending_tasks:
                    task.cancel()
    except Exception as e:
        logger.warning(f"Error during final cleanup: {e}")

# Test markers for different test categories
pytestmark = [
    pytest.mark.asyncio,
] 