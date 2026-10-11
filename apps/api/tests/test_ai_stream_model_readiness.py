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


def test_stream_checks_model_readiness_before_retrieval(mocker):
    mocker.patch(
        "services.ai_service.rag_pipeline_service.understand_query",
        return_value=SimpleNamespace(needs_retrieval=True),
    )
    mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        return_value="gemini-inactive",
    )
    mocker.patch(
        "services.ai_service.langchain_runtime.resolve_provider",
        return_value="google",
    )
    validate_model_ready = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=RuntimeError("AI model 'gemini-inactive' is inactive"),
    )
    select_auto = mocker.patch("services.ai_service.langchain_runtime.select_auto_model")
    build_context = mocker.patch("services.ai_service.rag_pipeline_service.build_context_for_understanding")

    events = list(ai_service.stream_generate_response(
        "show customer tables",
        db_id="db-1",
        user_id="user-1",
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
    build_context.assert_not_called()
    select_auto.assert_not_called()


def test_stream_auto_uses_selected_openai_compatible_model(mocker):
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=understanding)
    mocker.patch("services.ai_service.task_model_router.resolve_model_id", return_value=None)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    select_auto = mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        return_value={"provider": "custom", "model": "kr/available-model"},
    )
    validate = mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    events = list(ai_service.stream_generate_response("Compare join strategies", user_id="user-1"))

    select_auto.assert_called_once_with(provider="custom", user_id="user-1")
    validate.assert_not_called()
    assert stream_text.call_args.kwargs["model_id"] == "kr/available-model"
    assert stream_text.call_args.kwargs["provider"] == "custom"
    assert any(event == "message" and payload == "response" for event, payload in events)


def test_stream_auto_runs_real_selector_and_reuses_candidate_provider(mocker):
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=understanding)
    mocker.patch("services.ai_service.task_model_router.resolve_model_id", return_value=None)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch.object(langchain_runtime, "list_available_models", return_value=["candidate-a", "candidate-b"])
    probe = mocker.patch.object(langchain_runtime, "_probe_model_access")
    mocker.patch("services.ai.langchain_runtime.get_ai_api_key", return_value="secret-value")
    mocker.patch("services.ai.langchain_runtime.random.shuffle", side_effect=lambda values: values.reverse())
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    events = list(ai_service.stream_generate_response("Compare join strategies", user_id="user-1"))

    assert stream_text.call_args.kwargs["model_id"] == "candidate-b"
    assert stream_text.call_args.kwargs["provider"] == "custom"
    probe.assert_called_once_with("candidate-b", "user-1", "custom")
    assert any(event == "message" and payload == "response" for event, payload in events)


def test_stream_task_assigned_compatible_model_does_not_use_auto_fallback(mocker):
    mocker.patch(
        "services.ai_service.rag_pipeline_service.understand_query",
        return_value=SimpleNamespace(needs_retrieval=True),
    )
    mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        return_value="assigned/model",
    )
    mocker.patch(
        "services.ai_service.langchain_runtime.resolve_provider",
        return_value="custom",
    )
    validate = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=RuntimeError("assigned model unavailable"),
    )
    select_auto = mocker.patch("services.ai_service.langchain_runtime.select_auto_model")

    events = list(ai_service.stream_generate_response("show customer tables", user_id="user-1"))

    assert events == [
        ("thinking", MODEL_PREFLIGHT_STATUS),
        ("error", "assigned model unavailable"),
    ]
    validate.assert_called_once_with(
        model_id="assigned/model",
        user_id="user-1",
        provider="custom",
        probe_remote=True,
    )
    select_auto.assert_not_called()


def test_sql_preview_repair_invocation_reuses_selected_provider_and_model(mocker):
    preview = SimpleNamespace(ok=False, sql="SELECT * FROM customers", to_dict=lambda: {"error": "bad column"})
    successful_preview = SimpleNamespace(ok=True, sql="SELECT id FROM customers", to_dict=lambda: {})
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


def test_auto_selection_precedes_understanding_and_reuses_selected_model(mocker):
    calls = []
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)

    def resolve_task(task_key, user_id, explicit_model_id, database_id):
        calls.append(("task", task_key, explicit_model_id))
        return None

    mocker.patch("services.ai_service.task_model_router.resolve_model_id", side_effect=resolve_task)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        side_effect=lambda provider, user_id: calls.append(("select", provider, user_id))
        or {"provider": "custom", "model": "auto/selected"},
    )

    def understand(*args, **kwargs):
        calls.append(("understand", kwargs["model_id"]))
        return understanding

    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", side_effect=understand)
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert calls.index(("select", "custom", "user-1")) < calls.index(("understand", "auto/selected"))
    assert calls.count(("select", "custom", "user-1")) == 1
    assert stream_text.call_args.kwargs["model_id"] == "auto/selected"
    assert stream_text.call_args.kwargs["provider"] == "custom"
    assert any(event == "message" and payload == "response" for event, payload in events)


