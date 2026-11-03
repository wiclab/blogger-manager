"""Offline regression checks: Nobody and Byeolsemso never share URL boundaries."""
from __future__ import annotations

import json
import unittest
from contextlib import ExitStack
from unittest.mock import patch

from scripts import indexing as core
from scripts import indexing_safe as safe
from scripts import nobody_indexing as nobody

NOBODY_POST = "https://qevnaxori.blogspot.com/2026/10/sample.html"
BYEOL_POST = "https://wic12.blogspot.com/2026/10/sample.html"
OTHER_POST = "https://ggpong.blogspot.com/2026/10/sample.html"


class NobodyIndexingTests(unittest.TestCase):
    def isolated(self):
        scope = ExitStack()
        for name in ("SITE", "HOST", "SITEMAP", "HEADERS"):
            scope.enter_context(patch.object(core, name, getattr(core, name)))
        scope.enter_context(patch.object(core, "bing_verified_site", core.bing_verified_site))
        return scope

    def test_byeolsemso_defaults_remain_unchanged_on_import(self):
        self.assertEqual(core.SITE, "https://wic12.blogspot.com/")
        self.assertEqual(core.HOST, "wic12.blogspot.com")

    def test_nobody_canonical_only_allows_its_public_post_urls(self):
        with self.isolated():
            nobody.configure()
            self.assertEqual(core.SITE, nobody.SITE)
            self.assertEqual(core.SITEMAP, nobody.SITE + "sitemap.xml")
            self.assertEqual(core.canonical(NOBODY_POST + "?m=1"), NOBODY_POST)
            for url in (BYEOL_POST, OTHER_POST, nobody.SITE + "search/label/Foo",
                        "https://qevnaxori.blogspot.com/2026/10/test.html.evil",
                        "http://qevnaxori.blogspot.com.evil/2026/10/a.html"):
                self.assertIsNone(core.canonical(url), url)
        self.assertEqual(core.SITE, "https://wic12.blogspot.com/")

    def test_verified_property_must_be_nobody_not_another_blog(self):
        with self.isolated():
            nobody.configure()
            payload = {"d": [
                {"Url": "https://wic12.blogspot.com/", "IsVerified": True},
                {"Url": "https://ggpong.blogspot.com/", "IsVerified": True},
                {"Url": "https://qevnaxori.blogspot.com/", "IsVerified": False}
            ]}
            with patch.object(core, "request", return_value=(200, json.dumps(payload).encode())):
                with self.assertRaisesRegex(RuntimeError, "no verified"):
                    core.bing_verified_site("unit-test-key")
            payload["d"][2]["IsVerified"] = True
            with patch.object(core, "request", return_value=(200, json.dumps(payload).encode())):
                self.assertEqual(core.bing_verified_site("unit-test-key"), nobody.SITE)

    def test_nobody_state_rejects_byeolsemso_receipts_and_held_urls(self):
        with self.isolated():
            nobody.configure()
            state = {"version": 1, "bing": {
                NOBODY_POST: {"fingerprint": "2026-11-03", "submitted_at": "2026-11-03T00:00:00Z"}
            }, "google": {}, "held_batches": {}}
            self.assertIs(core.validate_state(state), state)
            state["bing"][BYEOL_POST] = {"fingerprint": "x", "submitted_at": "x"}
            with self.assertRaises(ValueError):
                core.validate_state(state)
            del state["bing"][BYEOL_POST]
            state["held_batches"] = {"a" * 32: {
                "status": "held", "prepared_at": "2026-11-03T00:00:00Z",
                "entries": [{"url": OTHER_POST, "fingerprint": "x"}]
            }}
            with self.assertRaises(ValueError):
                core.validate_state(state)

    def test_modified_post_requeues_and_unmodified_one_does_not(self):
        with self.isolated():
            nobody.configure()
            saved = {NOBODY_POST: {"fingerprint": "2026-11-01"}}
            self.assertEqual(core.select_bing_candidates({NOBODY_POST: "2026-11-01"}, saved, 100), [])
            self.assertEqual(core.select_bing_candidates({NOBODY_POST: "2026-11-03"}, saved, 100),
                             [(NOBODY_POST, "2026-11-03")])

    def test_runner_configures_before_invoking_protected_logic(self):
        with self.isolated():
            def check_configuration():
                self.assertEqual(core.SITE, nobody.SITE)
                self.assertEqual(core.HOST, nobody.HOST)
                self.assertEqual(core.canonical(BYEOL_POST), None)
                return 0
            with patch.object(safe, "main", side_effect=check_configuration) as action:
                self.assertEqual(nobody.main(), 0)
                action.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
