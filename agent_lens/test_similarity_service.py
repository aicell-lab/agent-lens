import unittest
import base64
import io
import os
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
        # Start MinIO service using docker-compose
        subprocess.run(["docker-compose", "-f",
                        "docker/docker-compose.yml", "up", "-d", "minio"], check=True)

        # Wait for MinIO to be ready
        time.sleep(2)  # Adjust the sleep time as needed

        # Start hypha.server with the necessary parameters
        command = [
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
            "--startup-functions=agent_lens.register_similarity_search_service:setup_service"
        ]
        cls.server_process = subprocess.Popen(command)

        cls.database = []
        cls._generate_random_images(cls.database, 10)

    @classmethod
    def tearDownClass(cls):
        # Stop the hypha.server process
        cls.server_process.terminate()
        cls.server_process.wait()

        # Stop the MinIO service
        subprocess.run(["docker-compose", "-f", "docker/docker-compose.yml", "down"], check=True)

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

    def parse_jwt(self, token):
        payload = token.split('.')[1]
        decoded_payload = base64.urlsafe_b64decode(payload + '==')
        return json.loads(decoded_payload)

    async def async_test_find_similar_cells(self):
        # Wait 10 seconds
        await asyncio.sleep(10)
        token = await login({"server_url": "http://localhost:9527"})
        server = await connect_to_server({
            "server_url": "http://localhost:9527",
            "token": token
        })
        similarity_service = await server.get_service("public/similarity-search")
        user_id = server.config.workspace.replace("ws-user-", "")
        for vector in self.database:
            await similarity_service.save_cell_image(
                vector,
                user_id,
            )
        query_image = self._generate_random_image()
        results = await similarity_service.find_similar_cells(
            query_image,
            user_id,
            top_k=5
        )
        print(results)
        self.assertEqual(len(results), 5)
        for _, similarity in results:
            self.assertTrue(0 <= similarity <= 1)

    def test_find_similar_cells(self):
        asyncio.run(self.async_test_find_similar_cells())

if __name__ == "__main__":
    unittest.main()