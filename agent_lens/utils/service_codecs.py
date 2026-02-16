"""Weaviate collection codecs for Hypha RPC serialization.

This module provides encoder and decoder functions for Weaviate collection objects,
allowing them to be serialized and transferred through Hypha RPC.
"""

import uuid
from dataclasses import asdict
from datetime import datetime
from typing import Any

from hypha_rpc.rpc import RemoteService
from hypha_rpc.utils.pydantic import create_model_from_schema
from pydantic import BaseModel
from weaviate.collections.classes.filters import (
    _FilterValue,  # type: ignore[reportPrivateUsage]
)
from weaviate.collections.classes.internal import Object


def encode_uuid(obj: uuid.UUID) -> str:
    """Encode UUID to string."""
    return obj.hex


def encode_object(obj: Object[object, object]) -> dict[str, object]:
    """Encode Weaviate Object to dictionary."""
    return {
        "uuid": obj.uuid.hex,
        "vector": obj.vector,
        "properties": obj.properties,
        "metadata": obj.metadata and asdict(obj.metadata),
        "collection": obj.collection,
    }


def _datetime_encoder(dt: datetime) -> str:
    """Encode datetime to ISO format string."""
    return dt.isoformat()


def register_weaviate_codecs(server: RemoteService) -> None:
    """Register all Weaviate codecs with the Hypha server."""
    server.register_codec(
        {
            "name": "uuid-uuid",
            "type": uuid.UUID,
            "encoder": encode_uuid,
            "decoder": uuid.UUID,
        },
    )

    # Override the built-in Pydantic codec to handle _FilterValue specially
    def custom_pydantic_encoder(obj: BaseModel) -> dict[str, object]:
        """Encode pydantic model with special case _FilterValue."""
        if isinstance(obj, _FilterValue):
            # Use model_dump("json") as suggested by maintainer
            return {
                "_rtype": "pydantic_model",
                "_rvalue": obj.model_dump(mode="json"),
                "_rschema": obj.model_json_schema(),
                "_special_filter": True,
            }

        return {
            "_rtype": "pydantic_model",
            "_rvalue": obj.model_dump(mode="json"),
            "_rschema": obj.model_json_schema(),
        }

    def custom_pydantic_decoder(encoded_obj: dict[str, Any]) -> BaseModel:
        """Decode pydantic model with special case _FilterValue."""
        if encoded_obj.get("_special_filter"):
            # Reconstruct _FilterValue specifically if needed, or generic model
            pass

        model_type = create_model_from_schema(encoded_obj["_rschema"])
        return model_type(**encoded_obj["_rvalue"])

    server.register_codec(
        {
            "name": "pydantic_model",
            "type": BaseModel,
            "encoder": custom_pydantic_encoder,
            "decoder": custom_pydantic_decoder,
        },
    )

    server.register_codec(
        {
            "name": "weaviate_object",
            "type": Object,
            "encoder": encode_object,
        },
    )

    server.register_codec(
        {
            "name": "datetime-datetime",
            "type": datetime,
            "encoder": _datetime_encoder,
            "decoder": datetime.fromisoformat,
        },
    )
