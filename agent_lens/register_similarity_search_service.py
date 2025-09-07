import asyncio
from hypha_rpc import connect_to_server, login
import numpy as np
import clip
import torch
from PIL import Image
import faiss
import io
import traceback
import os
import base64
from datetime import datetime
import uuid
import json
import gc
import weakref
from dotenv import find_dotenv, load_dotenv
ENV_FILE = find_dotenv()
if ENV_FILE:
    load_dotenv(ENV_FILE)

# This code defines a service for performing image and text similarity searches 
# using CLIP embeddings, FAISS indexing (loaded from/saved to files), 
# and a Hypha server connection.

# Global variables for lazy loading
device = "cuda" if torch.cuda.is_available() else "cpu"
model = None
preprocess = None
_model_ref = None

def _load_clip_model():
    """Lazy load CLIP model only when needed"""
    global model, preprocess, _model_ref
    if model is None:
        print("Loading CLIP model...")
        model, preprocess = clip.load("ViT-B/32", device=device)
        _model_ref = weakref.ref(model)
        print(f"CLIP model loaded on {device}")
    return model, preprocess

def _cleanup_model():
    """Clean up CLIP model from memory"""
    global model, preprocess, _model_ref
    if model is not None:
        del model
        del preprocess
        model = None
        preprocess = None
        _model_ref = None
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        gc.collect()
        print("CLIP model cleaned up from memory")

def _cleanup_tensors(*tensors):
    """Clean up tensors and free memory"""
    for tensor in tensors:
        if tensor is not None:
            del tensor
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    gc.collect()

# --- BEGIN File-based data storage setup ---
FAISS_DATA_DIR = "faiss_data_store"
IMAGE_STORE_SUBDIR = "images"
CELL_STORE_SUBDIR = "cell_images"

IMAGE_FAISS_FILENAME = "image_index.faiss"
IMAGE_METADATA_FILENAME = "image_metadata.json"
CELL_FAISS_FILENAME = "cell_index.faiss"
CELL_METADATA_FILENAME = "cell_metadata.json"

VECTOR_DIMENSION = 512  # For ViT-B/32 CLIP model
MAX_THUMBNAIL_SIZE = 256  # Reduced from 512 to save memory

# In-memory data stores (reduced size)
image_index = None
image_metadata = []  
cell_index = None
cell_metadata = []   

def _ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def _get_full_path(filename):
    return os.path.join(FAISS_DATA_DIR, filename)

def _get_image_store_path():
    return os.path.join(FAISS_DATA_DIR, IMAGE_STORE_SUBDIR)

def _get_cell_store_path():
    return os.path.join(FAISS_DATA_DIR, CELL_STORE_SUBDIR)

def _normalize_features(features):
    if features.ndim == 1:
        features = np.expand_dims(features, axis=0)
    norm = np.linalg.norm(features, axis=1, keepdims=True)
    return features / norm

def _load_faiss_index(filepath):
    """Load FAISS index with memory optimization"""
    if os.path.exists(filepath):
        # Use memory-mapped reading for large indices
        try:
            index = faiss.read_index(filepath)
            return index
        except Exception as e:
            print(f"Error loading FAISS index from {filepath}: {e}")
            return faiss.IndexFlatL2(VECTOR_DIMENSION)
    else:
        return faiss.IndexFlatL2(VECTOR_DIMENSION)