def test_triage_assignment_is_used_for_understanding_before_final_auto_selection(mocker):
    calls = []
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)

    def resolve_task(task_key, user_id, explicit_model_id, database_id):
        calls.append(("task", task_key, explicit_model_id))
        return "triage/assigned" if task_key == "router.triage" else None

    mocker.patch("services.ai_service.task_model_router.resolve_model_id", side_effect=resolve_task)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")

    def select(provider, user_id):
        calls.append(("select", provider, user_id))
        return {"provider": "custom", "model": "auto/final"}

    mocker.patch("services.ai_service.langchain_runtime.select_auto_model", side_effect=select)

    def understand(*args, **kwargs):
        calls.append(("understand", kwargs["model_id"]))
        return understanding

    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", side_effect=understand)
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert calls.index(("understand", "triage/assigned")) < calls.index(("select", "custom", "user-1"))
    assert stream_text.call_args.kwargs["model_id"] == "auto/final"
    assert calls.count(("select", "custom", "user-1")) == 1


def test_final_compatible_task_assignment_overrides_preselected_auto_and_is_validated(mocker):
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    task_calls = []

    def resolve_task(task_key, user_id, explicit_model_id, database_id):
        task_calls.append((task_key, explicit_model_id))
        return None if task_key == "router.triage" else "assigned/final"

    mocker.patch("services.ai_service.task_model_router.resolve_model_id", side_effect=resolve_task)
    mocker.patch(
        "services.ai_service.langchain_runtime.resolve_provider",
        side_effect=lambda model_id=None, user_id=None: "qwen" if model_id == "assigned/final" else "custom",
    )
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    select_auto = mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        return_value={"provider": "custom", "model": "auto/preselected"},
    )
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=understanding)
    validate = mocker.patch("services.ai_service.langchain_runtime.validate_model_ready")
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    select_auto.assert_called_once_with(provider="custom", user_id="user-1")
    assert task_calls == [("router.triage", None), ("chat.general", None)]
    validate.assert_called_once_with(
        model_id="assigned/final",
        user_id="user-1",
        provider="qwen",
        probe_remote=True,
    )
    assert stream_text.call_args.kwargs["model_id"] == "assigned/final"
    assert stream_text.call_args.kwargs["provider"] == "qwen"


def test_final_task_assignment_failure_does_not_fallback_to_preselected_auto(mocker):
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        side_effect=lambda task_key, user_id, explicit_model_id, database_id:
            None if task_key == "router.triage" else "assigned/final",
    )
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    select_auto = mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        return_value={"provider": "custom", "model": "auto/preselected"},
    )
    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", return_value=understanding)
    validate = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=RuntimeError("assigned model unavailable"),
    )
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text")

    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert events[-1] == ("error", "assigned model unavailable")
    select_auto.assert_called_once_with(provider="custom", user_id="user-1")
    validate.assert_called_once_with(
        model_id="assigned/final",
        user_id="user-1",
        provider="custom",
        probe_remote=True,
    )
    stream_text.assert_not_called()


def test_inventory_failure_default_is_selected_once_before_understanding(mocker):
    calls = []
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        return_value=None,
    )
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="qwen")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    selector = mocker.spy(langchain_runtime, "select_auto_model")
    mocker.patch.object(
        langchain_runtime,
        "list_available_models",
        side_effect=RuntimeError("inventory unavailable"),
    )
    mocker.patch("services.ai.langchain_runtime.get_ai_api_key", return_value="secret-value")
    probe = mocker.patch.object(
        langchain_runtime,
        "_probe_model_access",
        side_effect=lambda model_id, user_id, provider: calls.append((model_id, provider)),
    )

    def understand(*args, **kwargs):
        calls.append(("understand", kwargs["model_id"]))
        return understanding

    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", side_effect=understand)
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    selector.assert_called_once_with(provider="qwen", user_id="user-1")
    probe.assert_called_once_with("qwen-plus", "user-1", "qwen")
    assert calls.index(("qwen-plus", "qwen")) < calls.index(("understand", "qwen-plus"))
    assert stream_text.call_args.kwargs["model_id"] == "qwen-plus"


