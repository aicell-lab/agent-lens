import asyncio
import sqlite3
import numpy as np
import clip
import torch
import dotenv
from PIL import Image
import faiss
import io
import traceback
import os
import base64
from datetime import datetime
import uuid
from src.backend.artifact_manager import ArtifactManager
from src.backend.utils import make_service

dotenv.load_dotenv()

#This code defines a service for performing image similarity searches using CLIP embeddings, FAISS indexing, and a Hypha server connection. 
# The key steps include loading vectors from an SQLite database, separating the vectors by fluorescent channel, building FAISS indices for each channel, and registering a Hypha service to handle similarity search requests. 

# Load the CLIP model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

async def get_artifacts():
    artifact_manager = ArtifactManager()
    await artifact_manager.create_vector_collection(
        name="cell-images",
        manifest={
          "name": "Cell Images",
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
                        "DIM": 384,
                        "DISTANCE_METRIC": "COSINE",
                    },
                },
                {"type": "TEXT", "name": "file_name"},
                {"type": "TEXT", "name": "annotation"},
                {"type": "DATE", "name": "timestamp"},
            ],
            "embedding_models": {
                "vector": "fastembed:BAAI/bge-small-en-v1.5",
            },
       },
    )
    return artifact_manager

async def load_cell_vectors_from_db():
    artifact_manager = await get_artifacts()
    
    cell_ids = []
    cell_vectors = []
    cell_paths = {}
    cell_annotations = {}
    
    vectors = artifact_manager.list_vectors("cell-images")

    for vector in vectors:
        cell_vector = np.frombuffer(vector["vector"], dtype=np.float32)
        cell_ids.append(vector["id"])
        cell_vectors.append(cell_vector)
        cell_paths[vector["id"]] = vector["file_name"]
        cell_annotations[vector["id"]] = vector["annotation"]
    print(f"Loaded {len(cell_ids)} cell vectors")
    print(f"Cell vector shape: {cell_vectors[0].shape}")
    return cell_ids, np.array(cell_vectors) if cell_vectors else None, cell_paths, cell_annotations

def build_faiss_index(vectors):
    d = vectors.shape[1]  # dimension
    print(f"Building FAISS index with {len(vectors)} vectors of dimension {d}")
    faiss_index = faiss.IndexFlatL2(d)
    faiss_index.add(vectors.astype(np.float32))
    return faiss_index
  
async def find_similar_cells(input_cell_image, original_filename=None, top_k=5):
    try:
        cell_ids, cell_vectors, cell_paths, cell_annotations = await load_cell_vectors_from_db()
        
        if cell_vectors is None:
            return {"status": "error", "message": "No cells in database yet"}
        
        # Process input cell image
        image = Image.open(io.BytesIO(input_cell_image)).convert("RGB")
        image_input = preprocess(image).unsqueeze(0).to(device)
        
        with torch.no_grad():
            query_vector = model.encode_image(image_input).cpu().numpy().flatten()
            
        query_vector = query_vector.reshape(1, -1).astype(np.float32)
        
        if query_vector.shape[1] != cell_vectors.shape[1]:
            raise ValueError(f"Dimension mismatch: query vector dim={query_vector.shape[1]}, index dim={cell_vectors.shape[1]}")
        
        cell_index = build_faiss_index(cell_vectors)
        distances, indices = cell_index.search(query_vector, min(top_k + 1, len(cell_ids)))

        results = []
        for i, idx in enumerate(indices[0]):
            cell_id = cell_ids[idx]
            
            # Skip if this is the same image we're searching with
            if original_filename and os.path.basename(cell_paths[cell_id]) == original_filename:
                continue
                
            distance = distances[0][i]
            similarity = 1 - distance

            with Image.open(cell_paths[cell_id]) as img:
                img.thumbnail((256, 256))
                buffered = io.BytesIO()
                img.save(buffered, format="PNG")
                img_str = base64.b64encode(buffered.getvalue()).decode()

            results.append({
                'image': img_str,
                'annotation': cell_annotations[cell_id],
                'similarity': float(similarity)
            })
            
            if len(results) >= top_k:
                break

        return results

    except Exception as e:
        print(f"Error in find_similar_cells: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}

def save_cell_image(cell_image, artifact_manager, annotation=""):
    try:

        # Generate unique filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"cell_{timestamp}_{unique_id}.png"
        # Generate vector from image
        image = Image.open(io.BytesIO(cell_image)).convert("RGB")
        image_input = preprocess(image).unsqueeze(0).to(device)
        with torch.no_grad():
            vector = model.encode_image(image_input).cpu().numpy().flatten()
        
        vector_to_add = {
            "file_name": filename,
            "vector": vector.astype(np.float32).tolist(),
            "annotation": annotation,
            "timestamp": timestamp,
        }
        artifact_manager.add_vectors("cell-images", vector_to_add)
        artifact_manager.add_file("cell-images", filename, cell_image)

        return {"status": "success", "filename": filename}

    except Exception as e:
        print(f"Error saving cell image: {e}")
        traceback.print_exc()
        return {"status": "error", "message": str(e)}
    
async def setup_service(server=None):
    await make_service(
        service={
            "id": "image-embedding-similarity-search",
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
 
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(setup_service())
    loop.run_forever()