def initialize_data_stores():
    global image_index, image_metadata, cell_index, cell_metadata
    
    _ensure_dir(FAISS_DATA_DIR)
    _ensure_dir(_get_image_store_path())
    _ensure_dir(_get_cell_store_path())

    # Load metadata first (lightweight)
    image_metadata_path = _get_full_path(IMAGE_METADATA_FILENAME)
    cell_metadata_path = _get_full_path(CELL_METADATA_FILENAME)
    
    try:
        if os.path.exists(image_metadata_path):
            with open(image_metadata_path, 'r') as f:
                image_metadata = json.load(f)
            print(f"Loaded {len(image_metadata)} image metadata entries")
        else:
            image_metadata = []
            print("Initialized empty image metadata list.")
    except Exception as e:
        print(f"Error loading image metadata: {e}. Initializing empty list.")
        image_metadata = []

    try:
        if os.path.exists(cell_metadata_path):
            with open(cell_metadata_path, 'r') as f:
                cell_metadata = json.load(f)
            print(f"Loaded {len(cell_metadata)} cell metadata entries")
        else:
            cell_metadata = []
            print("Initialized empty cell metadata list.")
    except Exception as e:
        print(f"Error loading cell metadata: {e}. Initializing empty list.")
        cell_metadata = []

    # Initialize indices as None - they'll be loaded on-demand
    image_index = None
    cell_index = None
    print("Data stores initialized with lazy loading")

def _get_image_index():
    """Lazy load image index"""
    global image_index
    if image_index is None:
        image_faiss_path = _get_full_path(IMAGE_FAISS_FILENAME)
        image_index = _load_faiss_index(image_faiss_path)
        print(f"Loaded image FAISS index, ntotal: {image_index.ntotal}")
    return image_index

def _get_cell_index():
    """Lazy load cell index"""
    global cell_index
    if cell_index is None:
        cell_faiss_path = _get_full_path(CELL_FAISS_FILENAME)
        cell_index = _load_faiss_index(cell_faiss_path)
        print(f"Loaded cell FAISS index, ntotal: {cell_index.ntotal}")
    return cell_index

# Call initialization at startup
initialize_data_stores()

def ping():
    return "pong"

