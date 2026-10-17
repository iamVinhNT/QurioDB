"""knowledge_embeddings.py — Knowledge publishing uses the common owner-scoped gateway."""

from services.ai.retrieval.embedding_gateway import GeminiEmbeddingGateway


class KnowledgeEmbeddingGateway(GeminiEmbeddingGateway):
    def __init__(self, user_id):
        super().__init__(user_id=user_id)
