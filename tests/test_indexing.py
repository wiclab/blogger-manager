import importlib.util
import io
import json
import urllib.error
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
            if "GetUserSites" in endpoint:
                return (200, b'{"d":[{"Url":"http://wic12.blogspot.com/","IsVerified":true}]}')
            if "GetUrlSubmissionQuota" in endpoint:
                self.assertIn("siteUrl=http%3A%2F%2Fwic12.blogspot.com%2F", endpoint)
                return (200, b'{"d":{"DailyQuota":100,"MonthlyQuota":100}}')
            self.assertEqual(kwargs["payload"]["siteUrl"], "http://wic12.blogspot.com/")
            self.assertEqual(kwargs["payload"]["urlList"], [url])
            return (200, b'{"d":null}')
        with patch.object(indexing, "request", fake_request):
            self.assertEqual(indexing.bing_submit(posts, state, "fake-test-key"), [url])
        self.assertEqual(state["bing"][url]["fingerprint"], "2026-11-01")
        with patch.object(indexing, "request", side_effect=RuntimeError("simulated failure")):
            with self.assertRaises(RuntimeError):
                indexing.bing_submit({url: "2026-11-02"}, state, "fake-test-key")
        self.assertEqual(state["bing"][url]["fingerprint"], "2026-11-01")

    def test_verified_site_selection_rejects_other_blogs(self):
        def fake_request(endpoint, **kwargs):
            return 200, json.dumps({"d": [
                {"Url": "https://ggpong.blogspot.com/", "IsVerified": True},
                {"Url": "https://qevnaxori.blogspot.com/", "IsVerified": True},
                {"Url": "https://wic12.blogspot.com/", "IsVerified": False},
                {"Url": "http://wic12.blogspot.com/", "IsVerified": True}
            ]}).encode()
        with patch.object(indexing, "request", fake_request):
            self.assertEqual(indexing.bing_verified_site("dummy"), "http://wic12.blogspot.com/")

    def test_bing_no_verified_site_halts_safely(self):
        with patch.object(indexing, "request", return_value=(
                200, b'{"d":[{"Url":"https://ggpong.blogspot.com/","IsVerified":true}]}')):
            with self.assertRaisesRegex(RuntimeError, "no verified Byeolsemso"):
                indexing.bing_verified_site("dummy")

    def test_safe_failure_classification_never_outputs_secrets(self):
        self.assertEqual(indexing.classify_failure(
            indexing.SubmissionOutcomeUnknown("uncertain")), "submission_outcome_unknown")
        self.assertEqual(indexing.classify_failure(
            RuntimeError("Remote API returned HTTP 429")), "read_rate_limited")
        self.assertEqual(indexing.classify_failure(
            RuntimeError("Remote API returned HTTP 401")), "authentication")
        self.assertEqual(indexing.classify_failure(
            RuntimeError("Indexing state is missing; refusing to re-submit all URLs")),
            "state_integrity")

    def test_ambiguous_bing_post_is_never_replayed(self):
        url = "https://wic12.blogspot.com/2026/11/a.html"
        state = {"bing": {}}
        calls = []
        def fake_request(endpoint, **kwargs):
            if "GetUserSites" in endpoint:
                return 200, b'{"d":[{"Url":"https://wic12.blogspot.com/","IsVerified":true}]}'
            if "GetUrlSubmissionQuota" in endpoint:
                return 200, b'{"d":{"DailyQuota":55,"MonthlyQuota":1000}}'
            calls.append(kwargs["payload"]["urlList"])
            raise RuntimeError("Remote connection failed")
        with patch.object(indexing, "request", fake_request):
            with self.assertRaises(indexing.SubmissionOutcomeUnknown):
                indexing.bing_submit({url:"2026-11-02T00:00:00Z"},state,"fake-test-key")
        self.assertEqual(len(calls), 1)
        self.assertEqual(state["bing"], {})

    def test_no_quota_does_not_mark_submitted(self):
        state = {"bing": {}}
        def fake_request(endpoint, **kwargs):
            if "GetUserSites" in endpoint:
                return 200, b'{"d":[{"Url":"https://wic12.blogspot.com/","IsVerified":true}]}'
            return 200, b'{"d":{"DailyQuota":0,"MonthlyQuota":0}}'
        with patch.object(indexing, "request", side_effect=fake_request):
            self.assertEqual(indexing.bing_submit(
                {"https://wic12.blogspot.com/2026/11/a.html": "2026-11-01"}, state, "demo"), [])
        self.assertEqual(state["bing"], {})

    def test_no_empty_sitemap_state_overwrite(self):
        with patch.object(indexing, "request", return_value=(200, b"<urlset></urlset>")):
            with self.assertRaises(RuntimeError):
                indexing.collect_sitemap()

    def test_bing_success_persists_without_google(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            report_path = Path(directory) / "report.json"
            url = "https://wic12.blogspot.com/2026/11/a.html"
            state_path.write_text(json.dumps({
                "version": 1, "bing": {}, "google": {}, "sitemap_registered": False
            }), encoding="utf-8")
            def success(posts, state, key, diagnostics=None):
                state["bing"][url] = {"fingerprint": "2026-11-01", "submitted_at": "2026-11-01T00:00:00+00:00"}
                return [url]
            with patch.object(indexing, "STATE_PATH", state_path), patch.object(indexing, "REPORT_PATH", report_path), \
                 patch.object(indexing, "DASHBOARD_PATH", Path(directory) / "dashboard.json"), \
                 patch.object(indexing, "collect_sitemap", return_value={url: "2026-11-01"}), \
                 patch.object(indexing, "collect_atom_updates", return_value={}), \
                 patch.object(indexing, "bing_submit", side_effect=success):
                report = indexing.run()
            self.assertEqual(report["bing_submitted"], [url])
            self.assertEqual(json.loads(state_path.read_text())["bing"][url]["fingerprint"], "2026-11-01")

    def test_persists_state_only_if_changed(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            report_path = Path(directory) / "report.json"
            url = "https://wic12.blogspot.com/2026/11/a.html"
            initial = {"version": 1, "bing": {}, "google": {}, "sitemap_registered": False}
            state_path.write_text(json.dumps(initial), encoding="utf-8")
            with patch.object(indexing, "STATE_PATH", state_path), patch.object(indexing, "REPORT_PATH", report_path), \
                 patch.object(indexing, "DASHBOARD_PATH", Path(directory) / "dashboard.json"), \
                 patch.object(indexing, "collect_sitemap", return_value={url: "2026-11-01"}), \
                 patch.object(indexing, "collect_atom_updates", return_value={}), \
                 patch.object(indexing, "bing_submit", return_value=[]):
                report = indexing.run()
            self.assertEqual(report["published_posts"], 1)
            self.assertTrue(report_path.exists())
            self.assertEqual(json.loads(state_path.read_text()), initial)
            self.assertFalse(state_path.with_name("indexing-state.backup.json").exists())


    def test_fresh_first_and_old_backlog_reserved(self):
        posts = {}
        for i in range(1, 90):
            posts[f"https://wic12.blogspot.com/2026/08/old-{i:03}.html"] = "2026-08-12T10:00:00Z"
        for i in range(1, 60):
            posts[f"https://wic12.blogspot.com/2026/11/fresh-{i:03}.html"] = "2026-11-01T12:00:00+09:00"
        today = indexing.dt.datetime(2026, 11, 1, 13, tzinfo=indexing.dt.timezone.utc)
        result = indexing.select_bing_candidates(posts, {}, 100, at=today)
        self.assertEqual(len(result), 100)
        fresh = [x for x, _ in result if "/fresh-" in x]
        backlog = [x for x, _ in result if "/old-" in x]
        self.assertEqual(len(fresh), 30)
        self.assertEqual(len(backlog), 70)
        self.assertTrue(all("/fresh-" in x for x,_ in result[:30]))

    def test_queue_reserves_recent_new_and_updated_with_backlog(self):
        at = indexing.dt.datetime(2026, 11, 2, 2, tzinfo=indexing.dt.timezone.utc)
        posts = {}
        saved = {}
        for i in range(40):
            posts[f"https://wic12.blogspot.com/2026/11/new-{i:02}.html"] = "2026-11-01T10:00:00Z"
        for i in range(25):
            url = f"https://wic12.blogspot.com/2026/10/edited-{i:02}.html"
            posts[url] = "2026-11-01T13:00:00Z"
            saved[url] = {"fingerprint": "old", "submitted_at": "2026-10-01T00:00:00Z"}
        for i in range(90):
            posts[f"https://wic12.blogspot.com/2026/08/backlog-{i:02}.html"] = "2026-08-04T10:00:00Z"
        queue = indexing.pending_queue(posts, saved, at=at)
        self.assertEqual(queue["first_time"], 130)
        self.assertEqual(queue["updated"], 25)
        self.assertEqual(len(queue["recent_new"]), 40)
        self.assertEqual(len(queue["recent_updated"]), 25)
        picked = indexing.select_bing_candidates(posts, saved, 100, at=at)
        self.assertEqual(len(picked), 100)
        self.assertEqual(sum("/new-" in url for url, _ in picked), 21)
        self.assertEqual(sum("/edited-" in url for url, _ in picked), 9)
        self.assertEqual(sum("/backlog-" in url for url, _ in picked), 70)

    def test_queue_no_quota_and_missing_timestamps_are_deterministic(self):
        at = indexing.dt.datetime(2026, 11, 2, 2, tzinfo=indexing.dt.timezone.utc)
        posts = {"https://wic12.blogspot.com/2026/08/without.html": "",
                 "https://wic12.blogspot.com/2026/10/old.html": "2026-10-01T00:00:00Z"}
        self.assertEqual(indexing.select_bing_candidates(posts, {}, 0, at=at), [])
        q = indexing.pending_queue(posts, {}, at=at)
        self.assertEqual(q["without_timestamp"], 1)
        self.assertEqual(len(q["backlog"]), 2)
        a = indexing.select_bing_candidates(posts, {}, 2, at=at)
        self.assertEqual(a, indexing.select_bing_candidates(dict(reversed(list(posts.items()))), {}, 2, at=at))

    def test_queue_updated_post_not_counted_as_new(self):
        at = indexing.dt.datetime(2026, 11, 2, 2, tzinfo=indexing.dt.timezone.utc)
        url = "https://wic12.blogspot.com/2026/11/revised.html"
        saved = {url: {"fingerprint": "before", "submitted_at": "2026-11-01T00:00:00Z"}}
        posts = {url: "2026-11-01T23:00:00Z"}
        q = indexing.pending_queue(posts, saved, at=at)
        self.assertEqual(q["first_time"], 0)
        self.assertEqual(q["updated"], 1)
        self.assertEqual(len(q["recent_updated"]), 1)
        self.assertEqual(indexing.select_bing_candidates(posts, saved, 1, at=at)[0][0], url)

    def test_timezone_aware_fresh_sorting(self):
        posts = {
            "https://wic12.blogspot.com/2026/11/earlier.html":"2026-11-01T19:00:00+09:00",
            "https://wic12.blogspot.com/2026/11/later.html":"2026-11-01T11:00:00Z",
        }
        at = indexing.dt.datetime(2026,11,1,12,tzinfo=indexing.dt.timezone.utc)
        result = indexing.select_bing_candidates(posts, {}, 2, at=at)
        self.assertTrue(result[0][0].endswith("/later.html"))

    def test_already_submitted_fingerprint_is_skipped(self):
        url = "https://wic12.blogspot.com/2026/11/a.html"
        state = {url: {"fingerprint": "2026-11-01T11:00:00Z"}}
        self.assertEqual(indexing.select_bing_candidates({url:"2026-11-01T11:00:00Z"},state,100),[])
        self.assertEqual(len(indexing.select_bing_candidates({url:"2026-11-01T12:00:00Z"},state,100)),1)

    def test_large_batch_respects_quota_and_saves_only_after_success(self):
        posts={f"https://wic12.blogspot.com/2026/08/p{i:03}.html":"2026-08-01T00:00:00Z" for i in range(130)}
        state={"bing":{}}
        calls=[]
        def fake_request(endpoint, **kwargs):
            if "GetUserSites" in endpoint:
                return 200,b'{"d":[{"Url":"https://wic12.blogspot.com/","IsVerified":true}]}'
            if "GetUrlSubmissionQuota" in endpoint:
                return 200,b'{"d":{"DailyQuota":77,"MonthlyQuota":400}}'
            calls.append(kwargs["payload"]["urlList"])
            return 200,b'{"d":null}'
        diagnostics={}
        with patch.object(indexing,"request",fake_request):
            result=indexing.bing_submit(posts,state,"dummy",diagnostics)
        self.assertEqual(len(result),77)
        self.assertEqual(len(state["bing"]),77)
        self.assertEqual(len(calls[0]),77)
        self.assertEqual(diagnostics["daily_quota_remaining_before"],77)
        self.assertFalse(diagnostics["quota_exhausted"])

    def test_dashboard_metrics_are_distinct_and_site_safe(self):
        posts={"https://wic12.blogspot.com/2026/11/fresh.html":"2026-11-01T13:00:00Z",
               "https://wic12.blogspot.com/2026/08/old.html":"2026-08-01T00:00:00Z"}
        state={"bing":{list(posts)[0]:{"fingerprint":"2026-11-01T13:00:00Z","submitted_at":"2026-11-01T13:05:00Z"}},
               "google":{}}
        report={"generated_at":"2026-11-01T13:06:00Z","bing_submitted":[list(posts)[0]],
                "google_inspection_enabled":False,"google_inspected":[],"google_error":None}
        data=indexing.build_dashboard(posts,state,report,{})
        self.assertEqual(data["bing_submission"]["tracked_submitted_count"],1)
        self.assertEqual(data["bing_submission"]["pending_count"],1)
        self.assertIsNone(data["bing_submission"]["daily_quota_remaining_before"])
        self.assertNotIn("indexed_count",data["bing_submission"])
        self.assertEqual(data["site"],indexing.SITE)
        self.assertIn("impressions",data["metric_definitions"])
        queue = data["bing_submission"]["queue_summary"]
        self.assertEqual(queue["first_time_pending"], 1)
        self.assertEqual(queue["changed_since_submission"], 0)
        self.assertEqual(queue["older_or_undated"], 1)
        self.assertTrue(queue["priority_preview"][0]["url"].endswith("/old.html"))
        self.assertNotIn("indexed_count", queue)



    def test_missing_or_corrupt_state_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "indexing-state.json"
            with patch.object(indexing, "STATE_PATH", state_path):
                with self.assertRaisesRegex(RuntimeError, "missing"):
                    indexing.load_state()
                state_path.write_text('{"version":1,"bing":{"bad":{}},"google":{}}',
                                      encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "invalid Bing receipt"):
                    indexing.load_state()
                state_path.write_text('{"version":1,"bing":{},"google":{}}', encoding="utf-8")
                self.assertEqual(indexing.load_state()["bing"], {})

    def test_state_backup_preserves_previous_receipts(self):
        first = "https://wic12.blogspot.com/2026/11/first.html"
        second = "https://wic12.blogspot.com/2026/11/second.html"
        old = {"version": 1, "bing": {
            first: {"fingerprint": "old", "submitted_at": "2026-11-01T00:00:00Z"}
        }, "google": {}, "sitemap_registered": False}
        new = json.loads(json.dumps(old))
        new["bing"][second] = {"fingerprint": "new", "submitted_at": "2026-11-02T00:00:00Z"}
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "indexing-state.json"
            state_path.write_text(json.dumps(old), encoding="utf-8")
            with patch.object(indexing, "STATE_PATH", state_path):
                indexing.persist_state(old, new)
                self.assertEqual(json.loads(state_path.read_text()), new)
                self.assertEqual(json.loads(
                    state_path.with_name("indexing-state.backup.json").read_text()), old)
                with self.assertRaisesRegex(ValueError, "drop previous"):
                    indexing.persist_state(new, old)
                self.assertEqual(json.loads(state_path.read_text()), new)

    def test_transient_api_get_retries_with_bounded_backoff(self):
        url = "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=secret"
        def error():
            return urllib.error.HTTPError(url, 503, "busy", None, io.BytesIO(b""))
        class Reply:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, maximum):
                return b'{"d":[]}'
        with patch.object(indexing.urllib.request, "urlopen",
                          side_effect=[error(), error(), Reply()]) as open_url:
            with patch.object(indexing.time, "sleep") as sleep:
                self.assertEqual(indexing.request(url), (200, b'{"d":[]}'))
        self.assertEqual(open_url.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 2])

    def test_bing_post_never_auto_retries_ambiguous_result(self):
        url = "https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=secret"
        error = urllib.error.HTTPError(url, 503, "busy", None, io.BytesIO(b""))
        with patch.object(indexing.urllib.request, "urlopen", side_effect=error) as open_url:
            with patch.object(indexing.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "HTTP 503") as caught:
                    indexing.request(url, payload={"urlList": ["https://wic12.blogspot.com/2026/11/a.html"]})
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()
        self.assertNotIn("secret", str(caught.exception))

    def test_auth_failure_is_not_retried(self):
        url = "https://ssl.bing.com/webmaster/api.svc/json/GetUserSites?apikey=secret"
        error = urllib.error.HTTPError(url, 401, "unauthorized", None, io.BytesIO(b""))
        with patch.object(indexing.urllib.request, "urlopen", side_effect=error) as open_url:
            with patch.object(indexing.time, "sleep") as sleep:
                with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                    indexing.request(url)
        self.assertEqual(open_url.call_count, 1)
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
