import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "seo_pulse", Path(__file__).parents[1] / "scripts/seo_pulse.py")
seo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seo)


class SeoPulseTests(unittest.TestCase):
    def test_urls_must_belong_only_to_byeolsemso(self):
        self.assertEqual(
            seo.canonical("http://wic12.blogspot.com/2026/11/test.html?m=1"),
            "https://wic12.blogspot.com/2026/11/test.html")
        self.assertIsNone(seo.canonical("https://ggpong.blogspot.com/2026/11/test.html"))
        self.assertIsNone(seo.canonical("https://qevnaxori.blogspot.com/2026/11/test.html"))
        self.assertIsNone(seo.canonical("https://wic12.blogspot.com/search/label/game"))

    def test_bing_weekly_timestamp(self):
        self.assertEqual(seo.ms_date("/Date(1793491200000-0700)/"), dt.date(2026, 11, 1))
        self.assertIsNone(seo.ms_date("2026-11-01"))

    def test_bing_only_publishes_aggregate_and_public_page_links(self):
        ref = dt.date(2026, 11, 1)
        day = "/Date(1793491200000-0700)/"
        def api(method, site, key):
            if method == "GetRankAndTrafficStats":
                return [{"Date": day, "Clicks": 2, "Impressions": 100}]
            if method == "GetQueryStats":
                return [{"Date": day, "Query": "PRIVATE EXACT SEARCH PHRASE",
                         "Clicks": 0, "Impressions": 500}]
            return [
                {"Date": day, "Query": "https://wic12.blogspot.com/2026/11/a.html",
                 "Clicks": 0, "Impressions": 50},
                {"Date": day, "Query": "https://ggpong.blogspot.com/2026/11/a.html",
                 "Clicks": 0, "Impressions": 1000}
            ]
        with patch.object(seo, "verified_bing_site", return_value=seo.SITE), \
             patch.object(seo, "bing_call", side_effect=api):
            report = seo.bing_pulse("fake-key", ref)
        self.assertEqual(report["totals"]["clicks"], 2)
        self.assertEqual(report["query_rows_analyzed"], 1)
        self.assertEqual(report["low_ctr_query_count"], 1)
        self.assertEqual(len(report["page_review_candidates"]), 1)
        self.assertNotIn("PRIVATE EXACT SEARCH PHRASE", json.dumps(report))
        self.assertNotIn("ggpong", json.dumps(report))

    def test_bing_verified_property_does_not_accept_wrong_blog(self):
        with patch.object(seo, "fetch_json", return_value={"d": [
            {"Url": "https://ggpong.blogspot.com/", "IsVerified": True},
            {"Url": "http://wic12.blogspot.com/", "IsVerified": True},
        ]}):
            self.assertEqual(seo.verified_bing_site("fake"), "http://wic12.blogspot.com/")

    def test_deadline_same_month_range_with_context(self):
        text = "디지털 온누리상품권 특별할인 행사 기간은 2026년 11월 2~6일입니다."
        found = seo.detect_deadlines(text, 2026)
        self.assertEqual(found[0][0], dt.date(2026, 11, 6))

    def test_event_dates_without_context_not_flagged(self):
        self.assertEqual(seo.detect_deadlines("오늘은 2026년 11월 2~6일 날씨를 알아봅니다.", 2026), [])

    def test_stale_flags_expired_and_upcoming_but_no_auto_edit(self):
        posts = [
            {"url": "https://wic12.blogspot.com/2026/11/discount.html",
             "title": "온누리상품권 할인 안내", "published": "2026-11-01T00:00:00Z",
             "content": "<p>행사 기간은 2026년 11월 2~6일</p>"},
            {"url": "https://wic12.blogspot.com/2026/11/other.html",
             "title": "일반 생활 팁", "published": "2026-11-01T00:00:00Z",
             "content": "역사적으로 2024년 3월 1일이었습니다."},
        ]
        result = seo.stale_pulse(posts, dt.date(2026, 11, 7))
        self.assertEqual(result["expired_count"], 1)
        self.assertEqual(result["upcoming_count"], 0)
        self.assertEqual(result["items"][0]["deadline"], "2026-11-06")
        self.assertEqual(result["checked_posts"], 2)

    def test_invalid_calendar_dates_not_flagged(self):
        self.assertEqual(seo.detect_deadlines("행사 2026년 2월 30일까지", 2026), [])

    def test_partial_failure_keeps_prior_bing_and_updates_stale(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "pulse.json"
            path.write_text(json.dumps({"bing": {"status": "ok", "totals": {"clicks": 8}}}))
            with patch.object(seo, "REPORT", path), \
                 patch.object(seo, "bing_pulse", side_effect=RuntimeError("simulated")), \
                 patch.object(seo, "blogger_posts", return_value=[
                     {"url": "https://wic12.blogspot.com/2026/11/a.html",
                      "title": "행사", "published": "2026-11-01", "content": "2026년 11월 2일 마감"}]), \
                 patch.object(seo, "today_kst", return_value=dt.date(2026, 11, 3)), \
                 patch.dict("os.environ", {"BING_API_KEY": "test", "BLOGGER_API_KEY": "test"}, clear=True):
                report = seo.run()
            self.assertEqual(report["bing"]["status"], "stale")
            self.assertEqual(report["bing"]["totals"]["clicks"], 8)
            self.assertEqual(report["stale"]["expired_count"], 1)
            self.assertEqual(json.loads(path.read_text())["bing"]["totals"]["clicks"], 8)


if __name__ == "__main__":
    unittest.main()
