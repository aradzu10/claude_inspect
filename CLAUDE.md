# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A web app for browsing and inspecting Claude Code sessions. It reads transcripts from `~/.claude/projects`, converts them to a minimal JSON format, groups sub-agents, and lets you drill into conversations with token breakdowns and AI-generated analysis.

## Commands

**Backend:**
```bash
uv sync                                                      # install deps
uv run uvicorn app.backend.main:app --host 0.0.0.0 --port 8000  # run server
uv run pytest app/backend/tests/                             # run all backend tests
uv run pytest app/backend/tests/test_text_utils.py           # run one test file
```

**Frontend:**
```bash
cd app/frontend
npm install          # install deps
npm run dev          # dev server (port 5173, proxies /api to :8000)
npm run build        # build to dist/ (served by FastAPI in prod)
npm test             # run vitest
npm test -- --reporter=verbose  # verbose test output
```

## Architecture

### Data Flow

1. **Session discovery** (`session_index.py`): scans `~/.claude/projects` for JSONL transcript files, persists an index to `db/session_index.json`.
2. **Session file generation** (`minimal_sessions.py`): converts a full JSONL transcript into a minimal JSON layout under `db/<session_id>/`:
   - `main.session.json` — enriched main-agent events
   - `subagents/<agent_id>.json` — per-agent event lists
   - `groups/` — sub-agents grouped by (agentType, description prefix)
   - `analyses/` — AI-generated analysis outputs
3. **Event enrichment** (`events.py`): each event gets token counts, sanitized payloads, and extracted sub-agent IDs.
4. **Analysis pipeline** (`analysis.py`): spawns Claude CLI as a subprocess with prompt templates from `prompts/`, streams progress via SSE.

### Backend (`app/backend/`)

- `main.py` — FastAPI app. All `/api/*` routes. Serves frontend static files from `app/frontend/dist/`.
- `config.py` — all constants and paths. The Claude projects root (`~/.claude/projects`), DB path, regex patterns for validation.
- `text_utils.py` — token estimation (len/4), markup sanitization, content extraction helpers.

### Frontend (`app/frontend/src/`)

- `App.tsx` — root component. Wires together Sidebar, SessionView, SubagentModal, and SessionProvider.
- `context/SessionContext.tsx` — shared session state (events, sub-agent logs, scroll refs, message refs).
- `hooks/` — one hook per data concern: `useSessionsList`, `useSessionData`, `useAnalysisStream`, `useSubagentLogs`, `useSessionFiles`, `useSelectedSession`, `useHiddenSessions`, `useHideToast`.
- `components/EventView.tsx` — the heaviest component (~30KB). Renders the conversation with tool blocks, sticky headers, token counts.
- `utils/` — pure functions: `sessions.ts` (project grouping), `events.ts` (filtering, token aggregation), `format.ts` (display formatting), `text.ts`, `content.ts`, `scroll.ts`, `url.ts`.

### Key Constraints

- The session index is append-only; stale sessions are not automatically removed.
- `MAX_JSONL_SCAN_LINES = 400` — only the first 400 lines of a JSONL file are scanned for metadata extraction.
- Analysis runs Claude CLI as a subprocess (`run_claude_prompt` in `analysis.py`); it must be available in PATH.
- Frontend talks to backend via `/api` prefix; Vite proxies this in dev mode.
