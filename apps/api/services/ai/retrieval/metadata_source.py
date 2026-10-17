"""
metadata_source.py

Safe metadata access helpers for schema retrieval.
"""

import logging
from typing import Any, Dict, Iterable, List

from models import SessionLocal
from ...metadata import metadata_service

logger = logging.getLogger(__name__)


class SchemaMetadataSource:
    """Reads schema metadata while isolating provider failures from AI chat."""

    def get_schema_snapshot(self, database_id: str, schema: str):
        """Read one complete snapshot; failures must preserve the last good index."""
        from .schema_graph import reflect_schema
        return reflect_schema(database_id, schema)

    def get_all_columns(self, database_id: str, schema: str) -> Dict[str, List[Dict[str, Any]]]:
        """Fetches table columns without letting metadata errors disable chat."""
        try:
            return metadata_service.get_all_columns(database_id, schema)
        except Exception as exc:
            logger.warning("Failed to load columns for lexical schema retrieval: %s", exc)
            return {}

    def get_all_foreign_keys(self, database_id: str, schema: str) -> List[Dict[str, Any]]:
        """Fetches FK metadata for richer indexing and neighbor expansion."""
        try:
            return metadata_service.get_all_foreign_keys(database_id, schema)
        except Exception as exc:
            logger.debug("Failed to load foreign keys for schema retrieval: %s", exc)
            return []

    def get_indexes_for_tables(
        self,
        database_id: str,
        schema: str,
        tables: Iterable[str],
    ) -> Dict[str, List[Dict[str, Any]]]:
        """Fetches indexes per table with failures isolated to each table."""
        return {
            table: self.get_indexes(database_id, schema, table)
            for table in tables
        }

    def get_indexes(self, database_id: str, schema: str, table_name: str) -> List[Dict[str, Any]]:
        """Fetches index metadata when the provider supports it."""
        try:
            return metadata_service.get_indexes(database_id, schema, table_name)
        except Exception as exc:
            logger.debug("Failed to load indexes for %s: %s", table_name, exc)
            return []

    def get_db_type(self, database_id: str) -> str:
        """Returns the configured database dialect if available."""
        session = SessionLocal()
        try:
            from ...base_service import BaseDatabaseService

            return BaseDatabaseService().get_db_config(database_id, session)[0]
        except Exception:
            return "sql"
        finally:
            if session:
                session.close()
