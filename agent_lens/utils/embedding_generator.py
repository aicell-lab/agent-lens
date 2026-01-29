"""
CLIP and Cell-DINO embedding generation utilities for Agent-Lens.
Provides functions for generating text and image embeddings using:
- CLIP ViT-B/32 model (512D) for image-text similarity
- Cell-DINO ViT-L/16 model (1024D) for image-image similarity (optimized for microscopy)
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

# Cell-DINO model configuration (replaces DINOv2)
_celldino_model = None
_celldino_normalize = None

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

class CellDinoNormalize:
    """
    Cell-DINO normalization following the official implementation.
    Normalizes each channel independently: (x/255 - mean) / std
    """
    def __call__(self, x):
        # Normalize to [0, 1]
        x = x / 255.0
        # Per-channel normalization (mean and std computed per image, per channel)
        m = x.mean((-2, -1), keepdim=True)
        s = x.std((-2, -1), unbiased=False, keepdim=True)
        x = (x - m) / (s + 1e-7)
        return x

def _load_celldino_model():
    """Load Cell-DINO ViT-L/16 model lazily and cache it in memory."""
    global _celldino_model, _celldino_normalize
    if _celldino_model is None:
        from dinov2.hub.cell_dino.backbones import cell_dino_hpa_vitl16
        logger.info(f"Loading Cell-DINO ViT-L/16 (HPA single cell) on {device}")
        
        # Load model without pretrained weights initially
        # User needs to provide pretrained_url or pretrained_path when loading
        # For now, we'll load without pretrained weights and log a warning
        pretrained_url = os.getenv("CELL_DINO_PRETRAINED_URL")
        pretrained_path = os.getenv("CELL_DINO_PRETRAINED_PATH")
        
        if pretrained_url or pretrained_path:
            _celldino_model = cell_dino_hpa_vitl16(
                pretrained=True,
                pretrained_url=pretrained_url,
                pretrained_path=pretrained_path,
                in_channels=4  # HPA single cell uses 4 channels
            ).to(device).eval()
            logger.info(f"Cell-DINO model loaded with pretrained weights from {pretrained_url or pretrained_path}")
        else:
            logger.warning("No pretrained weights specified for Cell-DINO. Set CELL_DINO_PRETRAINED_URL or CELL_DINO_PRETRAINED_PATH environment variable.")
            logger.warning("Loading Cell-DINO model without pretrained weights (for testing only)")
            _celldino_model = cell_dino_hpa_vitl16(
                pretrained=False,
                in_channels=4  # HPA single cell uses 4 channels
            ).to(device).eval()
        
        # Initialize normalization
        _celldino_normalize = CellDinoNormalize()
        logger.info("Cell-DINO model loaded")
    return _celldino_model, _celldino_normalize

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
    Generate both CLIP and Cell-DINO embeddings for an image.
    
    Returns a dictionary with:
    - clip_embedding: 512D vector for image-text similarity
    - dino_embedding: 1024D vector for image-image similarity (Cell-DINO ViT-L/16)
    
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

async def generate_image_embeddings_batch(image_bytes_list: List[bytes], max_batch_size: int = 300) -> List[Dict[str, List[float]]]:
    """
    Generate both CLIP and Cell-DINO embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    The main optimizations are:
    1. Parallel image preprocessing using ThreadPoolExecutor (PIL operations release GIL)
    2. Batching the model inference, which allows the GPU to process multiple images simultaneously
    3. Running CLIP and Cell-DINO inference in parallel
    
    Args:
        image_bytes_list: List of image byte data to process
        max_batch_size: Maximum number of images to process in a single GPU batch (default: 300)
        
    Returns:
        List of dictionaries with 'clip_embedding' and 'dino_embedding' keys (same order as input).
        Returns None for failed images.
    """
    import asyncio
    
    if not image_bytes_list:
        return []
    
    # If the list is larger than max_batch_size, process in chunks
    if len(image_bytes_list) > max_batch_size:
        logger.info(f"Processing {len(image_bytes_list)} images in chunks of {max_batch_size} to avoid GPU OOM")
        all_results = []
        for i in range(0, len(image_bytes_list), max_batch_size):
            chunk = image_bytes_list[i:i + max_batch_size]
            chunk_results = await generate_image_embeddings_batch(chunk, max_batch_size)
            all_results.extend(chunk_results)
        return all_results
    
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
        return await generate_image_embeddings_batch_dinov2(image_bytes_list, max_batch_size)
    
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
    Generate a unit-normalized Cell-DINO embedding for an image.
    
    Cell-DINO embeddings are optimized for microscopy image-image similarity search.
    Returns a 1024-dimensional embedding vector (ViT-L/16).
    
    Args:
        image_bytes: Image data as bytes
        
    Returns:
        1024-dimensional embedding vector (L2-normalized)
    """
    from PIL import Image
    import io
    
    model, normalize = _load_celldino_model()
    
    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            # Convert to 4-channel format expected by Cell-DINO (RGBX or RGBA)
            # If image has 3 channels (RGB), add an alpha channel
            if image.mode == "RGB":
                # Create RGBA image with full opacity
                image = image.convert("RGBA")
            elif image.mode == "L":
                # Grayscale: replicate to 4 channels
                image = image.convert("RGBA")
            elif image.mode == "RGBA":
                # Already 4 channels
                pass
            else:
                # Convert any other mode to RGBA
                image = image.convert("RGBA")
            
            # Convert PIL image to tensor (C, H, W) with values in [0, 255]
            import torchvision.transforms as transforms
            to_tensor = transforms.ToTensor()  # This converts to [0, 1]
            img_tensor = to_tensor(image) * 255.0  # Scale back to [0, 255]
            
            # Add batch dimension: (1, C, H, W)
            img_tensor = img_tensor.unsqueeze(0).to(device)
            
            # Apply Cell-DINO normalization
            img_tensor = normalize(img_tensor)
        
        # Use mixed precision for GPU efficiency
        with torch.no_grad():
            if device == "cuda":
                with torch.amp.autocast('cuda', dtype=torch.float16):
                    # Cell-DINO directly outputs embeddings
                    embeddings = model(img_tensor)
            else:
                embeddings = model(img_tensor)
        
        # L2 normalize for cosine similarity
        embeddings = torch.nn.functional.normalize(embeddings, dim=-1)
        
        # Convert to numpy and return as list
        embedding = embeddings.squeeze(0).float().cpu().numpy().astype(np.float32)
        return embedding.tolist()
        
    finally:
        # Cleanup
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

