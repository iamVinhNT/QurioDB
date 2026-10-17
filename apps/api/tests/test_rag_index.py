"""
test_rag_index.py

Regression tests for generalized RAG indexing and retrieval services.
"""

import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import services.ai.retrieval.index_service as index_module
import services.ai.retrieval.retrieval_service as retrieval_module
from models import (
    AIRouterTerm,
    AIRouterTermSet,
    Base,
    QueryHistory,
    RagChunk,
    RagEmbedding,
    RagRetrievalEvent,
    RagSource,
    SavedQuery,
)
from services.ai.router_terms import normalize_router_text, router_term_service
from services.ai.retrieval.index_documents import mask_sql_literals
from services.ai.retrieval.index_service import RagIndexService
from services.ai.retrieval.pipeline import RagPipelineService
from services.ai.retrieval.retrieval_service import RagRetrievalService
from services.ai.retrieval.text import build_table_search_text
from services.ai.retrieval.vector_store import resolve_vector_store_config
from services.ai.query_understanding import query_understanding_service
from schemas.rag import RagEvaluateRequest
from routes.rag import evaluate as evaluate_rag_endpoint, rag_retrieval_service as route_rag_retrieval_service

pytestmark = pytest.mark.rag


@pytest.fixture
def rag_session_factory(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)

    monkeypatch.setattr(index_module, "SessionLocal", factory)
    monkeypatch.setattr(retrieval_module, "SessionLocal", factory)
    # These tests control metadata methods individually; production snapshot reads
    # use strict inspector reflection instead of tolerant UI metadata helpers.
    from services.ai.retrieval.metadata_source import SchemaMetadataSource
    monkeypatch.setattr(SchemaMetadataSource, "get_schema_snapshot", lambda self, db, schema: (
        self.get_all_columns(db, schema), self.get_all_foreign_keys(db, schema),
        self.get_db_type(db), self.get_indexes_for_tables(db, schema, [])))
    from services.ai.retrieval.embedding_gateway import GeminiEmbeddingGateway
    monkeypatch.setattr(GeminiEmbeddingGateway, "for_user", lambda self, user: self)
    return factory


def test_index_database_schema_writes_generalized_sources_and_chunks(rag_session_factory, monkeypatch):
    service = RagIndexService()
    monkeypatch.setattr(service.embeddings, "is_available", lambda: False)
    monkeypatch.setattr(
        service.metadata,
        "get_all_columns",
        lambda *_: {
            "orders": [
                {"name": "id", "type": "INTEGER", "nullable": False},
                {"name": "customer_id", "type": "INTEGER", "nullable": False},
            ],
        },
    )
    monkeypatch.setattr(service.metadata, "get_db_type", lambda *_: "postgresql")
    monkeypatch.setattr(
        service.metadata,
        "get_all_foreign_keys",
        lambda *_: [{
            "table": "orders",
            "column": "customer_id",
            "foreignTable": "customers",
            "foreignColumn": "id",
        }],
    )
    monkeypatch.setattr(service.metadata, "get_indexes_for_tables", lambda *_: {"orders": []})

    result = service.index_database_schema("db-1", "public", user_id="user-1")

    session = rag_session_factory()
    try:
        source = session.get(RagSource, "database_schema:db-1:public")
        chunks = session.query(RagChunk).order_by(RagChunk.ordinal.asc()).all()
    finally:
        session.close()

    assert result["sourceType"] == "database_schema"
    assert result["chunkCount"] == 2
    assert source.title == "public schema"
    table_chunk = next(chunk for chunk in chunks if chunk.chunkType == "table")
    graph_chunk = next(chunk for chunk in chunks if chunk.chunkType == "schema_graph")
    assert table_chunk.metadataJson["citation"] == "database:db-1/schema:public/table:orders"
    assert 'SQL table reference: "public"."orders"' in table_chunk.content
    assert "customer_id INTEGER required foreign key to customers.id" in table_chunk.content
    assert graph_chunk.metadataJson["citation"] == "database:db-1/schema:public/graph"
    assert "orders.customer_id -> customers.id" in graph_chunk.content


def test_query_understanding_uses_connected_database_context_without_domain_keywords():
    understanding = query_understanding_service.understand(
        "Trải nghiệm nào có số lượt đặt nhiều nhất?",
        database_id="db-1",
        schema="public",
    )

    assert understanding.intent == "text_to_sql"
    assert understanding.needs_retrieval is True
    assert understanding.behavior == "data_exploration"
    assert understanding.rag_mode == "deep"
    assert understanding.reasoning_mode == "deep"
    assert "database_schema" in understanding.source_types


