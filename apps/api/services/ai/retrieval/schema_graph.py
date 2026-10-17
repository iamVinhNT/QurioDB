"""schema_graph.py — Strict schema snapshots, stable identities and typed FK edges."""

import json

from sqlalchemy import inspect

from models import GraphNode, GraphEdge, GraphEvidence, SessionLocal
from services.base_service import BaseDatabaseService
from .index_documents import build_schema_chunks, content_hash


def node_id(database_id, schema, table, column=None, catalog=""):
    return "schema:" + content_hash(json.dumps([database_id, catalog, schema, table, column], ensure_ascii=False))


def edge_id(source, relation, target, payload):
    return content_hash(json.dumps([source, relation, target, payload], sort_keys=True, ensure_ascii=False))


def reflect_schema(database_id, schema):
    """Reflection failures propagate; an error is never a successful empty schema."""
    def read(connection):
        inspector = inspect(connection)
        tables = inspector.get_table_names(schema=schema)
        views = inspector.get_view_names(schema=schema)
        columns, foreign_keys, indexes = {}, [], {}
        for table in dict.fromkeys([*tables, *views]):
            columns[table] = [{"name": c["name"], "type": str(c["type"]),
                               "nullable": c.get("nullable", True)}
                              for c in inspector.get_columns(table, schema=schema)]
            indexes[table] = [{"indexname": index["name"],
                               "indexdef": ("UNIQUE " if index.get("unique") else "") +
                                   "INDEX " + str(index["name"]) + " (" +
                                   ", ".join(str(c) for c in index.get("column_names", [])) + ")"}
                              for index in inspector.get_indexes(table, schema=schema)]
            if table not in tables:
                continue
            for fk in inspector.get_foreign_keys(table, schema=schema):
                left, right = fk["constrained_columns"], fk["referred_columns"]
                if len(left) != len(right) or not left:
                    raise ValueError("Incomplete composite foreign key metadata")
                foreign_keys.append({"table": table, "foreignTable": fk["referred_table"],
                                     "foreignSchema": fk.get("referred_schema") or schema,
                                     "columnPairs": list(zip(left, right)), "constraint": fk.get("name"),
                                     "column": ", ".join(left), "foreignColumn": ", ".join(right)})
        return columns, foreign_keys, connection.dialect.name, indexes
    return BaseDatabaseService().run_dynamic_query(database_id, read)


