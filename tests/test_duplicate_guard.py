"""Safeguards for the read-only dual-blog duplicate checker."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class DuplicateGuardIntegrationTests(unittest.TestCase):
    def test_browser_engine_and_fixture_cases(self):
        subprocess.run(["node","--test",str(ROOT/"tests/duplicate_guard.test.cjs")],
                       check=True,capture_output=True,text=True,timeout=30)

    def test_planning_page_keeps_auth_and_read_only_result_rendering(self):
        html = (ROOT/"write.html").read_text(encoding="utf-8")
        self.assertIn('<script src="./assets/duplicate-guard.js"></script>', html)
        self.assertIn('id="duplicate-check"', html)
        self.assertIn('id="dupeTitle"', html)
        self.assertIn('id="dupeOutline"', html)
        self.assertIn('BLOG_REPORT.posts.filter', html)
        self.assertIn('new URL(p.url).hostname === host', html)
        self.assertIn('link.textContent = match.title', html)
        self.assertIn('const token = getIdToken()', html)
        self.assertIn('adminApi("/report")', html)
        self.assertIn('updateDuplicateSource()', html)
        self.assertNotIn('localStorage', html)
        scripts = re.findall(r'<script(?:\s+[^>]*)?>([\s\S]*?)</script>', html, flags=re.I)
        inline = [s for s in scripts if s.strip()]
        self.assertEqual(len(inline), 1)
        with tempfile.NamedTemporaryFile("w",suffix=".js",encoding="utf-8") as tmp:
            tmp.write(inline[0])
            tmp.flush()
            subprocess.run(["node","--check",tmp.name],check=True,capture_output=True,text=True)

    def test_scan_exposes_bounded_intent_hints_not_full_html(self):
        scan = (ROOT/"scripts/scan.mjs").read_text(encoding="utf-8")
        self.assertIn('topicHints: {', scan)
        self.assertIn('post.text || ""', scan)
        self.assertIn('slice(0, 260)', scan)
        self.assertIn('slice(0, 85)', scan)
        self.assertIn('slice(0, 6)', scan)
        subprocess.run(["node","--check",str(ROOT/"scripts/scan.mjs")],
                       check=True,capture_output=True,text=True)

    def test_cms_links_both_blogs_and_does_not_mutate_posts(self):
        nav = (ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
        dash = (ROOT/"dashboard.html").read_text(encoding="utf-8")
        self.assertIn("['write.html','주제 발굴·중복 검사'", nav)
        self.assertIn('href="./write.html#duplicate-check"',dash)
        self.assertIn('https://qevnaxori.blogspot.com/',nav)
        self.assertIn('https://wic12.blogspot.com/',nav)
        script = (ROOT/"assets/duplicate-guard.js").read_text(encoding="utf-8")
        self.assertNotIn("fetch(",script)
        self.assertNotIn("POST",script)
        self.assertNotIn("BING_API_KEY",script)

if __name__ == "__main__":
    unittest.main()
