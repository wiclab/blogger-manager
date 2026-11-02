"""Regression checks for the shared CMS navigation and dashboard."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
PAGES=("index.html","seo.html","indexing.html","gsc.html","sources.html",
       "write.html","editor.html","news.html","intelligence.html")
class CMSShellTests(unittest.TestCase):
 def test_all_pages_include_shell_without_extra_script_tag(self):
  for name in PAGES:
   with self.subTest(name=name):
    page=(ROOT/name).read_text(encoding="utf-8")
    self.assertIn('href="./assets/cms-shell.css"',page)
    self.assertIn("cms.src='./assets/cms-shell.js'",page)
    self.assertEqual(page.count("cms.src='./assets/cms-shell.js'"),1)
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
 def test_shell_and_dashboard_javascript_syntax(self):
  subprocess.run(["node","--check",str(ROOT/"assets/cms-shell.js")],check=True,capture_output=True,text=True)
  html=(ROOT/"dashboard.html").read_text(encoding="utf-8")
  scripts=re.findall(r"<script(?:\s+[^>]*)?>([\s\S]*?)</script>",html)
  inline=[s for s in scripts if s.strip()]
  self.assertEqual(len(inline),1)
  with tempfile.NamedTemporaryFile("w",suffix=".js",encoding="utf-8") as temp:
   temp.write(inline[0]);temp.flush()
   subprocess.run(["node","--check",temp.name],check=True,capture_output=True,text=True)
