"""
rag.py

Debug and indexing routes for QurioDB's generalized RAG layer.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from schemas.rag import (
    RagEvaluateRequest,
    RagIngestUrlRequest,
    RagIndexQueryHistoryRequest,
    RagIndexSavedQueriesRequest,
    RagIndexSourceRequest,
    RagPlanRequest,
    RagRetrieveRequest,
    RagSyncDatabaseRequest,
)
from services.ai.retrieval.ingestion import IngestionError, rag_ingestion_service
from services.ai.retrieval.evaluation import RagEvalCase, evaluate_retrieval_cases
from services.ai.retrieval.index_service import rag_index_service
from services.ai.retrieval.pipeline import rag_pipeline_service
from services.ai.retrieval.retrieval_service import rag_retrieval_service
from services.ai.retrieval.vector_store import resolve_vector_store_config
from utils.auth_middleware import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/status")
def get_rag_status():
    """Reports RAG backend configuration without exposing secrets."""
    return {"vectorStore": resolve_vector_store_config().to_status()}


@router.get("/pipeline/status")
def get_pipeline_status():
    """Reports how QurioDB maps the production RAG flow into backend services."""
    return rag_pipeline_service.status()


@router.post("/pipeline/plan")
def plan_query(data: RagPlanRequest, current_user: dict = Depends(get_current_user)):
    """Runs query understanding and RAG context planning without invoking an LLM."""
    return rag_pipeline_service.plan_query(
        data.query,
        database_id=data.databaseId,
        schema=data.schema_name,
        history=data.history,
        user_id=current_user.get("userId"),
        model_id=None,
    )


@router.post("/pipeline/sync/database/{database_id}")
def sync_database(database_id: str, data: RagSyncDatabaseRequest, current_user: dict = Depends(get_current_user)):
    """Synchronizes core RAG sources for one database."""
    return rag_pipeline_service.sync_database(
        database_id,
        schema=data.schema_name,
        user_id=current_user.get("userId"),
        include_saved_queries=data.includeSavedQueries,
        include_query_history=data.includeQueryHistory,
        include_failed_history=data.includeFailedHistory,
        query_history_limit=data.queryHistoryLimit,
    )


@router.post("/index/database/{database_id}")
def index_database(database_id: str, schema: str = "public", current_user: dict = Depends(get_current_user)):
    """Rebuilds generalized schema chunks for a database."""
    return rag_index_service.index_database_schema(
        database_id,
        schema=schema or "public",
        user_id=current_user.get("userId"),
    )


@router.post("/index/saved-queries")
def index_saved_queries(data: RagIndexSavedQueriesRequest, current_user: dict = Depends(get_current_user)):
    """Indexes saved SQL queries visible to the current user."""
    return rag_index_service.index_saved_queries(
        data.databaseId,
        user_id=current_user.get("userId"),
    )


@router.post("/index/query-history")
def index_query_history(data: RagIndexQueryHistoryRequest, current_user: dict = Depends(get_current_user)):
    """Indexes masked query history after explicit user/admin action."""
    return rag_index_service.index_query_history(
        data.databaseId,
        include_failed=data.includeFailed,
        limit=data.limit,
        user_id=current_user.get("userId"),
    )


@router.post("/index/source")
def index_source(data: RagIndexSourceRequest, current_user: dict = Depends(get_current_user)):
    """Adds or refreshes a user-provided document/web source."""
    return rag_index_service.index_text_source(
        data.sourceType,
        data.title,
        data.content,
        database_id=data.databaseId,
        user_id=current_user.get("userId"),
        uri=data.uri,
        source_id=data.sourceId,
        access_scope=data.accessScope,
    )


@router.post("/ingest/url")
def ingest_url(data: RagIngestUrlRequest, current_user: dict = Depends(get_current_user)):
    """Fetches a public URL, extracts text, and indexes it as a RAG web source."""
    try:
        return rag_ingestion_service.ingest_url(
            data.url,
            title=data.title,
            database_id=data.databaseId,
            user_id=current_user.get("userId"),
            source_id=data.sourceId,
            access_scope=data.accessScope,
        )
    except IngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/ingest/file")
async def ingest_file(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    databaseId: Optional[str] = Form(None),
    sourceId: Optional[str] = Form(None),
    accessScope: str = Form("user"),
    current_user: dict = Depends(get_current_user),
):
    """Extracts text from an uploaded document and indexes it as a RAG source."""
    try:
        payload = await file.read()
        return rag_ingestion_service.ingest_file(
            payload,
            file.filename or "document",
            content_type=file.content_type,
            title=title,
            database_id=databaseId,
            user_id=current_user.get("userId"),
            source_id=sourceId,
            access_scope=accessScope,
        )
    except IngestionError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/sources")
def list_sources(
    databaseId: str | None = None,
    sourceType: str | None = None,
    current_user: dict = Depends(get_current_user),
):
    """Lists visible RAG sources and indexing status."""
    return rag_retrieval_service.list_sources(
        database_id=databaseId,
        user_id=current_user.get("userId"),
        source_type=sourceType,
    )


@router.get("/sources/{source_id}")
def get_source(source_id: str, current_user: dict = Depends(get_current_user)):
    """Inspects one visible indexed source and its chunk metadata."""
    source = rag_retrieval_service.get_source(source_id, user_id=current_user.get("userId"))
    if not source:
        raise HTTPException(status_code=404, detail="RAG source not found")
    return source


@router.delete("/sources/{source_id}")
def delete_source(source_id: str, current_user: dict = Depends(get_current_user)):
    """Removes one visible indexed source and its chunks."""
    result = rag_retrieval_service.delete_source(source_id, user_id=current_user.get("userId"))
    if result.get("reason") == "not_found":
        raise HTTPException(status_code=404, detail="RAG source not found")
    if result.get("reason") == "forbidden":
        raise HTTPException(status_code=403, detail="RAG source is not visible to this user")
    return result


@router.post("/retrieve")
def retrieve(data: RagRetrieveRequest, current_user: dict = Depends(get_current_user)):
    """Runs debug retrieval without invoking a model."""
    return rag_retrieval_service.retrieve(
        data.query,
        database_id=data.databaseId,
        user_id=current_user.get("userId"),
        source_types=data.sourceTypes,
        top_k=data.topK,
        candidate_limit=data.candidateLimit,
    )


@router.post("/evaluate")
def evaluate(data: RagEvaluateRequest, current_user: dict = Depends(get_current_user)):
    """Runs deterministic retrieval eval cases for local production RAG checks."""
    cases = [
        RagEvalCase(
            name=item.name,
            query=item.query,
            expected_citations=item.expectedCitations,
            database_id=item.databaseId,
            source_types=item.sourceTypes,
            top_k=item.topK,
            max_latency_ms=item.maxLatencyMs,
        )
        for item in data.cases
    ]
    return evaluate_retrieval_cases(
        cases,
        rag_retrieval_service,
        user_id=current_user.get("userId"),
    )


@router.get("/events/{message_id}")
def get_retrieval_events(message_id: str, current_user: dict = Depends(get_current_user)):
    """Returns safe retrieval trace events for one assistant message."""
    return rag_retrieval_service.get_retrieval_events(
        message_id,
        user_id=current_user.get("userId"),
    )
