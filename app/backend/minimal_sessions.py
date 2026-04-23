import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import HTTPException

from . import config
from .events import load_session_events, load_subagent_events
from .session_index import resolve_generated_session_dir, resolve_session_dir, validate_session_id
from .text_utils import (
    first_word,
    get_tool_result_parts,
    get_tool_use_parts,
    normalize_generated_text,
    sanitize_bucket_component,
)

logger = logging.getLogger("claude-inspect")


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def path_for_prompt(path: Path, working_dir: Optional[Path] = None) -> str:
    resolved = path.resolve()
    if working_dir is None:
        return str(resolved)
    try:
        return str(resolved.relative_to(working_dir.resolve()))
    except ValueError:
        return str(resolved)


def resolve_manifest_path(path_str: str, generated_dir: Path) -> Path:
    candidate = Path(path_str)
    if candidate.is_absolute():
        return candidate
    return (generated_dir / candidate).resolve()


def extract_subagent_invocation_fields(tool_input: Any) -> Tuple[str, str]:
    if isinstance(tool_input, dict):
        description = normalize_generated_text(tool_input.get("description", ""))
        prompt = normalize_generated_text(
            tool_input.get("prompt", tool_input.get("task", tool_input.get("input", "")))
        )
        return description, prompt

    raw = normalize_generated_text(tool_input)
    if not raw:
        return "", ""
    try:
        parsed = json.loads(raw)
    except Exception:
        return "", raw
    if not isinstance(parsed, dict):
        return "", raw
    description = normalize_generated_text(parsed.get("description", ""))
    prompt = normalize_generated_text(
        parsed.get("prompt", parsed.get("task", parsed.get("input", "")))
    )
    if description or prompt:
        return description, prompt
    return "", raw


def extract_subagent_metadata_from_main_events(events: List[Dict[str, Any]]) -> Dict[str, Dict[str, str]]:
    metadata_by_agent_id: Dict[str, Dict[str, str]] = {}
    for event in events:
        if event.get("role_type") != "assistant":
            continue
        for part in get_tool_use_parts(event.get("message")):
            if str(part.get("name", "")).lower() != "agent":
                continue
            agent_id = part.get("subagent_id")
            if not agent_id:
                continue
            tool_input = part.get("input", {})
            agent_type = "unknown"
            description = "Unknown agent"
            if isinstance(tool_input, dict):
                raw_type = tool_input.get("agentType") or tool_input.get("agent_type")
                raw_description = tool_input.get("description")
                if raw_type:
                    agent_type = str(raw_type)
                if raw_description:
                    description = str(raw_description)
            metadata_by_agent_id[str(agent_id)] = {
                "agentType": agent_type,
                "description": description,
            }
    return metadata_by_agent_id


def read_subagent_meta_file(meta_path: Path) -> Optional[Dict[str, str]]:
    if not meta_path.exists():
        return None
    try:
        data = json.loads(meta_path.read_text())
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    agent_type = str(data.get("agentType") or data.get("agent_type") or "unknown")
    description = str(data.get("description") or "Unknown agent")
    return {"agentType": agent_type, "description": description}


def _assistant_part_to_tool_call(part: Dict[str, Any]) -> Dict[str, Any]:
    call_entry: Dict[str, Any] = {
        "name": str(part.get("name", "")),
        "input": part.get("input", {}),
    }
    output_text = normalize_generated_text(part.get("output", ""))
    if output_text:
        call_entry["output"] = output_text
    return call_entry


def _append_tool_result_messages(
    messages: List[Dict[str, Any]],
    event: Dict[str, Any],
    idx: int,
    skip_tool_call_ids: Optional[Set[str]] = None,
) -> int:
    for tool_call_id, content in get_tool_result_parts(event):
        if skip_tool_call_ids and tool_call_id and tool_call_id in skip_tool_call_ids:
            continue
        clean_content = normalize_generated_text(content)
        if not clean_content:
            continue
        tool_message: Dict[str, Any] = {
            "idx": idx,
            "role": "tool_result",
            "content": clean_content,
        }
        if tool_call_id:
            tool_message["tool_call_id"] = tool_call_id
        messages.append(tool_message)
        idx += 1
    return idx


def _append_plain_message(
    messages: List[Dict[str, Any]],
    event: Dict[str, Any],
    role_type: str,
    idx: int,
) -> int:
    message = event.get("message", {})
    content = normalize_generated_text(message.get("content", message))
    if not content:
        return idx
    messages.append({
        "idx": idx,
        "role": "system" if role_type == "system" else "user",
        "content": content,
    })
    return idx + 1


