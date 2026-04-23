import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from . import config

logger = logging.getLogger("claude-inspect")


def validate_session_id(session_id: str) -> str:
    if not config.SESSION_ID_PATTERN.fullmatch(session_id):
        raise HTTPException(status_code=400, detail="Invalid session ID format")
    return session_id


def validate_agent_id(agent_id: str) -> str:
    if not config.AGENT_ID_PATTERN.fullmatch(agent_id):
        raise HTTPException(status_code=400, detail="Invalid agent ID format")
    return agent_id


def load_index_state() -> Dict[str, Any]:
    if not config.INDEX_STATE_PATH.exists():
        return {"recent_session_ids": [], "sessions": {}, "updated_at": None}
    try:
        data = json.loads(config.INDEX_STATE_PATH.read_text())
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
        logger.warning("Could not read index state %s", config.INDEX_STATE_PATH)
        return {"recent_session_ids": [], "sessions": {}, "updated_at": None}


def save_index_state(state: Dict[str, Any]) -> None:
    safe_state = {
        "recent_session_ids": state.get("recent_session_ids", []),
        "sessions": state.get("sessions", {}),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    config.INDEX_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    config.INDEX_STATE_PATH.write_text(json.dumps(safe_state, indent=2))


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
            for _ in range(config.MAX_JSONL_SCAN_LINES):
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
    if not config.CLAUDE_PROJECTS_ROOT.exists():
        return sessions

    for session_file in config.CLAUDE_PROJECTS_ROOT.glob("*/*.jsonl"):
        if not session_file.is_file():
            continue

        session_id = session_file.stem
        if not config.SESSION_ID_PATTERN.fullmatch(session_id):
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


def _session_record_from_discovery(rec: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": rec["id"],
        "title": rec["title"],
        "slug": rec.get("slug"),
        "name": rec.get("name"),
        "project_name": rec["project_name"],
        "session_file_path": rec["session_file_path"],
        "session_dir_path": rec["session_dir_path"],
        "mtime": rec["mtime"],
    }


def build_sessions_payload(search: str = "") -> Dict[str, Any]:
    search_query = search.strip().lower()
    discovered = discover_sessions()
    session_map = {item["id"]: item for item in discovered}

    state = load_index_state()
    recent_ids = [sid for sid in state.get("recent_session_ids", []) if sid in session_map]

    state["recent_session_ids"] = recent_ids[:config.MAX_RECENT_SESSIONS]
    state["sessions"] = {sid: _session_record_from_discovery(rec) for sid, rec in session_map.items()}
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

    state["sessions"] = {sid: _session_record_from_discovery(rec) for sid, rec in session_map.items()}
    state["recent_session_ids"] = [sid for sid in state.get("recent_session_ids", []) if sid in session_map]
    save_index_state(state)
    return state["sessions"][session_id]


def mark_recent_session(session_id: str) -> None:
    state = load_index_state()
    recent_ids = [sid for sid in state.get("recent_session_ids", []) if sid != session_id]
    recent_ids.insert(0, session_id)
    state["recent_session_ids"] = recent_ids[:config.MAX_RECENT_SESSIONS]
    save_index_state(state)


def remove_recent_session(session_id: str) -> None:
    state = load_index_state()
    state["recent_session_ids"] = [
        sid for sid in state.get("recent_session_ids", [])
        if sid != session_id
    ]
    save_index_state(state)


def resolve_session_dir(session_id: str) -> Path:
    session_record = get_session_record(session_id)
    return Path(str(session_record["session_dir_path"]))


def resolve_session_file_path(session_id: str) -> Path:
    session_record = get_session_record(session_id)
    return Path(str(session_record["session_file_path"]))


def resolve_generated_session_dir(session_id: str) -> Path:
    validate_session_id(session_id)
    return config.GENERATED_SESSIONS_ROOT / session_id
