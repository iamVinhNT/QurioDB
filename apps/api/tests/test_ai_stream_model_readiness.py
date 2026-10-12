"""
test_ai_stream_model_readiness.py

Regression tests for model readiness checks before AI Assistant streaming work.
"""

from types import SimpleNamespace

import pytest

from services.ai_service import MODEL_PREFLIGHT_STATUS
from services.ai_service import ai_service
from services.ai.langchain_runtime import langchain_runtime

pytestmark = pytest.mark.rag


def test_stream_checks_explicit_model_before_understanding(mocker):
    understand = mocker.patch("services.ai_service.rag_pipeline_service.understand_query")
    mocker.patch(
        "services.ai_service.langchain_runtime.resolve_provider",
        return_value="google",
    )
    validate_model_ready = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=RuntimeError("AI model 'gemini-inactive' is inactive"),
    )
    select_auto = mocker.patch("services.ai_service.langchain_runtime.select_auto_model")

    events = list(ai_service.stream_generate_response(
        "show customer tables",
        db_id="db-1",
        user_id="user-1",
        model_id="gemini-inactive",
    ))

    assert events == [
        ("thinking", MODEL_PREFLIGHT_STATUS),
        ("error", "AI model 'gemini-inactive' is inactive"),
    ]
    validate_model_ready.assert_called_once_with(
        model_id="gemini-inactive",
        user_id="user-1",
        provider="google",
        probe_remote=True,
    )
    understand.assert_not_called()
    select_auto.assert_not_called()


def test_sql_preview_repair_invocation_reuses_selected_provider_and_model(mocker):
    preview = SimpleNamespace(ok=False, sql="SELECT * FROM customers", to_dict=lambda: {"error": "bad column"})
    successful_preview = SimpleNamespace(ok=True, sql="SELECT id FROM customers", columns=["id"], data=[{"id": 1}], to_dict=lambda: {})
    stream_text = mocker.patch(
        "services.ai_service.langchain_runtime.stream_text",
        return_value=iter(["SELECT * FROM customers"]),
    )
    invoke_text = mocker.patch(
        "services.ai_service.langchain_runtime.invoke_text",
        return_value="SELECT id FROM customers",
    )
    mocker.patch(
        "services.ai_service.sql_execution_verifier.preview",
        side_effect=[preview, successful_preview],
    )

    events = list(ai_service._stream_sql_with_preview_repair(
        system_prompt="system",
        prompt="list customers",
        db_id="db-1",
        model_id="candidate-b",
        user_id="user-1",
        provider="custom",
        history=[],
    ))

    assert stream_text.call_args.kwargs["model_id"] == "candidate-b"
    assert stream_text.call_args.kwargs["provider"] == "custom"
    invoke_text.assert_called_once_with(
        system_prompt="system",
        prompt=mocker.ANY,
        db_id="db-1",
        model_id="candidate-b",
        user_id="user-1",
        provider="custom",
        temperature=0,
    )
    assert events


@pytest.fixture
def chat(mocker):
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    understand = mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=SimpleNamespace(
        needs_retrieval=False, behavior="general_chat", rag_mode="none", exploration_score=0.0, intent="general_chat",
    ))
    selector = mocker.patch("services.ai_service.langchain_runtime.select_auto_model", return_value={"provider": "custom", "model": "saved-model"})
    stream = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))
    return understand, selector, stream


@pytest.mark.parametrize("provider", ["google", "anthropic", "openai", "qwen", "deepseek", "custom"])
@pytest.mark.parametrize("task_key", [None, "sql.explain", "sql.optimize"])
def test_auto_selects_once_and_keeps_provider_model(chat, mocker, provider, task_key):
    understand, selector, stream = chat
    selector.return_value = {"provider": provider, "model": "saved-model"}
    order = []
    selector.side_effect = lambda **kwargs: order.append("select") or selector.return_value
    understand.side_effect = lambda *args, **kwargs: order.append("understand") or understand.return_value
    router = mocker.patch("services.ai_service.task_model_router.resolve_model_id", side_effect=AssertionError("Task routing must not replace Auto Provider"))
    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", task_key=task_key))
    assert order == ["select", "understand"]
    selector.assert_called_once_with(user_id="user-1")
    assert understand.call_args.kwargs["model_id"] == "saved-model"
    assert stream.call_args.kwargs["model_id"] == "saved-model"
    assert stream.call_args.kwargs["provider"] == provider
    router.assert_not_called()
    assert ("message", "response") in events


