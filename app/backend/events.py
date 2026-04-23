import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List

from fastapi import HTTPException

from .session_index import (
    resolve_session_dir,
    resolve_session_file_path,
    validate_agent_id,
)
from .text_utils import estimate_tokens, get_content_text, sanitize_payload

logger = logging.getLogger("claude-inspect")

_AGENT_ID_IN_TEXT = re.compile(r"agentId:\s*([a-f0-9]+)")


def enrich_event(event: Dict[str, Any], session_dir: Path) -> Dict[str, Any]:
    """Calculate token usage and extract role information."""
    if "message" in event:
        event["message"] = sanitize_payload(event["message"])
    if "content" in event:
        event["content"] = sanitize_payload(event["content"])
    if "attachment" in event:
        event["attachment"] = sanitize_payload(event["attachment"])
    if "toolUseResult" in event:
        event["toolUseResult"] = sanitize_payload(event["toolUseResult"])

    tokens = {
        "input": 0,
        "output": 0,
        "thinking": 0,
        "tools": 0,
        "cache_creation": event.get("usage", {}).get("cache_creation_input_tokens", 0),
        "cache_read": event.get("usage", {}).get("cache_read_input_tokens", 0),
    }

    has_authoritative_message_usage = False
    if "message" in event and "usage" in event["message"]:
        m_usage = event["message"]["usage"]
        tokens["cache_creation"] = m_usage.get("cache_creation_input_tokens", tokens["cache_creation"])
        tokens["cache_read"] = m_usage.get("cache_read_input_tokens", tokens["cache_read"])
        tokens["input"] = m_usage.get("input_tokens", 0)
        tokens["output"] = m_usage.get("output_tokens", 0)
        has_authoritative_message_usage = True

    type_ = event.get("type", "unknown")
    role = type_
    subagent_id = None
    thinking_output_estimate = 0

    if "message" in event:
        msg = event["message"]
        role = msg.get("role", role)
        content = msg.get("content", [])

        if role == "assistant":
            for part in content if isinstance(content, list) else [content]:
                if isinstance(part, dict):
                    if part.get("type") == "thinking":
                        thinking_output_estimate += estimate_tokens(part.get("thinking", ""))
                    elif part.get("type") == "text" and not has_authoritative_message_usage:
                        tokens["output"] += estimate_tokens(part.get("text", ""))
                    elif part.get("type") == "tool_use" and not has_authoritative_message_usage:
                        tokens["tools"] += estimate_tokens(str(part.get("input", "")))

        if role == "user":
            text_content = get_content_text(content)
            is_tool_result = False
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "tool_result":
                        is_tool_result = True
                        break

            if is_tool_result or "toolUseResult" in event:
                role = "tool"
                if not has_authoritative_message_usage:
                    tokens["tools"] += estimate_tokens(text_content)

                if "toolUseResult" in event and isinstance(event["toolUseResult"], dict):
                    subagent_id = event["toolUseResult"].get("agentId")

                if not subagent_id and "agentId:" in text_content:
                    match = _AGENT_ID_IN_TEXT.search(text_content)
                    if match:
                        subagent_id = match.group(1)
            else:
                role = "user"
                if not has_authoritative_message_usage:
                    tokens["input"] += estimate_tokens(text_content)

    elif "attachment" in event:
        role = "system"
        att = event["attachment"]

        if isinstance(att, dict) and att.get("type") in ["hook_success", "hook_start"]:
            role = "hook"
            if att.get("toolUseID"):
                event["toolUseID"] = att.get("toolUseID")

        if isinstance(att, dict):
            if att.get("type") == "file":
                content = att.get("content", "")
                if isinstance(content, dict) and "file" in content:
                    tokens["input"] += estimate_tokens(str(content["file"].get("content", "")))
                else:
                    tokens["input"] += estimate_tokens(str(content))
            else:
                tokens["input"] += estimate_tokens(str(att))
        else:
            tokens["input"] += estimate_tokens(str(att))

    event["role_type"] = role
    event["is_compaction_boundary"] = (
        event.get("type") == "system"
        and event.get("subtype") == "compact_boundary"
        and "Conversation compacted" in get_content_text(event.get("content", ""))
    )
    event["tokens"] = tokens
    event["model_tokens"] = {
        "read": tokens["input"],
        "cache": tokens["cache_read"],
        "write": tokens["output"],
    }
    tokens["thinking"] = thinking_output_estimate
    event["thinking_tokens"] = {"input": 0, "output": thinking_output_estimate}
    event["tool_tokens"] = {"input": 0, "output": 0}
    event["heavy_tokens_total"] = event["model_tokens"]["read"] + event["model_tokens"]["write"]
    event["total_tokens"] = sum(v for k, v in tokens.items() if k != "cache_read")
    if subagent_id:
        event["subagent_id"] = subagent_id

    return event


