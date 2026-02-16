# Weaviate Service

A wrapper of [Weaviate](https://weaviate.io/) exposed as a Hypha service. Via Hypha it offers virtual collections ("applications"), multi-tenancy style isolation, and fine‑grained permissions while retaining Weaviate's vector, hybrid, and semantic search capabilities.

## ⚠️ Client Setup: Codecs Required

This service take complex objects (like `UUID`s and Weaviate `Object`s). You **must** register custom codecs in your client to handle these responses.

👉 **[See the Codecs Guide](../../codecs.md)** for setup instructions.

## API

### `collections.create(settings: dict)`

Create a new collection.

Verifies that the caller has admin permissions. Adds workspace prefix to collection name before creating it. Creates a collection artifact to track the collection.

**Parameters:**

- `settings` (dict): Collection configuration settings. For a full example configuration, see
[weaviate_bioimage_service](../weaviate_bioimage_service/populate_shared_bioimage_data.py)

**Returns:** The collection configuration with the short collection name

**Example:**

```python
import asyncio
from hypha_rpc import connect_to_server

async def create_collection():
    server = await connect_to_server({"server_url": "https://hypha.aicell.io"})
    weaviate = await server.get_service("weaviate")
    
    settings = {
        "class": "Movie", 
        "description": "A movie collection",
        "properties": [
            {"name": "title", "dataType": ["text"]},
            {"name": "genre", "dataType": ["text"]}
        ]
    }
    
    result = await weaviate.collections.create(settings)
    # Returns collection configuration with short name

asyncio.run(create_collection())
```

### `collections.delete(name: str | list)`

Delete one or multiple collections (admin only). Also removes associated artifacts.

**Parameters:**

- `name` (str | list): Short collection name or list of names to delete

**Returns:** None

**Example:**

```python
await weaviate.collections.delete("Movie")
```

### `collections.list_all()`

List all collections (admin only).

**Parameters:** None

**Returns:** Dict mapping short collection names to their configurations.

**Example:**

```python
collections = await weaviate.collections.list_all()
```

### `collections.get(name: str)`

Get a collection configuration (short name).

**Parameters:**

- `name` (str): Short collection name

**Returns:** Collection configuration dict

**Example:**

```python
movie_cfg = await weaviate.collections.get("Movie")
```

### `collections.get_artifact(collection_name: str)`

Return the artifact id (the full workspace-prefixed collection name).

**Parameters:**

- `collection_name` (str): Short collection name

**Returns:** String artifact id

**Example:**

```python
artifact_id = await weaviate.collections.get_artifact("Movie")
```

### `collections.exists(name: str)`

Check whether a collection exists (both in Weaviate and as an artifact).

**Parameters:**

- `name` (str): Short collection name

**Returns:** bool

**Example:**

```python
if await weaviate.collections.exists("Movie"):
    print("Movie collection ready")
```

### `applications.create(collection_name: str, application_id: str, description: str, user_ws: str | None = None)`

Create a new application within a collection (and tenant if needed).

**Parameters:**

- `collection_name` (str): Collection name
- `application_id` (str): New application id
- `description` (str): Description
- `user_ws` (str, optional): Workspace to own the application (defaults to caller)

**Returns:** Dict with application metadata (ids, artifact_name, owner)

**Example:**

```python
app = await weaviate.applications.create(
    collection_name="Movie",
    application_id="movie-recommender",
    description="Movie recommendation system"
)
```

### `applications.exists(collection_name: str, application_id: str, user_ws: str | None = None)`

Check if an application exists within a collection.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier to check

**Returns:** True if application exists, False otherwise

**Example:**

```python
exists = await weaviate.applications.exists("Movie", "movie-recommender")
```

### `applications.get_artifact(collection_name: str, application_id: str)`

Get the artifact id for an application (string).

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier

**Returns:** String artifact id

**Example:**

```python
artifact = await weaviate.applications.get_artifact("Movie", "movie-recommender")
```

### `applications.set_permissions(collection_name: str, application_id: str, permissions: dict, user_ws: str = None, merge: bool = True)`

Set permissions for an application.

Updates the application artifact with the provided permissions. Verifies that the caller has permission to access the application.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `permissions` (dict): Dictionary of permissions to set
- `user_ws` (str, optional): User workspace
- `merge` (bool): Whether to merge with existing permissions (default: True)

**Returns:** None

**Example:**

```python
await weaviate.applications.set_permissions(
    collection_name="Movie",
    application_id="movie-recommender",
    permissions={"user123": "r", "admin": "wr"}
)
# No return value - permissions updated successfully
```

### `applications.delete(collection_name: str, application_id: str)`

Delete an application and all its associated data from a collection.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier

**Returns:** Deletion result

**Example:**

```python
result = await weaviate.applications.delete(
    collection_name="Movie",
    application_id="movie-recommender"
)
```

### `applications.get(collection_name: str, application_id: str)`

Get metadata and artifact information for an application.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier

**Returns:** Application metadata and artifact information

**Example:**

```python
result = await weaviate.applications.get(
    collection_name="Movie",
    application_id="movie-recommender"
)
```

### `data.insert_many(collection_name: str, application_id: str, objects: list, *, enable_chunking: bool = False, chunk_size: int = 512, chunk_overlap: int = 50, text_field: str = "text")`

Insert multiple objects (optional text chunking).

**Parameters:**

- `collection_name` (str)
- `application_id` (str)
- `objects` (list[dict])
- `enable_chunking` (bool)
- `chunk_size` (int)
- `chunk_overlap` (int)
- `text_field` (str)

**Returns:** Dict with insertion summary

**Example:**

```python
objects = [
    {"title": "The Matrix", "genre": "Sci-Fi"},
    {"title": "Inception", "genre": "Sci-Fi"},
]
res = await weaviate.data.insert_many(
    "Movie",
    "movie-recommender",
    objects,
)
print(res["uuids"])
```

### `data.insert(collection_name: str, application_id: str, properties: dict, *, enable_chunking: bool = False, chunk_size: int = 512, chunk_overlap: int = 50, text_field: str = "text", **kwargs)`

Insert a single object (optional chunking). Returns UUID of inserted object (or first chunk).

**Parameters:**

- `collection_name` (str)
- `application_id` (str)
- `properties` (dict)
- `enable_chunking` / `chunk_size` / `chunk_overlap` / `text_field`
- `**kwargs`: Passed to underlying insert (e.g. `uuid`)

**Returns:** UUID

**Example:**

```python
uuid_ = await weaviate.data.insert(
    "Movie",
    "movie-recommender",
    {"title": "Interstellar", "genre": "Sci-Fi"},
)
```

### `data.update(collection_name: str, application_id: str, **kwargs)`

Update an object (pass `uuid` and `properties` in kwargs).

**Parameters:**

- `collection_name` (str)
- `application_id` (str)
- `uuid` (str) via kwargs
- `properties` (dict) via kwargs
- Other weaviate update kwargs as needed

**Returns:** None

**Example:**

```python
await weaviate.data.update(
    "Movie",
    "movie-recommender",
    uuid="<object-uuid>",
    properties={"genre": "Action"},
)
```

### `data.delete_by_id(collection_name: str, application_id: str, uuid: str)`

Delete an object by UUID from a collection for a given application.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `uuid` (str): UUID of the object to delete

**Returns:** None

**Example:**

```python
await weaviate.data.delete_by_id(
    collection_name="Movie",
    application_id="movie-recommender",
    uuid="<object-uuid>"
)
```

### `data.delete_many(collection_name: str, application_id: str, where: Filter | None = None, **kwargs)`

Delete multiple objects matching a filter. `where` is ANDed with internal application filter.

**Parameters:**

- `collection_name` (str)
- `application_id` (str)
- `where` (Filter | None)
- `**kwargs` (e.g. `dry_run`, `output`)

**Returns:** Dict with `failed`, `matches`, `objects`, `successful`

**Example:**

```python
from weaviate.classes.query import Filter

summary = await weaviate.data.delete_many(
    "Movie",
    "movie-recommender",
    where=Filter.by_property("genre").equal("Sci-Fi"),
)
```

### `data.exists(collection_name: str, application_id: str, uuid: str)`

Check if an object exists in a collection for a given application by UUID.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `uuid` (str): UUID of the object to check

**Returns:** True if the object exists, False otherwise

**Example:**

```python
exists = await weaviate.data.exists(
    collection_name="Movie",
    application_id="movie-recommender",
    uuid="<object-uuid>"
)
```

## Query Methods

### `query.fetch_objects(collection_name: str, application_id: str, filters: Filter = None, limit: int = 100, **kwargs)`

Fetch objects with optional filters (internally constrained by application).

**Parameters:**

- `collection_name` (str)
- `application_id` (str)
- `filters` (Filter | None)
- `limit` (int)
- `**kwargs`: Extra fetch options

**Returns:** Dict with `objects`

**Example:**

```python
from weaviate.classes.query import Filter

result = await weaviate.query.fetch_objects(
    collection_name="Movie",
    application_id="movie-recommender",
    filters=Filter.by_property("genre").equal("Sci-Fi"),
    limit=10,
)
print(len(result["objects"]))
```

### `query.hybrid(collection_name: str, application_id: str, query: str, filters: Filter = None, limit: int = 10, **kwargs)`

Hybrid (vector + keyword) search. Returns dict with `objects`.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `query` (str): Search query
- `filters` (Filter, optional): Weaviate filter conditions
- `limit` (int): Maximum number of results (default: 10)
- `**kwargs`: Additional arguments, including `return_metadata`

**Returns:** Hybrid search results

**Metadata Note:**
You can request specific metadata fields using the `return_metadata` argument (e.g., `{"distance": True}`). By default, no additional metadata is returned.

**Example:**

```python
result = await weaviate.query.hybrid(
    collection_name="Movie",
    application_id="movie-recommender", 
    query="science fiction movies",
    return_metadata={"score": True, "explain_score": True},
    limit=5
)
```

### `query.near_vector(collection_name: str, application_id: str, near_vector: list[float], target_vector: str | None = None, include_vector: bool = False, filters: Filter = None, limit: int = 10, **kwargs)`

Vector similarity search. Returns dict with `objects`.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `near_vector` (list[float]): Query vector
- `target_vector` (str, optional): Named vector field to search
- `include_vector` (bool): Include vectors in response
- `filters` (Filter, optional): Filter conditions
- `limit` (int): Max results (default 10)
- `return_metadata` (dict, optional): Dictionary specifying metadata fields to return (e.g., `{"distance": True}`).
- `**kwargs`: Additional weaviate near_vector kwargs

**Returns:** Dict with `objects`

**Metadata Behavior:**
The `return_metadata` parameter allows you to specify exactly which metadata fields you want included in the response (e.g. distance, score, creation_time). If not provided, no metadata is returned by default.

**Example:**

```python
result = await weaviate.query.near_vector(
    collection_name="Movie",
    application_id="movie-recommender",
    near_vector=[0.1, 0.2, 0.3],
    target_vector="title_vector",
    include_vector=False,
    return_metadata={"distance": True},
    limit=5,
)
```

### `generate.near_text(collection_name: str, application_id: str, query: str, single_prompt: str = None, grouped_task: str = None, filters: Filter = None, limit: int = 10, **kwargs)`

Generate content (retrieval augmented). Returns dict with `objects` and `generated` text.

⚠️ **Performance Warning**: This method can be slow and may time out for large datasets or complex generation tasks. Consider using other query methods as input to an LLM for generation.

**Parameters:**

- `collection_name` (str): Name of the collection
- `application_id` (str): Application identifier
- `query` (str): Search query
- `single_prompt` (str, optional): Template for individual object responses
- `grouped_task` (str, optional): Task description for grouped response
- `filters` (Filter, optional): Weaviate filter conditions
- `limit` (int): Maximum number of results (default: 10)
- `return_metadata` (dict, optional): Dictionary specifying metadata fields to return.
- `**kwargs`: Additional arguments

**Returns:** Generated text response with source objects

**Metadata Note:**
Like other query methods, this supports `return_metadata` to request specific fields (e.g., `{"distance": True}`).

**Example:**

```python
result = await weaviate.generate.near_text(
    collection_name="Movie",
    application_id="movie-recommender",
    query="What are good sci-fi movies?",
    grouped_task="Recommend science fiction movies based on the data",
    return_metadata={"distance": True},
    limit=5,
)
print(result["generated"])  # RAG answer
```
