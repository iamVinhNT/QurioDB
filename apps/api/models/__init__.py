"""
models

Public exports for QurioDB metadata database models and database session helpers.
"""

from .ai_chat_message import AIChatMessage
from .ai_conversation import AIConversation
from .ai_feedback import AIFeedback
from .ai_generated_query import AIGeneratedQuery
from .ai_model import AIModel
from .ai_router_term import AIRouterTerm
from .ai_router_term_set import AIRouterTermSet
from .ai_task_assignment import AITaskAssignment
from .base import Base
from .database import DATABASE_URL, SessionLocal, engine
from .db import Db
from .enums import Environment, SSLMode
from .query_history import QueryHistory
from .rag_chunk import RagChunk
from .rag_embedding import RagEmbedding
from .rag_retrieval_event import RagRetrievalEvent
from .rag_source import RagSource
from .knowledge import KnowledgeBase, KnowledgeDocument, KnowledgeRevision, KnowledgeIndexJob
from .rag_graph import GraphNode, GraphEdge, GraphEvidence
from .role import Role
from .saved_query import SavedQuery
from .schema_embedding import SchemaEmbedding
from .user import User
from .user_ai_config import UserAIConfig
from .user_setting import UserSetting

__all__ = [
    "AIChatMessage",
    "AIConversation",
    "AIFeedback",
    "AIGeneratedQuery",
    "AIModel",
    "AIRouterTerm",
    "AIRouterTermSet",
    "AITaskAssignment",
    "Base",
    "DATABASE_URL",
    "Db",
    "Environment",
    "QueryHistory",
    "RagChunk",
    "RagEmbedding",
    "RagRetrievalEvent",
    "RagSource",
    "KnowledgeBase",
    "KnowledgeDocument",
    "KnowledgeRevision",
    "KnowledgeIndexJob",
    "GraphNode",
    "GraphEdge",
    "GraphEvidence",
    "Role",
    "SSLMode",
    "SavedQuery",
    "SchemaEmbedding",
    "SessionLocal",
    "User",
    "UserAIConfig",
    "UserSetting",
    "engine",
]
