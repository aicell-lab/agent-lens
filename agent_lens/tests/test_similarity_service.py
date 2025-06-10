import pytest
import base64
import io
import os
import numpy as np
from PIL import Image
import dotenv
from unittest.mock import patch, AsyncMock
from hypha_rpc import connect_to_server
try:
    from agent_lens import register_similarity_search_service
except ImportError:
    # Mock the module if it can't be imported due to missing dependencies
    class MockSimilarityService:
        @staticmethod
        async def start_hypha_service(server, service_id="image-text-similarity-search"):
            pass
    
    register_similarity_search_service = MockSimilarityService()

dotenv.load_dotenv()


class TestSimilaritySearchService:
    @staticmethod
    def _generate_random_image():
        image = Image.fromarray(
            np.random.randint(0, 256, (224, 224, 3), dtype=np.uint8)
        )
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode("utf-8")

    @staticmethod
    def _generate_random_image_bytes():
        """Generate random image as bytes for the service."""
        image = Image.fromarray(
            np.random.randint(0, 256, (224, 224, 3), dtype=np.uint8)
        )
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return buffered.getvalue()

    @staticmethod
    def _generate_random_strings(count):
        random_strings = []
        for _ in range(count):
            random_strings.append(
                "".join(np.random.choice(list("abcdefghijklmnopqrstuvwxyz"), 10))
            )

        return random_strings

    @pytest.mark.unit
    def test_generate_random_image(self):
        """Test image generation utility."""
        image_b64 = self._generate_random_image()
        
        # Verify it's valid base64
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data))
        
        assert image.size == (224, 224)
        assert image.mode == 'RGB'
    
    @pytest.mark.unit
    def test_generate_random_strings(self):
        """Test string generation utility."""
        strings = self._generate_random_strings(5)
        
        assert len(strings) == 5
        assert all(len(s) == 10 for s in strings)
        assert all(s.isalpha() for s in strings)

    @pytest.mark.integration
    @pytest.mark.slow
    async def test_find_similar_cells(self):
        """Test adding cell images and finding similar ones."""
        # Generate test data
        cell_images_bytes = [
            TestSimilaritySearchService._generate_random_image_bytes() for _ in range(3)
        ]
        annotations = TestSimilaritySearchService._generate_random_strings(3)
        
        token = os.getenv("AGENT_LENS_WORKSPACE_TOKEN")
        if not token:
            raise EnvironmentError("AGENT_LENS_WORKSPACE_TOKEN not found in environment variables")
        
        server = None
        similarity_service = None
        
        try:
            server = await connect_to_server({
                "server_url": "https://hypha.aicell.io", 
                "token": token,
                "workspace": "agent-lens"
            })
            
            import asyncio
            
            # Register the service
            print("Starting service registration...")
            service_info = await register_similarity_search_service.start_hypha_service(server, "image-text-similarity-search-test")
            print(f"Service registration completed: {service_info}")
            
            # Wait for service to be fully available
            await asyncio.sleep(3)
            
            # List services to debug
            services = await server.list_services()
            print(f"Available services: {[s['id'] for s in services]}")
            
            # Check if our test service is in the list
            test_service_found = any("image-text-similarity-search-test" in s['id'] for s in services)
            print(f"Test service found in list: {test_service_found}")
            
            similarity_service = await server.get_service("image-text-similarity-search-test")
            print("Successfully connected to test service")
            
            # Add cell images to the service
            added_cell_ids = []
            for i, (cell_image_bytes, annotation) in enumerate(zip(cell_images_bytes, annotations)):
                result = await similarity_service.add_cell(
                    cell_image_bytes, 
                    f"test_cell_{i}", 
                    annotation
                )
                assert result["status"] == "success"
                added_cell_ids.append(result["id"])
            
            # Test finding similar cells with image query
            query_image_bytes = TestSimilaritySearchService._generate_random_image_bytes()
            results = await similarity_service.find_similar_cells(query_image_bytes, top_k=3)
            
            # Check results format
            if isinstance(results, list):
                assert len(results) <= 3
                for result in results:
                    assert "id" in result
                    assert "similarity" in result
                    assert "image_base64" in result
                    assert "text_description" in result
                    assert "annotation" in result
                    assert isinstance(result["similarity"], float)
                    assert 0 <= result["similarity"] <= 1

            elif isinstance(results, dict):
                # Handle case where no results are found or there's an info message
                assert "status" in results
        finally:
            # Properly cleanup connections
            if similarity_service is not None:
                try:
                    await similarity_service.disconnect()
                except Exception as e:
                    print(f"Error disconnecting similarity service: {e}")
            
            if server is not None:
                try:
                    await server.disconnect()
                except Exception as e:
                    print(f"Error disconnecting server: {e}")
            
            # Allow time for cleanup
            import asyncio
            await asyncio.sleep(0.5)
            
    @pytest.mark.integration
    @pytest.mark.slow
    async def test_find_similar_images_with_text_query(self):
        """Test adding images and finding similar ones with text query."""
        # Generate test data
        image_bytes_list = [
            TestSimilaritySearchService._generate_random_image_bytes() for _ in range(3)
        ]
        descriptions = ["microscopy image 1", "cell culture sample", "fluorescence microscopy"]
        
        token = os.getenv("AGENT_LENS_WORKSPACE_TOKEN")
        if not token:
            raise EnvironmentError("AGENT_LENS_WORKSPACE_TOKEN not found in environment variables")
        
        server = None
        similarity_service = None
        
        try:
            server = await connect_to_server({
                "server_url": "https://hypha.aicell.io", 
                "token": token,
                "workspace": "agent-lens"
            })
            
            import asyncio
            
            # Register the service
            print("Starting service registration...")
            service_info = await register_similarity_search_service.start_hypha_service(server, "image-text-similarity-search-test")
            print(f"Service registration completed: {service_info}")
            
            # Wait for service to be fully available
            await asyncio.sleep(3)
            
            # List services to debug
            services = await server.list_services()
            print(f"Available services: {[s['id'] for s in services]}")
            
            # Check if our test service is in the list
            test_service_found = any("image-text-similarity-search-test" in s['id'] for s in services)
            print(f"Test service found in list: {test_service_found}")
            
            similarity_service = await server.get_service("image-text-similarity-search-test")
            print("Successfully connected to test service")
            
            # Add images to the service
            added_image_ids = []
            for image_bytes, description in zip(image_bytes_list, descriptions):
                result = await similarity_service.add_image(image_bytes, description)
                assert result["status"] == "success"
                added_image_ids.append(result["id"])
            
            # Test finding similar images with text query
            text_query = "microscopy"
            results = await similarity_service.find_similar_images(text_query, top_k=2)
            
            # Check results format
            assert isinstance(results, list)
            assert len(results) <= 2
            for result in results:
                assert "id" in result
                assert "similarity" in result
                assert "image_base64" in result
                assert "text_description" in result
                assert "file_path" in result
                assert isinstance(result["similarity"], float)
                assert 0 <= result["similarity"] <= 1
        finally:
            # Properly cleanup connections
            if similarity_service is not None:
                try:
                    await similarity_service.disconnect()
                except Exception as e:
                    print(f"Error disconnecting similarity service: {e}")
            
            if server is not None:
                try:
                    await server.disconnect()
                except Exception as e:
                    print(f"Error disconnecting server: {e}")
            
            # Allow time for cleanup
            import asyncio
            await asyncio.sleep(0.5)
