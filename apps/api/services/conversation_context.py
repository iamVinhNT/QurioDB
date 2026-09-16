"""
conversation_context.py

Manages conversation context for multi-turn AI interactions.
Implements hierarchical memory with summarization for token efficiency.

Architecture:
  - Working Memory: Last N raw messages (high fidelity)
  - Summary Memory: LLM-compressed older messages (when conversation grows)
  - Fallback: Naive extraction if LLM summarization fails
"""

import logging
from typing import List, Dict, Optional, Any

from models import AIChatMessage, SessionLocal
from services.ai.mongodb_query import redact_mongo_sensitive_text

logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
MAX_RECENT_MESSAGES = 6        # Last N raw messages to always keep in full
MAX_HISTORY_LOAD = 30          # Max total messages to load from DB
SUMMARY_TRIGGER = 8            # Trigger summarization when total messages > this
MSG_TRUNCATE_LEN = 500         # Max characters per message in context
SUMMARY_MAX_MSG_LEN = 300      # Max chars per message when building summary input
# ─────────────────────────────────────────────────────────────────────────────


class ConversationContextManager:
    """
    Builds optimized conversation context for LLM calls.

    Strategy:
    1. Load messages for the conversation from DB (ordered chronologically)
    2. If total <= SUMMARY_TRIGGER: pass them all as raw messages
    3. If total > SUMMARY_TRIGGER: summarize older messages + keep recent raw
    4. Format as provider-compatible messages array or text block

    Usage:
        ctx_mgr = ConversationContextManager(optional_summary_model)
        
        # For multi-turn (stream endpoint):
        messages = ctx_mgr.build_context(conv_id, "show me users")
        
        # For single-prompt (agent endpoint):
        context_text = ctx_mgr.build_context_for_agent(conv_id, "add customer name")
    """

    def __init__(self, ai_model=None):
        """
        Args:
            ai_model: Optional model client with generate_content() for summarization.
                      If None, falls back to naive summary extraction.
        """
        self._ai_model = ai_model

    # ─── Public API ───────────────────────────────────────────────────────────

    def build_context(
        self,
        conversation_id: Optional[str],
        current_prompt: str,
    ) -> List[Dict[str, Any]]:
        """
        Builds a provider-compatible messages array for multi-turn calls.

        Returns:
            List of {'role': 'user'|'model', 'parts': [{'text': ...}]}
            Ready for legacy native model clients that accept content parts.
        """
        if not conversation_id:
            return [{"role": "user", "parts": [{"text": current_prompt}]}]

        raw_history = self._load_history(conversation_id)

        if not raw_history:
            return [{"role": "user", "parts": [{"text": current_prompt}]}]

        messages = []

        if len(raw_history) > SUMMARY_TRIGGER:
            # Split into older (to summarize) and recent (keep raw)
            older = raw_history[:-MAX_RECENT_MESSAGES]
            recent = raw_history[-MAX_RECENT_MESSAGES:]

            summary = self._summarize_history(older)
            if summary:
                # Inject summary as a synthetic context exchange
                messages.append({
                    "role": "user",
                    "parts": [{"text": f"[Previous conversation summary]: {summary}"}]
                })
                messages.append({
                    "role": "model",
                    "parts": [{"text": "I understand the previous context. I'll use it to maintain continuity in our conversation."}]
                })

            # Add recent messages in raw form
            messages.extend(self._format_messages(recent))
        else:
            # All messages fit — pass them raw
            messages.extend(self._format_messages(raw_history))

        # Add current prompt as the final user turn
        messages.append({"role": "user", "parts": [{"text": current_prompt}]})

        return messages

    def build_context_for_agent(
        self,
        conversation_id: Optional[str],
        current_prompt: str,
        redact_sensitive: bool = False,
    ) -> str:
        """
        Builds a compact text block of conversation context for injection
        into an agent's system prompt (single-prompt, non-multi-turn).

        Returns:
            A formatted string to append to the agent prompt, or "" if no history.
        """
        if not conversation_id:
            return ""

        raw_history = self._load_history(conversation_id, redact_sensitive=redact_sensitive)
        if not raw_history:
            return ""

        parts = []

        if len(raw_history) > SUMMARY_TRIGGER:
            older = raw_history[:-MAX_RECENT_MESSAGES]
            recent = raw_history[-MAX_RECENT_MESSAGES:]

            summary = self._summarize_history(older)
            if summary:
                parts.append(f"[Conversation Summary]: {summary}")
                parts.append("")

            parts.append("[Recent Messages]:")
            for msg in recent:
                role_label = "USER" if msg["role"] == "user" else "ASSISTANT"
                content = self._truncate(msg["content"], MSG_TRUNCATE_LEN)
                parts.append(f"  {role_label}: {content}")
        else:
            parts.append("[Conversation History]:")
            for msg in raw_history:
                role_label = "USER" if msg["role"] == "user" else "ASSISTANT"
                content = self._truncate(msg["content"], MSG_TRUNCATE_LEN)
                parts.append(f"  {role_label}: {content}")

        return "\n".join(parts)

    # ─── Private Helpers ──────────────────────────────────────────────────────

    def _load_history(
        self,
        conversation_id: str,
        redact_sensitive: bool = False,
    ) -> List[Dict[str, str]]:
        """Load conversation messages from database, ordered chronologically."""
        session = SessionLocal()
        try:
            messages = (
                session.query(AIChatMessage)
                .filter(AIChatMessage.conversationId == conversation_id)
                .order_by(AIChatMessage.created_on.asc())
                .limit(MAX_HISTORY_LOAD)
                .all()
            )

            return [
                {
                    "role": m.role,
                    "content": redact_mongo_sensitive_text(m.content or "")
                    if redact_sensitive
                    else m.content or "",
                }
                for m in messages
            ]
        except Exception as e:
            logger.error(f"Failed to load conversation history [{conversation_id}]: {e}")
            return []
        finally:
            session.close()

    def _summarize_history(
        self,
        messages: List[Dict[str, str]]
    ) -> str:
        """
        Compresses older messages into a brief summary.
        
        Uses LLM if available, otherwise falls back to naive extraction.
        """
        if not messages:
            return ""

        # Build text of the conversation to summarize
        conv_text = "\n".join([
            f"{'User' if m['role'] == 'user' else 'Assistant'}: "
            f"{self._truncate(m['content'], SUMMARY_MAX_MSG_LEN)}"
            for m in messages
        ])

        # Attempt LLM-based summarization
        if self._ai_model:
            try:
                summary_prompt = (
                    "Summarize this SQL assistant conversation in 2-3 concise sentences. "
                    "Focus on: what SQL queries were discussed, what tables/columns were involved, "
                    "what the user was trying to achieve, and any errors that were resolved. "
                    "Keep it factual and dense.\n\n"
                    f"CONVERSATION:\n{conv_text}"
                )
                response = self._ai_model.generate_content(summary_prompt)
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                logger.warning(f"LLM summarization failed, using fallback: {e}")

        # Fallback: Extract user questions as bullet points
        return self._naive_summary(messages)

    def _naive_summary(self, messages: List[Dict[str, str]]) -> str:
        """Fallback summary: extract key user questions."""
        user_msgs = [
            self._truncate(m["content"], 100)
            for m in messages
            if m["role"] == "user"
        ]
        if not user_msgs:
            return ""

        # Take last 5 user messages
        recent_questions = user_msgs[-5:]
        return "User previously asked: " + "; ".join(recent_questions)

    def _format_messages(
        self,
        messages: List[Dict[str, str]]
    ) -> List[Dict[str, Any]]:
        """Convert DB messages to native content-part format."""
        formatted = []
        prev_role = None

        for msg in messages:
            role = "model" if msg["role"] == "assistant" else "user"
            content = self._truncate(msg["content"], MSG_TRUNCATE_LEN * 2)

            # Native content-part APIs require alternating user/model turns.
            if role == prev_role and formatted:
                # Append to previous message's text
                formatted[-1]["parts"][0]["text"] += f"\n\n{content}"
            else:
                formatted.append({
                    "role": role,
                    "parts": [{"text": content}]
                })
            prev_role = role

        return formatted

    @staticmethod
    def _truncate(text: str, max_len: int) -> str:
        """Truncate text to max length with ellipsis."""
        if not text:
            return ""
        if len(text) <= max_len:
            return text
        return text[:max_len] + "..."
