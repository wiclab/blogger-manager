#!/usr/bin/env python3
"""Read-only AdSense preflight signals for the public Byeolsemso Blogger site.

Flags are review leads, not Google policy decisions. No Blogger write API.
"""
import argparse
import csv
import datetime as dt
import html
import itertools
import json
import re
import time
from collections import Counter
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
import xml.etree.ElementTree as ET

import requests
from bs4 import BeautifulSoup

SITE = "https://wic12.blogspot.com"
PUBLISHER = "pub-3994646975949050"
UA = "ByeolsemsoReadOnlyAudit/1.0 (+https://github.com/wiclab/blogger-manager)"
TIMEOUT = 20
SEVERITY = {"critical": 0, "review": 1, "info": 2}
BAD_TEXT = re.compile(r"\uFFFD|ï¿½|â€[^\s]{0,5}|\[turn\d+(?:search|view|file)\d+\]|contentReference\[", re.I)
DEADLINES = re.compile(r"(신청|접수|지원|특별판매|이벤트|마감|종료|환급).{0,70}(?:202[4-9]년|202[4-9][./-])", re.S)
POST_PATH = re.compile(r"^/20\d\d/\d\d/[^/]+\.html$")
SKIP = re.compile(r"\.(?:jpg|jpeg|png|webp|gif|svg|css|js|pdf|zip|xml)$", re.I)


def canonical_url(url):
    u = urlsplit(url)
    path = re.sub(r"/+", "/", u.path)
    return urlunsplit((u.scheme.lower(), u.netloc.lower(), path, "", ""))


def is_post_url(url):
    u = urlsplit(url)
    return u.netloc.lower() == "wic12.blogspot.com" and bool(POST_PATH.match(u.path))


def request(session, url):
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
        return r, ""
    except requests.RequestException as exc:
        return None, str(exc)[:180]


def discover(session):
    """Use sitemap and Blogger feed. Distinguish unavailable discovery from empty site."""
    urls, notes, seen_xml = set(), [], set()

    def crawl_sitemap(address, depth=0):
        if address in seen_xml or depth > 5:
            return
        seen_xml.add(address)
        r, err = request(session, address)
        if not r or r.status_code != 200:
            notes.append("sitemap fetch failed: " + address + " " + (err or str(r.status_code)))
            return
        try:
            root = ET.fromstring(r.content)
        except ET.ParseError:
            notes.append("sitemap XML parse failed: " + address)
            return
        for item in root.iter():
            if item.tag.rsplit("}", 1)[-1] != "loc" or not item.text:
                continue
            link = item.text.strip()
            if is_post_url(link):
                urls.add(canonical_url(link))
            elif link.startswith(SITE) and (link.endswith(".xml") or "sitemap" in link):
                crawl_sitemap(link, depth + 1)

    crawl_sitemap(SITE + "/sitemap.xml")
    for start in range(1, 2002, 150):
        address = SITE + "/feeds/posts/default?alt=json&max-results=150&start-index=" + str(start)
        r, err = request(session, address)
        if not r or r.status_code != 200:
            notes.append("Blogger feed unavailable at offset " + str(start))
            break
        try:
            data = r.json()["feed"]
            entries = data.get("entry", [])
        except (ValueError, KeyError, TypeError):
            notes.append("Blogger feed parse failed")
            break
        for entry in entries:
            for link in entry.get("link", []):
                if link.get("rel") == "alternate" and is_post_url(link.get("href", "")):
                    urls.add(canonical_url(link["href"]))
        if len(entries) < 150:
            break
    return sorted(urls), notes


