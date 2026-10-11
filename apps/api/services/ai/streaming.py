"""
streaming.py

Helpers for AI Assistant server-sent events and persisted stream content.
"""

import json
import re
from typing import Any, Dict, List, Tuple

STREAM_RESPONSE_PARTS = {
    "thinking": [],
    "confidence": [],
    "message": [],
    "sql": [],
    "query": [],
    "query_result": [],
    "analysis": [],
    "citations": [],
    "retrieval_trace": [],
    "warnings": [],
    "suggestions": [],
}

STATUS_THINKING_EVENTS = {
    "Đang chuẩn bị phản hồi...",
    "Initializing context...",
    "Analyzing schema...",
    "Learning from your feedback...",
    "Ready.",
    "Initialization complete.",
    "Generating SQL...",
    "Testing generated SQL safely...",
    "SQL preview passed.",
    "Đang kiểm tra model và hạn mức...",
    "Đang khởi tạo bối cảnh...",
    "Phân tích lược đồ...",
    "Đang phân tích lược đồ...",
    "Học hỏi từ phản hồi của các bạn...",
    "Đang học từ phản hồi của bạn...",
    "Sẵn sàng.",
    "Khởi tạo xong.",
    "Đang tạo SQL...",
    "Đang kiểm tra SQL đã tạo một cách an toàn...",
    "Đang chạy thử SQL đã tạo một cách an toàn...",
    "SQL preview đã đạt kiểm tra.",
    "SQL đã chạy thử thành công.",
}

LABELED_THINKING_EVENT_PATTERN = re.compile(r"^(Intent|Schema mapping|Strategy):", re.I)
THINKING_LABEL_PATTERN = re.compile(r"^\s*(Intent|Schema mapping|Strategy):\s*", re.I)


def new_response_parts() -> Dict[str, List[str]]:
    """Returns a fresh stream response accumulator."""
    parts = {key: [] for key in STREAM_RESPONSE_PARTS}
    parts["_events"] = []
    return parts


def encode_sse_event(event: str, chunk) -> str:
    """Encodes one SSE event with JSON-safe data."""
    return f"event: {event}\ndata: {json.dumps(chunk)}\n\n"


def append_stream_part(parts: Dict[str, List[Any]], event: str, chunk: Any) -> None:
    """Stores every emitted stream event for chat history persistence."""
    event_name = str(event or "message")
    content = chunk
    parts.setdefault(event_name, []).append(content)
    parts.setdefault("_events", []).append((event_name, content))


def build_assistant_history_content(parts: Dict[str, List[str]]) -> str:
    """Serializes streamed semantic events without embedding UI tags in content."""
    payload = build_assistant_history_payload(parts)
    if not payload["events"] and not payload["content"] and not payload.get("queryText") and "data" not in payload:
        return ""
    return json.dumps(payload, ensure_ascii=False)


def build_assistant_history_payload(parts: Dict[str, List[str]]) -> Dict[str, Any]:
    """Builds a structured assistant message from streamed event chunks."""
    events = _semantic_events(parts.get("_events") or _events_from_legacy_parts(parts))
    payload: Dict[str, Any] = {
        "content": "",
        "thinking": "",
        "sql": "",
        "analysis": "",
        "confidence": None,
        "citations": [],
        "retrievalTrace": None,
        "warnings": [],
        "suggestions": [],
        "events": [],
    }

    for event, content in events:
        if not content:
            continue
        if event == "message":
            payload["content"] = _concat_text(payload["content"], content)
        elif event == "thinking":
            payload["thinking"] = _append_text(payload["thinking"], content)
        elif event == "sql":
            payload["sql"] = _concat_text(payload["sql"], content)
        elif event == "analysis":
            payload["analysis"] = _concat_text(payload["analysis"], content)
        elif event == "confidence":
            payload["confidence"] = _parse_confidence(content)
        elif event == "citations":
            payload["citations"] = _parse_jsonish(content, [])
        elif event == "retrieval_trace":
            payload["retrievalTrace"] = _parse_jsonish(content, None)
        elif event == "warnings":
            payload["warnings"] = _parse_jsonish(content, [])
        elif event == "suggestions":
            payload["suggestions"] = _parse_suggestions(content)
        elif event == "query":
            query = _parse_jsonish(content, {})
            payload["queryLanguage"] = query.get("queryLanguage")
            payload["queryText"] = query.get("queryText", "")
        elif event == "query_result":
            result = _parse_jsonish(content, {})
            payload["columns"] = result.get("columns", [])
            payload["data"] = result.get("data", [])
        if event not in {"query", "query_result"}:
            payload["events"].append({"type": event, "content": content})

    return payload


