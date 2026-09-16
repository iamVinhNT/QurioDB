"""
test_ai_mongodb_agent.py

Focused tests for MongoDB agent routing, validation, execution, and repair.
"""

import hashlib
import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pymongo.errors import (
    AutoReconnect,
    ConnectionFailure,
    ConfigurationError,
    InvalidDocument,
    NetworkTimeout,
    OperationFailure,
    ServerSelectionTimeoutError,
)

from services.ai.agent import AgentAIService, _sanitize_declared_mongodb_response
from services.ai.base import BaseAIService
from services.conversation_context import ConversationContextManager


def _context_result(collections=("orders",), field_allowlist=None, **metadata):
    field_allowlist = field_allowlist or {"orders": ("_id", "status")}
    return SimpleNamespace(
        context="DATABASE DIALECT: MONGODB\nCOLLECTION: orders\nFIELDS:\n- status: str",
        collections=collections,
        field_allowlist=field_allowlist,
        array_field_allowlist=metadata.get("array_field_allowlist", {}),
        database="analytics",
        retrieval_trace=metadata.get("retrieval_trace", {}),
        citations=metadata.get("citations", []),
    )


def _query_response(operation="find", **query):
    payload = {
        "type": "query_result",
        "query": {"operation": operation, "collection": "orders", **query},
        "summary": "Paid orders",
        "confidence": 5,
        "suggestions": [],
    }
    return json.dumps(payload)


def _prepare_service(monkeypatch, responses, executor, context_result=None):
    service = AgentAIService()
    captured_prompts = []
    monkeypatch.setattr(
        "services.ai.agent.schema_context_service.build_schema_context",
        lambda *_args, **_kwargs: context_result or _context_result(),
    )
    monkeypatch.setattr(service._context_mgr, "build_context_for_agent", lambda *_args, **_kwargs: "")
    def generate_response(*args, **kwargs):
        captured_prompts.append((args, kwargs))
        return responses.pop(0)

    monkeypatch.setattr(service, "_generate_response", generate_response)
    service._captured_prompts = captured_prompts
    monkeypatch.setattr(service, "_save_chat", lambda *_args, **_kwargs: "message-1")
    monkeypatch.setattr(service, "_save_retrieval_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_save_generated_query", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "mongodb")
    if executor is not None:
        monkeypatch.setattr("services.ai.agent.MongoExecutor.execute_spec", executor)
    return service


def test_execute_agent_dispatches_mongodb_before_sql_graph(monkeypatch):
    service = AgentAIService()
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "mongodb")
    monkeypatch.setattr(service, "_execute_mongodb_agent", lambda *args, **kwargs: {"type": "success"})
    monkeypatch.setattr(service, "_execute_agent_graph", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL graph used")))
    monkeypatch.setattr(service, "_execute_agent_legacy", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL loop used")))

    assert service.execute_agent("show orders", "db1") == {"type": "success"}


def test_execute_agent_preserves_existing_redis_path(monkeypatch):
    service = AgentAIService()
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "redis")
    monkeypatch.setattr(service, "_execute_agent_graph", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("graph used")))
    monkeypatch.setattr(service, "_execute_agent_legacy", lambda *_args, **_kwargs: {"type": "success"})

    assert service.execute_agent("show keys", "db1") == {"type": "success"}


def test_execute_agent_normalizes_postgresql_alias_for_sql_path(monkeypatch):
    service = AgentAIService()
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "postgresql")
    monkeypatch.setattr(service, "_execute_agent_graph", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("graph used")))
    monkeypatch.setattr(service, "_execute_agent_legacy", lambda *_args, **_kwargs: {"type": "success"})

    assert service.execute_agent("show orders", "db1") == {"type": "success"}


def test_execute_agent_fails_closed_when_database_type_lookup_fails(monkeypatch):
    service = AgentAIService()
    monkeypatch.setattr(
        service,
        "_get_database_type",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("metadata unavailable")),
    )
    monkeypatch.setattr(
        service,
        "_execute_agent_graph",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL graph used")),
    )
    monkeypatch.setattr(
        service,
        "_execute_agent_legacy",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL loop used")),
    )

    result = service.execute_agent("show orders", "db1")

    assert result["type"] == "error"
    assert "database type" in result["message"].lower()


