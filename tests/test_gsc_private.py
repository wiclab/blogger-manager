"""Offline security and functional tests of encrypted GSC URL-level reports."""
import datetime as dt
import json
import unittest
from unittest import mock

from scripts import gsc_monitor as monitor
from scripts import gsc_private as priv

PASS = "a-long-unique-test-passphrase-that-is-not-real"


def observation(url, verdict="NEUTRAL", fetch="SUCCESSFUL", mobile=None, http=None):
    return {"url": url,
            "original": {"verdict": verdict, "coverageState": "Discovered - currently not indexed",
                         "pageFetchState": fetch, "lastCrawlTime": None,
                         "googleCanonical": url, "userCanonical": url,
                         "indexingState": "INDEXING_ALLOWED", "robotsTxtState": "ALLOWED"},
            "mobile": mobile, "http": http}


class PrivateReportTests(unittest.TestCase):
    def test_encryption_round_trip_does_not_expose_url(self):
        url = monitor.SITE + "2026/08/private-test.html"
        plain = priv.merge(None, [observation(url, fetch="SERVER_ERROR")], "2026-11-02T07:30:00+00:00")
        sealed = priv.encrypt(plain, PASS)
        public = json.dumps(sealed)
        self.assertNotIn(url, public)
        self.assertNotIn("SERVER_ERROR", public)
        self.assertNotIn("private-test", public)
        self.assertEqual(plain, priv.decrypt(sealed, PASS))
        self.assertEqual(sealed["algorithm"], "PBKDF2-SHA256/AES-256-GCM")

    def test_wrong_password_fails_closed(self):
        plain = priv.merge(None, [observation(monitor.SITE + "2026/08/test.html")],
                           "2026-11-02T07:30:00+00:00")
        encrypted = priv.encrypt(plain, PASS)
        with self.assertRaisesRegex(RuntimeError, "GSC_DETAIL_DECRYPT_FAILED"):
            priv.decrypt(encrypted, "an-unrelated-and-incorrect-password")

    def test_new_ciphertext_has_new_salt_nonce(self):
        plain = {"schema": 1, "site": monitor.SITE, "records": []}
        a,b = priv.encrypt(plain, PASS),priv.encrypt(plain, PASS)
        self.assertNotEqual(a["salt"], b["salt"])
        self.assertNotEqual(a["nonce"], b["nonce"])

    def test_key_minimum_length_enforced(self):
        with self.assertRaisesRegex(RuntimeError, "GSC_DETAIL_KEY_INVALID"):
            priv.encrypt({"schema":1,"site":monitor.SITE,"records":[]}, "123")

    def test_multiday_history_and_same_day_rerun(self):
        url = monitor.SITE + "2026/08/private-test.html"
        day1 = priv.merge(None, [observation(url, fetch="SERVER_ERROR")],
                          "2026-11-02T07:00:00+00:00")
        self.assertEqual(day1["records"][0]["priority"], 1)
        day2 = priv.merge(day1, [observation(url, verdict="PASS")],
                          "2026-11-03T07:00:00+00:00")
        self.assertEqual(len(day2["records"][0]["observations"]), 2)
        rerun = priv.merge(day2, [observation(url, verdict="PASS")],
                           "2026-11-03T12:00:00+00:00")
        self.assertEqual(len(rerun["records"][0]["observations"]), 2)
        self.assertEqual(rerun["records"][0]["last_checked"], "2026-11-03T12:00:00+00:00")

    def test_current_http_redirect_and_mobile_difference_classification(self):
        url = monitor.SITE + "2026/08/test.html"
        orig = observation(url)
        mobile = {"verdict": "PASS", "coverageState": "Indexed"}
        row = priv.merge(None,[observation(url, mobile=mobile, http={
            "result":"ok", "canonical_ok":True, "noindex":False})],
            "2026-11-02T07:00:00+00:00")["records"][0]
        self.assertEqual(row["priority"], 2)
        self.assertTrue(row["mobile_difference"])
        problem = priv.classify(orig["original"], mobile, {"result":"bad_redirect"})
        self.assertEqual(problem["priority"], 1)

    def test_rejects_other_domains(self):
        with self.assertRaisesRegex(RuntimeError, "GSC_DETAIL_URL_REJECTED"):
            priv.merge(None,[observation("https://other.example/2026/09/test.html")],
                       "2026-11-02T07:00:00+00:00")

    def test_focus_selects_only_same_blog_high_priority(self):
        a = monitor.SITE + "2026/08/a.html"
        b = monitor.SITE + "2026/08/b.html"
        c = monitor.SITE + "2026/08/c.html"
        history = priv.merge(None,[
            observation(a, fetch="SERVER_ERROR"), observation(b),
            observation(c, fetch="SOFT_404")],"2026-11-02T07:00:00+00:00")
        self.assertEqual(set(priv.recurring_priority(history, [a,b,c])), {a,c})

    def test_collection_details_do_not_leak_into_public_aggregate(self):
        urls = [monitor.SITE + "2026/08/" + str(i) + ".html" for i in range(22)]
        data = observation(urls[0], fetch="SERVER_ERROR")["original"]
        detail = []
        with (mock.patch.object(monitor, "credentials_from_secret", return_value="fake"),
              mock.patch.object(monitor, "read_sitemap", return_value=urls),
              mock.patch.object(monitor, "inspect", return_value=data),
              mock.patch.object(monitor, "http_chain", return_value={
                  "result": "ok", "canonical_ok": True, "noindex": False, "redirects": 1})):
            summary = monitor.collect(dt.date(2026, 11, 2), detail_sink=detail,
                                      priority_urls=[urls[0]])
        self.assertEqual(len(detail), 20)
        self.assertEqual(detail[0]["url"], urls[0])
        self.assertIsNotNone(detail[0]["mobile"])
        self.assertIsNotNone(detail[0]["http"])
        self.assertNotIn(urls[0], json.dumps(summary))
        self.assertNotIn("SERVER_ERROR", json.dumps(summary))


if __name__ == "__main__":
    unittest.main()