class SchemaGraphService:
    def __init__(self, session_factory=None, reflector=None):
        self.sessions = session_factory or SessionLocal
        self.reflect = reflector or reflect_schema

    def sync(self, database_id, schema):
        snapshot = self.reflect(database_id, schema)
        return self.store_snapshot(database_id, schema, *snapshot)

    def store_snapshot(self, database_id, schema, columns, foreign_keys, dialect, indexes=None, *, index_service=None, user_id=None):
        # Canonical ordering makes reflection entry points produce identical hashes.
        columns = dict(sorted(columns.items()))
        foreign_keys = sorted(foreign_keys, key=lambda fk: json.dumps(fk, sort_keys=True))
        indexes = {table: sorted(items, key=lambda item: json.dumps(item, sort_keys=True))
                   for table, items in (indexes or {}).items()}
        local_keys = [fk for fk in foreign_keys if (fk.get("foreignSchema") or schema) == schema]
        chunks = build_schema_chunks(database_id, schema, columns, dialect, local_keys, indexes)
        for fk in foreign_keys:
            target_schema = fk.get("foreignSchema") or schema
            if target_schema == schema:
                continue
            for chunk in chunks:
                if chunk["chunkType"] == "schema_graph" or chunk.get("objectName") == fk["table"]:
                    chunk["content"] += ("\nQualified cross-schema FK: " + schema + "." + fk["table"] +
                        " -> " + target_schema + "." + fk["foreignTable"] + "; columnPairs=" +
                        json.dumps(fk["columnPairs"], ensure_ascii=False))
        source_id = f"database_schema:{database_id}:{schema}"

        def update_graph(session, fingerprint):
            # Replace evidence from this schema only; independent knowledge evidence survives.
            session.query(GraphEvidence).filter_by(schemaSourceId=source_id).delete()
            valid_nodes = set()
            for table, table_columns in columns.items():
                table_id = node_id(database_id, schema, table)
                self._node(session, table_id, database_id, schema, table, None,
                           {"columns": table_columns, "dialect": dialect}, source_id, fingerprint)
                valid_nodes.add(table_id)
                for column in table_columns:
                    column_id = node_id(database_id, schema, table, column["name"])
                    self._node(session, column_id, database_id, schema, table, column["name"],
                               column, source_id, fingerprint)
                    valid_nodes.add(column_id)
                    add_edge(session, database_id, table_id, "HAS_COLUMN", column_id, {},
                             schema_source_id=source_id, fingerprint=fingerprint)
            for fk in foreign_keys:
                target_schema = fk.get("foreignSchema") or schema
                source_node = node_id(database_id, schema, fk["table"])
                target_node = node_id(database_id, target_schema, fk["foreignTable"])
                if source_node not in valid_nodes:
                    continue
                # Store the FK even before its destination is synced. Visibility requires
                # both endpoints to belong to successful current snapshots.
                if target_schema == schema and target_node not in valid_nodes:
                    continue
                if not session.get(GraphNode, target_node):
                    session.add(GraphNode(id=target_node, databaseId=database_id, nodeType="table",
                        schemaName=target_schema, tableName=fk["foreignTable"],
                        label=f"{target_schema}.{fk['foreignTable']}", payloadJson={}))
                    session.flush()
                payload = {"columnPairs": fk["columnPairs"], "role": fk.get("constraint") or "foreign key",
                           "cardinality": "many-to-one", "schemaName": schema}
                add_edge(session, database_id, source_node, "FOREIGN_KEY", target_node, payload,
                         schema_source_id=source_id, fingerprint=fingerprint)
            # Leave stale rows for stable historical references; active snapshot checks exclude them.
        from .index_service import RagIndexService
        indexer = index_service or RagIndexService(session_factory=self.sessions)
        result = indexer._upsert_source_with_chunks(
            source_id, "database_schema", database_id, None, f"{schema} schema",
            f"database://{database_id}/{schema}", "database", chunks,
            actor_user_id=user_id, update_snapshot=update_graph,
        )
        return {**result, "status": "synced" if result["status"] == "indexed" else result["status"],
                "schemaName": schema, "tables": len(columns)}

    @staticmethod
    def _node(session, identity, database_id, schema, table, column, payload, source, fingerprint):
        row = session.get(GraphNode, identity)
        if not row:
            row = GraphNode(id=identity, databaseId=database_id)
            session.add(row)
        row.nodeType = "column" if column is not None else "table"
        row.schemaName, row.tableName, row.columnName = schema, table, column
        row.label = f"{schema}.{table}" + (f".{column}" if column else "")
        row.payloadJson, row.schemaSourceId, row.snapshotHash = payload, source, fingerprint


def add_edge(session, database_id, source_id, relation, target_id, payload,
             revision_id=None, schema_source_id=None, fingerprint=None, section=""):
    identity = edge_id(source_id, relation, target_id, payload)
    if not session.get(GraphEdge, identity):
        session.add(GraphEdge(id=identity, databaseId=database_id, sourceId=source_id,
                              targetId=target_id, relation=relation, payloadJson=payload))
        session.flush()
    evidence_id = content_hash(json.dumps([identity, revision_id, schema_source_id, fingerprint, section]))
    if not session.get(GraphEvidence, evidence_id):
        session.add(GraphEvidence(id=evidence_id, edgeId=identity, revisionId=revision_id,
                                  schemaSourceId=schema_source_id, snapshotHash=fingerprint, section=section))
    return identity


schema_graph_service = SchemaGraphService()
