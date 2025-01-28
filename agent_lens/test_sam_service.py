import asyncio
from hypha_rpc import connect_to_server
import numpy as np
from PIL import Image
import io

async def main():
    try:
        # Connect to the server
        server = await connect_to_server({"server_url": "https://hypha.aicell.io"})

        # Get the existing service
        segment_svc = await server.get_service("interactive-segmentation")

        print("Service info:", segment_svc)

        # Prepare image as bytes
        image = np.random.rand(256, 256, 3) * 255
        image = image.astype(np.uint8)
        buffer = io.BytesIO()
        Image.fromarray(image).save(buffer, format="PNG")
        image_bytes = buffer.getvalue()

        # Perform initial segmentation and compute embedding
        initial_point = [[128, 128]]
        initial_label = [1]
        result = await segment_svc.compute_embedding_with_initial_segment("vit_b", image_bytes, initial_point, initial_label)
        print("Embedding computed based on initial segmentation:", result)

        # Use embedding to perform segmentation on new images
        for i in range(1, 5):  # Assuming you have multiple images
            image = np.random.rand(256, 256, 3) * 255
            image = image.astype(np.uint8)
            buffer = io.BytesIO()
            Image.fromarray(image).save(buffer, format="PNG")
            image_bytes = buffer.getvalue()

            features = await segment_svc.segment_with_existing_embedding(image_bytes, initial_point, initial_label)
            print(f"Segmentation features for image {i}:", features)

        # Reset embedding when done
        reset_result = await segment_svc.reset_embedding()
        print("Embedding reset:", reset_result)

    except Exception as e:
        print(f"An error occurred: {e}")

if __name__ == "__main__":
    asyncio.run(main())
