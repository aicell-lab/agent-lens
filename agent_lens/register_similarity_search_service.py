"""
This module provides functionality for registering a similarity search service
that processes and stores image embeddings, and allows for searching similar images.
"""

import io
import base64
from functools import partial
import numpy as np
import torch
import clip
from PIL import Image
from agent_lens.artifact_manager import AgentLensArtifactManager

class TorchConfig:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        model, preprocess = clip.load("ViT-B/32", device=self.device)
        self.model = model
        self.preprocess = preprocess


async def try_create_collection(artifact_manager, user_id):
    """
    Creates a vector collection in the artifact manager for storing image embeddings.

    Args:
        artifact_manager (ArtifactManager): The artifact manager instance.
        user_id (str): The user ID.
    """
    await artifact_manager.create_vector_collection(
        user_id=user_id,
        name="cell-images",
        manifest={
            "name": "Cell images",
            "description": "Collection of cell images",
        },
        config={
            "vector_fields": [
                {
                    "type": "VECTOR",
                    "name": "cell_image_vector",
                    "algorithm": "FLAT",
                    "attributes": {
                        "TYPE": "FLOAT32",
                        "DIM": 512,
                        "DISTANCE_METRIC": "COSINE",
                    },
                },
                {"type": "TEXT", "name": "thumbnail"},
                {"type": "TAG", "name": "annotation"},
            ]
        },
        exists_ok=True,
    )


def get_image_tensor(image_data, preprocess, device):
    """
    Convert base64 encoded image data to a tensor.

    Args:
        image_data (str): The base64 encoded image data.
        preprocess (function): The preprocessing function.
        device (str): The device to use.

    Returns:
        Tensor: The image tensor.
    """
    image = decode_base64_image(image_data).convert("RGB")
    return preprocess(image).unsqueeze(0).to(device)


def process_image_tensor(image_tensor, model):
    """
    Process an image tensor to extract features.

    Args:
        image_tensor (Tensor): The image tensor.
        model (Model): The model to use.

    Returns:
        ndarray: The image features.
    """
    with torch.no_grad():
        image_features = model.encode_image(image_tensor).cpu().numpy().flatten()

    return image_features


def image_to_vector(image_data, torch_config, length=512):
    """
    Convert an image to a vector.

    Args:
        image_data (str): Base64 encoded image data.
        model (Model): The model to use.
        preprocess (function): The preprocessing function.
        device (str): The device to use.
        length (int): The length of the vector.

    Returns:
        ndarray: The image vector.
    """
    
    image_tensor = get_image_tensor(image_data, torch_config.preprocess, torch_config.device)
    query_vector = process_image_tensor(image_tensor, torch_config.model).reshape(1, length).astype(np.float32)

    return query_vector

def decode_base64_image(image_data):
    """
    Decode a base64 encoded image.

    Args:
        image_data (str): The base64 encoded image data.

    Returns:
        Image: The decoded image.
    """
    return Image.open(io.BytesIO(base64.b64decode(image_data)))


def make_thumbnail(image_data, size=(256, 256)):
    """
    Create a thumbnail from an image.

    Args:
        image_data (str): Base64 encoded image data.
        size (tuple): The size of the thumbnail.

    Returns:
        str: The base64-encoded thumbnail.
    """
    image = decode_base64_image(image_data).convert("RGB")
    image.thumbnail(size)
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return img_str


async def find_similar_cells(artifact_manager, torch_config, search_cell_image, user_id, top_k=5):
    query_vector = image_to_vector(search_cell_image, torch_config)
    await try_create_collection(artifact_manager, user_id)
    return await artifact_manager.search_vectors(user_id, "cell-images", query_vector.tolist(), top_k)


async def save_cell_image(artifact_manager, torch_config, cell_image, user_id, annotation=""):
    image_vector = image_to_vector(cell_image, torch_config)
    await try_create_collection(artifact_manager, user_id)
    await artifact_manager.add_vectors(user_id, "cell-images", [{
        "vector": image_vector.tolist(),
        "annotation": annotation,
        "thumbnail": make_thumbnail(cell_image),
    }])


async def setup_service(server):
    """
    Set up the similarity search service.

    Args:
        server (Server): The server instance.
    """
    artifact_manager = AgentLensArtifactManager()
    await artifact_manager.connect_server(server)
    torch_config = TorchConfig()

    await server.register_service({
        "id": "similarity-search",
        "config": {"visibility": "public"},
        "find_similar_cells": partial(find_similar_cells, artifact_manager, torch_config),
        "save_cell_image": partial(save_cell_image, artifact_manager, torch_config),
    })
    
    print("Similarity search service registered successfully.")

