import re
from typing import Any, Dict, List, Optional, Tuple

from . import config


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return len(text) // 4


def sanitize_markup_text(text: str) -> str:
    text = config.LOCAL_COMMAND_CAVEAT_PATTERN.sub("", text)
    text = config.TASK_NOTIFICATION_PATTERN.sub("", text)
    text = config.COMMAND_NAME_PATTERN.sub("", text)
    text = config.LOCAL_COMMAND_STDOUT_PATTERN.sub("", text)
    return text


def sanitize_payload(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_markup_text(value)
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_payload(item) for key, item in value.items()}
    return value


def get_content_text(content: Any) -> str:
    if isinstance(content, str):
        return sanitize_markup_text(content)
    if isinstance(content, list):
        return "".join(get_content_text(item) for item in content)
    if isinstance(content, dict):
        if "text" in content:
            return content["text"]
        if "content" in content:
            return get_content_text(content["content"])
        return str(content)
    return str(content)


def normalize_generated_text(value: Any) -> str:
    text = get_content_text(value).strip()
    if text == "{}":
        return ""
    return text


def sanitize_bucket_component(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    cleaned = re.sub(r"-{2,}", "-", cleaned).strip("-")
    return cleaned or "unknown"


def first_word(value: str) -> str:
    match = re.search(r"[A-Za-z0-9._-]+", value or "")
    if match:
        return match.group(0)
    return "unknown"


def get_tool_use_parts(message: Any) -> List[Dict[str, Any]]:
    if not isinstance(message, dict):
        return []
    content = message.get("content", [])
    parts = content if isinstance(content, list) else [content]
    return [part for part in parts if isinstance(part, dict) and part.get("type") == "tool_use"]


def get_tool_result_parts(event: Dict[str, Any]) -> List[Tuple[Optional[str], str]]:
    message = event.get("message")
    if not isinstance(message, dict):
        return []
    content = message.get("content", [])
    parts = content if isinstance(content, list) else [content]
    tool_results: List[Tuple[Optional[str], str]] = []
    for part in parts:
        if not isinstance(part, dict) or part.get("type") != "tool_result":
            continue
        tool_results.append((part.get("tool_use_id"), get_content_text(part.get("content", part))))
    if tool_results:
        return tool_results
    return [(None, get_content_text(content))]