def build_main_minimal_session(
    session_id: str,
    events: List[Dict[str, Any]],
    metadata_by_agent_id: Dict[str, Dict[str, str]],
) -> Dict[str, Any]:
    messages: List[Dict[str, Any]] = []
    idx = 0
    agent_tool_call_ids: Set[str] = set()

    for event in events:
        role_type = event.get("role_type")
        if role_type not in {"system", "user", "assistant", "tool"}:
            continue

        if role_type == "assistant":
            message = event.get("message")
            content = message.get("content", []) if isinstance(message, dict) else []
            parts = content if isinstance(content, list) else [content]
            text_chunks: List[str] = []
            tool_calls: List[Dict[str, Any]] = []
            invocation_messages: List[Dict[str, Any]] = []

            for part in parts:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    text_chunks.append(str(part.get("text", "")))
                elif part.get("type") == "tool_use":
                    tool_name = str(part.get("name", ""))
                    tool_id = str(part.get("id", ""))
                    tool_input = part.get("input", {})
                    if tool_name.lower() == "agent" and part.get("subagent_id"):
                        if tool_id:
                            agent_tool_call_ids.add(tool_id)
                        agent_id = str(part.get("subagent_id"))
                        meta = metadata_by_agent_id.get(
                            agent_id,
                            {"agentType": "unknown", "description": "Unknown agent"},
                        )
                        description, prompt = extract_subagent_invocation_fields(tool_input)
                        output_summary = normalize_generated_text(part.get("output", ""))
                        invocation_message: Dict[str, Any] = {
                            "idx": -1,
                            "role": "sub_agent_invocation",
                            "agent_type": meta["agentType"],
                            "conversation_id": agent_id,
                        }
                        if description:
                            invocation_message["description"] = description
                        if prompt:
                            invocation_message["prompt"] = prompt
                        if output_summary:
                            invocation_message["output_summary"] = output_summary
                        if any(
                            key in invocation_message
                            for key in ("description", "prompt", "output_summary")
                        ):
                            invocation_messages.append(invocation_message)
                    else:
                        tool_calls.append(_assistant_part_to_tool_call(part))

            assistant_message: Dict[str, Any] = {"idx": idx, "role": "assistant"}
            assistant_content = normalize_generated_text("\n\n".join(chunk for chunk in text_chunks if chunk).strip())
            if assistant_content and not tool_calls:
                assistant_message["content"] = assistant_content
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            if assistant_message.get("content") or assistant_message.get("tool_calls"):
                messages.append(assistant_message)
                idx += 1
            for invocation_message in invocation_messages:
                invocation_message["idx"] = idx
                messages.append(invocation_message)
                idx += 1
            continue

        if role_type == "tool":
            idx = _append_tool_result_messages(messages, event, idx, skip_tool_call_ids=agent_tool_call_ids)
            continue

        idx = _append_plain_message(messages, event, role_type, idx)

    return {
        "conversation_id": session_id,
        "agent_type": "main",
        "messages": messages,
    }


def build_subagent_minimal_session(
    agent_id: str,
    agent_type: str,
    events: List[Dict[str, Any]],
) -> Dict[str, Any]:
    messages: List[Dict[str, Any]] = []
    idx = 0

    for event in events:
        role_type = event.get("role_type")
        if role_type not in {"system", "user", "assistant", "tool"}:
            continue

        if role_type == "assistant":
            message = event.get("message")
            content = message.get("content", []) if isinstance(message, dict) else []
            parts = content if isinstance(content, list) else [content]
            text_chunks: List[str] = []
            tool_calls: List[Dict[str, Any]] = []
            for part in parts:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    text_chunks.append(str(part.get("text", "")))
                elif part.get("type") == "tool_use":
                    tool_calls.append(_assistant_part_to_tool_call(part))

            assistant_message: Dict[str, Any] = {"idx": idx, "role": "assistant"}
            assistant_content = normalize_generated_text("\n\n".join(chunk for chunk in text_chunks if chunk).strip())
            if assistant_content and not tool_calls:
                assistant_message["content"] = assistant_content
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            if assistant_message.get("content") or assistant_message.get("tool_calls"):
                messages.append(assistant_message)
                idx += 1
            continue

        if role_type == "tool":
            idx = _append_tool_result_messages(messages, event, idx)
            continue

        idx = _append_plain_message(messages, event, role_type, idx)

    return {
        "conversation_id": agent_id,
        "agent_type": agent_type,
        "messages": messages,
    }


