import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("indexing", Path(__file__).parents[1] / "scripts/indexing.py")
indexing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(indexing)


class IndexingTests(unittest.TestCase):
    def test_canonical_rejects_other_blogs_and_queries(self):
        self.assertEqual(indexing.canonical(
            "http://wic12.blogspot.com/2026/11/example.html?m=1#abc"),
            "https://wic12.blogspot.com/2026/11/example.html")
        for url in [
            "https://ggpong.blogspot.com/2026/11/example.html",
            "https://qevnaxori.blogspot.com/2026/11/example.html",
            "https://wic12.blogspot.com/search/label/%EA%B2%8C%EC%9E%84",
            "https://wic12.blogspot.com/2026/11/example.html.evil",
            "https://wic12.blogspot.com.evil.com/2026/11/example.html",
            "file:///2026/11/example.html",
        ]:
            self.assertIsNone(indexing.canonical(url))

    def test_parse_sitemap_index_and_urls(self):
        index = b'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://wic12.blogspot.com/sitemap.xml?page=1</loc></sitemap></sitemapindex>'
        self.assertEqual(indexing.parse_sitemap(index)[0], "sitemapindex")
        urlset = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://wic12.blogspot.com/2026/11/a.html</loc><lastmod>2026-11-01</lastmod></url></urlset>'
        self.assertEqual(indexing.parse_sitemap(urlset)[1], [
            ("https://wic12.blogspot.com/2026/11/a.html", "2026-11-01")])

    def test_bing_submission_only_changed_and_marks_on_success(self):
        url = "https://wic12.blogspot.com/2026/11/a.html"
        other = "https://wic12.blogspot.com/2026/11/b.html"
        state = {"bing": {other: {"fingerprint": "old"}}}
        posts = {url: "2026-11-01", other: "old"}
        def fake_request(endpoint, **kwargs):
            if "GetUrlSubmissionQuota" in endpoint:
                return (200, b'{"d":{"DailyQuota":100,"MonthlyQuota":100}}')
            self.assertEqual(kwargs["payload"]["urlList"], [url])
            return (200, b'{"d":null}')
        with patch.object(indexing, "request", fake_request):
            self.assertEqual(indexing.bing_submit(posts, state, "fake-test-key"), [url])
        self.assertEqual(state["bing"][url]["fingerprint"], "2026-11-01")
        with patch.object(indexing, "request", side_effect=RuntimeError("simulated failure")):
            with self.assertRaises(RuntimeError):
                indexing.bing_submit({url: "2026-11-02"}, state, "fake-test-key")
        self.assertEqual(state["bing"][url]["fingerprint"], "2026-11-01")

    def test_no_quota_does_not_mark_submitted(self):
        state = {"bing": {}}
        with patch.object(indexing, "request", return_value=(200, b'{"d":{"DailyQuota":0,"MonthlyQuota":0}}')):
            self.assertEqual(indexing.bing_submit(
                {"https://wic12.blogspot.com/2026/11/a.html": "2026-11-01"}, state, "demo"), [])
        self.assertEqual(state["bing"], {})

    def test_gsc_inspects_and_registers_sitemap(self):
        url = "https://wic12.blogspot.com/2026/11/a.html"
        state = {"google": {}, "sitemap_registered": False}
        calls = []
        def fake_request(endpoint, **kwargs):
            calls.append((endpoint, kwargs))
            if "index:inspect" in endpoint:
                return 200, json.dumps({"inspectionResult": {"indexStatusResult": {
                    "verdict": "NEUTRAL", "coverageState": "Discovered - currently not indexed"}}}).encode()
            return 204, b""
        with patch.object(indexing, "request", fake_request):
            self.assertEqual(indexing.google_check({url: "2026-11-01"}, state, "fake-token"), [url])
        self.assertTrue(state["sitemap_registered"])
        self.assertEqual(state["google"][url]["verdict"], "NEUTRAL")
        self.assertEqual(calls[0][1]["method"], "PUT")
        self.assertEqual(len(calls), 2)

    def test_no_empty_sitemap_state_overwrite(self):
        with patch.object(indexing, "request", return_value=(200, b"<urlset></urlset>")):
            with self.assertRaises(RuntimeError):
                indexing.collect_sitemap()

    def test_google_failure_does_not_discard_bing_success(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            report_path = Path(directory) / "report.json"
            url = "https://wic12.blogspot.com/2026/11/a.html"
            def success(posts, state, key):
                state["bing"][url] = {"fingerprint": "2026-11-01", "submitted_at": "2026-11-01T00:00:00+00:00"}
                return [url]
            with patch.object(indexing, "STATE_PATH", state_path), patch.object(indexing, "REPORT_PATH", report_path), \
                 patch.object(indexing, "collect_sitemap", return_value={url: "2026-11-01"}), \
                 patch.object(indexing, "collect_atom_updates", return_value={}), \
                 patch.object(indexing, "bing_submit", side_effect=success), \
                 patch.object(indexing, "google_access_token", side_effect=RuntimeError("OAuth test error")):
                report = indexing.run()
            self.assertEqual(report["bing_submitted"], [url])
            self.assertIn("OAuth test error", report["google_error"])
            self.assertEqual(json.loads(state_path.read_text())["bing"][url]["fingerprint"], "2026-11-01")

    def test_persists_state_only_if_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            report_path = Path(directory) / "report.json"
            url = "https://wic12.blogspot.com/2026/11/a.html"
            with patch.object(indexing, "STATE_PATH", state_path), patch.object(indexing, "REPORT_PATH", report_path), \
                 patch.object(indexing, "collect_sitemap", return_value={url: "2026-11-01"}), \
                 patch.object(indexing, "collect_atom_updates", return_value={}), \
                 patch.object(indexing, "bing_submit", return_value=[]), \
                 patch.object(indexing, "google_access_token", return_value=None):
                report = indexing.run()
            self.assertEqual(report["published_posts"], 1)
            self.assertTrue(report_path.exists())
            self.assertFalse(state_path.exists())


if __name__ == "__main__":
    unittest.main()
