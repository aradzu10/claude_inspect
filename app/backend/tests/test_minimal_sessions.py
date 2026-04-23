import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.backend import config, minimal_sessions


def write_jsonl(path: Path, records: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")


class PathHelpersTests(unittest.TestCase):
    def test_path_for_prompt_returns_relative_when_inside_working_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            working = Path(tmp)
            target = working / "sub" / "file.json"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
            self.assertEqual(
                minimal_sessions.path_for_prompt(target, working),
                "sub/file.json",
            )

    def test_path_for_prompt_returns_absolute_when_outside_working_dir(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            target = Path(a) / "f.json"
            target.touch()
            result = minimal_sessions.path_for_prompt(target, Path(b))
            self.assertEqual(result, str(target.resolve()))

    def test_resolve_manifest_path_absolute(self):
        with tempfile.TemporaryDirectory() as tmp:
            absolute = Path(tmp) / "abs.json"
            result = minimal_sessions.resolve_manifest_path(str(absolute), Path("/other"))
            self.assertEqual(result, absolute)

    def test_resolve_manifest_path_relative(self):
        with tempfile.TemporaryDirectory() as tmp:
            generated = Path(tmp)
            result = minimal_sessions.resolve_manifest_path("groups/x.json", generated)
            self.assertEqual(result, (generated / "groups/x.json").resolve())


class ExtractSubagentInvocationFieldsTests(unittest.TestCase):
    def test_dict_input_returns_description_and_prompt(self):
        desc, prompt = minimal_sessions.extract_subagent_invocation_fields(
            {"description": "Test", "prompt": "Do the thing"}
        )
        self.assertEqual(desc, "Test")
        self.assertEqual(prompt, "Do the thing")

    def test_dict_input_falls_back_to_task(self):
        _, prompt = minimal_sessions.extract_subagent_invocation_fields({"task": "fallback"})
        self.assertEqual(prompt, "fallback")

    def test_empty_dict_returns_empty_strings(self):
        self.assertEqual(
            minimal_sessions.extract_subagent_invocation_fields({}),
            ("", ""),
        )

    def test_json_string_is_parsed(self):
        raw = json.dumps({"description": "X", "prompt": "Y"})
        self.assertEqual(
            minimal_sessions.extract_subagent_invocation_fields(raw),
            ("X", "Y"),
        )

    def test_non_json_string_becomes_prompt(self):
        self.assertEqual(
            minimal_sessions.extract_subagent_invocation_fields("plain text"),
            ("", "plain text"),
        )


class ExtractSubagentMetadataTests(unittest.TestCase):
    def test_extracts_agent_type_and_description(self):
        events = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "Agent",
                            "subagent_id": "aaa",
                            "input": {"agentType": "Explore", "description": "Scan repo"},
                        }
                    ]
                },
            }
        ]
        meta = minimal_sessions.extract_subagent_metadata_from_main_events(events)
        self.assertEqual(meta, {"aaa": {"agentType": "Explore", "description": "Scan repo"}})

    def test_defaults_for_missing_fields(self):
        events = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "name": "Agent", "subagent_id": "aaa", "input": {}},
                    ]
                },
            }
        ]
        meta = minimal_sessions.extract_subagent_metadata_from_main_events(events)
        self.assertEqual(meta["aaa"], {"agentType": "unknown", "description": "Unknown agent"})

    def test_ignores_non_agent_tools(self):
        events = [
            {
                "role_type": "assistant",
                "message": {"content": [{"type": "tool_use", "name": "Read"}]},
            }
        ]
        self.assertEqual(minimal_sessions.extract_subagent_metadata_from_main_events(events), {})


