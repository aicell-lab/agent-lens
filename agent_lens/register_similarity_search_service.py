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
from dotenv import find_dotenv, load_dotenv
ENV_FILE = find_dotenv()
if ENV_FILE:
    load_dotenv(ENV_FILE)

#This code defines a service for performing image similarity searches using CLIP embeddings, FAISS indexing, and a Hypha server connection. 
# The key steps include loading vectors from an SQLite database, separating the vectors by fluorescent channel, building FAISS indices for each channel, and registering a Hypha service to handle similarity search requests. 

# Load the CLIP model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, preprocess = clip.load("ViT-B/32", device=device)

# Connect to the SQLite database
def get_db_connection():
    conn = sqlite3.connect('cell_vectors_db.db')
    # Create table if it doesn't exist
    conn.execute('''
        CREATE TABLE IF NOT EXISTS images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vector BLOB NOT NULL,
            image_path TEXT NOT NULL,
            fluorescent_channel TEXT
        )
    ''')
    return conn, conn.cursor()

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

def load_vectors_from_db(channel=None):
    conn, c = get_db_connection()
    query = 'SELECT id, vector, image_path, fluorescent_channel FROM images'
    if channel:
        query += f" WHERE fluorescent_channel = '{channel}'"
    c.execute(query)
    rows = c.fetchall()
    conn.close()

    image_ids = []
    image_vectors = []
    image_paths = {}
    image_channels = {}

    for row in rows:
        img_id, img_vector, img_path, img_channel = row
        img_vector = np.frombuffer(img_vector, dtype=np.float32)
        image_ids.append(img_id)
        image_vectors.append(img_vector)
        image_paths[img_id] = img_path
        image_channels[img_id] = img_channel
    
    print(f"Loaded {len(image_ids)} image vectors")
    if len(image_vectors) > 0:
        print(f"Image vector shape: {image_vectors[0].shape}")
    else:
        print("No images found in database")
    
    return image_ids, np.array(image_vectors) if image_vectors else np.array([]), image_paths, image_channels

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
    if len(vectors) == 0:
        # Return an empty index with the expected dimension (512 for ViT-B/32)
        d = 512
        print(f"Creating empty FAISS index with dimension {d}")
        return faiss.IndexFlatL2(d)
    
    d = vectors.shape[1]  # dimension
    print(f"Building FAISS index with {len(vectors)} vectors of dimension {d}")
    index = faiss.IndexFlatL2(d)
    index.add(vectors.astype(np.float32))
    return index

# Load vectors and build FAISS index based on the channel
image_ids, image_vectors, image_paths, image_channels = load_vectors_from_db()
print(f"Loaded {len(image_ids)} image vectors")
if len(image_vectors) > 0:
    print(f"Image vector shape: {image_vectors[0].shape}")
else:
    print("No images found in database")

# Initialize FAISS index
index = build_faiss_index(image_vectors)

"""
Precompute separate FAISS indices for each channel at the time of building the indices.
Use the appropriate index based on the channel extracted from the input image name.
"""

def separate_indices_by_channel(image_vectors, image_channels):
    indices = {}
    if len(image_vectors) == 0:
        print("No vectors to build channel indices")
        return indices
        
    image_channel_info = image_channels.values()
    for channel in set(image_channel_info):
        channel_vectors = [image_vectors[i] for i, c in enumerate(image_channel_info) if c == channel]
        if len(channel_vectors) > 0:
            indices[channel] = build_faiss_index(np.array(channel_vectors))
            print(f"Built index for channel: {channel}, the length of channel_vectors is {len(channel_vectors)}")
    return indices

channel_indices = separate_indices_by_channel(image_vectors, image_channels)

