import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.backend import analysis, config


class AnalysisStatusTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.generated = Path(self.tmpdir.name) / "generated"
        self.patch = patch.object(config, "GENERATED_SESSIONS_ROOT", self.generated)
        self.patch.start()
        analysis._analysis_status.clear()

    def tearDown(self):
        self.patch.stop()
        self.tmpdir.cleanup()

    def test_default_status_is_not_started(self):
        self.assertEqual(analysis.get_analysis_status("abc"), "Not started")

    def test_set_then_get_returns_memory_value(self):
        analysis.set_analysis_status("abc", "Running")
        self.assertEqual(analysis.get_analysis_status("abc"), "Running")

    def test_status_is_persisted_to_disk(self):
        analysis.set_analysis_status("abc", "Completed")
        analysis._analysis_status.clear()  # simulate restart
        self.assertEqual(analysis.get_analysis_status("abc"), "Completed")

    def test_persisted_status_written_as_json(self):
        analysis.set_analysis_status("abc", "Error: boom")
        status_path = self.generated / "abc" / "analysis_status.json"
        self.assertTrue(status_path.exists())
        self.assertEqual(json.loads(status_path.read_text()), {"status": "Error: boom"})


class EstimateMessageTokensTests(unittest.TestCase):
    def test_user_message_counts_content(self):
        message = {"role": "user", "content": "abcd" * 10}
        self.assertEqual(analysis.estimate_message_tokens(message), 10)

    def test_assistant_message_with_tool_calls(self):
        message = {
            "role": "assistant",
            "content": "abcd" * 5,  # 5 tokens
            "tool_calls": [{"name": "Read", "input": "abcd" * 3}],
        }
        # content=5, input=3 tokens (12 chars / 4), name=1 token (4 chars / 4)
        self.assertEqual(analysis.estimate_message_tokens(message), 5 + 3 + 1)

    def test_sub_agent_invocation_message(self):
        message = {
            "role": "sub_agent_invocation",
            "input": "abcd" * 2,
            "output_summary": "abcd" * 3,
            "agent_type": "abcd",
        }
        self.assertEqual(analysis.estimate_message_tokens(message), 2 + 3 + 1)

    def test_unknown_role_returns_zero(self):
        self.assertEqual(analysis.estimate_message_tokens({"role": "other", "content": "abcd" * 10}), 0)


class TokenIndexTests(unittest.TestCase):
    def test_build_token_index_for_session_maps_idx_to_tokens(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({
                "messages": [
                    {"idx": 0, "role": "user", "content": "abcd" * 4},  # 4 tokens
                    {"idx": 1, "role": "assistant", "content": "abcd" * 2},  # 2 tokens
                ]
            }, f)
            path = Path(f.name)
        try:
            token_index = analysis.build_token_index_for_session(path)
            self.assertEqual(token_index, {0: 4, 1: 2})
        finally:
            path.unlink()

    def test_token_sum_for_ranges(self):
        token_index = {0: 10, 1: 20, 2: 30, 3: 40}
        self.assertEqual(analysis.token_sum_for_ranges(token_index, [(1, 2)]), 50)
        self.assertEqual(analysis.token_sum_for_ranges(token_index, [(0, 3)]), 100)
        self.assertEqual(analysis.token_sum_for_ranges(token_index, [(2, 1)]), 50)  # swapped OK

    def test_token_sum_deduplicates_overlapping_ranges(self):
        token_index = {0: 1, 1: 1, 2: 1}
        self.assertEqual(analysis.token_sum_for_ranges(token_index, [(0, 1), (1, 2)]), 3)


class AddTokenEstimationToConversationAnalysisTests(unittest.TestCase):
    def test_adds_save_estimate_to_suggestions(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            session_path = tmp / "s.json"
            analysis_path = tmp / "a.json"
            session_path.write_text(json.dumps({
                "messages": [
                    {"idx": 0, "role": "user", "content": "abcd" * 4},  # 4 tokens
                    {"idx": 1, "role": "user", "content": "abcd" * 2},  # 2 tokens
                    {"idx": 2, "role": "user", "content": "abcd" * 5},  # 5 tokens
                ]
            }))
            analysis_path.write_text(json.dumps({
                "frames": [{
                    "friction_points": [
                        {"id": "F1", "message_range": [0, 1]},
                        {"id": "F2", "message_range": [2, 2]},
                    ]
                }],
                "suggestions": [
                    {"id": "S1", "addresses": ["F1"]},
                    {"id": "S2", "addresses": ["F1", "F2"]},
                    {"id": "S3", "addresses": []},
                    {"id": "S4", "addresses": ["missing-id"]},
                ],
            }))
            analysis.add_token_estimation_to_conversation_analysis(analysis_path, session_path)
            result = json.loads(analysis_path.read_text())
            saves = {s["id"]: s["token_estimation_save"] for s in result["suggestions"]}
            self.assertEqual(saves["S1"], 4 + 2)
            self.assertEqual(saves["S2"], 4 + 2 + 5)
            self.assertEqual(saves["S3"], 0)
            self.assertEqual(saves["S4"], 0)

    def test_no_op_when_files_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            # No files written — should not raise
            analysis.add_token_estimation_to_conversation_analysis(
                tmp / "missing.json", tmp / "also-missing.json",
            )


class AddTokenEstimationToSubagentAnalysisTests(unittest.TestCase):
    def test_sums_across_conversations(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            sess_a = tmp / "a.json"
            sess_b = tmp / "b.json"
            analysis_path = tmp / "an.json"
            sess_a.write_text(json.dumps({
                "conversation_id": "cid-a",
                "messages": [{"idx": 0, "role": "user", "content": "abcd" * 5}],  # 5
            }))
            sess_b.write_text(json.dumps({
                "conversation_id": "cid-b",
                "messages": [{"idx": 3, "role": "user", "content": "abcd" * 3}],  # 3
            }))
            analysis_path.write_text(json.dumps({
                "shared_preamble_actions": [
                    {
                        "id": "A1",
                        "appeared_in": [
                            {"conversation_id": "cid-a", "message_range": [0, 0]},
                            {"conversation_id": "cid-b", "message_range": [3, 3]},
                        ],
                    }
                ],
                "suggestions": [{"id": "S1", "addresses": ["A1"]}],
            }))
            analysis.add_token_estimation_to_subagent_analysis(analysis_path, [sess_a, sess_b])
            result = json.loads(analysis_path.read_text())
            self.assertEqual(result["suggestions"][0]["token_estimation_save"], 5 + 3)


if __name__ == "__main__":
    unittest.main()
