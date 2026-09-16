"""
test_task_model_router.py

Regression tests for task-aware AI model routing assignments.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import services.ai.task_model_router as router_module
from models import AIModel, Base, Role, User
from services.ai.task_model_router import GLOBAL_DATABASE_SCOPE, TaskModelRouter


def _install_memory_db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    monkeypatch.setattr(router_module, "SessionLocal", session_factory)

    session = session_factory()
    try:
        session.add(Role(id="role-1", name="Admin", description="Admin"))
        session.add(User(
            id="user-1",
            email="admin@example.test",
            username="admin",
            password="hash",
            roleId="role-1",
        ))
        session.add(AIModel(
            id="model-1",
            name="Fast Gemini",
            modelId="gemini-2.5-flash",
            provider="Google",
        ))
        session.add(AIModel(
            id="model-2",
            name="Reasoning OpenAI",
            modelId="gpt-5.4",
            provider="OpenAI",
        ))
        session.commit()
    finally:
        session.close()


def test_task_assignment_resolves_global_model(monkeypatch):
    _install_memory_db(monkeypatch)
    router = TaskModelRouter()

    saved = router.upsert_assignments("user-1", [{
        "taskKey": "sql.generate",
        "modelId": "gpt-5.4",
        "fallbackModelId": "gemini-2.5-flash",
        "enabled": True,
    }])

    assert saved[0]["databaseId"] is None
    assert router.resolve_model_id("sql.generate", "user-1") == "gpt-5.4"


def test_request_model_override_wins_over_assignment(monkeypatch):
    _install_memory_db(monkeypatch)
    router = TaskModelRouter()

    router.upsert_assignments("user-1", [{
        "taskKey": "sql.optimize",
        "modelId": "gpt-5.4",
        "enabled": True,
    }])

    resolved = router.resolve_model(
        "sql.optimize",
        "user-1",
        explicit_model_id="gemini-2.5-flash",
    )

    assert resolved.model_id == "gemini-2.5-flash"
    assert resolved.source == "request"


def test_disabled_assignment_uses_fallback_model(monkeypatch):
    _install_memory_db(monkeypatch)
    router = TaskModelRouter()

    router.upsert_assignments("user-1", [{
        "taskKey": "agent.sql_readonly",
        "modelId": "gpt-5.4",
        "fallbackModelId": "gemini-2.5-flash",
        "databaseId": GLOBAL_DATABASE_SCOPE,
        "enabled": False,
    }])

    resolved = router.resolve_model("agent.sql_readonly", "user-1")

    assert resolved.model_id == "gemini-2.5-flash"
    assert resolved.source == "fallback"


def test_mongodb_agent_falls_back_to_sql_agent_assignment_without_migration(monkeypatch):
    _install_memory_db(monkeypatch)
    router = TaskModelRouter()

    router.upsert_assignments("user-1", [{
        "taskKey": "agent.sql_readonly",
        "modelId": "gpt-5.4",
        "fallbackModelId": "gemini-2.5-flash",
        "enabled": True,
    }])

    resolved = router.resolve_model("agent.mongodb_readonly", "user-1")

    assert resolved.model_id == "gpt-5.4"
    assert resolved.source == "fallback_task"
