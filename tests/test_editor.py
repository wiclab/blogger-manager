"""Regression checks for the standalone Blogger editor (no Google credentials needed)."""

from pathlib import Path
import re
import unittest

HTML = (Path(__file__).resolve().parents[1] / "editor.html").read_text(encoding="utf-8")
SCRIPT = re.search(r"<script>\s*([\s\S]*?)</script>", HTML).group(1)


class BloggerEditorSmokeTests(unittest.TestCase):
    def test_uses_authorized_google_oauth(self):
        self.assertIn("google.accounts.oauth2.initTokenClient", SCRIPT)
        self.assertIn("https://www.googleapis.com/auth/blogger", SCRIPT)

    def test_token_is_not_persisted(self):
        self.assertNotIn("localStorage", SCRIPT)
        self.assertNotIn("sessionStorage", SCRIPT)
        self.assertIn("Bearer ", SCRIPT)

    def test_new_post_draft_only(self):
        self.assertIn("isDraft=true", SCRIPT)
        self.assertIn("method:'POST'", SCRIPT)
        self.assertIn("method:'PATCH'", SCRIPT)
        self.assertIn("+'/publish'", SCRIPT)

    def test_overwrite_protection(self):
        self.assertIn("snapshot(original)!==loadedSnapshot", SCRIPT)

    def test_preview_is_sandboxed_and_has_no_delete(self):
        self.assertRegex(HTML, r'<iframe[^>]+sandbox')
        self.assertNotIn("method:'DELETE'", SCRIPT)

    def test_permalink_limitations_disclosed(self):
        self.assertIn("퍼머링크", HTML)
        self.assertIn("검색설명", HTML)


if __name__ == "__main__":
    unittest.main()
