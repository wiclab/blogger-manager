"""Regression tests for the unified Blogger Manager navigation."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]
PAGES = {"index.html": "./", "seo.html": "./seo.html",
         "indexing.html": "./indexing.html", "write.html": "./write.html",
         "editor.html": "./editor.html", "news.html": "./news.html",
         "intelligence.html": "./intelligence.html"}
LINKS = ["./", "./seo.html", "./indexing.html", "./write.html", "./editor.html", "./news.html", "./intelligence.html"]

class NavigationTests(unittest.TestCase):
    def test_single_common_header_and_single_active_page(self):
        for page, active in PAGES.items():
            with self.subTest(page=page):
                content = (ROOT / page).read_text(encoding="utf-8")
                self.assertEqual(content.count('class="bm-hero"'), 1)
                self.assertIn('href="./assets/manager-header.css"', content)
                nav = re.search(r'<nav class="bm-nav" aria-label="관리자 메뉴">([\s\S]*?)</nav>', content)
                self.assertIsNotNone(nav)
                hrefs = re.findall(r'<a href="([^"]+)"', nav.group(1))
                self.assertEqual(hrefs, LINKS)
                current = re.findall(r'<a href="([^"]+)" aria-current="page"', nav.group(1))
                self.assertEqual(current, [active])
                self.assertNotIn('href="./stats.html"', content)

    def test_retired_page_and_style(self):
        self.assertFalse((ROOT / "stats.html").exists())
        self.assertTrue((ROOT / "assets/manager-header.css").exists())
        self.assertNotIn("GSC · GA4", (ROOT / "seo.html").read_text(encoding="utf-8"))

    def test_existing_login_and_editor_controls_survive(self):
        main = (ROOT / "index.html").read_text(encoding="utf-8")
        write = (ROOT / "write.html").read_text(encoding="utf-8")
        editor = (ROOT / "editor.html").read_text(encoding="utf-8")
        for target in ('id="app"', 'id="googleButton"', 'id="bloggerConnectButton"'):
            self.assertIn(target, main)
        self.assertIn('id="googleButton"', write)
        self.assertIn('id="login"', editor)
        self.assertIn('id="newPost"', editor)

if __name__ == "__main__":
    unittest.main()
