"""
Integration tests for ChromaDB cell storage.
Tests batch operations, metadata filtering, and vector similarity search.
"""

import pytest
import numpy as np
from agent_lens.utils.chroma_storage import ChromaCellStorage


@pytest.fixture
def chroma_storage(tmp_path):
    """Create temporary ChromaDB storage for testing."""
    storage = ChromaCellStorage(persist_directory=str(tmp_path / "chroma_test"))
    yield storage
    # Cleanup handled by tmp_path


def test_batch_insert_and_fetch(chroma_storage):
    """Test batch insert and fetch operations."""
    application_id = "test-batch-app"
    
    # Create test cells with embeddings and metadata
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": f"base64_image_data_{i}",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": 100 + i * 10,
            "circularity": 0.8 + i * 0.01,
            "perimeter": 50 + i * 5,
            "eccentricity": 0.5 + i * 0.02,
        }
        for i in range(10)
    ]
    
    # Batch insert
    result = chroma_storage.insert_cells(application_id, cells)
    assert result["success"]
    assert result["inserted_count"] == 10
    assert len(result["uuids"]) == 10
    
    # Batch fetch
    uuids = [f"cell-{i}" for i in range(10)]
    fetched = chroma_storage.fetch_by_uuids(application_id, uuids, include_embeddings=False)
    
    assert len(fetched) == 10
    assert fetched[0]["uuid"] == "cell-0"
    assert fetched[0]["area"] == 100
    assert fetched[0]["circularity"] == 0.8
    assert "image" in fetched[0]
    assert "dino_embedding" not in fetched[0]  # Not included


def test_fetch_with_embeddings(chroma_storage):
    """Test fetching cells with embeddings included."""
    application_id = "test-embeddings-app"
    
    # Create test cells
    embedding_vector = np.random.rand(768).tolist()
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": f"base64_image_{i}",
            "dino_embedding": embedding_vector,
            "area": 100 + i,
        }
        for i in range(5)
    ]
    
    chroma_storage.insert_cells(application_id, cells)
    
    # Fetch with embeddings
    uuids = [f"cell-{i}" for i in range(5)]
    fetched = chroma_storage.fetch_by_uuids(application_id, uuids, include_embeddings=True)
    
    assert len(fetched) == 5
    assert "dino_embedding" in fetched[0]
    assert len(fetched[0]["dino_embedding"]) == 768


def test_metadata_filtering(chroma_storage):
    """Test native metadata filtering with ChromaDB."""
    application_id = "test-filter-app"
    
    # Create cells with varying area values
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": "",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": i * 50,  # 0, 50, 100, 150, 200
            "circularity": 0.8,
        }
        for i in range(5)
    ]
    
    chroma_storage.insert_cells(application_id, cells)
    
    # Query with metadata filtering: area > 75 AND area < 175
    # Should return cells with area=100 and area=150
    query_emb = np.random.rand(768).tolist()
    results = chroma_storage.similarity_search(
        application_id=application_id,
        query_embedding=query_emb,
        n_results=10,
        where_filter={"$and": [{"area": {"$gt": 75}}, {"area": {"$lt": 175}}]}
    )
    
    # Verify filtering worked
    assert len(results["ids"][0]) == 2
    # Check that returned cells have correct area values
    metadatas = results["metadatas"][0]
    areas = [m["area"] for m in metadatas]
    assert 100 in areas
    assert 150 in areas
    assert 0 not in areas
    assert 200 not in areas


def test_similarity_search_without_filter(chroma_storage):
    """Test vector similarity search without metadata filtering."""
    application_id = "test-similarity-app"
    
    # Create cells with known embeddings
    base_embedding = np.random.rand(768)
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": f"image_{i}",
            # Add small noise to base embedding
            "dino_embedding": (base_embedding + np.random.rand(768) * 0.1).tolist(),
            "area": 100 + i,
        }
        for i in range(10)
    ]
    
    chroma_storage.insert_cells(application_id, cells)
    
    # Query with base embedding (should find similar cells)
    results = chroma_storage.similarity_search(
        application_id=application_id,
        query_embedding=base_embedding.tolist(),
        n_results=5
    )
    
    assert len(results["ids"][0]) == 5
    assert "distances" in results
    assert "metadatas" in results
    # ChromaDB configured with cosine distance: values in [0, 2], ordered nearest-first
    distances = results["distances"][0]
    assert all(0 <= d <= 2 for d in distances)
    assert distances == sorted(distances)