def test_explicit_model_keeps_manual_selection(chat, mocker):
    understand, selector, stream = chat
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="google")
    validate = mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    list(ai_service.stream_generate_response("Compare joins", model_id="manual-model", user_id="user-1"))
    selector.assert_not_called()
    validate.assert_called_once_with(model_id="manual-model", user_id="user-1", provider="google", probe_remote=True)
    assert understand.call_args.kwargs["model_id"] == "manual-model"
    assert stream.call_args.kwargs["model_id"] == "manual-model"
    assert stream.call_args.kwargs["provider"] == "google"


def test_auto_failure_stops_before_understanding_and_retrieval(chat, mocker):
    understand, selector, stream = chat
    selector.side_effect = RuntimeError("No active AI models with a configured provider")
    context = mocker.patch("services.ai_service.rag_pipeline_service.build_context_for_understanding")
    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))
    assert events == [("thinking", MODEL_PREFLIGHT_STATUS), ("error", "No active AI models with a configured provider")]
    understand.assert_not_called()
    context.assert_not_called()
    stream.assert_not_called()


def test_quick_response_does_not_need_a_provider(chat, mocker):
    understand, selector, stream = chat
    mocker.patch.object(ai_service, "_quick_general_response", return_value="quick reply")
    assert list(ai_service.stream_generate_response("hello", user_id="user-1")) == [("message", "quick reply")]
    understand.assert_not_called()
    selector.assert_not_called()
    stream.assert_not_called()


@pytest.fixture
def database_chat(chat, mocker):
    understand, selector, stream = chat
    understand.return_value = SimpleNamespace(needs_retrieval=True, intent="text_to_sql")
    mocker.patch("services.ai_service.rag_pipeline_service.build_context_for_understanding", return_value=SimpleNamespace(
        context="DATABASE DIALECT: SQLITE", retrieval_trace={}, citations=[], warnings=[],
    ))
    mocker.patch("services.ai_service.feedback_context_service.get_feedback_context", return_value="")
    return chat


def test_auto_passes_selected_pair_to_sql_preview_and_repair(database_chat, mocker):
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="sqlite")
    repair = mocker.patch.object(ai_service, "_stream_sql_with_preview_repair", return_value=iter([("sql", "SELECT 42")]))
    events = list(ai_service.stream_generate_response("show rows", db_id="db-1", user_id="user-1"))
    assert repair.call_args.kwargs["model_id"] == "saved-model"
    assert repair.call_args.kwargs["provider"] == "custom"
    assert repair.call_args.kwargs["user_id"] == "user-1"
    assert ("sql", "SELECT 42") in events


def test_auto_passes_selected_model_to_mongodb_agent(database_chat, mocker):
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    agent = mocker.patch.object(ai_service, "_execute_mongodb_agent", return_value={"type": "query_result", "summary": "rows", "data": [], "columns": []})
    events = list(ai_service.stream_generate_response("show rows", db_id="db-1", user_id="user-1"))
    agent.assert_called_once_with("show rows", "db-1", "public", "user-1", "saved-model", None, persist=False)
    assert ("query_result", {"columns": [], "data": []}) in events
    database_chat[2].assert_not_called()


@pytest.mark.parametrize("task_key", ["sql.explain", "sql.optimize"])
def test_auto_mongodb_analysis_keeps_selected_pair_without_execution(database_chat, mocker, task_key):
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    agent = mocker.patch.object(ai_service, "_execute_mongodb_agent")
    list(ai_service.stream_generate_response("Analyze db.orders.find({})", db_id="db-1", user_id="user-1", task_key=task_key))
    stream = database_chat[2]
    assert stream.call_args.kwargs["model_id"] == "saved-model"
    assert stream.call_args.kwargs["provider"] == "custom"
    assert "MongoDB query assistant" in stream.call_args.kwargs["system_prompt"]
    agent.assert_not_called()
