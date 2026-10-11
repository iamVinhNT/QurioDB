"""
test_ai_query_results_stream.py

Regression coverage for database results streamed and restored in chat.
"""

import json
from types import SimpleNamespace

import pytest

from services.ai.agent import AgentAIService
from services.ai.sql_execution import SqlExecutionVerifier, SqlPreviewResult
from services.ai.streaming import (
    append_stream_part, build_assistant_history_content, new_response_parts,
    parse_assistant_history_content,
)
from services.ai_service import ai_service

pytestmark = pytest.mark.rag


def test_sql_preview_retains_rows_and_streams_them_once(mocker):
    verifier = SqlExecutionVerifier()
    mocker.patch.object(verifier.metadata, "get_db_type", return_value="sqlite")
    execute = mocker.patch.object(verifier.sql_executor, "execute", return_value=([{"id": 1}], ["id"]))
    preview = verifier.preview("db-1", "SELECT id FROM users")
    assert preview.data == [{"id": 1}]
    assert preview.rowCount == 1
    execute.assert_called_once()
    mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["```sql\nSELECT id FROM users\n``` "]))
    mocker.patch("services.ai_service.sql_execution_verifier.preview", return_value=preview)
    events = list(ai_service._stream_sql_with_preview_repair("system", "show users", "db-1", None, None, "google", []))
    assert ("query_result", {"columns": ["id"], "data": [{"id": 1}]}) in events
    assert sum(event == "query_result" for event, _ in events) == 1


def test_failed_preview_never_streams_data(mocker):
    mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["```sql\nDELETE FROM users\n``` "]))
    mocker.patch("services.ai_service.langchain_runtime.invoke_text", return_value="```sql\nDELETE FROM users\n``` ")
    mocker.patch("services.ai_service.sql_execution_verifier.preview", return_value=SqlPreviewResult(ok=False, sql="DELETE FROM users", error="writes blocked"))
    events = list(ai_service._stream_sql_with_preview_repair("system", "delete users", "db-1", None, None, "google", []))
    assert not any(event == "query_result" for event, _ in events)


@pytest.mark.parametrize("rows", [[], [{"customer": "An", "profile": {"city": "Hanoi"}}]])
def test_structured_query_and_results_survive_history_roundtrip(rows):
    parts = new_response_parts()
    append_stream_part(parts, "query", {"queryLanguage": "mongodb", "queryText": "db.orders.find({})"})
    append_stream_part(parts, "query_result", {"columns": ["customer", "profile"], "data": rows})
    restored = parse_assistant_history_content(build_assistant_history_content(parts))
    assert restored["queryLanguage"] == "mongodb"
    assert restored["queryText"] == "db.orders.find({})"
    assert restored["columns"] == ["customer", "profile"]
    assert restored["data"] == rows
    assert not any(event["type"] in {"query", "query_result"} for event in restored["events"])
    assert build_assistant_history_content(parts).count('"data":') == 1
    from services.ai.conversation_store import conversation_store
    message = SimpleNamespace(role="assistant", content=build_assistant_history_content(parts))
    api_fields = conversation_store._assistant_fields(message)
    assert api_fields["data"] == rows
    assert api_fields["columns"] == ["customer", "profile"]
    assert api_fields["queryText"] == "db.orders.find({})"
    assert "Query:\ndb.orders.find({})" in conversation_store._history_context_content(message)


@pytest.mark.parametrize("result", [
    {"type": "query_result", "queryText": "db.orders.find({})", "columns": ["customer"], "data": [{"customer": "An"}], "summary": "Đơn hàng"},
    {"type": "query_result", "queryText": "db.orders.find({})", "columns": [], "data": []},
    {"type": "error", "message": "write blocked"},
    {"type": "clarification", "summary": "Bạn muốn xem collection nào?"},
])
def test_mongodb_chat_uses_safe_agent_without_relational_execution(mocker, result):
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="google")
    mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=SimpleNamespace(needs_retrieval=True))
    mocker.patch("services.ai_service.task_model_router.resolve_model_id", return_value="gemini")
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    agent = mocker.patch.object(ai_service, "_execute_mongodb_agent", return_value=result)
    relational_context = mocker.patch("services.ai_service.rag_pipeline_service.build_context_for_understanding")
    relational_stream = mocker.patch("services.ai_service.langchain_runtime.stream_text")
    events = list(ai_service.stream_generate_response("show orders", "db-1", "analytics", "gemini", user_id="user-1", conv_id="conv-1"))
    agent.assert_called_once_with("show orders", "db-1", "analytics", "user-1", "gemini", "conv-1", persist=False)
    relational_context.assert_not_called()
    relational_stream.assert_not_called()
    if "data" in result:
        assert ("query_result", {"columns": result["columns"], "data": result["data"]}) in events
        assert ("query", {"queryLanguage": "mongodb", "queryText": result["queryText"]}) in events
    else:
        assert not any(event == "query_result" for event, _ in events)
    if result["type"] == "error":
        assert ("error", "write blocked") in events