def extract_post(html_text):
    soup = BeautifulSoup(html_text, "html.parser")
    post = soup.select_one(".post-body, [itemprop='articleBody'], .entry-content")
    if post is None:
        post = soup.select_one("article") or soup.body or soup
    title = soup.title.get_text(" ", strip=True) if soup.title else ""
    desc = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    canonical = soup.find("link", rel="canonical")
    robots = soup.find("meta", attrs={"name": re.compile(r"^robots$", re.I)})
    clean = BeautifulSoup(str(post), "html.parser")
    for tag in clean.select("script,style,noscript,nav,footer"):
        tag.decompose()
    text = re.sub(r"\s+", " ", clean.get_text(" ", strip=True)).strip()
    images = post.find_all("img")
    anchors = [urljoin(SITE, a.get("href", "")) for a in post.find_all("a", href=True)]
    return {
        "title": title,
        "text": text,
        "body_chars": len(text),
        "h2": len(post.find_all("h2")),
        "img": len(images),
        "img_missing_alt": sum(not x.get("alt", "").strip() for x in images),
        "internal_links": sorted(set(canonical_url(a) for a in anchors if urlsplit(a).netloc.lower() == "wic12.blogspot.com" and is_post_url(a))),
        "external_link_count": sum(urlsplit(a).netloc.lower() not in ("wic12.blogspot.com", "") for a in anchors),
        "has_calculator": bool(post.find(["input", "select"])),
        "canonical": canonical.get("href", "") if canonical else "",
        "robots": robots.get("content", "") if robots else "",
        "meta_description": desc.get("content", "") if desc else "",
        "suspicious_text": bool(BAD_TEXT.search(str(post))),
        "expired_topic": bool(DEADLINES.search(text)),
    }


def add(issue_list, code, severity, evidence, advice):
    issue_list.append({"code": code, "severity": severity, "evidence": evidence, "advice": advice})


def judge(item):
    issues = []
    if item.get("status") == 429:
        add(issues, "RATE_LIMITED", "info", "HTTP 429 from audit runner", "요청 제한. 사이트 정책 위반이나 404로 해석 금지. 나중에 소량 재검사")
        return issues
    if item.get("status") == 0 and "NOT_CHECKED" in item.get("error", ""):
        add(issues, "NOT_CHECKED", "info", item.get("error", ""), "요청 제한으로 실제 페이지 미조회")
        return issues
    if item.get("status") != 200:
        add(issues, "HTTP_UNAVAILABLE", "review", str(item.get("status")) + " " + item.get("error", ""), "일시 장애인지 개별 URL이 실제 404인지 반복 확인")
        return issues
    if re.search(r"\bnoindex\b", item.get("robots", ""), re.I) or re.search(r"\bnoindex\b", item.get("x_robots", ""), re.I):
        add(issues, "NOINDEX", "review", item.get("robots", "") or item.get("x_robots", ""), "색인 설정 의도 확인. AdSense 위반으로 단정하지 않음")
    if item.get("canonical") and canonical_url(item["canonical"]) != canonical_url(item["url"]):
        add(issues, "CANONICAL_MISMATCH", "review", item["canonical"], "정규 URL 및 불필요한 이동 확인")
    if item.get("body_chars", 0) < 450:
        add(issues, "SHORT_BODY", "review", str(item.get("body_chars", 0)) + " chars", "핵심 질문에 실질적인 답이 있는지 수동 검토")
    if item.get("img_missing_alt", 0):
        add(issues, "IMAGE_ALT_MISSING", "info", str(item["img_missing_alt"]) + " image(s)", "대표이미지와 내용 이미지의 대체텍스트 확인")
    if item.get("suspicious_text"):
        add(issues, "BROKEN_TEXT_MARKER", "review", "replacement glyph / internal marker", "문자 깨짐과 편집 잔재 확인")
    if item.get("expired_topic"):
        add(issues, "TIME_SENSITIVE_TOPIC", "info", "date or event wording", "종료 여부 및 현재 기준 안내를 사람이 확인")
    if item.get("h2", 0) == 0 and item.get("body_chars", 0) > 800:
        add(issues, "NO_SECTIONS", "info", "no h2 in post body", "모바일 읽기 흐름을 수동 검토")
    return issues


