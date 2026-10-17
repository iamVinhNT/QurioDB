"""graph_retrieval.py — Scoped evidence and bounded, ambiguity-aware JOIN paths."""

import json
from sqlalchemy.exc import SQLAlchemyError
from collections import defaultdict, deque
from itertools import combinations

from sqlalchemy import or_, exists, select

from models import (Db, GraphNode, GraphEdge, GraphEvidence, RagSource, RagChunk,
                    KnowledgeDocument, KnowledgeRevision, SessionLocal)
from services.knowledge_access import eligible_revisions, require_user, resource
from .schema_graph import node_id
from .text import normalize_text


def visible_graph(session, database_id, user_id, schema=None, base_id=None, focus=None):
    require_user(user_id)
    if not session.get(Db, database_id):
        return [], []
    revision_ids = [r.id for r in eligible_revisions(session, user_id, database_id, base_id)]
    current_node = exists().where(RagSource.id == GraphNode.schemaSourceId,
                                  RagSource.contentHash == GraphNode.snapshotHash, RagSource.status == "indexed")
    query = session.query(GraphNode).filter(GraphNode.databaseId == database_id).filter(or_(
        current_node, GraphNode.revisionId.in_(revision_ids)))
    if schema:
        query = query.filter(or_(GraphNode.schemaName == schema, GraphNode.revisionId.in_(revision_ids)))
    if focus:
        neighbors = select(GraphEdge.sourceId).where(GraphEdge.databaseId == database_id, GraphEdge.targetId == focus).union(
            select(GraphEdge.targetId).where(GraphEdge.databaseId == database_id, GraphEdge.sourceId == focus))
        query = query.filter(or_(GraphNode.id == focus, GraphNode.id.in_(neighbors)))
    nodes = query.order_by(GraphNode.id).limit(10001).all()
    if len(nodes) > 10000:
        return [], []
    ids = {n.id for n in nodes}
    current_evidence = exists().where(RagSource.id == GraphEvidence.schemaSourceId,
                                      RagSource.contentHash == GraphEvidence.snapshotHash, RagSource.status == "indexed")
    edges = session.query(GraphEdge).join(GraphEvidence).filter(GraphEdge.databaseId == database_id,
        or_(current_evidence, GraphEvidence.revisionId.in_(revision_ids))).distinct().limit(50001).all()
    if len(edges) > 50000:
        return [], []
    return nodes, [e for e in edges if e.sourceId in ids and e.targetId in ids]


def find_paths(source, target, adjacency, max_hops=3, max_nodes=40, visited_nodes=None):
    queue = deque([(source, [], {source})])
    paths, visited, truncated = [], visited_nodes if visited_nodes is not None else set(), False
    while queue:
        current, path, ancestors = queue.popleft()
        if current not in visited and len(visited) >= max_nodes:
            truncated = True
            break
        visited.add(current)
        if current == target:
            paths.append(path)
            if len(paths) >= 8:
                truncated = True
                break
            continue
        if len(path) >= max_hops:
            continue
        for neighbor, edge in adjacency.get(current, []):
            if len(queue) >= max_nodes * max_nodes:
                truncated = True
                continue
            if neighbor not in ancestors:
                queue.append((neighbor, [*path, edge], ancestors | {neighbor}))
    return paths, truncated


