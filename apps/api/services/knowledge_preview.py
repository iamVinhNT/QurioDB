"""knowledge_preview.py — Retrieval-only preview and immutable section anchors."""

import json

from services.knowledge_service import knowledge_service
from services.knowledge_embeddings import KnowledgeEmbeddingGateway
from services.ai.retrieval.index_documents import build_text_document_chunks
from services.ai.retrieval.retrieval_service import RagRetrievalService
from services.ai.retrieval.graph_retrieval import graph_retrieval_service


def revision_sections(revision):
    body = revision["bodyMarkdown"]
    if any((revision.get("definitionData") or {}).values()):
        body += "\n\n## Reviewed definitions and bindings\n" + json.dumps(revision["definitionData"], ensure_ascii=False)
    chunks = build_text_document_chunks(f"knowledge:{revision['id']}", revision["title"], body)
    return [{"id": f"section-{c['ordinal']}", "heading": c["objectName"], "content": c["content"]} for c in chunks]


def preview_knowledge(base_id, data, user_id):
    base = knowledge_service.get_base(base_id, user_id)
    retriever = RagRetrievalService(embedding_gateway=KnowledgeEmbeddingGateway(user_id))
    result = retriever.retrieve(data.query, database_id=base["databaseId"], user_id=user_id,
        source_types=["database_schema", "knowledge_document"], top_k=12,
        schema_name=data.schemaName, knowledge_base_id=base_id)
    items, trace = graph_retrieval_service.expand(data.query, result["items"], base["databaseId"], data.schemaName, user_id, base_id)
    selected, words = [], 0
    for item in items:
        count = len(item.get("content", "").split())
        if words + count > 4500:
            trace.setdefault("gaps", []).append("graph_context_budget_exceeded")
            break
        selected.append(item)
        words += count
    return {"items": selected, "graph": trace, "retrievalTrace": result["retrievalTrace"],
            "enabledForSql": base["enabledForSql"], "warnings": trace.get("gaps", []),
            "embeddingProvider": "google", "embeddingModel": retriever.embeddings.model, "executesSql": False}
