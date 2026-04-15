import json
import os
import logging
import asyncio
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any, AsyncGenerator
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
INDEX_STATE_PATH = Path(__file__).parent / "session_index.json"
MAX_JSONL_SCAN_LINES = 400
MAX_RECENT_SESSIONS = 20
PROMPTS_ROOT = Path(__file__).parent / "prompts"
SESSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
AGENT_ID_PATTERN = re.compile(r"^[a-f0-9]+$")

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

def extract_session_metadata(session_file: Path) -> Dict[str, Any]:
    title = session_file.stem
    cwd_path: Optional[str] = None
    title_found = False

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
                    if data.get("type") == "custom-title" and data.get("customTitle"):
                        title = str(data.get("customTitle"))
                        title_found = True
                    elif data.get("slug"):
                        title = str(data.get("slug"))
                        title_found = True

                if cwd_path and title_found:
                    break
    except Exception:
        logger.warning("Could not parse metadata for session file %s", session_file)

    return {"cwd": cwd_path, "title": title}

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

def get_analysis_status_path(session_id: str) -> Path:
    return resolve_session_dir(session_id) / "analysis_status.json"

def set_analysis_status(session_id: str, status: str) -> None:
    analysis_status[session_id] = status
    try:
        status_path = get_analysis_status_path(session_id)
        status_path.parent.mkdir(exist_ok=True)
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

async def run_claude_analysis(session_id: str):
    """Async task to run framing analysis."""
    try:
        session_dir = resolve_session_dir(session_id)
        session_dir.mkdir(exist_ok=True)
        
        set_analysis_status(session_id, "Exporting session...")
        # 1. Export Minimal JSON
        events = get_session(session_id)
        minimal_events = []
        for e in events:
            role = e.get("role_type", "unknown")
            text = get_content_text(e.get("message", e.get("attachment", e.get("content", ""))))
            minimal_events.append({
                "uuid": e.get("uuid"),
                "role": role,
                "text": text,
                "tokens": e.get("total_tokens", 0)
            })
            
            # Include sub-agent events if applicable
            if e.get("subagent_id"):
                agent_id = e["subagent_id"]
                try:
                    agent_events = get_subagent(session_id, agent_id)
                    for ae in agent_events:
                        minimal_events.append({
                            "uuid": ae.get("uuid"),
                            "role": f"subagent-{agent_id}-{ae.get('role_type')}",
                            "text": get_content_text(ae.get("message", ae.get("attachment", ae.get("content", "")))),
                            "tokens": ae.get("total_tokens", 0),
                            "parent_uuid": e.get("uuid")
                        })
                except:
                    logger.warning(f"Could not fetch subagent {agent_id} for analysis")

        export_path = session_dir / "minimal_session.json"
        with open(export_path, "w") as f:
            json.dump(minimal_events, f)

        set_analysis_status(session_id, "Framing conversation...")
        # 2. Framing
        frame_prompt_path = (PROMPTS_ROOT / "frame.md").resolve()
        if not frame_prompt_path.exists():
            raise Exception(f"Framing prompt not found: {frame_prompt_path}")

        framing_instruction = (
            f"Follow the markdown instructions in @{frame_prompt_path}. "
            f"The input is in @{export_path.resolve()}. "
            "Return only valid JSON."
        )
        process = await asyncio.create_subprocess_exec(
            "claude", "-p", framing_instruction,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
        except asyncio.TimeoutError as exc:
            process.kill()
            await process.communicate()
            raise Exception("Framing timed out after 300 seconds") from exc
        if process.returncode != 0:
            raise Exception(f"Framing failed: {stderr.decode()}")

        frames = json.loads(stdout.decode())
        for frame in frames:
            suggestions = frame.get("suggestions", [])
            if isinstance(suggestions, list):
                frame["suggestion"] = "\n".join(
                    s for s in suggestions if isinstance(s, str)
                )
            elif isinstance(suggestions, str):
                frame["suggestion"] = suggestions
            else:
                frame["suggestion"] = ""

        # 4. Save Final Analysis
        analysis_path = session_dir / "analysis.json"
        with open(analysis_path, "w") as f:
            json.dump({"frames": frames}, f)
            
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
        return content
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
    analysis_path = resolve_session_dir(session_id) / "analysis.json"
    if not analysis_path.exists():
        raise HTTPException(status_code=404, detail="Analysis not found")
    with open(analysis_path, "r") as f:
        return json.load(f)

@app.post("/api/session/{session_id}/analysis")
def save_analysis(session_id: str, analysis: Dict[str, Any]):
    analysis_path = resolve_session_dir(session_id) / "analysis.json"
    analysis_dir = analysis_path.parent
    analysis_dir.mkdir(exist_ok=True)
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
