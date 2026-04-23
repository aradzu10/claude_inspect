import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.backend import config, events


def write_jsonl(path: Path, records: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")


class IsNoiseTests(unittest.TestCase):
    def test_permission_mode_event_is_noise(self):
        self.assertTrue(events.is_noise({"type": "permission-mode"}))

    def test_file_history_snapshot_is_noise(self):
        self.assertTrue(events.is_noise({"type": "file-history-snapshot"}))

    def test_queue_operation_remove_is_noise(self):
        self.assertTrue(events.is_noise({"type": "queue-operation", "operation": "remove"}))

    def test_attachment_queued_command_is_noise(self):
        self.assertTrue(events.is_noise({
            "type": "attachment",
            "attachment": {"type": "queued_command"},
        }))

    def test_task_notification_in_attachment_prompt_is_noise(self):
        self.assertTrue(events.is_noise({
            "type": "attachment",
            "attachment": {"prompt": "<task-notification>x</task-notification>"},
        }))

    def test_command_message_in_content_is_noise(self):
        self.assertTrue(events.is_noise({"content": "hi <command-message>foo</command-message>"}))

    def test_normal_event_is_not_noise(self):
        self.assertFalse(events.is_noise({"type": "assistant", "message": {"role": "assistant"}}))


class EnrichEventTests(unittest.TestCase):
    def test_user_text_event_tokens_and_role(self):
        event = {
            "type": "user",
            "message": {"role": "user", "content": "Hello there friend!"},
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["role_type"], "user")
        self.assertGreater(enriched["tokens"]["input"], 0)
        self.assertEqual(enriched["tokens"]["output"], 0)

    def test_assistant_message_with_usage_is_authoritative(self):
        event = {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "hi " * 100}],
                "usage": {
                    "input_tokens": 11,
                    "output_tokens": 22,
                    "cache_read_input_tokens": 3,
                    "cache_creation_input_tokens": 4,
                },
            },
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["tokens"]["input"], 11)
        self.assertEqual(enriched["tokens"]["output"], 22)
        self.assertEqual(enriched["tokens"]["cache_read"], 3)
        self.assertEqual(enriched["tokens"]["cache_creation"], 4)

    def test_tool_result_role_reassignment(self):
        event = {
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}],
            },
            "toolUseResult": {"agentId": "abc123"},
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["role_type"], "tool")
        self.assertEqual(enriched["subagent_id"], "abc123")

    def test_agent_id_extracted_from_text_when_not_in_tool_use_result(self):
        event = {
            "type": "user",
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "agentId: abc123"}],
            },
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["subagent_id"], "abc123")

    def test_attachment_hook_role(self):
        event = {
            "type": "attachment",
            "attachment": {"type": "hook_success", "toolUseID": "tool-1"},
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["role_type"], "hook")
        self.assertEqual(enriched["toolUseID"], "tool-1")

    def test_compaction_boundary_detected(self):
        event = {
            "type": "system",
            "subtype": "compact_boundary",
            "content": "Conversation compacted successfully",
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertTrue(enriched["is_compaction_boundary"])

    def test_heavy_tokens_total_is_read_plus_write(self):
        event = {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [],
                "usage": {"input_tokens": 5, "output_tokens": 7, "cache_read_input_tokens": 9},
            },
        }
        enriched = events.enrich_event(event, Path("/tmp"))
        self.assertEqual(enriched["heavy_tokens_total"], 12)


class ProcessEventsTests(unittest.TestCase):
    def test_hooks_attached_to_tool_use_and_hook_events_dropped(self):
        raw = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "id": "t1", "name": "Bash", "input": {}},
                    ]
                },
            },
            {
                "role_type": "hook",
                "toolUseID": "t1",
                "attachment": {"type": "hook_success", "toolUseID": "t1"},
            },
        ]
        processed = events.process_events(raw)
        self.assertEqual(len(processed), 1)
        tool_part = processed[0]["message"]["content"][0]
        self.assertEqual(len(tool_part["hooks"]), 1)
        self.assertEqual(tool_part["hooks"][0]["toolUseID"], "t1")

    def test_tool_results_attached_to_tool_use(self):
        raw = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "id": "t1", "name": "Read", "input": {}},
                    ]
                },
            },
            {
                "role_type": "tool",
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "output"}
                    ]
                },
            },
        ]
        processed = events.process_events(raw)
        # tool event was consumed; only assistant remains
        self.assertEqual(len(processed), 1)
        tool_part = processed[0]["message"]["content"][0]
        self.assertEqual(tool_part["output"]["content"], "output")

    def test_sidechain_filtering_drops_non_subagent_sidechains(self):
        raw = [
            {"role_type": "assistant", "isSidechain": True, "message": {"content": []}},
            {"role_type": "assistant", "isSidechain": True, "subagent_id": "abc", "message": {"content": []}},
            {"role_type": "assistant", "message": {"content": []}},
        ]
        processed = events.process_events(raw, filter_sidechains=True)
        self.assertEqual(len(processed), 2)

    def test_sidechains_kept_when_filter_disabled(self):
        raw = [{"role_type": "assistant", "isSidechain": True, "message": {"content": []}}]
        self.assertEqual(len(events.process_events(raw, filter_sidechains=False)), 1)


class LoadSessionEventsTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.projects_root = Path(self.tmpdir.name) / "projects"
        self.index_path = Path(self.tmpdir.name) / "session_index.json"
        self.generated = Path(self.tmpdir.name) / "generated"
        self.patches = [
            patch.object(config, "CLAUDE_PROJECTS_ROOT", self.projects_root),
            patch.object(config, "INDEX_STATE_PATH", self.index_path),
            patch.object(config, "GENERATED_SESSIONS_ROOT", self.generated),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmpdir.cleanup()

    def test_load_session_events_returns_processed_events(self):
        proj = self.projects_root / "proj"
        write_jsonl(proj / "abc.jsonl", [
            {"type": "user", "cwd": "/tmp", "message": {"role": "user", "content": "hi"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "hello back"}]}},
        ])
        loaded = events.load_session_events("abc", include_subagents=False)
        self.assertEqual(len(loaded), 2)
        self.assertEqual(loaded[0]["role_type"], "user")
        self.assertEqual(loaded[1]["role_type"], "assistant")

    def test_load_subagent_events_found_by_exact_filename(self):
        proj = self.projects_root / "proj"
        write_jsonl(proj / "abc.jsonl", [{"cwd": "/tmp"}])
        write_jsonl(proj / "abc" / "subagents" / "agent-deadbeef.jsonl", [
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "sub"}]}}
        ])
        loaded = events.load_subagent_events("abc", "deadbeef")
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0]["role_type"], "assistant")


if __name__ == "__main__":
    unittest.main()
