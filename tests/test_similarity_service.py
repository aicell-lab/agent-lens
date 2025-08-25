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
    def _generate_clip_vector(text_description):
        """Generate a CLIP vector for the given text description."""
        import clip
        import torch
        
        # Load CLIP model
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model, preprocess = clip.load("ViT-B/32", device=device)
        
        # Encode text
        text = clip.tokenize([text_description]).to(device)
        with torch.no_grad():
            text_features = model.encode_text(text)
            # Normalize to unit vector
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        
        return text_features.cpu().numpy()[0].tolist()

    @staticmethod
    def _generate_test_collection_name():
        """Generate a unique test collection name."""
        import uuid
        return f"test_weaviate_{uuid.uuid4().hex[:8]}"

    @pytest.fixture
    async def weaviate_service(self):
        """Fixture to get Weaviate service connection."""
        token = os.getenv("ARIA_AGENTS_TOKEN")
        server = await connect_to_server({
            "server_url": "https://hypha.aicell.io",
            "workspace": "aria-agents",
            "token": token
        })
        
        weaviate = await server.get_service("aria-agents/weaviate", mode="first")
        
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
            
            # Insert test image data with CLIP vectors
            insert_results = []
            for img_data in test_images:
                # Generate CLIP vector for the image description
                clip_vector = self._generate_clip_vector(img_data["description"])
                
                # Insert with vector using the proper method
                result = await weaviate_service.data.insert(
                    collection_name=collection_name,
                    application_id=application_id,
                    properties=img_data,
                    vector=clip_vector
                )
                insert_results.append(result)
            
            print(f"Inserted {len(insert_results)} objects with CLIP vectors")
            
            # 4. Fetch objects
            print("Fetching objects...")
            
            # Fetch objects using fetch_objects (no vectorization required)
            search_results = await weaviate_service.query.fetch_objects(
                collection_name=collection_name,
                application_id=application_id,
                limit=5
            )
            
            print(f"Fetch results structure: {search_results}")
            
            # The results have an 'objects' key containing the actual results
            if 'objects' in search_results:
                objects = search_results['objects']
                print(f"Found {len(objects)} objects")
                assert len(objects) > 0, "Should find at least one result"
                
                # Debug: Print the first result to see its structure
                if objects:
                    first_result = objects[0]
                    print(f"First result keys: {list(first_result.keys()) if hasattr(first_result, 'keys') else 'No keys'}")
                    print(f"First result: {first_result}")
                
                # Verify result structure
                for result in objects:
                    # Check if result has properties or if properties are at top level
                    if "properties" in result:
                        props = result["properties"]
                    else:
                        props = result  # Properties might be at top level
                    
                    assert "image_id" in props, "Result should have image_id"
                    assert "description" in props, "Result should have description"
                    assert "image_base64" in props, "Result should have image_base64"
            else:
                assert False, f"Expected 'objects' key in results, got: {list(search_results.keys())}"
            
            # 5. List collections
            print("Listing all collections...")
            all_collections = await weaviate_service.collections.list_all()
            print(f"Available collections: {list(all_collections.keys())}")
            
            # Verify our test collection is in the list
            assert collection_name in all_collections, f"Test collection {collection_name} should be in collections list"
            
            # Test vector similarity search
            print("Performing vector similarity search...")
            
            # Generate a query vector using CLIP
            query_vector = self._generate_clip_vector("microscopy image")
            
            # Search for similar images using near_vector
            vector_results = await weaviate_service.query.near_vector(
                collection_name=collection_name,
                application_id=application_id,
                near_vector=query_vector,
                include_vector=True,
                limit=3
            )
            
            print(f"Vector search results: {len(vector_results)} objects found")
            assert len(vector_results) > 0, "Vector search should return results"
            
        finally:
            # 6. Remove all collections which start with 'test_weaviate_xxxx'
            print("Cleaning up test collections...")
            
            all_collections = await weaviate_service.collections.list_all()
            test_collections = [name for name in all_collections.keys() if name.startswith("test_weaviate_")]
            
            for test_collection in test_collections:
                print(f"Deleting test collection: {test_collection}")
                try:
                    delete_result = await weaviate_service.collections.delete(test_collection)
                    print(f"Deleted {test_collection}: {delete_result}")
                except Exception as e:
                    print(f"Error deleting {test_collection}: {e}")
            
            # Verify cleanup
            remaining_collections = await weaviate_service.collections.list_all()
            remaining_test_collections = [name for name in remaining_collections.keys() if name.startswith("test_weaviate_")]
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
                "vectorizer": "none"  # No vectorizer - we'll provide vectors manually
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
                    "title": "Microscopy Basics",
                    "content": "Introduction to light microscopy techniques",
                    "category": "education"
                },
                {
                    "title": "Fluorescence Imaging",
                    "content": "Advanced fluorescence microscopy methods",
                    "category": "research"
                }
            ]
            
            # Insert objects with CLIP vectors
            for text_obj in text_objects:
                # Generate CLIP vector for the title + content
                text_description = f"{text_obj['title']}: {text_obj['content']}"
                clip_vector = self._generate_clip_vector(text_description)
                
                await weaviate_service.data.insert(
                    collection_name=collection_name,
                    application_id=application_id,
                    properties=text_obj,
                    vector=clip_vector
                )
            
            # Test vector similarity search
            query_vector = self._generate_clip_vector("microscopy techniques")
            search_results = await weaviate_service.query.near_vector(
                collection_name=collection_name,
                application_id=application_id,
                near_vector=query_vector,
                include_vector=True,
                limit=5
            )
            
            assert len(search_results) > 0, "Vector search should return results"
            
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
        
        # Test CLIP vector generation
        vector = self._generate_clip_vector("test microscopy image")
        assert len(vector) == 512  # CLIP ViT-B/32 produces 512-dimensional vectors
        assert all(isinstance(v, float) for v in vector)
        # CLIP vectors are normalized, so they can be negative
        assert all(-1 <= v <= 1 for v in vector)
        
        # Test collection name generation
        collection_name = self._generate_test_collection_name()
        assert collection_name.startswith("test_weaviate_")
        assert len(collection_name) == len("test_weaviate_") + 8  # 8 hex chars

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