def test_no_explicit_quick_response_bypasses_routing_and_inventory(mocker):
    mocker.patch.object(ai_service, "_quick_general_response", return_value="quick reply")
    select_auto = mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        side_effect=AssertionError("Auto selection must not run for quick responses"),
    )
    resolve_task = mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        side_effect=AssertionError("Task routing must not run for quick responses"),
    )
    understand = mocker.patch(
        "services.ai_service.rag_pipeline_service.understand_query",
        side_effect=AssertionError("Understanding must not run for quick responses"),
    )

    events = list(ai_service.stream_generate_response("hello", task_key="sql.explain", user_id="user-1"))

    assert events == [("message", "quick reply")]
    select_auto.assert_not_called()
    resolve_task.assert_not_called()
    understand.assert_not_called()


def test_pre_understanding_auto_selection_failure_emits_readiness_error(mocker):
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        return_value=None,
    )
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        side_effect=RuntimeError("Custom Provider model inventory failed: unavailable"),
    )
    understand = mocker.patch("services.ai_service.rag_pipeline_service.understand_query")
    build_context = mocker.patch("services.ai_service.rag_pipeline_service.build_context_for_understanding")
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text")

    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert events == [
        ("thinking", MODEL_PREFLIGHT_STATUS),
        ("error", "Custom Provider model inventory failed: unavailable"),
    ]
    understand.assert_not_called()
    build_context.assert_not_called()
    stream_text.assert_not_called()


def test_triage_assignment_readiness_failure_stops_before_understanding(mocker):
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)
    resolve_task = mocker.patch(
        "services.ai_service.task_model_router.resolve_model_id",
        return_value="triage/assigned",
    )
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    validate = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=RuntimeError("triage model unavailable"),
    )
    select_auto = mocker.patch("services.ai_service.langchain_runtime.select_auto_model")
    understand = mocker.patch("services.ai_service.rag_pipeline_service.understand_query")
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text")

    events = list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert events == [
        ("thinking", MODEL_PREFLIGHT_STATUS),
        ("error", "triage model unavailable"),
    ]
    resolve_task.assert_called_once_with("router.triage", "user-1", None, "db-1")
    validate.assert_called_once_with(
        model_id="triage/assigned",
        user_id="user-1",
        provider="custom",
        probe_remote=True,
    )
    select_auto.assert_not_called()
    understand.assert_not_called()
    stream_text.assert_not_called()


def test_triage_assignment_is_validated_before_understanding_and_final_auto(mocker):
    calls = []
    understanding = SimpleNamespace(
        needs_retrieval=False,
        behavior="general_chat",
        rag_mode="none",
        exploration_score=0.0,
        intent="general_chat",
    )
    mocker.patch.object(ai_service, "_quick_general_response", return_value=None)

    def resolve_task(task_key, user_id, explicit_model_id, database_id):
        calls.append(("task", task_key, explicit_model_id))
        return "triage/assigned" if task_key == "router.triage" else None

    mocker.patch("services.ai_service.task_model_router.resolve_model_id", side_effect=resolve_task)
    mocker.patch("services.ai_service.langchain_runtime.resolve_provider", return_value="custom")
    mocker.patch("services.ai_service.langchain_runtime.is_openai_compatible_provider", return_value=True)
    validate = mocker.patch(
        "services.ai_service.langchain_runtime.validate_model_ready",
        side_effect=lambda **kwargs: calls.append(("validate", kwargs["model_id"])),
    )

    def understand(*args, **kwargs):
        calls.append(("understand", kwargs["model_id"]))
        return understanding

    mocker.patch("services.ai_service.rag_pipeline_service.understand_query", side_effect=understand)
    mocker.patch(
        "services.ai_service.langchain_runtime.select_auto_model",
        side_effect=lambda provider, user_id: calls.append(("select", provider))
        or {"provider": "custom", "model": "auto/final"},
    )
    stream_text = mocker.patch("services.ai_service.langchain_runtime.stream_text", return_value=iter(["response"]))

    list(ai_service.stream_generate_response("Compare joins", user_id="user-1", db_id="db-1"))

    assert calls.index(("validate", "triage/assigned")) < calls.index(("understand", "triage/assigned"))
    assert calls.index(("understand", "triage/assigned")) < calls.index(("select", "custom"))
    validate.assert_called_once_with(
        model_id="triage/assigned",
        user_id="user-1",
        provider="custom",
        probe_remote=True,
    )
    assert stream_text.call_args.kwargs["model_id"] == "auto/final"
    assert stream_text.call_args.kwargs["provider"] == "custom"
