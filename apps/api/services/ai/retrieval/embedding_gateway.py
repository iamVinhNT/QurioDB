"""embedding_gateway.py — Owner-scoped Google embeddings with bounded HTTP attempts."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


class GeminiEmbeddingGateway:
    """Resolve current credentials for each operation, with lexical fallback offline."""

    def __init__(self, model: str = "models/gemini-embedding-2-preview", user_id: Optional[str] = None):
        self.model = model
        self.user_id = user_id

    def for_user(self, user_id):
        return self if self.user_id == user_id else GeminiEmbeddingGateway(self.model, user_id)

    def _get_api_key(self):
        if not self.user_id:
            return None
        from services.ai.langchain_runtime import get_ai_api_key
        return get_ai_api_key(user_id=self.user_id, provider="google")

    def is_available(self):
        return bool(self._get_api_key())

    def embed_document(self, content):
        return self._embed(content, "RETRIEVAL_DOCUMENT")

    def embed_query(self, content):
        return self._embed(content, "RETRIEVAL_QUERY")

    def _embed(self, content, task_type):
        key = self._get_api_key()
        if not key:
            return []
        from google import genai
        from google.genai import types
        try:
            with genai.Client(api_key=key, http_options=types.HttpOptions(
                timeout=10000, retry_options=types.HttpRetryOptions(attempts=1),
            )) as client:
                result = client.models.embed_content(model=self.model, contents=content,
                    config=types.EmbedContentConfig(task_type=task_type))
                return list(result.embeddings[0].values) if result.embeddings else []
        except Exception as exc:
            logger.warning("Embedding unavailable: %s", type(exc).__name__)
            return []
