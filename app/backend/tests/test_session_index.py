import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app.backend import config, session_index


def write_jsonl(path: Path, records: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as handle:
        for record in records:
            handle.write(json.dumps(record) + "\n")


class ValidationTests(unittest.TestCase):
    def test_valid_session_id_returns_itself(self):
        self.assertEqual(session_index.validate_session_id("abc_123"), "abc_123")

    def test_invalid_session_id_raises_400(self):
        with self.assertRaises(HTTPException) as ctx:
            session_index.validate_session_id("bad session")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_session_id_must_start_with_alnum(self):
        with self.assertRaises(HTTPException):
            session_index.validate_session_id(".leading-dot")

    def test_valid_agent_id(self):
        self.assertEqual(session_index.validate_agent_id("abc123def"), "abc123def")

    def test_uppercase_hex_rejected(self):
        with self.assertRaises(HTTPException):
            session_index.validate_agent_id("ABC123")


class IndexStateRoundTripTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.index_path = Path(self.tmpdir.name) / "session_index.json"
        self.patch = patch.object(config, "INDEX_STATE_PATH", self.index_path)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmpdir.cleanup()

    def test_load_missing_file_returns_defaults(self):
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], [])
        self.assertEqual(state["sessions"], {})
        self.assertIsNone(state["updated_at"])

    def test_save_and_load_round_trip(self):
        session_index.save_index_state({
            "recent_session_ids": ["a", "b"],
            "sessions": {"a": {"id": "a"}},
        })
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], ["a", "b"])
        self.assertEqual(state["sessions"], {"a": {"id": "a"}})
        self.assertIsNotNone(state["updated_at"])

    def test_bad_json_falls_back_to_defaults(self):
        self.index_path.write_text("not-json{")
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], [])
        self.assertEqual(state["sessions"], {})

    def test_non_dict_json_falls_back_to_defaults(self):
        self.index_path.write_text("[1, 2, 3]")
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], [])

    def test_non_string_recent_ids_are_dropped(self):
        self.index_path.write_text(json.dumps({
            "recent_session_ids": ["good", 5, None],
            "sessions": {},
        }))
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], ["good"])


class ExtractRenamedSessionTitleTests(unittest.TestCase):
    def test_custom_title_event(self):
        self.assertEqual(
            session_index.extract_renamed_session_title({"type": "custom-title", "customTitle": "X"}),
            "X",
        )

    def test_rename_event_prefers_custom_title(self):
        data = {"type": "rename", "title": "T", "customTitle": "C"}
        self.assertEqual(session_index.extract_renamed_session_title(data), "C")

    def test_rename_event_falls_back_to_title(self):
        data = {"type": "rename", "title": "T"}
        self.assertEqual(session_index.extract_renamed_session_title(data), "T")

    def test_rename_payload_nested(self):
        data = {"rename": {"name": "Nested"}}
        self.assertEqual(session_index.extract_renamed_session_title(data), "Nested")

    def test_unknown_event_returns_none(self):
        self.assertIsNone(session_index.extract_renamed_session_title({"type": "other"}))


class ExtractSessionMetadataTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.session_file = Path(self.tmpdir.name) / "abc123.jsonl"

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_reads_cwd_and_slug_and_custom_title(self):
        write_jsonl(self.session_file, [
            {"type": "meta", "cwd": "/work/here", "slug": "my-slug"},
            {"type": "custom-title", "customTitle": "Nice Title"},
        ])
        meta = session_index.extract_session_metadata(self.session_file)
        self.assertEqual(meta["cwd"], "/work/here")
        self.assertEqual(meta["slug"], "my-slug")
        self.assertEqual(meta["name"], "Nice Title")
        self.assertEqual(meta["title"], "Nice Title")

    def test_title_falls_back_to_slug_then_filename(self):
        write_jsonl(self.session_file, [{"slug": "only-slug"}])
        meta = session_index.extract_session_metadata(self.session_file)
        self.assertEqual(meta["title"], "only-slug")
        self.assertIsNone(meta["name"])

    def test_empty_file_returns_filename_title(self):
        self.session_file.write_text("")
        meta = session_index.extract_session_metadata(self.session_file)
        self.assertEqual(meta["title"], "abc123")
        self.assertIsNone(meta["slug"])
        self.assertIsNone(meta["name"])


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.projects_root = Path(self.tmpdir.name) / "projects"
        self.index_path = Path(self.tmpdir.name) / "session_index.json"
        self.patches = [
            patch.object(config, "CLAUDE_PROJECTS_ROOT", self.projects_root),
            patch.object(config, "INDEX_STATE_PATH", self.index_path),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmpdir.cleanup()

    def test_missing_projects_root_returns_empty(self):
        self.assertEqual(session_index.discover_sessions(), [])

    def test_discovers_sessions_sorted_by_mtime_desc(self):
        proj_a = self.projects_root / "project-a"
        sess1 = proj_a / "session1.jsonl"
        sess2 = proj_a / "session2.jsonl"
        write_jsonl(sess1, [{"cwd": "/tmp/a"}])
        write_jsonl(sess2, [{"cwd": "/tmp/a"}])

        import os
        os.utime(sess1, (1000, 1000))
        os.utime(sess2, (2000, 2000))

        discovered = session_index.discover_sessions()
        ids = [s["id"] for s in discovered]
        self.assertEqual(ids, ["session2", "session1"])
        self.assertEqual(discovered[0]["project_name"], "/tmp/a")
        self.assertEqual(discovered[0]["project_short_name"], "a")

    def test_skips_invalid_session_ids(self):
        proj = self.projects_root / "p"
        write_jsonl(proj / "bad session.jsonl", [{"cwd": "/tmp"}])
        self.assertEqual(session_index.discover_sessions(), [])

    def test_build_payload_returns_recent_and_projects(self):
        proj = self.projects_root / "proj"
        sess = proj / "abc.jsonl"
        write_jsonl(sess, [{"cwd": "/cwd/x", "slug": "slug-x"}])
        payload = session_index.build_sessions_payload()
        self.assertEqual(len(payload["projects"]), 1)
        self.assertEqual(payload["projects"][0]["name"], "/cwd/x")
        self.assertEqual(payload["recent_sessions"], [])

    def test_build_payload_filters_by_search(self):
        proj = self.projects_root / "proj"
        write_jsonl(proj / "abc.jsonl", [{"cwd": "/cwd/x", "slug": "apple"}])
        write_jsonl(proj / "def.jsonl", [{"cwd": "/cwd/x", "slug": "banana"}])
        payload = session_index.build_sessions_payload(search="apple")
        all_ids = [s["id"] for p in payload["projects"] for s in p["sessions"]]
        self.assertEqual(all_ids, ["abc"])


class RecentSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.index_path = Path(self.tmpdir.name) / "session_index.json"
        self.patch = patch.object(config, "INDEX_STATE_PATH", self.index_path)
        self.patch.start()

    def tearDown(self):
        self.patch.stop()
        self.tmpdir.cleanup()

    def test_mark_recent_inserts_at_front(self):
        session_index.mark_recent_session("a")
        session_index.mark_recent_session("b")
        session_index.mark_recent_session("a")  # moves a to front
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], ["a", "b"])

    def test_mark_recent_caps_at_max(self):
        with patch.object(config, "MAX_RECENT_SESSIONS", 3):
            for sid in ["a", "b", "c", "d"]:
                session_index.mark_recent_session(sid)
            state = session_index.load_index_state()
            self.assertEqual(state["recent_session_ids"], ["d", "c", "b"])

    def test_remove_recent(self):
        session_index.mark_recent_session("a")
        session_index.mark_recent_session("b")
        session_index.remove_recent_session("a")
        state = session_index.load_index_state()
        self.assertEqual(state["recent_session_ids"], ["b"])


class SessionRecordLookupTests(unittest.TestCase):
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

    def test_unknown_session_raises_404(self):
        with self.assertRaises(HTTPException) as ctx:
            session_index.get_session_record("nope")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_known_session_resolves(self):
        proj = self.projects_root / "proj"
        sess = proj / "abc.jsonl"
        write_jsonl(sess, [{"cwd": "/cwd"}])
        record = session_index.get_session_record("abc")
        self.assertEqual(record["id"], "abc")
        self.assertTrue(record["session_file_path"].endswith("abc.jsonl"))

    def test_resolve_generated_session_dir(self):
        path = session_index.resolve_generated_session_dir("abc_123")
        self.assertEqual(path, self.generated / "abc_123")


if __name__ == "__main__":
    unittest.main()
