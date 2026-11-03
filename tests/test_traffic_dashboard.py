"""Offline checks for the private Blogger + GA4 traffic dashboard."""
from pathlib import Path
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]

class TrafficDashboardTests(unittest.TestCase):
    def test_page_is_linked_from_cms(self):
        page=(ROOT/"traffic.html").read_text(encoding="utf-8")
        shell=(ROOT/"assets/cms-shell.js").read_text(encoding="utf-8")
        dashboard=(ROOT/"dashboard.html").read_text(encoding="utf-8")
        self.assertIn("'traffic.html','방문 통계'",shell)
        self.assertIn('href="./traffic.html"',dashboard)
        self.assertIn('name="robots" content="noindex,nofollow"',page)
        self.assertIn('src="./assets/traffic-dashboard.js"',page)
        self.assertIn('id="popular"',page)
        for key in ("pv7","pv30","pvAll","gaUsers","gaSessions","gaViews"):
            self.assertIn('id="'+key+'"',page)

    def test_readonly_auth_and_correct_sources(self):
        src=(ROOT/"assets/traffic-dashboard.js").read_text(encoding="utf-8")
        for code in ("7DAYS","30DAYS","'all'","/pageviews?range=",
                     "/users/self/blogs","bloggerManagerIdToken",
                     "/auth/check","/stats/overview?blog=wic12&days=",
                     "verifyAdmin()","textContent"):
            self.assertIn(code,src)
        self.assertIn("new URL(b.url).hostname.toLowerCase()===SITE",src)
        self.assertIn("Promise.allSettled",src)
        self.assertNotIn("localStorage",src)
        self.assertNotIn("method:'PATCH'",src)
        self.assertNotIn("method:'POST',body:",src)
        self.assertNotIn("innerHTML",src)

    def test_traffic_javascript_syntax(self):
        subprocess.run(["node","--check",str(ROOT/"assets/traffic-dashboard.js")],
                       check=True,capture_output=True,text=True)

if __name__=="__main__":
    unittest.main()