def test_declared_mongodb_error_sanitizer_adds_trusted_discriminator():
    result = _sanitize_declared_mongodb_response({"type": "error", "message": "bad query"})

    assert result["queryLanguage"] == "mongodb"


def test_mongodb_agent_requires_authoritative_collection_allowlist(monkeypatch):
    service = AgentAIService()
    monkeypatch.setattr(
        "services.ai.agent.schema_context_service.build_schema_context",
        lambda *_args, **_kwargs: SimpleNamespace(
            context="DATABASE DIALECT: MONGODB\nNo collection metadata available.",
            collections=(),
            retrieval_trace={},
            citations=[],
        ),
    )
    monkeypatch.setattr(
        service,
        "_generate_response",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("model called without metadata")),
    )
    monkeypatch.setattr(
        "services.ai.agent.MongoExecutor.execute_spec",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("executor called without metadata")),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["type"] in {"clarification", "error"}
    assert result["queryLanguage"] == "mongodb"
    assert "collection" in result["message"].lower()


def test_mongodb_dispatch_avoids_sql_context_when_secondary_type_lookup_fails(monkeypatch):
    service = AgentAIService()
    captured_prompts = []
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "mongodb")
    monkeypatch.setattr(service._context_mgr, "build_context_for_agent", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(service, "_generate_response", lambda prompt, **_kwargs: (captured_prompts.append(prompt) or _query_response()))
    monkeypatch.setattr(service, "_save_chat", lambda *_args, **_kwargs: "message-1")
    monkeypatch.setattr(service, "_save_retrieval_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_save_generated_query", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("services.ai.context.schema_context_service._get_db_type", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secondary lookup failed")))
    monkeypatch.setattr(
        "services.ai.context.metadata_service.get_all_columns",
        lambda *_: {"orders": [{"name": "status", "type": "str", "nullable": True}]},
    )
    monkeypatch.setattr("services.ai.context.metadata_service.get_indexes", lambda *_: [])
    monkeypatch.setattr("services.ai.context.metadata_service.get_schemas", lambda *_: ["analytics"])
    monkeypatch.setattr(
        "services.ai.context.BaseDatabaseService.run_dynamic_query",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL sample path used")),
    )
    monkeypatch.setattr(
        "services.ai.agent.MongoExecutor.execute_spec",
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
    )

    result = service.execute_agent("show orders", "db1", "analytics")

    assert result["queryLanguage"] == "mongodb"
    assert "CREATE TABLE" not in captured_prompts[0]


@pytest.mark.parametrize(
    ("operation", "query", "expected_data"),
    [
        ("find", {"filter": {"status": "paid"}}, [{"status": "paid"}]),
        ("findOne", {"filter": {"status": "paid"}}, [{"status": "paid"}]),
        (
            "aggregate",
            {"pipeline": [{"$match": {"status": "paid"}}]},
            [{"status": "paid"}],
        ),
        ("countDocuments", {"filter": {"status": "paid"}}, [{"count": 250}]),
        ("distinct", {"filter": {"status": "paid"}, "field": "status"}, [{"value": "paid"}]),
    ],
)
def test_mongodb_agent_runs_all_read_operations_through_strict_fake_client(
    monkeypatch, operation, query, expected_data
):
    class StrictCursor:
        def __init__(self, documents):
            self.documents = documents
            self.limit_value = None

        def limit(self, value):
            self.limit_value = value
            return self

        def __iter__(self):
            documents = self.documents if self.limit_value is None else self.documents[: self.limit_value]
            return iter(documents)

    class StrictCollection:
        def find(self, filter, projection=None, *, max_time_ms):
            assert filter == query.get("filter", {})
            assert projection == {"_id": 1, "status": 1}
            assert max_time_ms == 30000
            return StrictCursor([{"status": "paid"}])

        def find_one(self, filter, projection=None, *, max_time_ms):
            assert filter == query.get("filter", {})
            assert projection == {"_id": 1, "status": 1}
            assert max_time_ms == 30000
            return {"status": "paid"}

        def aggregate(self, pipeline, *, maxTimeMS):
            assert maxTimeMS == 30000
            if operation == "distinct":
                assert pipeline == [
                    {"$match": {"status": "paid"}},
                    {"$limit": 100},
                    {"$group": {"_id": "$status"}},
                    {"$limit": 100},
                    {"$project": {"_id": 0, "value": "$_id"}},
                ]
                return [{"value": "paid"}]
            assert pipeline == [
                {"$match": {"status": "paid"}},
                {"$project": {"_id": 1, "status": 1}},
                {"$limit": 100},
            ]
            return [{"status": "paid"}]

        def count_documents(self, filter, *, maxTimeMS):
            assert filter == {"status": "paid"}
            assert maxTimeMS == 30000
            return 250

    collection = StrictCollection()
    client = {"analytics": {"orders": collection}}
    session = MagicMock()
    service = _prepare_service(monkeypatch, [_query_response(operation=operation, **query)], None)
    monkeypatch.setattr("services.execution.mongo_executor.SessionLocal", lambda: session)
    monkeypatch.setattr(
        "services.base_service.BaseDatabaseService.get_db_config",
        lambda *_args, **_kwargs: ("mongodb", {"database": "analytics"}),
    )
    monkeypatch.setattr(
        "services.base_service.BaseDatabaseService.get_mongo_client",
        lambda *_args, **_kwargs: (client, "analytics"),
    )

    result = service.execute_agent("show paid orders", "db1", "analytics")

    assert result["queryLanguage"] == "mongodb"
    assert result["query"]["operation"] == operation
    assert result["data"] == expected_data


def test_mongodb_agent_returns_canonical_query_and_sql_compatibility_alias(monkeypatch):
    executor = MagicMock(return_value=([{"status": "paid"}], ["status"]))
    service = _prepare_service(monkeypatch, [_query_response(filter={"status": "paid"})], executor)

    result = service._execute_mongodb_agent("show paid orders", "db1", "analytics")

    assert result["queryLanguage"] == "mongodb"
    assert result["query"]["operation"] == "find"
    assert result["queryText"] == result["sql"]
    assert result["queryText"].startswith(
        'db.getSiblingDB("analytics").getCollection("orders").find('
    )
    assert result["data"] == [{"status": "paid"}]
    executor.assert_called_once()


def test_mongodb_agent_sanitizes_success_payload_before_return_and_persistence(monkeypatch):
    saved_chat = []
    saved_queries = []
    raw_response = json.dumps(
        {
            "type": "query_result",
            "query": {"operation": "find", "collection": "orders", "filter": {"status": "paid"}},
            "summary": "See mongodb://user:secret@example.test/db",
            "thinking": {"note": "password=secret"},
            "suggestions": [{"prompt": "Use token=secret for next query"}],
            "extra": {"api_key": "secret"},
        }
    )
    service = _prepare_service(
        monkeypatch,
        [raw_response],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
    )
    monkeypatch.setattr(
        service,
        "_save_chat",
        lambda role, content, *_args, **_kwargs: (saved_chat.append((role, content)) or "message-1"),
    )
    monkeypatch.setattr(
        service,
        "_save_generated_query",
        lambda sql, prompt, explanation, *_args, **_kwargs: saved_queries.append(
            (sql, prompt, explanation)
        ),
    )

    result = service._execute_mongodb_agent("show paid orders", "db1", "analytics")
    persisted = json.dumps(saved_chat) + json.dumps(saved_queries)

    assert "secret" not in json.dumps(result)
    assert "secret" not in persisted
    assert result["query"] == {
        "operation": "find",
        "collection": "orders",
        "database": "analytics",
        "filter": {"status": "paid"},
        "projection": {"_id": 1, "status": 1},
        "options": {"limit": 100, "maxTimeMS": 30000},
    }
    assert result["summary"] == "[redacted-credential]"
    assert result["queryText"] == result["sql"]
    assert saved_queries[0][2] == "[redacted-credential]"


def test_mongodb_agent_sanitizes_retrieval_trace_once_for_response_and_persistence(monkeypatch):
    saved_trace = []
    trace = {
        "intent": "show orders mongodb://user:secret@example.test/db password=secret",
        "databaseId": "db1",
        "tables": [
            {"name": "orders", "matchedTerms": ["token=secret", "password=secret"]}
        ],
        "token": "secret",
    }
    context = _context_result(retrieval_trace=trace, citations=[{"text": "uri=mongodb://secret"}])
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
        context_result=context,
    )
    monkeypatch.setattr(
        service,
        "_save_retrieval_event",
        lambda trace, query_text, *_args, **_kwargs: saved_trace.append((trace, query_text)),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")
    serialized = json.dumps(result) + json.dumps(saved_trace)

    assert "mongodb://user:secret@example.test/db" not in serialized
    assert "password=secret" not in serialized
    assert "token=secret" not in serialized
    assert "secret" not in serialized
    assert result["retrievalTrace"] == saved_trace[0][0]
    assert result["retrievalTrace"]["intentHash"] == hashlib.sha256(
        "show orders".encode("utf-8")
    ).hexdigest()
    assert "intent" not in result["retrievalTrace"]
    assert saved_trace[0][1] == "show orders"


def test_mongodb_agent_filters_returned_fields_to_authorized_metadata(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: (
            [{"status": "paid", "password": "secret", "unlisted": "value"}],
            ["password", "status", "unlisted"],
        ),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["data"] == [{"status": "paid"}]
    assert result["columns"] == ["status"]


def test_mongodb_agent_returns_empty_columns_when_authorized_data_is_empty(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([], ["status", "unlisted"]),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["data"] == []
    assert result["columns"] == []


def test_mongodb_agent_preserves_columns_for_computed_aggregate_outputs(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [
            _query_response(
                operation="aggregate",
                pipeline=[{"$group": {"_id": "$status", "total": {"$sum": 1}}}],
            )
        ],
        lambda *_args, **_kwargs: (
            [{"_id": "paid", "total": 2, "unlisted": "value"}],
            ["_id", "total", "unlisted"],
        ),
    )

    result = service._execute_mongodb_agent("summarize orders", "db1", "analytics")

    assert result["data"] == [{"_id": "paid", "total": 2}]
    assert result["columns"] == ["_id", "total"]


@pytest.mark.parametrize("operation", ["find", "findOne"])
def test_mongodb_agent_recursively_filters_nested_fields_for_document_results(monkeypatch, operation):
    service = _prepare_service(
        monkeypatch,
        [_query_response(operation=operation)],
        lambda *_args, **_kwargs: (
            [
                {
                    "profile": {"name": "A", "email": "a@example.test", "password": "secret"},
                    "status": "paid",
                }
            ],
            ["profile", "status"],
        ),
        context_result=_context_result(
            field_allowlist={"orders": ("_id", "profile", "profile.name", "status")}
        ),
    )

    result = service._execute_mongodb_agent("show order profile", "db1", "analytics")

    assert result["data"] == [{"profile": {"name": "A"}, "status": "paid"}]
    assert result["columns"] == ["profile", "status"]


def test_mongodb_agent_recursively_filters_nested_fields_for_aggregate_results(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [
            _query_response(
                operation="aggregate",
                pipeline=[{"$project": {"profile.name": 1, "status": 1}}],
            )
        ],
        lambda *_args, **_kwargs: (
            [
                {
                    "profile": {"name": "A", "email": "a@example.test"},
                    "status": "paid",
                    "unlisted": "value",
                }
            ],
            ["profile", "status", "unlisted"],
        ),
        context_result=_context_result(
            field_allowlist={"orders": ("_id", "profile", "profile.name", "status")}
        ),
    )

    result = service._execute_mongodb_agent("summarize order profiles", "db1", "analytics")

    assert result["data"] == [{"profile": {"name": "A"}, "status": "paid"}]
    assert result["columns"] == ["profile", "status"]


def test_mongodb_agent_defaults_invalid_confidence_to_bounded_integer(monkeypatch):
    response = json.loads(_query_response())
    response["confidence"] = "not-a-number"
    service = _prepare_service(monkeypatch, [json.dumps(response)], lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]))

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["confidence"] == 3
    assert result["type"] == "query_result"


def test_mongodb_agent_never_calls_sql_validation_or_policy(monkeypatch):
    executor = MagicMock(return_value=([{"status": "paid"}], ["status"]))
    service = _prepare_service(monkeypatch, [_query_response()], executor)
    monkeypatch.setattr(
        "services.ai.agent.sql_safety_validator.validate",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL validator used")),
    )
    monkeypatch.setattr(
        "services.ai.agent.SqlExecutionPolicy",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("SQL policy used")),
    )

    result = service.execute_agent("show orders", "db1")

    assert result["queryLanguage"] == "mongodb"
    executor.assert_called_once()


def test_mongodb_agent_repairs_policy_failure_without_sql_prompt(monkeypatch):
    executor = MagicMock(return_value=([{"status": "paid"}], ["status"]))
    service = _prepare_service(
        monkeypatch,
        [
            _query_response(operation="aggregate", pipeline=[{"$out": "archive"}]),
            _query_response(filter={"status": "paid"}),
        ],
        executor,
    )

    result = service._execute_mongodb_agent("show paid orders", "db1", "analytics")

    assert result["queryLanguage"] == "mongodb"
    assert executor.call_count == 1
    assert len(service._captured_prompts) == 2
    assert "SQL" not in service._captured_prompts[1][0][0]


def test_mongodb_repair_prompt_redacts_error_uri_and_credentials():
    service = AgentAIService()

    prompt = service._mongodb_repair_prompt(
        "Mongo failed for mongodb://user:secret@example.test/db password=secret",
        {"operation": "find", "collection": "orders", "filter": {"token": "secret"}},
        'db.getCollection("orders").find({})',
    )

    assert "mongodb://user:secret@example.test/db" not in prompt
    assert "password=secret" not in prompt
    assert "[redacted-uri]" in prompt
    assert "[redacted]" in prompt or "[redacted-credential]" in prompt


@pytest.mark.parametrize("agent_type", ["error", "clarification"])
def test_mongodb_agent_preserves_declared_type_and_sanitizes_model_fields(monkeypatch, agent_type):
    executor_calls = []

    def unexpected_executor(*_args, **_kwargs):
        executor_calls.append(1)
        raise AssertionError("declared non-query response was executed")

    response = json.dumps(
        {
            "type": agent_type,
            "message": "See mongodb://user:secret@example.test/db password=secret",
            "summary": "token=secret",
            "lastQueryText": "mongodb://user:secret@example.test/db",
            "last_sql": "password=secret",
            "query": None,
        }
    )
    service = _prepare_service(monkeypatch, [response], unexpected_executor)

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["type"] == agent_type
    assert "secret" not in result["message"]
    assert "secret" not in result["summary"]
    assert "mongodb://user:secret@example.test/db" not in result["lastQueryText"]
    assert "password=secret" not in result["last_sql"]
    assert executor_calls == []


def test_mongodb_base_generation_uses_non_sql_system_role(monkeypatch):
    service = BaseAIService()
    captured = {}
    monkeypatch.setattr("services.ai.base.task_model_router.resolve_model_id", lambda *args: "model-1")
    monkeypatch.setattr("services.ai.base.langchain_runtime.resolve_provider", lambda **kwargs: "google")

    def invoke_text(**kwargs):
        captured.update(kwargs)
        return "{}"

    monkeypatch.setattr("services.ai.base.langchain_runtime.invoke_text", invoke_text)

    service._generate_response("Mongo request", task_key="agent.mongodb_readonly", database_type="mongodb")

    assert "MongoDB-focused" in captured["system_prompt"]
    assert "SQL" not in captured["system_prompt"]


def test_mongodb_agent_redacts_request_before_context_model_and_persistence(monkeypatch):
    raw_prompt = "Show paid orders from mongodb://user:secret@example.test/analytics password=secret token=secret"
    captured = {}
    context = _context_result(
        retrieval_trace={"intent": raw_prompt, "tables": []},
    )
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
        context_result=context,
    )
    monkeypatch.setattr(
        "services.ai.agent.schema_context_service.build_schema_context",
        lambda *args, **kwargs: (captured.update(context_args=(args, kwargs)) or context),
    )
    monkeypatch.setattr(
        service._context_mgr,
        "build_context_for_agent",
        lambda *args, **kwargs: captured.update(history_args=(args, kwargs)) or "",
    )
    monkeypatch.setattr(
        service,
        "_save_chat",
        lambda *args, **kwargs: captured.setdefault("chat", []).append((args, kwargs)) or "message-1",
    )
    monkeypatch.setattr(
        service,
        "_save_generated_query",
        lambda *args, **kwargs: captured.update(generated_query=(args, kwargs)),
    )

    service._execute_mongodb_agent(raw_prompt, "db1", "analytics")

    serialized = json.dumps(captured, default=str)
    assert "mongodb://user:secret@example.test/analytics" not in serialized
    assert "password=secret" not in serialized
    assert "token=secret" not in serialized
    assert "Show paid orders" in serialized
    safe_prompt = "Show paid orders from [redacted-uri] password=[redacted] token=[redacted]"
    assert captured["context_args"][1]["intent"] == safe_prompt
    assert captured["history_args"][0][1] == safe_prompt


def test_mongodb_history_redacts_loaded_messages_before_agent_prompt(monkeypatch):
    raw_history = (
        "[Conversation Summary]: Show orders mongodb://user:secret@example.test/db password=secret\n"
        "[Recent Messages]:\n  USER: token=secret"
    )
    captured = {}
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
    )
    monkeypatch.setattr(
        service._context_mgr,
        "build_context_for_agent",
        lambda *_args, **_kwargs: raw_history,
    )
    monkeypatch.setattr(
        service,
        "_generate_response",
        lambda prompt, **kwargs: (captured.update(prompt=prompt) or _query_response()),
    )

    service._execute_mongodb_agent("show paid orders", "db1", "analytics")

    assert "mongodb://user:secret@example.test/db" not in captured["prompt"]
    assert "password=secret" not in captured["prompt"]
    assert "token=secret" not in captured["prompt"]
    assert "Show orders" in captured["prompt"]


