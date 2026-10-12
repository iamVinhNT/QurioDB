"""
langchain_runtime.py

LangChain, LangGraph, and LangSmith integration helpers for QurioDB AI services.
This module centralizes optional imports, model construction, tracing metadata,
and message conversion so route/service code can stay focused on product logic.
"""

import logging
import json
import os
import random
import re
import time
from threading import Lock
from urllib.parse import urlsplit
from typing import Any, Dict, Iterable, List, Optional
from urllib.request import Request, urlopen

try:
    from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
    from langchain_google_genai import ChatGoogleGenerativeAI
    from langchain_openai import ChatOpenAI

    HAS_LANGCHAIN = True
except ImportError:
    AIMessage = None
    BaseMessage = Any
    HumanMessage = None
    SystemMessage = None
    ChatGoogleGenerativeAI = None
    ChatOpenAI = None
    HAS_LANGCHAIN = False

try:
    from langchain_anthropic import ChatAnthropic

    HAS_ANTHROPIC = True
except ImportError:
    ChatAnthropic = None
    HAS_ANTHROPIC = False

try:
    from langgraph.graph import END, START, StateGraph

    HAS_LANGGRAPH = True
except ImportError:
    END = None
    START = None
    StateGraph = None
    HAS_LANGGRAPH = False

try:
    from langsmith import traceable

    HAS_LANGSMITH = True
except ImportError:
    traceable = None
    HAS_LANGSMITH = False

from models import AIModel, SessionLocal, UserAIConfig
from routes.ai_config import decrypt_key

logger = logging.getLogger(__name__)

DEFAULT_LANGSMITH_PROJECT = "QurioDB AI Assistant"
OPENAI_COMPATIBLE_BASE_URLS = {
    "deepseek": "https://api.deepseek.com",
    "qwen": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
}
DEFAULT_PROVIDER_MODELS = {
    "openai": "gpt-4o-mini",
    "google": "gemini-2.5-flash",
    "anthropic": "claude-3-5-haiku-latest",
    "qwen": "qwen-plus",
    "deepseek": "deepseek-chat",
    "custom": None,
}
SUPPORTED_PROVIDERS = tuple(DEFAULT_PROVIDER_MODELS.keys())
MODEL_INVENTORY_TTL_SECONDS = 60
MODEL_INVENTORY_TIMEOUT_SECONDS = 5
AUTO_MODEL_MAX_ATTEMPTS = 3
OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1"

def _read_user_ai_config(user_id: Optional[str]) -> Dict[str, Optional[str]]:
    """Reads user-scoped provider and API key settings when available."""
    if not user_id:
        return {"api_key": None, "provider": None}

    session = SessionLocal()
    try:
        config = (session.query(UserAIConfig).filter(UserAIConfig.userId == user_id)
                  .order_by(UserAIConfig.changed_on.desc(), UserAIConfig.created_on.desc()).first())
        if config:
            return {
                "api_key": decrypt_key(config.apiKey) if config.apiKey else None,
                "provider": config.provider,
            }
    except Exception as exc:
        logger.warning("Failed to load user AI key for LangChain: %s", exc)
    finally:
        session.close()

    return {"api_key": None, "provider": None}


def _read_provider_ai_config(provider: str, user_id: Optional[str] = None) -> Dict[str, Optional[str]]:
    """Reads the encrypted DB key for the requested provider."""
    normalized_provider = normalize_provider(provider)
    session = SessionLocal()
    try:
        query = session.query(UserAIConfig)
        if user_id:
            query = query.filter(UserAIConfig.userId == user_id)

        configs = query.all()
        for config in configs:
            if normalize_provider(config.provider) != normalized_provider:
                continue
            return {
                "api_key": decrypt_key(config.apiKey) if config.apiKey else None,
                "provider": config.provider,
                "base_url": (getattr(config, "baseUrl", None) or "").strip() or None,
            }
    except Exception as exc:
        logger.warning("Failed to load %s AI key from DB: %s", normalized_provider, exc)
    finally:
        session.close()

    return {"api_key": None, "provider": None, "base_url": None}


