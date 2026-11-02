"""Regression checks for the shared CMS navigation and dashboard."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
PAGES=("index.html","seo.html","indexing.html","gsc.html","sources.html",
       "write.html","editor.html","news.html","intelligence.html")
class CMSShellTests(unittest.TestCase):
 def test_all_pages_include_shell(self):
  for name in PAGES:
   with self.subTest(name=name):
    page=(ROOT/name).read_text(encoding="utf-8")
    self.assertIn('href="./assets/cms-shell.css"',page)
    self.assertIn('src="./assets/cms-shell.js" defer',page)
    self.assertEqual(page.count('src="./assets/cms-shell.js" defer'),1)
    self.assertIn('class="bm-hero"',page)
 def test_navigation_scope(self):
  src=(ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
  for name in PAGES+("dashboard.html",):self.assertIn("'"+name+"'",src)
  self.assertIn("getComputedStyle(app).display",src)
  self.assertIn("MutationObserver(syncAuth)",src)
  self.assertNotIn("access_token",src)
 def test_public_readonly_dashboard(self):
  page=(ROOT/"dashboard.html").read_text(encoding="utf-8")
  self.assertIn('name="robots" content="noindex,nofollow"',page)
  self.assertIn("Promise.allSettled(",page)
  for branch in ("news-data/","seo-data/","gsc-data/","indexing-data/"):self.assertIn(branch,page)
  self.assertIn("표본",page)
  self.assertNotIn("method:'POST'",page)
  self.assertNotIn("localStorage",page)
