#!/usr/bin/env python3
"""Read-only audit of public official-reference links in Byeolsemso posts.

Public, explicitly allowlisted HTTPS hosts only. Redirects are never followed.
A 404/410 is a manual review candidate only after HEAD + GET both return 404/410.
Do not modify Blogger posts, crawl non-public addresses or assume indexing status.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

from scripts import internal_link_audit as internal

SITE = internal.SITE
REPORT = Path("data/source-link-health.json")
PRIOR = Path("data/previous-source-link-health.json")
MAX_SELECTED = 60
MAX_STORED = 1200
SENSITIVE = re.compile(r"(?i)(?:^|_)(?:api_?key|token|access_?token|password|passwd|secret|auth|signature|sig|session|jwt|code)(?:$|_)")
EXACT_HOSTS = {
    "support.google.com", "developers.google.com", "www.google.com",
    "lolesports.com", "www.lolesports.com", "www.youtube.com", "youtu.be",
    "help.naver.com", "help.kakao.com", "www.bing.com",
    "www.korea.kr", "korea.kr", "www.gov.kr", "gov.kr", "data.go.kr",
    "www.korail.com", "www.letskorail.com", "www.hometax.go.kr",
    "www.nts.go.kr", "www.kepco.co.kr", "www.law.go.kr",
}


def official_host(host: str) -> bool:
    host = host.lower().rstrip(".")
    if host in EXACT_HOSTS:
        return True
    return (host.endswith(".go.kr") or host.endswith(".gov.kr")
            or host.endswith(".korea.kr"))


def safe_url(raw: str) -> str | None:
    """Discard non-HTTPS, unexpected domains, login/query secrets and IP literals."""
    if not isinstance(raw, str) or len(raw) > 650:
        return None
    try:
        parts = urllib.parse.urlsplit(raw.strip())
        if (parts.scheme != "https" or not parts.hostname or parts.username
                or parts.password or parts.port is not None or not official_host(parts.hostname)
                or "\\" in raw or any(ord(c) < 32 for c in raw)
                ):
            return None
        try:
            ipaddress.ip_address(parts.hostname)
            return None
        except ValueError:
            pass
        qs = urllib.parse.parse_qsl(parts.query, keep_blank_values=True,
                                    max_num_fields=50)
        if any(SENSITIVE.search(key) for key, _ in qs):
            return None
        return urllib.parse.urlunsplit(("https", parts.hostname.lower(),
                                       parts.path or "/", parts.query, ""))
    except (ValueError, UnicodeError):
        return None


def gather(posts: list[dict]) -> dict[str, dict]:
    links: dict[str, dict] = {}
    for post in posts:
        source = internal.canonical_post(post.get("url", ""))
        if not source or not isinstance(post.get("content"), str):
            raise ValueError("Invalid Blogger post data")
        parser = internal.LinkParser()
        parser.feed(post["content"])
        for href in parser.links:
            url = safe_url(href)
            if not url:
                continue
            entry = links.setdefault(url, {"sources": set(), "source_count": 0})
            entry["sources"].add(source)
    for entry in links.values():
        entry["source_count"] = len(entry["sources"])
        entry["sources"] = sorted(entry["sources"])[:5]
    if len(links) > MAX_STORED:
        raise RuntimeError("Too many official links to audit safely")
    return links


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def probe_code(url: str, method: str, timeout: int = 8) -> int | None:
    headers = {"User-Agent": "ByeolsemsoSourceCheck/1.0 (read-only)",
               "Accept": "text/html,application/xhtml+xml,*/*;q=0.2"}
    req = urllib.request.Request(url, method=method, headers=headers)
    try:
        with OPENER.open(req, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def classify_codes(head: int | None, get: int | None = None) -> str:
    if head is None:
        return "inconclusive"
    if head in {404, 410}:
        if get in {404, 410}:
            return "review_missing"
        if get is not None and 200 <= get < 300:
            return "ok"
        return "inconclusive"
    if 200 <= head < 300:
        return "ok"
    if 300 <= head < 400:
        return "redirect_unverified"
    if head in {405, 501}:
        if get is not None and 200 <= get < 300:
            return "ok"
        if get is not None and 300 <= get < 400:
            return "redirect_unverified"
        return "inconclusive"
    return "inconclusive"


def check_one(url: str) -> dict:
    # Never follow external redirects. GET fallback is only for HEAD-denied/404.
    head = probe_code(url, "HEAD")
    get = probe_code(url, "GET") if head in {404, 410, 405, 501} else None
    return {"state": classify_codes(head, get), "head_code": head,
            "get_code": get}


def previous_rows() -> dict[str, dict]:
    if not PRIOR.exists():
        return {}
    old = json.loads(PRIOR.read_text(encoding="utf-8"))
    if old.get("site") != SITE or old.get("schema") != 1:
        raise ValueError("Previous source-link report belongs to another blog")
    rows = old.get("rows")
    if not isinstance(rows, list) or len(rows) > MAX_STORED:
        raise ValueError("Previous source-link report corrupt")
    result = {}
    for item in rows:
        if not isinstance(item, dict) or not safe_url(item.get("url", "")):
            raise ValueError("Previous source-link URL invalid")
        if item.get("state") not in {
            "ok", "review_missing", "redirect_unverified", "inconclusive", "not_checked"
        }:
            raise ValueError("Previous source-link state invalid")
        if item["state"] != "not_checked":
            result[item["url"]] = {
                "state": item["state"],
                "head_code": item.get("head_code"),
                "get_code": item.get("get_code"),
                "checked_at": item.get("checked_at"),
            }
    return result


def build_report(posts: list[dict], prior: dict[str, dict],
                 probe=check_one, now: dt.datetime | None = None,
                 limit: int = MAX_SELECTED) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    links = gather(posts)
    week = now.isocalendar().week
    # Stable rotation ensures every URL eventually gets a turn even as old rows persist.
    ordered = sorted(links, key=lambda url: hashlib.sha256(
        (str(week) + ":" + url).encode("utf-8")).hexdigest())
    selected = ordered[:max(0, min(limit, MAX_SELECTED))]
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(probe, url): url for url in selected}
        for future in concurrent.futures.as_completed(jobs):
            url = jobs[future]
            try:
                result = future.result()
                if result.get("state") not in {
                    "ok", "review_missing", "redirect_unverified", "inconclusive"
                }:
                    raise ValueError("Unexpected probe state")
            except (OSError, RuntimeError, ValueError):
                result = {"state": "inconclusive", "head_code": None, "get_code": None}
            results[url] = {**result, "checked_at": now.isoformat(timespec="seconds")}
    rows = []
    for url in sorted(links):
        old = prior.get(url, {})
        item = {**old, **results.get(url, {})}
        rows.append({
            "url": url,
            "domain": urllib.parse.urlsplit(url).hostname,
            "sources": links[url]["sources"],
            "source_count": links[url]["source_count"],
            "state": item.get("state", "not_checked"),
            "head_code": item.get("head_code"),
            "get_code": item.get("get_code"),
            "checked_at": item.get("checked_at"),
        })
    states = [row["state"] for row in rows]
    return {
        "schema": 1, "site": SITE,
        "updated_at": now.isoformat(timespec="seconds"),
        "live_posts_checked": len(posts),
        "official_url_total": len(rows),
        "sample_this_run": len(selected),
        "checked_distinct": sum(x != "not_checked" for x in states),
        "review_missing_count": states.count("review_missing"),
        "ok_count": states.count("ok"),
        "inconclusive_count": states.count("inconclusive") +
                              states.count("redirect_unverified"),
        "not_checked_count": states.count("not_checked"),
        "rows": rows,
        "note": "Only official allowlisted HTTPS reference links; 60 URLs/run. "
                "404/410 HEAD and GET agreement is a REVIEW CANDIDATE, not proof "
                "the link is invalid for all visitors. 403, redirects, rate limits "
                "and network errors are inconclusive. Historic findings may be stale. "
                "No links changed, no Blogger edits, no Google/Bing indexing requests.",
    }


def main() -> int:
    posts = internal.fetch_live_posts(os.environ.get("BLOGGER_API_KEY", "").strip())
    report = build_report(posts, previous_rows())
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    temp = REPORT.with_suffix(".tmp")
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    temp.replace(REPORT)
    print("Official HTTPS links total: " + str(report["official_url_total"]))
    print("Newly probed: " + str(report["sample_this_run"]))
    print("Review only, HEAD+GET 404/410: " + str(report["review_missing_count"]))
    print("Previously or newly checked links: " + str(report["checked_distinct"]))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as exc:
        print("Official source audit unavailable: " + type(exc).__name__,
              file=sys.stderr)
        raise SystemExit(1)
