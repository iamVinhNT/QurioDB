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


@pytest.fixture
def stable_chat(chat, mocker):
    ai_service._auto_conversations.clear()
    session = mocker.MagicMock()
    session.query.return_value.filter.return_value.all.return_value = [SimpleNamespace(provider="custom"), SimpleNamespace(provider="google")]
    mocker.patch("services.ai_service.SessionLocal", return_value=session)
    mocker.patch.object(ai_service, "_load_langchain_history", return_value=[])
    validate = mocker.patch.object(langchain_runtime, "validate_model_ready")
    invalidate = mocker.patch.object(langchain_runtime, "invalidate_model_probe", create=True)
    mocker.patch("services.ai_service.get_ai_api_key", return_value="provider-secret")
    chat[2].side_effect = lambda **kwargs: iter(["response"])
    yield chat, validate, invalidate, session
    ai_service._auto_conversations.clear()


def send_chat(conv_id="a", **kwargs):
    return list(ai_service.stream_generate_response("Compare joins", user_id="user-1", conv_id=conv_id, **kwargs))


def test_same_conversation_reuses_pair_and_runtime_readiness(stable_chat):
    (_, selector, stream), validate, _, _ = stable_chat
    for _ in range(2):
        assert ("message", "response") in send_chat()
    selector.assert_called_once_with(user_id="user-1")
    validate.assert_called_once_with(model_id="saved-model", user_id="user-1", provider="custom", probe_remote=True)
    assert stream.call_count == 2


def test_conversation_and_user_selection_are_isolated(stable_chat):
    (_, selector, _), _, _, _ = stable_chat
    for user, conversation in [("user-1", "a"), ("user-1", "b"), ("user-2", "a")]:
        list(ai_service.stream_generate_response("Compare joins", user_id=user, conv_id=conversation))
    assert selector.call_count == 3
    assert len(ai_service._auto_conversations) == 3


def test_no_conversation_keeps_request_scoped_selection(stable_chat):
    (_, selector, _), _, _, _ = stable_chat
    send_chat(None)
    send_chat(None)
    assert selector.call_count == 2
    assert not ai_service._auto_conversations


def test_missing_or_inactive_sticky_model_is_reselected(stable_chat):
    (_, selector, _), validate, _, session = stable_chat
    ai_service._auto_conversations[("user-1", "a")] = ("removed", "custom")
    session.query.return_value.filter.return_value.all.return_value = []
    send_chat()
    selector.assert_called_once()
    validate.assert_not_called()
    assert ai_service._auto_conversations[("user-1", "a")] == ("saved-model", "custom")


def fail_first(**kwargs):
    if kwargs["model_id"] == "saved-model":
        raise RuntimeError("quota exceeded using provider-secret {upstream payload}")
    yield "fallback response"


def set_fallback(selector):
    selector.side_effect = [{"model": "saved-model", "provider": "custom"}, {"model": "fallback", "provider": "Google"}]


def test_auto_fails_over_same_message_and_remembers_fallback(stable_chat, caplog):
    (_, selector, stream), validate, invalidate, _ = stable_chat
    set_fallback(selector)
    stream.side_effect = fail_first
    first, second = send_chat(), send_chat()
    assert "".join(data for kind, data in first if kind == "message") == "fallback response"
    assert "".join(data for kind, data in second if kind == "message") == "fallback response"
    assert not any(kind == "error" for kind, _ in first + second)
    assert selector.call_count == 2
    assert selector.call_args.kwargs["excluded_models"] == {("saved-model", "custom")}
    validate.assert_called_once_with(model_id="fallback", user_id="user-1", provider="google", probe_remote=True)
    invalidate.assert_called_once_with("user-1", "custom", "saved-model")
    assert "provider-secret" not in caplog.text


def test_auto_exhaustion_emits_sanitized_error_and_terminates(stable_chat, caplog):
    (_, selector, stream), _, invalidate, _ = stable_chat
    selector.side_effect = [{"model": "saved-model", "provider": "custom"}, RuntimeError("No active AI models")]
    stream.side_effect = fail_first
    events = send_chat()
    assert events[-1][0] == "error" and "no eligible fallback" in events[-1][1]
    assert not any(kind == "message" for kind, _ in events)
    assert ("user-1", "a") not in ai_service._auto_conversations
    assert "provider-secret" not in str(events) + caplog.text
    assert invalidate.call_count == 1