def test_mongodb_history_loader_redacts_only_when_requested(monkeypatch):
    messages = [
        SimpleNamespace(
            role="user",
            content="Show orders mongodb://user:secret@example.test/db password=secret token=secret",
        ),
        SimpleNamespace(role="assistant", content="Useful status text"),
    ]
    session = MagicMock()
    session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = messages
    monkeypatch.setattr("services.conversation_context.SessionLocal", lambda: session)
    manager = ConversationContextManager()

    mongo_history = manager._load_history("conversation-1", redact_sensitive=True)
    sql_history = manager._load_history("conversation-1")

    assert "secret" not in json.dumps(mongo_history)
    assert "Show orders" in mongo_history[0]["content"]
    assert sql_history[0]["content"] == messages[0].content
    assert session.close.call_count == 2


def test_mongodb_agent_requests_redacted_conversation_history(monkeypatch):
    captured = {}
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
    )
    monkeypatch.setattr(
        service._context_mgr,
        "build_context_for_agent",
        lambda *args, **kwargs: captured.update(args=args, kwargs=kwargs) or "",
    )

    service._execute_mongodb_agent("show paid orders", "db1", "analytics", conv_id="conv-1")

    assert captured["kwargs"]["redact_sensitive"] is True


def test_mongodb_agent_error_includes_deterministic_retry_metadata(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [_query_response()] * 3,
        lambda *_args, **_kwargs: (_ for _ in ()).throw(OperationFailure("bad query", code=2)),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["retryCount"] == 3
    assert result["maxRetries"] == 2


def test_mongodb_base_provider_prompt_never_receives_raw_mongodb_secrets(monkeypatch):
    captured = {}
    service = BaseAIService()
    monkeypatch.setattr("services.ai.base.task_model_router.resolve_model_id", lambda *args: "model-1")
    monkeypatch.setattr("services.ai.base.langchain_runtime.resolve_provider", lambda **kwargs: "google")
    monkeypatch.setattr(
        "services.ai.base.langchain_runtime.invoke_text",
        lambda **kwargs: (captured.update(kwargs) or "{}"),
    )

    service._generate_response(
        "Show orders mongodb://user:secret@example.test/analytics password=secret token=secret",
        task_key="agent.mongodb_readonly",
        database_type="mongodb",
    )

    serialized = json.dumps(captured, default=str)
    assert "mongodb://user:secret@example.test/analytics" not in serialized
    assert "password=secret" not in serialized
    assert "token=secret" not in serialized
    assert "Show orders" in serialized


def test_mongodb_agent_passes_safe_request_to_provider(monkeypatch):
    raw_prompt = "Show orders mongodb://user:secret@example.test/analytics password=secret"
    captured = []
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: ([{"status": "paid"}], ["status"]),
    )
    monkeypatch.setattr(
        service,
        "_generate_response",
        lambda prompt, **kwargs: (captured.append((prompt, kwargs)) or _query_response()),
    )

    service._execute_mongodb_agent(raw_prompt, "db1", "analytics")

    serialized = json.dumps(captured, default=str)
    assert "mongodb://user:secret@example.test/analytics" not in serialized
    assert "password=secret" not in serialized
    assert "Show orders" in serialized