def find_similar_images(input_image,image_data, top_k=5, index=index):
    input_image_name=image_data['name']
    try:
        channel = None
        if '-' in input_image_name:
            'image-green.png'
            ['image','green.png']
            'green.png'
            ['green', 'png']
            'green'
             
            channel = input_image_name.split('-')[1].split('.')[0]

        # Convert input bytes to an image
        image = Image.open(io.BytesIO(input_image)).convert("RGB")

        # Process the image
        image_input = preprocess(image).unsqueeze(0).to(device)
        with torch.no_grad():
            query_vector = model.encode_image(image_input).cpu().numpy().flatten()

        print(f"Query vector shape: {query_vector.shape}")
        
        query_vector = np.expand_dims(query_vector, axis=0).astype(np.float32)


        distances, indices = index.search(query_vector, len(image_ids))  # Search all images

        # Collect and sort results
        results = []
        for i, idx in enumerate(indices[0]):
            img_id = image_ids[idx]
            distance = distances[0][i]
            sim = 1 - distance  # Convert distance to similarity
            print(f"ID: {img_id}, Score: {sim:.2f}")
            print(f"Image path: {image_paths[img_id]}")
            print(f"Fluorescent channel: {image_channels[img_id]}")
            print("---")
            
            # Open the image, resize it, and convert to base64
            with Image.open(image_paths[img_id]) as img:
                img.thumbnail((512, 512))  # Resize image to max 512x512 while maintaining aspect ratio
                buffered = io.BytesIO()
                img.save(buffered, format="JPEG")
                img_str = base64.b64encode(buffered.getvalue()).decode()
            
            results.append({
                'image': img_str,
                'image_path': image_paths[img_id],
                'fluorescent_channel': image_channels[img_id],
                'similarity': float(sim)
            })
            if len(results) >= top_k:
                break
        
        return results
    except Exception as e:
        print(f"Error processing image: {e}")
        traceback.print_exc()
        return []
  
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
  
def add_image_to_db(image_bytes, image_name, image_channel, image_folder='images'):
  try:
      # Ensure the image folder exists
      os.makedirs(image_folder, exist_ok=True)

      # Save the image to the specified folder
      image_path = os.path.join(image_folder, image_name)
      with open(image_path, 'wb') as f:
          f.write(image_bytes)

      # Open and preprocess the image
      image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
      image_input = preprocess(image).unsqueeze(0).to(device)

      # Compute the image embedding
      with torch.no_grad():
          image_vector = model.encode_image(image_input).cpu().numpy().flatten()

      # Connect to the database and insert the new image data
      conn, c = get_db_connection()
      c.execute(
          'INSERT INTO images (vector, image_path, fluorescent_channel) VALUES (?, ?, ?)',
          (image_vector.tobytes(), image_path, image_channel)
      )
      conn.commit()
      conn.close()

      # Update the FAISS index
      global image_ids, image_vectors, image_paths, image_channels, index, channel_indices
      image_ids.append(c.lastrowid)
      image_vectors = np.vstack([image_vectors, image_vector])
      image_paths[c.lastrowid] = image_path
      image_channels[c.lastrowid] = image_channel

      # Rebuild the FAISS index
      index = build_faiss_index(image_vectors)
      channel_indices = separate_indices_by_channel(image_vectors, image_channels)

      print(f"Image {image_name} added successfully.")
      return {"status": "success", "message": f"Image {image_name} added successfully."}
  except Exception as e:
      print(f"Error adding image: {e}")
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
            "find_similar_images": find_similar_images,
            "add_image_to_db": add_image_to_db,
            "find_similar_cells": find_similar_cells,
            "save_cell_image": save_cell_image,
        },
    )

async def setup():
    server_url = "https://hypha.aicell.io"
    token = os.getenv("AGENT_LENS_WORKSPACE_TOKEN")
    server = await connect_to_server({"server_url": server_url, "token": token, "workspace": "agent-lens"})
    await start_hypha_service(server)
    print(f"Image embedding and similarity search service registered at workspace: {server.config.workspace}")
    print(f"Test it with the HTTP proxy: {server_url}/{server.config.workspace}/services/image-embedding-similarity-search")
 
if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(setup())
    loop.run_forever()