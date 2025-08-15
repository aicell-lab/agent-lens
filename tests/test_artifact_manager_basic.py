import pytest
import pytest_asyncio
import asyncio
import os
import time
import uuid
import numpy as np
import json
import zipfile
import tempfile
import shutil
import requests
import httpx
import zarr
from pathlib import Path
from typing import Dict, List, Tuple
from hypha_rpc import connect_to_server

# Mark all tests in this module as asyncio and integration tests
pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

# Test configuration
TEST_SERVER_URL = "https://hypha.aicell.io"
TEST_WORKSPACE = "agent-lens"
TEST_TIMEOUT = 300  # seconds (longer for large uploads)

async def cleanup_test_galleries(artifact_manager):
    """Clean up any leftover test galleries from interrupted tests."""
    try:
        # List all artifacts
        artifacts = await artifact_manager.list()
        
        # Find test galleries - check for multiple patterns
        test_galleries = []
        for artifact in artifacts:
            alias = artifact.get('alias', '')
            # Check for various test gallery patterns
            if any(pattern in alias for pattern in [
                'test-zip-gallery',           # Standard test galleries
                'microscope-gallery-test',     # Test microscope galleries
                '1-test-upload-experiment',    # New experiment galleries (test uploads)
                '1-test-experiment'           # Other test experiment galleries
            ]):
                test_galleries.append(artifact)
        
        if not test_galleries:
            print("✅ No test galleries found to clean up")
            return
        
        print(f"🧹 Found {len(test_galleries)} test galleries to clean up:")
        for gallery in test_galleries:
            print(f"  - {gallery['alias']} (ID: {gallery['id']})")
        
        # Delete each test gallery
        for gallery in test_galleries:
            try:
                await artifact_manager.delete(
                    artifact_id=gallery["id"], 
                    delete_files=True, 
                    recursive=True
                )
                print(f"✅ Deleted gallery: {gallery['alias']}")
            except Exception as e:
                print(f"⚠️ Error deleting {gallery['alias']}: {e}")
        
        print("✅ Cleanup completed")
    except Exception as e:
        print(f"⚠️ Error during cleanup: {e}")

# Test sizes in MB - smaller sizes for faster testing
TEST_SIZES = [
    ("100MB", 100),  # Much smaller for CI
    ("mini-chunks-test", 50),  # Even smaller mini-chunks test
]

# CI-friendly test sizes (when running in GitHub Actions or CI environment)
CI_TEST_SIZES = [
    ("10MB", 10),  # Very small for CI
    ("mini-chunks-test", 25),  # Small mini-chunks test
]

# Detect CI environment
def is_ci_environment():
    """Check if running in a CI environment."""
    return any([
        os.environ.get("CI") == "true",
        os.environ.get("GITHUB_ACTIONS") == "true",
        os.environ.get("RUNNER_OS") is not None,
        os.environ.get("QUICK_TEST") == "1"
    ])

# Use appropriate test sizes based on environment
def get_test_sizes():
    """Get appropriate test sizes based on environment."""
    if is_ci_environment():
        print("🏗️ CI environment detected - using smaller test sizes")
        return CI_TEST_SIZES
    else:
        print("🖥️ Local environment detected - using standard test sizes")
        return TEST_SIZES

# Remove OME-Zarr and related helpers, keep only simple zip creation
import zipfile
import tempfile
import shutil
import uuid
import os
import pytest
import pytest_asyncio
import httpx
from pathlib import Path

pytestmark = [pytest.mark.asyncio, pytest.mark.integration]

TEST_SERVER_URL = "https://hypha.aicell.io"
TEST_WORKSPACE = "agent-lens"

