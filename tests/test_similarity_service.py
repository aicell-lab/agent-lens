import pytest
import pytest_asyncio
import dotenv
import uuid

dotenv.load_dotenv()

@pytest_asyncio.fixture
async def test_frontend_service(hypha_server):
    """Create a real frontend service for testing similarity search endpoints."""
    print("🔗 Using Hypha server connection for similarity search tests...")
    
    server = hypha_server
    service = None
    
    try:
        print("✅ Connected to server")
        
        # Create unique service ID for this test
        test_id = f"test-similarity-frontend-{uuid.uuid4().hex[:8]}"
        print(f"Creating test frontend service with ID: {test_id}")
        
        # Register the frontend service
        print("📝 Registering frontend service...")
        from agent_lens.register_frontend_service import setup_service
        await setup_service(server, test_id)
        
        # Get the registered service
        service = await server.get_service(test_id)
        print("✅ Frontend service ready for similarity search testing")
        
        # Get the service URL for HTTP testing
        service_url = f"https://hypha.aicell.io/agent-lens/apps/{test_id}"
        print(f"🌐 Service URL: {service_url}")
        
        yield service, service_url
        
    except Exception as e:
        print(f"❌ Failed to create test frontend service: {e}")
        pytest.fail(f"Failed to create test frontend service: {e}")
    finally:
        # Cleanup
        if service:
            print("🧹 Cleaning up frontend service...")
            # Service cleanup is handled by the server disconnect in conftest.py