def test_mongodb_agent_error_metadata_is_present_for_non_retryable_failure(monkeypatch):
    service = _prepare_service(
        monkeypatch,
        [_query_response()],
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ConnectionFailure("offline")),
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["retryCount"] == 0
    assert result["maxRetries"] == 2


def test_mongodb_agent_does_not_retry_connection_failures(monkeypatch):
    calls = []

    def fail_connection(*_args, **_kwargs):
        calls.append(1)
        raise ConnectionFailure("server unavailable")

    service = _prepare_service(monkeypatch, [_query_response()], fail_connection)

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["type"] == "error"
    assert len(calls) == 1
    assert "server unavailable" in result["message"]


def test_mongodb_agent_retries_query_errors_at_most_twice(monkeypatch):
    calls = []

    def fail_query(*_args, **_kwargs):
        calls.append(1)
        raise OperationFailure("bad query", code=2)

    service = _prepare_service(
        monkeypatch,
        [_query_response(), _query_response(), _query_response()],
        fail_query,
    )

    result = service._execute_mongodb_agent("show orders", "db1", "analytics")

    assert result["type"] == "error"
    assert len(calls) == 3
    assert "lastQueryText" in result


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (OperationFailure("bad query", code=2), True),
        (OperationFailure("parse error", code=9), True),
        (OperationFailure("type mismatch", code=14), True),
        (OperationFailure("namespace missing", code=26), False),
        (OperationFailure("not authorized", code=13), False),
        (ConnectionFailure("server unavailable"), False),
        (InvalidDocument("invalid bson"), True),
    ],
)
def test_mongodb_retry_classification_retries_only_query_correctable_errors(error, expected):
    from services.ai.agent import _is_retryable_mongo_query_error

    assert _is_retryable_mongo_query_error(error) is expected


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (NetworkTimeout("operation timed out"), False),
        (ServerSelectionTimeoutError("server selection timed out"), False),
        (AutoReconnect("connection dropped"), False),
        (ConfigurationError("bad connection config"), False),
        (OperationFailure("query parse error", code=9), True),
        (OperationFailure("query type error", code=14), True),
        (OperationFailure("authorization failed", code=13), False),
        (OperationFailure("namespace missing", code=26), False),
        (OperationFailure("duplicate key", code=11000), False),
        (OperationFailure("server error", code=11600), False),
        (InvalidDocument("malformed document"), True),
    ],
)
def test_mongodb_retry_matrix_explicitly_classifies_timeout_auth_namespace_duplicate_and_document_errors(
    error, expected
):
    from services.ai.agent import _is_retryable_mongo_query_error

    assert _is_retryable_mongo_query_error(error) is expected


