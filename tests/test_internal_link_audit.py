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
        self.assertEqual(data[0]["blog_id"], "1659014803305858421")
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

    def test_official_blogger_editor_url_only_when_post_identifiers_are_verified(self):
        valid = {"url": a.SITE + "2026/10/sample.html",
                 "blog_id": "1659014803305858421",
                 "post_id": "9098581934010072421"}
        self.assertEqual(
            a.blogger_edit_url(valid),
            "https://www.blogger.com/blog/post/edit/1659014803305858421/9098581934010072421",
        )
        for values in [
            {**valid, "post_id": ""},
            {**valid, "post_id": "../../another"},
            {**valid, "blog_id": "wic12"},
            {**valid, "url": "https://ggpong.blogspot.com/2026/10/sample.html"},
        ]:
            self.assertIsNone(a.blogger_edit_url(values))

    def test_suggested_source_can_link_directly_to_official_editor(self):
        target = {"url": a.SITE + "2026/09/power-strip.html",
                  "title": "멀티탭 과부하 전기", "content": "",
                  "blog_id": "1659014803305858421", "post_id": "100"}
        source = {"url": a.SITE + "2026/09/fire-safety.html",
                  "title": "멀티탭 과부하 화재", "content": "",
                  "blog_id": "1659014803305858421", "post_id": "200"}
        rows = a.audit([target, source])["link_opportunities"]["candidates"]
        tgt = next(x for x in rows if x["url"] == target["url"])
        self.assertEqual(tgt["suggested_sources"][0]["source_edit_url"],
                         "https://www.blogger.com/blog/post/edit/1659014803305858421/200")

    def test_body_inbound_counts_ignore_self_and_duplicate_links(self):
        a_url = a.SITE + "2026/09/a.html"
        b_url = a.SITE + "2026/09/b.html"
        c_url = a.SITE + "2026/09/c.html"
        posts = [
            {**post("2026/09/a.html",
                    '<a href="/2026/09/a.html">self</a>'
                    '<a href="/2026/09/b.html?m=1">B</a>'
                    '<a href="/2026/09/b.html">B repeated</a>'),
             "title": "멀티탭 전기요금 계산", "labels": ["생활정보"]},
            {**post("2026/09/b.html", ""), "title": "멀티탭 전기요금 절약", "labels": ["생활정보"]},
            {**post("2026/09/c.html", ""), "title": "가전 전기요금 절약", "labels": ["생활정보"]},
        ]
        result = a.audit(posts)
        self.assertEqual(result["post_links_checked"], 3)
        opportunities = result["link_opportunities"]
        self.assertEqual(opportunities["zero_body_inbound_count"], 2)
        self.assertEqual(opportunities["one_body_inbound_count"], 1)
        by_url = {x["url"]: x for x in opportunities["candidates"]}
        self.assertEqual(by_url[a_url]["inbound_from_other_posts"], 0)
        self.assertEqual(by_url[b_url]["inbound_from_other_posts"], 1)
        self.assertEqual(by_url[c_url]["inbound_from_other_posts"], 0)
        self.assertNotIn(a_url, [x["source"] for x in by_url[a_url]["suggested_sources"]])
        self.assertNotIn(b_url, [x["source"] for x in by_url[b_url]["suggested_sources"]])

    def test_suggestions_require_meaningful_overlap_and_no_existing_link(self):
        t = a.SITE + "2026/09/power-strip.html"
        s = a.SITE + "2026/09/power-safety.html"
        bad = a.SITE + "2026/09/unrelated.html"
        posts = [
            {"url": t, "title": "멀티탭 과부하 안전", "labels": ["생활정보", "전기"],
             "published": "2026-09-01T12:00:00Z", "content": ""},
            {"url": s, "title": "멀티탭 과부하 화재", "labels": ["전기"],
             "content": ""},
            {"url": bad, "title": "멀티탭 관리 요령", "labels": ["생활정보"],
             "content": ""},
        ]
        result = a.audit(posts)
        target = next(x for x in result["link_opportunities"]["candidates"] if x["url"] == t)
        self.assertEqual(target["suggestions_found"], 1)
        self.assertEqual(target["suggested_sources"][0]["source"], s)
        self.assertEqual(target["suggested_sources"][0]["shared_terms"], ["과부하", "멀티탭"])
        self.assertNotIn(bad, str(target["suggested_sources"]))

    def test_only_one_title_word_and_generic_label_is_insufficient(self):
        posts = [
            {"url": a.SITE + "2026/09/a.html", "title": "전기요금 비교", "labels": ["생활정보"], "content": ""},
            {"url": a.SITE + "2026/09/b.html", "title": "전기요금 할인", "labels": ["생활정보"], "content": ""}
        ]
        result = a.audit(posts)
        self.assertEqual(result["link_opportunities"]["candidates"][0]["suggestions_found"], 0)

    def test_generic_question_word_overlap_does_not_recommend_unrelated_posts(self):
        posts = [
            {"url": a.SITE + "2026/09/rental.html",
             "title": "정수기 렌탈 18개월 쓰고 해지하면 얼마일까?", "content": ""},
            {"url": a.SITE + "2026/09/gym.html",
             "title": "헬스장 6개월 쓰고 해지하면 환불 얼마일까?", "content": ""},
            {"url": a.SITE + "2026/09/soju.html",
             "title": "소주 한 병 마신 다음 12시간 자면 운전해도 될까?", "content": ""},
            {"url": a.SITE + "2026/09/food.html",
             "title": "과일 사서 2시간 이동해도 될까?", "content": ""},
        ]
        result = a.audit(posts)
        for item in result["link_opportunities"]["candidates"]:
            self.assertEqual(item["suggestions_found"], 0)

    def test_opportunities_limit_is_explicit(self):
        posts = [{"url": a.SITE + f"2026/09/{n}.html", "title": f"글 {n}", "content": ""} for n in range(505)]
        report = a.audit(posts)
        self.assertEqual(report["link_opportunities"]["candidate_total"], 505)
        self.assertTrue(report["link_opportunities"]["candidates_truncated"])
        self.assertEqual(len(report["link_opportunities"]["candidates"]), 500)

    def test_html_parser_ignores_text_and_image_sources(self):
        html = '<img src="/2026/09/fake.html"><code>&lt;a href="/2026/09/fake.html"&gt;</code>'
        self.assertEqual(a.audit([post("2026/09/a.html", html)])["post_links_checked"], 0)


if __name__ == "__main__":
    unittest.main()