def _collect_subagent_ids(
    metadata_by_agent_id: Dict[str, Dict[str, str]],
    main_events: List[Dict[str, Any]],
) -> List[str]:
    subagent_ids: Set[str] = {
        agent_id for agent_id in metadata_by_agent_id
        if config.AGENT_ID_PATTERN.fullmatch(agent_id)
    }
    for event in main_events:
        raw_agent_id = event.get("subagent_id")
        if isinstance(raw_agent_id, str) and config.AGENT_ID_PATTERN.fullmatch(raw_agent_id):
            subagent_ids.add(raw_agent_id)
    return sorted(subagent_ids)


def _clear_stale_manifest_state(generated_dir: Path) -> None:
    stale_manifest = generated_dir / "session_manifest.json"
    if stale_manifest.exists():
        stale_manifest.unlink()
    stale_subagents_dir = generated_dir / "subagents"
    if stale_subagents_dir.exists():
        for stale_meta in stale_subagents_dir.glob("*.meta.json"):
            stale_meta.unlink()


def create_session_files(session_id: str) -> Dict[str, Any]:
    validate_session_id(session_id)
    generated_dir = resolve_generated_session_dir(session_id)
    source_session_dir = resolve_session_dir(session_id)
    generated_dir.mkdir(parents=True, exist_ok=True)
    _clear_stale_manifest_state(generated_dir)

    main_events = load_session_events(session_id, include_subagents=False)
    metadata_by_agent_id = extract_subagent_metadata_from_main_events(main_events)
    main_session = build_main_minimal_session(session_id, main_events, metadata_by_agent_id)
    main_session_path = generated_dir / "main.session.json"
    write_json(main_session_path, main_session)

    subagent_entries: List[Dict[str, Any]] = []
    groups: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"sessions": [], "conversation_ids": []})

    for agent_id in _collect_subagent_ids(metadata_by_agent_id, main_events):
        try:
            subagent_events = load_subagent_events(session_id, agent_id)
        except HTTPException:
            logger.warning("Skipping sub-agent %s in session %s (events unavailable)", agent_id, session_id)
            continue

        source_meta_path = source_session_dir / "subagents" / f"agent-{agent_id}.meta.json"
        fallback_meta = metadata_by_agent_id.get(agent_id, {"agentType": "unknown", "description": "Unknown agent"})
        meta = read_subagent_meta_file(source_meta_path) or fallback_meta
        agent_type = str(meta.get("agentType") or "unknown")
        description = str(meta.get("description") or "Unknown agent")
        name = first_word(description)

        subagent_session = build_subagent_minimal_session(agent_id, agent_type, subagent_events)
        subagent_session_path = generated_dir / "subagents" / f"agent-{agent_id}.session.json"
        write_json(subagent_session_path, subagent_session)

        group_key = f"{agent_type}::{name}"
        groups[group_key]["agentType"] = agent_type
        groups[group_key]["name"] = name
        groups[group_key]["sessions"].append(path_for_prompt(subagent_session_path, generated_dir))
        groups[group_key]["conversation_ids"].append(agent_id)

        subagent_entries.append({
            "agent_id": agent_id,
            "session_path": str(subagent_session_path.resolve()),
            "agent_type": agent_type,
            "description": description,
            "name": name,
            "group_key": group_key,
        })

    group_entries: List[Dict[str, Any]] = []
    for group_key, group_data in groups.items():
        bucket_file_name = (
            f"{sanitize_bucket_component(str(group_data['agentType']))}"
            f"__{sanitize_bucket_component(str(group_data['name']))}.json"
        )
        group_path = generated_dir / "groups" / bucket_file_name
        group_payload = {
            "agentType": group_data["agentType"],
            "name": group_data["name"],
            "groupKey": group_key,
            "sessions": group_data["sessions"],
            "conversationIds": group_data["conversation_ids"],
        }
        write_json(group_path, group_payload)
        group_entries.append({
            "group_key": group_key,
            "agent_type": group_data["agentType"],
            "name": group_data["name"],
            "size": len(group_data["sessions"]),
            "sessions": group_data["sessions"],
            "conversation_ids": group_data["conversation_ids"],
            "group_file_path": str(group_path.resolve()),
        })

    return {
        "session_id": session_id,
        "generated_dir": str(generated_dir.resolve()),
        "main_session_path": str(main_session_path.resolve()),
        "subagent_count": len(subagent_entries),
        "group_count": len(group_entries),
        "subagents": subagent_entries,
        "groups": group_entries,
    }