async def generate_image_embeddings_batch_dinov2(image_bytes_list: List[bytes], max_batch_size: int = 300) -> List[List[float]]:
    """
    Generate unit-normalized Cell-DINO embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    Cell-DINO embeddings are optimized for microscopy image-image similarity search.
    
    Args:
        image_bytes_list: List of image byte data to process
        max_batch_size: Maximum number of images to process in a single GPU batch (default: 300)
        
    Returns:
        List of 1024-dimensional embedding vectors (same order as input). Returns None for failed images.
    """
    from PIL import Image
    import io
    from concurrent.futures import ThreadPoolExecutor
    import asyncio
    import torchvision.transforms as transforms
    
    if not image_bytes_list:
        return []
    
    # If the list is larger than max_batch_size, process in chunks
    if len(image_bytes_list) > max_batch_size:
        logger.info(f"Processing {len(image_bytes_list)} images in chunks of {max_batch_size}")
        all_results = []
        for i in range(0, len(image_bytes_list), max_batch_size):
            chunk = image_bytes_list[i:i + max_batch_size]
            chunk_results = await generate_image_embeddings_batch_dinov2(chunk, max_batch_size)
            all_results.extend(chunk_results)
        return all_results
    
    model, normalize = _load_celldino_model()
    
    # Preprocess images in parallel using ThreadPoolExecutor
    def preprocess_single_image_celldino(idx: int, img_bytes: bytes):
        """Preprocess a single image for Cell-DINO (runs in thread pool)."""
        try:
            with Image.open(io.BytesIO(img_bytes)) as image:
                # Convert to 4-channel format expected by Cell-DINO
                if image.mode == "RGB":
                    image = image.convert("RGBA")
                elif image.mode == "L":
                    image = image.convert("RGBA")
                elif image.mode == "RGBA":
                    pass
                else:
                    image = image.convert("RGBA")
                
                # Convert PIL image to tensor (C, H, W) with values in [0, 255]
                to_tensor = transforms.ToTensor()
                img_tensor = to_tensor(image) * 255.0  # Scale to [0, 255]
                
                return img_tensor, idx, None
        except Exception as e:
            logger.warning(f"Failed to preprocess image at index {idx} for Cell-DINO: {e}")
            return None, idx, e
    
    try:
        # Use ThreadPoolExecutor for parallel preprocessing
        loop = asyncio.get_running_loop()
        with ThreadPoolExecutor() as executor:
            preprocessing_tasks = [
                loop.run_in_executor(executor, preprocess_single_image_celldino, idx, img_bytes)
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
        
        # Apply Cell-DINO normalization
        batch_tensor = normalize(batch_tensor)
        
        # Single batch inference with mixed precision
        with torch.no_grad():
            if device == "cuda":
                with torch.amp.autocast('cuda', dtype=torch.float16):
                    # Cell-DINO directly outputs embeddings
                    embeddings = model(batch_tensor)
            else:
                embeddings = model(batch_tensor)
        
        # L2 normalize for cosine similarity
        embeddings = torch.nn.functional.normalize(embeddings, dim=-1)
        
        # Convert to numpy
        normalized_features = embeddings.float().cpu().numpy().astype(np.float32)
        
        # Map results back to original order
        results = [None] * len(image_bytes_list)
        for batch_idx, original_idx in index_mapping.items():
            results[original_idx] = normalized_features[batch_idx].tolist()
        
        return results
        
    except Exception as e:
        logger.error(f"Error in batch Cell-DINO embedding generation: {e}")
        return [None] * len(image_bytes_list)
    finally:
        # Cleanup
        if 'batch_tensor' in locals():
            del batch_tensor
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