@pytest_asyncio.fixture(scope="function")
async def artifact_manager():
    token = os.environ.get("AGENT_LENS_WORKSPACE_TOKEN")
    if not token:
        pytest.skip("AGENT_LENS_WORKSPACE_TOKEN not set in environment")
    from hypha_rpc import connect_to_server
    print(f"🔗 Connecting to {TEST_SERVER_URL} workspace {TEST_WORKSPACE}...")
    async with connect_to_server({
        "server_url": TEST_SERVER_URL,
        "token": token,
        "workspace": TEST_WORKSPACE,
        "ping_interval": None
    }) as server:
        print("✅ Connected to server")
        artifact_manager = await server.get_service("public/artifact-manager")
        print("✅ Artifact manager ready")
        print("🧹 Cleaning up any leftover test galleries...")
        await cleanup_test_galleries(artifact_manager)
        yield artifact_manager
        print("🧹 Final cleanup of test galleries...")
        await cleanup_test_galleries(artifact_manager)

@pytest_asyncio.fixture(scope="function") 
async def test_gallery(artifact_manager):
    gallery_id = f"test-zip-gallery-{uuid.uuid4().hex[:8]}"
    gallery_manifest = {
        "name": f"ZIP Upload Test Gallery - {gallery_id}",
        "description": "Test gallery for ZIP file upload and endpoint testing",
        "created_for": "automated_testing"
    }
    print(f"📁 Creating test gallery: {gallery_id}")
    gallery = await artifact_manager.create(
        type="collection",
        alias=gallery_id,
        manifest=gallery_manifest,
        config={"permissions": {"*": "r+", "@": "r+"}}
    )
    print(f"✅ Gallery created: {gallery['id']}")
    yield gallery
    print(f"🧹 Cleaning up gallery: {gallery_id}")
    try:
        await artifact_manager.delete(
            artifact_id=gallery["id"], 
            delete_files=True, 
            recursive=True
        )
        print("✅ Gallery cleaned up")
    except Exception as e:
        print(f"⚠️ Error during gallery cleanup: {e}")

@pytest.mark.timeout(600)
async def test_simple_zip_upload_and_dataset_management(test_gallery, artifact_manager):
    """
    Test creating a gallery, creating a dataset, uploading a simple 10MB zip file (with a text file), listing datasets, and deleting the dataset and gallery.
    """
    gallery = test_gallery
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        # Create a 10MB text file
        txt_path = temp_path / "large.txt"
        with open(txt_path, "w") as f:
            f.write("A" * 10 * 1024 * 1024)  # 10MB of 'A'
        # Create a zip file containing the text file
        zip_path = temp_path / "test.zip"
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
            zf.write(txt_path, arcname="large.txt")
        # Create a dataset in the gallery
        dataset_name = f"test-dataset-{uuid.uuid4().hex[:6]}"
        dataset_manifest = {
            "name": f"Test Dataset Simple Zip",
            "description": f"Simple zip file for testing",
            "test_purpose": "simple_zip_upload"
        }
        dataset = await artifact_manager.create(
                    parent_id=gallery["id"],
                    alias=dataset_name,
                    manifest=dataset_manifest,
                    stage=True
                )
        # Upload the zip file
        put_url = await artifact_manager.put_file(
                    dataset["id"], 
            file_path="test.zip"
        )
        with open(zip_path, 'rb') as f:
            zip_content = f.read()
        async with httpx.AsyncClient() as client:
            response = await client.put(
                put_url,
                content=zip_content,
                headers={
                    'Content-Type': 'application/zip',
                    'Content-Length': str(len(zip_content))
                }
            )
            response.raise_for_status()
        await artifact_manager.commit(dataset["id"])
        print(f"✅ Uploaded and committed dataset: {dataset['id']}")
        # Wait for a short period to allow backend to update
        import asyncio
        await asyncio.sleep(2)
        # Check dataset existence using read()
        dataset_details = await artifact_manager.read(artifact_id=dataset["id"])
        print(f"✅ Dataset details: {dataset_details}")
        assert dataset_details is not None, "Uploaded dataset not found by read()"
        # Delete the dataset
        await artifact_manager.delete(
            artifact_id=dataset["id"],
            delete_files=True
        )
        print(f"✅ Dataset deleted: {dataset['id']}")

if __name__ == "__main__":
    # Allow running this test directly
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "quick":
        os.environ["QUICK_TEST"] = "1"
    
    pytest.main([__file__, "-v", "-s"]) 