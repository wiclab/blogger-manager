"""Offline regression coverage of the Telegram delivery probe."""
import io
import json
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch

from scripts import indexing_health as health


class Response(io.BytesIO):
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return None


class TelegramConnectionTests(unittest.TestCase):
    def test_sendMessage_acknowledged_and_payload_minimal(self):
        observed = []
        def fake_open(req, timeout):
            observed.append((req, timeout))
            return Response(b'{"ok":true,"result":{"message_id":1}}')
        with patch.object(health.urllib.request, "urlopen", side_effect=fake_open):
            self.assertTrue(health.send_telegram(
                "별셈소 연결 테스트", "test-token", "123456"))
        self.assertEqual(len(observed), 1)
        request, timeout = observed[0]
        self.assertEqual(request.get_method(), "POST")
        self.assertIn("/sendMessage", request.full_url)
        self.assertEqual(timeout, 12)
        body = json.loads(request.data)
        self.assertEqual(body["chat_id"], "123456")
        self.assertEqual(body["text"], "별셈소 연결 테스트")
        self.assertTrue(body["disable_web_page_preview"])
        self.assertNotIn("api_key", body)

    def test_unacknowledged_message_is_not_reported_success(self):
        with patch.object(health.urllib.request, "urlopen",
                          return_value=Response(b'{"ok":false}')):
            self.assertFalse(health.send_telegram("probe", "token", "1"))

    def test_failure_is_not_retried_or_logged(self):
        err = urllib.error.HTTPError(
            "https://api.telegram.org/botsecret/sendMessage",
            403, "forbidden", {}, io.BytesIO(b'{"description":"secret"}'))
        with patch.object(health.urllib.request, "urlopen", side_effect=err) as attempted:
            self.assertFalse(health.send_telegram("test", "secret", "1"))
        attempted.assert_called_once()

    def test_smoke_workflow_does_not_run_in_pr_or_touch_bing(self):
        workflow = (Path(__file__).parents[1] /
                    ".github/workflows/telegram-connection-check.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("telegram-connection-check.yml", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("BING_API_KEY", workflow)
        self.assertNotIn("indexing_safe", workflow)
        self.assertIn("send_telegram(", workflow)


if __name__ == "__main__":
    unittest.main()
