"""
Integration test for Weaviate cell storage implementation.
Tests the full workflow: reset → build_cell_records → store to Weaviate → fetch from Weaviate
"""

import pytest
import pytest_asyncio
import dotenv
import numpy as np
from PIL import Image as PILImage
import io
import base64

dotenv.load_dotenv()


@pytest_asyncio.fixture
async def agent_lens_frontend_service(hypha_server):
    """Get the agent lens frontend service for testing."""
    try:
        service = await hypha_server.get_service("agent-lens/agent-lens-test")
        print(f"✅ Connected to agent-lens service")
        yield service
    except Exception as e:
        pytest.skip(f"Agent lens service not available: {e}")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_weaviate_integration_workflow(agent_lens_frontend_service):
    """Test the complete Weaviate integration workflow."""
    
    service = agent_lens_frontend_service
    application_id = "test-integration-workflow"
    
    try:
        # Step 1: Reset application
        print("\n🧪 Step 1: Reset application")
        reset_result = await service.reset_application(application_id)
        assert reset_result["success"], f"Reset failed: {reset_result.get('message')}"
        print(f"✅ Reset successful: {reset_result['message']}")
        
        # Step 2: Create test image and segmentation mask
        print("\n🧪 Step 2: Create test data")
        # Create a simple test image (100x100, single channel)
        test_image = np.random.randint(0, 255, (100, 100), dtype=np.uint8)
        
        # Create a segmentation mask with 3 cells
        mask = np.zeros((100, 100), dtype=np.uint32)
        mask[10:30, 10:30] = 1  # Cell 1
        mask[40:60, 40:60] = 2  # Cell 2
        mask[70:90, 70:90] = 3  # Cell 3
        
        print(f"✅ Created test image: {test_image.shape}, mask: {np.unique(mask)}")
        
        # Step 3: Build cell records (always stores to Weaviate)
        print("\n🧪 Step 3: Build cell records (automatic Weaviate storage)")
        cells = await service.build_cell_records(
            test_image,
            mask,
            microscope_status=None,
            application_id=application_id,
        )
        
        assert len(cells) == 3, f"Expected 3 cells, got {len(cells)}"
        assert "uuid" in cells[0], "Cell should have UUID (stored in Weaviate)"
        assert "image" not in cells[0], "Cell should NOT have image (stored in Weaviate, memory efficient)"
        assert "clip_embedding" not in cells[0] and "dino_embedding" not in cells[0], \
            "Cell should NOT have embeddings (stored in Weaviate, memory efficient)"
        assert "area" in cells[0], "Cell should have morphology metadata in memory"
        print(f"✅ Built {len(cells)} cells with automatic Weaviate storage")
        print(f"   UUIDs: {[c['uuid'] for c in cells]}")
        
        # Step 4: Fetch images from Weaviate
        print("\n🧪 Step 4: Fetch images from Weaviate")
        uuids = [c['uuid'] for c in cells if 'uuid' in c]
        fetched_cells = await service.fetch_cell_images_from_weaviate(
            uuids=uuids,
            application_id=application_id,
            include_embeddings=False
        )
        
        assert len(fetched_cells) == len(uuids), f"Expected {len(uuids)} fetched cells, got {len(fetched_cells)}"
        for cell in fetched_cells:
            if "error" not in cell:
                assert "preview_image" in cell or "image" in cell, \
                    f"Fetched cell should have image: {list(cell.keys())}"
        print(f"✅ Fetched {len(fetched_cells)} cells from Weaviate")
        
        # Step 5: Fetch embeddings from Weaviate
        print("\n🧪 Step 5: Fetch embeddings from Weaviate")
        fetched_embeddings = await service.fetch_cell_embeddings_from_weaviate(
            uuids=uuids,
            application_id=application_id
        )
        
        assert len(fetched_embeddings) == len(uuids), \
            f"Expected {len(uuids)} fetched embeddings, got {len(fetched_embeddings)}"
        for cell in fetched_embeddings:
            if "error" not in cell:
                assert "dino_embedding" in cell or "clip_embedding" in cell, \
                    f"Fetched cell should have embeddings: {list(cell.keys())}"
                # Should NOT have image (bandwidth efficient)
                assert "preview_image" not in cell and "image" not in cell, \
                    "Embedding fetch should NOT include images (bandwidth efficient)"
        print(f"✅ Fetched embeddings for {len(fetched_embeddings)} cells from Weaviate")
        
        # Step 6: Verify metadata is present
        print("\n🧪 Step 6: Verify metadata")
        for cell in cells:
            assert "area" in cell, "Cell should have morphology metadata"
            assert "uuid" in cell, "Cell should have UUID"
        print(f"✅ All cells have required metadata")
        
        # Step 7: Cleanup
        print("\n🧪 Step 7: Cleanup")
        cleanup_result = await service.reset_application(application_id)
        assert cleanup_result["success"], f"Cleanup failed: {cleanup_result.get('message')}"
        assert cleanup_result["deleted_count"] == 3, \
            f"Expected to delete 3 cells, deleted {cleanup_result['deleted_count']}"
        print(f"✅ Cleanup successful: {cleanup_result['message']}")
        
        print("\n" + "="*70)
        print("✅ WEAVIATE INTEGRATION TEST PASSED")
        print("="*70)
        print("\nValidated:")
        print("  ✓ reset_application() - Clean up before starting")
        print("  ✓ build_cell_records() - Automatic Weaviate storage")
        print("  ✓ fetch_cell_images_from_weaviate() - Retrieve images")
        print("  ✓ fetch_cell_embeddings_from_weaviate() - Retrieve embeddings only")
        print("  ✓ Memory efficiency - Images/embeddings stored in Weaviate")
        print("  ✓ Metadata preserved - All morphology data in memory")
        print("="*70)
        
    except Exception as e:
        print(f"\n❌ Integration test failed: {e}")
        raise


@pytest.mark.integration
@pytest.mark.asyncio
async def test_backend_methods_exist(agent_lens_frontend_service):
    """Verify that all new RPC methods are registered."""
    service = agent_lens_frontend_service
    
    # Check that methods exist
    assert hasattr(service, 'reset_application'), "reset_application method not found"
    assert hasattr(service, 'fetch_cell_images_from_weaviate'), "fetch_cell_images_from_weaviate method not found"
    assert hasattr(service, 'fetch_cell_embeddings_from_weaviate'), "fetch_cell_embeddings_from_weaviate method not found"
    assert hasattr(service, 'build_cell_records'), "build_cell_records method not found"
    
    print("\n✅ All required RPC methods are registered:")
    print("  - reset_application")
    print("  - fetch_cell_images_from_weaviate")
    print("  - fetch_cell_embeddings_from_weaviate")
    print("  - build_cell_records (automatic Weaviate storage)")