def _semantic_events(events: List[Tuple[str, Any]]) -> List[Tuple[str, Any]]:
    semantic_events: List[Tuple[str, Any]] = []
    for event, chunk in events:
        event_name = str(event or "message")
        if event_name in {"citations", "retrieval_trace", "warnings", "suggestions", "query", "query_result"} and isinstance(chunk, (dict, list)):
            semantic_events.append((event_name, chunk))
            continue

        raw_text = str(chunk)
        text = raw_text.strip()
        if not text:
            continue

        if event_name == "thinking":
            _append_thinking_event(semantic_events, raw_text, text)
            continue

        if semantic_events and semantic_events[-1][0] == event_name and event_name in {"message", "sql", "analysis", "suggestions"}:
            semantic_events[-1] = (event_name, semantic_events[-1][1] + raw_text)
        else:
            semantic_events.append((event_name, text if event_name == "confidence" else raw_text.strip()))
    return semantic_events


def _append_thinking_event(events: List[Tuple[str, str]], raw_text: str, text: str) -> None:
    clean_text = _strip_thinking_label(text).strip()
    clean_raw_text = _strip_thinking_label(raw_text)
    if not events or events[-1][0] != "thinking":
        events.append(("thinking", clean_text))
        return

    previous = events[-1][1]
    should_start_step = (
        _is_status_thinking_event(text)
        or _is_status_thinking_event(previous)
        or _is_labeled_thinking_event(text)
        or text.startswith("Preview failed; repairing SQL")
        or text.startswith("Preview thất bại; đang sửa SQL")
        or text.startswith("Bản chạy thử thất bại; đang sửa SQL")
    )
    if should_start_step:
        events.append(("thinking", clean_text))
    else:
        events[-1] = ("thinking", previous + clean_raw_text)


def _is_status_thinking_event(text: str) -> bool:
    return text.strip() in STATUS_THINKING_EVENTS


def _is_labeled_thinking_event(text: str) -> bool:
    return bool(LABELED_THINKING_EVENT_PATTERN.match(text.strip()))


def parse_assistant_history_content(content: str) -> Dict[str, Any]:
    """Parses structured or legacy persisted assistant content for API responses."""
    cleaned = clean_assistant_history_content(content)
    empty_payload = {
        "content": "",
        "thinking": "",
        "sql": "",
        "analysis": "",
        "confidence": None,
        "citations": [],
        "retrievalTrace": None,
        "warnings": [],
        "suggestions": [],
        "events": [],
    }
    if not cleaned:
        return empty_payload

    try:
        payload = json.loads(cleaned)
        if isinstance(payload, dict):
            return {
                **empty_payload,
                **payload,
                "content": payload.get("content") or payload.get("summary") or "",
                "thinking": payload.get("thinking") or payload.get("thought") or "",
                "events": payload.get("events") if isinstance(payload.get("events"), list) else [],
            }
    except json.JSONDecodeError:
        pass

    return _parse_legacy_history_content(cleaned, empty_payload)


def clean_assistant_history_content(content: str) -> str:
    """Removes internal tool trace envelopes from persisted assistant content."""
    if not content:
        return ""
    return re.sub(r"\s*<tool_call[^>]*>[\s\S]*?</tool_call>\s*", "\n\n", str(content)).strip()


