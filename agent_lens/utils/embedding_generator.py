"""
CLIP embedding generation utilities for Agent-Lens.
Provides functions for generating text and image embeddings using CLIP ViT-B/32 model (512D).
"""

import os
from typing import List
import numpy as np
import clip
import torch
from agent_lens.log import setup_logging

logger = setup_logging("agent_lens_embedding_generator.log")

# Device configuration
device = "cuda" if torch.cuda.is_available() else "cpu"

# CLIP model configuration
_clip_model = None
_clip_preprocess = None

# Configure CPU threads for PyTorch when using CPU
if device == "cpu":
    cpu_count = os.cpu_count() or 1
    # Use N-2 threads to leave 2 cores for OS and other processes
    # Minimum 1 thread, maximum all available threads
    num_threads = max(1, cpu_count - 2) if cpu_count > 2 else cpu_count
    torch.set_num_threads(num_threads)
    logger.info(f"CPU mode: Configured PyTorch to use {num_threads} threads (out of {cpu_count} available cores)")

def _load_clip_model():
    """Load CLIP ViT-B/32 model lazily and cache it in memory."""
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        logger.info(f"Loading CLIP ViT-B/32 on {device}")
        _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device)
        logger.info("CLIP model loaded")
    return _clip_model, _clip_preprocess

def _normalize_features(features: np.ndarray) -> np.ndarray:
    """L2-normalize feature vectors to unit length.
    
    This is essential for consistent similarity calculations in Weaviate and UMAP.
    Without normalization, embeddings with different magnitudes will produce
    incorrect similarity scores.
    """
    if features.ndim == 1:
        features = np.expand_dims(features, axis=0)
    norm = np.linalg.norm(features, axis=1, keepdims=True)
    return features / (norm + 1e-12)

async def generate_text_embedding(text_description: str) -> List[float]:
    """Generate a unit-normalized CLIP embedding for text."""
    model, preprocess = _load_clip_model()
    
    try:
        # Encode text
        text = clip.tokenize([text_description]).to(device)
        with torch.no_grad():
            text_features = model.encode_text(text)
            # Normalize to unit vector
            text_features = text_features / text_features.norm(dim=-1, keepdim=True)
        
        return text_features.cpu().numpy()[0].astype(np.float32).tolist()
    finally:
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

async def generate_image_embedding(image_bytes: bytes) -> List[float]:
    """
    Generate CLIP embedding for an image.
    
    Returns a 512D vector for image-text similarity.
    
    Args:
        image_bytes: Image data as bytes
        
    Returns:
        512-dimensional CLIP embedding vector
    """
    from PIL import Image
    import io
    
    model, preprocess = _load_clip_model()
    image_tensor = None
    
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = image.convert("RGB")
            image_tensor = preprocess(image).unsqueeze(0).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image_tensor).cpu().numpy()

        embedding = _normalize_features(image_features)[0].astype(np.float32)
        return embedding.tolist()
    finally:
        if image_tensor is not None:
            del image_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

async def generate_image_embeddings_batch(image_bytes_list: List[bytes]) -> List[List[float]]:
    """
    Generate CLIP embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    The main optimizations are:
    1. Parallel image preprocessing using ThreadPoolExecutor (PIL operations release GIL)
    2. Batching the model inference, which allows the GPU to process multiple images simultaneously
    
    Args:
        image_bytes_list: List of image byte data to process
        
    Returns:
        List of 512-dimensional embedding vectors (same order as input).
        Returns None for failed images.
    """
    from PIL import Image
    import io
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    
    if not image_bytes_list:
        return []
    
    model, preprocess = _load_clip_model()
    
    def preprocess_single_image(idx: int, img_bytes: bytes):
        """Preprocess a single image (runs in thread pool)."""
        try:
            with Image.open(io.BytesIO(img_bytes)) as image:
                image = image.convert("RGB")
                preprocessed = preprocess(image)
                return preprocessed, idx, None
        except Exception as e:
            logger.warning(f"Failed to preprocess image at index {idx} for CLIP: {e}")
            return None, idx, e
    
    try:
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor() as executor:
            preprocessing_tasks = [
                loop.run_in_executor(executor, preprocess_single_image, idx, img_bytes)
                for idx, img_bytes in enumerate(image_bytes_list)
            ]
            preprocessing_results = await asyncio.gather(*preprocessing_tasks)
        
        batch_tensors = []
        index_mapping = {}
        
        for preprocessed, original_idx, error in preprocessing_results:
            if preprocessed is not None:
                index_mapping[len(batch_tensors)] = original_idx
                batch_tensors.append(preprocessed)
        
        if not batch_tensors:
            return [None] * len(image_bytes_list)
        
        batch_tensor = torch.stack(batch_tensors).to(device)
        
        with torch.no_grad():
            image_features = model.encode_image(batch_tensor).cpu().numpy()
        
        normalized_features = _normalize_features(image_features).astype(np.float32)
        
        results = [None] * len(image_bytes_list)
        for batch_idx, original_idx in index_mapping.items():
            results[original_idx] = normalized_features[batch_idx].tolist()
        
        return results
            
    except Exception as e:
        logger.error(f"Error in batch CLIP embedding generation: {e}")
        return [None] * len(image_bytes_list)
    finally:
        if 'batch_tensor' in locals():
            del batch_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

