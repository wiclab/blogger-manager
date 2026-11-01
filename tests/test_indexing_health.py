import datetime as dt
import importlib.util
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("indexing_health",Path(__file__).parents[1]/"scripts/indexing_health.py")
health=importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)
AT=dt.datetime(2026,11,1,14,tzinfo=dt.timezone.utc)

class IndexingHealthTests(unittest.TestCase):
    def test_healthy_schedule_and_dashboard(self):
        r=health.assess([{"event":"schedule","conclusion":"success","created_at":"2026-11-01T12:37:00Z"}],
                        {"site":health.SITE,"updated_at":"2026-11-01T13:30:00Z"},AT)
        self.assertEqual(r["status"],"ok")
    def test_push_only_not_accepted_as_schedule(self):
        r=health.assess([{"event":"push","conclusion":"success","created_at":"2026-11-01T13:00:00Z"}],
                        {"site":health.SITE,"updated_at":"2026-11-01T13:30:00Z"},AT)
        self.assertEqual(r["status"],"warning")
        self.assertTrue(any("예약 실행" in x for x in r["issues"]))
    def test_missing_dashboard_is_warning(self):
        r=health.assess([{"event":"schedule","conclusion":"success","created_at":"2026-11-01T12:37:00Z"}],{},AT)
        self.assertEqual(r["status"],"warning")
    def test_failed_schedule_warns(self):
        r=health.assess([{"event":"schedule","conclusion":"failure","created_at":"2026-11-01T12:37:00Z"}],
                        {"site":health.SITE,"updated_at":"2026-11-01T13:30:00Z"},AT)
        self.assertEqual(r["status"],"warning")
        self.assertTrue(any("정상 완료" in x for x in r["issues"]))
    def test_wrong_blog_fails_closed(self):
        with self.assertRaises(ValueError):
            health.assess([],{"site":"https://ggpong.blogspot.com/"},AT)
    def test_durable_hold_requires_reconciliation_and_sends_alert(self):
        runs = [{"event":"schedule","conclusion":"success",
                 "created_at":"2026-11-01T12:37:00Z"}]
        dashboard = {"site": health.SITE, "updated_at":"2026-11-01T13:30:00Z",
                     "bing_submission":{"held_batches_count":1}}
        result = health.assess(runs, dashboard, AT)
        self.assertEqual(result["status"], "warning")
        self.assertIn("submission_held", result["issue_codes"])
        state = {"version":1,"active_signature":None,"last_sent_at":None}
        kind, message = health.plan_notification(result, state, AT)
        self.assertEqual(kind, "warning")
        self.assertIn("미확정", message)

    def test_bing_quota_zero_is_a_healthy_success(self):
        at = AT
        r = health.assess([{"event": "schedule", "conclusion": "success",
                            "created_at": "2026-11-01T12:37:00Z"}],
                          {"site": health.SITE, "updated_at": "2026-11-01T13:30:00Z",
                           "bing_submission": {"state": "quota_exhausted"}}, at)
        self.assertEqual(r["status"], "ok")
        self.assertEqual(r["issue_codes"], [])
        self.assertEqual(r["consecutive_schedule_failures"], 0)

    def test_only_repeated_failures_trigger_failure_code(self):
        runs = [{"event": "schedule", "conclusion": "failure", "id": 5,
                 "created_at": "2026-11-01T13:37:00Z"},
                {"event": "schedule", "conclusion": "failure", "id": 4,
                 "created_at": "2026-11-01T12:37:00Z"},
                {"event": "schedule", "conclusion": "success", "id": 3,
                 "created_at": "2026-11-01T11:37:00Z"}]
        dashboard = {"site": health.SITE, "updated_at": "2026-11-01T13:45:00Z"}
        r = health.assess(runs, dashboard, AT, failure_kind="bing_execution")
        self.assertEqual(r["status"], "warning")
        self.assertEqual(r["consecutive_schedule_failures"], 2)
        self.assertEqual(r["failure_category"], "bing_execution")
        self.assertIn("repeated_failure", r["issue_codes"])
        self.assertNotIn("schedule_stale", r["issue_codes"])
        single = health.assess(runs[1:], dashboard, AT)
        self.assertEqual(single["consecutive_schedule_failures"], 1)
        self.assertNotIn("repeated_failure", single["issue_codes"])

    def test_failed_step_maps_to_safe_failure_categories(self):
        mapping = [
            ("Validate code without external API requests", "code_validation"),
            ("Check saved indexing receipts without external API calls", "state_integrity"),
            ("Submit changed Byeolsemso posts to Bing", "bing_execution"),
            ("Persist protected state to indexing-data (not main)", "state_persistence"),
            ("Check Bing API configuration", "configuration"),
        ]
        for label, expected in mapping:
            with self.subTest(label=label):
                self.assertEqual(health.failing_step_category(
                    [{"steps": [{"name": label, "conclusion": "failure"}]}]), expected)

    def test_alert_deduplication_recovery_and_cooldown(self):
        state = {"version": 1, "active_signature": None, "last_sent_at": None}
        alert = {"status": "warning", "issue_codes": ["repeated_failure"],
                 "failure_category": "state_integrity"}
        kind, msg = health.plan_notification(alert, state, AT)
        self.assertEqual(kind, "warning")
        self.assertIn("제출 기록", msg)
        self.assertNotIn("secret", msg)
        active = {"version": 1, "active_signature": "repeated_failure",
                  "last_sent_at": "2026-11-01T13:55:00Z"}
        self.assertEqual(health.plan_notification(alert, active, AT), (None, None))
        later = AT + dt.timedelta(hours=25)
        self.assertEqual(health.plan_notification(alert, active, later)[0], "warning")
        self.assertEqual(health.plan_notification(
            {"status": "ok", "issue_codes": []}, active, AT)[0], "recovered")
        self.assertEqual(health.plan_notification(
            {"status": "ok", "issue_codes": []}, state, AT), (None, None))

    def test_alert_records_sent_state_once_and_never_replays_on_same_run(self):
        alert = {"status": "warning", "issue_codes": ["repeated_failure"],
                 "failure_category": "code_validation"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "alert.json"
            path.write_text(json.dumps(
                {"version": 1, "active_signature": None, "last_sent_at": None}))
            with patch.object(health, "ALERT_STATE_PATH", path), \
                 patch.dict(health.os.environ, {"TELEGRAM_BOT_TOKEN": "test-secret",
                                               "TELEGRAM_CHAT_ID": "test-chat"}), \
                 patch.object(health, "send_telegram", return_value=True) as send:
                self.assertEqual(health.alert_if_needed(alert, AT), "sent_warning")
                self.assertEqual(health.alert_if_needed(alert, AT), "suppressed")
                self.assertEqual(send.call_count, 1)
                current = json.loads(path.read_text())
                self.assertEqual(current["active_signature"], "repeated_failure")

    def test_failed_telegram_does_not_consume_deduplication_state(self):
        alert = {"status": "warning", "issue_codes": ["repeated_failure"]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "alert.json"
            original = {"version": 1, "active_signature": None, "last_sent_at": None}
            path.write_text(json.dumps(original))
            with patch.object(health, "ALERT_STATE_PATH", path), \
                 patch.dict(health.os.environ, {"TELEGRAM_BOT_TOKEN": "test-secret",
                                               "TELEGRAM_CHAT_ID": "test-chat"}), \
                 patch.object(health, "send_telegram", return_value=False):
                self.assertEqual(health.alert_if_needed(alert, AT), "send_failed")
            self.assertEqual(json.loads(path.read_text()), original)

    def test_missing_alert_state_never_sends_duplicate(self):
        alert = {"status": "warning", "issue_codes": ["repeated_failure"]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.json"
            with patch.object(health, "ALERT_STATE_PATH", path), \
                 patch.object(health, "send_telegram") as send:
                with self.assertRaises(FileNotFoundError):
                    health.alert_if_needed(alert, AT)
                send.assert_not_called()

    def test_stale_dashboard_generates_one_actionable_code(self):
        r = health.assess([{"event": "schedule", "conclusion": "success",
                            "created_at": "2026-11-01T12:37:00Z"}],
                          {"site": health.SITE, "updated_at": "2026-11-01T00:00:00Z"}, AT)
        self.assertIn("dashboard_stale", r["issue_codes"])
        self.assertEqual(r["status"], "warning")

if __name__=="__main__":
    unittest.main()