def test_auto_bounds_real_provider_failures_to_three(stable_chat):
    (_, selector, stream), _, invalidate, _ = stable_chat
    selector.side_effect = [{"model": f"model-{i}", "provider": "custom"} for i in range(3)]
    stream.side_effect = RuntimeError("rate limit exceeded")
    events = send_chat()
    assert "exhausted after 3 provider failures" in events[-1][1]
    assert stream.call_count == selector.call_count == invalidate.call_count == 3
    assert selector.call_args.kwargs["excluded_models"] == {("model-0", "custom"), ("model-1", "custom")}


def test_explicit_error_does_not_reselect_and_redacts_key(stable_chat, mocker, caplog):
    (_, selector, stream), _, invalidate, _ = stable_chat
    mocker.patch.object(langchain_runtime, "resolve_provider", return_value="custom")
    stream.side_effect = RuntimeError("quota exceeded for provider-secret {upstream secret}")
    events = send_chat(model_id="saved-model")
    selector.assert_not_called()
    invalidate.assert_called_once_with("user-1", "custom", "saved-model")
    assert "quota exceeded" in events[-1][1]
    assert "provider-secret" not in str(events) + caplog.text
    assert "upstream secret" not in str(events) + caplog.text


def test_partial_stream_remembers_fallback_without_replaying(stable_chat):
    (_, selector, stream), _, _, _ = stable_chat
    set_fallback(selector)
    def partial(**kwargs):
        if kwargs["model_id"] == "saved-model":
            yield "partial answer with enough content to stream before the provider fails "
            raise RuntimeError("quota exceeded")
        yield "fallback response"
    stream.side_effect = partial
    events = send_chat()
    text = "".join(data for kind, data in events if kind == "message")
    assert text.startswith("partial answer") and "fallback" not in text
    assert events[-1][0] == "error" and "interrupted" in events[-1][1]
    assert stream.call_count == 1
    assert "".join(data for kind, data in send_chat() if kind == "message") == "fallback response"
    assert selector.call_count == 2


@pytest.mark.parametrize("boundary", ["parser", "retrieval", "database"])
def test_non_provider_errors_do_not_invalidate_or_fail_over(stable_chat, mocker, boundary):
    (understand, selector, stream), _, invalidate, _ = stable_chat
    if boundary == "parser":
        mocker.patch("services.ai_service.TaggedResponseStreamParser.feed", side_effect=ValueError("invalid parser input"))
    elif boundary == "retrieval":
        understand.side_effect = RuntimeError("retrieval failed")
    else:
        stream.side_effect = ValueError("database failed")
    assert send_chat()[-1][0] == "error"
    selector.assert_called_once()
    invalidate.assert_not_called()


def test_sql_repair_failover_does_not_repeat_completed_preview(stable_chat, mocker):
    (understand, selector, stream), _, invalidate, _ = stable_chat
    understand.return_value = SimpleNamespace(needs_retrieval=False, intent="text_to_sql")
    set_fallback(selector)
    stream.side_effect = lambda **kwargs: iter(["SELECT bad FROM customers"])
    invoke = mocker.patch.object(langchain_runtime, "invoke_text", side_effect=[RuntimeError("quota exceeded"), "SELECT id FROM customers"])
    preview = mocker.patch("services.ai_service.sql_execution_verifier.preview", side_effect=[
        SimpleNamespace(ok=False, sql="SELECT bad FROM customers", to_dict=lambda: {"error": "bad column"}),
        SimpleNamespace(ok=True, sql="SELECT id FROM customers", columns=["id"], data=[{"id": 1}]),
    ])
    events = send_chat(db_id="db-1")
    assert preview.call_count == invoke.call_count == 2
    assert invoke.call_args.kwargs["model_id"] == "fallback"
    assert stream.call_count == 1
    invalidate.assert_called_once()
    assert ("query_result", {"columns": ["id"], "data": [{"id": 1}]}) in events


