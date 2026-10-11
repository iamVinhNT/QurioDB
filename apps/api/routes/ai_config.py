from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from urllib.parse import urlsplit
from pydantic import BaseModel
from models import SessionLocal, UserAIConfig
from utils.auth_middleware import get_current_user
import uuid
import base64
from cryptography.fernet import Fernet
import os

ai_config_bp = APIRouter(dependencies=[Depends(get_current_user)])

AI_CONFIG_FALLBACK_SECRET = "dummy_encryption_key_for_development_only_123"


def _resolve_master_key() -> str:
    configured_key = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if configured_key:
        return configured_key
    return base64.urlsafe_b64encode(
        AI_CONFIG_FALLBACK_SECRET.encode().ljust(32)[:32]
    ).decode()


MASTER_KEY = _resolve_master_key()

cipher = Fernet(MASTER_KEY.encode())

class SaveConfigRequest(BaseModel):
    apiKey: str
    provider: str = "Google"
    baseUrl: Optional[str] = None


def _provider_matches(config_provider: str, requested_provider: str) -> bool:
    aliases = {
        "google gemini": "google",
        "open ai": "openai",
        "claude": "anthropic",
        "anthropic": "anthropic",
        "alibaba qwen": "qwen",
    }
    config_value = (config_provider or "Google").strip().lower()
    requested_value = (requested_provider or "Google").strip().lower()
    return aliases.get(config_value, config_value) == aliases.get(requested_value, requested_value)


def _find_config(session, user_id: str, provider: str):
    configs = session.query(UserAIConfig).filter(UserAIConfig.userId == user_id).all()
    return next((config for config in configs if _provider_matches(config.provider, provider)), None)


@ai_config_bp.get('/get')
def get_config(
    reveal: bool = False,
    provider: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user.get('userId')
    requested_provider = provider or 'Google'
    session = SessionLocal()
    try:
        config = _find_config(session, user_id, requested_provider) if provider else (
            session.query(UserAIConfig).filter(UserAIConfig.userId == user_id)
            .order_by(UserAIConfig.changed_on.desc(), UserAIConfig.created_on.desc()).first()
        )
        if not config:
            return {'apiKey': None, 'provider': requested_provider, 'baseUrl': ''}
        
        api_key = '********'
        if reveal and config.apiKey:
            try:
                api_key = cipher.decrypt(config.apiKey.encode()).decode()
            except:
                api_key = 'decryption_error'
                
        return {
            'apiKey': api_key,
            'provider': config.provider,
            'baseUrl': getattr(config, 'baseUrl', None) or ''
        }
    finally:
        session.close()

@ai_config_bp.post('/save')
def save_config(data: SaveConfigRequest, current_user: dict = Depends(get_current_user)):
    user_id = current_user.get('userId')
    api_key = data.apiKey
    provider = (data.provider or "Google").strip()
    base_url = (data.baseUrl or "").strip() or None
    saved_at = datetime.utcnow()

    if not api_key:
        raise HTTPException(status_code=400, detail='API Key is required')
    if provider.lower() == 'custom' and not base_url:
        raise HTTPException(status_code=400, detail='Custom Provider requires a Base URL')
    if base_url:
        try:
            parsed_base_url = urlsplit(base_url)
            if parsed_base_url.scheme not in {'http', 'https'} or not parsed_base_url.hostname:
                raise ValueError
            parsed_base_url.port
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail='Base URL must be a valid HTTP(S) URL with a hostname') from exc

    session = SessionLocal()
    try:
        if api_key == '********':
            config = _find_config(session, user_id, provider)
            if config:
                config.changed_on = saved_at
                config.baseUrl = base_url
                session.commit()
                return {'message': 'Config updated successfully'}
            raise HTTPException(status_code=400, detail='No existing config to update')

        encrypted_key = cipher.encrypt(api_key.encode()).decode()

        config = _find_config(session, user_id, provider)
        if config:
            config.apiKey = encrypted_key
            config.provider = provider
            config.baseUrl = base_url
            config.changed_on = saved_at
        else:
            config = UserAIConfig(
                id=str(uuid.uuid4()),
                userId=user_id,
                apiKey=encrypted_key,
                provider=provider,
                baseUrl=base_url,
                changed_on=saved_at,
            )
            session.add(config)
        session.commit()
        return {'message': 'Config saved successfully'}
    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        session.close()

def decrypt_key(encrypted_key: str) -> str | None:
    try:
        return cipher.decrypt(encrypted_key.encode()).decode()
    except:
        return None
