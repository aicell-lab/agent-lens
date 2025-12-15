"""
CLIP embedding generation utilities for Agent-Lens.
Provides functions for generating text and image embeddings using CLIP ViT-B/32 model.
"""

import os
from typing import List
import numpy as np
import clip
import torch
from agent_lens.log import setup_logging

logger = setup_logging("agent_lens_embedding_generator.log")

# CLIP model configuration
device = "cuda" if torch.cuda.is_available() else "cpu"
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
    """Generate a unit-normalized CLIP embedding for an image."""
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
    Generate unit-normalized CLIP embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    The main optimizations are:
    1. Parallel image preprocessing using ThreadPoolExecutor (PIL operations release GIL)
    2. Batching the CLIP model inference, which allows the GPU to process multiple images simultaneously
    
    Args:
        image_bytes_list: List of image byte data to process
        
    Returns:
        List of embedding vectors (same order as input). Returns None for failed images.
    """
    from PIL import Image
    import io
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    
    if not image_bytes_list:
        return []
    
    model, preprocess = _load_clip_model()
    
    # Preprocess images in parallel using ThreadPoolExecutor
    # PIL operations release the GIL, so threading provides speedup
    def preprocess_single_image(idx: int, img_bytes: bytes):
        """Preprocess a single image (runs in thread pool)."""
        try:
            with Image.open(io.BytesIO(img_bytes)) as image:
                image = image.convert("RGB")
                preprocessed = preprocess(image)
                return preprocessed, idx, None
        except Exception as e:
            logger.warning(f"Failed to preprocess image at index {idx}: {e}")
            return None, idx, e
    
    try:
        # Use ThreadPoolExecutor for parallel preprocessing
        # Default max_workers=None uses min(32, os.cpu_count() + 4) workers
        # PIL operations release the GIL, so threading provides significant speedup
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor() as executor:
            # Submit all preprocessing tasks
            preprocessing_tasks = [
                loop.run_in_executor(executor, preprocess_single_image, idx, img_bytes)
                for idx, img_bytes in enumerate(image_bytes_list)
            ]
            # Wait for all preprocessing to complete
            preprocessing_results = await asyncio.gather(*preprocessing_tasks)
        
        # Collect successfully preprocessed images and track indices
        batch_tensors = []
        index_mapping = {}  # Maps batch position to original index
        
        for preprocessed, original_idx, error in preprocessing_results:
            if preprocessed is not None:
                index_mapping[len(batch_tensors)] = original_idx
                batch_tensors.append(preprocessed)
        
        if not batch_tensors:
            # All images failed preprocessing
            return [None] * len(image_bytes_list)
        
        # Stack all tensors into a single batch
        batch_tensor = torch.stack(batch_tensors).to(device)
        
        # Single batch inference (much faster than individual calls)
        # This is the key optimization - GPU processes all images at once
        with torch.no_grad():
            image_features = model.encode_image(batch_tensor).cpu().numpy()
        
        # Normalize features to unit length (essential for consistent similarity calculations)
        normalized_features = _normalize_features(image_features).astype(np.float32)
        
        # Map results back to original order
        results = [None] * len(image_bytes_list)
        for batch_idx, original_idx in index_mapping.items():
            results[original_idx] = normalized_features[batch_idx].tolist()
        
        return results
        
    except Exception as e:
        logger.error(f"Error in batch image embedding generation: {e}")
        return [None] * len(image_bytes_list)
    finally:
        # Cleanup
        if 'batch_tensor' in locals():
            del batch_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

