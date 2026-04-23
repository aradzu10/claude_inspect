import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from . import config
from .minimal_sessions import (
    create_session_files,
    path_for_prompt,
    resolve_manifest_path,
    write_json,
)
from .session_index import resolve_generated_session_dir
from .text_utils import estimate_tokens, get_content_text, sanitize_bucket_component

logger = logging.getLogger("claude-inspect")

# In-memory cache for analysis status (persisted to disk as well)
_analysis_status: Dict[str, str] = {}


def _analysis_status_path(session_id: str) -> Path:
    return resolve_generated_session_dir(session_id) / "analysis_status.json"


def set_analysis_status(session_id: str, status: str) -> None:
    _analysis_status[session_id] = status
    try:
        status_path = _analysis_status_path(session_id)
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(json.dumps({"status": status}))
    except Exception:
        logger.warning("Could not persist analysis status for %s", session_id)


def get_analysis_status(session_id: str) -> str:
    if session_id in _analysis_status:
        return _analysis_status[session_id]
    try:
        status_path = _analysis_status_path(session_id)
        if status_path.exists():
            status = json.loads(status_path.read_text()).get("status", "Not started")
            # Stale in-progress status from a previous server process — treat as not started.
            if status not in ("Not started", "Completed") and not status.startswith("Error"):
                return "Not started"
            return status
    except Exception:
        logger.warning("Could not read persisted analysis status for %s", session_id)
    return "Not started"


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

    if output_path.exists():
        logger.info("Skipping %s — output already exists", prompt_path.name)
        return

    logger.info("Running claude prompt: %s -> %s", prompt_path.name, output_path)
    process = await asyncio.create_subprocess_exec(
        "claude", "--dangerously-skip-permissions", "--effort", "medium", "--model", "sonnet", "-p", instruction,
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

    stdout_text = (stdout or b"").decode(errors="replace").strip()
    stderr_text = (stderr or b"").decode(errors="replace").strip()

    if process.returncode != 0:
        logger.error(
            "claude failed for %s (exit %d)\n--- stdout ---\n%s\n--- stderr ---\n%s",
            prompt_path.name, process.returncode, stdout_text or "(empty)", stderr_text or "(empty)",
        )
        raise Exception(
            f"Prompt {prompt_path.name} failed (exit {process.returncode})."
            f"\nstdout: {stdout_text or '(empty)'}"
            f"\nstderr: {stderr_text or '(empty)'}"
        )

    logger.debug("claude stdout for %s:\n%s", prompt_path.name, stdout_text)
    if stderr_text:
        logger.warning("claude stderr for %s:\n%s", prompt_path.name, stderr_text)

    if not stdout_text:
        raise Exception(f"Prompt {prompt_path.name} did not write output file {output_path}")

    try:
        parsed = json.loads(stdout_text)
    except json.JSONDecodeError as exc:
        raise Exception(
            f"Prompt {prompt_path.name} did not produce JSON and did not write output file"
        ) from exc
    write_json(output_path, parsed)


async def run_claude_analysis(session_id: str, override: bool = False) -> None:
    """Create minimal session files and run analyzers in sequence, ending with finalizer."""
    try:
        set_analysis_status(session_id, "Creating session files...")
        manifest = create_session_files(session_id)
        generated_dir = resolve_generated_session_dir(session_id)

        if override:
            analyses_dir_existing = generated_dir / "analyses"
            for stale in list(generated_dir.glob("*.json")) + list(analyses_dir_existing.glob("*.json")):
                if stale.name != "analysis_status.json":
                    stale.unlink(missing_ok=True)
                    logger.info("Deleted stale analysis file: %s", stale)
        analyses_dir = generated_dir / "analyses"
        analyses_dir.mkdir(parents=True, exist_ok=True)

        conversation_prompt = (config.PROMPTS_ROOT / "conversation_analyzer.md").resolve()
        subagent_prompt = (config.PROMPTS_ROOT / "subagent_analyzer.md").resolve()
        finalizer_prompt = (config.PROMPTS_ROOT / "finalizer.md").resolve()
        for prompt in (conversation_prompt, subagent_prompt, finalizer_prompt):
            if not prompt.exists():
                raise Exception(f"Missing prompt: {prompt}")

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
        logger.info("Analysis completed for %s", session_id)

    except Exception as exc:
        logger.exception("Error in analysis for %s", session_id)
        set_analysis_status(session_id, f"Error: {exc}")