def _parse_legacy_history_content(content: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    working = content

    for match in re.finditer(r"<thinking>\s*([\s\S]*?)\s*</thinking>", working, flags=re.I):
        text = _strip_thinking_label(match.group(1).strip()).strip()
        if text:
            payload["thinking"] = _append_text(payload["thinking"], text)
            payload["events"].append({"type": "thinking", "content": text})
    working = re.sub(r"\s*<thinking>[\s\S]*?</thinking>\s*", "\n\n", working, flags=re.I)

    confidence_match = re.search(r"<confidence>\s*([\s\S]*?)\s*</confidence>", working, flags=re.I)
    if confidence_match:
        text = confidence_match.group(1).strip()
        payload["confidence"] = _parse_confidence(text)
        payload["events"].append({"type": "confidence", "content": text})
    working = re.sub(r"\s*<confidence>[\s\S]*?</confidence>\s*", "\n\n", working, flags=re.I)

    sql_match = re.search(r"```sql\s*([\s\S]*?)\s*```", working, flags=re.I)
    if sql_match:
        text = sql_match.group(1).strip()
        payload["sql"] = text
        payload["events"].append({"type": "sql", "content": text})
    working = re.sub(r"\s*```sql[\s\S]*?```\s*", "\n\n", working, flags=re.I)

    legacy_sql_match = re.search(r"(?:^|\n)\s*SQL:\s*([\s\S]*?)(?=\n\s*(?:###\s*)?Analysis:|\n\s*### SUGGESTIONS:|$)", working, flags=re.I)
    if legacy_sql_match:
        text = legacy_sql_match.group(1).strip()
        payload["sql"] = text
        payload["events"].append({"type": "sql", "content": text})
    working = re.sub(r"\s*(?:^|\n)\s*SQL:\s*[\s\S]*?(?=\n\s*(?:###\s*)?Analysis:|\n\s*### SUGGESTIONS:|$)", "\n\n", working, count=1, flags=re.I)

    suggestions_match = re.search(r"### SUGGESTIONS:\s*([\s\S]*)", working, flags=re.I)
    if suggestions_match:
        text = suggestions_match.group(1).strip()
        payload["suggestions"] = _parse_suggestions(text)
        payload["events"].append({"type": "suggestions", "content": text})
    working = re.sub(r"\s*### SUGGESTIONS:[\s\S]*", "", working, flags=re.I)

    analysis_match = re.search(r"### ANALYSIS:\s*([\s\S]*)", working, flags=re.I)
    if analysis_match:
        text = analysis_match.group(1).strip()
        payload["analysis"] = text
        payload["events"].append({"type": "analysis", "content": text})
    working = re.sub(r"\s*### ANALYSIS:[\s\S]*", "", working, flags=re.I)

    legacy_analysis_match = re.search(r"(?:^|\n)\s*Analysis:\s*([\s\S]*)", working, flags=re.I)
    if legacy_analysis_match:
        text = legacy_analysis_match.group(1).strip()
        payload["analysis"] = text
        payload["events"].append({"type": "analysis", "content": text})
    working = re.sub(r"\s*(?:^|\n)\s*Analysis:[\s\S]*", "", working, count=1, flags=re.I)

    payload["content"] = working.strip()
    if payload["content"]:
        payload["events"].insert(0, {"type": "message", "content": payload["content"]})
    return payload


def _append_text(existing: str, text: str) -> str:
    if not existing:
        return text
    return f"{existing}\n\n{text}"


def _strip_thinking_label(text: str) -> str:
    return THINKING_LABEL_PATTERN.sub("", str(text), count=1)


def _concat_text(existing: str, text: str) -> str:
    return f"{existing}{text}" if existing else text


def _parse_confidence(content: str):
    try:
        return int(str(content).strip())
    except ValueError:
        return content


def _parse_jsonish(content: Any, fallback: Any) -> Any:
    """Parses structured stream metadata while accepting already-decoded values."""
    if isinstance(content, (dict, list)):
        return content
    try:
        return json.loads(str(content))
    except (TypeError, json.JSONDecodeError):
        return fallback


def _parse_suggestions(content: Any) -> List[Dict[str, str]]:
    """Normalizes clickable follow-up suggestions for the AI Assistant UI."""
    raw_items = _parse_jsonish(_clean_suggestion_json_text(content), None)
    if raw_items is None:
        raw_items = [
            line.strip(" -\t")
            for line in str(content or "").splitlines()
            if _is_plain_suggestion_line(line)
        ]

    if not isinstance(raw_items, list):
        return []

    suggestions: List[Dict[str, str]] = []
    seen_prompts = set()
    for item in raw_items:
        suggestion = _normalize_suggestion(item)
        if not suggestion:
            continue
        prompt_key = suggestion["prompt"].lower()
        if prompt_key in seen_prompts:
            continue
        seen_prompts.add(prompt_key)
        suggestions.append(suggestion)
        if len(suggestions) >= 4:
            break
    return suggestions


def _clean_suggestion_json_text(content: Any) -> Any:
    if isinstance(content, (dict, list)):
        return content

    text = str(content or "").strip()
    fence_match = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", text, flags=re.I)
    if fence_match:
        text = fence_match.group(1).strip()

    array_start = text.find("[")
    array_end = text.rfind("]")
    if array_start >= 0 and array_end > array_start:
        return text[array_start:array_end + 1]
    return text


def _is_plain_suggestion_line(line: str) -> bool:
    text = line.strip(" -\t")
    if not text:
        return False
    return not (
        text.startswith(("```", "[", "]", "{", "}"))
        or text.startswith(('"label"', '"prompt"', '"intent"'))
    )


def _normalize_suggestion(item: Any) -> Dict[str, str] | None:
    if isinstance(item, str):
        text = item.strip()
        return {"label": text, "prompt": text, "intent": "other"} if text else None

    if not isinstance(item, dict):
        return None

    prompt = str(item.get("prompt") or "").strip()
    label = str(item.get("label") or prompt).strip()
    intent = str(item.get("intent") or "other").strip() or "other"
    if not prompt or not label:
        return None
    return {"label": label, "prompt": prompt, "intent": intent}


def _events_from_legacy_parts(parts: Dict[str, List[str]]) -> List[Tuple[str, str]]:
    """Creates ordered events for callers that built the old accumulator shape."""
    events = []
    for event in STREAM_RESPONSE_PARTS:
        events.extend((event, chunk) for chunk in parts.get(event, []))
    return events
