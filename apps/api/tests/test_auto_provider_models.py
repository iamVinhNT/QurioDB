"""
test_auto_provider_models.py

Regression tests for registered models and user-scoped Auto Provider selection.
"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models import AIModel, Base, UserAIConfig
import services.ai.langchain_runtime as runtime

pytestmark = pytest.mark.rag


@pytest.fixture
def registry(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(runtime, "SessionLocal", factory)
    monkeypatch.setattr(runtime, "decrypt_key", lambda value: value)
    monkeypatch.setattr(runtime.random, "shuffle", lambda candidates: None)
    with factory() as session:
        session.add_all([
            UserAIConfig(id="google", userId="user-1", provider="Google", apiKey="google-secret"),
            UserAIConfig(id="custom", userId="user-1", provider="Custom", apiKey="custom-secret", baseUrl="http://configured.test/v1"),
            UserAIConfig(id="other", userId="user-2", provider="OpenAI", apiKey="other-secret"),
            UserAIConfig(id="removed", userId="user-1", provider="9router", apiKey="removed-secret"),
            AIModel(id="google", name="Google model", modelId="saved-google", provider="Google"),
            AIModel(id="custom", name="Custom model", modelId="saved-custom", provider="Custom"),
            AIModel(id="inactive", name="Inactive model", modelId="inactive", provider="Google", isActive=False),
            AIModel(id="other", name="Other user model", modelId="saved-openai", provider="OpenAI"),
            AIModel(id="removed", name="Removed provider", modelId="removed-model", provider="9router"),
        ])
        session.commit()
    yield factory
    engine.dispose()


def test_auto_random_pool_is_active_registered_models_with_this_users_configuration(registry, monkeypatch):
    subject = runtime.LangChainRuntime()
    pool, probes = [], []

    def shuffle(candidates):
        pool.extend(candidates)
        candidates.reverse()

    monkeypatch.setattr(runtime.random, "shuffle", shuffle)
    monkeypatch.setattr(subject, "_probe_model_access", lambda model_id, user_id, provider: probes.append((model_id, user_id, provider)))
    monkeypatch.setattr(subject, "list_available_models", lambda *args: pytest.fail("No upstream inventory"))
    assert subject.select_auto_model("user-1") == {"provider": "custom", "model": "saved-custom"}
    assert pool == [("saved-google", "google"), ("saved-custom", "custom")]
    assert probes == [("saved-custom", "user-1", "custom")]


def test_auto_reshuffles_each_request(registry, monkeypatch):
    subject = runtime.LangChainRuntime()
    monkeypatch.setattr(subject, "_probe_model_access", lambda *args: None)
    assert subject.select_auto_model("user-1")["model"] == "saved-google"
    monkeypatch.setattr(runtime.random, "shuffle", lambda candidates: candidates.reverse())
    assert subject.select_auto_model("user-1")["model"] == "saved-custom"


@pytest.mark.parametrize("missing", ["key", "url"])
def test_auto_excludes_incomplete_custom_configuration(registry, monkeypatch, missing):
    with registry() as session:
        config = session.query(UserAIConfig).filter_by(id="custom").one()
        if missing == "key":
            config.apiKey = ""
        else:
            config.baseUrl = "  "
        session.commit()
    subject = runtime.LangChainRuntime()
    monkeypatch.setattr(runtime.random, "shuffle", lambda candidates: candidates.reverse())
    monkeypatch.setattr(subject, "_probe_model_access", lambda *args: None)
    assert subject.select_auto_model("user-1") == {"provider": "google", "model": "saved-google"}


def test_auto_uses_saved_key_base_url_and_model(registry, monkeypatch, mocker):
    subject = runtime.LangChainRuntime()
    monkeypatch.setattr(runtime.random, "shuffle", lambda candidates: candidates.reverse())
    client = mocker.patch.object(runtime, "ChatOpenAI")
    assert subject.select_auto_model("user-1")["model"] == "saved-custom"
    assert client.call_args.kwargs["api_key"] == "custom-secret"
    assert client.call_args.kwargs["base_url"] == "http://configured.test/v1"
    assert client.call_args.kwargs["model"] == "saved-custom"


def test_auto_retries_across_registered_providers(registry, monkeypatch):
    subject = runtime.LangChainRuntime()
    probes = []

    def probe(model_id, user_id, provider):
        probes.append((model_id, provider))
        if provider == "google":
            raise RuntimeError("unavailable")

    monkeypatch.setattr(subject, "_probe_model_access", probe)
    assert subject.select_auto_model("user-1") == {"provider": "custom", "model": "saved-custom"}
    assert probes == [("saved-google", "google"), ("saved-custom", "custom")]


def test_auto_bounds_retries_and_redacts_provider_keys(registry, monkeypatch):
    with registry() as session:
        session.add_all([AIModel(id=f"extra-{i}", name=f"Extra {i}", modelId=f"extra-{i}", provider="Google") for i in range(2)])
        session.commit()
    subject = runtime.LangChainRuntime()
    probes = []

    def probe(model_id, user_id, provider):
        probes.append(model_id)
        raise RuntimeError(f"credential {runtime.get_ai_api_key(user_id, provider)} rejected")

    monkeypatch.setattr(subject, "_probe_model_access", probe)
    with pytest.raises(RuntimeError, match="after 3 attempts") as error:
        subject.select_auto_model("user-1")
    assert len(probes) == 3
    assert "google-secret" not in str(error.value)
    assert "custom-secret" not in str(error.value)


def test_auto_does_not_fall_back_to_unregistered_models(registry, monkeypatch):
    with registry() as session:
        session.query(AIModel).delete()
        session.commit()
    subject = runtime.LangChainRuntime()
    monkeypatch.setattr(subject, "list_available_models", lambda *args: pytest.fail("No inventory fallback"))
    monkeypatch.setattr(subject, "_probe_model_access", lambda *args: pytest.fail("No default-model fallback"))
    with pytest.raises(RuntimeError, match="No active AI models"):
        subject.select_auto_model("user-1")


def test_auto_does_not_use_other_users_configuration(registry):
    with pytest.raises(RuntimeError, match="No active AI models"):
        runtime.LangChainRuntime().select_auto_model("user-without-config")


def test_auto_requires_user_identity(registry):
    with pytest.raises(RuntimeError, match="requires a signed-in user or desktop identity"):
        runtime.LangChainRuntime().select_auto_model()
