import unittest
import base64
import io
import os
import numpy as np
from PIL import Image
import dotenv
from hypha_rpc import connect_to_server
from agent_lens import register_similarity_search_service

dotenv.load_dotenv()

class TestSimilaritySearchService(unittest.TestCase):
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

    async def test_find_similar_cells(self):
        cell_images = [TestSimilaritySearchService._generate_random_image() for _ in range(10)]
        annotations = TestSimilaritySearchService._generate_random_strings(10)
        server = await connect_to_server({
            "server_url": "https://hypha.aicell.io",
            "token": os.getenv("TEST_TOKEN")
        })
        await register_similarity_search_service.setup_service(server, "similarity-search-test")
        similarity_service = await server.get_service("similarity-search-test")
        workspace = server.config.workspace
        await similarity_service.remove_vectors(workspace)
        await similarity_service.save_cell_images(
            cell_images,
            workspace,
            annotations,
        )
        query_image = self._generate_random_image()
        results = await similarity_service.find_similar_cells(
            query_image,
            workspace,
            top_k=5
        )
        self.assertEqual(len(results), 5)
        for result in results:
            self.assertIn("score", result)
            self.assertIn("id", result)
            self.assertIn("annotation", result)
            self.assertIn("thumbnail", result)
            self.assertIsInstance(result["score"], str)
            self.assertIsInstance(result["id"], str)
            self.assertIsInstance(result["annotation"], str)
            self.assertIsInstance(result["thumbnail"], str)
            self.assertIn(result["annotation"], annotations)
            score = float(result["score"])
            self.assertGreaterEqual(score, 0)
            self.assertLessEqual(score, 1)