def test_mongodb_prompt_defines_executable_confidence_scale():
    from services.prompts import get_mongodb_agent_prompt
    prompt = get_mongodb_agent_prompt("COLLECTION: orders")
    output = json.loads(prompt.split("## OUTPUT SHAPE\n")[1].split("\n\nFor clarification")[0])
    assert output["confidence"] > 2
    assert "1-2 means clarification" in prompt


def test_stream_meta_response_does_not_persist_twice(mocker):
    service = AgentAIService()
    save = mocker.patch.object(service, "_save_chat")
    response = service._finalize_meta_tool({"confidence": 1}, "prompt", "user", "db", "conv", persist=False)
    assert response["type"] == "clarification"
    save.assert_not_called()


@pytest.mark.parametrize("task_key", ["sql.explain", "sql.optimize"])
def test_mongodb_analysis_actions_never_execute_an_agent_query(mocker, task_key):
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="google")
    mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=SimpleNamespace(needs_retrieval=True))
    mocker.patch("services.ai_service.task_model_router.resolve_model_id", return_value="gemini")
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    agent = mocker.patch.object(ai_service, "_execute_mongodb_agent")
    stream = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["Đây là truy vấn tìm đơn hàng."]))
    events = list(ai_service.stream_generate_response("Analyze db.orders.find({})", "db-1", "analytics", "gemini", task_key=task_key))
    agent.assert_not_called()
    assert "MongoDB query assistant" in stream.call_args.kwargs["system_prompt"]
    assert not any(event == "query_result" for event, _ in events)


def test_mongodb_stream_route_persists_one_pair_and_json_safe_results(app, mocker, monkeypatch):
    from datetime import datetime, timezone
    from bson import ObjectId, Decimal128
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from models import AIChatMessage, Base
    from services.execution.mongo_executor import MongoExecutor

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    for module in ("services.ai.conversation_store", "routes.ai_stream", "services.ai.base"):
        monkeypatch.setattr(f"{module}.SessionLocal", session_factory)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="google")
    mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=SimpleNamespace(needs_retrieval=True))
    mocker.patch("services.ai_service.task_model_router.resolve_model_id", return_value="gemini")
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    mocker.patch("services.ai.agent.schema_context_service.build_schema_context", return_value=SimpleNamespace(
        context="COLLECTION: orders", collections=("orders",), database="analytics",
        accessible_databases=("analytics",), field_allowlist={"orders": ("_id", "amount", "created", "customer")},
        array_field_allowlist={}, retrieval_trace={}, citations=[],
    ))
    mocker.patch.object(ai_service, "_generate_response", return_value=json.dumps({
        "type": "query_result", "confidence": 5, "summary": "Đơn hàng",
        "query": {"operation": "find", "collection": "orders", "filter": {}},
    }))
    mocker.patch.object(ai_service._context_mgr, "build_context_for_agent", return_value="")
    executor = MongoExecutor(None)
    rows, columns = executor._process_documents([{
        "_id": ObjectId(), "amount": Decimal128("12.5"), "created": datetime(2026, 10, 10, tzinfo=timezone.utc), "customer": "An",
    }])
    execute = mocker.patch("services.ai.agent.MongoExecutor.execute_spec", return_value=(rows, columns))
    client = TestClient(app)
    response = client.post("/api/ai/stream", json={"text": "show orders", "databaseId": "db-1", "schema_name": "analytics", "modelId": "gemini"})
    assert response.status_code == 200
    assert "event: query_result" in response.text
    assert "event: error" not in response.text
    execute.assert_called_once()
    conversation_id = response.headers["X-Conversation-Id"]
    with session_factory() as session:
        messages = session.query(AIChatMessage).filter_by(conversationId=conversation_id).all()
        assert sorted(message.role for message in messages) == ["assistant", "user"]
        assistant = next(message for message in messages if message.role == "assistant")
        assert assistant.content.count('"data":') == 1
    history = client.get(f"/api/ai/conversations/{conversation_id}").json()
    restored = history["messages"][-1]
    assert restored["queryLanguage"] == "mongodb"
    assert restored["data"] == rows
    assert "getCollection(\"orders\")" in restored["queryText"]
    json.dumps(restored)
    engine.dispose()
