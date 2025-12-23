"""
CLIP and DINOv2 embedding generation utilities for Agent-Lens.
Provides functions for generating text and image embeddings using:
- CLIP ViT-B/32 model (512D) for image-text similarity
- DINOv2 ViT-B/16 model (768D) for image-image similarity
"""

import os
from typing import List, Dict
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

# DINOv2 model configuration
_dinov2_model = None
_dinov2_processor = None

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

def _load_dinov2_model():
    """Load DINOv2 ViT-B/16 model lazily and cache it in memory."""
    global _dinov2_model, _dinov2_processor
    if _dinov2_model is None:
        from transformers import AutoImageProcessor, AutoModel
        logger.info(f"Loading DINOv2 ViT-B/16 on {device}")
        model_id = "facebook/dinov2-base"
        _dinov2_processor = AutoImageProcessor.from_pretrained(model_id)
        _dinov2_model = AutoModel.from_pretrained(model_id).to(device).eval()
        logger.info("DINOv2 model loaded")
    return _dinov2_model, _dinov2_processor

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

async def generate_image_embedding(image_bytes: bytes) -> Dict[str, List[float]]:
    """
    Generate both CLIP and DINOv2 embeddings for an image.
    
    Returns a dictionary with:
    - clip_embedding: 512D vector for image-text similarity
    - dino_embedding: 768D vector for image-image similarity
    
    Args:
        image_bytes: Image data as bytes
        
    Returns:
        Dictionary with 'clip_embedding' and 'dino_embedding' keys
    """
    # Generate both embeddings in parallel for efficiency
    import asyncio
    
    async def get_clip():
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
    
    async def get_dino():
        return await generate_image_embedding_dinov2(image_bytes)
    
    # Run both in parallel
    clip_emb, dino_emb = await asyncio.gather(get_clip(), get_dino())
    
    return {
        "clip_embedding": clip_emb,
        "dino_embedding": dino_emb
    }

async def generate_image_embeddings_batch(image_bytes_list: List[bytes]) -> List[Dict[str, List[float]]]:
    """
    Generate both CLIP and DINOv2 embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    The main optimizations are:
    1. Parallel image preprocessing using ThreadPoolExecutor (PIL operations release GIL)
    2. Batching the model inference, which allows the GPU to process multiple images simultaneously
    3. Running CLIP and DINOv2 inference in parallel
    
    Args:
        image_bytes_list: List of image byte data to process
        
    Returns:
        List of dictionaries with 'clip_embedding' and 'dino_embedding' keys (same order as input).
        Returns None for failed images.
    """
    import asyncio
    
    if not image_bytes_list:
        return []
    
    # Generate CLIP and DINOv2 embeddings in parallel for maximum efficiency
    async def get_clip_batch():
        from PIL import Image
        import io
        from concurrent.futures import ThreadPoolExecutor
        
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
    
    async def get_dino_batch():
        return await generate_image_embeddings_batch_dinov2(image_bytes_list)
    
    # Run both models in parallel
    clip_embeddings, dino_embeddings = await asyncio.gather(get_clip_batch(), get_dino_batch())
    
    # Combine results into dictionaries
    results = []
    for i in range(len(image_bytes_list)):
        clip_emb = clip_embeddings[i] if i < len(clip_embeddings) else None
        dino_emb = dino_embeddings[i] if i < len(dino_embeddings) else None
        
        if clip_emb is None and dino_emb is None:
            results.append(None)
        else:
            results.append({
                "clip_embedding": clip_emb,
                "dino_embedding": dino_emb
            })
    
    return results