class GraphRetrievalService:
    def __init__(self, session_factory=None):
        self.sessions = session_factory or SessionLocal

    def inspect(self, database_id, user_id, schema=None, focus=None, limit=200, offset=0, base_id=None):
        with self.sessions() as session:
            nodes, edges = visible_graph(session, database_id, user_id, schema, base_id, focus)
            if focus:
                selected = {focus}
                selected.update(e.targetId if e.sourceId == focus else e.sourceId for e in edges
                                if focus in (e.sourceId, e.targetId))
                nodes = [n for n in nodes if n.id in selected]
            total = len(nodes)
            nodes = nodes[offset:offset + limit]
            ids = {n.id for n in nodes}
            edges = [e for e in edges if e.sourceId in ids and e.targetId in ids]
            evidence = []
            active_ids = {r.id for r in eligible_revisions(session, user_id, database_id, base_id)}
            for edge in edges:
                for item in session.query(GraphEvidence).filter_by(edgeId=edge.id):
                    if item.revisionId and item.revisionId not in active_ids:
                        continue
                    if item.schemaSourceId:
                        source = session.get(RagSource, item.schemaSourceId)
                        if not source or source.contentHash != item.snapshotHash:
                            continue
                    entry = resource(item)
                    if item.revisionId:
                        revision = session.get(KnowledgeRevision, item.revisionId)
                        document = session.get(KnowledgeDocument, revision.documentId)
                        entry.update(documentId=document.id, knowledgeBaseId=document.knowledgeBaseId)
                    evidence.append(entry)
            return {"nodes": [resource(n) for n in nodes], "edges": [resource(e) for e in edges],
                    "evidence": evidence, "total": total, "limit": limit, "offset": offset,
                    "truncated": offset + limit < total}

    def expand(self, query, items, database_id, schema, user_id, base_id=None):
        from .vector_store import resolve_vector_store_config
        if not resolve_vector_store_config().enabled:
            return [], {"enabled": False, "gaps": []}
        try:
            return self._expand(query, items, database_id, schema, user_id, base_id)
        except SQLAlchemyError:
            return items, {"enabled": True, "gaps": ["graph_unavailable"]}

    def _expand(self, query, items, database_id, schema, user_id, base_id=None):
        if not database_id or not user_id:
            return items, {"enabled": False, "gaps": []}
        with self.sessions() as session:
            revisions = eligible_revisions(session, user_id, database_id, base_id)
            if not revisions:
                return items, {"enabled": False, "gaps": []}
            nodes, edges = visible_graph(session, database_id, user_id, None, base_id)
            by_id = {n.id: n for n in nodes}
            seeds = {node_id(database_id, schema, item.get("objectName")) for item in items
                     if item.get("sourceType") == "database_schema" and item.get("chunkType") == "table"
                     and normalize_text(str(item.get("objectName", ""))).replace("_", " ") in normalize_text(query).replace("_", " ")}
            matched = {(i.get("metadata") or {}).get("revisionId") for i in items}
            for revision in revisions:
                if revision.id in matched:
                    for binding in (revision.definitionData or {}).get("bindings", []):
                        seeds.add(node_id(database_id, binding["schemaName"], binding["tableName"], catalog=binding.get("catalogName", "")))
            seeds &= by_id.keys()
            adjacency = defaultdict(list)
            for edge in edges:
                if edge.relation in {"FOREIGN_KEY", "LOGICAL_JOIN"}:
                    adjacency[edge.sourceId].append((edge.targetId, edge))
                    adjacency[edge.targetId].append((edge.sourceId, edge))
            selected, selected_edges, gaps = set(seeds), {}, []
            fallback = None
            # Complete small schemas are a bounded fallback when names cannot be
            # resolved from the question. Never infer a cross-connection scope.
            local_tables = [n for n in nodes if n.nodeType == "table" and n.schemaName == schema]
            if not seeds and 0 < len(local_tables) <= 40:
                selected = {n.id for n in local_tables}
                fallback = "small_full_schema"
            elif not nodes:
                rows = session.query(RagChunk).join(RagSource).filter(
                    RagSource.databaseId == database_id, RagSource.sourceType == "database_schema",
                    RagSource.status == "indexed", RagChunk.schemaName == schema,
                    RagChunk.chunkType == "table").limit(41).all()
                if 0 < len(rows) <= 40 and sum(len(c.content.split()) for c in rows) <= 4500:
                    existing_ids = {i.get("chunkId") for i in items}
                    items = [*items, *[{"chunkId": c.id, "sourceId": c.sourceId,
                        "sourceType": "database_schema", "chunkType": "table", "objectName": c.objectName,
                        "schemaName": c.schemaName, "title": c.objectName, "content": c.content,
                        "citation": {"id": c.metadataJson["citation"], "sourceType": "database_schema",
                                     "title": c.objectName, "objectName": c.objectName, "schemaName": c.schemaName}}
                        for c in rows if c.id not in existing_ids]]
                    fallback = "small_full_schema"
            if not nodes:
                gaps.append("graph_unavailable_or_too_large")
            definitions = {}
            for revision in revisions:
                for definition in (revision.definitionData or {}).get("definitions", []):
                    if definition.get("kind") not in {"metric", "rule"}:
                        continue
                    names = [definition["name"], *definition.get("aliases", [])]
                    if revision.id not in matched and not any(normalize_text(n) in normalize_text(query) for n in names if n.strip()):
                        continue
                    identity = (definition["kind"], normalize_text(definition["name"]))
                    meaning = json.dumps({k: v for k,v in definition.items() if k not in {"name", "aliases"}}, sort_keys=True)
                    if identity in definitions and definitions[identity] != meaning:
                        gaps.append("conflicting_knowledge_definition:" + definition["name"])
                    definitions[identity] = meaning
            if len(seeds) > 12:
                gaps.append("graph_seed_budget_exceeded")
            visited_nodes = set()
            for source, target in combinations(sorted(seeds)[:12], 2):
                paths, truncated = find_paths(source, target, adjacency, visited_nodes=visited_nodes)
                if truncated:
                    gaps.append("graph_budget_exceeded")
                if not paths:
                    gaps.append("unresolved_join_path")
                    continue
                ranked = sorted(paths, key=lambda path: self._role_score(query, path), reverse=True)
                if len(ranked) > 1 and self._role_score(query, ranked[0]) == self._role_score(query, ranked[1]):
                    gaps.append("ambiguous_join_path")
                    continue
                path_nodes = {n for e in ranked[0] for n in (e.sourceId, e.targetId)}
                if len(selected | path_nodes) > 40:
                    gaps.append("graph_budget_exceeded")
                    continue
                for edge in ranked[0]:
                    selected.update((edge.sourceId, edge.targetId))
                    selected_edges[edge.id] = edge
            additions = []
            existing = {(i.get("schemaName"), i.get("objectName")) for i in items if i.get("chunkType") == "table"}
            for identity in sorted(selected):
                node = by_id[identity]
                if (node.schemaName, node.tableName) in existing:
                    continue
                chunk = session.query(RagChunk).filter_by(sourceId=node.schemaSourceId, objectName=node.tableName, chunkType="table").first()
                if not chunk:
                    gaps.append("missing_bridge_table_evidence")
                    continue
                additions.append({"chunkId": chunk.id, "sourceId": chunk.sourceId, "sourceType": "database_schema",
                    "title": node.label, "chunkType": "table", "objectName": node.tableName, "schemaName": node.schemaName,
                    "content": chunk.content, "score": 1.0, "metadata": chunk.metadataJson,
                    "citation": {"id": chunk.metadataJson["citation"], "sourceType": "database_schema", "title": node.label,
                                 "objectName": node.tableName, "schemaName": node.schemaName, "reasons": ["graph_join_path"]}})
            if selected_edges:
                allowed_ids = {r.id for r in revisions}
                for edge in selected_edges.values():
                    origins = session.query(GraphEvidence).filter_by(edgeId=edge.id).all()
                    origin = next((o for o in origins if o.revisionId in allowed_ids), None)
                    citation = {"id": f"graph:{edge.id}", "sourceType": "database_schema", "title": "JOIN path", "schemaName": schema}
                    if origin:
                        revision = session.get(KnowledgeRevision, origin.revisionId)
                        document = session.get(KnowledgeDocument, revision.documentId)
                        section = origin.section or "section-0"
                        citation.update(id=f"knowledge:{document.id}/revision:{revision.id}#{section}:edge:{edge.id}",
                            sourceType="knowledge_document", documentId=document.id, revisionId=revision.id,
                            knowledgeBaseId=document.knowledgeBaseId, section=section)
                    additions.append({"sourceType": "database_schema", "chunkType": "join_path", "title": "Reviewed JOIN path",
                        "content": "JOIN evidence; preserve ALL composite key pairs and check grain/fan-out.\n" +
                                   f"{by_id[edge.sourceId].label} -> {by_id[edge.targetId].label}: {edge.payloadJson}",
                        "score": 1.0, "citation": citation})
            return [*additions, *items], {"enabled": True, "seedCount": len(seeds), "fallback": fallback, "tableCount": len(selected), "visitedTableCount": len(visited_nodes),
                                         "edgeIds": list(selected_edges), "gaps": sorted(set(gaps))}

    @staticmethod
    def _role_score(query, path):
        terms = set(normalize_text(query).split())
        return sum(len(terms & set(normalize_text(e.payloadJson.get("role", "")).split())) for e in path)


graph_retrieval_service = GraphRetrievalService()
