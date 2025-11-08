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

# Collection name - always use the existing 'Agentlens' collection (never create new collections)
WEAVIATE_COLLECTION_NAME = "Agentlens"

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

async def generate_image_embeddings_batch(image_bytes_list: List[bytes]) -> List[List[float]]:
    """
    Generate unit-normalized CLIP embeddings for multiple images in a single batch.
    This is much faster than processing images individually, especially on GPU.
    
    The main optimization is batching the CLIP model inference, which allows the GPU
    to process multiple images simultaneously and significantly improves throughput.
    
    Args:
        image_bytes_list: List of image byte data to process
        
    Returns:
        List of embedding vectors (same order as input). Returns None for failed images.
    """
    from PIL import Image
    import io
    
    if not image_bytes_list:
        return []
    
    model, preprocess = _load_clip_model()
    batch_tensors = []
    index_mapping = {}  # Maps batch position to original index
    
    try:
        # Preprocess all images sequentially (CPU-bound, but fast)
        for idx, img_bytes in enumerate(image_bytes_list):
            try:
                with Image.open(io.BytesIO(img_bytes)) as image:
                    image = image.convert("RGB")
                    image.thumbnail((224, 224), Image.Resampling.LANCZOS)
                    preprocessed = preprocess(image)
                    index_mapping[len(batch_tensors)] = idx
                    batch_tensors.append(preprocessed)
            except Exception as e:
                logger.warning(f"Failed to preprocess image at index {idx}: {e}")
                # Will be None in results
        
        if not batch_tensors:
            # All images failed preprocessing
            return [None] * len(image_bytes_list)
        
        # Stack all tensors into a single batch
        batch_tensor = torch.stack(batch_tensors).to(device)
        
        # Single batch inference (much faster than individual calls)
        # This is the key optimization - GPU processes all images at once
        with torch.no_grad():
            image_features = model.encode_image(batch_tensor).cpu().numpy()
        
        # Normalize features
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
                logger.warning("HYPHA_AGENTS_TOKEN not set in environment - similarity search will not be available")
                return False
            
            self.server = await connect_to_server({
                "server_url": WEAVIATE_SERVER_URL,
                "workspace": WEAVIATE_WORKSPACE,
                "token": token
            })
            
            try:
                self.weaviate_service = await self.server.get_service(WEAVIATE_SERVICE_NAME, mode="first")
                self.connected = True
                logger.info("Connected to Weaviate service")
                return True
            except Exception as service_error:
                logger.warning(f"Weaviate service not found: {service_error}")
                # Clean up the server connection since we can't use it
                await self.server.disconnect()
                self.server = None
                return False
            
        except Exception as e:
            logger.warning(f"Failed to connect to Weaviate service: {e}")
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
        return self.connected and self.weaviate_service is not None
    
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
                {"name": "preview_image", "dataType": ["blob"]}  # Base64 encoded 50x50 preview
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
    
    async def insert_many_images(self, collection_name: str, application_id: str,
                                objects: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Insert multiple images with their embeddings into Weaviate using insert_many.
        
        Args:
            collection_name: Name of the collection
            application_id: Application ID
            objects: List of dictionaries, each containing:
                - image_id: Unique identifier for the image
                - description: Text description
                - metadata: Dict of metadata
                - dataset_id: Optional dataset ID
                - file_path: Optional file path
                - vector: Image embedding vector (required)
                - preview_image: Optional base64 preview image
        
        Returns:
            Dict with insertion summary including uuids
        """
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        import json
        
        # Prepare objects for insert_many
        prepared_objects = []
        for obj in objects:
            # Generate vector if not provided
            vector = obj.get("vector")
            if vector is None:
                vector = await generate_text_embedding(obj.get("description", ""))
            
            # Prepare object with properties and vector
            prepared_obj = {
                "image_id": obj.get("image_id", ""),
                "description": obj.get("description", ""),
                "metadata": json.dumps(obj.get("metadata", {})) if obj.get("metadata") else "",
                "dataset_id": obj.get("dataset_id", ""),
                "file_path": obj.get("file_path", ""),
                "preview_image": obj.get("preview_image", ""),
                "vector": vector
            }
            prepared_objects.append(prepared_obj)
        
        # Insert all objects at once using insert_many
        try:
            result = await self.weaviate_service.data.insert_many(
                collection_name=collection_name,
                application_id=application_id,
                objects=prepared_objects
            )
            
            # Process results to extract UUIDs
            inserted_count = 0
            failed_count = 0
            errors = []
            uuids = {}
            
            # Handle different result formats
            if isinstance(result, list):
                results_list = result
            elif hasattr(result, 'results'):
                results_list = result.results
            elif isinstance(result, dict) and 'results' in result:
                results_list = result['results']
            else:
                results_list = [result]
            
            # Extract UUIDs from results
            for i, res in enumerate(results_list):
                image_id = objects[i].get("image_id", f"object_{i}")
                
                # Extract UUID from result
                uuid_val = None
                if hasattr(res, 'uuid'):
                    uuid_val = res.uuid
                elif hasattr(res, 'id'):
                    uuid_val = res.id
                elif isinstance(res, dict):
                    uuid_val = res.get('uuid') or res.get('id')
                else:
                    uuid_val = str(res) if res else None
                
                if uuid_val:
                    uuids[image_id] = str(uuid_val)
                    inserted_count += 1
                else:
                    failed_count += 1
                    error_msg = f"Failed to extract UUID for object {image_id}"
                    errors.append(error_msg)
                    logger.warning(error_msg)
            
            logger.info(f"Inserted {inserted_count} images using insert_many (failed: {failed_count})")
            
            return {
                "inserted_count": inserted_count,
                "failed_count": failed_count,
                "errors": errors if errors else None,
                "uuids": uuids,
                "has_errors": failed_count > 0
            }
            
        except Exception as e:
            # If insert_many fails entirely, log and return error
            error_msg = f"Failed to insert objects using insert_many: {str(e)}"
            logger.error(error_msg)
            return {
                "inserted_count": 0,
                "failed_count": len(objects),
                "errors": [error_msg],
                "uuids": {},
                "has_errors": True
            }
    
    async def search_similar_images(self, collection_name: str, application_id: str,
                                  query_vector: List[float], limit: int = 10,
                                  include_vector: bool = False) -> List[Dict[str, Any]]:
        """Search for similar images using vector similarity."""
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        # Explicitly specify which properties to return, including the blob preview_image
        return_properties = [
            "image_id",
            "description", 
            "metadata",
            "dataset_id",
            "file_path",
            "preview_image"  # This is the key - explicitly include the blob property
        ]
        
        results = await self.weaviate_service.query.near_vector(
            collection_name=collection_name,
            application_id=application_id,
            near_vector=query_vector,
            include_vector=include_vector,
            limit=limit,
            return_properties=return_properties  # Add this parameter
        )
        
        # Handle different result formats
        if hasattr(results, 'objects') and results.objects:
            # If results has an 'objects' property, extract it
            actual_results = results.objects
        elif isinstance(results, (list, tuple)):
            # If results is already a list/tuple, use it directly
            actual_results = results
        else:
            # Fallback: try to convert to list
            try:
                actual_results = list(results) if hasattr(results, '__iter__') else [results]
            except Exception as e:
                logger.error(f"Failed to process results: {e}")
                actual_results = []
        
        logger.info(f"Found {len(actual_results)} similar images in collection: {collection_name}")
        return actual_results
    
    async def fetch_all_annotations(self, collection_name: str, application_id: str,
                                   limit: int = 10000, include_vector: bool = False,
                                   use_prefix_match: bool = False) -> List[Dict[str, Any]]:
        """
        Fetch all annotations from a collection without vector search.
        
        Args:
            collection_name: Name of the collection
            application_id: Application ID to match (exact match by default, or prefix if use_prefix_match=True)
            limit: Maximum number of annotations to return
            include_vector: Whether to include vectors in results
            use_prefix_match: If True, match all annotations where application_id starts with the given prefix
            
        Returns:
            List of annotations matching the criteria
        """
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        # Explicitly specify which properties to return, including the blob preview_image
        return_properties = [
            "image_id",
            "description", 
            "metadata",
            "dataset_id",
            "file_path",
            "preview_image"
        ]
        
        # Handle prefix matching vs exact matching
        if use_prefix_match:
            # For prefix matching, we need to discover all applications matching the prefix,
            # then fetch from each. Since Weaviate organizes by application_id, we can't
            # easily fetch all without knowing the applications first.
            # Strategy: Use the prefix as application_id (in case there's an exact match),
            # then filter client-side. For multi-application scenarios, users should
            # first call list_annotation_applications to discover apps, then load from each.
            actual_results = []
            try:
                # Fetch with prefix as exact application_id (may return matches)
                # We'll filter client-side to get all matching annotations
                results = await self.weaviate_service.query.fetch_objects(
                    collection_name=collection_name,
                    application_id=application_id,  # Use prefix as application_id
                    limit=limit * 10,  # Fetch more to account for filtering
                    return_properties=return_properties
                )
                # Process results
                if hasattr(results, 'objects') and results.objects:
                    actual_results = results.objects
                elif isinstance(results, dict) and 'objects' in results:
                    actual_results = results['objects']
                elif isinstance(results, (list, tuple)):
                    actual_results = results
            except Exception as e:
                logger.warning(f"Failed to fetch with prefix matching: {e}")
                actual_results = []
        else:
            # Use exact match as before
            results = await self.weaviate_service.query.fetch_objects(
                collection_name=collection_name,
                application_id=application_id,
                limit=limit,
                return_properties=return_properties
            )
            
            # Handle different result formats
            if hasattr(results, 'objects') and results.objects:
                actual_results = results.objects
            elif isinstance(results, dict) and 'objects' in results:
                actual_results = results['objects']
            elif isinstance(results, (list, tuple)):
                actual_results = results
            else:
                try:
                    actual_results = list(results) if hasattr(results, '__iter__') else [results]
                except Exception as e:
                    logger.error(f"Failed to process results: {e}")
                    actual_results = []
        
        # If prefix matching is enabled, filter results by application_id prefix
        if use_prefix_match:
            filtered_results = []
            for annotation in actual_results:
                # Extract application_id from annotation - check multiple possible locations
                ann_app_id = None
                
                # Get the annotation data (handle different structures)
                ann_data = annotation
                if hasattr(annotation, 'properties'):
                    ann_data = annotation.properties
                elif hasattr(annotation, '__dict__'):
                    ann_data = annotation.__dict__
                
                # Try to find dataset_id or application_id in various locations
                if isinstance(ann_data, dict):
                    # Direct properties in dict
                    ann_app_id = ann_data.get('dataset_id') or ann_data.get('application_id')
                    
                    # Check nested properties structure
                    if not ann_app_id and 'properties' in ann_data:
                        props = ann_data['properties']
                        ann_app_id = props.get('dataset_id') or props.get('application_id')
                    
                    # Check metadata field (JSON string)
                    if not ann_app_id and 'metadata' in ann_data:
                        try:
                            import json
                            metadata_str = ann_data.get('metadata', '{}')
                            if isinstance(metadata_str, str):
                                metadata = json.loads(metadata_str)
                            else:
                                metadata = metadata_str
                            ann_app_id = metadata.get('dataset_id') or metadata.get('application_id')
                        except (json.JSONDecodeError, AttributeError, TypeError):
                            pass
                    
                    # Extract from image_id pattern: "application_id_annotation_id"
                    if not ann_app_id:
                        image_id = ann_data.get('image_id') or ann_data.get('properties', {}).get('image_id', '')
                        if image_id and '_' in str(image_id):
                            # Extract the application_id part (before first underscore)
                            ann_app_id = str(image_id).split('_')[0]
                
                # Match if application_id starts with the prefix
                if ann_app_id and str(ann_app_id).startswith(application_id):
                    filtered_results.append(annotation)
            
            actual_results = filtered_results[:limit]  # Apply limit after filtering
            logger.info(f"Fetched {len(actual_results)} annotations matching prefix '{application_id}*' from collection: {collection_name}")
        else:
            logger.info(f"Fetched {len(actual_results)} annotations from collection: {collection_name}")
        
        return actual_results
    
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
    
    async def fetch_by_uuid(self, collection_name: str, application_id: str,
                           object_uuid: str, include_vector: bool = True) -> Dict[str, Any]:
        """
        Fetch an object by its UUID and return its vector for similarity search.
        
        Args:
            collection_name: Name of the collection
            application_id: Application ID
            object_uuid: UUID of the object to fetch
            include_vector: Whether to include the vector in the result
            
        Returns:
            Dictionary containing the object data and vector (if include_vector=True)
            
        Raises:
            ValueError: If the UUID is not found
        """
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        try:
            # TODO: Try to fetch object by UUID directly
            # Weaviate typically supports fetching by UUID through the data.get method
            try:
                result = await self.weaviate_service.data.get(
                    collection_name=collection_name,
                    application_id=application_id,
                    uuid=object_uuid,
                    include_vector=include_vector
                )
                
                if result is None:
                    raise ValueError(f"UUID '{object_uuid}' not found in collection '{collection_name}' for application '{application_id}'")
                
                logger.info(f"Found object with UUID '{object_uuid}' in collection '{collection_name}'")
                return result
                
            except Exception as get_error:
                # Fallback: fetch objects and filter by UUID client-side
                logger.debug(f"Direct UUID fetch failed, trying client-side filter: {get_error}")
                
                results = await self.weaviate_service.query.fetch_objects(
                    collection_name=collection_name,
                    application_id=application_id,
                    limit=10000,
                    return_properties=["image_id", "description", "metadata", "dataset_id", "file_path", "preview_image"],
                    include_vector=include_vector
                )
                
                # Handle different result formats
                actual_results = []
                if hasattr(results, 'objects') and results.objects:
                    actual_results = results.objects
                elif isinstance(results, dict) and 'objects' in results:
                    actual_results = results['objects']
                elif isinstance(results, (list, tuple)):
                    actual_results = results
                else:
                    try:
                        actual_results = list(results) if hasattr(results, '__iter__') else [results]
                    except Exception as e:
                        logger.error(f"Failed to process results: {e}")
                        actual_results = []
                
                # Filter by UUID client-side
                matching_object = None
                for obj in actual_results:
                    # Extract UUID from the object
                    obj_uuid = None
                    if hasattr(obj, 'uuid'):
                        obj_uuid = obj.uuid
                    elif hasattr(obj, 'id'):
                        obj_uuid = obj.id
                    elif isinstance(obj, dict):
                        obj_uuid = obj.get('uuid') or obj.get('id') or obj.get('_id') or obj.get('_uuid')
                    
                    if obj_uuid and str(obj_uuid) == str(object_uuid):
                        matching_object = obj
                        break
                
                if matching_object is None:
                    raise ValueError(f"UUID '{object_uuid}' not found in collection '{collection_name}' for application '{application_id}'")
                
                logger.info(f"Found object with UUID '{object_uuid}' in collection '{collection_name}'")
                return matching_object
                
        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Error fetching object by UUID '{object_uuid}': {e}")
            raise
    
    async def search_by_uuid(self, collection_name: str, application_id: str,
                            object_uuid: str, limit: int = 10,
                            include_vector: bool = False) -> List[Dict[str, Any]]:
        """
        Search for similar images using a UUID as the query.
        First fetches the object by UUID to get its vector, then performs similarity search.
        
        Args:
            collection_name: Name of the collection
            application_id: Application ID
            object_uuid: UUID to search for similar objects
            limit: Maximum number of results to return
            include_vector: Whether to include vectors in results
            
        Returns:
            List of similar objects (excluding the query object itself)
        """
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        # Fetch the query object by UUID
        query_object = await self.fetch_by_uuid(
            collection_name=collection_name,
            application_id=application_id,
            object_uuid=object_uuid,
            include_vector=True  # Need the vector for similarity search
        )
        
        # Extract the vector from the query object (same logic as search_by_image_id)
        query_vector = None
        
        # Try different ways to access the vector
        if hasattr(query_object, 'vector'):
            query_vector = query_object.vector
        elif isinstance(query_object, dict):
            if 'vector' in query_object:
                query_vector = query_object['vector']
        
        # If we still don't have the vector, try to access it via metadata or additional fields
        if query_vector is None:
            if hasattr(query_object, 'additional'):
                additional = query_object.additional
                if hasattr(additional, 'vector'):
                    query_vector = additional.vector
            elif isinstance(query_object, dict):
                if 'additional' in query_object and isinstance(query_object['additional'], dict):
                    query_vector = query_object['additional'].get('vector')
            
            if query_vector is None and isinstance(query_object, dict):
                for key in ['vector', 'embedding', '_vector']:
                    if key in query_object:
                        query_vector = query_object[key]
                        break
        
        # Handle case where vector is a dictionary (e.g., {'default': [vector...]})
        if isinstance(query_vector, dict):
            if 'default' in query_vector:
                query_vector = query_vector['default']
            elif len(query_vector) == 1:
                query_vector = list(query_vector.values())[0]
            else:
                query_vector = list(query_vector.values())[0] if query_vector else None
        
        if query_vector is None:
            raise ValueError(f"Could not extract vector from object with UUID '{object_uuid}'. The object may not have a vector stored.")
        
        if not isinstance(query_vector, list):
            raise ValueError(f"Extracted vector is not a list: {type(query_vector)}")
        
        if not all(isinstance(x, (int, float)) for x in query_vector):
            raise ValueError("Vector contains non-numeric values")
        
        # Perform similarity search using the extracted vector
        search_results = await self.search_similar_images(
            collection_name=collection_name,
            application_id=application_id,
            query_vector=query_vector,
            limit=limit + 1,  # Fetch one extra to account for excluding the query object
            include_vector=include_vector
        )
        
        # Filter out the query object itself from results
        filtered_results = []
        for result in search_results:
            # Extract UUID from result
            result_uuid = None
            if hasattr(result, 'uuid'):
                result_uuid = result.uuid
            elif hasattr(result, 'id'):
                result_uuid = result.id
            elif isinstance(result, dict):
                result_uuid = result.get('uuid') or result.get('id') or result.get('_uuid')
            
            # Skip if this is the query object itself
            if result_uuid and str(result_uuid) == str(object_uuid):
                continue
            
            filtered_results.append(result)
            
            if len(filtered_results) >= limit:
                break
        
        logger.info(f"Found {len(filtered_results)} similar objects for UUID '{object_uuid}' (excluding query object)")
        return filtered_results
    
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
    
    async def list_annotation_applications(self, collection_name: str, prefix: str = None, limit: int = 1000) -> List[Dict[str, Any]]:
        """
        List all annotation applications in a collection, optionally filtered by prefix.
        
        Args:
            collection_name: Name of the collection
            prefix: Optional prefix to filter application IDs (returns applications starting with this prefix)
            limit: Maximum number of annotations to scan (used when fetching to extract application IDs)
            
        Returns:
            List of dictionaries with application_id and annotation count
        """
        if not await self.ensure_connected():
            raise RuntimeError("Not connected to Weaviate service")
        
        # To discover applications, we need to fetch annotations and extract unique application_ids
        # Note: This approach has limitations - we can only discover applications from annotations
        # that we can successfully fetch. For proper application discovery, the Weaviate service
        # would need to provide a list_applications method.
        results = []
        
        # Extract unique application IDs from annotations
        application_counts = {}
        
        if prefix:
            # If prefix is provided, try fetching with prefix as application_id (exact match)
            # All annotations fetched with this application_id belong to this application
            try:
                results = await self.fetch_all_annotations(
                    collection_name=collection_name,
                    application_id=prefix,
                    limit=limit,
                    include_vector=False,
                    use_prefix_match=False  # Use exact match to avoid recursion
                )
                
                # If we successfully fetched annotations, they all belong to the application_id used for fetching
                if results and len(results) > 0:
                    application_counts[prefix] = len(results)
                    logger.info(f"Found application '{prefix}' with {len(results)} annotations from direct fetch")
            except Exception as e:
                logger.warning(f"Failed to fetch annotations with prefix '{prefix}': {e}")
                results = []
        else:
            # Without prefix, we can't discover all applications easily without knowing them first
            # This is a limitation of the current approach - we'd need Weaviate to provide
            # a list_applications method or similar functionality
            logger.warning("Cannot discover all applications without a prefix. Please provide a prefix to search within.")
            results = []
        
        # Also extract application IDs from annotation properties/metadata (in case some annotations
        # have different application_ids in their metadata)
        for annotation in results:
            ann_app_id = None
            
            # Get annotation data
            ann_data = annotation
            if hasattr(annotation, 'properties'):
                ann_data = annotation.properties
            elif hasattr(annotation, '__dict__'):
                ann_data = annotation.__dict__
            
            # Extract application_id from annotation properties
            if isinstance(ann_data, dict):
                ann_app_id = ann_data.get('dataset_id') or ann_data.get('application_id')
                
                if not ann_app_id and 'properties' in ann_data:
                    props = ann_data['properties']
                    if isinstance(props, dict):
                        ann_app_id = props.get('dataset_id') or props.get('application_id')
                
                if not ann_app_id and 'metadata' in ann_data:
                    try:
                        import json
                        metadata_str = ann_data.get('metadata', '{}')
                        if isinstance(metadata_str, str):
                            metadata = json.loads(metadata_str)
                        else:
                            metadata = metadata_str
                        if isinstance(metadata, dict):
                            ann_app_id = metadata.get('dataset_id') or metadata.get('application_id')
                    except (json.JSONDecodeError, AttributeError, TypeError):
                        pass
                
                # Extract from image_id pattern: "application_id_annotation_id"
                if not ann_app_id:
                    image_id = ann_data.get('image_id') or (ann_data.get('properties', {}) or {}).get('image_id', '')
                    if image_id and '_' in str(image_id):
                        # Extract the application_id part (everything before the last underscore group)
                        # Since image_id is `${applicationId}_${annotation.id}`, split and take first part
                        parts = str(image_id).split('_')
                        if len(parts) > 1:
                            # Take all but the last part as application_id (in case annotation.id contains underscores)
                            ann_app_id = '_'.join(parts[:-1])
            
            # If we extracted an application_id from annotation properties and it's different from prefix
            if ann_app_id and ann_app_id != prefix:
                # Filter by prefix if provided
                if prefix is None or str(ann_app_id).startswith(prefix):
                    application_counts[ann_app_id] = application_counts.get(ann_app_id, 0) + 1
        
        # Convert to list of dictionaries
        applications = [
            {
                "application_id": app_id,
                "annotation_count": count
            }
            for app_id, count in sorted(application_counts.items())
        ]
        
        logger.info(f"Found {len(applications)} annotation applications matching prefix '{prefix or '*'}' in collection: {collection_name}")
        return applications

# Global instance for the frontend service
similarity_service = WeaviateSimilarityService()
