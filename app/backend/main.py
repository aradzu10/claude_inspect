import json
import os
import logging
import asyncio
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, AsyncGenerator, Tuple, Set
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("backend.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("claude-inspect")

app = FastAPI()

cors_origins_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in cors_origins_raw.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_ROOT = Path("/net/mraid20/ifs/wisdom/segal_lab/genie/LabData/Analyses/aradz_shared/loader/junk/claude_inspect")
CLAUDE_PROJECTS_ROOT = Path.home() / ".claude" / "projects"
DB_ROOT = Path(__file__).parent / "db"
INDEX_STATE_PATH = DB_ROOT / "session_index.json"
MAX_JSONL_SCAN_LINES = 400
MAX_RECENT_SESSIONS = 20
PROMPTS_ROOT = Path(__file__).parent / "prompts"
GENERATED_SESSIONS_ROOT = DB_ROOT / "generated_sessions"
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
AGENT_ID_PATTERN = re.compile(r"^[a-f0-9]+$")
LOCAL_COMMAND_CAVEAT_PATTERN = re.compile(
    r"<local-command-caveat>[\s\S]*?</local-command-caveat>",
    re.IGNORECASE,
)
TASK_NOTIFICATION_PATTERN = re.compile(
    r"<task-notification>[\s\S]*?</task-notification>",
    re.IGNORECASE,
)
COMMAND_NAME_PATTERN = re.compile(
    r"<command-name>[\s\S]*?</command-name>",
    re.IGNORECASE,
)
LOCAL_COMMAND_STDOUT_PATTERN = re.compile(
    r"<local-command-stdout>[\s\S]*?</local-command-stdout>",
    re.IGNORECASE,
)

# Track background analysis status
analysis_status: Dict[str, str] = {}

def validate_session_id(session_id: str) -> str:
    if not SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")
    return session_id

def load_index_state() -> Dict[str, Any]:
    if not INDEX_STATE_PATH.exists():
        return {"recent_session_ids": [], "sessions": {}, "updated_at": None}
    try:
        data = json.loads(INDEX_STATE_PATH.read_text())
        if not isinstance(data, dict):
            return {"recent_session_ids": [], "sessions": {}, "updated_at": None}
        recent_session_ids = data.get("recent_session_ids", [])
        sessions = data.get("sessions", {})
        return {
            "recent_session_ids": [str(sid) for sid in recent_session_ids if isinstance(sid, str)],
            "sessions": sessions if isinstance(sessions, dict) else {},
            "updated_at": data.get("updated_at"),
        }
    except Exception:
        logger.warning("Could not read index state %s", INDEX_STATE_PATH)
        return {"recent_session_ids": [], "sessions": {}, "updated_at": None}

def save_index_state(state: Dict[str, Any]) -> None:
    safe_state = {
        "recent_session_ids": state.get("recent_session_ids", []),
        "sessions": state.get("sessions", {}),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    INDEX_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    INDEX_STATE_PATH.write_text(json.dumps(safe_state, indent=2))

def extract_renamed_session_title(data: Dict[str, Any]) -> Optional[str]:
    if data.get("type") == "custom-title" and data.get("customTitle"):
        return str(data.get("customTitle"))

    if data.get("type") == "rename":
        for key in ("customTitle", "title", "name", "newTitle"):
            value = data.get(key)
            if value:
                return str(value)

    rename_payload = data.get("rename")
    if isinstance(rename_payload, dict):
        for key in ("customTitle", "title", "name", "newTitle"):
            value = rename_payload.get(key)
            if value:
                return str(value)

    return None

def extract_session_metadata(session_file: Path) -> Dict[str, Any]:
    title = session_file.stem
    cwd_path: Optional[str] = None
    slug_title: Optional[str] = None
    custom_title: Optional[str] = None

    try:
        with open(session_file, "r") as handle:
            for _ in range(MAX_JSONL_SCAN_LINES):
                line = handle.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if not cwd_path and isinstance(data, dict) and data.get("cwd"):
                    cwd_path = str(data.get("cwd"))

                if isinstance(data, dict):
                    renamed_title = extract_renamed_session_title(data)
                    if renamed_title:
                        custom_title = renamed_title
                    elif not slug_title and data.get("slug"):
                        slug_title = str(data.get("slug"))
    except Exception:
        logger.warning("Could not parse metadata for session file %s", session_file)

    title = custom_title or slug_title or title
    return {"cwd": cwd_path, "title": title, "slug": slug_title, "name": custom_title}

def discover_sessions() -> List[Dict[str, Any]]:
    sessions: List[Dict[str, Any]] = []
    if not CLAUDE_PROJECTS_ROOT.exists():
        return sessions

    for session_file in CLAUDE_PROJECTS_ROOT.glob("*/*.jsonl"):
        if not session_file.is_file():
            continue

        session_id = session_file.stem
        if not SESSION_ID_PATTERN.fullmatch(session_id):
            continue

        metadata = extract_session_metadata(session_file)
        try:
            stat = session_file.stat()
        except FileNotFoundError:
            continue

        project_path = metadata.get("cwd") or str(session_file.parent)
        project_name = str(project_path)
        project_short_name = Path(project_path).name or project_name
        session_dir = session_file.with_suffix("")

        sessions.append({
            "id": session_id,
            "title": metadata.get("title") or session_id,
            "slug": metadata.get("slug"),
            "name": metadata.get("name"),
            "path": str(session_file),
            "size_mb": stat.st_size / (1024 * 1024),
            "mtime": stat.st_mtime,
            "project_path": project_name,
            "project_name": project_name,
            "project_short_name": project_short_name,
            "session_file_path": str(session_file.resolve()),
            "session_dir_path": str(session_dir.resolve()),
        })

    sessions.sort(key=lambda item: item["mtime"], reverse=True)
    return sessions

def build_sessions_payload(search: str = "") -> Dict[str, Any]:
    search_query = search.strip().lower()
    discovered = discover_sessions()
    session_map = {item["id"]: item for item in discovered}

    state = load_index_state()
    recent_ids = [sid for sid in state.get("recent_session_ids", []) if sid in session_map]

    state["recent_session_ids"] = recent_ids[:MAX_RECENT_SESSIONS]
    state["sessions"] = {
        sid: {
            "id": rec["id"],
            "title": rec["title"],
            "slug": rec.get("slug"),
            "name": rec.get("name"),
            "project_name": rec["project_name"],
            "session_file_path": rec["session_file_path"],
            "session_dir_path": rec["session_dir_path"],
            "mtime": rec["mtime"],
        }
        for sid, rec in session_map.items()
    }
    save_index_state(state)

    project_map: Dict[str, Dict[str, Any]] = {}
    for record in discovered:
        project_key = record["project_path"]
        if project_key not in project_map:
            project_map[project_key] = {
                "id": project_key,
                "name": record["project_name"],
                "short_name": record["project_short_name"],
                "sessions": [],
                "latest_mtime": record["mtime"],
            }
        project_map[project_key]["sessions"].append(record)
        project_map[project_key]["latest_mtime"] = max(
            float(project_map[project_key].get("latest_mtime", 0.0)),
            float(record["mtime"]),
        )

    projects = []
    for project in project_map.values():
        project["sessions"].sort(key=lambda item: item["mtime"], reverse=True)
        projects.append(project)

    projects.sort(key=lambda item: (-float(item.get("latest_mtime", 0.0)), item["name"].lower()))
    recent_sessions = [session_map[sid] for sid in state["recent_session_ids"] if sid in session_map]

    if search_query:
        projects = [
            {
                **project,
                "sessions": [
                    session for session in project["sessions"]
                    if search_query in session["title"].lower()
                    or search_query in str(session.get("slug", "")).lower()
                    or search_query in str(session.get("name", "")).lower()
                    or search_query in session["id"].lower()
                    or search_query in project["name"].lower()
                ],
            }
            for project in projects
        ]
        projects = [
            project
            for project in projects
            if project["sessions"] or search_query in project["name"].lower()
        ]
        recent_sessions = [
            session
            for session in recent_sessions
            if search_query in session["title"].lower()
            or search_query in str(session.get("slug", "")).lower()
            or search_query in str(session.get("name", "")).lower()
            or search_query in session["id"].lower()
            or search_query in session["project_name"].lower()
        ]

    return {
        "recent_sessions": recent_sessions,
        "projects": projects,
    }

def get_session_record(session_id: str) -> Dict[str, Any]:
    validate_session_id(session_id)
    state = load_index_state()
    session_record = state.get("sessions", {}).get(session_id)
    if session_record:
        file_path = Path(str(session_record.get("session_file_path", "")))
        if file_path.exists():
            return session_record

    discovered = discover_sessions()
    session_map = {item["id"]: item for item in discovered}
    if session_id not in session_map:
        raise HTTPException(status_code=404, detail="Session not found")

    state["sessions"] = {
        sid: {
            "id": rec["id"],
            "title": rec["title"],
            "slug": rec.get("slug"),
            "name": rec.get("name"),
            "project_name": rec["project_name"],
            "session_file_path": rec["session_file_path"],
            "session_dir_path": rec["session_dir_path"],
            "mtime": rec["mtime"],
        }
        for sid, rec in session_map.items()
    }
    state["recent_session_ids"] = [sid for sid in state.get("recent_session_ids", []) if sid in session_map]
    save_index_state(state)
    return state["sessions"][session_id]

def mark_recent_session(session_id: str) -> None:
    state = load_index_state()
    recent_ids = [sid for sid in state.get("recent_session_ids", []) if sid != session_id]
    recent_ids.insert(0, session_id)
    state["recent_session_ids"] = recent_ids[:MAX_RECENT_SESSIONS]
    save_index_state(state)

def remove_recent_session(session_id: str) -> None:
    state = load_index_state()
    state["recent_session_ids"] = [
        sid for sid in state.get("recent_session_ids", [])
        if sid != session_id
    ]
    save_index_state(state)

def validate_agent_id(agent_id: str) -> str:
    if not AGENT_ID_PATTERN.fullmatch(agent_id):
        raise HTTPException(status_code=400, detail="Invalid agent ID format")
    return agent_id

def resolve_session_dir(session_id: str) -> Path:
    session_record = get_session_record(session_id)
    return Path(str(session_record["session_dir_path"]))

def resolve_session_file_path(session_id: str) -> Path:
    session_record = get_session_record(session_id)
    return Path(str(session_record["session_file_path"]))

def resolve_generated_session_dir(session_id: str) -> Path:
    validate_session_id(session_id)
    return GENERATED_SESSIONS_ROOT / session_id

def get_analysis_status_path(session_id: str) -> Path:
    return resolve_generated_session_dir(session_id) / "analysis_status.json"

def set_analysis_status(session_id: str, status: str) -> None:
    analysis_status[session_id] = status
    try:
        status_path = get_analysis_status_path(session_id)
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(json.dumps({"status": status}))
    except Exception:
        logger.warning("Could not persist analysis status for %s", session_id)

def get_analysis_status(session_id: str) -> str:
    if session_id in analysis_status:
        return analysis_status[session_id]
    try:
        status_path = get_analysis_status_path(session_id)
        if status_path.exists():
            return json.loads(status_path.read_text()).get("status", "Not started")
    except Exception:
        logger.warning("Could not read persisted analysis status for %s", session_id)
    return "Not started"

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

def normalize_generated_text(value: Any) -> str:
    text = get_content_text(value)
    text = text.strip()
    if text == "{}":
        return ""
    return text

def sanitize_markup_text(text: str) -> str:
    text = LOCAL_COMMAND_CAVEAT_PATTERN.sub("", text)
    text = TASK_NOTIFICATION_PATTERN.sub("", text)
    text = COMMAND_NAME_PATTERN.sub("", text)
    text = LOCAL_COMMAND_STDOUT_PATTERN.sub("", text)
    return text

def sanitize_payload(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_markup_text(value)
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: sanitize_payload(item) for key, item in value.items()}
    return value

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
                if isinstance(part, dict) and part.get("type") == "text":
                    text_chunks.append(str(part.get("text", "")))
                elif isinstance(part, dict) and part.get("type") == "tool_use":
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
                        if (
                            "description" in invocation_message
                            or "prompt" in invocation_message
                            or "output_summary" in invocation_message
                        ):
                            invocation_messages.append(invocation_message)
                    else:
                        call_entry: Dict[str, Any] = {"name": tool_name, "input": tool_input}
                        output_text = normalize_generated_text(part.get("output", ""))
                        if output_text:
                            call_entry["output"] = output_text
                        tool_calls.append(call_entry)

            assistant_message: Dict[str, Any] = {"idx": idx, "role": "assistant"}
            assistant_content = "\n\n".join(chunk for chunk in text_chunks if chunk).strip()
            assistant_content = normalize_generated_text(assistant_content)
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
            for tool_call_id, content in get_tool_result_parts(event):
                if tool_call_id and tool_call_id in agent_tool_call_ids:
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
            continue

        message = event.get("message", {})
        content = normalize_generated_text(message.get("content", message))
        if not content:
            continue
        messages.append({
            "idx": idx,
            "role": "system" if role_type == "system" else "user",
            "content": content,
        })
        idx += 1

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
                if isinstance(part, dict) and part.get("type") == "text":
                    text_chunks.append(str(part.get("text", "")))
                elif isinstance(part, dict) and part.get("type") == "tool_use":
                    call_entry: Dict[str, Any] = {
                        "name": str(part.get("name", "")),
                        "input": part.get("input", {}),
                    }
                    output_text = normalize_generated_text(part.get("output", ""))
                    if output_text:
                        call_entry["output"] = output_text
                    tool_calls.append(call_entry)

            assistant_message: Dict[str, Any] = {"idx": idx, "role": "assistant"}
            assistant_content = "\n\n".join(chunk for chunk in text_chunks if chunk).strip()
            assistant_content = normalize_generated_text(assistant_content)
            if assistant_content and not tool_calls:
                assistant_message["content"] = assistant_content
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            if assistant_message.get("content") or assistant_message.get("tool_calls"):
                messages.append(assistant_message)
                idx += 1
            continue

        if role_type == "tool":
            for tool_call_id, content in get_tool_result_parts(event):
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
            continue

        message = event.get("message", {})
        content = normalize_generated_text(message.get("content", message))
        if not content:
            continue
        messages.append({
            "idx": idx,
            "role": "system" if role_type == "system" else "user",
            "content": content,
        })
        idx += 1

    return {
        "conversation_id": agent_id,
        "agent_type": agent_type,
        "messages": messages,
    }

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

def estimate_message_tokens(message: Dict[str, Any]) -> int:
    role = message.get("role")
    total = 0
    if role in {"system", "user", "assistant", "tool_result"}:
        total += estimate_tokens(get_content_text(message.get("content", "")))
    if role == "assistant":
        for call in message.get("tool_calls", []) or []:
            if isinstance(call, dict):
                total += estimate_tokens(get_content_text(call.get("input", {})))
                total += estimate_tokens(get_content_text(call.get("name", "")))
    if role == "sub_agent_invocation":
        total += estimate_tokens(get_content_text(message.get("input", "")))
        total += estimate_tokens(get_content_text(message.get("output_summary", "")))
        total += estimate_tokens(get_content_text(message.get("agent_type", "")))
    return total

def build_token_index_for_session(session_path: Path) -> Dict[int, int]:
    data = json.loads(session_path.read_text())
    messages = data.get("messages", [])
    token_index: Dict[int, int] = {}
    if not isinstance(messages, list):
        return token_index
    for message in messages:
        if not isinstance(message, dict):
            continue
        idx = message.get("idx")
        if isinstance(idx, int):
            token_index[idx] = estimate_message_tokens(message)
    return token_index

def token_sum_for_ranges(token_index: Dict[int, int], ranges: List[Tuple[int, int]]) -> int:
    covered_indices: Set[int] = set()
    for start, end in ranges:
        lo = min(start, end)
        hi = max(start, end)
        covered_indices.update(range(lo, hi + 1))
    return sum(token_index.get(idx, 0) for idx in covered_indices)

def add_token_estimation_to_conversation_analysis(
    analysis_path: Path,
    session_path: Path,
) -> None:
    if not analysis_path.exists() or not session_path.exists():
        return

    analysis = json.loads(analysis_path.read_text())
    if not isinstance(analysis, dict):
        return

    friction_ranges: Dict[str, Tuple[int, int]] = {}
    for frame in analysis.get("frames", []) or []:
        if not isinstance(frame, dict):
            continue
        for point in frame.get("friction_points", []) or []:
            if not isinstance(point, dict):
                continue
            pid = point.get("id")
            rng = point.get("message_range")
            if isinstance(pid, str) and isinstance(rng, list) and len(rng) == 2:
                try:
                    friction_ranges[pid] = (int(rng[0]), int(rng[1]))
                except Exception:
                    continue

    token_index = build_token_index_for_session(session_path)
    for suggestion in analysis.get("suggestions", []) or []:
        if not isinstance(suggestion, dict):
            continue
        addresses = suggestion.get("addresses", [])
        ranges: List[Tuple[int, int]] = []
        if isinstance(addresses, list):
            for address in addresses:
                if isinstance(address, str) and address in friction_ranges:
                    ranges.append(friction_ranges[address])
        suggestion["token_estimation_save"] = token_sum_for_ranges(token_index, ranges)

    write_json(analysis_path, analysis)

def add_token_estimation_to_subagent_analysis(
    analysis_path: Path,
    session_paths: List[Path],
) -> None:
    if not analysis_path.exists():
        return

    analysis = json.loads(analysis_path.read_text())
    if not isinstance(analysis, dict):
        return

    token_index_by_conversation_id: Dict[str, Dict[int, int]] = {}
    for session_path in session_paths:
        if not session_path.exists():
            continue
        data = json.loads(session_path.read_text())
        if not isinstance(data, dict):
            continue
        conversation_id = data.get("conversation_id")
        if isinstance(conversation_id, str):
            token_index_by_conversation_id[conversation_id] = build_token_index_for_session(session_path)

    action_occurrences: Dict[str, List[Tuple[str, int, int]]] = {}
    for action in analysis.get("shared_preamble_actions", []) or []:
        if not isinstance(action, dict):
            continue
        action_id = action.get("id")
        if not isinstance(action_id, str):
            continue
        entries: List[Tuple[str, int, int]] = []
        for appeared in action.get("appeared_in", []) or []:
            if not isinstance(appeared, dict):
                continue
            cid = appeared.get("conversation_id")
            rng = appeared.get("message_range")
            if isinstance(cid, str) and isinstance(rng, list) and len(rng) == 2:
                try:
                    entries.append((cid, int(rng[0]), int(rng[1])))
                except Exception:
                    continue
        action_occurrences[action_id] = entries

    for suggestion in analysis.get("suggestions", []) or []:
        if not isinstance(suggestion, dict):
            continue
        total = 0
        addresses = suggestion.get("addresses", [])
        if isinstance(addresses, list):
            for address in addresses:
                if not isinstance(address, str):
                    continue
                for cid, start, end in action_occurrences.get(address, []):
                    token_index = token_index_by_conversation_id.get(cid, {})
                    total += token_sum_for_ranges(token_index, [(start, end)])
        suggestion["token_estimation_save"] = total

    write_json(analysis_path, analysis)

def create_session_files(session_id: str) -> Dict[str, Any]:
    validate_session_id(session_id)
    generated_dir = resolve_generated_session_dir(session_id)
    source_session_dir = resolve_session_dir(session_id)
    generated_dir.mkdir(parents=True, exist_ok=True)
    stale_manifest = generated_dir / "session_manifest.json"
    if stale_manifest.exists():
        stale_manifest.unlink()
    stale_subagents_dir = generated_dir / "subagents"
    if stale_subagents_dir.exists():
        for stale_meta in stale_subagents_dir.glob("*.meta.json"):
            stale_meta.unlink()

    main_events = get_session(session_id, include_subagents=False)
    metadata_by_agent_id = extract_subagent_metadata_from_main_events(main_events)
    main_session = build_main_minimal_session(session_id, main_events, metadata_by_agent_id)
    main_session_path = generated_dir / "main.session.json"
    write_json(main_session_path, main_session)

    subagent_ids = {
        agent_id for agent_id in metadata_by_agent_id.keys()
        if AGENT_ID_PATTERN.fullmatch(agent_id)
    }
    for event in main_events:
        raw_agent_id = event.get("subagent_id")
        if isinstance(raw_agent_id, str) and AGENT_ID_PATTERN.fullmatch(raw_agent_id):
            subagent_ids.add(raw_agent_id)
    sorted_subagent_ids = sorted(subagent_ids)
    subagent_entries: List[Dict[str, Any]] = []
    groups: Dict[str, Dict[str, Any]] = defaultdict(lambda: {"sessions": [], "conversation_ids": []})

    for agent_id in sorted_subagent_ids:
        try:
            subagent_events = get_subagent(session_id, agent_id)
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

    manifest = {
        "session_id": session_id,
        "generated_dir": str(generated_dir.resolve()),
        "main_session_path": str(main_session_path.resolve()),
        "subagent_count": len(subagent_entries),
        "group_count": len(group_entries),
        "subagents": subagent_entries,
        "groups": group_entries,
    }
    return manifest

async def run_claude_prompt(
    prompt_path: Path,
    output_path: Path,
    input_path: Optional[Path] = None,
    input_paths: Optional[List[Path]] = None,
    working_dir: Optional[Path] = None,
) -> None:
    if input_path is None and not input_paths:
        raise ValueError("Either input_path or input_paths must be provided")

    prompt_lines = [
        f"Follow the markdown instructions in @{prompt_path.resolve()}.",
        f"OUTPUT_PATH = {path_for_prompt(output_path, working_dir)}",
    ]
    if input_path is not None:
        prompt_lines.append(f"INPUT_PATH = {path_for_prompt(input_path, working_dir)}")
    if input_paths:
        prompt_lines.append(
            "INPUT_PATHS = "
            + json.dumps([path_for_prompt(path, working_dir) for path in input_paths], ensure_ascii=True)
        )
    prompt_lines.append("Write valid JSON to OUTPUT_PATH.")
    prompt_lines.append("Return only a short completion acknowledgement.")
    instruction = "\n".join(prompt_lines)

    process = await asyncio.create_subprocess_exec(
        "claude", "-p", instruction,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(working_dir.resolve()) if working_dir is not None else None,
    )
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=600)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise Exception(f"Prompt timed out for {prompt_path.name}") from exc

    if process.returncode != 0:
        raise Exception(
            f"Prompt {prompt_path.name} failed: {(stderr or b'').decode(errors='replace')}"
        )

    if output_path.exists():
        return

    stdout_text = (stdout or b"").decode(errors="replace").strip()
    if not stdout_text:
        raise Exception(f"Prompt {prompt_path.name} did not write output file {output_path}")

    try:
        parsed = json.loads(stdout_text)
    except json.JSONDecodeError as exc:
        raise Exception(
            f"Prompt {prompt_path.name} did not produce JSON and did not write output file"
        ) from exc
    write_json(output_path, parsed)

async def run_claude_analysis(session_id: str):
    """Create minimal session files and run analyzers in sequence, ending with finalizer."""
    try:
        set_analysis_status(session_id, "Creating session files...")
        manifest = create_session_files(session_id)
        generated_dir = resolve_generated_session_dir(session_id)
        analyses_dir = generated_dir / "analyses"
        analyses_dir.mkdir(parents=True, exist_ok=True)

        conversation_prompt = (PROMPTS_ROOT / "conversation_analyzer.md").resolve()
        subagent_prompt = (PROMPTS_ROOT / "subagent_analyzer.md").resolve()
        finalizer_prompt = (PROMPTS_ROOT / "finalizer.md").resolve()
        if not conversation_prompt.exists():
            raise Exception(f"Missing prompt: {conversation_prompt}")
        if not subagent_prompt.exists():
            raise Exception(f"Missing prompt: {subagent_prompt}")
        if not finalizer_prompt.exists():
            raise Exception(f"Missing prompt: {finalizer_prompt}")

        conversation_analysis_paths: List[str] = []
        conversation_analysis_jobs: List[Tuple[Path, Path]] = []
        main_session_path = Path(manifest["main_session_path"])
        main_analysis_path = analyses_dir / "main.conversation_analysis.json"
        set_analysis_status(session_id, "Analyzing main conversation...")
        await run_claude_prompt(
            prompt_path=conversation_prompt,
            input_path=main_session_path,
            output_path=main_analysis_path,
            working_dir=generated_dir,
        )
        conversation_analysis_paths.append(str(main_analysis_path.resolve()))
        conversation_analysis_jobs.append((main_analysis_path, main_session_path))

        subagents: List[Dict[str, Any]] = manifest.get("subagents", [])
        total_subagents = len(subagents)
        for index, subagent in enumerate(subagents, start=1):
            set_analysis_status(session_id, f"Analyzing sub-agent {index}/{total_subagents}...")
            subagent_session_path = Path(subagent["session_path"])
            subagent_analysis_path = analyses_dir / f"{subagent['agent_id']}.conversation_analysis.json"
            await run_claude_prompt(
                prompt_path=conversation_prompt,
                input_path=subagent_session_path,
                output_path=subagent_analysis_path,
                working_dir=generated_dir,
            )
            conversation_analysis_paths.append(str(subagent_analysis_path.resolve()))
            conversation_analysis_jobs.append((subagent_analysis_path, subagent_session_path))

        set_analysis_status(session_id, "Estimating conversation token savings...")
        for analysis_path, session_path in conversation_analysis_jobs:
            add_token_estimation_to_conversation_analysis(analysis_path, session_path)

        subagent_group_analysis_paths: List[str] = []
        subagent_group_jobs: List[Tuple[Path, List[Path]]] = []
        groups: List[Dict[str, Any]] = manifest.get("groups", [])
        multi_groups = [group for group in groups if int(group.get("size", 0)) > 1]
        total_groups = len(multi_groups)
        for index, group in enumerate(multi_groups, start=1):
            set_analysis_status(session_id, f"Analyzing sub-agent groups {index}/{total_groups}...")
            group_output = analyses_dir / f"{sanitize_bucket_component(group['group_key'])}.subagent_analysis.json"
            group_session_paths = [
                resolve_manifest_path(path, generated_dir)
                for path in group["sessions"]
            ]
            await run_claude_prompt(
                prompt_path=subagent_prompt,
                input_paths=group_session_paths,
                output_path=group_output,
                working_dir=generated_dir,
            )
            subagent_group_analysis_paths.append(str(group_output.resolve()))
            subagent_group_jobs.append((group_output, group_session_paths))

        if subagent_group_jobs:
            set_analysis_status(session_id, "Estimating sub-agent token savings...")
            for analysis_path, session_paths in subagent_group_jobs:
                add_token_estimation_to_subagent_analysis(analysis_path, session_paths)

        set_analysis_status(session_id, "Finalizing analysis...")
        finalizer_inputs = [
            Path(path)
            for path in (conversation_analysis_paths + subagent_group_analysis_paths)
        ]
        final_analysis_path = generated_dir / "analysis.json"
        await run_claude_prompt(
            prompt_path=finalizer_prompt,
            input_paths=finalizer_inputs,
            output_path=final_analysis_path,
            working_dir=generated_dir,
        )

        set_analysis_status(session_id, "Completed")
        logger.info(f"Analysis completed for {session_id}")
        
    except Exception as e:
        logger.exception(f"Error in analysis for {session_id}")
        set_analysis_status(session_id, f"Error: {str(e)}")

class SessionInfo(BaseModel):
    id: str
    path: str
    size_mb: float

def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return len(text) // 4

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
        "cache_read": event.get("usage", {}).get("cache_read_input_tokens", 0)
    }
    
    # Check if usage is in the message object (common in sub-agents)
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
    
    # Identify sub-agent IDs
    subagent_id = None
    thinking_output_estimate = 0

    if "message" in event:
        msg = event["message"]
        role = msg.get("role", role)
        content = msg.get("content", [])
        
        # Check for subagent invocation in assistant messages
        if role == "assistant":
            for part in content if isinstance(content, list) else [content]:
                if isinstance(part, dict):
                    if part.get("type") == "thinking":
                        thinking_output_estimate += estimate_tokens(part.get("thinking", ""))
                    elif part.get("type") == "text" and not has_authoritative_message_usage:
                        tokens["output"] += estimate_tokens(part.get("text", ""))
                    elif part.get("type") == "tool_use" and not has_authoritative_message_usage:
                        tokens["tools"] += estimate_tokens(str(part.get("input", "")))
        
        # Check for tool results in user messages
        if role == "user":
            text_content = get_content_text(content)
            is_tool_result = False
            
            # Check if any part of the content is a tool_result
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "tool_result":
                        is_tool_result = True
                        break
            
            if is_tool_result or "toolUseResult" in event:
                role = "tool"
                if not has_authoritative_message_usage:
                    tokens["tools"] += estimate_tokens(text_content)
                
                # Look for agentId in toolUseResult first
                if "toolUseResult" in event and isinstance(event["toolUseResult"], dict):
                    subagent_id = event["toolUseResult"].get("agentId")
                
                # If not found, look in text content
                if not subagent_id and "agentId:" in text_content:
                    import re
                    match = re.search(r"agentId:\s*([a-f0-9]+)", text_content)
                    if match:
                        subagent_id = match.group(1)
            else:
                role = "user"
                if not has_authoritative_message_usage:
                    tokens["input"] += estimate_tokens(text_content)

    elif "attachment" in event:
        role = "system"
        att = event["attachment"]
        
        # Handle hooks
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
    
    # Filter out messages with <command-message>
    content_str = str(event.get("message", "")) + str(event.get("content", "")) + str(event.get("attachment", ""))
    if "<command-message>" in content_str:
        return True
    return False