def get_ai_api_key(user_id: Optional[str] = None, provider: Optional[str] = None) -> Optional[str]:
    """Returns the active provider API key from encrypted DB settings."""
    normalized_provider = normalize_provider(provider)
    provider_config = _read_provider_ai_config(normalized_provider, user_id)
    if provider_config.get("api_key"):
        return provider_config["api_key"]

    user_config = _read_user_ai_config(user_id)
    if normalize_provider(user_config.get("provider")) == normalized_provider and user_config.get("api_key"):
        return user_config["api_key"]
    return None


def validate_base_url(base_url: str) -> str:
    """Require an HTTP(S) URL with a hostname and valid port."""
    try:
        parsed = urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError
        parsed.port
    except (TypeError, ValueError) as exc:
        raise ValueError("Base URL must be a valid HTTP(S) URL with a hostname") from exc
    return base_url


def resolve_base_url(provider: str, user_id: Optional[str] = None) -> Optional[str]:
    """Resolves the OpenAI-compatible base URL: DB override, then env, then default."""
    normalized_provider = normalize_provider(provider)
    db_base_url = _read_provider_ai_config(normalized_provider, user_id).get("base_url")
    if db_base_url:
        return db_base_url

    env_key = normalized_provider.upper() + "_BASE_URL"
    return os.getenv(env_key) or OPENAI_COMPATIBLE_BASE_URLS.get(normalized_provider)


def normalize_provider(provider: Optional[str]) -> str:
    """Normalizes provider labels from UI, DB, and model names."""
    value = (provider or "Google").strip().lower()
    aliases = {
        "google gemini": "google",
        "gemini": "google",
        "open ai": "openai",
        "claude": "anthropic",
        "anthripic": "anthropic",
        "alibaba qwen": "qwen",
    }
    return aliases.get(value, value)


def is_google_provider(provider: Optional[str]) -> bool:
    """Returns true when a provider should use Google's native Gemini fallback."""
    return normalize_provider(provider) == "google"


def infer_provider_from_model_id(model_id: Optional[str]) -> str:
    """Best-effort provider inference for OpenAI-compatible model IDs."""
    value = (model_id or "").lower()
    if value.startswith(("gpt-", "o1", "o3", "o4", "gpt-5")):
        return "openai"
    if value.startswith(("claude-", "anthropic.")):
        return "anthropic"
    if "gemini" in value:
        return "google"
    if "deepseek" in value:
        return "deepseek"
    if "qwen" in value:
        return "qwen"
    return "google"


def ensure_langsmith_environment() -> None:
    """
    Keeps LangSmith configuration predictable.

    Tracing remains opt-in via LANGSMITH_TRACING=true. When tracing is enabled,
    QurioDB sets a stable project name unless the user has already chosen one.
    """
    if not os.getenv("LANGSMITH_PROJECT") and not os.getenv("LANGCHAIN_PROJECT"):
        os.environ["LANGSMITH_PROJECT"] = DEFAULT_LANGSMITH_PROJECT


def langsmith_metadata(user_id: Optional[str] = None, db_id: Optional[str] = None) -> Dict[str, str]:
    """Builds low-cardinality trace metadata for LangSmith runs."""
    metadata = {"app": "quriodb", "component": "ai-assistant"}
    if user_id:
        metadata["user_id"] = user_id
    if db_id:
        metadata["database_id"] = db_id
    return metadata


