# Claude Code Session Analyzer — Prompts

Four prompts. One schema file.

## Flow

```
db/generated_sessions/<session_id>/
  ├─ main.session.json
  ├─ subagents/
  │   └─ agent-<id>.session.json
  ├─ groups/
  │   └─ <agentType>__<name>.json   (name = first word of description)
  └─ analyses/
      ├─ *.conversation_analysis.json      (main + each sub-agent)
      └─ *.subagent_analysis.json          (only groups with >=2 sessions)

finalizer.md(INPUT_PATHS = all analysis files) ──▶ db/generated_sessions/<session_id>/analysis.json
```

## Files

| File | Role |
|---|---|
| `schemas.md` | All JSON shapes. Referenced by every prompt. |
| `conversation_analyzer.md` | Runs once per conversation. Reads `INPUT_PATH`, writes `OUTPUT_PATH`. |
| `subagent_analyzer.md` | Runs once per sub-agent type. Reads `INPUT_PATHS` (list), writes `OUTPUT_PATH`. |
| `finalizer.md` | Runs once at the end. Reads `INPUT_PATHS` (list), writes `OUTPUT_PATH`. |

Every prompt takes its paths from the caller and is told not to read or write anything else.

## What your driver code does (not a prompt)

1. Parse the Claude Code transcript into minimal conversation files:
   - one main file with `sub_agent_invocation` summaries only
   - one sub-agent file per sub-agent conversation.
2. Read sub-agent metadata from source Claude sidecars (`subagents/agent-*.meta.json`) when present, otherwise fallback to invocation metadata in the parent conversation.
3. Build grouping buckets from metadata by `(agentType, first word of description)`.
4. Invoke `conversation_analyzer.md` once for the main session and once for each sub-agent session.
5. For each group with two or more sub-agent sessions, invoke `subagent_analyzer.md` with the group paths.
6. Add `token_estimation_save` to each suggestion in analyzer outputs (deterministic token estimation from addressed `message_range`s).
7. Invoke `finalizer.md` once with all `conversation_analysis` + `subagent_analysis` files to produce `analysis.json`.