def process_events(raw_events: List[Dict[str, Any]], filter_sidechains: bool = False) -> List[Dict[str, Any]]:
    # First pass: collect hooks and results by toolUseID
    hooks_by_tool_id = {}
    results_by_tool_id = {}
    subagent_ids_by_tool_id = {}

    for event in raw_events:
        # Collect hooks
        if event.get("role_type") == "hook" and event.get("toolUseID"):
            tid = event["toolUseID"]
            if tid not in hooks_by_tool_id:
                hooks_by_tool_id[tid] = []
            hooks_by_tool_id[tid].append(event)
            event["_is_consumed"] = True
        
        # Collect tool results
        if event.get("role_type") == "tool":
            # Check for toolUseResult in message content parts
            content = event.get("message", {}).get("content", [])
            parts = content if isinstance(content, list) else [content]
            has_mapped_part = False
            for part in parts:
                if isinstance(part, dict) and part.get("type") == "tool_result" and part.get("tool_use_id"):
                    tid = part["tool_use_id"]
                    results_by_tool_id[tid] = part
                    has_mapped_part = True
                    
                    # Check if this part has an agentId or if the event does
                    part_text = get_content_text(part)
                    if "agentId:" in part_text:
                        import re
                        match = re.search(r"agentId:\s*([a-f0-9]+)", part_text)
                        if match:
                            subagent_ids_by_tool_id[tid] = match.group(1)
                        
                    # Event level fallback
                    if tid not in subagent_ids_by_tool_id and event.get("subagent_id"):
                        subagent_ids_by_tool_id[tid] = event["subagent_id"]
            
            if has_mapped_part:
                event["_is_consumed"] = True

    # Second pass: Filter and group
    processed_events = []
    for event in raw_events:
        # Skip events that are already grouped
        if event.get("_is_consumed"):
            continue
            
        if event.get("role_type") == "hook":
            continue

        if filter_sidechains and event.get("isSidechain") is True and not event.get("subagent_id"):
            continue

        # If assistant, attach hooks and results to tool_use parts
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
    include_agent_subagent_totals: bool = True
) -> List[Dict[str, Any]]:
    subagent_totals_cache: Dict[str, Dict[str, int]] = {}

    def get_subagent_totals(agent_id: str) -> Dict[str, int]:
        if agent_id in subagent_totals_cache:
            return subagent_totals_cache[agent_id]
        totals = {"read": 0, "write": 0}
        try:
            sub_events = get_subagent(session_id, agent_id)
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
            tool_input = 0
            tool_output = 0
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

