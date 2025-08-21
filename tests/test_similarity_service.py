import pytest
import base64
import io
import os
import numpy as np
from PIL import Image
import dotenv
from hypha_rpc import connect_to_server

dotenv.load_dotenv()

class TestWeaviateSimilarityService:
    @staticmethod
    def _generate_random_image():
        """Generate a random test image and return as base64 string."""
        image = Image.fromarray(
            np.random.randint(0, 256, (224, 224, 3), dtype=np.uint8)
        )
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    @staticmethod
    def _generate_random_vector(dimensions=384):
        """Generate a random vector for testing."""
        return np.random.random(dimensions).tolist()

    @staticmethod
    def _generate_test_collection_name():
        """Generate a unique test collection name."""
        import uuid
        return f"test-weaviate-{uuid.uuid4().hex[:8]}"

    @pytest.fixture
    async def weaviate_service(self):
        """Fixture to get Weaviate service connection."""

        server = await connect_to_server({
            "server_url": "https://hypha.aicell.io" 
        })
        
        weaviate = await server.get_service("weaviate")
        
        yield weaviate
        
        # Cleanup: disconnect server
        await server.disconnect()

    @pytest.mark.integration
    async def test_weaviate_collection_lifecycle(self, weaviate_service):
        """Test creating, using, and deleting a Weaviate collection."""
        collection_name = self._generate_test_collection_name()
        application_id = "test-app-001"
        
        try:
            # 1. Create collection for test
            print(f"Creating test collection: {collection_name}")
            collection_settings = {
                "class": collection_name,
                "description": "Test collection for microscopy images",
                "properties": [
                    {"name": "image_id", "dataType": ["text"]},
                    {"name": "description", "dataType": ["text"]},
                    {"name": "image_base64", "dataType": ["text"]},
                    {"name": "metadata", "dataType": ["text"]}
                ],
                "vectorizer": "none"  # We'll provide vectors manually
            }
            
            result = await weaviate_service.collections.create(collection_settings)
            print(f"Collection created: {result}")
            
            # Verify collection exists
            exists = await weaviate_service.collections.exists(collection_name)
            assert exists, f"Collection {collection_name} should exist after creation"
            
            # 2. Create an application
            print(f"Creating application: {application_id}")
            app_result = await weaviate_service.applications.create(
                collection_name=collection_name,
                application_id=application_id,
                description="Test application for microscopy image similarity search"
            )
            print(f"Application created: {app_result}")
            
            # Verify application exists
            app_exists = await weaviate_service.applications.exists(collection_name, application_id)
            assert app_exists, f"Application {application_id} should exist after creation"
            
            # 3. Insert image data with vectors
            print("Inserting test image data with vectors...")
            
            # Generate test data
            test_images = []
            for i in range(3):
                image_data = {
                    "image_id": f"test_img_{i}",
                    "description": f"Test microscopy image {i}",
                    "image_base64": self._generate_random_image(),
                    "metadata": f"{{'channel': 'BF_LED_matrix_full', 'exposure': {100 + i * 50}}}"
                }
                test_images.append(image_data)
            
            # Insert with vectors (each image gets a random 384-dimensional vector)
            objects_with_vectors = []
            for img_data in test_images:
                obj = {
                    "properties": img_data,
                    "vector": self._generate_random_vector(384)
                }
                objects_with_vectors.append(obj)
            
            insert_result = await weaviate_service.data.insert_many(
                collection_name=collection_name,
                application_id=application_id,
                objects=objects_with_vectors
            )
            print(f"Inserted {len(objects_with_vectors)} objects: {insert_result}")
            
            # 4. Perform similarity search
            print("Performing vector similarity search...")
            
            # Create a query vector
            query_vector = self._generate_random_vector(384)
            
            # Search for similar images
            search_results = await weaviate_service.query.near_vector(
                collection_name=collection_name,
                application_id=application_id,
                vector=query_vector,
                limit=5
            )
            
            print(f"Search results: {len(search_results)} objects found")
            assert len(search_results) > 0, "Should find at least one result"
            
            # Verify result structure
            for result in search_results:
                assert "properties" in result, "Result should have properties"
                assert "image_id" in result["properties"], "Result should have image_id"
                assert "description" in result["properties"], "Result should have description"
                assert "image_base64" in result["properties"], "Result should have image_base64"
            
            # 5. List collections
            print("Listing all collections...")
            all_collections = await weaviate_service.collections.list_all()
            print(f"Available collections: {list(all_collections.keys())}")
            
            # Verify our test collection is in the list
            assert collection_name in all_collections, f"Test collection {collection_name} should be in collections list"
            
            # Test hybrid search as well
            print("Performing hybrid search...")
            hybrid_results = await weaviate_service.query.hybrid(
                collection_name=collection_name,
                application_id=application_id,
                query="microscopy image",
                limit=3
            )
            
            print(f"Hybrid search results: {len(hybrid_results)} objects found")
            assert len(hybrid_results) > 0, "Hybrid search should return results"
            
        finally:
            # 6. Remove all collections which start with 'test-weaviate-xxxx'
            print("Cleaning up test collections...")
            
            all_collections = await weaviate_service.collections.list_all()
            test_collections = [name for name in all_collections.keys() if name.startswith("test-weaviate-")]
            
            for test_collection in test_collections:
                print(f"Deleting test collection: {test_collection}")
                try:
                    delete_result = await weaviate_service.collections.delete(test_collection)
                    print(f"Deleted {test_collection}: {delete_result}")
                except Exception as e:
                    print(f"Error deleting {test_collection}: {e}")
            
            # Verify cleanup
            remaining_collections = await weaviate_service.collections.list_all()
            remaining_test_collections = [name for name in remaining_collections.keys() if name.startswith("test-weaviate-")]
            assert len(remaining_test_collections) == 0, "All test collections should be cleaned up"

    @pytest.mark.integration
    async def test_weaviate_text_search(self, weaviate_service):
        """Test text-based search functionality."""
        collection_name = self._generate_test_collection_name()
        application_id = "test-text-search"
        
        try:
            # Create collection
            collection_settings = {
                "class": collection_name,
                "description": "Test collection for text search",
                "properties": [
                    {"name": "title", "dataType": ["text"]},
                    {"name": "content", "dataType": ["text"]},
                    {"name": "category", "dataType": ["text"]}
                ],
                "vectorizer": "text2vec-transformers"  # Use text vectorizer
            }
            
            await weaviate_service.collections.create(collection_settings)
            await weaviate_service.applications.create(
                collection_name=collection_name,
                application_id=application_id,
                description="Test text search application"
            )
            
            # Insert text data
            text_objects = [
                {
                    "properties": {
                        "title": "Microscopy Basics",
                        "content": "Introduction to light microscopy techniques",
                        "category": "education"
                    }
                },
                {
                    "properties": {
                        "title": "Fluorescence Imaging",
                        "content": "Advanced fluorescence microscopy methods",
                        "category": "research"
                    }
                }
            ]
            
            await weaviate_service.data.insert_many(
                collection_name=collection_name,
                application_id=application_id,
                objects=text_objects
            )
            
            # Test text search
            search_results = await weaviate_service.query.hybrid(
                collection_name=collection_name,
                application_id=application_id,
                query="microscopy techniques",
                limit=5
            )
            
            assert len(search_results) > 0, "Text search should return results"
            
        finally:
            # Cleanup
            try:
                await weaviate_service.collections.delete(collection_name)
            except Exception as e:
                print(f"Error cleaning up {collection_name}: {e}")

    @pytest.mark.unit
    def test_utility_functions(self):
        """Test utility functions for test data generation."""
        # Test image generation
        image_b64 = self._generate_random_image()
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data))
        
        assert image.size == (224, 224)
        assert image.mode == 'RGB'
        
        # Test vector generation
        vector = self._generate_random_vector(128)
        assert len(vector) == 128
        assert all(isinstance(v, float) for v in vector)
        assert all(0 <= v <= 1 for v in vector)
        
        # Test collection name generation
        collection_name = self._generate_test_collection_name()
        assert collection_name.startswith("test-weaviate-")
        assert len(collection_name) == len("test-weaviate-") + 8  # 8 hex chars

    @pytest.mark.integration
    async def test_collection_management(self, weaviate_service):
        """Test collection management operations."""
        collection_name = self._generate_test_collection_name()
        
        try:
            # Test collection creation
            settings = {
                "class": collection_name,
                "description": "Test collection",
                "properties": [{"name": "test", "dataType": ["text"]}]
            }
            
            result = await weaviate_service.collections.create(settings)
            assert result is not None
            
            # Test collection retrieval
            collection = await weaviate_service.collections.get(collection_name)
            assert collection is not None
            
            # Test collection existence check
            exists = await weaviate_service.collections.exists(collection_name)
            assert exists is True
            
            # Test artifact retrieval
            artifact = await weaviate_service.collections.get_artifact(collection_name)
            assert artifact is not None
            
        finally:
            # Cleanup
            try:
                await weaviate_service.collections.delete(collection_name)
            except Exception as e:
                print(f"Error cleaning up {collection_name}: {e}")