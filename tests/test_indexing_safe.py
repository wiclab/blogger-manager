"""Offline safety tests for durable Bing pre-POST intent and crash recovery."""
import datetime as dt
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import indexing as core
from scripts import indexing_safe as safe

SITE_POST = "https://wic12.blogspot.com/2026/11/critical.html"
SAVED_POST = "https://wic12.blogspot.com/2026/08/saved.html"
FINGERPRINT = "2026-11-02T00:00:00Z"


class ProtectedIndexingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.state = root / "indexing-state.json"
        self.plan = root / "indexing-plan.json"
        self.report = root / "indexing-report.json"
        self.dashboard = root / "indexing-dashboard.json"
        self.failure = root / "indexing-failure.json"
        original = {"version": 1, "google": {}, "bing": {
            SAVED_POST: {"fingerprint": "old", "submitted_at": "2026-11-01T00:00:00Z"}}}
        self.state.write_text(json.dumps(original), encoding="utf-8")
        self.patches = [
            patch.object(core, "STATE_PATH", self.state),
            patch.object(core, "REPORT_PATH", self.report),
            patch.object(core, "DASHBOARD_PATH", self.dashboard),
            patch.object(core, "FAILURE_PATH", self.failure),
            patch.object(safe, "PLAN_PATH", self.plan),
            patch.object(safe, "snapshot_posts", return_value={
                SAVED_POST: "old", SITE_POST: FINGERPRINT}),
            patch.object(safe, "quota_and_site", return_value=(core.SITE, 25, 1000)),
            patch.dict(os.environ, {"BING_API_KEY": "fake-secret"}, clear=False),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def test_prepare_writes_hold_before_any_post_and_preserves_receipt(self):
        with patch.object(core, "request") as post:
            plan = safe.prepare()
            post.assert_not_called()
        self.assertEqual(plan["action"], "submit")
        after = core.load_state()
        self.assertIn(SAVED_POST, after["bing"])
        self.assertNotIn(SITE_POST, after["bing"])
        self.assertEqual(len(after["held_batches"]), 1)
        self.assertEqual(after["held_batches"][plan["batch_id"]]["entries"][0]["url"], SITE_POST)
        self.assertTrue(self.state.with_name("indexing-state.backup.json").is_file())
        self.assertEqual(json.loads(self.dashboard.read_text())["bing_submission"]["blocked_uncertain_count"], 1)

    def test_submit_requires_successfully_committed_intent(self):
        safe.prepare()
        with patch.dict(os.environ, {"INDEXING_RESERVATION_COMMITTED": ""}):
            with patch.object(core, "request") as request:
                with self.assertRaisesRegex(RuntimeError, "confirmation missing"):
                    safe.submit()
                request.assert_not_called()

    def test_uncertain_post_blocks_future_runs_without_replay(self):
        plan = safe.prepare()
        with patch.dict(os.environ, {"INDEXING_RESERVATION_COMMITTED": "true"}):
            with patch.object(core, "request", side_effect=RuntimeError("network lost")) as request:
                with self.assertRaises(core.SubmissionOutcomeUnknown):
                    safe.submit()
                request.assert_called_once()
        persisted = core.load_state()
        self.assertIn(plan["batch_id"], persisted["held_batches"])
        self.assertNotIn(SITE_POST, persisted["bing"])
        with patch.object(safe, "quota_and_site") as quota, patch.object(core, "request") as req:
            again = safe.prepare()
        self.assertEqual(again["action"], "none")
        quota.assert_not_called()
        req.assert_not_called()
        self.assertEqual(core.load_state()["held_batches"], persisted["held_batches"])

    def test_successful_post_clears_hold_only_after_verified_ack(self):
        plan = safe.prepare()
        with patch.dict(os.environ, {"INDEXING_RESERVATION_COMMITTED": "true"}):
            with patch.object(core, "request", return_value=(200, b'{"d":null}')) as request:
                report = safe.submit()
                request.assert_called_once()
        self.assertEqual(report["bing_submitted"], [SITE_POST])
        after = core.load_state()
        self.assertEqual(after["held_batches"], {})
        self.assertEqual(after["bing"][SITE_POST]["fingerprint"], FINGERPRINT)
        self.assertIn(SAVED_POST, after["bing"])
        self.assertEqual(json.loads(self.dashboard.read_text())["bing_submission"]["blocked_uncertain_count"], 0)

    def test_unknown_response_never_counts_submission(self):
        plan = safe.prepare()
        with patch.dict(os.environ, {"INDEXING_RESERVATION_COMMITTED": "true"}):
            with patch.object(core, "request", return_value=(200, b'{"d":{"unexpected":true}}')):
                with self.assertRaises(core.SubmissionOutcomeUnknown):
                    safe.submit()
        self.assertIn(plan["batch_id"], core.load_state()["held_batches"])
        self.assertNotIn(SITE_POST, core.load_state()["bing"])

    def test_zero_quota_never_creates_hold_or_post(self):
        with patch.object(safe, "quota_and_site", return_value=(core.SITE, 0, 1000)), \
             patch.object(core, "request") as req:
            plan = safe.prepare()
            req.assert_not_called()
        self.assertEqual(plan["action"], "none")
        self.assertEqual(core.load_state().get("held_batches", {}), {})
        self.assertEqual(len(core.load_state()["bing"]), 1)
        self.assertEqual(json.loads(self.dashboard.read_text())["bing_submission"]["pending_count"], 1)

    def test_invalid_hold_refuses_new_requests(self):
        self.state.write_text(json.dumps({"version": 1, "google": {}, "bing": {},
            "held_batches": {"bad-id": {"status": "held", "entries": []}}}))
        with patch.object(safe, "quota_and_site") as quota:
            with self.assertRaisesRegex(ValueError, "held batch"):
                safe.prepare()
            quota.assert_not_called()

    def test_mixed_pending_reservation_cannot_skip_previously_held(self):
        old = json.loads(self.state.read_text())
        old["held_batches"] = {"a" * 32: {"prepared_at": "2026-11-01T23:00:00Z",
            "status": "held", "entries": [{"url": SITE_POST, "fingerprint": "older"}]}}
        self.state.write_text(json.dumps(old))
        with patch.object(safe, "quota_and_site") as quota:
            result = safe.prepare()
            quota.assert_not_called()
        self.assertEqual(result["action"], "none")
        self.assertEqual(len(core.load_state()["held_batches"]), 1)


if __name__ == "__main__":
    unittest.main()
