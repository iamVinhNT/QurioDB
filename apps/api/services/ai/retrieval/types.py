"""
types.py

Typed retrieval result objects used by schema RAG and retrieval traces.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List


@dataclass(frozen=True)
class TableRetrievalResult:
    """Ranked table retrieval result with signal-level details for prompt context."""

    table_name: str
    score: float
    semantic_score: float
    lexical_score: float
    matched_terms: List[str]
    schema_name: str = "public"
    columns: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)

    def to_trace_item(self) -> Dict[str, Any]:
        """Serializes retrieval evidence without connection secrets."""
        return {
            "name": self.table_name,
            "schema": self.schema_name,
            "score": round(self.score, 4),
            "semanticScore": round(self.semantic_score, 4),
            "lexicalScore": round(self.lexical_score, 4),
            "columns": self.columns,
            "reasons": self.reasons,
        }

    def to_citation(self, database_id: str) -> Dict[str, Any]:
        """Builds a user-visible citation for retrieved schema evidence."""
        citation_id = f"database:{database_id}/schema:{self.schema_name}/table:{self.table_name}"
        return {
            "id": citation_id,
            "sourceType": "database_schema",
            "title": f"{self.schema_name}.{self.table_name}",
            "objectName": self.table_name,
            "schemaName": self.schema_name,
            "score": round(self.score, 4),
            "matchedTerms": self.matched_terms,
            "reasons": self.reasons,
        }


@dataclass(frozen=True)
class RagRetrievalResult:
    """Ranked generalized RAG chunk with citation and trace serialization."""

    chunk_id: str
    source_id: str
    source_type: str
    title: str
    content: str
    score: float
    semantic_score: float
    lexical_score: float
    matched_terms: List[str]
    database_id: str | None = None
    user_id: str | None = None
    chunk_type: str = "paragraph"
    object_name: str | None = None
    schema_name: str | None = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    reasons: List[str] = field(default_factory=list)

    def to_trace_item(self) -> Dict[str, Any]:
        """Serializes generalized retrieval evidence without sensitive content."""
        return {
            "chunkId": self.chunk_id,
            "sourceId": self.source_id,
            "sourceType": self.source_type,
            "title": self.title,
            "chunkType": self.chunk_type,
            "objectName": self.object_name,
            "schemaName": self.schema_name,
            "score": round(self.score, 4),
            "semanticScore": round(self.semantic_score, 4),
            "lexicalScore": round(self.lexical_score, 4),
            "matchedTerms": self.matched_terms,
            "reasons": self.reasons,
        }

    def to_citation(self) -> Dict[str, Any]:
        """Builds a compact citation for assistant answers."""
        citation_id = self.metadata.get("citation") or f"rag:{self.source_id}/chunk:{self.chunk_id}"
        return {
            **{key: self.metadata[key] for key in ("documentId", "revisionId", "knowledgeBaseId", "section") if key in self.metadata},
            "id": citation_id,
            "sourceType": self.source_type,
            "title": self.title,
            "chunkType": self.chunk_type,
            "objectName": self.object_name,
            "schemaName": self.schema_name,
            "score": round(self.score, 4),
            "matchedTerms": self.matched_terms,
            "reasons": self.reasons,
        }
