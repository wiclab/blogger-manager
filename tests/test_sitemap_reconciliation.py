"""Offline safety/regression tests for Blogger LIVE versus sitemap read-only checks."""
import datetime as dt
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import sitemap_reconciliation as a

NOW = dt.datetime(2026, 11, 2, 12, 0, tzinfo=dt.timezone.utc)


def url(slug):
    return a.SITE + "2026/11/" + slug + ".html"


def post(slug, title="", published="2026-10-01T00:00:00Z"):
    return {"url": url(slug), "title": title, "published": published, "content": ""}


class SitemapReconciliationTests(unittest.TestCase):
    def test_equal_lists_are_aligned(self):
        p = [post("a"), post("b")]
        data = a.reconcile(p, {url("b"): "", url("a"): "2026-11-01"}, at=NOW)
        self.assertEqual(data["status"], "aligned")
        self.assertEqual(data["matched_count"], 2)
        self.assertEqual(data["rows"], [])
        self.assertEqual(data["repeat_review_count"], 0)

    def test_diff_is_not_google_index_failure(self):
        report = a.reconcile([post("a"), post("b", "두 번째 글")],
                             {url("a"): "", url("older"): "2026-09-30"},
                             at=NOW)
        self.assertEqual(report["live_count"], 2)
        self.assertEqual(report["sitemap_count"], 2)
        self.assertEqual(report["matched_count"], 1)
        self.assertEqual(report["live_not_in_sitemap_count"], 1)
        self.assertEqual(report["sitemap_not_live_count"], 1)
        self.assertEqual(report["repeat_review_count"], 0)
        self.assertTrue(all(r["priority"] == "first_observation" for r in report["rows"]))
        self.assertIn("not proof of Google deindexing", report["note"])

    def test_recent_post_is_not_flagged_as_persistent(self):
        report = a.reconcile([post("now", "신규 글", "2026-11-02T11:00:00Z"),
                              post("old")],
                             {url("old"): ""}, at=NOW)
        row = report["rows"][0]
        self.assertTrue(row["new_publication"])
        self.assertEqual(row["priority"], "new_publication")
        self.assertEqual(report["repeat_review_count"], 0)

    def test_same_difference_repeated_needs_manual_review(self):
        before = a.reconcile([post("a"), post("b")], {url("a"): ""}, at=NOW)
        after = a.reconcile([post("a"), post("b")], {url("a"): ""},
                            previous=before, at=NOW + dt.timedelta(days=1))
        self.assertEqual(after["repeat_review_count"], 1)
        self.assertEqual(after["rows"][0]["consecutive_observations"], 2)
        self.assertEqual(after["rows"][0]["first_observed"], before["checked_at"])
        self.assertEqual(after["rows"][0]["priority"], "repeat_review")
        fixed = a.reconcile([post("a"), post("b")],
                            {url("a"): "", url("b"): ""}, previous=after, at=NOW)
        self.assertEqual(fixed["rows"], [])

    def test_empty_partial_and_foreign_site_fail_closed(self):
        with self.assertRaises(ValueError):
            a.reconcile([], {url("a"): ""}, at=NOW)
        with self.assertRaises(ValueError):
            a.reconcile([post("a")], {}, at=NOW)
        with self.assertRaises(ValueError):
            a.reconcile([post("a"), post("a")], {url("a"): ""}, at=NOW)
        with self.assertRaises(ValueError):
            a.reconcile([post("a")], {"https://ggpong.blogspot.com/2026/11/a.html": ""}, at=NOW)
        with self.assertRaises(ValueError):
            a.reconcile([post("a")], {url("a") + "?m=1": ""}, at=NOW)

    def test_prior_scope_and_record_integrity(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"last.json"
            p.write_text(json.dumps({"schema": 1, "site": "https://evil.example/",
                                       "rows": []}), encoding="utf-8")
            with patch.object(a,"PREVIOUS",p):
                with self.assertRaises(ValueError):
                    a.read_previous()
            p.write_text(json.dumps({"schema": 1, "site": a.SITE,
                                       "rows": [{"url": url("a"),
                                                 "category": "delete_my_post"}]}),encoding="utf-8")
            with patch.object(a,"PREVIOUS",p):
                with self.assertRaises(ValueError):
                    a.read_previous()

    def test_no_network_calls_from_comparison_and_no_post_bodies(self):
        with patch.object(a.indexing,"request",side_effect=AssertionError("network call forbidden")), \
             patch.object(a.blogger,"get_json",side_effect=AssertionError("network call forbidden")):
            d = a.reconcile([post("a", "<secret>")], {url("a"): ""}, at=NOW)
        self.assertNotIn("secret",json.dumps(d))


if __name__ == "__main__":
    unittest.main()
