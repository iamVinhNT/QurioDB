"""
ai_stream.py

Streaming chat route for the AI Assistant.
"""

import datetime
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from models import AIChatMessage, AIConversation, SessionLocal
from schemas.ai import ExplainSqlStreamRequest, OptimizeSqlStreamRequest, StreamChatRequest
from services.ai.conversation_store import conversation_store
from services.ai.streaming import (
    append_stream_part,
    build_assistant_history_content,
    encode_sse_event,
    new_response_parts,
)
from services.ai_service import ai_service
from utils.auth_middleware import get_current_user

router = APIRouter()


@router.post("/stream")
def stream_chat(data: StreamChatRequest, current_user: dict = Depends(get_current_user)):
    messages = _resolve_stream_messages(data)
    user_id = current_user.get("userId")
    last_message = messages[-1]["content"]
    conversation_id = conversation_store.ensure_conversation(
        user_id,
        data.databaseId,
        last_message,
        data.conversationId,
    )
    request_history = [message for message in messages[:-1] if message.get("content")]
    history = conversation_store.load_recent_history(conversation_id) if user_id else []
    if not history:
        history = request_history
    ai_service._save_chat("user", last_message, user_id, data.databaseId, conv_id=conversation_id)

    return StreamingResponse(
        _stream_response(data, user_id, last_message, conversation_id, history),
        media_type="text/event-stream",
        headers=_stream_headers(conversation_id),
    )


@router.post("/explain-sql/stream")
def stream_explain_sql(data: ExplainSqlStreamRequest, current_user: dict = Depends(get_current_user)):
    return _stream_action(data, current_user, "Explain")


@router.post("/optimize-sql/stream")
def stream_optimize_sql(data: OptimizeSqlStreamRequest, current_user: dict = Depends(get_current_user)):
    return _stream_action(data, current_user, "Optimize")


def _stream_action(data, current_user: dict, action: str):
    user_id = current_user.get("userId")
    prompt = f"{action} this SQL: {data.sql}"
    conversation_id = conversation_store.ensure_conversation(
        user_id,
        data.databaseId,
        prompt,
        data.conversationId,
    )
    history = conversation_store.load_recent_history(conversation_id) if user_id else []
    ai_service._save_chat(
        "user",
        prompt,
        user_id,
        data.databaseId,
        conv_id=conversation_id,
    )

    return StreamingResponse(
        _stream_action_response(data, user_id, prompt, conversation_id, history, action),
        media_type="text/event-stream",
        headers=_stream_headers(conversation_id),
    )


def _stream_action_response(data, user_id: str, prompt: str, conversation_id: str, history: list, action: str):
    task_key = "sql.explain" if action == "Explain" else "sql.optimize"
    yield from _stream_response(data, user_id, prompt, conversation_id, history, task_key)


def _resolve_stream_messages(data: StreamChatRequest):
    messages = data.messages or []
    if not messages and data.text:
        messages = [{"role": "user", "content": data.text}]
    if not messages:
        raise HTTPException(status_code=400, detail="No messages provided")
    return messages


def _stream_response(data: StreamChatRequest, user_id: str, last_message: str, conversation_id: str, history: list, task_key=None):
    response_parts = new_response_parts()
    assistant_message_id = None
    pending_size = 0
    dirty = False
    last_saved = time.monotonic()
    try:
        for event, chunk in ai_service.stream_generate_response(
            last_message,
            db_id=data.databaseId,
            schema=data.schema_name,
            model_id=data.modelId,
            task_key=task_key or getattr(data, "taskKey", None),
            user_id=user_id,
            history=history,
            conv_id=conversation_id,
        ):
            append_stream_part(response_parts, event, chunk)
            dirty = True
            pending_size += len(str(chunk))
            now = time.monotonic()
            if assistant_message_id is None or pending_size >= 4096 or now - last_saved >= 1.0:
                assistant_message_id = _persist_stream_snapshot(
                    response_parts, assistant_message_id, user_id, data.databaseId, conversation_id,
                )
                pending_size, last_saved = 0, now
                dirty = False
            yield encode_sse_event(event, chunk)

    except Exception as exc:
        error_message = f"Error: {exc}"
        if assistant_message_id:
            append_stream_part(response_parts, "message", f"\n\n{error_message}")
            dirty = True
        else:
            ai_service._save_chat("assistant", error_message, user_id, data.databaseId, conv_id=conversation_id)
        yield encode_sse_event("error", error_message)
    finally:
        # GeneratorExit on disconnect must persist the last partial response too.
        if dirty:
            _persist_stream_snapshot(response_parts, assistant_message_id, user_id, data.databaseId, conversation_id)


def _stream_headers(conversation_id: str):
    return {
        "X-Conversation-Id": conversation_id,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Accel-Buffering": "no",
    }


def _persist_stream_snapshot(parts: dict, message_id: str | None, user_id: str, database_id: str, conversation_id: str) -> str | None:
    content = build_assistant_history_content(parts)
    if not content:
        return message_id

    session = SessionLocal()
    try:
        if message_id:
            message = session.get(AIChatMessage, message_id)
            if message:
                message.content = content
        else:
            message_id = str(uuid.uuid4())
            session.add(AIChatMessage(
                id=message_id,
                role="assistant",
                content=content,
                userId=user_id,
                databaseId=database_id,
                conversationId=conversation_id,
            ))
        conversation = session.get(AIConversation, conversation_id) if conversation_id else None
        if conversation:
            conversation.changed_on = datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
        session.commit()
        _persist_retrieval_event_once(parts, message_id, database_id, conversation_id)
        return message_id
    except Exception:
        session.rollback()
        return message_id
    finally:
        session.close()


def _persist_retrieval_event_once(parts: dict, message_id: str | None, database_id: str, conversation_id: str) -> None:
    if not message_id or parts.get("_retrieval_event_saved"):
        return
    traces = parts.get("retrieval_trace") or []
    if not traces:
        return

    trace = traces[-1]
    ai_service._save_retrieval_event(
        trace if isinstance(trace, dict) else None,
        str(trace.get("intent", "")) if isinstance(trace, dict) else "",
        database_id,
        message_id=message_id,
        conv_id=conversation_id,
    )
    parts["_retrieval_event_saved"] = True
