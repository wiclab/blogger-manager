"""Offline regression tests. No external API or Blogger mutations."""
import datetime as dt
import unittest
from unittest import mock

from scripts import gsc_monitor as g


class MonitorTests(unittest.TestCase):
    def test_url_scope(self):
        self.assertTrue(g.is_blog_url("https://wic12.blogspot.com/2026/09/test.html"))
        self.assertFalse(g.is_blog_url("https://evil.example/2026/09/test.html"))
        self.assertFalse(g.is_blog_url("http://wic12.blogspot.com/"))
        self.assertFalse(g.is_blog_url("https://wic12.blogspot.com.evil.test/"))
        self.assertFalse(g.is_blog_url("https://wic12.blogspot.com/?m=1"))
        self.assertTrue(g.is_blog_url("https://wic12.blogspot.com/?m=1", allow_query=True))

    def test_rotation_covers_whole_list(self):
        urls = [str(i) for i in range(43)]
        base = dt.date(2026, 11, 2)
        seen = set()
        for days in range(43):
            selected = g.rotate(urls, base + dt.timedelta(days=days))
            self.assertEqual(len(selected), len(set(selected)))
            seen.update(selected)
        self.assertEqual(seen, set(urls))

    def test_mobile_302_is_not_error(self):
        original = "https://wic12.blogspot.com/2026/09/test.html"
        class Dummy:
            def __init__(self, status=200, location=None):
                self.status = status
                self.headers = {"Location": location} if location else {}
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, _): return (
                b'<html><head><link rel="canonical" href="' +
                original.encode() + b'"></head></html>')
        class FakeOpener:
            def open(self, req, timeout):
                if "?m=1" not in req.full_url:
                    raise g.urllib.error.HTTPError(req.full_url, 302, "redirect",
                        {"Location": original + "?m=1"}, None)
                return Dummy()
        with mock.patch.object(g.urllib.request, "build_opener", return_value=FakeOpener()):
            result = g.http_chain(original)
        self.assertEqual(result["result"], "ok")
        self.assertEqual(result["redirects"], 1)
        self.assertTrue(result["canonical_ok"])

    def test_no_secrets_and_no_per_url_gsc_data_in_report(self):
        posts = [g.SITE + "2026/09/" + str(i) + ".html" for i in range(22)]
        sample = {"verdict": "NEUTRAL", "coverageState": "Discovered - currently not indexed",
                  "lastCrawlTime": None, "pageFetchState": "SUCCESSFUL",
                  "indexingState": "INDEXING_ALLOWED", "robotsTxtState": "ALLOWED",
                  "googleCanonical": None, "userCanonical": posts[0]}
        with (mock.patch.object(g, "credentials_from_secret", return_value="test-secret"),
              mock.patch.object(g, "read_sitemap", return_value=posts),
              mock.patch.object(g, "inspect", return_value=sample),
              mock.patch.object(g, "http_chain",
                                return_value={"result": "ok", "canonical_ok": True,
                                              "noindex": False, "redirects": 1})):
            result = g.collect(dt.date(2026, 11, 2))
        raw = g.json.dumps(result, ensure_ascii=False)
        self.assertNotIn("test-secret", raw)
        self.assertNotIn(posts[0], raw)
        self.assertNotIn("Discovered - currently not indexed", raw)
        self.assertEqual(result["sample"]["inspected_original"], 20)
        self.assertEqual(result["sample"]["mobile_gsc_compared"], 5)
        self.assertEqual(result["sample"]["counts"]["not_indexed"], 20)
        self.assertTrue(result["sample_only"])

    def test_access_denial_fails_fast_and_keeps_error_code(self):
        url = g.SITE + "2026/09/test.html"
        with (mock.patch.object(g, "credentials_from_secret", return_value="fake"),
              mock.patch.object(g, "read_sitemap", return_value=[url]),
              mock.patch.object(g, "inspect",
                                side_effect=RuntimeError("GSC_ACCESS_403: verify API enabled")) as call):
            with self.assertRaisesRegex(RuntimeError, "GSC_ACCESS_403"):
                g.collect(dt.date(2026, 11, 2))
        self.assertEqual(call.call_count, 1)

    def test_zero_success_does_not_overwrite(self):
        url = g.SITE + "2026/09/test.html"
        with (mock.patch.object(g, "credentials_from_secret", return_value="fake"),
              mock.patch.object(g, "read_sitemap", return_value=[url]),
              mock.patch.object(g, "inspect", side_effect=RuntimeError("network error"))):
            with self.assertRaisesRegex(RuntimeError, "No successful"):
                g.collect(dt.date(2026, 11, 2))

    def test_bad_json_error_is_safe_and_specific(self):
        with mock.patch.dict(g.os.environ,
                             {"GSC_SERVICE_ACCOUNT_JSON": "{not JSON}"}):
            with self.assertRaisesRegex(RuntimeError, "GSC_SECRET_INVALID_JSON"):
                g.credentials_from_secret()

    def test_wrong_secret_type_is_rejected(self):
        with mock.patch.dict(g.os.environ,
                             {"GSC_SERVICE_ACCOUNT_JSON": '{"type":"authorized_user"}'}):
            with self.assertRaisesRegex(RuntimeError, "GSC_SECRET_WRONG_TYPE"):
                g.credentials_from_secret()

    def test_escaped_private_key_is_identified_without_leaking(self):
        credential = {"type": "service_account", "client_email":
                      "test@example.iam.gserviceaccount.com",
                      "private_key": "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----",
                      "private_key_id": "test", "token_uri":
                      "https://oauth2.googleapis.com/token"}
        with mock.patch.dict(g.os.environ,
                             {"GSC_SERVICE_ACCOUNT_JSON": g.json.dumps(credential)}):
            with self.assertRaisesRegex(RuntimeError, "GSC_SECRET_ESCAPED_KEY"):
                g.credentials_from_secret()

    def test_disabled_google_api_is_diagnosed_safely(self):
        from io import BytesIO
        error = g.urllib.error.HTTPError(
            g.INDEX_API, 403, "Forbidden", {}, BytesIO(g.json.dumps({
                "error": {"code": 403, "message": "Google Search Console API has not been used in project 123 before or it is disabled",
                          "details": [{"reason": "SERVICE_DISABLED", "domain": "googleapis.com"}]}}).encode()))
        value = g.google_api_access_error(error)
        self.assertTrue(value.startswith("GSC_API_DISABLED"))
        self.assertNotIn("123", value)

    def test_property_permission_denial_is_diagnosed_safely(self):
        from io import BytesIO
        error = g.urllib.error.HTTPError(
            g.INDEX_API, 403, "Forbidden", {}, BytesIO(g.json.dumps({
                "error": {"code": 403, "message": "User does not have sufficient permission for site",
                          "errors": [{"reason": "forbidden"}]}}).encode()))
        self.assertTrue(g.google_api_access_error(error).startswith("GSC_PROPERTY_PERMISSION"))

    def test_generic_api_error_does_not_leak_response_text(self):
        from io import BytesIO
        error = g.urllib.error.HTTPError(
            g.INDEX_API, 403, "Forbidden", {}, BytesIO(g.json.dumps({
                "error": {"code": 403, "message": "unknown sensitive@example.com data",
                          "status": "PERMISSION_DENIED"}}).encode()))
        value = g.google_api_access_error(error)
        self.assertEqual(value.startswith("GSC_ACCESS_403"), True)
        self.assertNotIn("sensitive@", value)

    def test_missing_credentials_fail_closed(self):
        with mock.patch.dict(g.os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "not configured"):
                g.credentials_from_secret()


if __name__ == "__main__":
    unittest.main()
