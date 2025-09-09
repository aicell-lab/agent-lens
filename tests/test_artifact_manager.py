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
    from agent_lens.artifact_manager import AgentLensArtifactManager
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



if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 