def test_reset_application(chroma_storage):
    """Test resetting (deleting) an application's data."""
    application_id = "test-reset-app"
    
    # Insert some cells
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": "",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": 100,
        }
        for i in range(5)
    ]
    
    chroma_storage.insert_cells(application_id, cells)
    
    # Verify cells exist
    count = chroma_storage.get_collection_count(application_id)
    assert count == 5
    
    # Reset application
    result = chroma_storage.reset_application(application_id)
    assert result["success"]
    assert "message" in result

    # Verify collection is deleted (count is the source of truth)
    count = chroma_storage.get_collection_count(application_id)
    assert count == 0


def test_reset_nonexistent_application(chroma_storage):
    """Test resetting an application that doesn't exist."""
    result = chroma_storage.reset_application("nonexistent-app")
    assert result["success"]
    assert "did not exist" in result["message"].lower()


def test_list_collections(chroma_storage):
    """Test listing all collections."""
    # Create multiple applications
    for i in range(3):
        app_id = f"test-app-{i}"
        cells = [
            {
                "uuid": f"cell-0",
                "image_id": "img-0",
                "image": "",
                "dino_embedding": np.random.rand(768).tolist(),
                "area": 100,
            }
        ]
        chroma_storage.insert_cells(app_id, cells)
    
    # List collections
    collections = chroma_storage.list_collections()
    assert len(collections) >= 3
    assert "test-app-0" in collections
    assert "test-app-1" in collections
    assert "test-app-2" in collections


def test_empty_metadata_handling(chroma_storage):
    """Test handling of cells with missing metadata fields."""
    application_id = "test-empty-metadata"
    
    # Create cells with minimal metadata (some fields None)
    cells = [
        {
            "uuid": "cell-1",
            "image_id": "img-1",
            "image": "base64_data",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": 100,
            # Other fields are None/missing
        },
        {
            "uuid": "cell-2",
            "image_id": "img-2",
            "image": "base64_data",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": None,  # Explicitly None
            "circularity": 0.8,
        }
    ]
    
    # Should insert successfully (None values filtered out)
    result = chroma_storage.insert_cells(application_id, cells)
    assert result["success"]
    assert result["inserted_count"] == 2
    
    # Fetch and verify
    fetched = chroma_storage.fetch_by_uuids(application_id, ["cell-1", "cell-2"])
    assert len(fetched) == 2
    assert fetched[0]["area"] == 100
    # cell-2 should not have area field (was None)
    assert "area" not in fetched[1] or fetched[1]["area"] is None


def test_large_batch_insert(chroma_storage):
    """Test inserting a large batch of cells."""
    application_id = "test-large-batch"
    
    # Create 1000 cells
    cells = [
        {
            "uuid": f"cell-{i}",
            "image_id": f"img-{i}",
            "image": f"data_{i}",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": 100 + i,
            "circularity": 0.8,
        }
        for i in range(1000)
    ]
    
    # Batch insert
    result = chroma_storage.insert_cells(application_id, cells)
    assert result["success"]
    assert result["inserted_count"] == 1000
    
    # Verify count
    count = chroma_storage.get_collection_count(application_id)
    assert count == 1000
    
    # Fetch a subset
    uuids = [f"cell-{i}" for i in range(0, 1000, 100)]  # Every 100th cell
    fetched = chroma_storage.fetch_by_uuids(application_id, uuids)
    assert len(fetched) == 10


def test_persistence(tmp_path):
    """Test that data persists across ChromaDB instances."""
    persist_dir = str(tmp_path / "persist_test")
    application_id = "test-persist-app"
    
    # Create first instance and insert data
    storage1 = ChromaCellStorage(persist_directory=persist_dir)
    cells = [
        {
            "uuid": "cell-1",
            "image_id": "img-1",
            "image": "data",
            "dino_embedding": np.random.rand(768).tolist(),
            "area": 100,
        }
    ]
    storage1.insert_cells(application_id, cells)
    
    # Create second instance (should load persisted data)
    storage2 = ChromaCellStorage(persist_directory=persist_dir)
    count = storage2.get_collection_count(application_id)
    assert count == 1
    
    # Fetch data from second instance
    fetched = storage2.fetch_by_uuids(application_id, ["cell-1"])
    assert len(fetched) == 1
    assert fetched[0]["area"] == 100
