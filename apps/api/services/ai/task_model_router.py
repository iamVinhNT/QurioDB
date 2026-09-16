"""
task_model_router.py

Task-aware model routing helpers for QurioDB AI services.
"""

import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from models import AIModel, AITaskAssignment, SessionLocal

GLOBAL_DATABASE_SCOPE = "__global__"


TASK_CATALOG: List[Dict[str, Any]] = [
    {
        "key": "chat.general",
        "name": "General chat",
        "description": "Fast assistant responses that do not need database context.",
        "requiredCapabilities": ["supportsStreaming"],
        "recommendedCapabilities": ["latencyTier:fast"],
    },
    {
        "key": "chat.database",
        "name": "Database chat",
        "description": "Schema-aware chat with retrieval context and citations.",
        "requiredCapabilities": ["supportsStreaming"],
        "recommendedCapabilities": ["supportsReasoning"],
    },
    {
        "key": "sql.generate",
        "name": "Generate SQL",
        "description": "Create SQL or database queries from natural language.",
        "requiredCapabilities": ["supportsStreaming"],
        "recommendedCapabilities": ["supportsReasoning"],
    },
    {
        "key": "sql.explain",
        "name": "Explain SQL",
        "description": "Explain existing SQL in natural language.",
        "requiredCapabilities": [],
        "recommendedCapabilities": ["latencyTier:fast"],
    },
    {
        "key": "sql.optimize",
        "name": "Optimize SQL",
        "description": "Rewrite SQL for performance and clearer execution plans.",
        "requiredCapabilities": [],
        "recommendedCapabilities": ["supportsReasoning"],
    },
    {
        "key": "sql.fix",
        "name": "Fix SQL",
        "description": "Repair broken SQL using the current error and schema context.",
        "requiredCapabilities": [],
        "recommendedCapabilities": ["supportsReasoning"],
    },
    {
        "key": "sql.autocomplete",
        "name": "Autocomplete",
        "description": "Low-latency inline SQL completion in the editor.",
        "requiredCapabilities": [],
        "recommendedCapabilities": ["latencyTier:fast"],
    },
    {
        "key": "agent.sql_readonly",
        "name": "Read-only SQL agent",
        "description": "Plan, generate, validate, repair, and preview safe read-only SQL.",
        "requiredCapabilities": ["supportsJsonMode"],
        "recommendedCapabilities": ["supportsStructuredOutput", "supportsReasoning"],
    },
    {
        "key": "agent.mongodb_readonly",
        "name": "Read-only MongoDB agent",
        "description": "Plan, generate, validate, repair, and execute safe read-only MongoDB JSON query specs.",
        "requiredCapabilities": ["supportsJsonMode"],
        "recommendedCapabilities": ["supportsStructuredOutput", "supportsReasoning"],
    },
    {
        "key": "router.triage",
        "name": "Task triage",
        "description": "Classify AI requests before specialized execution.",
        "requiredCapabilities": ["supportsJsonMode"],
        "recommendedCapabilities": ["latencyTier:fast"],
    },
]

TASK_KEYS = {task["key"] for task in TASK_CATALOG}


@dataclass(frozen=True)
class ResolvedTaskModel:
    model_id: Optional[str]
    source: str
    fallback_model_id: Optional[str] = None


def normalize_database_scope(database_id: Optional[str]) -> str:
    """Return the persisted routing scope for optional database-specific assignments."""
    return database_id or GLOBAL_DATABASE_SCOPE