class TestWeaviateSimilarityService:


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
        """Generate a consistent test collection name for better organization."""
        return "AgentLensTest"
    
    @staticmethod
    async def _cleanup_test_collection(weaviate_service, collection_name):
        """Helper method to clean up test collection with proper error handling."""
        try:
            exists = await weaviate_service.collections.exists(collection_name)
            if exists:
                await weaviate_service.collections.delete(collection_name)
                print(f"✅ Cleaned up collection: {collection_name}")
            else:
                print(f"Collection {collection_name} does not exist - no cleanup needed")
        except Exception as e:
            print(f"Error cleaning up {collection_name}: {e}")

    @pytest.fixture
    async def weaviate_service(self):
        """Fixture to get Weaviate service connection using WeaviateSimilarityService."""
        from agent_lens.utils.weaviate_search import WeaviateSimilarityService
        
        service = WeaviateSimilarityService()
        connected = await service.connect()
        
        if not connected:
            pytest.skip("Weaviate service not available - skipping integration tests")
        
        yield service
        
        # Cleanup: disconnect service
        await service.disconnect()

    @pytest.mark.integration
    @pytest.mark.timeout(120)  # 2 minutes timeout to match GitHub Actions
    async def test_weaviate_collection_lifecycle(self, weaviate_service):
        """Test creating, using, and deleting a Weaviate collection."""
        collection_name = self._generate_test_collection_name()
        application_id = "test-app-001"
        
        try:
            # 1. Check if collection exists, create only if it doesn't
            print(f"Checking if test collection exists: {collection_name}")
            exists = await weaviate_service.collection_exists(collection_name)
            
            if not exists:
                print(f"Creating test collection: {collection_name}")
                try:
                    result = await weaviate_service.create_collection(
                        collection_name=collection_name,
                        description="Test collection for microscopy images"
                    )
                    print(f"Collection created: {result}")
                except Exception as e:
                    if "already exists" in str(e) or "class already exists" in str(e):
                        print(f"Collection {collection_name} already exists - using existing collection")
                    else:
                        raise
            else:
                print(f"Collection {collection_name} already exists - using existing collection")
            
            # Verify collection exists
            exists = await weaviate_service.collection_exists(collection_name)
            assert exists, f"Collection {collection_name} should exist"
            
            # 2. Create an application
            print(f"Creating application: {application_id}")
            app_result = await weaviate_service.create_application(
                collection_name=collection_name,
                application_id=application_id,
                description="Test application for microscopy image similarity search"
            )
            print(f"Application created: {app_result}")
            
            # Verify application exists
            app_exists = await weaviate_service.application_exists(collection_name, application_id)
            assert app_exists, f"Application {application_id} should exist after creation"
            
            # 3. Insert image data with vectors
            print("Inserting test image data with vectors...")
            
            # Generate test data
            test_images = []
            for i in range(3):
                image_data = {
                    "image_id": f"test_img_{i}",
                    "description": f"Test microscopy image {i}",
                    "metadata": f"{{'channel': 'BF_LED_matrix_full', 'exposure': {100 + i * 50}}}"
                }
                test_images.append(image_data)
            
            # Insert test image data with CLIP vectors
            insert_results = []
            for img_data in test_images:
                # Generate CLIP vector for the image description
                clip_vector = self._generate_clip_vector(img_data["description"])
                
                # Insert with vector using the proper method
                result = await weaviate_service.insert_image(
                    collection_name=collection_name,
                    application_id=application_id,
                    image_id=img_data["image_id"],
                    description=img_data["description"],
                    metadata=img_data["metadata"],
                    vector=clip_vector
                )
                insert_results.append(result)
            
            print(f"Inserted {len(insert_results)} objects with CLIP vectors")
            
            # 4. Test text-based search
            print("Testing text-based search...")
            text_results = await weaviate_service.search_by_text(
                collection_name=collection_name,
                application_id=application_id,
                query_text="microscopy image",
                limit=5
            )
            
            print(f"Text search results: {len(text_results)} objects found")
            assert len(text_results) > 0, "Text search should return results"
            
            # 5. List collections
            print("Listing all collections...")
            all_collections = await weaviate_service.list_collections()
            print(f"Available collections: {list(all_collections.keys())}")
            
            # Verify our test collection is in the list
            assert collection_name in all_collections, f"Test collection {collection_name} should be in collections list"
            
            # 6. Test vector similarity search
            print("Performing vector similarity search...")
            
            # Generate a query vector using CLIP
            query_vector = self._generate_clip_vector("microscopy image")
            
            # Search for similar images using the service method
            vector_results = await weaviate_service.search_similar_images(
                collection_name=collection_name,
                application_id=application_id,
                query_vector=query_vector,
                include_vector=True,
                limit=3
            )
            
            print(f"Vector search results: {len(vector_results)} objects found")
            assert len(vector_results) > 0, "Vector search should return results"
            
        finally:
            # Clean up the test collection
            try:
                await weaviate_service.delete_collection(collection_name)
                print(f"✅ Cleaned up collection: {collection_name}")
            except Exception as e:
                print(f"Warning: Error cleaning up collection {collection_name}: {e}")

    @pytest.mark.integration
    async def test_weaviate_text_search(self, weaviate_service):
        """Test text-based search functionality."""
        collection_name = self._generate_test_collection_name()
        application_id = "test-text-search"
        
        try:
            # Check if collection exists, create only if it doesn't
            exists = await weaviate_service.collection_exists(collection_name)
            
            if not exists:
                print(f"Creating test collection for text search: {collection_name}")
                try:
                    await weaviate_service.create_collection(
                        collection_name=collection_name,
                        description="Test collection for text search"
                    )
                except Exception as e:
                    if "already exists" in str(e) or "class already exists" in str(e):
                        print(f"Collection {collection_name} already exists - using existing collection")
                    else:
                        raise
            else:
                print(f"Collection {collection_name} already exists - using existing collection")
            
            await weaviate_service.create_application(
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
                
                await weaviate_service.insert_image(
                    collection_name=collection_name,
                    application_id=application_id,
                    image_id=text_obj['title'].lower().replace(' ', '_'),
                    description=text_description,
                    metadata=text_obj,
                    vector=clip_vector
                )
            
            # Test text-based search
            search_results = await weaviate_service.search_by_text(
                collection_name=collection_name,
                application_id=application_id,
                query_text="microscopy techniques",
                limit=5
            )
            
            assert len(search_results) > 0, "Text search should return results"
            
        finally:
            # Clean up the test collection
            try:
                await weaviate_service.delete_collection(collection_name)
                print(f"✅ Cleaned up collection: {collection_name}")
            except Exception as e:
                print(f"Warning: Error cleaning up collection {collection_name}: {e}")

    @pytest.mark.unit
    def test_utility_functions(self):
        """Test utility functions for test data generation."""
        # Test CLIP vector generation
        vector = TestWeaviateSimilarityService._generate_clip_vector("test microscopy image")
        assert len(vector) == 512  # CLIP ViT-B/32 produces 512-dimensional vectors
        assert all(isinstance(v, float) for v in vector)
        # CLIP vectors are normalized, so they can be negative
        assert all(-1 <= v <= 1 for v in vector)
        
        # Test collection name generation
        collection_name = TestWeaviateSimilarityService._generate_test_collection_name()
        assert collection_name == "AgentLensTest"  # Fixed collection name for testing
        assert len(collection_name) == len("AgentLensTest")

    @pytest.mark.integration
    async def test_collection_management(self, weaviate_service):
        """Test collection management operations."""
        collection_name = self._generate_test_collection_name()
        
        try:
            # Check if collection exists, create only if it doesn't
            exists = await weaviate_service.collection_exists(collection_name)
            
            if not exists:
                print(f"Creating test collection for management test: {collection_name}")
                try:
                    result = await weaviate_service.create_collection(
                        collection_name=collection_name,
                        description="Test collection"
                    )
                    assert result is not None
                except Exception as e:
                    if "already exists" in str(e) or "class already exists" in str(e):
                        print(f"Collection {collection_name} already exists - using existing collection")
                    else:
                        raise
            else:
                print(f"Collection {collection_name} already exists - using existing collection")
            
            # Test listing collections
            collections = await weaviate_service.list_collections()
            print(f"Available collections: {list(collections.keys())}")
            print(f"Looking for collection: {collection_name}")
            # Check if any collection name contains our test collection name (case-insensitive)
            collection_found = any(collection_name.lower() in name.lower() for name in collections.keys())
            assert collection_found, f"Collection {collection_name} should be in collections list. Available: {list(collections.keys())}"
            
        finally:
            # Clean up the test collection
            try:
                await weaviate_service.delete_collection(collection_name)
                print(f"✅ Cleaned up collection: {collection_name}")
            except Exception as e:
                print(f"Warning: Error cleaning up collection {collection_name}: {e}")

    #########################################################################################
    # FastAPI Endpoint Tests
    #########################################################################################

    @pytest.mark.integration
    async def test_similarity_endpoints_lifecycle(self, test_frontend_service):
        """Test complete similarity search endpoints lifecycle using real frontend service."""
        service, service_url = test_frontend_service
        # Use consistent collection name for better organization
        collection_name = "AgentLensTest"
        application_id = "test_app_001"
        
        import aiohttp
        
        try:
            async with aiohttp.ClientSession() as session:
                # 1. Create collection
                print("🧪 Creating similarity collection...")
                create_url = f"{service_url}/similarity/collections"
                create_data = {
                    "collection_name": collection_name,
                    "description": "Test collection for FastAPI",
                    "application_id": application_id
                }
                
                async with session.post(create_url, params=create_data) as response:
                    if response.status == 503:
                        pytest.skip("Similarity search service is not available - skipping test")
                    assert response.status == 200
                    result = await response.json()
                    assert result["success"] is True
                    # Get the transformed collection name from the response
                    valid_collection_name = result["collection_name"]
                    print(f"✅ Collection created successfully: {valid_collection_name}")
                
                # 2. Check collection exists
                print("🧪 Checking collection exists...")
                exists_url = f"{service_url}/similarity/collections/{valid_collection_name}/exists"
                async with session.get(exists_url) as response:
                    assert response.status == 200
                    result = await response.json()
                    assert result["exists"] is True
                    print("✅ Collection exists verified")
                
                # 3. Insert test image
                print("🧪 Inserting test image...")
                insert_url = f"{service_url}/similarity/insert"
                
                # Generate a test image embedding
                test_embedding = self._generate_clip_vector("Test microscopy image")
                import json
                from aiohttp import FormData
                
                # Use query parameters for required fields and FormData for image_embedding
                query_params = {
                    'collection_name': collection_name,
                    'application_id': application_id,
                    'image_id': 'test_img_001',
                    'description': 'Test microscopy image',
                    'metadata': '{"channel": "BF_LED_matrix_full"}'
                }
                
                # Use FormData only for image_embedding
                data = FormData()
                data.add_field('image_embedding', json.dumps(test_embedding))
                
                async with session.post(insert_url, params=query_params, data=data) as response:
                    if response.status != 200:
                        error_text = await response.text()
                        print(f"❌ Insert failed with status {response.status}: {error_text}")
                    assert response.status == 200
                    result = await response.json()
                    assert result["success"] is True
                    print("✅ Image inserted successfully")
                
                # 4. Search by text
                print("🧪 Testing text search...")
                search_url = f"{service_url}/similarity/search/text"
                search_data = {
                    "collection_name": collection_name,  # Use original name - search endpoint will transform it
                    "application_id": application_id,
                    "query_text": "microscopy",
                    "limit": 5
                }
                
                async with session.post(search_url, params=search_data) as response:
                    assert response.status == 200
                    result = await response.json()
                    assert result["success"] is True
                    assert "results" in result
                    print("✅ Text search completed successfully")
                
                # 5. Search by vector
                print("🧪 Testing vector search...")
                vector_url = f"{service_url}/similarity/search/vector"
                test_vector = self._generate_clip_vector("test microscopy image")
                vector_data = {
                    "collection_name": collection_name,  # Use original name - search endpoint will transform it
                    "application_id": application_id,
                    "limit": 5
                }
                
                async with session.post(vector_url, params=vector_data, json=test_vector) as response:
                    assert response.status == 200
                    result = await response.json()
                    assert result["success"] is True
                    print("✅ Vector search completed successfully")
                
        finally:
            # 6. Cleanup - clean the test collection
            print("🧹 Cleaning up test collection...")
            try:
                async with aiohttp.ClientSession() as session:
                    # Check if collection exists first
                    exists_url = f"{service_url}/similarity/collections/{collection_name}/exists"
                    async with session.get(exists_url) as response:
                        if response.status == 200:
                            result = await response.json()
                            if result.get("exists", False):
                                # Delete the test collection
                                cleanup_url = f"{service_url}/similarity/collections/{collection_name}"
                                async with session.delete(cleanup_url) as cleanup_response:
                                    if cleanup_response.status == 200:
                                        print(f"✅ Cleaned up collection: {collection_name}")
                                    else:
                                        print(f"Warning: Cleanup response for {collection_name}: {cleanup_response.status}")
                            else:
                                print(f"Collection {collection_name} does not exist - no cleanup needed")
                        else:
                            print(f"Failed to check if collection exists: {response.status}")
            except Exception as e:
                print(f"Error during cleanup: {e}")

    @pytest.mark.integration
    async def test_embedding_endpoints(self, test_frontend_service):
        """Test the basic embedding generation endpoints."""
        service, service_url = test_frontend_service
        import aiohttp
        
        try:
            async with aiohttp.ClientSession() as session:
                # Test text embedding endpoint
                print("🧪 Testing text embedding endpoint...")
                text_url = f"{service_url}/embedding/text"
                text_data = {"text": "microscopy image of cells"}
                
                async with session.post(text_url, params=text_data) as response:
                    assert response.status == 200
                    result = await response.json()
                    assert result["model"] == "ViT-B/32"
                    assert "embedding" in result
                    assert result["dimension"] == 512
                    assert result["text"] == "microscopy image of cells"
                    assert len(result["embedding"]) == 512
                    print("✅ Text embedding generated successfully")
                
                # Test image embedding endpoint
                print("🧪 Testing image embedding endpoint...")
                image_url = f"{service_url}/embedding/image"
                
                # Create a simple test image (1x1 pixel PNG)
                import io
                from PIL import Image
                test_image = Image.new('RGB', (1, 1), color='red')
                img_buffer = io.BytesIO()
                test_image.save(img_buffer, format='PNG')
                img_buffer.seek(0)
                
                # Test image upload
                from aiohttp import FormData
                data = FormData()
                data.add_field('image', img_buffer, filename='test.png', content_type='image/png')
                async with session.post(image_url, data=data) as response:
                    assert response.status == 200
                    result = await response.json()
                    assert result["model"] == "ViT-B/32"
                    assert "embedding" in result
                    assert result["dimension"] == 512
                    assert len(result["embedding"]) == 512
                    print("✅ Image embedding generated successfully")
                
                # Test error cases
                print("🧪 Testing error cases...")
                
                # Empty text
                async with session.post(text_url, params={"text": ""}) as response:
                    assert response.status == 400
                    print("✅ Empty text validation works")
                
                # Invalid image file
                data = FormData()
                data.add_field('image', io.BytesIO(b'not an image'), filename='test.txt', content_type='text/plain')
                async with session.post(image_url, data=data) as response:
                    assert response.status == 400
                    print("✅ Invalid image file validation works")
                
        except Exception as e:
            print(f"❌ Error in embedding endpoint tests: {e}")
            raise

    @pytest.mark.unit
    def test_fastapi_imports(self):
        """Test that FastAPI imports work correctly."""
        from agent_lens.register_frontend_service import get_frontend_api
        from agent_lens.utils.weaviate_search import similarity_service
        
        app = get_frontend_api()
        assert app is not None
        assert similarity_service is not None