def test_query_understanding_routes_vietnamese_metric_commands_to_database_context():
    understanding = query_understanding_service.understand(
        "T\u00ednh doanh thu trung b\u00ecnh tr\u00ean m\u1ed7i \u0111\u1eb7t ch\u1ed7 cho t\u1eebng host",
        database_id="db-1",
        schema="public",
    )

    assert understanding.intent == "text_to_sql"
    assert understanding.needs_retrieval is True
    assert understanding.behavior == "data_exploration"
    assert understanding.rag_mode == "deep"
    assert "database_schema" in understanding.source_types


def test_query_understanding_routes_simple_sql_to_shallow_rag():
    understanding = query_understanding_service.understand(
        "Write SQL to list the 10 latest orders",
        database_id="db-1",
        schema="public",
    )

    assert understanding.intent == "text_to_sql"
    assert understanding.needs_retrieval is True
    assert understanding.behavior == "sql_coding"
    assert understanding.rag_mode == "shallow"
    assert understanding.reasoning_mode == "normal"


def test_query_understanding_does_not_use_database_context_for_casual_chat():
    understanding = query_understanding_service.understand(
        "hello",
        database_id="db-1",
        schema="public",
    )

    assert understanding.intent == "general_chat"
    assert understanding.needs_retrieval is False
    assert understanding.behavior == "general_chat"
    assert understanding.rag_mode == "none"


def test_query_understanding_loads_router_terms_from_metadata_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr("services.ai.router_terms.SessionLocal", factory)
    router_term_service.clear_cache()

    session = factory()
    try:
        router_term_service.seed_defaults(session)
        term_set = session.get(AIRouterTermSet, "system:exploration_terms")
        custom_term = "margin leakage"
        session.add(AIRouterTerm(
            id="router-term-custom-margin-leakage",
            termSetId=term_set.id,
            term=custom_term,
            normalizedTerm=normalize_router_text(custom_term),
            language="en",
            matchType="phrase",
            weight=1.0,
            enabled=True,
        ))
        session.commit()
    finally:
        session.close()
    router_term_service.clear_cache()

    understanding = query_understanding_service.understand(
        "Which customers have margin leakage?",
        database_id="db-1",
        schema="public",
    )

    assert understanding.intent == "text_to_sql"
    assert understanding.behavior == "data_exploration"
    assert understanding.rag_mode == "deep"
    router_term_service.clear_cache()


