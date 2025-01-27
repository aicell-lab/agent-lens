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
from torchvision import transforms
from hypha_rpc import connect_to_server
from agent_lens import register_similarity_search_service

def setup_service_sync():
    loop = asyncio.get_event_loop()
    server = loop.run_until_complete(
        connect_to_server({ "server_url": "http://localhost:8000" })
    )
    loop.run_until_complete(register_similarity_search_service.setup_service(server))
    service = loop.run_until_complete(server.get_service("similarity-search"))
    
    return service

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
            "--port=8000",
            "--public-base-url=http://localhost:8000",
            "--enable-s3",
            "--access-key-id=minio",
            "--secret-access-key=minio123",
            "--endpoint-url=http://localhost:9000",
            "--endpoint-url-public=http://localhost:9000",
            "--s3-admin-type=minio",
        ]
        cls.server_process = subprocess.Popen(command)

        # Wait for the server to be ready
        time.sleep(5)  # Adjust the sleep time as needed

        # Initialize the similarity service
        cls.device = "cpu"
        cls.model = cls._mock_model()
        cls.preprocess = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
        ])
        cls.database = []
        cls._generate_random_images(cls.database, 10)
        cls.similarity_service = setup_service_sync()
        
        if cls.similarity_service is None:
            raise RuntimeError("Failed to initialize similarity service")

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
        image.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')

    @staticmethod
    def _generate_random_images(database, count):
        for _ in range(count):
            image_data = TestSimilaritySearchService._generate_random_image()
            vector = register_similarity_search_service.image_to_vector(
                image_data,
                TestSimilaritySearchService._mock_model(),
                transforms.Compose([
                    transforms.Resize((224, 224)),
                    transforms.ToTensor(),
                ]),
                "cpu"
            )
            database.append(vector)

    async def async_test_find_similar_cells(self):
        for vector in self.database:
            await self.similarity_service.save_cell_image(
                vector,
                "test-user"
            )
        query_image = self._generate_random_image()
        results = await self.similarity_service.find_similar_cells(
            query_image,
            "test-user",
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