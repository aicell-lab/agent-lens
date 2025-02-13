import pytest
import base64
import io
import os
import numpy as np
from PIL import Image
import dotenv
from hypha_rpc import connect_to_server
from agent_lens import register_similarity_search_service

dotenv.load_dotenv()

class TestSimilaritySearchService:
    @staticmethod
    def _generate_random_image():
        image = Image.fromarray(np.random.randint(0, 256, (224, 224, 3), dtype=np.uint8))
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
            
    @staticmethod
    def _generate_random_strings(count):
        random_strings = []
        for _ in range(count):
            random_strings.append(''.join(np.random.choice(list("abcdefghijklmnopqrstuvwxyz"), 10)))
            
        return random_strings

    @staticmethod
    @pytest.mark.asyncio
    async def test_find_similar_cells():
        cell_images = [TestSimilaritySearchService._generate_random_image() for _ in range(10)]
        annotations = TestSimilaritySearchService._generate_random_strings(10)
        token = os.getenv("TEST_TOKEN")
        if not token:
            raise EnvironmentError("TEST_TOKEN not found in environment variables")
        server = await connect_to_server({
            "server_url": "https://hypha.aicell.io",
            "token": token
        })
        await register_similarity_search_service.setup_service(server, "similarity-search-test")
        similarity_service = await server.get_service("similarity-search-test")
        workspace = server.config.workspace
        await similarity_service.remove_vectors(workspace, "similarity-search-test")
        await similarity_service.save_cell_images(
            cell_images,
            workspace,
            "similarity-search-test",
            annotations,
        )
        query_image = TestSimilaritySearchService._generate_random_image()
        results = await similarity_service.find_similar_cells(
            query_image,
            workspace,
            "similarity-search-test",
            top_k=5
        )
        assert len(results) == 5
        for result in results:
            assert "score" in result
            assert "id" in result
            assert "annotation" in result
            assert "thumbnail" in result
            assert isinstance(result["score"], str)
            assert isinstance(result["id"], str)
            assert isinstance(result["annotation"], str)
            assert isinstance(result["thumbnail"], str)
            assert result["annotation"] in annotations
            score = float(result["score"])
            assert 0 <= score <= 1
