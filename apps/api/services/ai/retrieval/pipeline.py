"""
pipeline.py

Production RAG pipeline coordination helpers for status reporting, query
planning, and deterministic source synchronization.
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from services.ai.query_understanding import QueryUnderstanding, query_understanding_service
from services.ai.rag_context import RagContextPackage, rag_context_builder
from services.ai.retrieval.index_service import RagIndexService, rag_index_service
from services.ai.retrieval.retrieval_service import RagRetrievalService, rag_retrieval_service
from services.ai.retrieval.vector_store import resolve_vector_store_config


PRODUCTION_RAG_STAGES = [
    {
        "key": "ingestion",
        "name": "Data ingestion",
        "status": "available",
        "capabilities": ["database_schema", "saved_query", "query_history", "document", "web_page", "file_upload", "url_fetch"],
        "endpoints": ["/api/rag/index/source", "/api/rag/ingest/file", "/api/rag/ingest/url", "/api/rag/pipeline/sync/database/{database_id}"],
    },
    {
        "key": "preprocessing",
        "name": "Preprocessing and redaction",
        "status": "available",
        "capabilities": ["markdown_sections", "sql_literal_masking", "secret_redaction"],
    },
    {
        "key": "chunking",
        "name": "Chunking",
        "status": "available",
        "capabilities": ["schema_table_chunks", "schema_graph_chunks", "heading_aware_document_chunks"],
    },
    {
        "key": "embedding_indexing",
        "name": "Embedding and indexing",
        "status": "available",
        "capabilities": ["sqlite_vec_acceleration", "lexical_index", "optional_gemini_embeddings"],
    },
    {
        "key": "sync_update_delete",
        "name": "Sync, update, and delete",
        "status": "available",
        "capabilities": ["source_upsert", "chunk_replacement", "source_delete", "database_sync"],
        "endpoints": ["/api/rag/pipeline/sync/database/{database_id}", "/api/rag/sources/{source_id}"],
    },
    {
        "key": "query_understanding",
        "name": "Query understanding",
        "status": "available",
        "capabilities": ["intent_classification", "follow_up_rewrite", "source_type_planning"],
    },
    {
        "key": "retrieval",
        "name": "Retrieval",
        "status": "available",
        "capabilities": ["metadata_filtering", "lexical_search", "semantic_search_when_embedded"],
    },
    {
        "key": "reranking",
        "name": "Reranking",
        "status": "available",
        "capabilities": ["candidate_pool", "deterministic_identifier_boost", "source_priority"],
    },
    {
        "key": "context_assembly",
        "name": "Context assembly",
        "status": "available",
        "capabilities": ["token_budget", "chunk_compression", "citations", "identifier_contract"],
    },
    {
        "key": "argument",
        "name": "Argument planning",
        "status": "available",
        "capabilities": ["evidence_claims", "identifier_constraints", "known_gaps", "generation_confidence"],
    },
    {
        "key": "generation",
        "name": "Generation",
        "status": "available",
        "capabilities": ["langchain_runtime", "task_model_routing", "provider_adapters"],
    },
    {
        "key": "postprocessing_guardrails",
        "name": "Post-processing and guardrails",
        "status": "available",
        "capabilities": ["stream_tag_parser", "sql_safety_validation", "prompt_injection_warning"],
    },
    {
        "key": "feedback",
        "name": "Feedback",
        "status": "available",
        "capabilities": ["message_feedback", "few_shot_feedback_context"],
    },
    {
        "key": "evaluation",
        "name": "Evaluation",
        "status": "available",
        "capabilities": ["golden_retrieval_cases", "recall_at_k", "mrr", "latency_pass_rate"],
        "endpoints": ["/api/rag/evaluate"],
    },
    {
        "key": "observability",
        "name": "Observability",
        "status": "available",
        "capabilities": ["retrieval_trace", "rag_events", "safe_diagnostics"],
        "endpoints": ["/api/ai/diagnostics", "/api/rag/events/{message_id}"],
    },
    {
        "key": "security_acl",
        "name": "Security and ACL",
        "status": "available",
        "capabilities": ["jwt_user_scope", "source_visibility_filter", "secret_masking"],
    },
    {
        "key": "operations_configuration",
        "name": "Operations and configuration",
        "status": "available",
        "capabilities": ["rag_enabled_flag", "vector_backend_status", "budget_env_vars"],
        "endpoints": ["/api/rag/status", "/api/rag/pipeline/status"],
    },
]


@dataclass(frozen=True)
class RagPipelineContext:
    """Query understanding plus the assembled RAG context package."""

    understanding: QueryUnderstanding
    package: RagContextPackage


class RagPipelineService:
    """Coordinates production RAG control-plane operations."""

    def __init__(
        self,
        index_service: Optional[RagIndexService] = None,
        retrieval_service: Optional[RagRetrievalService] = None,
    ):
        self.index_service = index_service or rag_index_service
        self.retrieval_service = retrieval_service or rag_retrieval_service

    def status(self) -> Dict[str, Any]:
        """Returns the configured production RAG flow map."""
        vector_config = resolve_vector_store_config().to_status()
        return {
            "enabled": vector_config["enabled"],
            "vectorStore": vector_config,
            "stageCount": len(PRODUCTION_RAG_STAGES),
            "stages": PRODUCTION_RAG_STAGES,
        }

    def plan_query(
        self,
        query: str,
        database_id: Optional[str] = None,
        schema: str = "public",
        history: Optional[List[Dict[str, str]]] = None,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Runs query planning and context assembly without invoking a model."""
        result = self.build_context(query, database_id, schema, history, user_id, model_id)
        understanding = result.understanding
        package = result.package
        return {
            "understanding": {
                "intent": understanding.intent,
                "behavior": understanding.behavior,
                "confidence": understanding.confidence,
                "reason": understanding.reason,
                "complexity": understanding.complexity,
                "explorationScore": understanding.exploration_score,
                "ragMode": understanding.rag_mode,
                "reasoningMode": understanding.reasoning_mode,
                "needsRetrieval": understanding.needs_retrieval,
                "retrievalQuery": understanding.retrieval_query,
                "sourceTypes": understanding.source_types,
                "databaseId": understanding.database_id,
                "schema": understanding.schema,
                "filters": understanding.filters,
            },
            "retrievalTrace": package.retrieval_trace,
            "argument": package.argument,
            "citations": package.citations,
            "warnings": package.warnings,
            "contextPreview": package.context[:2000],
            "contextLength": len(package.context),
        }

    def build_context(
        self,
        query: str,
        database_id: Optional[str] = None,
        schema: str = "public",
        history: Optional[List[Dict[str, str]]] = None,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> RagPipelineContext:
        """Runs query understanding and context assembly for the AI hot path."""
        understanding = self.understand_query(query, database_id, schema, history, user_id, model_id)
        package = self.build_context_for_understanding(understanding, user_id=user_id)
        return RagPipelineContext(understanding=understanding, package=package)

    def understand_query(
        self,
        query: str,
        database_id: Optional[str] = None,
        schema: str = "public",
        history: Optional[List[Dict[str, str]]] = None,
        user_id: Optional[str] = None,
        model_id: Optional[str] = None,
    ) -> QueryUnderstanding:
        """Runs AI-assisted query planning without touching retrieval stores."""
        return query_understanding_service.understand(
            query,
            history or [],
            database_id,
            schema,
            user_id=user_id,
            model_id=model_id,
        )

    def build_context_for_understanding(
        self,
        understanding: QueryUnderstanding,
        user_id: Optional[str] = None,
    ) -> RagContextPackage:
        """Builds the retrieval context after model readiness has passed."""
        return rag_context_builder.build(understanding, user_id=user_id)

    def build_sql_context(self, query, database_id, schema="public", user_id=None, *, deep=False):
        """Known SQL tasks reuse retrieval without an extra classification request."""
        understanding = QueryUnderstanding(
            intent="text_to_sql", retrieval_query=query, needs_retrieval=bool(database_id),
            source_types=["database_schema", "saved_query", "query_history", "knowledge_document"],
            database_id=database_id, schema=schema or "public", behavior="sql_coding",
            rag_mode="deep" if deep else "shallow", reasoning_mode="normal",
        )
        return self.build_context_for_understanding(understanding, user_id=user_id)

    def sync_database(
        self,
        database_id: str,
        schema: str = "public",
        user_id: Optional[str] = None,
        include_saved_queries: bool = True,
        include_query_history: bool = False,
        include_failed_history: bool = False,
        query_history_limit: int = 100,
    ) -> Dict[str, Any]:
        """Rebuilds the major RAG sources for one database."""
        results = {
            "databaseId": database_id,
            "schema": schema or "public",
            "sources": {},
        }
        results["sources"]["database_schema"] = self.index_service.index_database_schema(
            database_id,
            schema=schema or "public",
            user_id=user_id,
        )
        schema_result = results["sources"]["database_schema"]
        results["graph"] = {"status": "synced" if schema_result["status"] == "indexed" else schema_result["status"],
                            "snapshotHash": schema_result.get("snapshotHash")}
        if include_saved_queries:
            results["sources"]["saved_query"] = self.index_service.index_saved_queries(
                database_id,
                user_id=user_id,
            )
        if include_query_history:
            results["sources"]["query_history"] = self.index_service.index_query_history(
                database_id,
                include_failed=include_failed_history,
                limit=query_history_limit,
                user_id=user_id,
            )

        results["summary"] = self._sync_summary(results["sources"])
        return results

    def _sync_summary(self, sources: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
        return {
            "sourceTypes": len(sources),
            "indexedSources": sum(int(source.get("indexedSources", 1)) for source in sources.values()),
            "chunks": sum(int(source.get("chunkCount", 0)) for source in sources.values()),
            "embeddings": sum(int(source.get("embeddingCount", 0)) for source in sources.values()),
        }


rag_pipeline_service = RagPipelineService()
