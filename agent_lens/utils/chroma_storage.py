"""
ChromaDB storage service for Agent-Lens cell data.
Provides local, in-process vector database for cell images and embeddings.
"""

import chromadb
from chromadb.config import Settings
from typing import List, Dict, Any, Optional
import uuid as uuid_lib
from agent_lens.log import setup_logging

logger = setup_logging("agent_lens_chroma_storage.log")


class ChromaCellStorage:
    """Local ChromaDB storage for cell images and embeddings."""
    
    def __init__(self, persist_directory: str = "./chroma_cell_data"):
        """
        Initialize ChromaDB client with persistent storage.
        
        Args:
            persist_directory: Path to store ChromaDB data (default: ./chroma_cell_data)
        """
        self.persist_directory = persist_directory
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )
        logger.info(f"ChromaDB client initialized with storage at: {persist_directory}")
    
    def reset_application(self, application_id: str) -> Dict[str, Any]:
        """
        Delete all cells for a specific application.
        
        Args:
            application_id: Application ID to reset (e.g., "hypha-agents-notebook")
            
        Returns:
            dict: {
                "success": bool,
                "deleted_count": int,
                "application_id": str,
                "message": str
            }
        """
        try:
            collection = self.client.get_collection(application_id)
            count = collection.count()
            self.client.delete_collection(application_id)
            logger.info(f"Deleted collection '{application_id}' with {count} cells")
            return {
                "success": True,
                "deleted_count": count,
                "application_id": application_id,
                "message": f"Deleted {count} cells from application '{application_id}'"
            }
        except Exception as e:
            # Collection doesn't exist - this is fine
            logger.info(f"Collection '{application_id}' did not exist (no cleanup needed)")
            return {
                "success": True,
                "deleted_count": 0,
                "application_id": application_id,
                "message": f"Collection '{application_id}' did not exist"
            }
    
    def insert_cells(self, application_id: str, cells: List[Dict]) -> Dict[str, Any]:
        """
        Batch insert cells with embeddings and metadata.
        
        Args:
            application_id: Application ID (collection name)
            cells: List of cell dictionaries with:
                - uuid: Cell UUID (optional, will be generated if missing)
                - image_id: Image identifier
                - image: Base64 encoded cell image
                - dino_embedding: DINO embedding vector (required)
                - area, perimeter, etc.: Morphology metadata
        
        Returns:
            dict: {
                "success": bool,
                "inserted_count": int,
                "uuids": dict mapping image_id to uuid
            }
        """
        try:
            collection = self.client.get_or_create_collection(
                name=application_id,
                metadata={"description": "Cell morphology data with embeddings"}
            )
            
            ids = []
            embeddings = []
            metadatas = []
            documents = []
            uuid_mapping = {}
            
            for cell in cells:
                # Generate or use existing UUID
                cell_id = cell.get("uuid") or str(uuid_lib.uuid4())
                ids.append(cell_id)
                
                # Extract embedding (required)
                embedding = cell.get("dino_embedding")
                if not embedding:
                    raise ValueError(f"Cell missing dino_embedding: {cell.get('image_id', 'unknown')}")
                embeddings.append(embedding)
                
                # Store morphology metadata (filter out None values)
                metadata = {
                    "area": cell.get("area"),
                    "perimeter": cell.get("perimeter"),
                    "equivalent_diameter": cell.get("equivalent_diameter"),
                    "bbox_width": cell.get("bbox_width"),
                    "bbox_height": cell.get("bbox_height"),
                    "aspect_ratio": cell.get("aspect_ratio"),
                    "circularity": cell.get("circularity"),
                    "eccentricity": cell.get("eccentricity"),
                    "solidity": cell.get("solidity"),
                    "convexity": cell.get("convexity"),
                }
                # ChromaDB doesn't like None values in metadata
                metadata = {k: v for k, v in metadata.items() if v is not None}
                metadatas.append(metadata)
                
                # Store base64 image as document
                documents.append(cell.get("image", ""))
                
                # Track UUID mapping
                image_id = cell.get("image_id", f"cell_{len(ids)-1}")
                uuid_mapping[image_id] = cell_id
            
            # Batch insert all cells at once
            collection.add(
                ids=ids,
                embeddings=embeddings,
                metadatas=metadatas,
                documents=documents
            )
            
            logger.info(f"Inserted {len(ids)} cells into collection '{application_id}'")
            
            return {
                "success": True,
                "inserted_count": len(ids),
                "uuids": uuid_mapping
            }
            
        except Exception as e:
            logger.error(f"Failed to insert cells: {e}")
            raise
    
    def fetch_by_uuids(self, application_id: str, uuids: List[str], 
                       include_embeddings: bool = False) -> List[Dict[str, Any]]:
        """
        Batch fetch cells by UUIDs.
        
        Args:
            application_id: Application ID (collection name)
            uuids: List of cell UUIDs to fetch
            include_embeddings: Whether to include DINO embedding vectors
            
        Returns:
            List of cell dictionaries with uuid, image, metadata, and optionally embeddings
        """
        try:
            collection = self.client.get_collection(application_id)
            
            # Specify what to include in results
            include_list = ["documents", "metadatas"]
            if include_embeddings:
                include_list.append("embeddings")
            
            # Batch fetch all cells at once
            results = collection.get(ids=uuids, include=include_list)
            
            # Convert to list of cell dictionaries
            cells = []
            for i, uuid_val in enumerate(results["ids"]):
                cell = {
                    "uuid": uuid_val,
                    "image": results["documents"][i] if i < len(results["documents"]) else "",
                }
                
                # Add metadata fields
                if i < len(results["metadatas"]):
                    cell.update(results["metadatas"][i])
                
                # Add embedding if requested
                if include_embeddings and "embeddings" in results and i < len(results["embeddings"]):
                    cell["dino_embedding"] = results["embeddings"][i]
                
                cells.append(cell)
            
            logger.info(f"Fetched {len(cells)} cells from collection '{application_id}'")
            return cells
            
        except Exception as e:
            logger.error(f"Failed to fetch cells: {e}")
            raise
    
    def similarity_search(self, application_id: str, query_embedding: List[float],
                         n_results: int = 10, where_filter: Optional[Dict] = None) -> Dict[str, Any]:
        """
        Vector similarity search with optional metadata filtering.
        
        Args:
            application_id: Application ID (collection name)
            query_embedding: Query embedding vector
            n_results: Number of results to return
            where_filter: Optional metadata filter (e.g., {"area": {"$gt": 100}})
            
        Returns:
            dict with keys: ids, distances, metadatas, documents, embeddings
        """
        try:
            collection = self.client.get_collection(application_id)
            
            # Query with optional filtering
            results = collection.query(
                query_embeddings=[query_embedding],
                n_results=n_results,
                where=where_filter,  # Native metadata filtering!
                include=["documents", "metadatas", "distances", "embeddings"]
            )
            
            logger.info(f"Similarity search in '{application_id}' returned {len(results['ids'][0])} results")
            return results
            
        except Exception as e:
            logger.error(f"Similarity search failed: {e}")
            raise
    
    def get_collection_count(self, application_id: str) -> int:
        """
        Get the number of cells in a collection.
        
        Args:
            application_id: Application ID (collection name)
            
        Returns:
            Number of cells in the collection
        """
        try:
            collection = self.client.get_collection(application_id)
            return collection.count()
        except Exception:
            return 0
    
    def list_collections(self) -> List[str]:
        """
        List all collection names.
        
        Returns:
            List of collection names (application IDs)
        """
        try:
            collections = self.client.list_collections()
            return [c.name for c in collections]
        except Exception as e:
            logger.error(f"Failed to list collections: {e}")
            return []


# Global instance for use in frontend service
chroma_storage = ChromaCellStorage(persist_directory="./chroma_cell_data")
