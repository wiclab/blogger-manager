import datetime as dt
import importlib.util
from pathlib import Path
import unittest

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
if __name__=="__main__":
    unittest.main()
