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
from dotenv import find_dotenv, load_dotenv
ENV_FILE = find_dotenv()
if ENV_FILE:
    load_dotenv(ENV_FILE)

# This code defines a service for performing image and text similarity searches 
# using CLIP embeddings, FAISS indexing (loaded from/saved to files), 
# and a Hypha server connection.

# Load the CLIP model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

# --- BEGIN File-based data storage setup ---
FAISS_DATA_DIR = "faiss_data_store"
IMAGE_STORE_SUBDIR = "images"
CELL_STORE_SUBDIR = "cell_images"

IMAGE_FAISS_FILENAME = "image_index.faiss"
IMAGE_METADATA_FILENAME = "image_metadata.json"
CELL_FAISS_FILENAME = "cell_index.faiss"
CELL_METADATA_FILENAME = "cell_metadata.json"

VECTOR_DIMENSION = 512  # For ViT-B/32 CLIP model

# In-memory data stores
image_index = None
# List of dicts: {"id": "unique_id", "file_path": "path/to/image.png", "text_description": "...", "channel": "..."}
image_metadata = []  
cell_index = None
# List of dicts: {"id": "unique_id", "file_path": "path/to/cell.png", "text_description": "...", "annotation": "..."}
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

def initialize_data_stores():
    global image_index, image_metadata, cell_index, cell_metadata
    
    _ensure_dir(FAISS_DATA_DIR)
    _ensure_dir(_get_image_store_path())
    _ensure_dir(_get_cell_store_path())

    # Image data
    image_faiss_path = _get_full_path(IMAGE_FAISS_FILENAME)
    image_metadata_path = _get_full_path(IMAGE_METADATA_FILENAME)
    
    try:
        if os.path.exists(image_faiss_path):
            image_index = faiss.read_index(image_faiss_path)
            print(f"Loaded image FAISS index from {image_faiss_path}, ntotal: {image_index.ntotal}")
        else:
            image_index = faiss.IndexFlatL2(VECTOR_DIMENSION)
            print(f"Created new empty image FAISS index (dim: {VECTOR_DIMENSION})")
    except Exception as e:
        print(f"Error loading/creating image FAISS index: {e}. Creating new index.")
        image_index = faiss.IndexFlatL2(VECTOR_DIMENSION)

    try:
        if os.path.exists(image_metadata_path):
            with open(image_metadata_path, 'r') as f:
                image_metadata = json.load(f)
            print(f"Loaded {len(image_metadata)} image metadata entries from {image_metadata_path}")
        else:
            image_metadata = []
            print("Initialized empty image metadata list.")
    except Exception as e:
        print(f"Error loading image metadata: {e}. Initializing empty list.")
        image_metadata = []

    # Cell data
    cell_faiss_path = _get_full_path(CELL_FAISS_FILENAME)
    cell_metadata_path = _get_full_path(CELL_METADATA_FILENAME)

    try:
        if os.path.exists(cell_faiss_path):
            cell_index = faiss.read_index(cell_faiss_path)
            print(f"Loaded cell FAISS index from {cell_faiss_path}, ntotal: {cell_index.ntotal}")
        else:
            cell_index = faiss.IndexFlatL2(VECTOR_DIMENSION)
            print(f"Created new empty cell FAISS index (dim: {VECTOR_DIMENSION})")
    except Exception as e:
        print(f"Error loading/creating cell FAISS index: {e}. Creating new index.")
        cell_index = faiss.IndexFlatL2(VECTOR_DIMENSION)
        
    try:
        if os.path.exists(cell_metadata_path):
            with open(cell_metadata_path, 'r') as f:
                cell_metadata = json.load(f)
            print(f"Loaded {len(cell_metadata)} cell metadata entries from {cell_metadata_path}")
        else:
            cell_metadata = []
            print("Initialized empty cell metadata list.")
    except Exception as e:
        print(f"Error loading cell metadata: {e}. Initializing empty list.")
        cell_metadata = []

    if image_index and image_index.ntotal > 0 and image_index.ntotal != len(image_metadata):
        print(f"Warning: Image FAISS index size ({image_index.ntotal}) != metadata size ({len(image_metadata)}). Rebuilding index from metadata if possible, or clearing.")
        # Basic reconciliation: if metadata exists but index is mismatched, prefer metadata.
        if image_metadata:
             # Attempt to rebuild, or clear and start fresh if rebuilding is too complex here
            print("Attempting to clear and rebuild image index from metadata is not implemented yet. Clearing index.")
            image_index = faiss.IndexFlatL2(VECTOR_DIMENSION) # Create new empty index

    if cell_index and cell_index.ntotal > 0 and cell_index.ntotal != len(cell_metadata):
        print(f"Warning: Cell FAISS index size ({cell_index.ntotal}) != metadata size ({len(cell_metadata)}). Clearing index.")
        cell_index = faiss.IndexFlatL2(VECTOR_DIMENSION) # Similar to above for cells