class ReadSubagentMetaFileTests(unittest.TestCase):
    def test_missing_file_returns_none(self):
        self.assertIsNone(minimal_sessions.read_subagent_meta_file(Path("/does/not/exist.json")))

    def test_parses_agent_type_and_description(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"agentType": "Explore", "description": "Scan"}, f)
            path = Path(f.name)
        try:
            self.assertEqual(
                minimal_sessions.read_subagent_meta_file(path),
                {"agentType": "Explore", "description": "Scan"},
            )
        finally:
            path.unlink()

    def test_invalid_json_returns_none(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            f.write("not-json")
            path = Path(f.name)
        try:
            self.assertIsNone(minimal_sessions.read_subagent_meta_file(path))
        finally:
            path.unlink()


class BuildMainMinimalSessionTests(unittest.TestCase):
    def test_plain_user_and_assistant_messages(self):
        events = [
            {"role_type": "user", "message": {"content": "hi"}},
            {"role_type": "assistant", "message": {"content": [{"type": "text", "text": "hello"}]}},
        ]
        session = minimal_sessions.build_main_minimal_session("sess1", events, {})
        self.assertEqual(session["conversation_id"], "sess1")
        self.assertEqual(session["agent_type"], "main")
        self.assertEqual(len(session["messages"]), 2)
        self.assertEqual(session["messages"][0], {"idx": 0, "role": "user", "content": "hi"})
        self.assertEqual(
            session["messages"][1],
            {"idx": 1, "role": "assistant", "content": "hello"},
        )

    def test_tool_use_produces_tool_calls(self):
        events = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "name": "Read", "input": {"path": "/x"}, "id": "t1"},
                    ]
                },
            },
            {
                "role_type": "tool",
                "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "file"}]},
            },
        ]
        session = minimal_sessions.build_main_minimal_session("s", events, {})
        self.assertEqual(session["messages"][0]["role"], "assistant")
        self.assertEqual(session["messages"][0]["tool_calls"][0]["name"], "Read")
        self.assertEqual(session["messages"][1]["role"], "tool_result")
        self.assertEqual(session["messages"][1]["content"], "file")

    def test_agent_invocation_becomes_sub_agent_invocation_message(self):
        events = [
            {
                "role_type": "assistant",
                "message": {
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "Agent",
                            "subagent_id": "abc",
                            "id": "agent-1",
                            "input": {"description": "do it", "prompt": "go"},
                            "output": "result",
                        }
                    ]
                },
            },
            # Tool result for the agent should be skipped
            {
                "role_type": "tool",
                "message": {"content": [{"type": "tool_result", "tool_use_id": "agent-1", "content": "ignored"}]},
            },
        ]
        meta = {"abc": {"agentType": "Explore", "description": "do it"}}
        session = minimal_sessions.build_main_minimal_session("s", events, meta)
        # Only the sub_agent_invocation message should remain
        self.assertEqual(len(session["messages"]), 1)
        msg = session["messages"][0]
        self.assertEqual(msg["role"], "sub_agent_invocation")
        self.assertEqual(msg["agent_type"], "Explore")
        self.assertEqual(msg["conversation_id"], "abc")
        self.assertEqual(msg["description"], "do it")
        self.assertEqual(msg["prompt"], "go")
        self.assertEqual(msg["output_summary"], "result")
        self.assertEqual(msg["idx"], 0)

    def test_empty_content_is_skipped(self):
        events = [{"role_type": "user", "message": {"content": ""}}]
        session = minimal_sessions.build_main_minimal_session("s", events, {})
        self.assertEqual(session["messages"], [])


class BuildSubagentMinimalSessionTests(unittest.TestCase):
    def test_builds_messages(self):
        events = [
            {"role_type": "user", "message": {"content": "go"}},
            {
                "role_type": "assistant",
                "message": {"content": [{"type": "text", "text": "done"}]},
            },
        ]
        session = minimal_sessions.build_subagent_minimal_session("abc", "Explore", events)
        self.assertEqual(session["conversation_id"], "abc")
        self.assertEqual(session["agent_type"], "Explore")
        self.assertEqual(len(session["messages"]), 2)


class CreateSessionFilesTests(unittest.TestCase):
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

    def test_creates_main_session_for_simple_conversation(self):
        proj = self.projects_root / "proj"
        write_jsonl(proj / "abc.jsonl", [
            {"type": "user", "cwd": "/tmp", "message": {"role": "user", "content": "hi"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}},
        ])
        manifest = minimal_sessions.create_session_files("abc")
        self.assertEqual(manifest["session_id"], "abc")
        self.assertEqual(manifest["subagent_count"], 0)
        main_path = Path(manifest["main_session_path"])
        self.assertTrue(main_path.exists())
        main_data = json.loads(main_path.read_text())
        self.assertEqual(main_data["agent_type"], "main")
        self.assertEqual(len(main_data["messages"]), 2)

    def test_creates_subagent_session_and_group(self):
        proj = self.projects_root / "proj"
        # Main invokes agent "deadbeef"
        write_jsonl(proj / "sess.jsonl", [
            {"type": "user", "cwd": "/tmp", "message": {"role": "user", "content": "start"}},
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "t1",
                            "name": "Agent",
                            "input": {"agentType": "Explore", "description": "look"},
                        }
                    ],
                },
            },
            {
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "agentId: deadbeef"}],
                },
            },
        ])
        # Subagent file
        write_jsonl(proj / "sess" / "subagents" / "agent-deadbeef.jsonl", [
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "scanned"}]}}
        ])
        manifest = minimal_sessions.create_session_files("sess")
        self.assertEqual(manifest["subagent_count"], 1)
        self.assertEqual(manifest["group_count"], 1)
        subagent_path = Path(manifest["subagents"][0]["session_path"])
        self.assertTrue(subagent_path.exists())
        sub_data = json.loads(subagent_path.read_text())
        self.assertEqual(sub_data["conversation_id"], "deadbeef")
        self.assertEqual(sub_data["agent_type"], "Explore")


if __name__ == "__main__":
    unittest.main()
