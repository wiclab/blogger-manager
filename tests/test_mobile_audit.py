"""Offline tests for safe, bounded dual-Blogger mobile audits."""
from __future__ import annotations

import copy
import unittest
from scripts import mobile_audit as audit


def seed():
    return {
        "schema": 1, "updated_at": None,
        "sites": [{"id": key, "name": label, "base": base} for key, (label, base) in audit.SITES.items()],
        "rows": {},
    }


def url(site, slug="sample"):
    return audit.SITES[site][1] + "2026/11/" + slug + ".html"


class MobileAuditTests(unittest.TestCase):
    def test_only_exact_public_blog_article_urls_allowed(self):
        self.assertEqual(audit.site_url(url("byeol") + "?m=1", "byeol"), url("byeol"))
        self.assertEqual(audit.site_url(url("nobody"), "nobody"), url("nobody"))
        for raw in [
            url("nobody"), "https://ggpong.blogspot.com/2026/11/sample.html",
            "https://wic12.blogspot.com.evil/2026/11/sample.html",
            "https://wic12.blogspot.com/search/label/a",
            "https://wic12.blogspot.com/2026/11/draft",
            "ftp://wic12.blogspot.com/2026/11/sample.html",
        ]:
            self.assertIsNone(audit.site_url(raw, "byeol"), raw)

    def test_sitemap_index_resolves_and_ignores_home_and_labels(self):
        base = audit.SITES["byeol"][1]
        index = (b'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                 + b'<sitemap><loc>' + (base + "sitemap.xml?page=1").encode() +
                 b'</loc></sitemap></sitemapindex>')
        page = (b'<urlset><url><loc>' + url("byeol").encode() +
                b'</loc><lastmod>2026-11-03</lastmod></url><url><loc>' +
                base.encode() + b'</loc></url><url><loc>' +
                audit.SITES["nobody"][1].encode() +
                b'2026/11/foreign.html</loc></url></urlset>')
        pages = {base + "sitemap.xml": index, base + "sitemap.xml?page=1": page}
        self.assertEqual(audit.discover("byeol", lambda x: pages[x]),
                         {url("byeol"): "2026-11-03"})

    def test_untrusted_sitemap_escape_fails_closed(self):
        base = audit.SITES["nobody"][1]
        body = b"<sitemapindex><sitemap><loc>https://other.example/sitemap.xml</loc></sitemap></sitemapindex>"
        with self.assertRaises(ValueError):
            audit.discover("nobody", lambda x: body)

    def test_empty_sitemap_does_not_erase_previous_state(self):
        with self.assertRaisesRegex(RuntimeError, "Empty public sitemap"):
            audit.discover("byeol", lambda x: b"<urlset></urlset>")

    def test_queue_prioritizes_edits_then_new_then_oldest(self):
        prev = {
            url("byeol", "edit"): {"checked_at": "2026-11-02", "lastmod": "2026-11-01"},
            url("byeol", "old"): {"checked_at": "2026-10-01", "lastmod": "2026-10-01"},
        }
        posts = {
            url("byeol", "new"): "2026-11-03",
            url("byeol", "old"): "2026-10-01",
            url("byeol", "edit"): "2026-11-03",
        }
        selected = audit.order_posts(posts, prev)
        self.assertEqual([x["url"] for x in selected],
                         [url("byeol", "edit"), url("byeol", "new"), url("byeol", "old")])

    def test_scoped_prepare_and_safe_merge(self):
        inventory = {site: {url(site): "2026-11-03T00:00:00Z"}
                     for site in audit.SITES}
        queue = audit.prepare(seed(), inventory)
        self.assertEqual(len(queue["sites"]), 2)
        self.assertEqual(sum(len(s["posts"]) for s in queue["sites"]), 2)
        results = [
            {"url": url("byeol"), "site": "byeol", "state": "issue",
             "severity": "high", "issues": [{"type": "narrow_text", "width": 320,
               "selector": "p:nth-of-type(3)", "detail": "Narrow 75px column"}],
             "screenshot": "screenshots/abcdef123456-320.jpg"},
            {"url": url("nobody"), "site": "nobody", "state": "ok",
             "severity": "none", "issues": [], "screenshot": None},
        ]
        report = audit.merge(seed(), queue, {"schema": 1, "results": results}, "12345")
        self.assertEqual(report["run"]["scanned"], 2)
        self.assertEqual(report["sites"][0]["issue_count"], 1)
        self.assertEqual(report["sites"][1]["issue_count"], 0)
        self.assertEqual(report["rows"][url("byeol")]["screenshot"],
                         "screenshots/abcdef123456-320.jpg")
        with self.assertRaises(ValueError):
            audit.merge(seed(), queue, {"schema": 1, "results": results[:1]}, "12345")
        bad = copy.deepcopy(results)
        bad[1]["url"] = url("byeol")
        with self.assertRaises(ValueError):
            audit.merge(seed(), queue, {"schema": 1, "results": bad}, "12345")

    def test_wrong_previous_site_or_screenshot_is_rejected(self):
        prior = seed()
        prior["rows"][url("byeol")] = {
            "url": url("byeol"), "site": "nobody",
        }
        with self.assertRaises(ValueError):
            audit.validate_prior(prior)
        prior["rows"][url("byeol")]["site"] = "byeol"
        prior["rows"][url("byeol")]["screenshot"] = "../../bad.jpg"
        with self.assertRaises(ValueError):
            audit.validate_prior(prior)


if __name__ == "__main__":
    unittest.main()