def scan_live(session, urls, delay):
    out = []
    consecutive_429 = 0
    for pos, url in enumerate(urls, 1):
        r, err = request(session, url)
        item = {"url": url, "status": r.status_code if r is not None else 0, "error": err}
        if item["status"] == 429:
            consecutive_429 += 1
        else:
            consecutive_429 = 0
        if r is not None and r.status_code == 200:
            item.update(extract_post(r.text))
            item["x_robots"] = r.headers.get("X-Robots-Tag", "")
            item["redirected_to"] = canonical_url(r.url) if canonical_url(r.url) != url else ""
            item["ad_code_visible"] = PUBLISHER in r.text
        item["issues"] = judge(item)
        out.append(item)
        if pos % 25 == 0:
            print("scanned", pos, "/", len(urls), flush=True)
        if consecutive_429 >= 3:
            print("Stopping after 3 consecutive HTTP 429 responses (respecting host rate limit)", flush=True)
            for leftover in urls[pos:]:
                pending = {"url": leftover, "status": 0, "error": "NOT_CHECKED_DUE_TO_RATE_LIMIT"}
                pending["issues"] = judge(pending)
                out.append(pending)
            break
        if delay:
            time.sleep(delay)
    return out


def scan_snapshot(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("posts", [])
    out = []
    for record in data:
        item = {"url": record.get("url", ""), "status": record.get("status", 0), "error": "", "title": record.get("title", "")}
        if record.get("html"):
            item.update(extract_post(record["html"]))
        else:
            text = record.get("text", "")
            item.update({
                "text": text,
                "body_chars": len(text),
                "h2": record.get("h2", 0),
                "img": record.get("images", 0),
                "img_missing_alt": record.get("no_alt", 0),
                "internal_links": record.get("internal_links", []),
                "external_link_count": record.get("external", 0),
                "canonical": "",
                "robots": "",
                "x_robots": "",
                "suspicious_text": bool(BAD_TEXT.search(text)),
                "expired_topic": bool(DEADLINES.search(text)),
                "ad_code_visible": None,
            })
        item["issues"] = judge(item)
        out.append(item)
    return out


def check_robots(session):
    url = SITE + "/robots.txt"
    r, err = request(session, url)
    if r is None or r.status_code != 200:
        return {"status": "unverified", "detail": err or ("HTTP " + str(r.status_code))}
    rp = RobotFileParser()
    rp.parse(r.text.splitlines())
    path = SITE + "/2026/09/google-nuclear-power-20-years-ai-electricity.html"
    return {
        "status": "checked",
        "http": r.status_code,
        "sample_path": path,
        "mediapartners_allowed": rp.can_fetch("Mediapartners-Google", path),
        "googlebot_allowed": rp.can_fetch("Googlebot", path),
        "note": "robots.txt static interpretation, not an authenticated Google crawler test",
    }


def summarize(posts, discovery, robots, mode):
    counts = Counter(issue["code"] for p in posts for issue in p["issues"])
    found = {p["url"] for p in posts}
    broken_candidates = []
    for post in posts:
        for link in post.get("internal_links", []):
            if is_post_url(link) and link not in found:
                broken_candidates.append({"from": post["url"], "to": link, "status": "unverified; absent from discovery"})
    return {
        "site": SITE,
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "mode": mode,
        "posts_scanned": len(posts),
        "status_200": sum(p["status"] == 200 for p in posts),
        "issue_counts": dict(counts),
        "priority": "Preflight signals only; not AdSense approval or policy judgments.",
        "robots": robots,
        "discovery_notes": discovery,
        "unlisted_internal_links": broken_candidates[:100],
        "critical_count": sum(i["severity"] == "critical" for p in posts for i in p["issues"]),
        "review_count": sum(i["severity"] == "review" for p in posts for i in p["issues"]),
    }


def safe_csv(value):
    value = "" if value is None else str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def save(outdir, posts, summary):
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "report.json").write_text(json.dumps({"summary": summary, "posts": posts}, ensure_ascii=False, indent=2), encoding="utf-8")
    with (outdir / "posts.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["URL", "title", "HTTP", "body_chars", "h2", "images", "missing_alt", "risk_level", "signals", "detail"])
        for p in posts:
            issues = p["issues"]
            rank = min((SEVERITY[i["severity"]] for i in issues), default=3)
            writer.writerow([safe_csv(p.get("url")), safe_csv(p.get("title")), p.get("status"), p.get("body_chars", ""),
                             p.get("h2", ""), p.get("img", ""), p.get("img_missing_alt", ""),
                             ["critical", "review", "info", "none"][rank],
                             ",".join(i["code"] for i in issues),
                             safe_csv(" | ".join(i["evidence"] for i in issues))])
    trs = []
    for p in sorted(posts, key=lambda z: (min((SEVERITY[i["severity"]] for i in z["issues"]), default=3), z["url"])):
        codes = ", ".join(i["code"] for i in p["issues"]) or "특정 자동 오류 없음"
        url, title = html.escape(p["url"], quote=True), html.escape(p.get("title", ""))
        trs.append('<tr><td><a href="' + url + '" target="_blank" rel="noopener">' + title + '</a></td><td>' +
                   str(p["status"]) + '</td><td>' + html.escape(codes) + '</td><td>' + str(p.get("body_chars", "")) + '</td></tr>')
    page = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>별셈소 AdSense 사전 점검</title><style>body{font:16px/1.7 system-ui,sans-serif;background:#f6f7fa;color:#24344a;margin:0;padding:24px}main{max-width:1100px;margin:auto}h1{font-size:25px}section{background:white;padding:18px;border-radius:14px;margin:14px 0;border:1px solid #e1e5ed}table{border-collapse:collapse;width:100%}td,th{padding:10px;border-bottom:1px solid #e7ebf1;text-align:left;overflow-wrap:anywhere}a{color:#1765ac}input{padding:12px;border:1px solid #bbc9d8;border-radius:9px;width:100%;font:inherit}small{color:#626e80}@media(max-width:650px){body{padding:12px}table{font-size:13px}td,th{padding:6px}}</style>
<main><h1>별셈소 AdSense 사전 점검</h1><p>Google 심사 결과가 아닌 자동 위험 신호입니다. 실제 정책 위반은 수동 검증이 필요합니다.</p><section><strong>검사 모드: MODE</strong><p>검사 POST_COUNT건, HTTP 200: GOOD_COUNT건, 우선 확인 신호: REVIEW_COUNT건</p><small>기준일: GENERATED</small></section><section><label for="q">게시글 검색</label><input id="q" placeholder="제목, URL, 문제 유형"></section><section style="overflow-x:auto"><table><thead><tr><th>글</th><th>HTTP</th><th>검사 신호</th><th>본문 글자수</th></tr></thead><tbody>ROWS</tbody></table></section><script>document.getElementById("q").addEventListener("input",function(){var s=this.value.toLowerCase();document.querySelectorAll("tbody tr").forEach(function(r){r.hidden=!r.textContent.toLowerCase().includes(s)})})</script></main></html>'''
    page = (page.replace("MODE", html.escape(summary["mode"])).replace("POST_COUNT", str(summary["posts_scanned"]))
            .replace("GOOD_COUNT", str(summary["status_200"])).replace("REVIEW_COUNT", str(summary["review_count"]))
            .replace("GENERATED", html.escape(summary["generated_at_utc"])).replace("ROWS", "\n".join(trs)))
    (outdir / "index.html").write_text(page, encoding="utf-8")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--snapshot", help="Historical JSON export for offline scan; never labeled current live")
    p.add_argument("--out", default="adsense-audit-output")
    p.add_argument("--delay", type=float, default=0.8)
    p.add_argument("--limit", type=int, default=0)
    args = p.parse_args()
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    if args.snapshot:
        posts = scan_snapshot(args.snapshot)
        notes = ["Historical offline export: current URL/robots/ad code not verified"]
        robots = {"status": "unverified", "detail": "snapshot mode"}
        mode = "HISTORICAL SNAPSHOT"
    else:
        urls, notes = discover(session)
        if not urls:
            raise SystemExit("No post URLs discovered; cannot infer zero posts. Check sitemap/feed access.")
        if args.limit:
            urls = urls[:args.limit]
        posts = scan_live(session, urls, max(0.0, args.delay))
        robots = check_robots(session)
        mode = "LIVE PUBLIC HTTP"
    summary = summarize(posts, notes, robots, mode)
    save(Path(args.out), posts, summary)
    print(json.dumps({k: v for k, v in summary.items() if k != "unlisted_internal_links"}, ensure_ascii=False, indent=2))
    print("Reports:", args.out, "(index.html, report.json, posts.csv)")


if __name__ == "__main__":
    main()