@app.get("/api/sessions")
def list_sessions(q: str = ""):
    logger.info("Listing sessions in %s", CLAUDE_PROJECTS_ROOT)
    return build_sessions_payload(search=q)

@app.post("/api/session/{session_id}/recent")
def touch_recent_session(session_id: str):
    get_session_record(session_id)
    mark_recent_session(session_id)
    return {"message": "Recent session updated"}

@app.post("/api/session/{session_id}/recent/remove")
def delete_recent_session(session_id: str):
    get_session_record(session_id)
    remove_recent_session(session_id)
    return {"message": "Recent session removed"}

@app.get("/api/session/{session_id}")
def get_session(session_id: str, include_subagents: bool = False):
    file_path = resolve_session_file_path(session_id)
    session_dir = resolve_session_dir(session_id)
    
    if not file_path.exists():
        logger.error("Session file %s not found", file_path)
        raise HTTPException(status_code=404, detail="Session not found")
    
    logger.info("Reading session %s (include_subagents=%s)", session_id, include_subagents)
    raw_events = []
    try:
        with open(file_path, "r") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                    if is_noise(event):
                        continue
                    raw_events.append(enrich_event(event, session_dir))
                except json.JSONDecodeError:
                    continue
        
        if include_subagents:
            # Find all subagent IDs mentioned
            subagent_ids = set()
            for e in raw_events:
                if e.get("subagent_id"):
                    subagent_ids.add(e["subagent_id"])
            
            # Load each subagent's events
            for sa_id in subagent_ids:
                try:
                    sa_events = get_subagent(session_id, sa_id)
                    raw_events.extend(sa_events)
                except:
                    logger.warning(f"Could not load subagent {sa_id} for session {session_id}")

    except Exception as e:
        logger.exception("Error reading session file")
        raise HTTPException(status_code=500, detail=str(e))
    
    processed = process_events(raw_events, filter_sidechains=not include_subagents)
    return annotate_tool_tokens(processed, session_id, include_agent_subagent_totals=True)

