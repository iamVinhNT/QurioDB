"""
mongo_provider.py

Metadata provider for MongoDB databases.
"""

import logging
from typing import List, Dict, Any, Optional

import pymongo
from services.ai.mongodb_query import redact_mongo_sensitive_text

logger = logging.getLogger(__name__)

MONGO_METADATA_TIMEOUT_SECONDS = 30
MONGO_METADATA_TIMEOUT_MS = MONGO_METADATA_TIMEOUT_SECONDS * 1000

class MongoMetadataProvider:
    """Handles metadata extraction for MongoDB collections and databases."""

    def __init__(self, service):
        self.service = service

    def get_schemas(self, db_id: str, session) -> List[str]:
        """Lists all database names in the MongoDB cluster."""
        try:
            client, _ = self.service.get_mongo_client(db_id, session)
            if not client:
                return []
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                return client.list_database_names()
        except Exception as exc:
            logger.error(
                "Error listing MongoDB databases: %s",
                redact_mongo_sensitive_text(exc),
            )
            return []

    def get_tables(self, db_id: str, schema: str, session) -> List[str]:
        """Lists all non-system collections in a specific MongoDB database."""
        try:
            client, default_db = self.service.get_mongo_client(db_id, session)
            if not client:
                return []
            target_db = schema if schema and schema != 'public' else default_db
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                all_names = client[target_db].list_collection_names(
                    maxTimeMS=MONGO_METADATA_TIMEOUT_MS
                )
                collections_info = list(
                    client[target_db].list_collections(maxTimeMS=MONGO_METADATA_TIMEOUT_MS)
                )
            view_names = [c['name'] for c in collections_info if c.get('type') == 'view']
            return [name for name in all_names if name not in view_names and not name.startswith('system.')]
        except Exception as exc:
            logger.error(
                "Error listing MongoDB collections: %s",
                redact_mongo_sensitive_text(exc),
            )
            return []

    def get_views(self, db_id: str, schema: str, session) -> List[str]:
        """Lists all views in a specific MongoDB database."""
        try:
            client, default_db = self.service.get_mongo_client(db_id, session)
            if not client:
                return []
        except Exception as exc:
            logger.error("Error listing MongoDB views: %s", redact_mongo_sensitive_text(exc))
            return []

        target_db = schema if schema and schema != 'public' else default_db
        try:
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                collections = list(client[target_db].list_collections(maxTimeMS=MONGO_METADATA_TIMEOUT_MS))
            return [c['name'] for c in collections if c.get('type') == 'view']
        except Exception as e:
            logger.error("Error listing MongoDB views: %s", redact_mongo_sensitive_text(e))
            return []

    def get_columns(self, db_id: str, schema: str, table: str, session) -> List[Dict[str, Any]]:
        """Infers 'columns' (fields) by sampling documents from a collection."""
        try:
            client, default_db = self.service.get_mongo_client(db_id, session)
            if not client:
                return []
            target_db = schema if schema and schema != 'public' else default_db
            collection = client[target_db][table]
        except Exception as exc:
            logger.error("Error inferring MongoDB columns: %s", redact_mongo_sensitive_text(exc))
            return []

        try:
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                documents = list(
                    collection.aggregate(
                        [{"$sample": {"size": 20}}],
                        maxTimeMS=MONGO_METADATA_TIMEOUT_MS,
                    )
                )
            field_types: Dict[str, set[str]] = {}
            field_arrays: Dict[str, bool] = {}
            field_order: List[str] = []
            for doc in documents:
                if isinstance(doc, dict):
                    self._collect_field_types(doc, field_types, field_arrays, field_order)

            return [
                {
                    "name": name,
                    "type": " | ".join(sorted(field_types[name])),
                    "nullable": True,
                    "isArray": field_arrays.get(name, False),
                }
                for name in field_order
            ]
        except Exception as e:
            logger.error("Error inferring MongoDB columns: %s", redact_mongo_sensitive_text(e))
            return []

    def _collect_field_types(
        self,
        value: Dict[str, Any],
        field_types: Dict[str, set[str]],
        field_arrays: Dict[str, bool],
        field_order: List[str],
        prefix: str = "",
        depth: int = 0,
        array_context: bool = False,
    ) -> None:
        """Flatten nested objects and arrays of objects with bounded recursion."""
        if depth > 5:
            return

        for key, nested in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            self._record_field(path, nested, field_types, field_arrays, field_order, array_context)
            if isinstance(nested, dict):
                self._collect_field_types(
                    nested,
                    field_types,
                    field_arrays,
                    field_order,
                    path,
                    depth + 1,
                    array_context,
                )
            elif isinstance(nested, list):
                object_items = [item for item in nested if isinstance(item, dict)]
                if object_items:
                    for item in object_items:
                        self._collect_field_types(
                            item,
                            field_types,
                            field_arrays,
                            field_order,
                            path,
                            depth + 1,
                            True,
                        )

    @staticmethod
    def _record_field(
        path: str,
        value: Any,
        field_types: Dict[str, set[str]],
        field_arrays: Dict[str, bool],
        field_order: List[str],
        is_array: bool,
    ) -> None:
        if path not in field_types:
            field_types[path] = set()
            field_order.append(path)
        field_types[path].add(type(value).__name__)
        field_arrays[path] = field_arrays.get(path, False) or is_array or isinstance(value, list)

    def get_indexes(self, db_id: str, schema: str, table: str, session) -> List[Dict[str, Any]]:
        """Lists all indices defined on a MongoDB collection."""
        try:
            client, default_db = self.service.get_mongo_client(db_id, session)
            if not client:
                return []
        except Exception as exc:
            logger.error("Error listing MongoDB indexes: %s", redact_mongo_sensitive_text(exc))
            return []

        target_db = schema if schema and schema != 'public' else default_db
        try:
            collection = client[target_db][table]
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                indexes = list(collection.list_indexes())
            return [{"indexname": idx.get('name'), "indexdef": str(idx.get('key'))} for idx in indexes]
        except Exception as e:
            logger.error("Error listing MongoDB indexes: %s", redact_mongo_sensitive_text(e))
            return []

    def get_table_info(self, db_id: str, schema: str, table: str, session) -> Dict[str, Any]:
        """Returns statistics for a MongoDB collection."""
        try:
            client, default_db = self.service.get_mongo_client(db_id, session)
            if not client:
                return {}
        except Exception as exc:
            logger.error("Error fetching MongoDB table info: %s", redact_mongo_sensitive_text(exc))
            return {}

        target_db = schema if schema and schema != 'public' else default_db
        try:
            with pymongo.timeout(MONGO_METADATA_TIMEOUT_SECONDS):
                stats = client[target_db].command(
                    "collstats",
                    table,
                    maxTimeMS=MONGO_METADATA_TIMEOUT_MS,
                )
            return {
                "total_size": f"{stats.get('totalSize', 0) / 1024:.2f} KB",
                "data_size": f"{stats.get('size', 0) / 1024:.2f} KB",
                "index_size": f"{stats.get('totalIndexSize', 0) / 1024:.2f} KB",
                "row_count": stats.get('count', 0)
            }
        except Exception:
            return {}
