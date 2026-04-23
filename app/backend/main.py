import asyncio
import json
import logging
import os
from typing import Any, AsyncGenerator, Dict

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .analysis import (
    get_analysis_status,
    run_claude_analysis,
    set_analysis_status,
)
from .events import load_session_events, load_subagent_events
from .minimal_sessions import create_session_files
from .session_index import (
    build_sessions_payload,
    get_session_record,
    mark_recent_session,
    remove_recent_session,
    resolve_generated_session_dir,
    resolve_session_dir,
    validate_session_id,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("backend.log"),
        logging.StreamHandler(),
    ],
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


@app.get("/api/sessions")
def list_sessions(q: str = ""):
    logger.info("Listing sessions")
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
    return load_session_events(session_id, include_subagents=include_subagents)


@app.get("/api/subagent/{session_id}/{agent_id}")
def get_subagent(session_id: str, agent_id: str):
    return load_subagent_events(session_id, agent_id)


@app.post("/api/session/{session_id}/analyze")
async def trigger_analysis(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: Dict[str, Any] = None,
):
    validate_session_id(session_id)
    current_status = get_analysis_status(session_id)
    if current_status not in ["Not started", "Completed"] and not current_status.startswith("Error"):
        raise HTTPException(status_code=409, detail="Analysis already in progress")
    override = bool((body or {}).get("override", False))
    try:
        manifest = create_session_files(session_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    subagent_count = manifest.get("subagent_count", 0)
    group_count = manifest.get("group_count", 0)
    set_analysis_status(session_id, "Starting...")
    background_tasks.add_task(run_claude_analysis, session_id, override)
    total_tasks = subagent_count + group_count + 1
    return {"message": "Analysis started", "total_tasks": total_tasks}


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
    return json.loads(analysis_path.read_text())


@app.post("/api/session/{session_id}/analysis")
def save_analysis(session_id: str, analysis: Dict[str, Any]):
    analysis_path = resolve_generated_session_dir(session_id) / "analysis.json"
    analysis_path.parent.mkdir(parents=True, exist_ok=True)
    analysis_path.write_text(json.dumps(analysis))
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


app.mount("/", StaticFiles(directory="app/frontend/dist", html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    logger.info("Starting backend server...")
    host = os.getenv("BACKEND_HOST", "127.0.0.1")
    port = int(os.getenv("BACKEND_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