@app.get("/api/subagent/{session_id}/{agent_id}")
def get_subagent(session_id: str, agent_id: str):
    validate_agent_id(agent_id)
    session_dir = resolve_session_dir(session_id)
    subagent_path = session_dir / "subagents" / f"agent-{agent_id}.jsonl"
    
    if not subagent_path.exists():
        logger.error("Sub-agent file %s not found", subagent_path)
        # Try finding any file that contains the agent_id
        found = False
        for f in (session_dir / "subagents").glob(f"*{agent_id}*.jsonl"):
            subagent_path = f
            found = True
            break
        if not found:
            raise HTTPException(status_code=404, detail="Sub-agent not found")
    
    logger.info("Reading sub-agent %s for session %s", agent_id, session_id)
    raw_events = []
    with open(subagent_path, "r") as f:
        for line in f:
            try:
                event = json.loads(line)
                if is_noise(event):
                    continue
                raw_events.append(enrich_event(event, session_dir))
            except:
                continue
    processed = process_events(raw_events, filter_sidechains=False)
    return annotate_tool_tokens(processed, session_id, include_agent_subagent_totals=False)


@app.post("/api/session/{session_id}/analyze")
async def trigger_analysis(session_id: str, background_tasks: BackgroundTasks):
    validate_session_id(session_id)
    current_status = get_analysis_status(session_id)
    if current_status not in ["Not started", "Completed"] and not current_status.startswith("Error"):
        raise HTTPException(status_code=409, detail="Analysis already in progress")
    set_analysis_status(session_id, "Starting...")
    background_tasks.add_task(run_claude_analysis, session_id)
    return {"message": "Analysis started"}