class LangChainRuntime:
    """Small adapter around LangChain chat models and LangSmith trace settings."""

    def __init__(self, default_model: str = "gemini-2.5-flash"):
        self.default_model = default_model
        self._model_inventory_cache = {}
        self._model_inventory_lock = Lock()
        ensure_langsmith_environment()

    @property
    def is_available(self) -> bool:
        return HAS_LANGCHAIN

    @property
    def is_graph_available(self) -> bool:
        return HAS_LANGGRAPH

    @property
    def is_langsmith_available(self) -> bool:
        return HAS_LANGSMITH

    def resolve_provider(self, model_id: Optional[str] = None, user_id: Optional[str] = None) -> str:
        """Resolves provider from model registry, user settings, then model-id heuristics."""
        if model_id:
            session = SessionLocal()
            try:
                model = session.query(AIModel).filter(AIModel.modelId == model_id).first()
                if model and model.provider:
                    return normalize_provider(model.provider)
            except Exception as exc:
                logger.debug("Failed to resolve AI model provider: %s", exc)
            finally:
                session.close()

        user_provider = _read_user_ai_config(user_id).get("provider")
        if user_provider:
            return normalize_provider(user_provider)
        return infer_provider_from_model_id(model_id)

    def is_openai_compatible_provider(self, provider: Optional[str]) -> bool:
        normalized = normalize_provider(provider)
        return normalized == "openai" or normalized == "custom" or normalized in OPENAI_COMPATIBLE_BASE_URLS

    def list_available_models(self, provider: str, user_id: Optional[str] = None) -> List[str]:
        normalized = normalize_provider(provider)
        if not self.is_openai_compatible_provider(normalized):
            raise RuntimeError(f"Provider {normalized} does not support OpenAI-compatible model inventory")

        api_key = get_ai_api_key(user_id, normalized)
        if not api_key:
            raise RuntimeError(f"Missing {normalized} API key. Configure environment variables or AI Settings.")

        base_url = resolve_base_url(normalized, user_id)
        if normalized == "custom" and not base_url:
            raise RuntimeError("Custom Provider requires a Base URL in AI Settings")
        base_url = base_url or OPENAI_DEFAULT_BASE_URL
        parsed_base_url = urlsplit(base_url)
        if parsed_base_url.scheme not in {"http", "https"} or not parsed_base_url.hostname:
            raise RuntimeError("Invalid Base URL: expected an HTTP(S) URL with a hostname")
        normalized_base_url = base_url.rstrip("/")
        cache_key = (user_id or "", normalized, normalized_base_url)
        now = time.monotonic()
        with self._model_inventory_lock:
            cached = self._model_inventory_cache.get(cache_key)
            if cached and now - cached[0] < MODEL_INVENTORY_TTL_SECONDS:
                return list(cached[1])

        request = Request(
            f"{normalized_base_url}/models",
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            method="GET",
        )
        with urlopen(request, timeout=MODEL_INVENTORY_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))

        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise RuntimeError(f"Invalid model inventory returned by provider {normalized}")

        model_ids = []
        seen = set()
        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            capabilities = item.get("capabilities")
            if isinstance(capabilities, dict):
                chat_flags = [capabilities.get(name) for name in ("chat", "chat_completion", "completion")]
                if any(flag is not None for flag in chat_flags) and not any(flag is True for flag in chat_flags):
                    continue
            if model_id and model_id not in seen:
                seen.add(model_id)
                model_ids.append(model_id)

        if not model_ids:
            raise RuntimeError(f"Provider {normalized} returned no usable models")

        cached_at = time.monotonic()
        with self._model_inventory_lock:
            self._model_inventory_cache[cache_key] = (cached_at, list(model_ids))
        return model_ids

    def _safe_provider_error(self, error: Exception, api_key: Optional[str]) -> str:
        message = " ".join(str(error).split())
        if api_key:
            message = message.replace(api_key, "[redacted]")
        message = re.sub(r"\s+(?:-\s+)?[\{\[].*$", " [upstream response omitted]", message)
        return message[:300] or error.__class__.__name__

    def select_auto_model(self, user_id: Optional[str] = None) -> Dict[str, str]:
        """Randomly select a registered active model with this user's provider configuration."""
        if not user_id:
            raise RuntimeError("Auto Provider requires a signed-in user or desktop identity")
        session = SessionLocal()
        try:
            configs = session.query(UserAIConfig).filter(UserAIConfig.userId == user_id).all()
            configured_providers = {
                normalize_provider(config.provider)
                for config in configs
                if config.apiKey and (
                    normalize_provider(config.provider) != "custom"
                    or (config.baseUrl or "").strip()
                )
            }
            models = session.query(AIModel).filter(AIModel.isActive.is_(True)).all()
            candidates = [
                (model.modelId, normalize_provider(model.provider))
                for model in models
                if model.modelId and normalize_provider(model.provider) in configured_providers
                and normalize_provider(model.provider) in SUPPORTED_PROVIDERS
            ]
        finally:
            session.close()
        if not candidates:
            raise RuntimeError("No active AI models with a configured provider. Add a model and configure its provider in AI Settings.")
        random.shuffle(candidates)
        attempts = candidates[:AUTO_MODEL_MAX_ATTEMPTS]
        last_error = None
        for model_id, provider in attempts:
            try:
                self.validate_model_ready(model_id=model_id, user_id=user_id, provider=provider, probe_remote=True)
                return {"provider": provider, "model": model_id}
            except Exception as error:
                last_error = self._safe_provider_error(error, get_ai_api_key(user_id, provider))

        raise RuntimeError(
            f"Auto Provider selection failed after {len(attempts)} attempts: {last_error}"
        )

    def status(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Reports local AI integration readiness without exposing secrets."""
        providers = {}
        for provider in SUPPORTED_PROVIDERS:
            providers[provider] = {"hasApiKey": bool(get_ai_api_key(user_id, provider))}

        return {
            "langchain": HAS_LANGCHAIN,
            "langgraph": HAS_LANGGRAPH,
            "langsmith": HAS_LANGSMITH,
            "anthropic": HAS_ANTHROPIC,
            "supportedProviders": list(SUPPORTED_PROVIDERS),
            "defaultModels": DEFAULT_PROVIDER_MODELS,
            "hasApiKey": any(item["hasApiKey"] for item in providers.values()),
            "providers": providers,
            "tracingEnabled": os.getenv("LANGSMITH_TRACING", "").lower() == "true",
            "project": os.getenv("LANGSMITH_PROJECT") or os.getenv("LANGCHAIN_PROJECT"),
        }

    def validate_model_ready(
        self,
        model_id: Optional[str] = None,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        probe_remote: bool = False,
    ) -> Dict[str, str]:
        """Validates the selected model/provider before starting expensive AI work."""
        if not HAS_LANGCHAIN:
            raise RuntimeError("LangChain chat integrations are not installed")

        target_provider = normalize_provider(provider or self.resolve_provider(model_id, user_id))
        target_model = model_id or DEFAULT_PROVIDER_MODELS.get(target_provider, self.default_model)
        if not target_model:
            raise RuntimeError("Custom Provider requires a model ID")

        if model_id:
            session = SessionLocal()
            try:
                model = session.query(AIModel).filter(AIModel.modelId == model_id).first()
                if model and not getattr(model, "isActive", True):
                    raise RuntimeError(f"AI model '{model_id}' is inactive. Activate it in AI Settings before streaming.")
            finally:
                session.close()

        if target_provider == "anthropic" and not HAS_ANTHROPIC:
            raise RuntimeError("Anthropic integration is not installed")

        api_key = get_ai_api_key(user_id, target_provider)
        if target_provider == "custom" and not resolve_base_url(target_provider, user_id):
            raise RuntimeError("Custom Provider requires a Base URL in AI Settings")
        if not api_key:
            raise RuntimeError(f"Missing {target_provider} API key. Configure environment variables or AI Settings.")

        if probe_remote:
            self._probe_model_access(target_model, user_id, target_provider)

        return {"provider": target_provider, "model": target_model}

    def _probe_model_access(self, model_id: str, user_id: Optional[str], provider: str) -> None:
        """Performs a minimal provider call to catch quota, rate limit, and model access errors."""
        try:
            model = self.build_model(
                model_id=model_id,
                user_id=user_id,
                provider=provider,
                temperature=0,
                max_tokens=4,
            )
            messages = self.make_messages(
                "You are checking model availability. Reply with OK.",
                "OK",
            )
            config = {"metadata": {**langsmith_metadata(user_id=user_id), "preflight": "true"}}
            model.invoke(messages, config=config)
        except Exception as exc:
            raise RuntimeError(f"AI model preflight failed for provider {provider}: {exc}") from exc

    def build_model(
        self,
        model_id: Optional[str] = None,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ):
        """Creates a provider chat model using OpenAI-compatible message semantics."""
        if not HAS_LANGCHAIN:
            raise RuntimeError("LangChain chat integrations are not installed")

        target_provider = normalize_provider(provider or self.resolve_provider(model_id, user_id))
        target_model = model_id or DEFAULT_PROVIDER_MODELS.get(target_provider, self.default_model)
        if not target_model:
            raise RuntimeError("Custom Provider requires a model ID")
        self.validate_model_ready(model_id=model_id, user_id=user_id, provider=target_provider)

        api_key = get_ai_api_key(user_id, target_provider)

        kwargs: Dict[str, Any] = {"model": target_model, "temperature": temperature, "max_retries": 2}
        if max_tokens is not None:
            kwargs["max_tokens"] = max_tokens

        if target_provider == "google":
            return ChatGoogleGenerativeAI(api_key=api_key, **kwargs)

        if target_provider == "anthropic":
            if not HAS_ANTHROPIC:
                raise RuntimeError("Anthropic integration is not installed")
            return ChatAnthropic(api_key=api_key, **kwargs)

        if self.is_openai_compatible_provider(target_provider):
            base_url = resolve_base_url(target_provider, user_id)
            if base_url:
                try:
                    base_url = validate_base_url(base_url)
                except ValueError as exc:
                    raise RuntimeError(f"Invalid Base URL: {exc}") from exc
                return ChatOpenAI(api_key=api_key, base_url=base_url, **kwargs)

        return ChatOpenAI(api_key=api_key, **kwargs)

    def make_messages(self, system_prompt: str, prompt: str, history: Optional[List[Dict[str, str]]] = None) -> List[BaseMessage]:
        """Converts QurioDB conversation records into LangChain chat messages."""
        if not HAS_LANGCHAIN:
            raise RuntimeError("LangChain is not installed")

        messages: List[BaseMessage] = [SystemMessage(content=system_prompt)]
        for item in history or []:
            role = item.get("role")
            content = item.get("content") or ""
            if not content:
                continue
            if role == "assistant":
                messages.append(AIMessage(content=content))
            else:
                messages.append(HumanMessage(content=content))

        messages.append(HumanMessage(content=prompt))
        return messages

    def invoke_text(
        self,
        system_prompt: str,
        prompt: str,
        model_id: Optional[str] = None,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        db_id: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: Optional[int] = None,
    ) -> str:
        """Invokes a LangChain chat model and returns normalized text content."""
        model = self.build_model(model_id, user_id=user_id, provider=provider, temperature=temperature, max_tokens=max_tokens)
        messages = self.make_messages(system_prompt, prompt, history=history)
        config = {"metadata": langsmith_metadata(user_id=user_id, db_id=db_id)}
        response = model.invoke(messages, config=config)
        return normalize_message_content(response.content)

    def stream_text(
        self,
        system_prompt: str,
        prompt: str,
        model_id: Optional[str] = None,
        user_id: Optional[str] = None,
        provider: Optional[str] = None,
        history: Optional[List[Dict[str, str]]] = None,
        db_id: Optional[str] = None,
    ) -> Iterable[str]:
        """Streams normalized text chunks from a LangChain chat model."""
        model = self.build_model(model_id, user_id=user_id, provider=provider, temperature=0.2)
        messages = self.make_messages(system_prompt, prompt, history=history)
        config = {"metadata": langsmith_metadata(user_id=user_id, db_id=db_id)}
        for chunk in model.stream(messages, config=config):
            text = normalize_message_content(getattr(chunk, "content", ""))
            if text:
                yield text


def normalize_message_content(content: Any) -> str:
    """Normalizes provider-specific LangChain content blocks into display text."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                text = block.get("text") or block.get("thinking") or ""
                if text:
                    parts.append(str(text))
        return "".join(parts)
    return str(content or "")


langchain_runtime = LangChainRuntime()