async def generate_image_embedding_dinov2(image_bytes: bytes) -> List[float]:
    """
    Generate a unit-normalized DINOv2 embedding for an image.
    
    DINOv2 embeddings are optimized for image-image similarity search.
    Returns a 768-dimensional embedding vector.
    
    Args:
        image_bytes: Image data as bytes
        
    Returns:
        768-dimensional embedding vector (L2-normalized)
    """
    from PIL import Image
    import io
    
    model, processor = _load_dinov2_model()
    
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image = image.convert("RGB")
            inputs = processor(images=image, return_tensors="pt").to(device)
        
        # Use mixed precision for GPU efficiency
        with torch.no_grad():
            if device == "cuda":
                with torch.amp.autocast('cuda', dtype=torch.float16):
                    outputs = model(**inputs)
            else:
                outputs = model(**inputs)
        
        # Extract patch tokens (skip CLS token at index 0)
        # CLS token would be: last_hidden_state[:, 0, :]
        # Patch tokens are: last_hidden_state[:, 1:, :]
        patch_tokens = outputs.last_hidden_state[:, 1:, :]  # drop the first token, which is the [CLS] token

        # Average patch tokens (NOT using CLS token)
        deno_embeddings = torch.mean(patch_tokens, dim=1)

        # L2 normalize for cosine similarity
        deno_embeddings = torch.nn.functional.normalize(deno_embeddings, dim=-1)
        
        # Convert to numpy and return as list
        embedding = deno_embeddings.squeeze(0).float().cpu().numpy().astype(np.float32)
        return embedding.tolist()
        
    finally:
        # Cleanup
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

async def generate_image_embeddings_batch_dinov2(image_bytes_list: List[bytes]) -> List[List[float]]:
    """
    Generate unit-normalized DINOv2 embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    DINOv2 embeddings are optimized for image-image similarity search.
    
    Args:
        image_bytes_list: List of image byte data to process
        
    Returns:
        List of 768-dimensional embedding vectors (same order as input). Returns None for failed images.
    """
    from PIL import Image
    import io
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    
    if not image_bytes_list:
        return []
    
    model, processor = _load_dinov2_model()
    
    # Preprocess images in parallel using ThreadPoolExecutor
    def preprocess_single_image_dinov2(idx: int, img_bytes: bytes):
        """Preprocess a single image for DINOv2 (runs in thread pool)."""
        try:
            with Image.open(io.BytesIO(img_bytes)) as image:
                image = image.convert("RGB")
                # Process single image and return the pixel_values tensor
                inputs = processor(images=image, return_tensors="pt")
                return inputs.pixel_values.squeeze(0), idx, None
        except Exception as e:
            logger.warning(f"Failed to preprocess image at index {idx} for DINOv2: {e}")
            return None, idx, e
    
    try:
        # Use ThreadPoolExecutor for parallel preprocessing
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor() as executor:
            preprocessing_tasks = [
                loop.run_in_executor(executor, preprocess_single_image_dinov2, idx, img_bytes)
                for idx, img_bytes in enumerate(image_bytes_list)
            ]
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
        
        # Single batch inference with mixed precision
        with torch.no_grad():
            if device == "cuda":
                with torch.amp.autocast('cuda', dtype=torch.float16):
                    outputs = model(pixel_values=batch_tensor)
            else:
                outputs = model(pixel_values=batch_tensor)
        
        # Extract patch tokens (skip CLS token at index 0)
        # CLS token would be: last_hidden_state[:, 0, :]
        # Patch tokens are: last_hidden_state[:, 1:, :]
        patch_tokens = outputs.last_hidden_state[:, 1:, :]  # drop the first token, which is the [CLS] token

        # Average patch tokens (NOT using CLS token)
        deno_embeddings = torch.mean(patch_tokens, dim=1)

        
        # L2 normalize for cosine similarity
        deno_embeddings = torch.nn.functional.normalize(deno_embeddings, dim=-1)
        
        # Convert to numpy
        normalized_features = deno_embeddings.float().cpu().numpy().astype(np.float32)
        
        # Map results back to original order
        results = [None] * len(image_bytes_list)
        for batch_idx, original_idx in index_mapping.items():
            results[original_idx] = normalized_features[batch_idx].tolist()
        
        return results
        
    except Exception as e:
        logger.error(f"Error in batch DINOv2 embedding generation: {e}")
        return [None] * len(image_bytes_list)
    finally:
        # Cleanup
        if 'batch_tensor' in locals():
            del batch_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

