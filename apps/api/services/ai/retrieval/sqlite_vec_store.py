"""
sqlite_vec_store.py

Optional sqlite-vec accelerator for local desktop RAG semantic retrieval.
"""

import logging
import json
from typing import Dict, Iterable, List, Optional

from .vector_store import resolve_vector_store_config


logger = logging.getLogger(__name__)


class SqliteVecStore:
    """Mirrors embeddings into sqlite-vec virtual tables when available."""

    _map_table = "rag_sqlite_vec_map"
    _available_cache: Optional[bool] = None

    def is_enabled(self) -> bool:
        return resolve_vector_store_config().backend == "sqlite_vec"

    def is_available(self, session) -> bool:
        """Returns whether sqlite-vec can be used on the active SQLite session."""
        if not self.is_enabled() or not self._is_sqlite_session(session):
            return False
        if self._available_cache is False:
            return False

        try:
            connection = self._dbapi_connection(session)
            self._load_extension(connection)
            self._available_cache = True
            return True
        except Exception as exc:
            self._available_cache = False
            logger.warning("sqlite-vec backend unavailable, using lexical retrieval: %s", exc)
            return False

    def upsert_embedding(self, session, chunk, source, vector: List[float]) -> bool:
        """Stores one chunk embedding in a dimension-specific sqlite-vec table."""
        if not vector or not self.is_available(session):
            return False

        dimensions = len(vector)
        table_name = self._table_name(dimensions)
        connection = self._dbapi_connection(session)
        self._ensure_schema(connection, dimensions)

        cursor = connection.execute(
            f"SELECT rowid, dimensions FROM {self._map_table} WHERE chunk_id = ?",
            (chunk.id,),
        )
        existing = cursor.fetchone()
        if existing and int(existing[1]) != dimensions:
            old_table_name = self._table_name(int(existing[1]))
            connection.execute(f"DELETE FROM {old_table_name} WHERE rowid = ?", (int(existing[0]),))
            connection.execute(f"DELETE FROM {self._map_table} WHERE rowid = ?", (int(existing[0]),))
            existing = None

        if existing:
            rowid = int(existing[0])
        else:
            cursor = connection.execute(
                f"""
                INSERT INTO {self._map_table} (chunk_id, source_id, dimensions)
                VALUES (?, ?, ?)
                """,
                (chunk.id, chunk.sourceId, dimensions),
            )
            rowid = int(cursor.lastrowid)

        database_id = source.databaseId or ""
        user_id = source.userId or ""
        source_type = source.sourceType or ""
        connection.execute(f"DELETE FROM {table_name} WHERE rowid = ?", (rowid,))
        connection.execute(
            f"""
            INSERT INTO {table_name}
              (rowid, embedding, database_id, user_id, source_type, chunk_id, source_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                rowid,
                self._serialize(vector),
                database_id,
                user_id,
                source_type,
                chunk.id,
                chunk.sourceId,
            ),
        )
        return True

    def delete_source(self, session, source_id: str) -> None:
        """Deletes sqlite-vec rows for a logical RAG source."""
        if not source_id or not self.is_available(session):
            return

        connection = self._dbapi_connection(session)
        self._ensure_map_table(connection)
        rows = connection.execute(
            f"SELECT rowid, dimensions FROM {self._map_table} WHERE source_id = ?",
            (source_id,),
        ).fetchall()
        self._delete_rows(connection, rows)

    def delete_chunks(self, session, chunk_ids):
        if not chunk_ids or not self.is_available(session):
            return
        connection = self._dbapi_connection(session)
        self._ensure_map_table(connection)
        rows = connection.execute(
            f"SELECT rowid, dimensions FROM {self._map_table} WHERE chunk_id IN (SELECT value FROM json_each(?))",
            (json.dumps(chunk_ids),),
        ).fetchall()
        self._delete_rows(connection, rows)

    def semantic_scores(
        self,
        session,
        query_vector: List[float],
        database_id: Optional[str] = None,
        user_id: Optional[str] = None,
        source_types: Optional[List[str]] = None,
        k: int = 32,
        candidate_chunk_ids: Optional[List[str]] = None,
    ) -> Dict[str, float]:
        """Returns chunk cosine similarity scores from sqlite-vec KNN queries."""
        if not query_vector or not self.is_available(session):
            return {}

        dimensions = len(query_vector)
        connection = self._dbapi_connection(session)
        self._ensure_schema(connection, dimensions)
        table_name = self._table_name(dimensions)
        if candidate_chunk_ids is not None:
            # A rowid IN constraint is applied by vec0 before KNN top-k. JSON keeps
            # the parameter count bounded even for large authorized candidate sets.
            rows = connection.execute(f"""
                SELECT chunk_id, distance FROM {table_name}
                WHERE embedding MATCH ? AND k = ? AND rowid IN (
                    SELECT rowid FROM {self._map_table}
                    WHERE chunk_id IN (SELECT value FROM json_each(?)) AND dimensions = ?
                )
            """, (self._serialize(query_vector), max(1, int(k)), json.dumps(candidate_chunk_ids), dimensions)).fetchall()
            return {chunk_id: max(0.0, 1.0 - float(distance)) for chunk_id, distance in rows}
        scores: Dict[str, float] = {}
        for query, params in self._search_queries(table_name, database_id, user_id, source_types, k):
            rows = connection.execute(query, [self._serialize(query_vector), *params]).fetchall()
            for chunk_id, distance in rows:
                score = max(0.0, 1.0 - float(distance))
                if score > scores.get(chunk_id, 0.0):
                    scores[chunk_id] = score
        return scores

    def _search_queries(
        self,
        table_name: str,
        database_id: Optional[str],
        user_id: Optional[str],
        source_types: Optional[List[str]],
        k: int,
    ):
        source_filters = source_types or [None]
        user_filters = ["", user_id] if user_id else [None]
        for source_type in source_filters:
            for user_filter in user_filters:
                filters = ["embedding MATCH ?", "k = ?"]
                params: List[object] = [max(1, int(k))]
                if database_id:
                    filters.append("database_id = ?")
                    params.append(database_id)
                if user_filter is not None:
                    filters.append("user_id = ?")
                    params.append(user_filter)
                if source_type:
                    filters.append("source_type = ?")
                    params.append(source_type)

                query = f"""
                    SELECT chunk_id, distance
                    FROM {table_name}
                    WHERE {' AND '.join(filters)}
                """
                yield query, params

    def _delete_rows(self, connection, rows: Iterable[object]) -> None:
        for rowid, dimensions in rows:
            self._ensure_schema(connection, int(dimensions))
            table_name = self._table_name(int(dimensions))
            connection.execute(f"DELETE FROM {table_name} WHERE rowid = ?", (int(rowid),))
            connection.execute(f"DELETE FROM {self._map_table} WHERE rowid = ?", (int(rowid),))

    def _ensure_schema(self, connection, dimensions: int) -> None:
        self._ensure_map_table(connection)
        table_name = self._table_name(dimensions)
        connection.execute(
            f"""
            CREATE VIRTUAL TABLE IF NOT EXISTS {table_name} USING vec0(
              embedding float[{dimensions}] distance_metric=cosine,
              database_id text,
              user_id text,
              source_type text,
              +chunk_id text,
              +source_id text
            )
            """
        )

    def _ensure_map_table(self, connection) -> None:
        connection.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {self._map_table} (
              rowid INTEGER PRIMARY KEY AUTOINCREMENT,
              chunk_id TEXT NOT NULL UNIQUE,
              source_id TEXT NOT NULL,
              dimensions INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            f"CREATE INDEX IF NOT EXISTS idx_{self._map_table}_source ON {self._map_table} (source_id)"
        )

    def _load_extension(self, connection) -> None:
        try:
            connection.execute("SELECT vec_version()")
            return
        except Exception:
            pass

        import sqlite_vec

        connection.enable_load_extension(True)
        try:
            sqlite_vec.load(connection)
        finally:
            connection.enable_load_extension(False)
        connection.execute("SELECT vec_version()")

    def _serialize(self, vector: List[float]):
        from sqlite_vec import serialize_float32

        return serialize_float32(vector)

    def _table_name(self, dimensions: int) -> str:
        if dimensions <= 0 or dimensions > 4096:
            raise ValueError(f"Unsupported sqlite-vec dimensions: {dimensions}")
        return f"rag_sqlite_vec_{dimensions}"

    def _is_sqlite_session(self, session) -> bool:
        bind = session.get_bind()
        return bool(bind and bind.dialect.name == "sqlite")

    def _dbapi_connection(self, session):
        raw_connection = session.connection().connection
        return getattr(raw_connection, "driver_connection", raw_connection)


sqlite_vec_store = SqliteVecStore()