def test_buffered_partial_content_is_discarded_before_fallback(stable_chat):
    (_, selector, stream), _, _, _ = stable_chat
    set_fallback(selector)
    def partial(**kwargs):
        if kwargs["model_id"] == "saved-model":
            yield "short"
            raise RuntimeError("quota exceeded")
        yield "fallback response"
    stream.side_effect = partial
    events = send_chat()
    assert "".join(data for kind, data in events if kind == "message") == "fallback response"
    assert not any(kind == "error" for kind, _ in events)


def test_stream_can_resume_in_fresh_contexts(stable_chat):
    from contextvars import Context
    stream = ai_service.stream_generate_response("Compare joins", user_id="user-1", conv_id="a")
    events = []
    while True:
        try:
            events.append(Context().run(next, stream))
        except StopIteration:
            break
    assert "".join(data for kind, data in events if kind == "message") == "response"
    assert not any(kind == "error" for kind, _ in events)


def test_sticky_readiness_provider_failure_excludes_saved_pair(stable_chat):
    (_, selector, stream), validate, invalidate, _ = stable_chat
    send_chat()
    validate.side_effect = RuntimeError("model access denied")
    selector.return_value = {"model": "fallback", "provider": "custom"}
    events = send_chat()
    assert selector.call_args.kwargs["excluded_models"] == {("saved-model", "custom")}
    invalidate.assert_called_once_with("user-1", "custom", "saved-model")
    assert not any(kind == "error" for kind, _ in events)


@pytest.mark.parametrize("task_key", ["sql.explain", "sql.optimize"])
def test_mongo_analysis_provider_failure_retries_buffered_call(stable_chat, mocker, task_key):
    (understand, selector, stream), _, invalidate, _ = stable_chat
    understand.return_value = SimpleNamespace(needs_retrieval=True, intent="text_to_sql")
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    set_fallback(selector)
    stream.side_effect = fail_first
    agent = mocker.patch.object(ai_service, "_execute_mongodb_agent")
    events = send_chat(db_id="db-1", task_key=task_key)
    assert "".join(data for kind, data in events if kind == "message") == "fallback response"
    assert stream.call_count == 2
    invalidate.assert_called_once()
    agent.assert_not_called()


def test_mongo_agent_provider_failure_retries_without_replaying_executor(stable_chat, mocker):
    import json
    (understand, selector, _), _, invalidate, _ = stable_chat
    understand.return_value = SimpleNamespace(needs_retrieval=True, intent="text_to_sql")
    mocker.patch("services.ai_service.SchemaMetadataSource.get_db_type", return_value="mongodb")
    mocker.patch("services.ai.agent.schema_context_service.build_schema_context", return_value=SimpleNamespace(
        context="DATABASE DIALECT: MONGODB", collections=("orders",), database="analytics",
        field_allowlist={"orders": ("status",)}, array_field_allowlist={}, retrieval_trace={}, citations=[],
    ))
    mocker.patch.object(ai_service._context_mgr, "build_context_for_agent", return_value="")
    set_fallback(selector)
    invoke = mocker.patch.object(langchain_runtime, "invoke_text", side_effect=[
        RuntimeError("quota exceeded for provider-secret"),
        json.dumps({"type": "query_result", "query": {"operation": "find", "collection": "orders"}, "confidence": 5, "summary": "rows"}),
    ])
    executor = mocker.patch("services.ai.agent.MongoExecutor.execute_spec", return_value=([{"status": "paid"}], ["status"]))
    events = send_chat(db_id="db-1")
    assert invoke.call_count == 2
    assert invoke.call_args.kwargs["model_id"] == "fallback"
    assert invoke.call_args.kwargs["provider"] == "google"
    executor.assert_called_once()
    invalidate.assert_called_once_with("user-1", "custom", "saved-model")
    assert ("query_result", {"columns": ["status"], "data": [{"status": "paid"}]}) in events