# Call initialization at startup
initialize_data_stores()

def hello_world():
    return "Hello world"

def find_similar_images(query_input, top_k=5):
    """
    Finds similar images based on either an input image or a text query.

    Args:
        query_input (bytes or str): The input query, either image bytes or a text description.
        top_k (int): The number of similar images to return.

    Returns:
        list: A list of dictionaries, each representing a similar image with its
              metadata (file_path, text_description, similarity).
              Returns empty list on error or if no images are indexed.
    """
    global image_index, image_metadata
    try:
        if image_index is None or image_index.ntotal == 0:
            print("Image index is not initialized or empty.")
            return []

        if isinstance(query_input, bytes): # Image query
            image = Image.open(io.BytesIO(query_input)).convert("RGB")
            image_input_processed = preprocess(image).unsqueeze(0).to(device)
            with torch.no_grad():
                query_features = model.encode_image(image_input_processed).cpu().numpy()
        elif isinstance(query_input, str): # Text query
            text_tokens = clip.tokenize([query_input]).to(device)
            with torch.no_grad():
                query_features = model.encode_text(text_tokens).cpu().numpy()
        else:
            raise ValueError("query_input must be image bytes or a text string.")

        query_features_normalized = _normalize_features(query_features)
        
        num_to_search = min(image_index.ntotal, top_k * 5) 
        if num_to_search == 0: return []

        distances, indices = image_index.search(query_features_normalized.astype(np.float32), num_to_search)

        results = []
        returned_ids = set()

        for i, idx in enumerate(indices[0]):
            if idx < 0 or idx >= len(image_metadata): 
                print(f"Warning: Invalid index {idx} from FAISS image search.")
                continue
            
            meta = image_metadata[idx]
            if meta['id'] in returned_ids: # Avoid duplicates if search returns same item multiple times
                continue

            distance = distances[0][i]
            similarity_score = 1 - (distance / 2) # Assuming 'distance' is squared L2

            print(f"Image ID: {meta['id']}, Score: {similarity_score:.4f}, Path: {meta['file_path']}, Desc: {meta['text_description']}")
            
            try:
                with Image.open(meta['file_path']) as img:
                    img.thumbnail((512, 512))
                    buffered = io.BytesIO()
                    img_format = "PNG" if meta['file_path'].lower().endswith(".png") else "JPEG"
                    img.save(buffered, format=img_format) 
                    img_str = base64.b64encode(buffered.getvalue()).decode()
                
                results.append({
                    'id': meta['id'],
                    'image_base64': img_str,
                    'file_path': meta['file_path'], 
                    'text_description': meta['text_description'],
                    'similarity': float(similarity_score)
                })
                returned_ids.add(meta['id'])
            except FileNotFoundError:
                print(f"Error: Image file not found at {meta['file_path']}")
            except Exception as e_img:
                print(f"Error processing image {meta['file_path']}: {e_img}")

            if len(results) >= top_k:
                break
        
        # Sort by similarity before returning
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results
    except Exception as e:
        print(f"Error in find_similar_images: {e}")
        traceback.print_exc()
        return []
  