def test_router_term_service_crud_manages_individual_rows(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr("services.ai.router_terms.SessionLocal", factory)
    router_term_service.clear_cache()

    session = factory()
    try:
        router_term_service.seed_defaults(session)
        session.commit()
    finally:
        session.close()

    created = router_term_service.create_term({
        "termSetKey": "sql_coding_terms",
        "term": "cte helper",
        "language": "en",
        "matchType": "phrase",
        "weight": 0.7,
        "enabled": True,
    })
    updated = router_term_service.update_term(created["id"], {"enabled": False, "notes": "temporary"})
    deleted = router_term_service.delete_term(created["id"])

    assert created["term"] == "cte helper"
    assert updated["enabled"] is False
    assert updated["notes"] == "temporary"
    assert deleted == {"deleted": True, "disabled": False, "id": created["id"]}

    term_sets = router_term_service.list_term_sets()
    sql_terms = next(item for item in term_sets if item["key"] == "sql_coding_terms")["terms"]
    system_term = next(item for item in sql_terms if item["term"] == "sql")
    disabled = router_term_service.delete_term(system_term["id"])

    assert disabled == {"deleted": False, "disabled": True, "id": system_term["id"]}
    router_term_service.clear_cache()


def test_schema_index_text_preserves_postgres_mixed_case_column_references():
    text = build_table_search_text(
        "Booking",
        [
            {"name": "id", "type": "TEXT", "nullable": False},
            {"name": "experienceId", "type": "TEXT", "nullable": False},
        ],
        db_type="postgresql",
        schema="public",
        foreign_keys=[{
            "table": "Booking",
            "column": "experienceId",
            "foreignTable": "Experience",
            "foreignColumn": "id",
        }],
    )

    assert 'SQL table reference: "public"."Booking"' in text
    assert 'SQL column reference: "experienceId"' in text
    assert 'table-qualified: "public"."Booking"."experienceId"' in text
    assert 'SQL join reference: "public"."Booking"."experienceId" -> "public"."Experience"."id"' in text


def test_rag_retrieve_uses_lexical_fallback_over_generalized_chunks(rag_session_factory, monkeypatch):
    index_service = RagIndexService()
    retrieval_service = RagRetrievalService()
    monkeypatch.setattr(index_service.embeddings, "is_available", lambda: False)
    monkeypatch.setattr(retrieval_service.embeddings, "is_available", lambda: False)
    monkeypatch.setattr(
        index_service.metadata,
        "get_all_columns",
        lambda *_: {
            "customers": [{"name": "email", "type": "TEXT", "nullable": True}],
            "orders": [{"name": "total_amount", "type": "NUMERIC", "nullable": False}],
        },
    )
    monkeypatch.setattr(index_service.metadata, "get_db_type", lambda *_: "postgresql")
    monkeypatch.setattr(index_service.metadata, "get_all_foreign_keys", lambda *_: [])
    monkeypatch.setattr(index_service.metadata, "get_indexes_for_tables", lambda *_: {})
    index_service.index_database_schema("db-1", "public")

    result = retrieval_service.retrieve("show customer email", database_id="db-1", user_id="user-1", top_k=1)

    assert result["items"][0]["objectName"] == "customers"
    assert result["citations"][0]["id"] == "database:db-1/schema:public/table:customers"
    assert result["retrievalTrace"]["retrievalMode"] == "lexical_fallback"
    assert result["retrievalTrace"]["rankedCandidateCount"] >= result["retrievalTrace"]["selectedCount"]
    assert result["retrievalTrace"]["candidateBudget"] == 32


def test_index_saved_queries_respects_user_scope(rag_session_factory, monkeypatch):
    service = RagIndexService()
    monkeypatch.setattr(service.embeddings, "is_available", lambda: False)
    session = rag_session_factory()
    try:
        owned_id = str(uuid.uuid4())
        other_id = str(uuid.uuid4())
        session.add_all([
            SavedQuery(
                id=owned_id,
                name="Revenue by customer",
                sql="SELECT customer_id, SUM(total) FROM orders GROUP BY customer_id",
                databaseId="db-1",
                userId="user-1",
            ),
            SavedQuery(
                id=other_id,
                name="Private salaries",
                sql="SELECT * FROM salaries",
                databaseId="db-1",
                userId="user-2",
            ),
        ])
        session.commit()
    finally:
        session.close()

    result = service.index_saved_queries("db-1", user_id="user-1")

    session = rag_session_factory()
    try:
        sources = session.query(RagSource).all()
        chunks = session.query(RagChunk).all()
    finally:
        session.close()

    assert result["indexedSources"] == 1
    assert [source.id for source in sources] == [f"saved_query:{owned_id}"]
    assert "Revenue by customer" in chunks[0].content
    assert "Private salaries" not in chunks[0].content


def test_index_query_history_masks_literals_and_skips_failed_by_default(rag_session_factory, monkeypatch):
    service = RagIndexService()
    monkeypatch.setattr(service.embeddings, "is_available", lambda: False)
    session = rag_session_factory()
    try:
        success_id = str(uuid.uuid4())
        failed_id = str(uuid.uuid4())
        session.add_all([
            QueryHistory(
                id=success_id,
                sql="SELECT * FROM users WHERE email = 'alice@example.com' AND age > 42",
                status="SUCCESS",
                executionTime=12,
                databaseId="db-1",
            ),
            QueryHistory(
                id=failed_id,
                sql="SELECT * FROM missing_table WHERE secret = 'token'",
                status="FAILED",
                executionTime=1,
                databaseId="db-1",
            ),
        ])
        session.commit()
    finally:
        session.close()

    result = service.index_query_history("db-1")

    session = rag_session_factory()
    try:
        sources = session.query(RagSource).all()
        chunks = session.query(RagChunk).all()
    finally:
        session.close()

    assert result["indexedSources"] == 1
    assert [source.id for source in sources] == [f"query_history:{success_id}"]
    assert "'alice@example.com'" not in chunks[0].content
    assert "age > ?" in chunks[0].content
    assert "missing_table" not in chunks[0].content


def test_mask_sql_literals_replaces_strings_and_numbers():
    assert mask_sql_literals("email = 'a@b.com' AND total >= 99.5") == "email = '?' AND total >= ?"


def test_index_text_source_chunks_markdown_and_retrieves_document(rag_session_factory, monkeypatch):
    index_service = RagIndexService()
    retrieval_service = RagRetrievalService()
    monkeypatch.setattr(index_service.embeddings, "is_available", lambda: False)
    monkeypatch.setattr(retrieval_service.embeddings, "is_available", lambda: False)

    result = index_service.index_text_source(
        "document",
        "Orders Manual",
        "# Orders\nUse orders.total for revenue reporting.\n\n# Customers\nCustomers contain email addresses.",
        database_id="db-1",
        user_id="user-1",
        uri="manual://orders",
        source_id="document:orders-manual",
    )
    retrieval = retrieval_service.retrieve(
        "revenue reporting",
        database_id="db-1",
        user_id="user-1",
        source_types=["document"],
        top_k=1,
    )

    assert result["chunkCount"] == 2
    assert retrieval["items"][0]["title"] == "Orders Manual"
    assert retrieval["citations"][0]["id"] == "document:orders-manual#chunk-0"


def test_get_and_delete_source_respects_visibility(rag_session_factory, monkeypatch):
    index_service = RagIndexService()
    retrieval_service = RagRetrievalService()
    monkeypatch.setattr(index_service.embeddings, "is_available", lambda: False)
    index_service.index_text_source(
        "document",
        "Private Notes",
        "Only owner can delete this source.",
        user_id="user-1",
        source_id="document:private",
    )

    assert retrieval_service.get_source("document:private", user_id="user-2") is None
    assert retrieval_service.delete_source("document:private", user_id="user-2")["reason"] == "forbidden"
    assert retrieval_service.get_source("document:private", user_id="user-1")["chunkCount"] == 1
    assert retrieval_service.delete_source("document:private", user_id="user-1")["deleted"] is True
    assert retrieval_service.get_source("document:private", user_id="user-1") is None


def test_get_retrieval_events_returns_safe_trace(rag_session_factory):
    session = rag_session_factory()
    try:
        session.add(RagRetrievalEvent(
            id="event-1",
            messageId="message-1",
            databaseId="db-1",
            queryTextHash="hash",
            retrievalMode="lexical_fallback",
            candidateCount=3,
            selectedCount=1,
            latencyMs=7,
            trace={"selectedCount": 1},
        ))
        session.commit()
    finally:
        session.close()

    events = RagRetrievalService().get_retrieval_events("message-1")

    assert events[0]["retrievalMode"] == "lexical_fallback"
    assert events[0]["trace"] == {"selectedCount": 1}


def test_vector_store_config_defaults_to_desktop_safe_backend(monkeypatch):
    monkeypatch.delenv("QURIODB_RAG_VECTOR_BACKEND", raising=False)
    monkeypatch.delenv("QURIODB_RAG_ENABLED", raising=False)

    status = resolve_vector_store_config().to_status()

    assert status["backend"] == "sqlite_vec"
    assert status["enabled"] is True
    assert status["requiresExternalService"] is False
    assert status["supportedBackends"] == ["sqlite_vec"]


def test_vector_store_config_sanitizes_unknown_backend(monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_VECTOR_BACKEND", "unknown-cloud")

    assert resolve_vector_store_config().backend == "sqlite_vec"


def test_vector_store_config_falls_back_from_sqlite_json_to_sqlite_vec(monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_VECTOR_BACKEND", "sqlite_json")

    config = resolve_vector_store_config()
    status = config.to_status()

    assert config.backend == "sqlite_vec"
    assert status["backend"] == "sqlite_vec"
    assert status["supportedBackends"] == ["sqlite_vec"]


def test_vector_store_config_supports_sqlite_vec_without_external_service(monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_VECTOR_BACKEND", "sqlite_vec")

    status = resolve_vector_store_config().to_status()

    assert status["backend"] == "sqlite_vec"
    assert status["requiresExternalService"] is False


def test_index_writes_sqlite_vec_when_backend_is_enabled(rag_session_factory, monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_VECTOR_BACKEND", "sqlite_vec")
    service = RagIndexService()
    monkeypatch.setattr(service.embeddings, "is_available", lambda: True)
    monkeypatch.setattr(service.embeddings, "embed_document", lambda _content: [0.1, 0.2, 0.3])
    upserted = []
    monkeypatch.setattr(index_module.sqlite_vec_store, "upsert_embedding", lambda *_args: upserted.append(True) or True)
    monkeypatch.setattr(index_module.sqlite_vec_store, "delete_source", lambda *_args: None)

    result = service.index_text_source(
        "document",
        "Vector Source",
        "QurioDB indexes local vector chunks.",
        source_id="document:sqlite-vec",
    )

    session = rag_session_factory()
    try:
        embedding_count = session.query(RagEmbedding).count()
    finally:
        session.close()

    assert result["embeddingCount"] == 1
    assert embedding_count == 1
    assert upserted == [True]


def test_retrieval_prefers_sqlite_vec_semantic_scores(rag_session_factory, monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_VECTOR_BACKEND", "sqlite_vec")
    session = rag_session_factory()
    try:
        source = RagSource(
            id="document:semantic",
            sourceType="document",
            title="Semantic Source",
            contentHash="hash",
            status="indexed",
            accessScope="user",
            userId="user-1",
        )
        alpha = RagChunk(
            id="chunk-alpha",
            sourceId=source.id,
            chunkType="document",
            content="alpha lexical text",
            contentHash="alpha",
            ordinal=0,
        )
        beta = RagChunk(
            id="chunk-beta",
            sourceId=source.id,
            chunkType="document",
            content="unrelated terms",
            contentHash="beta",
            ordinal=1,
        )
        session.add_all([source, alpha, beta])
        session.commit()
    finally:
        session.close()

    retrieval_service = RagRetrievalService()
    monkeypatch.setattr(retrieval_service.embeddings, "is_available", lambda: True)
    monkeypatch.setattr(retrieval_service.embeddings, "embed_query", lambda _query: [0.1, 0.2, 0.3])
    monkeypatch.setattr(
        retrieval_module.sqlite_vec_store,
        "semantic_scores",
        lambda *_args, **_kwargs: {"chunk-beta": 0.99},
    )

    result = retrieval_service.retrieve(
        "semantic intent",
        user_id="user-1",
        source_types=["document"],
        top_k=1,
    )

    assert result["items"][0]["chunkId"] == "chunk-beta"
    assert result["retrievalTrace"]["retrievalMode"] == "hybrid"


def test_rag_disabled_short_circuits_index_and_retrieve(rag_session_factory, monkeypatch):
    monkeypatch.setenv("QURIODB_RAG_ENABLED", "false")
    index_service = RagIndexService()
    retrieval_service = RagRetrievalService()

    result = index_service.index_text_source(
        "document",
        "Disabled Source",
        "This should not be indexed while RAG is disabled.",
        source_id="document:disabled",
    )
    retrieval = retrieval_service.retrieve("disabled source")

    session = rag_session_factory()
    try:
        source_count = session.query(RagSource).count()
        chunk_count = session.query(RagChunk).count()
    finally:
        session.close()

    assert result["status"] == "disabled"
    assert result["chunkCount"] == 0
    assert source_count == 0
    assert chunk_count == 0
    assert retrieval["retrievalTrace"]["retrievalMode"] == "disabled"
    assert retrieval["retrievalTrace"]["fallbackReason"] == "rag_disabled"


def test_rag_evaluate_endpoint_runs_retrieval_cases(rag_session_factory, monkeypatch):
    monkeypatch.setattr(route_rag_retrieval_service.embeddings, "is_available", lambda: False)
    index_service = RagIndexService()
    monkeypatch.setattr(index_service.embeddings, "is_available", lambda: False)
    index_service.index_text_source(
        "document",
        "Support Manual",
        "Refund policy requires order_id and customer email.",
        database_id="db-1",
        user_id="user-1",
        source_id="document:support-manual",
    )

    report = evaluate_rag_endpoint(
        RagEvaluateRequest(cases=[{
            "name": "support recall",
            "query": "refund policy customer email",
            "expectedCitations": ["document:support-manual#chunk-0"],
            "databaseId": "db-1",
            "sourceTypes": ["document"],
        }]),
        current_user={"userId": "user-1"},
    )

    assert report["passed"] is True
    assert report["recallAtK"] == 1.0


def test_rag_pipeline_status_maps_all_production_flows():
    status = RagPipelineService().status()

    keys = [stage["key"] for stage in status["stages"]]

    assert status["stageCount"] == 17
    assert "ingestion" in keys
    assert "retrieval" in keys
    assert "argument" in keys
    assert "generation" in keys
    assert "evaluation" in keys
    assert "security_acl" in keys
    assert status["vectorStore"]["backend"] == "sqlite_vec"
    assert status["vectorStore"]["supportedBackends"] == ["sqlite_vec"]


def test_rag_pipeline_plan_returns_understanding_and_context(monkeypatch):
    pipeline = RagPipelineService()
    monkeypatch.setattr(
        "services.ai.langchain_runtime.langchain_runtime.invoke_text",
        lambda **_: '{"intent":"text_to_sql","confidence":0.9,"reason":"test"}',
    )
    monkeypatch.setattr("services.ai.task_model_router.task_model_router.resolve_model_id", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        "services.ai.rag_context.rag_retrieval_service.retrieve",
        lambda *_args, **_kwargs: {
            "items": [{
                "chunkId": "chunk-1",
                "sourceType": "database_schema",
                "chunkType": "table",
                "objectName": "orders",
                "schemaName": "public",
                "title": "public.orders",
                "score": 0.9,
                "content": "Table: orders\nColumns:\n- id integer\n- total numeric",
                "citation": {"id": "database:db-1/schema:public/table:orders"},
            }],
            "citations": [{"id": "database:db-1/schema:public/table:orders"}],
            "retrievalTrace": {"retrievalMode": "lexical_fallback", "selectedCount": 1},
        },
    )
    monkeypatch.setattr("services.ai.rag_context.rag_index_service.index_database_schema", lambda *_args, **_kwargs: {})
    monkeypatch.setattr("services.ai.rag_context.RagContextBuilder._allowed_columns_by_table", lambda *_args, **_kwargs: {"orders": ["total"]})
    monkeypatch.setattr("services.ai.rag_context.RagContextBuilder._schema_table_name", lambda _self, item: item.get("objectName"))
    monkeypatch.setattr("services.ai.retrieval.pipeline.rag_context_builder.metadata.get_db_type", lambda *_: "postgresql")

    plan = pipeline.plan_query("show order totals", database_id="db-1", schema="public", user_id="user-1")

    assert plan["understanding"]["intent"] == "text_to_sql"
    assert plan["understanding"]["behavior"] == "data_exploration"
    assert plan["understanding"]["ragMode"] == "deep"
    assert plan["understanding"]["needsRetrieval"] is True
    assert plan["retrievalTrace"]["selectedCount"] == 1
    assert plan["retrievalTrace"]["ragMode"] == "deep"
    assert plan["argument"]["requiredIdentifiers"] == ["orders"]
    assert plan["argument"]["confidence"] == 3
    assert plan["citations"][0]["id"] == "database:db-1/schema:public/table:orders"
    assert "RAG ARGUMENT" in plan["contextPreview"]
    assert "RETRIEVED EVIDENCE" in plan["contextPreview"]


def test_rag_pipeline_sync_database_indexes_core_sources(rag_session_factory, monkeypatch):
    index_service = RagIndexService()
    pipeline = RagPipelineService(index_service=index_service)
    monkeypatch.setattr(index_service.embeddings, "is_available", lambda: False)
    monkeypatch.setattr(
        index_service.metadata,
        "get_all_columns",
        lambda *_: {"orders": [{"name": "total", "type": "NUMERIC", "nullable": False}]},
    )
    monkeypatch.setattr(index_service.metadata, "get_db_type", lambda *_: "postgresql")
    monkeypatch.setattr(index_service.metadata, "get_all_foreign_keys", lambda *_: [])
    monkeypatch.setattr(index_service.metadata, "get_indexes_for_tables", lambda *_: {})
    session = rag_session_factory()
    try:
        session.add_all([
            SavedQuery(
                id="saved-1",
                name="Revenue",
                sql="SELECT SUM(total) FROM orders",
                databaseId="db-1",
                userId="user-1",
            ),
            QueryHistory(
                id="history-1",
                sql="SELECT * FROM orders WHERE total > 10",
                status="SUCCESS",
                executionTime=5,
                databaseId="db-1",
            ),
        ])
        session.commit()
    finally:
        session.close()

    result = pipeline.sync_database(
        "db-1",
        schema="public",
        user_id="user-1",
        include_saved_queries=True,
        include_query_history=True,
    )

    assert result["summary"]["sourceTypes"] == 3
    assert result["sources"]["database_schema"]["chunkCount"] == 2
    assert result["sources"]["saved_query"]["indexedSources"] == 1
    assert result["sources"]["query_history"]["indexedSources"] == 1