@app.post("/api/session/{session_id}/session-files")
def generate_session_files(session_id: str):
    validate_session_id(session_id)
    try:
        manifest = create_session_files(session_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed creating session files for %s", session_id)
        raise HTTPException(status_code=500, detail=str(exc))
    return {
        "message": "Session files created",
        "session_id": session_id,
        "generated_dir": manifest.get("generated_dir"),
        "main_session_path": manifest.get("main_session_path"),
        "subagent_count": manifest.get("subagent_count", 0),
        "group_count": manifest.get("group_count", 0),
    }

@app.get("/api/session/{session_id}/analysis/stream")
async def analysis_stream(session_id: str):
    validate_session_id(session_id)
    async def event_generator() -> AsyncGenerator[str, None]:
        last_status = None
        while True:
            status = get_analysis_status(session_id)
            if status != last_status:
                yield f"data: {json.dumps({'status': status})}\n\n"
                last_status = status
            if status == "Completed" or status.startswith("Error"):
                break
            await asyncio.sleep(0.5)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/api/session/{session_id}/analysis")
def get_analysis(session_id: str):
    analysis_path = resolve_generated_session_dir(session_id) / "analysis.json"
    if not analysis_path.exists():
        raise HTTPException(status_code=404, detail="Analysis not found")
    with open(analysis_path, "r") as f:
        return json.load(f)

@app.post("/api/session/{session_id}/analysis")
def save_analysis(session_id: str, analysis: Dict[str, Any]):
    analysis_path = resolve_generated_session_dir(session_id) / "analysis.json"
    analysis_dir = analysis_path.parent
    analysis_dir.mkdir(parents=True, exist_ok=True)
    with open(analysis_path, "w") as f:
        json.dump(analysis, f)
    return {"message": "Analysis saved"}

@app.get("/api/artifact/{session_id}/{artifact_name:path}")
def get_artifact(session_id: str, artifact_name: str):
    session_dir = resolve_session_dir(session_id)
    tool_results_dir = (session_dir / "tool-results").resolve()

    candidate_paths = [
        (tool_results_dir / artifact_name).resolve(),
        (session_dir / artifact_name).resolve(),
    ]
    path = None
    for candidate in candidate_paths:
        try:
            candidate.relative_to(session_dir)
        except ValueError:
            continue
        if candidate.exists() and candidate.is_file():
            path = candidate
            break

    if path is None:
        raise HTTPException(status_code=404, detail="Artifact not found")

    logger.info("Retrieving artifact %s", path)
    return {"content": path.read_text(errors="replace")}

# Serve frontend build
app.mount("/", StaticFiles(directory="app/frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting backend server...")
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