def find_similar_images(query_input, top_k=5):
    """
    Finds similar images based on either an input image or a text query.
    Optimized for memory usage.
    """
    global image_metadata
    
    # Limit top_k to prevent memory issues
    top_k = min(top_k, 20)
    
    try:
        index = _get_image_index()
        if index is None or index.ntotal == 0:
            print("Image index is not initialized or empty.")
            return []

        # Load model only when needed
        model, preprocess = _load_clip_model()
        
        query_features = None
        image_tensor = None
        text_tokens = None
        
        try:
            if isinstance(query_input, bytes):  # Image query
                # Process image with memory cleanup
                with Image.open(io.BytesIO(query_input)) as image:
                    image = image.convert("RGB")
                    # Resize image to reduce memory usage
                    image.thumbnail((224, 224), Image.Resampling.LANCZOS)
                    image_tensor = preprocess(image).unsqueeze(0).to(device)
                
                with torch.no_grad():
                    query_features = model.encode_image(image_tensor).cpu().numpy()
                
                # Clean up tensors
                _cleanup_tensors(image_tensor)
                
            elif isinstance(query_input, str):  # Text query
                text_tokens = clip.tokenize([query_input]).to(device)
                with torch.no_grad():
                    query_features = model.encode_text(text_tokens).cpu().numpy()
                
                # Clean up tensors
                _cleanup_tensors(text_tokens)
            else:
                raise ValueError("query_input must be image bytes or a text string.")

            query_features_normalized = _normalize_features(query_features)
            
            # Search with limited results to save memory
            num_to_search = min(index.ntotal, top_k * 2)  # Reduced multiplier
            if num_to_search == 0: 
                return []

            distances, indices = index.search(query_features_normalized.astype(np.float32), num_to_search)

            results = []
            returned_ids = set()

            for i, idx in enumerate(indices[0]):
                if idx < 0 or idx >= len(image_metadata): 
                    continue
                
                meta = image_metadata[idx]
                if meta['id'] in returned_ids:
                    continue

                distance = distances[0][i]
                similarity_score = 1 - (distance / 2)

                try:
                    # Process image with memory optimization
                    with Image.open(meta['file_path']) as img:
                        img.thumbnail((MAX_THUMBNAIL_SIZE, MAX_THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
                        buffered = io.BytesIO()
                        img_format = "JPEG"  # Always use JPEG for smaller size
                        img.save(buffered, format=img_format, quality=85, optimize=True)
                        img_str = base64.b64encode(buffered.getvalue()).decode()
                    
                    results.append({
                        'id': meta['id'],
                        'image_base64': img_str,
                        'file_path': meta['file_path'], 
                        'text_description': meta['text_description'],
                        'similarity': float(similarity_score)
                    })
                    returned_ids.add(meta['id'])
                    
                    # Clean up memory after each image
                    del buffered, img_str
                    
                except Exception as e_img:
                    print(f"Error processing image {meta['file_path']}: {e_img}")

                if len(results) >= top_k:
                    break
            
            # Sort by similarity before returning
            results.sort(key=lambda x: x['similarity'], reverse=True)
            
            # Clean up
            _cleanup_tensors(query_features, query_features_normalized)
            gc.collect()
            
            return results
            
        finally:
            # Clean up model after use to free memory
            _cleanup_model()
            
    except Exception as e:
        print(f"Error in find_similar_images: {e}")
        traceback.print_exc()
        # Clean up on error
        _cleanup_model()
        gc.collect()
        return []

def find_similar_cells(query_input, top_k=5, text_description_to_skip=None):
    """
    Finds similar cells based on either an input cell image or a text query.
    Optimized for memory usage.
    """
    global cell_metadata
    
    # Limit top_k to prevent memory issues
    top_k = min(top_k, 20)
    
    try:
        index = _get_cell_index()
        if index is None or index.ntotal == 0:
            return {"status": "info", "message": "No cell data available or index not initialized."}
      
        # Load model only when needed
        model, preprocess = _load_clip_model()
        
        query_features = None
        image_tensor = None
        text_tokens = None
        
        try:
            if isinstance(query_input, bytes):  # Image query
                with Image.open(io.BytesIO(query_input)) as image:
                    image = image.convert("RGB")
                    image.thumbnail((224, 224), Image.Resampling.LANCZOS)
                    image_tensor = preprocess(image).unsqueeze(0).to(device)
                
                with torch.no_grad():
                    query_features = model.encode_image(image_tensor).cpu().numpy()
                
                _cleanup_tensors(image_tensor)
                
            elif isinstance(query_input, str):  # Text query
                text_tokens = clip.tokenize([query_input]).to(device)
                with torch.no_grad():
                    query_features = model.encode_text(text_tokens).cpu().numpy()
                
                _cleanup_tensors(text_tokens)
            else:
                raise ValueError("query_input must be image bytes or a text string.")
                
            query_features_normalized = _normalize_features(query_features)

            if query_features_normalized.shape[1] != index.d:
                raise ValueError(f"Dimension mismatch: query vector dim={query_features_normalized.shape[1]}, index dim={index.d}")
          
            num_to_search = min(index.ntotal, top_k + 5) 
            if num_to_search == 0: 
                return []
            
            distances, indices = index.search(query_features_normalized.astype(np.float32), num_to_search)

            results = []
            returned_ids = set()

            for i, idx in enumerate(indices[0]):
                if idx < 0 or idx >= len(cell_metadata):
                    continue

                meta = cell_metadata[idx]

                if meta['id'] in returned_ids:
                    continue
                
                if text_description_to_skip and meta.get('text_description') == text_description_to_skip:
                    continue
                  
                distance = distances[0][i]
                similarity_score = 1 - (distance / 2)

                try:
                    with Image.open(meta['file_path']) as img:
                        img.thumbnail((MAX_THUMBNAIL_SIZE, MAX_THUMBNAIL_SIZE), Image.Resampling.LANCZOS)
                        buffered = io.BytesIO()
                        img_format = "JPEG"  # Use JPEG for smaller size
                        img.save(buffered, format=img_format, quality=85, optimize=True)
                        img_str = base64.b64encode(buffered.getvalue()).decode()

                    results.append({
                        'id': meta['id'],
                        'image_base64': img_str,
                        'text_description': meta['text_description'],
                        'annotation': meta.get('annotation'),
                        'similarity': float(similarity_score),
                        'file_path': meta['file_path']
                    })
                    returned_ids.add(meta['id'])
                    
                    # Clean up memory after each image
                    del buffered, img_str
                    
                except Exception as e_img:
                    print(f"Error processing cell image {meta['file_path']}: {e_img}")

                if len(results) >= top_k:
                    break
            
            results.sort(key=lambda x: x['similarity'], reverse=True)
            
            # Clean up
            _cleanup_tensors(query_features, query_features_normalized)
            gc.collect()
            
            return results
            
        finally:
            # Clean up model after use
            _cleanup_model()
            
    except Exception as e:
        print(f"Error in find_similar_cells: {e}")
        traceback.print_exc()
        _cleanup_model()
        gc.collect()
        return {"status": "error", "message": str(e)}

def add_image_file_and_update_index(image_bytes, text_description, original_file_extension='.png'):
    """
    Adds an image to the system with memory optimization.
    """
    global image_metadata
    
    try:
        _ensure_dir(_get_image_store_path())
        
        image_id = str(uuid.uuid4())
        stored_image_filename = f"{image_id}{original_file_extension}"
        stored_image_path = os.path.join(_get_image_store_path(), stored_image_filename)

        # Save image file
        with open(stored_image_path, 'wb') as f:
            f.write(image_bytes)

        # Load model only when needed
        model, preprocess = _load_clip_model()
        
        try:
            # Process image with memory optimization
            with Image.open(io.BytesIO(image_bytes)) as pil_image:
                pil_image = pil_image.convert("RGB")
                pil_image.thumbnail((224, 224), Image.Resampling.LANCZOS)
                image_tensor = preprocess(pil_image).unsqueeze(0).to(device)
            
            with torch.no_grad():
                image_features = model.encode_image(image_tensor).cpu().numpy()
            
            # Clean up tensors
            _cleanup_tensors(image_tensor)
            
            image_features_normalized = _normalize_features(image_features)

            # Get or create index
            index = _get_image_index()
            if index is None:
                index = faiss.IndexFlatL2(VECTOR_DIMENSION)
                global image_index
                image_index = index

            index.add(image_features_normalized.astype(np.float32))
            
            new_metadata_entry = {
                "id": image_id,
                "file_path": stored_image_path,
                "text_description": text_description,
                "timestamp": datetime.now().isoformat()
            }
            image_metadata.append(new_metadata_entry)

            # Save to disk
            faiss.write_index(index, _get_full_path(IMAGE_FAISS_FILENAME))
            with open(_get_full_path(IMAGE_METADATA_FILENAME), 'w') as f:
                json.dump(image_metadata, f, indent=2)

            # Clean up
            _cleanup_tensors(image_features, image_features_normalized)
            
            print(f"Image '{text_description}' (ID: {image_id}) added. Index size: {index.ntotal}")
            return {"status": "success", "message": "Image added.", "id": image_id, "stored_path": stored_image_path}
            
        finally:
            _cleanup_model()
            gc.collect()
            
    except Exception as e:
        print(f"Error adding image: {e}")
        traceback.print_exc()
        _cleanup_model()
        gc.collect()
        return {"status": "error", "message": str(e)}

def add_cell_file_and_update_index(cell_image_bytes, text_description, annotation="", original_file_extension='.png'):
    """
    Adds a cell image to the system with memory optimization.
    """
    global cell_metadata
    
    try:
        _ensure_dir(_get_cell_store_path())

        cell_id = str(uuid.uuid4())
        stored_cell_filename = f"{cell_id}{original_file_extension}"
        stored_cell_path = os.path.join(_get_cell_store_path(), stored_cell_filename)
        
        # Save cell image file
        with open(stored_cell_path, 'wb') as f:
            f.write(cell_image_bytes)

        # Load model only when needed
        model, preprocess = _load_clip_model()
        
        try:
            # Process image with memory optimization
            with Image.open(io.BytesIO(cell_image_bytes)) as pil_image:
                pil_image = pil_image.convert("RGB")
                pil_image.thumbnail((224, 224), Image.Resampling.LANCZOS)
                image_tensor = preprocess(pil_image).unsqueeze(0).to(device)

            with torch.no_grad():
                cell_features = model.encode_image(image_tensor).cpu().numpy()

            # Clean up tensors
            _cleanup_tensors(image_tensor)
            
            cell_features_normalized = _normalize_features(cell_features)
                
            # Get or create index
            index = _get_cell_index()
            if index is None:
                index = faiss.IndexFlatL2(VECTOR_DIMENSION)
                global cell_index
                cell_index = index
                
            index.add(cell_features_normalized.astype(np.float32))

            new_metadata_entry = {
                "id": cell_id,
                "file_path": stored_cell_path,
                "text_description": text_description, 
                "annotation": annotation,
                "timestamp": datetime.now().isoformat()
            }
            cell_metadata.append(new_metadata_entry)

            # Save to disk
            faiss.write_index(index, _get_full_path(CELL_FAISS_FILENAME))
            with open(_get_full_path(CELL_METADATA_FILENAME), 'w') as f:
                json.dump(cell_metadata, f, indent=2)

            # Clean up
            _cleanup_tensors(cell_features, cell_features_normalized)
            
            print(f"Cell image '{text_description}' (ID: {cell_id}) added. Index size: {index.ntotal}")
            return {"status": "success", "id": cell_id, "stored_path": stored_cell_path}
            
        finally:
            _cleanup_model()
            gc.collect()
            
    except Exception as e:
        print(f"Error saving cell image: {e}")
        traceback.print_exc()
        _cleanup_model()
        gc.collect()
        return {"status": "error", "message": str(e)}
    
async def start_hypha_service(server, service_id="image-text-similarity-search"):
    service_config = {
        "id": service_id, # Configurable service ID
        "config": {
            "visibility": "public",
            "run_in_executor": True,
            "require_context": False, 
        },
        "ping": ping,
        "find_similar_images": find_similar_images, 
        "add_image": add_image_file_and_update_index, 
        "find_similar_cells": find_similar_cells,
        "add_cell": add_cell_file_and_update_index, 
    }
    print(f"Registering service with ID: {service_id}")
    print(f"Service config: {service_config}")
    try:
        service_info = await server.register_service(service_config)
        print(f"Service registered successfully: {service_info}")
        return service_info
    except Exception as e:
        print(f"Error registering service: {e}")
        raise


async def setup():
    server_url = os.getenv("HYPHA_SERVER_URL", "https://hypha.aicell.io")
    token = os.getenv("WORKSPACE_TOKEN")
    workspace_name = os.getenv("HYPHA_WORKSPACE", "agent-lens") 

    if not token:
        print("Error: WORKSPACE_TOKEN environment variable not set.")
        return
        
    server = await connect_to_server({
        "client_id": "image-text-similarity-search",
        "server_url": server_url, 
        "token": token, 
        "workspace": workspace_name
    })

    local_server_url = "http://localhost:9527"
    local_token = os.getenv("REEF_LOCAL_TOKEN")
    local_workspace_name = os.getenv("REEF_LOCAL_WORKSPACE")

    local_server = await connect_to_server({
        "client_id": "image-text-similarity-search",
        "server_url": local_server_url, 
        "token": local_token, 
        "workspace": local_workspace_name
    })
    
    await start_hypha_service(server)
    await start_hypha_service(local_server)
    print(f"Image and Text Similarity Search service registered at workspace: {server.config.workspace}")
    print(f"Test it with the HTTP proxy: {server_url}/{server.config.workspace}/services/image-text-similarity-search/<method_name>")
 
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    try:
        loop.create_task(setup())
        loop.run_forever()
    except KeyboardInterrupt:
        print("Service shutting down...")
    finally:
        if not loop.is_closed():
             loop.close()
        print("Asyncio loop closed.")