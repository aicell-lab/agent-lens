"""
Similarity search utilities for Agent-Lens.
Provides functions for connecting to Weaviate, managing collections, and performing similarity searches.
"""

import os
from typing import List, Dict, Any
from hypha_rpc import connect_to_server
import numpy as np
import clip
import torch
from agent_lens.log import setup_logging

logger = setup_logging("agent_lens_weaviate_search.log")

# Weaviate service configuration
WEAVIATE_SERVER_URL = "https://hypha.aicell.io"
WEAVIATE_WORKSPACE = "hypha-agents"
WEAVIATE_SERVICE_NAME = "hypha-agents/weaviate"

# CLIP model configuration
device = "cuda" if torch.cuda.is_available() else "cpu"
_clip_model = None
_clip_preprocess = None

def _load_clip_model():
    """Load CLIP ViT-B/32 model lazily and cache it in memory."""
    global _clip_model, _clip_preprocess
    if _clip_model is None:
        logger.info(f"Loading CLIP ViT-B/32 on {device}")
        _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=device)
        logger.info("CLIP model loaded")
    return _clip_model, _clip_preprocess

def _normalize_features(features: np.ndarray) -> np.ndarray:
    """L2-normalize feature vectors."""
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
            image.thumbnail((224, 224), Image.Resampling.LANCZOS)
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

class WeaviateSimilarityService:
    """Service for managing similarity search operations with Weaviate."""
    
    def __init__(self):
        self.server = None
        self.weaviate_service = None
        self.connected = False
    
    async def connect(self) -> bool:
        """Connect to Weaviate service."""
        try:
            token = os.getenv("HYPHA_AGENTS_TOKEN")
            if not token:
                logger.error("HYPHA_AGENTS_TOKEN not set in environment")
                return False
            
            self.server = await connect_to_server({
                "server_url": WEAVIATE_SERVER_URL,
                "workspace": WEAVIATE_WORKSPACE,
                "token": token
            })
            
            self.weaviate_service = await self.server.get_service(WEAVIATE_SERVICE_NAME, mode="first")
            self.connected = True
            logger.info("Connected to Weaviate service")
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to Weaviate service: {e}")
            return False
    
    async def disconnect(self):
        """Disconnect from Weaviate service."""
        if self.server:
            await self.server.disconnect()
            self.server = None
            self.weaviate_service = None
            self.connected = False
            logger.info("Disconnected from Weaviate service")
    
    async def ensure_connected(self) -> bool:
        """Ensure we're connected to Weaviate service."""
        if not self.connected:
            return await self.connect()
        return True
    
    async def create_collection(self, collection_name: str, description: str = "Microscopy images collection") -> Dict[str, Any]:
        """Create a new collection in Weaviate."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        collection_settings = {
            "class": collection_name,
            "description": description,
            "properties": [
                {"name": "image_id", "dataType": ["text"]},
                {"name": "description", "dataType": ["text"]},
                {"name": "metadata", "dataType": ["text"]},
                {"name": "dataset_id", "dataType": ["text"]},
                {"name": "file_path", "dataType": ["text"]},
                {"name": "preview_image", "dataType": ["text"]}  # Base64 encoded 50x50 preview
            ],
            "vectorizer": "none"  # We'll provide vectors manually
        }
        
        result = await self.weaviate_service.collections.create(collection_settings)
        logger.info(f"Created collection: {collection_name}")
        return result
    
    async def create_application(self, collection_name: str, application_id: str, description: str = "Microscopy similarity search") -> Dict[str, Any]:
        """Create an application for a collection."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        result = await self.weaviate_service.applications.create(
            collection_name=collection_name,
            application_id=application_id,
            description=description
        )
        logger.info(f"Created application: {application_id} for collection: {collection_name}")
        return result
    
    async def insert_image(self, collection_name: str, application_id: str, 
                          image_id: str, description: str, metadata: Dict[str, Any],
                          dataset_id: str = None, file_path: str = None,
                          vector: List[float] = None, preview_image: str = None) -> Dict[str, Any]:
        """Insert an image with its embedding into Weaviate."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        import json
        properties = {
            "image_id": image_id,
            "description": description,
            "metadata": json.dumps(metadata) if metadata else "",
            "dataset_id": dataset_id or "",
            "file_path": file_path or "",
            "preview_image": preview_image or ""
        }
        
        # Generate vector if not provided
        if vector is None:
            vector = await generate_text_embedding(description)
        
        result = await self.weaviate_service.data.insert(
            collection_name=collection_name,
            application_id=application_id,
            properties=properties,
            vector=vector
        )
        
        logger.info(f"Inserted image: {image_id} into collection: {collection_name}")
        return result
    
    async def search_similar_images(self, collection_name: str, application_id: str,
                                  query_vector: List[float], limit: int = 10,
                                  include_vector: bool = False) -> List[Dict[str, Any]]:
        """Search for similar images using vector similarity."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        results = await self.weaviate_service.query.near_vector(
            collection_name=collection_name,
            application_id=application_id,
            near_vector=query_vector,
            include_vector=include_vector,
            limit=limit
        )
        
        logger.info(f"Found {len(results)} similar images in collection: {collection_name}")
        return results
    
    async def search_by_text(self, collection_name: str, application_id: str,
                           query_text: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for similar images using text query."""
        query_vector = await generate_text_embedding(query_text)
        return await self.search_similar_images(collection_name, application_id, query_vector, limit)
    
    async def search_by_image(self, collection_name: str, application_id: str,
                            image_bytes: bytes, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for similar images using image query."""
        query_vector = await generate_image_embedding(image_bytes)
        return await self.search_similar_images(collection_name, application_id, query_vector, limit)
    
    async def list_collections(self) -> Dict[str, Any]:
        """List all available collections."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        collections = await self.weaviate_service.collections.list_all()
        return collections
    
    async def collection_exists(self, collection_name: str) -> bool:
        """Check if a collection exists."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        return await self.weaviate_service.collections.exists(collection_name)
    
    async def delete_collection(self, collection_name: str) -> Dict[str, Any]:
        """Delete a collection."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        result = await self.weaviate_service.collections.delete(collection_name)
        logger.info(f"Deleted collection: {collection_name}")
        return result
    
    async def application_exists(self, collection_name: str, application_id: str) -> bool:
        """Check if an application exists in a collection."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        try:
            # Use the applications.exists method directly
            exists = await self.weaviate_service.applications.exists(collection_name, application_id)
            return exists
        except Exception as e:
            logger.warning(f"Could not check if application {application_id} exists in collection {collection_name}: {e}")
            return False

# Global instance for the frontend service
similarity_service = WeaviateSimilarityService()
