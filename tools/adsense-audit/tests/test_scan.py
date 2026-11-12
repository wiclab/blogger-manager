import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "scan.py"
spec = importlib.util.spec_from_file_location("adsense_audit_scan", script)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_blogger_permalink(self):
        self.assertTrue(audit.is_post_url("https://wic12.blogspot.com/2026/11/test-post.html?m=1"))
        self.assertFalse(audit.is_post_url("https://wic12.blogspot.com/p/privacy-policy.html"))

    def test_extract_and_flags(self):
        page = """<html><head><title>검사</title><link rel="canonical" href="https://wic12.blogspot.com/2026/11/test.html"></head>
        <body><div class="post-body"><h2>확인</h2><img src="a.png" alt="대체 설명">
        <p>실제 설명입니다.</p><a href="/2026/11/b.html?m=1">연결</a></div></body></html>"""
        data = audit.extract_post(page)
        self.assertEqual(data["img_missing_alt"], 0)
        self.assertEqual(data["h2"], 1)
        self.assertEqual(data["internal_links"], ["https://wic12.blogspot.com/2026/11/b.html"])

    def test_unavailable_is_not_approval(self):
        findings = audit.judge({"url": "https://wic12.blogspot.com/2026/11/a.html", "status": 404, "error": ""})
        self.assertEqual(findings[0]["code"], "HTTP_UNAVAILABLE")
        self.assertEqual(findings[0]["severity"], "critical")

    def test_snapshot_report(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "sample.json"
            source.write_text(json.dumps([{"url": "https://wic12.blogspot.com/2026/11/a.html",
                                          "title": "A", "status": 200, "text": "A" * 600}]), encoding="utf-8")
            posts = audit.scan_snapshot(source)
            summary = audit.summarize(posts, [], {"status": "unverified"}, "HISTORICAL SNAPSHOT")
            audit.save(Path(folder) / "out", posts, summary)
            self.assertTrue((Path(folder) / "out" / "index.html").exists())
            self.assertTrue((Path(folder) / "out" / "report.json").exists())
            self.assertEqual(summary["posts_scanned"], 1)


if __name__ == "__main__":
    unittest.main()