def is_noise(event: Dict[str, Any]) -> bool:
    if event.get("type") in ["permission-mode", "file-history-snapshot", "queued_command"]:
        return True
    if event.get("type") == "attachment" and isinstance(event.get("attachment"), dict):
        attachment = event["attachment"]
        if attachment.get("type") == "queued_command":
            return True
        if "<task-notification>" in str(attachment.get("prompt", "")):
            return True
    if event.get("type") == "queue-operation" and "<task-notification>" in str(event.get("content", "")):
        return True
    if event.get("type") == "queue-operation" and event.get("operation") == "remove":
        return True

    content_str = str(event.get("message", "")) + str(event.get("content", "")) + str(event.get("attachment", ""))
    if "<command-message>" in content_str:
        return True
    return False


def process_events(raw_events: List[Dict[str, Any]], filter_sidechains: bool = False) -> List[Dict[str, Any]]:
    hooks_by_tool_id: Dict[str, List[Dict[str, Any]]] = {}
    results_by_tool_id: Dict[str, Dict[str, Any]] = {}
    subagent_ids_by_tool_id: Dict[str, str] = {}

    for event in raw_events:
        if event.get("role_type") == "hook" and event.get("toolUseID"):
            tid = event["toolUseID"]
            hooks_by_tool_id.setdefault(tid, []).append(event)
            event["_is_consumed"] = True

        if event.get("role_type") == "tool":
            content = event.get("message", {}).get("content", [])
            parts = content if isinstance(content, list) else [content]
            has_mapped_part = False
            for part in parts:
                if isinstance(part, dict) and part.get("type") == "tool_result" and part.get("tool_use_id"):
                    tid = part["tool_use_id"]
                    results_by_tool_id[tid] = part
                    has_mapped_part = True

                    part_text = get_content_text(part)
                    if "agentId:" in part_text:
                        match = _AGENT_ID_IN_TEXT.search(part_text)
                        if match:
                            subagent_ids_by_tool_id[tid] = match.group(1)

                    if tid not in subagent_ids_by_tool_id and event.get("subagent_id"):
                        subagent_ids_by_tool_id[tid] = event["subagent_id"]

            if has_mapped_part:
                event["_is_consumed"] = True

    processed_events = []
    for event in raw_events:
        if event.get("_is_consumed"):
            continue

        if event.get("role_type") == "hook":
            continue

        if filter_sidechains and event.get("isSidechain") is True and not event.get("subagent_id"):
            continue

        if event.get("role_type") == "assistant" and "message" in event:
            content = event["message"].get("content", [])
            parts = content if isinstance(content, list) else [content]
            for part in parts:
                if isinstance(part, dict) and part.get("type") == "tool_use":
                    tid = part.get("id")
                    if tid:
                        part["hooks"] = hooks_by_tool_id.get(tid, [])
                        part["output"] = results_by_tool_id.get(tid)
                        part["subagent_id"] = subagent_ids_by_tool_id.get(tid)

        processed_events.append(event)

    return processed_events


