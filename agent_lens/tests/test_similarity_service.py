import unittest
import base64
import io
import asyncio
import subprocess
import sys
import time
import numpy as np
from PIL import Image
import torch
import dotenv
import json
from hypha_rpc import connect_to_server, login

dotenv.load_dotenv()

class TestSimilaritySearchService(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.remove_existing_containers_and_networks()
        subprocess.run(["docker-compose", "-f", "docker/docker-compose.yml", "up", "-d", "minio"], check=True)
        subprocess.run(["docker-compose", "-f", "docker/docker-compose.yml", "up", "-d", "redis"], check=True)
        time.sleep(10)
        
        cls.running_process = subprocess.Popen([
                sys.executable,
                "-m",
                "hypha.server",
                "--host=localhost",
                "--port=9527",
                "--enable-s3",
                "--access-key-id=minio",
                "--secret-access-key=minio123",
                "--endpoint-url=http://localhost:9000",
                "--endpoint-url-public=http://localhost:9000",
                "--s3-admin-type=minio",
                "--redis-uri=redis://localhost:6379/0",
                "--startup-functions=agent_lens.register_similarity_search_service:setup_service"
        ])
        time.sleep(20)

        cls.cell_images = []
        cls.annotations = []
        cls._generate_random_images(cls.cell_images, 10)
        cls._generate_random_strings(cls.annotations, 10)

    @classmethod
    def remove_existing_containers_and_networks(cls):
        # Remove any existing containers and networks
        subprocess.run(["docker-compose", "-f", "docker/docker-compose.yml", "down", "--remove-orphans"], check=True)
        subprocess.run(["docker", "network", "prune", "-f"], check=True)
        subprocess.run(["docker", "volume", "prune", "-f"], check=True)
        time.sleep(5)

    @classmethod
    def tearDownClass(cls):
        cls.running_process.terminate()
        cls.running_process.wait()
        # Stop the Docker Compose services
        cls.remove_existing_containers_and_networks()

    @staticmethod
    def _mock_model():
        class MockModel:
            def encode_image(self, _):
                return torch.rand((1, 512))
        return MockModel()

    @staticmethod
    def _generate_random_image():
        image = Image.fromarray(np.random.randint(0, 256, (224, 224, 3), dtype=np.uint8))
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')

    @staticmethod
    def _generate_random_images(database, count):
        for _ in range(count):
            image_data = TestSimilaritySearchService._generate_random_image()
            database.append(image_data)
            
    @staticmethod
    def _generate_random_strings(database, count):
        for _ in range(count):
            database.append(''.join(np.random.choice(list("abcdefghijklmnopqrstuvwxyz"), 10)))

    def parse_jwt(self, token):
        payload = token.split('.')[1]
        decoded_payload = base64.urlsafe_b64decode(payload + '==')
        return json.loads(decoded_payload)

    async def async_test_find_similar_cells(self):
        token = await login({"server_url": "http://localhost:9527"})
        server = await connect_to_server({
            "server_url": "http://localhost:9527",
            "token": token
        })
        similarity_service = await server.get_service("public/similarity-search")
        user_id = server.config.workspace.replace("ws-user-", "")
        await similarity_service.save_cell_images(
            self.cell_images,
            user_id,
            self.annotations,
        )
        query_image = self._generate_random_image()
        results = await similarity_service.find_similar_cells(
            query_image,
            user_id,
            top_k=5
        )
        print(results)
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
            self.assertIn(result["annotation"], self.annotations)
            score = float(result["score"])
            self.assertGreaterEqual(score, 0)
            self.assertLessEqual(score, 1)

    def test_find_similar_cells(self):
        asyncio.run(self.async_test_find_similar_cells())