def test_mongodb_agent_passes_array_field_allowlist_to_policy(monkeypatch):
    captured = {}

    def execute_spec(_executor, _db_id, spec, **_kwargs):
        captured["spec"] = spec
        return ([{"value": "tag-a"}], ["value"])

    context = _context_result(
        field_allowlist={"orders": ("_id", "tags")},
        array_field_allowlist={"orders": ("tags",)},
    )
    service = _prepare_service(
        monkeypatch,
        [_query_response(operation="distinct", field="tags")],
        execute_spec,
        context_result=context,
    )

    result = service._execute_mongodb_agent("list order tags", "db1", "analytics")

    assert result["queryLanguage"] == "mongodb"
    assert captured["spec"].distinct_is_array is True


def test_mongodb_meta_prompt_persistence_redacts_credentials_but_keeps_useful_text(monkeypatch):
    persisted_messages = []
    session = MagicMock()
    session.add.side_effect = persisted_messages.append
    monkeypatch.setattr("services.ai.base.SessionLocal", lambda: session)

    service = AgentAIService()
    context = _context_result()
    raw_response = json.dumps(
        {
            "type": "success",
            "summary": "Show paid orders from mongodb://user:secret@example.test/analytics password=secret token=secret",
            "confidence": 1,
        }
    )
    monkeypatch.setattr(
        "services.ai.agent.schema_context_service.build_schema_context",
        lambda *_args, **_kwargs: context,
    )
    monkeypatch.setattr(service._context_mgr, "build_context_for_agent", lambda *_args, **_kwargs: "")
    monkeypatch.setattr(service, "_generate_response", lambda *_args, **_kwargs: raw_response)
    monkeypatch.setattr(service, "_save_retrieval_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_get_database_type", lambda *_args, **_kwargs: "mongodb")

    result = service.execute_agent(
        "Show paid orders from mongodb://user:secret@example.test/analytics password=secret token=secret",
        "db1",
        schema="analytics",
        conv_id="conversation-1",
    )

    persisted = " ".join(str(message.content) for message in persisted_messages)
    assert result["type"] == "clarification"
    assert "secret" not in persisted
    assert "Show paid orders" in persisted
    assert all(message.databaseId == "db1" for message in persisted_messages)


def test_mongodb_prompt_persistence_redacts_credentials_but_keeps_useful_text(mocker):
    session = mocker.MagicMock()
    captured = []
    session.add.side_effect = captured.append
    mocker.patch("services.ai.base.SessionLocal", return_value=session)

    service = BaseAIService()
    prompt = "Show paid orders from mongodb://user:secret@example.test/analytics"
    sql = 'db.getSiblingDB("analytics").getCollection("orders").find({"token":"secret"})'
    explanation = "Use the status field; password=secret must never be persisted."

    service._save_chat("user", prompt, "user-1", "db-1", database_type="mongodb")
    service._save_generated_query(
        sql,
        prompt,
        explanation,
        "user-1",
        "db-1",
        database_type="mongodb",
    )

    persisted = " ".join(
        str(getattr(item, field))
        for item in captured
        for field in ("content", "prompt", "sql", "explanation")
        if hasattr(item, field) and getattr(item, field) is not None
    )
    assert "secret" not in persisted
    assert "Show paid orders" in persisted
    assert "Use the status field" in persisted