@pytest.mark.parametrize("status", [401, 403, 404, 429, 503])
def test_typed_provider_failure_fails_over(stable_chat, status):
    (_, selector, stream), _, invalidate, _ = stable_chat
    set_fallback(selector)
    error = Exception("upstream request failed")
    error.status_code = status
    stream.side_effect = [error, iter(["response"])]
    assert ("message", "response") in send_chat()
    invalidate.assert_called_once()
    assert stream.call_count == 2


def test_wrapped_google_provider_error_fails_over(stable_chat):
    from langchain_google_genai.chat_models import ChatGoogleGenerativeAIError
    (_, selector, stream), _, invalidate, _ = stable_chat
    set_fallback(selector)
    error = ChatGoogleGenerativeAIError("provider request rejected")
    cause = Exception("quota exhausted")
    cause.code = 429
    error.__cause__ = cause
    stream.side_effect = [error, iter(["response"])]
    assert ("message", "response") in send_chat()
    invalidate.assert_called_once()


def test_partial_stream_without_fallback_terminates_once(stable_chat):
    (_, selector, stream), _, _, _ = stable_chat
    selector.side_effect = [{"model": "saved-model", "provider": "custom"}, RuntimeError("No active AI models")]
    def partial(**kwargs):
        yield "A sufficiently long partial response that reaches the user before failure."
        raise RuntimeError("quota exceeded")
    stream.side_effect = partial
    events = send_chat()
    assert events[-1][0] == "error" and "no eligible fallback" in events[-1][1]
    assert sum(kind == "error" for kind, _ in events) == 1
    assert stream.call_count == 1


def test_concurrent_first_messages_select_one_stable_pair(stable_chat):
    from concurrent.futures import ThreadPoolExecutor
    (_, selector, _), _, _, _ = stable_chat
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: send_chat(), range(2)))
    assert all(("message", "response") in events for events in results)
    selector.assert_called_once()


@pytest.mark.parametrize("status", [401, 404, 429, 503])
def test_real_sanitized_preflight_failure_excludes_sticky_pair(stable_chat, mocker, status):
    (_, selector, _), validate, invalidate, _ = stable_chat
    send_chat()
    model = mocker.MagicMock()
    model.invoke.side_effect = RuntimeError(f"Error code: {status} - {{'upstream': 'provider-secret'}}")
    mocker.patch.object(langchain_runtime, "build_model", return_value=model)
    mocker.patch("services.ai.langchain_runtime.get_ai_api_key", return_value="provider-secret")

    def actual_preflight(**kwargs):
        langchain_runtime._probe_model_access(kwargs["model_id"], kwargs["user_id"], kwargs["provider"])

    validate.side_effect = actual_preflight
    selector.return_value = {"model": "fallback", "provider": "custom"}
    events = send_chat()
    assert selector.call_args.kwargs["excluded_models"] == {("saved-model", "custom")}
    invalidate.assert_called_once_with("user-1", "custom", "saved-model")
    model.invoke.assert_called_once()
    assert not any(kind == "error" for kind, _ in events)
    assert "provider-secret" not in str(events)


def test_provider_error_outer_message_survives_unrelated_cause(stable_chat):
    (_, selector, stream), _, invalidate, _ = stable_chat
    set_fallback(selector)
    error = RuntimeError("model access denied")
    error.__cause__ = ValueError("response decoding failed")
    stream.side_effect = [error, iter(["response"])]
    assert ("message", "response") in send_chat()
    invalidate.assert_called_once()


def test_stream_error_redacts_connection_credentials(stable_chat, mocker, caplog):
    (_, _, stream), _, _, _ = stable_chat
    mocker.patch.object(langchain_runtime, "resolve_provider", return_value="custom")
    stream.side_effect = RuntimeError("quota exceeded at mongodb://alice:database-secret@db.test/orders password=other-secret for provider-secret")
    events = send_chat(model_id="saved-model")
    assert events[-1][0] == "error"
    assert "quota exceeded" in events[-1][1]
    combined = str(events) + caplog.text
    assert "provider-secret" not in combined
    assert "database-secret" not in combined
    assert "other-secret" not in combined
    assert "mongodb://" not in combined