class TaskModelRouter:
    """Resolves the best model for a task using user assignment preferences."""

    def catalog(self) -> List[Dict[str, Any]]:
        return TASK_CATALOG

    def list_assignments(self, user_id: str, database_id: Optional[str] = None) -> List[Dict[str, Any]]:
        session = SessionLocal()
        try:
            query = session.query(AITaskAssignment).filter(AITaskAssignment.userId == user_id)
            scopes = [GLOBAL_DATABASE_SCOPE]
            if database_id:
                scopes.append(database_id)
            assignments = query.filter(AITaskAssignment.databaseId.in_(scopes)).all()
            return [assignment.to_dict() for assignment in assignments]
        finally:
            session.close()

    def upsert_assignments(self, user_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        session = SessionLocal()
        try:
            saved = []
            for item in items:
                task_key = item.get("taskKey")
                if task_key not in TASK_KEYS:
                    raise ValueError(f"Unsupported AI task: {task_key}")

                model_id = _clean_model_id(item.get("modelId"))
                fallback_model_id = _clean_model_id(item.get("fallbackModelId"))
                self._validate_model_exists(session, model_id)
                self._validate_model_exists(session, fallback_model_id)

                database_scope = normalize_database_scope(item.get("databaseId"))
                assignment = (
                    session.query(AITaskAssignment)
                    .filter(
                        AITaskAssignment.userId == user_id,
                        AITaskAssignment.taskKey == task_key,
                        AITaskAssignment.databaseId == database_scope,
                    )
                    .first()
                )
                if not assignment:
                    assignment = AITaskAssignment(
                        id=str(uuid.uuid4()),
                        userId=user_id,
                        taskKey=task_key,
                        databaseId=database_scope,
                    )
                    session.add(assignment)

                assignment.modelId = model_id
                assignment.fallbackModelId = fallback_model_id
                assignment.temperature = _optional_float(item.get("temperature"))
                assignment.maxTokens = _optional_int(item.get("maxTokens"))
                assignment.enabled = bool(item.get("enabled", True))
                saved.append(assignment)

            session.commit()
            return [assignment.to_dict() for assignment in saved]
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def resolve_model(
        self,
        task_key: Optional[str],
        user_id: Optional[str],
        explicit_model_id: Optional[str] = None,
        database_id: Optional[str] = None,
    ) -> ResolvedTaskModel:
        """Resolve request override, scoped assignment, then global assignment."""
        if explicit_model_id:
            return ResolvedTaskModel(model_id=explicit_model_id, source="request")
        if not task_key or not user_id:
            return ResolvedTaskModel(model_id=None, source="default")

        assignment = self._find_assignment(task_key, user_id, database_id)
        fallback_task = False
        if not assignment and task_key == "agent.mongodb_readonly":
            assignment = self._find_assignment("agent.sql_readonly", user_id, database_id)
            fallback_task = assignment is not None
        if not assignment:
            return ResolvedTaskModel(model_id=None, source="default")

        if assignment.enabled and assignment.modelId:
            return ResolvedTaskModel(
                model_id=assignment.modelId,
                source="fallback_task" if fallback_task else "task_assignment",
                fallback_model_id=assignment.fallbackModelId,
            )
        if assignment.fallbackModelId:
            return ResolvedTaskModel(model_id=assignment.fallbackModelId, source="fallback")
        return ResolvedTaskModel(model_id=None, source="default")

    def resolve_model_id(
        self,
        task_key: Optional[str],
        user_id: Optional[str],
        explicit_model_id: Optional[str] = None,
        database_id: Optional[str] = None,
    ) -> Optional[str]:
        return self.resolve_model(task_key, user_id, explicit_model_id, database_id).model_id

    def _find_assignment(self, task_key: str, user_id: str, database_id: Optional[str]) -> Optional[AITaskAssignment]:
        session = SessionLocal()
        try:
            scopes = []
            if database_id:
                scopes.append(database_id)
            scopes.append(GLOBAL_DATABASE_SCOPE)
            for scope in scopes:
                assignment = (
                    session.query(AITaskAssignment)
                    .filter(
                        AITaskAssignment.userId == user_id,
                        AITaskAssignment.taskKey == task_key,
                        AITaskAssignment.databaseId == scope,
                    )
                    .first()
                )
                if assignment:
                    return assignment
            return None
        finally:
            session.close()

    def _validate_model_exists(self, session, model_id: Optional[str]) -> None:
        if not model_id:
            return
        exists = session.query(AIModel).filter(AIModel.modelId == model_id).first()
        if not exists:
            raise ValueError(f"Unknown AI model: {model_id}")


def _clean_model_id(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _optional_float(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    return float(value)


def _optional_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    return int(value)


task_model_router = TaskModelRouter()
