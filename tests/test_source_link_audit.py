"""Offline safety tests for official-reference source link audit."""
import datetime as dt
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import source_link_audit as a


class SourceLinkAuditTests(unittest.TestCase):
    def test_safe_urls_restrict_to_public_official_https(self):
        good = "https://www.gov.kr/portal/service?bbsId=2&nttId=55#section"
        self.assertEqual(a.safe_url(good), good.split("#")[0])
        self.assertEqual(a.safe_url("https://developers.google.com/search/docs?hl=ko"),
                         "https://developers.google.com/search/docs?hl=ko")
        for invalid in [
            "http://www.gov.kr/portal",
            "https://www.gov.kr.attacker.example/p",
            "https://127.0.0.1/secret",
            "https://192.168.0.1/cfg",
            "https://user:pass@www.gov.kr/portal",
            "https://www.gov.kr:8443/portal",
            "file:///etc/passwd",
            "https://www.gov.kr/portal?access_token=abc",
            "https://www.gov.kr/portal?apikey=secret",
            "https://www.gov.kr/portal?auth=secret",
            "https://www.gov.kr/portal?token=abc&session_id=12",
            "https://www.gov.kr/portal\\@attacker.example",
            "https://evil.example/2026/11/abc.html",
            "https://www.gov.kr/portal\nHost: 127.0.0.1",
        ]:
            self.assertIsNone(a.safe_url(invalid), invalid)

    def test_external_reference_extraction_is_deduplicated(self):
        posts = [
            {"url": a.SITE + "2026/10/first.html",
             "content": '<a href="https://www.gov.kr/item?p=1">source</a>'
                        '<a href="https://www.gov.kr/item?p=1#part">source again</a>'
                        '<a href="https://evil.example/hidden">no</a>'
                        '<a href="/2026/10/second.html">internal</a>'},
            {"url": a.SITE + "2026/10/second.html",
             "content": '<a href="https://www.gov.kr/item?p=1">source</a>'},
        ]
        links = a.gather(posts)
        self.assertEqual(len(links), 1)
        self.assertEqual(links["https://www.gov.kr/item?p=1"]["source_count"], 2)

    def test_head_and_get_agreement_required_for_missing_review(self):
        self.assertEqual(a.classify_codes(404, 404), "review_missing")
        self.assertEqual(a.classify_codes(410, 404), "review_missing")
        self.assertEqual(a.classify_codes(404, 200), "ok")
        self.assertEqual(a.classify_codes(404, None), "inconclusive")
        self.assertEqual(a.classify_codes(403), "inconclusive")
        self.assertEqual(a.classify_codes(429), "inconclusive")
        self.assertEqual(a.classify_codes(301), "redirect_unverified")
        self.assertEqual(a.classify_codes(200), "ok")
        self.assertEqual(a.classify_codes(405, 200), "ok")
        self.assertEqual(a.classify_codes(405, 302), "redirect_unverified")
        self.assertEqual(a.classify_codes(405, 404), "inconclusive")

    def test_check_one_uses_get_only_for_errors(self):
        calls = []
        def fake_get(url, method, timeout=8):
            calls.append(method)
            return 404
        with patch.object(a, "probe_code", side_effect=fake_get):
            report = a.check_one("https://www.gov.kr/test")
        self.assertEqual(calls, ["HEAD", "GET"])
        self.assertEqual(report["state"], "review_missing")
        calls.clear()
        with patch.object(a, "probe_code", return_value=302):
            self.assertEqual(a.check_one("https://www.gov.kr/test")["state"],
                             "redirect_unverified")

    def test_report_keeps_prior_findings_only_for_live_links(self):
        u1 = "https://www.gov.kr/s1"
        u2 = "https://www.gov.kr/s2"
        posts = [{"url": a.SITE + "2026/09/a.html",
                  "content": f'<a href="{u1}">A</a><a href="{u2}">B</a>'}]
        prior = {u1: {"state": "review_missing", "checked_at": "2026-10-01T00:00:00+00:00",
                      "head_code": 404, "get_code": 404},
                 "https://www.gov.kr/deleted": {"state": "review_missing",
                      "checked_at": "2026-10-01T00:00:00+00:00"}}
        report = a.build_report(posts, prior, probe=lambda u: {"state": "ok",
                                 "head_code": 200, "get_code": None},
                                now=dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc),
                                limit=0)
        self.assertEqual(report["official_url_total"], 2)
        self.assertEqual(report["review_missing_count"], 1)
        self.assertEqual(report["not_checked_count"], 1)
        self.assertNotIn("deleted", str(report))
        after = a.build_report(posts, prior, probe=lambda u: {"state": "ok",
                               "head_code": 200, "get_code": None},
                               now=dt.datetime(2026, 11, 2, tzinfo=dt.timezone.utc),
                               limit=2)
        self.assertEqual(after["review_missing_count"], 0)
        self.assertEqual(after["checked_distinct"], 2)

    def test_corrupt_prior_report_does_not_silently_reset(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "prior.json"
            p.write_text('{"site":"https://bad.example/","schema":1,"rows":[]}')
            with patch.object(a, "PRIOR", p):
                with self.assertRaisesRegex(ValueError, "another blog"):
                    a.previous_rows()

    def test_report_sample_limit_is_explicit(self):
        posts = [{"url": a.SITE + "2026/09/a.html",
                  "content": "".join(
                       f'<a href="https://www.gov.kr/p/{i}">doc</a>'
                       for i in range(70))}]
        report = a.build_report(posts, {}, probe=lambda url: {"state": "ok",
                  "head_code": 200, "get_code": None}, limit=70)
        self.assertEqual(report["official_url_total"], 70)
        self.assertEqual(report["sample_this_run"], 60)
        self.assertEqual(report["not_checked_count"], 10)


if __name__ == "__main__":
    unittest.main()
