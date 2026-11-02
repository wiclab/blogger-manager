#!/usr/bin/env python3
"""Read-only reconciliation between Blogger LIVE post URLs and public sitemap XML.

Neither snapshot proves Google's indexing or a permanent 404. Publish only when
both independent source reads succeed and validate. Never submit URLs or edit posts.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import sys

from scripts import indexing
from scripts import internal_link_audit as blogger

REPORT = Path("data/sitemap-reconciliation.json")
PREVIOUS = Path("data/previous-sitemap-reconciliation.json")
SITE = "https://wic12.blogspot.com/"
RECENT_HOURS = 48
MAX_DIFF = 5000


def as_utc(value: str) -> dt.datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        d = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if d.tzinfo is None:
            return None
        return d.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def read_previous() -> dict:
    if not PREVIOUS.exists():
        return {}
    data = json.loads(PREVIOUS.read_text(encoding="utf-8"))
    if data.get("schema") != 1 or data.get("site") != SITE:
        raise ValueError("Invalid previous sitemap reconciliation scope")
    if not isinstance(data.get("rows"), list) or len(data["rows"]) > MAX_DIFF:
        raise ValueError("Invalid previous sitemap reconciliation rows")
    for row in data["rows"]:
        if (not isinstance(row, dict)
                or row.get("category") not in ("live_not_in_sitemap", "sitemap_not_live")
                or blogger.canonical_post(row.get("url")) != row.get("url")):
            raise ValueError("Invalid previous sitemap discrepancy")
    return data


def reconcile(posts: list[dict], sitemap: dict[str, str], *,
              previous: dict | None = None,
              at: dt.datetime | None = None) -> dict:
    if not posts or not sitemap:
        raise ValueError("Empty Blogger or sitemap source; no comparison possible")
    at = at or dt.datetime.now(dt.timezone.utc)
    at = at.astimezone(dt.timezone.utc)
    live = {}
    for item in posts:
        url = blogger.canonical_post(item.get("url"))
        if not url or url != item["url"] or url in live:
            raise ValueError("Invalid or duplicate Blogger LIVE URL")
        live[url] = item
    sitemap_urls = set()
    for url in sitemap:
        if indexing.canonical(url) != url:
            raise ValueError("Invalid sitemap post URL")
        sitemap_urls.add(url)
    old = {}
    if previous and isinstance(previous.get("rows"), list):
        for item in previous["rows"]:
            old[(item.get("category"), item.get("url"))] = item
    rows = []
    for category, diff in (
        ("live_not_in_sitemap", sorted(live.keys() - sitemap_urls)),
        ("sitemap_not_live", sorted(sitemap_urls - live.keys())),
    ):
        for url in diff:
            post = live.get(url, {})
            published = as_utc(post.get("published", ""))
            # Clock skew and publication recency should not become a fault claim.
            recent = bool(category == "live_not_in_sitemap" and published
                          and dt.timedelta(0) <= at - published < dt.timedelta(hours=RECENT_HOURS))
            former = old.get((category, url), {})
            prior_count = former.get("consecutive_observations", 0)
            if type(prior_count) is not int or prior_count < 0 or prior_count > 9999:
                prior_count = 0
            observed = min(10000, prior_count + 1)
            rows.append({
                "url": url,
                "category": category,
                "title": str(post.get("title") or "")[:160],
                "published": post.get("published") if published else None,
                "lastmod": sitemap.get(url) or None,
                "new_publication": recent,
                "consecutive_observations": observed,
                "first_observed": (former.get("first_observed")
                                   if former.get("first_observed") else at.isoformat(timespec="seconds")),
                "priority": "new_publication" if recent else "repeat_review" if observed >= 2 else "first_observation",
            })
    if len(rows) > MAX_DIFF:
        raise ValueError("Unexpectedly large discrepancy list")
    return {
        "schema": 1,
        "site": SITE,
        "checked_at": at.isoformat(timespec="seconds"),
        "status": "aligned" if not rows else "differences_need_review",
        "live_count": len(live),
        "sitemap_count": len(sitemap_urls),
        "matched_count": len(live.keys() & sitemap_urls),
        "live_not_in_sitemap_count": len(live.keys() - sitemap_urls),
        "sitemap_not_live_count": len(sitemap_urls - live.keys()),
        "repeat_review_count": sum(r["priority"] == "repeat_review" for r in rows),
        "new_publication_count": sum(r["priority"] == "new_publication" for r in rows),
        "rows": rows,
        "note": "This compares two successful, point-in-time snapshots: public Blogger LIVE posts "
                "and public sitemap XML. Sitemap absence is not proof of Google deindexing, robots "
                "blocking, a 404, or sitemap submission failure. New posts may take time to appear; "
                "repeat observations warrant manual verification. No automated edits or submissions.",
    }


def main() -> int:
    key = os.environ.get("BLOGGER_API_KEY", "").strip()
    posts = blogger.fetch_live_posts(key)
    sitemap = indexing.collect_sitemap()
    result = reconcile(posts, sitemap, previous=read_previous())
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    tmp = REPORT.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(REPORT)
    print("Blogger LIVE: " + str(result["live_count"]))
    print("Sitemap posts: " + str(result["sitemap_count"]))
    print("LIVE not in sitemap: " + str(result["live_not_in_sitemap_count"]))
    print("Sitemap posts not currently LIVE: " + str(result["sitemap_not_live_count"]))
    print("Repeat discrepancy candidates: " + str(result["repeat_review_count"]))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, OSError) as exc:
        # The exception might wrap a URL or API key: report only its type.
        print("Sitemap reconciliation failed safely: " + type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)