def annotate_tool_tokens(
    events: List[Dict[str, Any]],
    session_id: str,
    include_agent_subagent_totals: bool = True,
) -> List[Dict[str, Any]]:
    subagent_totals_cache: Dict[str, Dict[str, int]] = {}

    def get_subagent_totals(agent_id: str) -> Dict[str, int]:
        if agent_id in subagent_totals_cache:
            return subagent_totals_cache[agent_id]
        totals = {"read": 0, "write": 0}
        try:
            sub_events = load_subagent_events(session_id, agent_id)
            for se in sub_events:
                model_tokens = se.get("model_tokens", {})
                totals["read"] += int(model_tokens.get("read", se.get("tokens", {}).get("input", 0)))
                totals["write"] += int(model_tokens.get("write", se.get("tokens", {}).get("output", 0)))
        except Exception:
            logger.warning("Could not aggregate tokens for subagent %s", agent_id)
        subagent_totals_cache[agent_id] = totals
        return totals

    for event in events:
        event["tool_tokens"] = {"input": 0, "output": 0}
        message = event.get("message", {})
        if not isinstance(message, dict):
            continue
        if event.get("role_type") != "assistant":
            continue

        content = message.get("content", [])
        parts = content if isinstance(content, list) else [content]
        tool_parts = [p for p in parts if isinstance(p, dict) and p.get("type") == "tool_use"]

        if message.get("stop_reason") == "tool_use" and not tool_parts:
            event["model_tokens"] = {"read": 0, "cache": 0, "write": 0}
            event["tokens"]["input"] = 0
            event["tokens"]["cache_read"] = 0
            event["tokens"]["output"] = 0
            event["total_tokens"] = 0
            continue

        tool_only_message = (
            len(tool_parts) > 0
            and all(
                isinstance(p, dict) and p.get("type") in ["tool_use", "thinking"]
                for p in parts
                if isinstance(p, dict)
            )
        )
        if tool_only_message:
            event["model_tokens"]["cache"] = 0
            event["tokens"]["cache_read"] = 0

        for part in tool_parts:
            tool_name = str(part.get("name", "")).lower()
            if include_agent_subagent_totals and tool_name == "agent":
                agent_id = part.get("subagent_id")
                if agent_id:
                    totals = get_subagent_totals(agent_id)
                    tool_input = totals["read"]
                    tool_output = totals["write"]
                else:
                    tool_input = estimate_tokens(get_content_text(part.get("input", "")))
                    tool_output = estimate_tokens(get_content_text(part.get("output", "")))
            else:
                tool_input = estimate_tokens(get_content_text(part.get("input", "")))
                tool_output = estimate_tokens(get_content_text(part.get("output", "")))
            part["tool_tokens"] = {"input": tool_input, "output": tool_output}
            event["tool_tokens"]["input"] += tool_input
            event["tool_tokens"]["output"] += tool_output

    for event in events:
        model_tokens = event.get("model_tokens", {})
        tool_tokens = event.get("tool_tokens", {})
        model_read = int(model_tokens.get("read", event.get("tokens", {}).get("input", 0)))
        model_write = int(model_tokens.get("write", event.get("tokens", {}).get("output", 0)))
        tool_input = int(tool_tokens.get("input", 0))
        tool_output = int(tool_tokens.get("output", 0))
        event["heavy_tokens_total"] = model_read + model_write + tool_input + tool_output

    return events


def _read_jsonl_events(file_path: Path, session_dir: Path) -> List[Dict[str, Any]]:
    raw_events: List[Dict[str, Any]] = []
    with open(file_path, "r") as handle:
        for line in handle:
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if is_noise(event):
                continue
            raw_events.append(enrich_event(event, session_dir))
    return raw_events


def load_session_events(session_id: str, include_subagents: bool = False) -> List[Dict[str, Any]]:
    file_path = resolve_session_file_path(session_id)
    session_dir = resolve_session_dir(session_id)

    if not file_path.exists():
        logger.error("Session file %s not found", file_path)
        raise HTTPException(status_code=404, detail="Session not found")

    logger.info("Reading session %s (include_subagents=%s)", session_id, include_subagents)
    try:
        raw_events = _read_jsonl_events(file_path, session_dir)

        if include_subagents:
            subagent_ids = {e["subagent_id"] for e in raw_events if e.get("subagent_id")}
            for sa_id in subagent_ids:
                try:
                    raw_events.extend(load_subagent_events(session_id, sa_id))
                except Exception:
                    logger.warning("Could not load subagent %s for session %s", sa_id, session_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error reading session file")
        raise HTTPException(status_code=500, detail=str(exc))

    processed = process_events(raw_events, filter_sidechains=not include_subagents)
    return annotate_tool_tokens(processed, session_id, include_agent_subagent_totals=True)


def load_subagent_events(session_id: str, agent_id: str) -> List[Dict[str, Any]]:
    validate_agent_id(agent_id)
    session_dir = resolve_session_dir(session_id)
    subagent_path = session_dir / "subagents" / f"agent-{agent_id}.jsonl"

    if not subagent_path.exists():
        logger.error("Sub-agent file %s not found", subagent_path)
        for candidate in (session_dir / "subagents").glob(f"*{agent_id}*.jsonl"):
            subagent_path = candidate
            break
        else:
            raise HTTPException(status_code=404, detail="Sub-agent not found")

    logger.info("Reading sub-agent %s for session %s", agent_id, session_id)
    raw_events = _read_jsonl_events(subagent_path, session_dir)
    processed = process_events(raw_events, filter_sidechains=False)
    return annotate_tool_tokens(processed, session_id, include_agent_subagent_totals=False)
