import unittest

from app.backend.text_utils import (
    estimate_tokens,
    first_word,
    get_content_text,
    get_tool_result_parts,
    get_tool_use_parts,
    normalize_generated_text,
    sanitize_bucket_component,
    sanitize_markup_text,
    sanitize_payload,
)


class EstimateTokensTests(unittest.TestCase):
    def test_empty_string_is_zero(self):
        self.assertEqual(estimate_tokens(""), 0)

    def test_short_string_rounds_down(self):
        self.assertEqual(estimate_tokens("abc"), 0)
        self.assertEqual(estimate_tokens("abcd"), 1)
        self.assertEqual(estimate_tokens("abcdefg"), 1)
        self.assertEqual(estimate_tokens("abcdefgh"), 2)


class SanitizeMarkupTextTests(unittest.TestCase):
    def test_strips_local_command_caveat(self):
        text = "before<local-command-caveat>drop me</local-command-caveat>after"
        self.assertEqual(sanitize_markup_text(text), "beforeafter")

    def test_strips_task_notification_and_command_name(self):
        text = "a<task-notification>x</task-notification>b<command-name>y</command-name>c"
        self.assertEqual(sanitize_markup_text(text), "abc")

    def test_strips_local_command_stdout(self):
        text = "<local-command-stdout>ignored</local-command-stdout>tail"
        self.assertEqual(sanitize_markup_text(text), "tail")

    def test_is_case_insensitive(self):
        text = "<LOCAL-COMMAND-CAVEAT>drop</LOCAL-COMMAND-CAVEAT>"
        self.assertEqual(sanitize_markup_text(text), "")


class SanitizePayloadTests(unittest.TestCase):
    def test_recursively_sanitizes_dicts_and_lists(self):
        payload = {
            "a": "keep<command-name>drop</command-name>",
            "b": ["<task-notification>x</task-notification>z", 5],
            "c": 42,
        }
        expected = {"a": "keep", "b": ["z", 5], "c": 42}
        self.assertEqual(sanitize_payload(payload), expected)

    def test_non_collection_is_returned_as_is(self):
        self.assertEqual(sanitize_payload(42), 42)
        self.assertIsNone(sanitize_payload(None))


class GetContentTextTests(unittest.TestCase):
    def test_string_content_is_sanitized(self):
        self.assertEqual(get_content_text("a<command-name>b</command-name>c"), "ac")

    def test_list_concatenates_parts(self):
        self.assertEqual(get_content_text(["hello ", "world"]), "hello world")

    def test_dict_with_text_key(self):
        self.assertEqual(get_content_text({"text": "hi"}), "hi")

    def test_dict_with_content_key_recurses(self):
        self.assertEqual(get_content_text({"content": [{"text": "hi"}]}), "hi")

    def test_dict_without_text_or_content_falls_back_to_str(self):
        self.assertEqual(get_content_text({"foo": "bar"}), "{'foo': 'bar'}")


class NormalizeGeneratedTextTests(unittest.TestCase):
    def test_strips_whitespace(self):
        self.assertEqual(normalize_generated_text("  hi  "), "hi")

    def test_empty_braces_are_treated_as_empty(self):
        self.assertEqual(normalize_generated_text("{}"), "")
        self.assertEqual(normalize_generated_text("  {}  "), "")


class SanitizeBucketComponentTests(unittest.TestCase):
    def test_replaces_forbidden_chars(self):
        self.assertEqual(sanitize_bucket_component("hello world!"), "hello-world")

    def test_collapses_repeated_dashes(self):
        self.assertEqual(sanitize_bucket_component("a   b"), "a-b")

    def test_empty_input_returns_unknown(self):
        self.assertEqual(sanitize_bucket_component(""), "unknown")
        self.assertEqual(sanitize_bucket_component("!@#$"), "unknown")


class FirstWordTests(unittest.TestCase):
    def test_returns_first_matching_word(self):
        self.assertEqual(first_word("  hello world"), "hello")

    def test_empty_input_returns_unknown(self):
        self.assertEqual(first_word(""), "unknown")
        self.assertEqual(first_word("!!!"), "unknown")


class GetToolUsePartsTests(unittest.TestCase):
    def test_returns_only_tool_use_parts(self):
        message = {
            "content": [
                {"type": "text", "text": "hi"},
                {"type": "tool_use", "name": "Read", "input": {}},
                {"type": "tool_use", "name": "Bash", "input": {}},
            ]
        }
        parts = get_tool_use_parts(message)
        self.assertEqual([p["name"] for p in parts], ["Read", "Bash"])

    def test_non_dict_message_returns_empty(self):
        self.assertEqual(get_tool_use_parts(None), [])
        self.assertEqual(get_tool_use_parts("hi"), [])


class GetToolResultPartsTests(unittest.TestCase):
    def test_extracts_tool_results_with_id(self):
        event = {
            "message": {
                "content": [
                    {"type": "tool_result", "tool_use_id": "abc", "content": "ok"},
                    {"type": "tool_result", "tool_use_id": "def", "content": [{"text": "val"}]},
                ]
            }
        }
        self.assertEqual(
            get_tool_result_parts(event),
            [("abc", "ok"), ("def", "val")],
        )

    def test_fallback_to_content_text_when_no_tool_results(self):
        event = {"message": {"content": "plain"}}
        self.assertEqual(get_tool_result_parts(event), [(None, "plain")])

    def test_empty_on_missing_message(self):
        self.assertEqual(get_tool_result_parts({}), [])


if __name__ == "__main__":
    unittest.main()
