import asyncio
from hypha_rpc import connect_to_server, login
import sqlite3
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

#This code defines a service for performing image similarity searches using CLIP embeddings, FAISS indexing, and a Hypha server connection. 
# The key steps include loading vectors from an SQLite database, separating the vectors by fluorescent channel, building FAISS indices for each channel, and registering a Hypha service to handle similarity search requests. 

# Load the CLIP model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

# Connect to the SQLite database

def get_cell_db_connection():
  conn = sqlite3.connect('cell_vectors_db.db')
  # Create table if it doesn't exist
  conn.execute('''
      CREATE TABLE IF NOT EXISTS cell_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_name TEXT NOT NULL,
          vector BLOB NOT NULL,
          annotation TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
  ''')
  return conn, conn.cursor()


def load_cell_vectors_from_db():
    conn, c = get_cell_db_connection()
    c.execute('SELECT id, vector, file_name, annotation FROM cell_images')
    rows = c.fetchall()
    conn.close()

    cell_ids = []
    cell_vectors = []
    cell_paths = {}
    cell_annotations = {}

    for row in rows:
        cell_id, cell_vector, file_name, annotation = row
        cell_vector = np.frombuffer(cell_vector, dtype=np.float32)
        cell_ids.append(cell_id)
        cell_vectors.append(cell_vector)
        cell_paths[cell_id] = os.path.join('cell_vectors_db', file_name)
        cell_annotations[cell_id] = annotation
    print(f"Loaded {len(cell_ids)} cell vectors")
    print(f"Cell vector shape: {cell_vectors[0].shape}")
    return cell_ids, np.array(cell_vectors) if cell_vectors else None, cell_paths, cell_annotations

def build_faiss_index(vectors):
    d = vectors.shape[1]  # dimension
    print(f"Building FAISS index with {len(vectors)} vectors of dimension {d}")
    index = faiss.IndexFlatL2(d)
    index.add(vectors.astype(np.float32))
    return index

  
def find_similar_cells(input_cell_image, original_filename=None, top_k=5):
  try:
      cell_ids, cell_vectors, cell_paths, cell_annotations = load_cell_vectors_from_db()
      
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
  

def save_cell_image(cell_image, mask=None, annotation=""):
  try:

      # Generate unique filename with timestamp
      timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
      unique_id = str(uuid.uuid4())[:8]
      filename = f"cell_{timestamp}_{unique_id}.png"
      
      # Save image file
      os.makedirs('cell_vectors_db', exist_ok=True)
      file_path = os.path.join('cell_vectors_db', filename)
      with open(file_path, 'wb') as f:
          f.write(cell_image)

      # Generate vector from image
      image = Image.open(io.BytesIO(cell_image)).convert("RGB")
      image_input = preprocess(image).unsqueeze(0).to(device)
      with torch.no_grad():
          vector = model.encode_image(image_input).cpu().numpy().flatten()

      # Save to database
      conn, c = get_cell_db_connection()
      c.execute(
          'INSERT INTO cell_images (file_name, vector, annotation) VALUES (?, ?, ?)',
          (filename, vector.astype(np.float32).tobytes(), annotation)
      )
      conn.commit()
      conn.close()

      return {"status": "success", "filename": filename}

  except Exception as e:
      print(f"Error saving cell image: {e}")
      traceback.print_exc()
      return {"status": "error", "message": str(e)}
    
async def start_hypha_service(server):
    await server.register_service(
        {
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
    )

async def setup():
    server_url = "https://hypha.aicell.io"
    token = await login({"server_url": server_url})
    server = await connect_to_server({"server_url": server_url, "token": token})
    await start_hypha_service(server)
    print(f"Image embedding and similarity search service registered at workspace: {server.config.workspace}")
    print(f"Test it with the HTTP proxy: {server_url}/{server.config.workspace}/services/image-embedding-similarity-search")
 
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(setup())
    loop.run_forever()
