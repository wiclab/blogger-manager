"""Offline-only regression tests for the read-only Blogger internal-link audit."""
import datetime as dt
import unittest
from unittest import mock

from scripts import internal_link_audit as a


def post(url, content=""):
    return {"url": a.SITE + url, "content": content}


class InternalLinkAuditTests(unittest.TestCase):
    def test_normalizes_mobile_tracking_and_http_without_cross_site_joins(self):
        expected = a.SITE + "2026/09/example.html"
        self.assertEqual(a.canonical_post("http://wic12.blogspot.com/2026/09/example.html?m=1"), expected)
        self.assertEqual(a.canonical_post("/2026/09/example.html?utm_source=nav", a.SITE), expected)
        for value in [
            "https://ggpong.blogspot.com/2026/09/example.html",
            "https://qevnaxori.blogspot.com/2026/09/example.html",
            "https://wic12.blogspot.com.evil.tld/2026/09/example.html",
            "https://wic12.blogspot.com/p/about.html",
            "javascript:alert(1)", "mailto:hello@example.com",
            "https://wic12.blogspot.com/2026/09/example.html.evil",
            "https://evil.example/2026/09/example.html",
        ]:
            self.assertIsNone(a.canonical_post(value, a.SITE))

    def test_reports_only_currently_unlisted_post_targets(self):
        one = "2026/09/source.html"
        two = "2026/09/second.html"
        missing = "2026/09/old-slug.html"
        html = (
            '<a href="/2026/09/second.html?m=1">known</a>'
            '<a href="/2026/09/old-slug.html?utm_campaign=foo">old</a>'
            '<a href="http://wic12.blogspot.com/2026/09/old-slug.html?m=1">same old</a>'
            '<a href="https://ggpong.blogspot.com/2026/09/nope.html">other blog</a>'
            '<a href="/p/old-page.html">not a post</a>'
            '<a href="mailto:x@example.com">mail</a>'
            '<a href="https://wic12.blogspot.com/2026/09/missing.jpg">image</a>'
        )
        posts = [post(one, html),
                 post(two, '<a href="/2026/09/old-slug.html#section">old</a>')]
        report = a.audit(posts, at=dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc))
        self.assertEqual(report["live_posts_checked"], 2)
        self.assertEqual(report["post_links_checked"], 4)
        self.assertEqual(report["links_to_live_posts"], 1)
        self.assertEqual(report["unlisted_target_count"], 1)
        self.assertEqual(report["affected_source_count"], 2)
        self.assertEqual(report["findings"][0]["target"], a.SITE + missing)
        self.assertEqual(report["findings"][0]["source_count"], 2)
        self.assertEqual(report["status"], "review_required")
        self.assertNotIn("404", report["findings"][0]["classification"])
        self.assertNotIn("ggpong", str(report))

    def test_unlisted_link_only_is_not_proof_of_404(self):
        report = a.audit([post("2026/09/test.html",
                               '<a href="/2026/09/deleted.html">missing</a>')])
        self.assertEqual(report["findings"][0]["classification"], "not_in_current_live_posts_list")
        self.assertIn("does not prove HTTP 404", report["note"])

    def test_no_candidates_and_dangerous_empty_input(self):
        data = a.audit([post("2026/09/a.html", '<a href="/2026/09/a.html">self</a>')])
        self.assertEqual(data["status"], "no_missing_targets_observed")
        self.assertFalse(data["findings"])
        with self.assertRaisesRegex(ValueError, "Empty LIVE"):
            a.audit([])
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            a.audit([post("2026/09/a.html"), post("2026/09/a.html")])

    def test_blogger_pagination_includes_all_pages(self):
        calls = []
        def fake_get(path, params, key):
            self.assertEqual(key, "secret-key")
            calls.append((path, params))
            if path == "/blogs/byurl":
                return {"id": "1659014803305858421", "url": a.SITE}
            if "pageToken" not in params:
                return {"items": [{"url": a.SITE + "2026/09/a.html",
                                   "content": '<a href="/2026/09/b.html">b</a>'}],
                        "nextPageToken": "next"}
            return {"items": [{"url": a.SITE + "2026/09/b.html", "content": ""}]}
        with mock.patch.object(a, "get_json", side_effect=fake_get):
            data = a.fetch_live_posts("secret-key")
        self.assertEqual(len(data), 2)
        self.assertEqual(a.audit(data)["unlisted_target_count"], 0)
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[1][1]["status"], "LIVE")

    def test_blogger_data_integrity_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "BLOGGER_API_KEY_MISSING"):
            a.fetch_live_posts("")
        def fake_get(path, params, key):
            if path == "/blogs/byurl":
                return {"id": "123", "url": a.SITE}
            return {"items": [], "nextPageToken": "same"}
        with mock.patch.object(a, "get_json", side_effect=fake_get):
            with self.assertRaisesRegex(RuntimeError, "PAGINATION_INVALID"):
                a.fetch_live_posts("secret-key")

    def test_html_parser_ignores_text_and_image_sources(self):
        html = '<img src="/2026/09/fake.html"><code>&lt;a href="/2026/09/fake.html"&gt;</code>'
        self.assertEqual(a.audit([post("2026/09/a.html", html)])["post_links_checked"], 0)


if __name__ == "__main__":
    unittest.main()
