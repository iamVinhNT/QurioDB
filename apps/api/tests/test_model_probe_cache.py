"""Regression coverage for bounded, credential-aware readiness positives."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import AIModel, Base, UserAIConfig
import services.ai.langchain_runtime as runtime

pytestmark = pytest.mark.rag


@pytest.fixture
def cache(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(runtime, "SessionLocal", factory)
    monkeypatch.setattr(runtime, "decrypt_key", lambda value: value)
    monkeypatch.setattr(runtime, "HAS_LANGCHAIN", True)
    with factory() as session:
        session.add_all([
            UserAIConfig(id="config", userId="user", provider="Custom", apiKey="secret", baseUrl="https://test.invalid/v1"),
            UserAIConfig(id="other", userId="other", provider="Custom", apiKey="other-secret", baseUrl="https://test.invalid/v1"),
            UserAIConfig(id="google", userId="user", provider="Google", apiKey="google-secret"),
            AIModel(id="model", modelId="model", name="Model", provider="Custom"),
        ])
        session.commit()
    subject = runtime.LangChainRuntime()
    clock, probes = [100.0], []
    monkeypatch.setattr(runtime.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(subject, "_probe_model_access", lambda *args: probes.append(args))
    yield subject, factory, clock, probes
    engine.dispose()


def validate(subject, model="model", user="user", provider="Custom", remote=True):
    return subject.validate_model_ready(model, user, provider, probe_remote=remote)


def test_success_expires_exactly_300_seconds_after_completion(cache, monkeypatch):
    subject, _, clock, probes = cache
    def probe(*args):
        probes.append(args)
        clock[0] += 20
    monkeypatch.setattr(subject, "_probe_model_access", probe)
    validate(subject)
    clock[0] = 419.999
    validate(subject, provider=" custom ")
    assert len(probes) == 1
    clock[0] = 420
    validate(subject)
    assert len(probes) == 2


@pytest.mark.parametrize("change", ["credential", "url", "remove", "inactive", "missing-url"])
def test_local_changes_evict_positive_before_reuse(cache, change):
    subject, factory, _, probes = cache
    validate(subject)
    with factory() as session:
        config = session.query(UserAIConfig).filter_by(id="config").one()
        if change == "credential":
            config.apiKey = "rotated-secret"
        elif change == "url":
            config.baseUrl = "https://other.invalid/v1"
        elif change == "remove":
            session.delete(config)
        elif change == "missing-url":
            config.baseUrl = None
        else:
            session.query(AIModel).filter_by(id="model").one().isActive = False
        session.commit()
    if change in {"remove", "inactive", "missing-url"}:
        with pytest.raises(RuntimeError):
            validate(subject)
        assert not subject._model_probe_cache
        with factory() as session:
            if change == "remove":
                session.add(UserAIConfig(id="config", userId="user", provider="Custom", apiKey="secret", baseUrl="https://test.invalid/v1"))
            elif change == "missing-url":
                session.query(UserAIConfig).filter_by(id="config").one().baseUrl = "https://test.invalid/v1"
            else:
                session.query(AIModel).filter_by(id="model").one().isActive = True
            session.commit()
    validate(subject)
    assert len(probes) == 2


def test_user_model_provider_isolation_and_exact_invalidation(cache):
    subject, _, _, probes = cache
    validate(subject)
    validate(subject, user="other")
    validate(subject, model="second")
    validate(subject, provider="Google")
    validate(subject, provider=" custom ")
    assert len(probes) == 4
    subject.invalidate_model_probe("user", "CUSTOM", "model")
    validate(subject, user="other")
    validate(subject, model="second")
    validate(subject, provider="Google")
    validate(subject)
    assert len(probes) == 5


def test_failures_repeat_and_do_not_expose_credentials(cache, monkeypatch, caplog):
    subject, _, _, probes = cache
    def fail(*args):
        probes.append(args)
        raise RuntimeError("secret rejected {upstream payload}")
    monkeypatch.setattr(subject, "_probe_model_access", fail)
    for _ in range(2):
        with pytest.raises(RuntimeError, match="redacted") as error:
            validate(subject)
        assert "secret" not in str(error.value)
        assert error.value.__suppress_context__
    assert len(probes) == 2
    assert not subject._model_probe_cache
    assert not subject._model_probe_pending
    assert "secret" not in caplog.text


def test_actual_probe_sanitizes_provider_exception(cache, monkeypatch):
    subject, _, _, _ = cache
    class Model:
        def invoke(self, *args, **kwargs):
            raise RuntimeError("secret quota exceeded")
    monkeypatch.setattr(subject, "build_model", lambda **kwargs: Model())
    monkeypatch.setattr(subject, "make_messages", lambda *args: [])
    with pytest.raises(RuntimeError, match="preflight failed.*redacted") as error:
        runtime.LangChainRuntime._probe_model_access(subject, "model", "user", "custom")
    assert "secret" not in str(error.value)


def test_local_validation_evicts_changed_fingerprint_without_probing(cache):
    subject, factory, _, probes = cache
    validate(subject)
    with factory() as session:
        session.query(UserAIConfig).filter_by(id="config").one().apiKey = "rotated"
        session.commit()
    validate(subject, remote=False)
    assert len(probes) == 1
    assert not subject._model_probe_cache


def test_expiration_pruning_and_oldest_eviction_at_512_entries(cache):
    subject, _, clock, probes = cache
    for index in range(513):
        clock[0] += 0.1
        validate(subject, model=f"model-{index}")
    assert len(subject._model_probe_cache) == 512
    assert ("user", "custom", "model-0") not in subject._model_probe_cache
    validate(subject, model="model-1")
    assert len(probes) == 513
    clock[0] += 300
    validate(subject, remote=False)
    assert not subject._model_probe_cache


def test_fingerprint_contains_no_plaintext_credentials(cache):
    subject, _, _, _ = cache
    validate(subject)
    fingerprint = next(iter(subject._model_probe_cache.values()))[1]
    assert isinstance(fingerprint, bytes)
    assert len(fingerprint) == 32
    assert b"secret" not in fingerprint


def test_invalidation_during_successful_probe_prevents_resurrection(cache, monkeypatch):
    subject, _, _, _ = cache
    monkeypatch.setattr(subject, "_probe_model_access", lambda *args: subject.invalidate_model_probe("user", "custom", "model"))
    validate(subject)
    assert not subject._model_probe_cache
    assert not subject._model_probe_pending


def test_parallel_network_probes_are_not_serialized(cache, monkeypatch):
    subject, _, _, probes = cache
    monkeypatch.setattr(runtime, "get_ai_api_key", lambda *args: "secret")
    monkeypatch.setattr(runtime, "resolve_base_url", lambda *args: "https://test.invalid/v1")
    barrier = Barrier(2)
    def probe(*args):
        barrier.wait(timeout=3)
        probes.append(args)
    monkeypatch.setattr(subject, "_probe_model_access", probe)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(validate, subject, None, user, "Google") for user in ("user", "other")]
        for future in futures:
            future.result(timeout=5)
    assert len(probes) == 2
    assert len(subject._model_probe_cache) == 2
    assert not subject._model_probe_pending


def test_pending_tokens_are_bounded_and_finish_cleanly(cache, monkeypatch):
    subject, _, _, _ = cache
    monkeypatch.setattr(runtime, "MODEL_PROBE_CACHE_MAX_ENTRIES", 2)
    subject._model_probe_pending.update({
        ("user", "custom", "old-1"): (object(), b"old"),
        ("user", "custom", "old-2"): (object(), b"old"),
    })
    def probe(*args):
        assert len(subject._model_probe_pending) == 2
        assert ("user", "custom", "old-1") not in subject._model_probe_pending
    monkeypatch.setattr(subject, "_probe_model_access", probe)
    validate(subject)
    assert ("user", "custom", "model") not in subject._model_probe_pending
    assert len(subject._model_probe_cache) == 1


def test_configuration_change_during_probe_cancels_old_positive(cache, monkeypatch):
    subject, factory, _, _ = cache
    def probe(*args):
        with factory() as session:
            session.query(UserAIConfig).filter_by(id="config").one().apiKey = "rotated"
            session.commit()
        validate(subject, remote=False)
    monkeypatch.setattr(subject, "_probe_model_access", probe)
    validate(subject)
    assert not subject._model_probe_cache
    assert not subject._model_probe_pending


def test_effective_environment_url_change_forces_new_probe(cache, monkeypatch):
    subject, _, _, probes = cache
    monkeypatch.setattr(runtime, "get_ai_api_key", lambda *args: "secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://first.invalid/v1")
    validate(subject, provider="OpenAI")
    validate(subject, provider="OpenAI")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://second.invalid/v1")
    validate(subject, provider="OpenAI")
    assert len(probes) == 2
