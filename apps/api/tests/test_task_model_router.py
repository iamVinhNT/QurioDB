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


def test_generation_options_apply_scoped_values_and_reach_inference(monkeypatch):
    from unittest.mock import Mock
    from services.ai.base import BaseAIService
    _install_memory_db(monkeypatch)
    router = router_module.task_model_router
    router.upsert_assignments('user-1', [
        {'taskKey': 'sql.generate', 'modelId': 'gpt-5.4', 'temperature': 0.4, 'maxTokens': 2048},
        {'taskKey': 'sql.generate', 'databaseId': 'db-1', 'modelId': 'gpt-5.4', 'temperature': 0, 'maxTokens': 512},
    ])
    assert router.generation_options('sql.generate', 'user-1') == {'temperature': 0.4, 'max_tokens': 2048}
    invoke = Mock(return_value='SELECT 1')
    monkeypatch.setattr('services.ai.base.langchain_runtime.invoke_text', invoke)
    monkeypatch.setattr('services.ai.base.langchain_runtime.resolve_provider', lambda **_: 'openai')
    assert BaseAIService()._generate_response('SQL', user_id='user-1', task_key='sql.generate', db_id='db-1', model_id='gemini-2.5-flash') == 'SELECT 1'
    assert invoke.call_args.kwargs['model_id'] == 'gemini-2.5-flash'
    assert invoke.call_args.kwargs['temperature'] == 0
    assert invoke.call_args.kwargs['max_tokens'] == 512
    router.upsert_assignments('user-1', [{'taskKey': 'sql.generate', 'databaseId': 'db-1', 'enabled': False}])
    assert router.generation_options('sql.generate', 'user-1', 'db-1') == {}


def test_stream_generation_options_reach_provider_and_preserve_model(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock
    from services.ai_service import AIService, _stream_selection
    from services.ai.langchain_runtime import LangChainRuntime
    runtime = LangChainRuntime()
    model = SimpleNamespace(stream=lambda *args, **kwargs: [SimpleNamespace(content='ok')])
    build = Mock(return_value=model)
    monkeypatch.setattr(runtime, 'build_model', build)
    monkeypatch.setattr(runtime, 'make_messages', lambda *args, **kwargs: [])
    monkeypatch.setattr('services.ai_service.langchain_runtime.stream_text', runtime.stream_text)
    state = {'model': 'chosen', 'provider': 'google', 'generation_options': {'temperature': 0, 'max_tokens': 512}}
    token = _stream_selection.set(state)
    try:
        assert list(AIService()._stream_model_text(system_prompt='SQL', prompt='Generate')) == ['ok']
    finally:
        _stream_selection.reset(token)
    assert build.call_args.args == ('chosen',)
    assert build.call_args.kwargs['temperature'] == 0
    assert build.call_args.kwargs['max_tokens'] == 512
