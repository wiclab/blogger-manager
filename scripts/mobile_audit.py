#!/usr/bin/env python3
"""Prepare and merge a bounded, read-only mobile layout scan for two Blogger sites.

No Blogger credentials, API writes, or implicit claim of complete site coverage.
Reports and screenshots are saved on mobile-audit-data, never main.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SITES = {
    "byeol": ("별셈소", "https://wic12.blogspot.com/"),
    "nobody": ("Nobody Asked Data", "https://qevnaxori.blogspot.com/"),
}
VIEWPORTS = (320, 360, 390, 430)
PER_SITE = 12
POST_RE = re.compile(r"^/\d{4}/\d{2}/[^/]+\.html$")
SHOT_RE = re.compile(r"^screenshots/[0-9a-f]{12}-(320|360|390|430)\.jpg$")
MAX_PAGES = 40


def timestamp() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def site_url(raw: str, site: str) -> str | None:
    """Canonicalize only a public post on the exact expected site."""
    if site not in SITES or not isinstance(raw, str) or len(raw) > 500:
        return None
    try:
        p = urllib.parse.urlsplit(raw)
        host = urllib.parse.urlsplit(SITES[site][1]).hostname
        if (p.scheme not in {"http", "https"} or p.hostname != host
                or p.port is not None or p.username or p.password
                or not POST_RE.fullmatch(p.path)
                or "\\" in raw):
            return None
        return "https://" + host + p.path
    except ValueError:
        return None


def xml_value(element: ET.Element, key: str) -> str:
    for child in element:
        if child.tag.rsplit("}", 1)[-1] == key:
            return (child.text or "").strip()
    return ""


def fetch_xml(url: str) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": "BloggerMobileAudit/1.0 (bounded public layout check)",
        "Accept": "application/xml,text/xml,*/*;q=0.5",
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        body = response.read(4_000_001)
    if len(body) > 4_000_000:
        raise RuntimeError("Sitemap response over safe limit")
    return body


def discover(site: str, fetch=fetch_xml) -> dict[str, str]:
    """Read only same-site sitemap pages. Abort rather than claiming zero posts."""
    base = SITES[site][1]
    host = urllib.parse.urlsplit(base).hostname
    todo = [base + "sitemap.xml"]
    seen: set[str] = set()
    posts: dict[str, str] = {}
    while todo:
        url = todo.pop()
        if url in seen:
            continue
        parts = urllib.parse.urlsplit(url)
        if (parts.scheme != "https" or parts.hostname != host
                or parts.username or parts.password or parts.port is not None
                or not parts.path.startswith("/sitemap")):
            raise ValueError("Unsafe sitemap reference")
        seen.add(url)
        if len(seen) > MAX_PAGES:
            raise RuntimeError("Too many sitemap pages")
        root = ET.fromstring(fetch(url))
        kind = root.tag.rsplit("}", 1)[-1]
        if kind == "sitemapindex":
            for element in root:
                if element.tag.rsplit("}", 1)[-1] == "sitemap":
                    loc = xml_value(element, "loc")
                    if loc:
                        todo.append(loc)
        elif kind == "urlset":
            for element in root:
                if element.tag.rsplit("}", 1)[-1] != "url":
                    continue
                canon = site_url(xml_value(element, "loc"), site)
                if canon:
                    lastmod = xml_value(element, "lastmod")
                    posts[canon] = max(posts.get(canon, ""), lastmod)
        else:
            raise ValueError("Unexpected sitemap document")
        if len(posts) > 5000:
            raise RuntimeError("Unexpectedly large blog")
    if not posts:
        raise RuntimeError("Empty public sitemap; refusing to replace audit results")
    return posts


def validate_prior(prior: dict) -> dict:
    if not isinstance(prior, dict) or prior.get("schema") != 1:
        raise ValueError("Invalid previous mobile audit report")
    sites = prior.get("sites")
    if (not isinstance(sites, list) or
            {s.get("id"): s.get("base") for s in sites if isinstance(s, dict)}
            != {key: value[1] for key, value in SITES.items()}):
        raise ValueError("Report blog set mismatch; refusing to mix sites")
    if not isinstance(prior.get("rows"), dict) or len(prior["rows"]) > 10000:
        raise ValueError("Invalid previous audit rows")
    for url, row in prior["rows"].items():
        if (not isinstance(row, dict) or row.get("site") not in SITES
                or site_url(url, row["site"]) != url
                or row.get("url") != url):
            raise ValueError("Cross-site or corrupt audit entry")
        shot = row.get("screenshot")
        if shot is not None and (not isinstance(shot, str) or not SHOT_RE.fullmatch(shot)):
            raise ValueError("Unsafe screenshot path")
    return prior


def order_posts(posts: dict[str, str], previous: dict,
                limit: int = PER_SITE) -> list[dict]:
    """New/changed pages first; oldest checked later; no permanent starvation."""
    def key(item):
        url, stamp = item
        old = previous.get(url)
        if old and old.get("checked_at") and stamp and stamp != old.get("lastmod", ""):
            return (0, old.get("checked_at", ""), url)
        if not old or not old.get("checked_at"):
            # New posts before older backlog within the unscanned group.
            return (1, "", "".join(chr(255 - ord(c)) if ord(c) < 256 else c
                                    for c in (stamp or "")) + url)
        return (2, old.get("checked_at", ""), url)
    selected = sorted(posts.items(), key=key)[:limit]
    return [{"url": url, "lastmod": stamp} for url, stamp in selected]


def prepare(prior: dict, inventory: dict[str, dict[str, str]]) -> dict:
    validate_prior(prior)
    if set(inventory) != set(SITES):
        raise ValueError("Both site inventories are required")
    result = {"schema": 1, "created_at": timestamp(),
              "viewports": list(VIEWPORTS), "sites": [],
              "live": inventory}
    for site, (label, base) in SITES.items():
        live = inventory[site]
        if not live or any(site_url(url, site) != url for url in live):
            raise ValueError("Inventory has non-public or cross-site URL")
        previous = {url: row for url, row in prior["rows"].items()
                    if row["site"] == site}
        result["sites"].append({"id": site, "name": label, "base": base,
                                "published_count": len(live),
                                "posts": order_posts(live, previous)})
    return result


def merge(prior: dict, queue: dict, scan: dict, run_id: str) -> dict:
    validate_prior(prior)
    if queue.get("schema") != 1 or scan.get("schema") != 1:
        raise ValueError("Invalid scanner payload")
    if set(queue.get("live", {})) != set(SITES):
        raise ValueError("Incomplete site inventory")
    expected = {entry["url"]: site["id"] for site in queue["sites"]
                for entry in site["posts"]}
    if len(expected) != sum(len(s["posts"]) for s in queue["sites"]):
        raise ValueError("Duplicate scan URL")
    found = scan.get("results")
    if not isinstance(found, list) or len(found) != len(expected):
        raise ValueError("Incomplete scan output")
    rows = {}
    live_all = {url for site in SITES for url in queue["live"][site]}
    for url, row in prior["rows"].items():
        if url in live_all:
            rows[url] = dict(row)
    for result in found:
        if not isinstance(result, dict):
            raise ValueError("Malformed scan result")
        url, site = result.get("url"), result.get("site")
        if url not in expected or expected[url] != site or url not in live_all:
            raise ValueError("Cross-site or unexpected scan result")
        if url in rows and rows[url].get("checked_at") == queue["created_at"]:
            raise ValueError("Repeated scan result")
        state = result.get("state")
        severity = result.get("severity")
        if state not in {"ok", "issue", "inconclusive"}:
            raise ValueError("Unknown scan state")
        if severity not in {"none", "review", "high"}:
            raise ValueError("Unknown scan severity")
        issues = result.get("issues")
        if not isinstance(issues, list) or len(issues) > 8:
            raise ValueError("Malformed issue list")
        for issue in issues:
            if (not isinstance(issue, dict)
                    or issue.get("type") not in {
                        "narrow_text", "horizontal_overflow",
                        "table_overflow", "control_clipped",
                        "script_error", "page_load_error", "viewport_mismatch"}
                    or issue.get("width") not in VIEWPORTS
                    or len(str(issue.get("detail", ""))) > 200
                    or len(str(issue.get("selector", ""))) > 180):
                raise ValueError("Invalid issue entry")
        shot = result.get("screenshot")
        if shot is not None and (not isinstance(shot, str) or not SHOT_RE.fullmatch(shot)):
            raise ValueError("Invalid screenshot file reference")
        rows[url] = {
            "url": url, "site": site,
            "lastmod": queue["live"][site][url],
            "checked_at": queue["created_at"],
            "state": state, "severity": severity,
            "issues": issues, "screenshot": shot,
        }
    if set(r["url"] for r in found) != set(expected):
        raise ValueError("Missing or repeated scanner results")
    sites = []
    for site, (name, base) in SITES.items():
        live = queue["live"][site]
        observed = [rows[u] for u in live if u in rows and rows[u]["site"] == site]
        sites.append({
            "id": site, "name": name, "base": base,
            "published_count": len(live),
            "checked_count": len(observed),
            "issue_count": sum(r["state"] == "issue" for r in observed),
            "inconclusive_count": sum(r["state"] == "inconclusive" for r in observed),
            "pending_count": len(live) - len(observed),
        })
    return {
        "schema": 1, "updated_at": timestamp(), "run_id": str(run_id),
        "coverage_note": "12개/블로그/실행 표본 순환 검사. 4개 너비; 브라우저 기반 휴리스틱이므로 실제 모바일 기기 수동 검증 필요.",
        "sites": sites, "rows": rows,
        "run": {
            "status": "partial" if any(r["state"] == "inconclusive" for r in found) else "ok",
            "scanned": len(found),
            "screenshot_count": sum(bool(r.get("screenshot")) for r in found),
            "errors": [],
        },
        "viewport_widths": list(VIEWPORTS),
        "note": "읽기 전용 표본 검사. 자동 수정하지 않으며 계산기 수식·실제 모바일 기기까지 검증한 것은 아닙니다.",
    }


def read_json(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save_json(path: str, data: dict) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                      encoding="utf-8")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("action", choices=("prepare", "finalize", "prune"))
    p.add_argument("--prior", default="audit-data/data/mobile-audit.json")
    p.add_argument("--queue", default="data/mobile-audit-queue.json")
    p.add_argument("--scan", default="data/mobile-audit-scan.json")
    p.add_argument("--out", default="data/mobile-audit.json")
    p.add_argument("--shots", default="audit-data/screenshots")
    p.add_argument("--run-id", default="")
    args = p.parse_args()
    if args.action == "prepare":
        prior = read_json(args.prior)
        inventory = {site: discover(site) for site in SITES}
        data = prepare(prior, inventory)
        save_json(args.queue, data)
        print("Mobile audit sample: " + ", ".join(
            f"{x['id']} {len(x['posts'])}/{x['published_count']}" for x in data["sites"]))
    elif args.action == "finalize":
        output = merge(read_json(args.prior), read_json(args.queue),
                       read_json(args.scan), args.run_id)
        save_json(args.out, output)
        print(f"Mobile audit: {output['run']['scanned']} posts scanned; "
              f"evidence screenshots {output['run']['screenshot_count']}")
    else:
        # Remove only files inside the dedicated screenshot directory.
        report = read_json(args.out)
        validate_prior(report)
        shots = Path(args.shots)
        shots.mkdir(parents=True, exist_ok=True)
        used = {row["screenshot"].split("/", 1)[1] for row in report["rows"].values()
                if row.get("screenshot")}
        for img in shots.glob("*.jpg"):
            if img.name not in used and re.fullmatch(r"[0-9a-f]{12}-(320|360|390|430)\.jpg", img.name):
                img.unlink()


if __name__ == "__main__":
    main()