def find_similar_cells(query_input, top_k=5, text_description_to_skip=None):
    """
    Finds similar cells based on either an input cell image or a text query.

    Args:
        query_input (bytes or str): The input query, either cell image bytes or a text description.
        top_k (int): The number of similar cells to return.
        text_description_to_skip (str, optional): If the query was an image identified by this
                                                 description, skip this item in results.

    Returns:
        list or dict: A list of dictionaries, each representing a similar cell with its
                      metadata (file_path, text_description, annotation, similarity).
                      Returns a dict with "status": "error" on issues.
    """
    global cell_index, cell_metadata
    try:
        if cell_index is None or cell_index.ntotal == 0:
            return {"status": "info", "message": "No cell data available or index not initialized."}
      
        if isinstance(query_input, bytes): # Image query
            image = Image.open(io.BytesIO(query_input)).convert("RGB")
            image_input_processed = preprocess(image).unsqueeze(0).to(device)
            with torch.no_grad():
                query_features = model.encode_image(image_input_processed).cpu().numpy()
        elif isinstance(query_input, str): # Text query
            text_tokens = clip.tokenize([query_input]).to(device)
            with torch.no_grad():
                query_features = model.encode_text(text_tokens).cpu().numpy()
        else:
            raise ValueError("query_input must be image bytes or a text string.")
            
        query_features_normalized = _normalize_features(query_features)

        if query_features_normalized.shape[1] != cell_index.d: # cell_index.d is dimension
            raise ValueError(f"Dimension mismatch: query vector dim={query_features_normalized.shape[1]}, index dim={cell_index.d}")
      
        num_to_search = min(cell_index.ntotal, top_k + 5) 
        if num_to_search == 0: return []
        
        distances, indices = cell_index.search(query_features_normalized.astype(np.float32), num_to_search)

        results = []
        returned_ids = set()

        for i, idx in enumerate(indices[0]):
            if idx < 0 or idx >= len(cell_metadata):
                print(f"Warning: Invalid index {idx} from FAISS cell search.")
                continue

            meta = cell_metadata[idx]

            if meta['id'] in returned_ids:
                continue
            
            if text_description_to_skip and meta.get('text_description') == text_description_to_skip:
                continue
              
            distance = distances[0][i]
            similarity_score = 1 - (distance / 2) # Assuming 'distance' is squared L2 from FAISS

            print(f"Cell ID: {meta['id']}, Score: {similarity_score:.4f}, Path: {meta['file_path']}, Desc: {meta['text_description']}, Anno: {meta.get('annotation')}")

            try:
                with Image.open(meta['file_path']) as img:
                    img.thumbnail((256, 256))
                    buffered = io.BytesIO()
                    img_format = "PNG" if meta['file_path'].lower().endswith(".png") else "JPEG"
                    img.save(buffered, format=img_format)
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
            except FileNotFoundError:
                print(f"Error: Cell image file not found at {meta['file_path']}")
            except Exception as e_img:
                print(f"Error processing cell image {meta['file_path']}: {e_img}")

            if len(results) >= top_k:
                break
        
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results
    except Exception as e:
        print(f"Error in find_similar_cells: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
  
def add_image_file_and_update_index(image_bytes, text_description, original_file_extension='.png'):
    """
    Adds an image to the system: saves it, computes its embedding, and updates the FAISS index and metadata.

    Args:
        image_bytes (bytes): The image data in bytes.
        text_description (str): A textual description of the image (including channel info if applicable).
        original_file_extension (str, optional): Original file extension (e.g. '.png', '.jpg')
                                                  to preserve it. Defaults to '.png'.

    Returns:
        dict: A status dictionary indicating success or failure, including the new image's ID.
    """
    global image_index, image_metadata
    try:
        _ensure_dir(_get_image_store_path())
        
        image_id = str(uuid.uuid4())
        stored_image_filename = f"{image_id}{original_file_extension}"
        stored_image_path = os.path.join(_get_image_store_path(), stored_image_filename)

        with open(stored_image_path, 'wb') as f:
            f.write(image_bytes)

        pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_input_processed = preprocess(pil_image).unsqueeze(0).to(device)
        with torch.no_grad():
            image_features = model.encode_image(image_input_processed).cpu().numpy()
        
        image_features_normalized = _normalize_features(image_features)

        if image_index is None:
             image_index = faiss.IndexFlatL2(VECTOR_DIMENSION)

        image_index.add(image_features_normalized.astype(np.float32))
        
        new_metadata_entry = {
            "id": image_id,
            "file_path": stored_image_path,
            "text_description": text_description,
            "timestamp": datetime.now().isoformat()
        }
        image_metadata.append(new_metadata_entry)

        faiss.write_index(image_index, _get_full_path(IMAGE_FAISS_FILENAME))
        with open(_get_full_path(IMAGE_METADATA_FILENAME), 'w') as f:
            json.dump(image_metadata, f, indent=2)

        print(f"Image '{text_description}' (ID: {image_id}, stored as {stored_image_filename}) added. Index size: {image_index.ntotal}")
        return {"status": "success", "message": "Image added.", "id": image_id, "stored_path": stored_image_path}
    except Exception as e:
        print(f"Error adding image: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

def add_cell_file_and_update_index(cell_image_bytes, text_description, annotation="", original_file_extension='.png'):
    """
    Adds a cell image to the system: saves it, computes its embedding, and updates the FAISS index and metadata.

    Args:
        cell_image_bytes (bytes): The cell image data in bytes.
        text_description (str): A textual description of the cell image.
        annotation (str, optional): Any annotation for the cell image.
        original_file_extension (str, optional): Original file extension (e.g. '.png', '.jpg')
                                                  to preserve it. Defaults to '.png'.
    Returns:
        dict: A status dictionary indicating success or failure, including the new cell's ID.
    """
    global cell_index, cell_metadata
    try:
        _ensure_dir(_get_cell_store_path())

        cell_id = str(uuid.uuid4())
        stored_cell_filename = f"{cell_id}{original_file_extension}"
        stored_cell_path = os.path.join(_get_cell_store_path(), stored_cell_filename)
        
        with open(stored_cell_path, 'wb') as f:
            f.write(cell_image_bytes)

        pil_image = Image.open(io.BytesIO(cell_image_bytes)).convert("RGB")
        image_input_processed = preprocess(pil_image).unsqueeze(0).to(device)
        with torch.no_grad():
            cell_features = model.encode_image(image_input_processed).cpu().numpy()

        cell_features_normalized = _normalize_features(cell_features)
            
        if cell_index is None:
            cell_index = faiss.IndexFlatL2(VECTOR_DIMENSION)
            
        cell_index.add(cell_features_normalized.astype(np.float32))

        new_metadata_entry = {
            "id": cell_id,
            "file_path": stored_cell_path,
            "text_description": text_description, 
            "annotation": annotation,
            "timestamp": datetime.now().isoformat()
        }
        cell_metadata.append(new_metadata_entry)

        faiss.write_index(cell_index, _get_full_path(CELL_FAISS_FILENAME))
        with open(_get_full_path(CELL_METADATA_FILENAME), 'w') as f:
            json.dump(cell_metadata, f, indent=2)

        print(f"Cell image '{text_description}' (ID: {cell_id}, stored as {stored_cell_filename}) added. Index size: {cell_index.ntotal}")
        return {"status": "success", "id": cell_id, "stored_path": stored_cell_path}
    except Exception as e:
        print(f"Error saving cell image: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
    
async def start_hypha_service(server, service_id="image-text-similarity-search"):
    service_config = {
        "id": service_id, # Configurable service ID
        "config": {
            "visibility": "public",
            "run_in_executor": True,
            "require_context": False, 
        },
        "hello_world": hello_world,
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
    token = os.getenv("AGENT_LENS_WORKSPACE_TOKEN")
    workspace_name = os.getenv("HYPHA_WORKSPACE", "agent-lens") 

    if not token:
        print("Error: AGENT_LENS_WORKSPACE_TOKEN environment variable not set.")
        return
        
    server = await connect_to_server({
        "server_url": server_url, 
        "token": token, 
        "workspace": workspace_name
    })

    local_server_url = "http://localhost:9527"
    local_token = os.getenv("REEF_LOCAL_TOKEN")
    local_workspace_name = os.getenv("REEF_LOCAL_WORKSPACE")

    local_server = await connect_to_server({
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