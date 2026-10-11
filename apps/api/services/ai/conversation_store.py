"""
conversation_store.py

Persistence helpers for AI Assistant conversations, history, and feedback.
"""

import datetime
import uuid
from typing import Dict, List, Optional

from fastapi import HTTPException

from models import AIChatMessage, AIConversation, AIFeedback, SessionLocal
from services.ai.streaming import parse_assistant_history_content


class AIConversationStore:
    """Encapsulates database operations for AI conversation routes."""

    def ensure_conversation(self, user_id: str, database_id: str, title_source: str, conversation_id: Optional[str]) -> str:
        """Returns an existing conversation id or creates a new conversation."""
        if conversation_id:
            session = SessionLocal()
            try:
                conversation = session.query(AIConversation).get(conversation_id)
                if (
                    not conversation
                    or conversation.userId != user_id
                    or (database_id is None and conversation.databaseId is not None)
                    or (database_id is not None and conversation.databaseId != database_id)
                ):
                    raise HTTPException(status_code=404, detail="Conversation not found")
            finally:
                session.close()
            return conversation_id

        session = SessionLocal()
        try:
            new_id = str(uuid.uuid4())
            session.add(AIConversation(
                id=new_id,
                title=self._title_from_text(title_source),
                userId=user_id,
                databaseId=database_id,
            ))
            session.commit()
            return new_id
        except Exception as exc:
            session.rollback()
            raise HTTPException(status_code=500, detail=f"Failed to create conversation: {exc}")
        finally:
            session.close()

    def load_recent_history(self, conversation_id: str, limit: int = 10) -> List[Dict[str, str]]:
        """Loads recent messages in chronological order."""
        session = SessionLocal()
        try:
            messages = session.query(AIChatMessage)\
                .filter(AIChatMessage.conversationId == conversation_id)\
                .order_by(AIChatMessage.created_on.desc())\
                .limit(limit)\
                .all()
            return [{"role": message.role, "content": self._history_context_content(message)} for message in reversed(messages)]
        finally:
            session.close()

    def get_history(self, user_id: str, database_id: Optional[str] = None) -> List[Dict]:
        """Returns flat chat message history for a user."""
        session = SessionLocal()
        try:
            query = session.query(AIChatMessage).filter(AIChatMessage.userId == user_id)
            if database_id:
                query = query.filter(AIChatMessage.databaseId == database_id)
            return [self._message_to_dict(message) for message in query.order_by(AIChatMessage.created_on.asc()).limit(50).all()]
        finally:
            session.close()

    def list_conversations(self, user_id: str, database_id: Optional[str] = None) -> List[Dict]:
        """Lists conversations for a user."""
        session = SessionLocal()
        try:
            query = session.query(AIConversation).filter(AIConversation.userId == user_id)
            if database_id:
                query = query.filter(AIConversation.databaseId == database_id)
            conversations = query.order_by(AIConversation.isPinned.desc(), AIConversation.changed_on.desc()).all()
            return [self._conversation_to_dict(conversation) for conversation in conversations]
        finally:
            session.close()

    def get_conversation_messages(self, conversation_id: str, user_id: str) -> Dict:
        """Returns a conversation with its ordered messages."""
        session = SessionLocal()
        try:
            conversation = self._get_owned_conversation(session, conversation_id, user_id)
            messages = session.query(AIChatMessage)\
                .filter(AIChatMessage.conversationId == conversation_id)\
                .order_by(AIChatMessage.created_on.asc())\
                .all()
            result = self._conversation_to_dict(conversation)
            result["messages"] = [self._message_to_dict(message, include_database=False) for message in messages]
            return result
        finally:
            session.close()

    def update_conversation(self, conversation_id: str, user_id: str, title: Optional[str], is_pinned: Optional[bool]) -> Dict:
        """Updates editable conversation metadata."""
        session = SessionLocal()
        try:
            conversation = self._get_owned_conversation(session, conversation_id, user_id)
            if title is not None:
                conversation.title = title
            if is_pinned is not None:
                conversation.isPinned = is_pinned
            conversation.changed_on = datetime.datetime.utcnow()
            session.commit()
            return {"message": "Conversation updated successfully"}
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_conversation(self, conversation_id: str, user_id: str) -> Dict:
        """Deletes a conversation owned by the user."""
        session = SessionLocal()
        try:
            conversation = self._get_owned_conversation(session, conversation_id, user_id)
            session.delete(conversation)
            session.commit()
            return {"message": "Conversation deleted successfully"}
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def submit_feedback(self, user_id: str, message_id: str, rating: int, correction: str = "", conversation_id: Optional[str] = None) -> Dict:
        """Creates or updates feedback on an AI response."""
        if rating not in [1, -1]:
            raise HTTPException(status_code=400, detail="rating (1 or -1) is required")

        session = SessionLocal()
        try:
            existing = session.query(AIFeedback).filter_by(messageId=message_id, userId=user_id).first()
            if existing:
                existing.rating = rating
                existing.correction = correction if rating == -1 else None
            else:
                session.add(AIFeedback(
                    id=str(uuid.uuid4()),
                    messageId=message_id,
                    conversationId=conversation_id,
                    userId=user_id,
                    rating=rating,
                    correction=correction if rating == -1 else None,
                ))
            session.commit()
            return {"message": "Feedback saved", "rating": rating}
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def _get_owned_conversation(self, session, conversation_id: str, user_id: str) -> AIConversation:
        conversation = session.query(AIConversation).get(conversation_id)
        if not conversation or conversation.userId != user_id:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return conversation

    def _title_from_text(self, text: str) -> str:
        return text[:50] + ("..." if len(text) > 50 else "")

    def _message_to_dict(self, message: AIChatMessage, include_database: bool = True) -> Dict:
        result = {
            "id": message.id,
            "role": message.role,
            "content": self._message_content(message),
            "created_on": self._isoformat_utc(message.created_on),
        }
        if message.role == "assistant":
            result.update(self._assistant_fields(message))
        if include_database:
            result["databaseId"] = message.databaseId
        return result

    def _message_content(self, message: AIChatMessage) -> str:
        if message.role != "assistant":
            return message.content
        return self._assistant_fields(message)["content"]

    def _assistant_fields(self, message: AIChatMessage) -> Dict:
        payload = parse_assistant_history_content(message.content)
        return {
            "content": payload.get("content") or "",
            "thought": payload.get("thinking") or "",
            "sql": payload.get("sql") or "",
            "analysis": payload.get("analysis") or "",
            "confidence": payload.get("confidence"),
            "citations": payload.get("citations") or [],
            "retrievalTrace": payload.get("retrievalTrace"),
            "warnings": payload.get("warnings") or [],
            "suggestions": payload.get("suggestions") or [],
            "events": payload.get("events") or [],
            **{key: payload[key] for key in ("queryLanguage", "queryText", "columns", "data") if key in payload},
        }

    def _history_context_content(self, message: AIChatMessage) -> str:
        if message.role != "assistant":
            return message.content
        payload = parse_assistant_history_content(message.content)
        parts = [
            payload.get("content") or "",
            f"SQL:\n{payload.get('sql')}" if payload.get("sql") else "",
            f"Query:\n{payload.get('queryText')}" if payload.get("queryText") else "",
            f"Analysis:\n{payload.get('analysis')}" if payload.get("analysis") else "",
        ]
        return "\n\n".join(part for part in parts if part).strip()

    def _conversation_to_dict(self, conversation: AIConversation) -> Dict:
        return {
            "id": conversation.id,
            "title": conversation.title,
            "isPinned": conversation.isPinned,
            "databaseId": conversation.databaseId,
            "created_on": self._isoformat_utc(conversation.created_on),
            "changed_on": self._isoformat_utc(conversation.changed_on),
        }

    def _isoformat_utc(self, value: datetime.datetime) -> str:
        if value.tzinfo:
            return value.astimezone(datetime.timezone.utc).isoformat().replace("+00:00", "Z")
        return value.isoformat() + "Z"


conversation_store = AIConversationStore()
