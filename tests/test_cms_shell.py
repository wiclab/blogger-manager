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
 def test_shell_mounts_outside_editor_grid_and_safely_hides_mobile_menu(self):
  src=(ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
  css=(ROOT/"assets/cms-shell.css").read_text(encoding="utf-8")
  self.assertIn("host=document.body",src)
  self.assertIn("isLoginGated",src)
  self.assertIn("aside.inert=!active",src)
  self.assertIn("aria-hidden",src)
  self.assertIn("mobile.addEventListener('change',syncAuth)",src)
  self.assertIn("body:not(.cms-enabled) .cms-sidebar",css)
 def test_nobody_bing_report_uses_shared_cms_menu_on_desktop_and_mobile(self):
  shell=(ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
  report=(ROOT/"nobody-indexing.html").read_text(encoding="utf-8")
  self.assertIn("['indexing.html','별셈소 Bing 제출'",shell)
  self.assertIn("['nobody-indexing.html','노바디 Bing 제출'",shell)
  self.assertLess(shell.index("['indexing.html','별셈소 Bing 제출'"),
                  shell.index("['nobody-indexing.html','노바디 Bing 제출'"))
  self.assertIn("current==='nobody-indexing.html'",shell)
  self.assertIn("nobodyPage?'https://qevnaxori.blogspot.com/'",shell)
  self.assertIn("mobile.addEventListener('change',syncAuth)",shell)
  self.assertIn("aside.inert=!active",shell)
  self.assertIn('href="./assets/manager-header.css"',report)
  self.assertIn('href="./assets/cms-shell.css"',report)
  self.assertIn('src="./assets/cms-shell.js" defer',report)
  self.assertIn('class="bm-hero"',report)
  self.assertIn('name="robots" content="noindex,nofollow"',report)
  self.assertIn('/nobody-indexing-data/data/indexing-dashboard.json',report)
  self.assertIn('https://qevnaxori.blogspot.com/',report)
  self.assertNotIn("method:'POST'",report)
  self.assertNotIn('BING_API_KEY',report)

 def test_mobile_audit_is_reachable_on_desktop_and_mobile(self):
  menu=(ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
  html=(ROOT/"mobile-audit.html").read_text(encoding="utf-8")
  dashboard=(ROOT/"dashboard.html").read_text(encoding="utf-8")
  self.assertIn("['mobile-audit.html','모바일 오류 사냥꾼'",menu)
  self.assertIn("aside.inert=!active",menu)
  self.assertIn("cms-drawer-open",menu)
  self.assertIn('href="./assets/cms-shell.css"',html)
  self.assertIn('src="./assets/cms-shell.js" defer',html)
  self.assertIn('name="robots" content="noindex,nofollow"',html)
  self.assertIn("mobile-audit-data/data/mobile-audit.json",html)
  self.assertIn("https://wic12.blogspot.com/",html)
  self.assertIn("https://qevnaxori.blogspot.com/",html)
  self.assertIn("evidence",html)
  self.assertIn('href="./mobile-audit.html"',dashboard)
  self.assertIn("mobile:'mobile-audit-data/data/mobile-audit.json'",dashboard)
  self.assertNotIn("method:'POST'",html)
  self.assertNotIn("BING_API_KEY",html)

 def test_editor_does_not_publish_unsaved_changes(self):
  page=(ROOT/"editor.html").read_text(encoding="utf-8")
  script=page.split("<script>\n'use strict';",1)[1]
  publish=script.split("async function publish() {",1)[1].split("$('login').addEventListener",1)[0]
  self.assertIn("function hasUnsavedChanges()",script)
  self.assertIn("function confirmDiscard()",script)
  self.assertIn("if(hasUnsavedChanges())",publish)
  self.assertLess(publish.index("if(hasUnsavedChanges())"),publish.index("if(!confirm("))
  self.assertIn("window.addEventListener('beforeunload'",script)
  self.assertIn("if(!confirmDiscard())return;",script)
 def test_gsc_problems_surface_as_work_items(self):
  page=(ROOT/"dashboard.html").read_text(encoding="utf-8")
  self.assertIn("Google 미색인 표본 검토",page)
  self.assertIn("Google 관제 데이터 갱신 지연",page)
  self.assertIn("c.not_indexed>0",page)
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
