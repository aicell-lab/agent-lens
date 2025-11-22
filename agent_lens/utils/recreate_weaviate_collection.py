#!/usr/bin/env python3
"""
Temporary script to recreate the Weaviate collection with new morphology properties.
Run once, then delete this file.

Usage:
    export HYPHA_AGENTS_TOKEN=your_token
    python recreate_weaviate_collection.py
"""

import asyncio
import os
from hypha_rpc import connect_to_server

# Configuration
WEAVIATE_SERVER_URL = "https://hypha.aicell.io"
WEAVIATE_WORKSPACE = "hypha-agents"
WEAVIATE_SERVICE_NAME = "weaviate"
COLLECTION_NAME = "Agentlens"


async def recreate_collection():
    """Delete and recreate the Agentlens collection with new schema."""
    
    # Get token from environment
    token = os.getenv("HYPHA_AGENTS_TOKEN")
    if not token:
        print("❌ Error: HYPHA_AGENTS_TOKEN environment variable not set")
        print("   Please set it with: export HYPHA_AGENTS_TOKEN=your_token")
        return
    
    print(f"🔌 Connecting to Weaviate service at {WEAVIATE_SERVER_URL}...")
    
    try:
        # Connect to Hypha server
        server = await connect_to_server({
            "server_url": WEAVIATE_SERVER_URL,
            "workspace": WEAVIATE_WORKSPACE,
            "token": token
        })
        
        # Get Weaviate service
        weaviate_service = await server.get_service(WEAVIATE_SERVICE_NAME, mode="first")
        print("✅ Connected to Weaviate service")
        
        # Check if collection exists
        exists = await weaviate_service.collections.exists(COLLECTION_NAME)
        
        if exists:
            print(f"⚠️  Collection '{COLLECTION_NAME}' exists. Deleting...")
            await weaviate_service.collections.delete(COLLECTION_NAME)
            print(f"✅ Deleted collection '{COLLECTION_NAME}'")
        else:
            print(f"ℹ️  Collection '{COLLECTION_NAME}' does not exist")
        
        # Create new collection with updated schema
        print(f"🔨 Creating collection '{COLLECTION_NAME}' with new schema...")
        
        collection_settings = {
            "class": COLLECTION_NAME,
            "description": "Microscopy images with cell morphology measurements",
            "properties": [
                {"name": "image_id", "dataType": ["text"]},
                {"name": "description", "dataType": ["text"]},
                {"name": "metadata", "dataType": ["text"]},
                {"name": "dataset_id", "dataType": ["text"]},
                {"name": "file_path", "dataType": ["text"]},
                {"name": "preview_image", "dataType": ["blob"]},  # Base64 encoded 50x50 preview
                {"name": "tag", "dataType": ["text"]},  # Tag field for categorization
                # Cell morphology measurements for downstream analysis
                {"name": "area", "dataType": ["number"]},  # Cell area in pixels
                {"name": "perimeter", "dataType": ["number"]},  # Cell perimeter in pixels
                {"name": "equivalent_diameter", "dataType": ["number"]},  # Diameter of circle with same area in pixels
                {"name": "bbox_width", "dataType": ["number"]},  # Bounding box width in pixels
                {"name": "bbox_height", "dataType": ["number"]},  # Bounding box height in pixels
                {"name": "aspect_ratio", "dataType": ["number"]},  # Major axis / minor axis (elongation)
                {"name": "circularity", "dataType": ["number"]},  # 4πA / P² (roundness)
                {"name": "eccentricity", "dataType": ["number"]},  # 0 = circle, → 1 elongated
                {"name": "solidity", "dataType": ["number"]},  # Area / convex hull area
                {"name": "convexity", "dataType": ["number"]}  # Smoothness of boundary
            ],
            "vectorizer": "none"  # We'll provide vectors manually
        }
        
        result = await weaviate_service.collections.create(collection_settings)
        print(f"✅ Created collection '{COLLECTION_NAME}' with morphology properties")
        print(f"   Result: {result}")
        
        # Disconnect
        await server.disconnect()
        print("✅ Done! Collection recreated successfully")
        print("\n⚠️  Note: All previous data in this collection has been deleted.")
        print("   You will need to re-insert your annotations.")
        print("\n💡 You can now delete this script file: recreate_collection.py")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(recreate_collection())

