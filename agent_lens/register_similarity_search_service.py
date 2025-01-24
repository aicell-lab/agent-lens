"""
This module provides functionality for registering a similarity search service
that processes and stores image embeddings, and allows for searching similar images.
"""

import io
import base64
import numpy as np
import torch
import clip
from PIL import Image
from agent_lens.service_utils import make_service
from agent_lens.artifact_manager import AgentLensArtifactManager

async def try_create_collection(artifact_manager, user_id):
    """
    Creates a vector collection in the artifact manager for storing image embeddings.

    Args:
        artifact_manager (ArtifactManager): The artifact manager instance.
        user_id (str): The user ID.
    """
    try:
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
                        "name": "vector",
                        "algorithm": "FLAT",
                        "attributes": {
                            "TYPE": "FLOAT32",
                            "DIM": 512,
                            "DISTANCE_METRIC": "COSINE",
                        },
                    },
                    {"type": "TAG", "name": "annotation"},
                    {"type": "STRING", "name": "thumbnail"},
                ],
                "embedding_models": {
                    "vector": "fastembed:BAAI/bge-small-en-v1.5",
                },
            }
        )
    except FileExistsError:
        pass


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
    image = Image.open(io.BytesIO(base64.b64decode(image_data))).convert("RGB")
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


def image_to_vector(image_data, model, preprocess, device, length=512):
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
    image_tensor = get_image_tensor(image_data, preprocess, device)
    query_vector = process_image_tensor(image_tensor, model).reshape(1, length).astype(np.float32)

    return query_vector


def make_thumbnail(image, size=(256, 256)):
    """
    Create a thumbnail from an image.

    Args:
        image (Image): The input image.
        size (tuple): The size of the thumbnail.

    Returns:
        str: The base64-encoded thumbnail.
    """
    image.thumbnail(size)
    buffered = io.BytesIO()
    image.save(buffered, format="PNG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return img_str


async def init_methods(artifact_manager):
    """
    Initialize the methods for the service.

    Args:
        artifact_manager (ArtifactManager): The artifact manager instance.

    Returns:
        tuple: The initialized methods.
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, preprocess = clip.load("ViT-B/32", device=device)

    async def find_similar_cells(search_cell_image, user_id, top_k=5):
        query_vector = image_to_vector(search_cell_image, model, preprocess, device)
        await try_create_collection(artifact_manager, user_id)
        return await artifact_manager.search_vectors(user_id, "cell-images", query_vector, top_k)

    async def save_cell_image(cell_image, user_id, annotation=""):
        image_vector = image_to_vector(cell_image, model, preprocess, device)
        await try_create_collection(artifact_manager, user_id)
        await artifact_manager.add_vectors(user_id, "cell-images", {
            "vector": image_vector,
            "annotation": annotation,
            "thumbnail": make_thumbnail(cell_image),
        })

    return find_similar_cells, save_cell_image


async def setup_service(server):
    """
    Set up the similarity search service.

    Args:
        server (Server): The server instance.
        artifact_manager (ArtifactManager): The artifact manager instance.
    """
    artifact_manager = AgentLensArtifactManager()
    await artifact_manager.connect_server(server)
    find_similar_cells, save_cell_image = await init_methods(artifact_manager)

    await make_service(
        service={
            "id": "similarity-search",
            "config":{
                "visibility": "public",
                "run_in_executor": True,
                "require_context": False,   
            },
            "type": "echo",
            "find_similar_cells": find_similar_cells,
            "save_cell_image": save_cell_image,
        },
        server=server
    )
