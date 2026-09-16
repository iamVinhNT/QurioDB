"""
test_ai_mongodb_api_contract.py

API-level regression coverage for MongoDB agent response compatibility.
"""

import json
from types import SimpleNamespace

from pymongo.errors import OperationFailure

from services.ai.agent import AgentAIService
from services.ai_service import ai_service
from services.ai.conversation_store import conversation_store


def test_mongodb_agent_route_redacts_conversation_title_without_database_type_lookup(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "routes.ai_generation.SchemaMetadataSource.get_db_type",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("lookup unavailable")),
    )
    monkeypatch.setattr(
        conversation_store,
        "ensure_conversation",
        lambda *args: (captured.update(args=args) or "conversation-1"),
    )
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {"type": "query_result", "data": [], "columns": []},
    )
    raw_prompt = "Show orders mongodb://user:secret@example.test/analytics password=secret"

    response = client.post(
        "/api/ai/agent",
        json={"prompt": raw_prompt, "databaseId": "db-1"},
    )

    assert response.status_code == 200
    title_seed = captured["args"][2]
    assert "mongodb://user:secret@example.test/analytics" not in title_seed
    assert "password=secret" not in title_seed
    assert "Show orders" in title_seed


def test_mongodb_agent_route_redacts_mongodb_conversation_title_seed(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        "routes.ai_generation.SchemaMetadataSource.get_db_type",
        lambda *_args, **_kwargs: "mongodb",
    )
    monkeypatch.setattr(
        conversation_store,
        "ensure_conversation",
        lambda *args: (captured.update(args=args) or "conversation-1"),
    )
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {"type": "query_result", "data": [], "columns": []},
    )
    raw_prompt = "Show orders mongodb://user:secret@example.test/analytics password=secret"

    response = client.post(
        "/api/ai/agent",
        json={"prompt": raw_prompt, "databaseId": "db-1"},
    )

    assert response.status_code == 200
    title_seed = captured["args"][2]
    assert "mongodb://user:secret@example.test/analytics" not in title_seed
    assert "password=secret" not in title_seed
    assert "Show orders" in title_seed


def test_mongodb_agent_route_uses_real_mongodb_agent_declared_error(client, monkeypatch):
    service = AgentAIService()
    context = SimpleNamespace(
        context="DATABASE DIALECT: MONGODB\nCOLLECTION: orders",
        collections=("orders",),
        field_allowlist={"orders": ("_id", "status")},
        array_field_allowlist={},
        database="analytics",
        accessible_databases=("analytics",),
        retrieval_trace={},
        citations=[],
    )
    monkeypatch.setattr(
        "services.ai.agent.schema_context_service.build_schema_context",
        lambda *_args, **_kwargs: context,
    )
    monkeypatch.setattr(
        service,
        "_generate_response",
        lambda *_args, **_kwargs: json.dumps({
            "type": "error",
            "message": "mongodb://user:secret@example.test/db password=secret",
            "query": None,
        }),
    )
    monkeypatch.setattr(ai_service, "execute_agent", service.execute_agent)
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")
    monkeypatch.setattr(service, "_get_database_type", lambda *_args: "mongodb")

    response = client.post(
        "/api/ai/agent",
        json={"prompt": "show orders", "databaseId": "db-1"},
    )

    assert response.status_code == 400
    detail = response.json["detail"]
    assert detail["queryLanguage"] == "mongodb"
    assert detail["retryCount"] == 0
    assert detail["maxRetries"] == 2
    assert "secret" not in response.text


def test_mongodb_agent_route_preserves_conversation_and_compatibility_fields(client, monkeypatch):
    captured = {}
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")

    def execute_agent(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return {
            "type": "query_result",
            "queryLanguage": "mongodb",
            "query": {"operation": "find", "collection": "orders"},
            "queryText": 'db.getCollection("orders").find({}).limit(100)',
            "sql": 'db.getCollection("orders").find({}).limit(100)',
            "columns": [],
            "data": [],
        }

    monkeypatch.setattr(ai_service, "execute_agent", execute_agent)

    response = client.post(
        "/api/ai/agent",
        json={
            "prompt": "show orders",
            "databaseId": "db-1",
            "conversationId": "conversation-1",
        },
    )

    assert response.status_code == 200
    assert response.json["conversationId"] == "conversation-1"
    assert response.json["queryLanguage"] == "mongodb"
    assert response.json["queryText"] == response.json["sql"]
    assert captured["kwargs"]["conv_id"] == "conversation-1"


def test_mongodb_agent_route_preserves_only_mongo_error_metadata(client, monkeypatch):
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {
            "type": "error",
            "message": "query failed",
            "queryLanguage": "mongodb",
            "retryCount": 3,
            "maxRetries": 2,
            "lastQueryText": 'db.getCollection("orders").find({})',
            "last_sql": 'db.getCollection("orders").find({})',
            "secret": "do-not-forward",
        },
    )

    response = client.post(
        "/api/ai/agent",
        json={"prompt": "show orders", "databaseId": "db-1"},
    )

    assert response.status_code == 400
    assert response.json["detail"] == {
        "message": "query failed",
        "queryLanguage": "mongodb",
        "retryCount": 3,
        "maxRetries": 2,
        "lastQueryText": 'db.getCollection("orders").find({})',
        "last_sql": 'db.getCollection("orders").find({})',
    }


def test_sql_agent_route_drops_last_sql_and_arbitrary_error_fields(client, monkeypatch):
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {
            "type": "error",
            "message": "sql failed",
            "last_sql": "SELECT secret FROM users",
            "secret": "do-not-forward",
            "retryCount": 3,
        },
    )

    response = client.post(
        "/api/ai/agent",
        json={"prompt": "show users", "databaseId": "db-1"},
    )

    assert response.status_code == 400
    assert response.json["detail"] == {"message": "sql failed"}


def test_mongodb_agent_route_returns_declared_error_as_http_400(client, monkeypatch):
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {"type": "error", "message": "unknown collection"},
    )

    response = client.post(
        "/api/ai/agent",
        json={"prompt": "show missing", "databaseId": "db-1"},
    )

    assert response.status_code == 400
    assert response.json["detail"] == {"message": "unknown collection"}


def test_mongodb_agent_route_preserves_exhausted_retry_metadata_in_http_400_detail(client, monkeypatch):
    monkeypatch.setattr(conversation_store, "ensure_conversation", lambda *args: "conversation-1")
    monkeypatch.setattr(
        ai_service,
        "execute_agent",
        lambda *args, **kwargs: {
            "type": "error",
            "message": "query retries exhausted",
            "lastQueryText": 'db.getCollection("orders").find({}).limit(100)',
            "last_sql": 'db.getCollection("orders").find({}).limit(100)',
            "queryLanguage": "mongodb",
            "retryCount": 3,
            "maxRetries": 2,
        },
    )

    response = client.post(
        "/api/ai/agent",
        json={"prompt": "show orders", "databaseId": "db-1"},
    )

    assert response.status_code == 400
    assert response.json["detail"] == {
        "message": "query retries exhausted",
        "lastQueryText": 'db.getCollection("orders").find({}).limit(100)',
        "last_sql": 'db.getCollection("orders").find({}).limit(100)',
        "queryLanguage": "mongodb",
        "retryCount": 3,
        "maxRetries": 2,
    }
