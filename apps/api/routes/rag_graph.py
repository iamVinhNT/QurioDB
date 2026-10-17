"""rag_graph.py — Bounded graph inspection and strict schema sync."""

from fastapi import APIRouter, Depends, Query
from routes.knowledge import principal
from schemas.knowledge import SchemaSyncRequest
from services.knowledge_service import knowledge_service
from services.knowledge_access import KnowledgeError
from services.ai.retrieval.graph_retrieval import graph_retrieval_service
from services.ai.retrieval.schema_graph import schema_graph_service

router = APIRouter(tags=["knowledge-graph"])


@router.get("/rag/graph")
def graph(databaseId: str, knowledgeBaseId: str, schemaName: str | None = None, focus: str | None = None,
          limit: int = Query(200, ge=1, le=500), offset: int = Query(0, ge=0), user_id=Depends(principal)):
    base = knowledge_service.get_base(knowledgeBaseId, user_id)
    if base["databaseId"] != databaseId:
        raise KnowledgeError("Connection does not match this knowledge base", 404)
    return graph_retrieval_service.inspect(databaseId, user_id, schemaName, focus, limit, offset, knowledgeBaseId)


@router.post("/knowledge-bases/{base_id}/sync-schema")
def sync_schema(base_id: str, data: SchemaSyncRequest, user_id=Depends(principal)):
    base = knowledge_service.get_base(base_id, user_id)
    try:
        return schema_graph_service.sync(base["databaseId"], data.schemaName)
    except Exception:
        raise KnowledgeError("Schema sync failed. Check the connection and selected schema.", 503) from None
