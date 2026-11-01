#!/usr/bin/env python3
"""Blogger public post discovery -> Bing URL submission. No Google API requests.

Only the verified Byeolsemso blog is eligible. No Google Indexing API calls.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import tempfile
import time
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SITE = "https://wic12.blogspot.com/"
HOST = "wic12.blogspot.com"
SITEMAP = SITE + "sitemap.xml"
STATE_PATH = Path("data/indexing-state.json")
REPORT_PATH = Path("data/indexing-report.json")
DASHBOARD_PATH = Path("data/indexing-dashboard.json")
FAILURE_PATH = Path("data/indexing-failure.json")
POST_RE = re.compile(r"^/\d{4}/\d{2}/[^/]+\.html$")
BING_API = "https://ssl.bing.com/webmaster/api.svc/json/"
MAX_BING = 100  # Bing accepts up to 500 per API batch; cap burst volume at 100
MAX_PRIORITY = 30  # reserve remaining slots for older pending URLs
HEADERS = {"User-Agent": "ByeolsemsoIndexingBot/1.0 (sitemap monitoring)"}


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def canonical(url: str) -> str | None:
    try:
        parsed = urllib.parse.urlsplit(url.strip())
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or parsed.hostname != HOST:
        return None
    if parsed.username or parsed.password or parsed.port:
        return None
    if not POST_RE.fullmatch(parsed.path):
        return None
    return "https://" + HOST + parsed.path


def xml_local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def child_text(element: ET.Element, name: str) -> str:
    for child in element:
        if xml_local(child.tag) == name:
            return (child.text or "").strip()
    return ""


def request(url: str, *, payload: dict | None = None, headers: dict | None = None,
            method: str | None = None) -> tuple[int, bytes]:
    """Retry transient failures only for safe reads. Never auto-retry Bing batch POSTs.

    A timed-out submission may have been accepted despite a lost response.
    Replaying that POST immediately could consume quota or duplicate receipts.
    """
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {**HEADERS, **(headers or {})}
    if data is not None:
        request_headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    safe_read = data is None and method in (None, "GET")
    attempts = 3 if safe_read else 1
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                body = response.read(8_000_001)
                if len(body) > 8_000_000:
                    raise RuntimeError("Response too large")
                return response.status, body
        except urllib.error.HTTPError as exc:
            if safe_read and exc.code in {429, 500, 502, 503, 504} and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            # Do not print URLs or raw responses containing credentials.
            category = ""
            if urllib.parse.urlsplit(url).hostname == "ssl.bing.com":
                try:
                    fault = json.loads(exc.read(2048))
                    code = fault.get("ErrorCode")
                    message = fault.get("Message")
                    allowed = {"InvalidApiKey", "InvalidSiteUrl", "SiteNotVerified", "ThrottleHost",
                               "AccessDenied", "SiteNotFound", "Unauthorized", "UnknownError"}
                    if message in allowed:
                        category = " (" + message + ")"
                    elif isinstance(code, int):
                        category = " (Bing ErrorCode " + str(code) + ")"
                except (ValueError, TypeError, AttributeError):
                    pass
            raise RuntimeError(f"Remote API returned HTTP {exc.code}{category}") from None
        except urllib.error.URLError:
            if safe_read and attempt < attempts - 1:
                time.sleep(2 ** attempt)
                continue
            raise RuntimeError("Remote connection failed") from None
    raise AssertionError("Unreachable retry state")


def parse_sitemap(body: bytes) -> tuple[str, list[tuple[str, str]]]:
    root = ET.fromstring(body)
    kind = xml_local(root.tag)
    if kind not in {"sitemapindex", "urlset"}:
        raise ValueError("Unexpected sitemap XML")
    if kind == "sitemapindex":
        return kind, [(child_text(e, "loc"), "") for e in root if xml_local(e.tag) == "sitemap"]
    return kind, [(child_text(e, "loc"), child_text(e, "lastmod"))
                  for e in root if xml_local(e.tag) == "url"]


def collect_sitemap() -> dict[str, str]:
    pending = [SITEMAP]
    visited: set[str] = set()
    posts: dict[str, str] = {}
    while pending:
        url = pending.pop()
        if url in visited:
            continue
        if len(visited) >= 80:
            raise RuntimeError("Too many sitemap pages")
        parts = urllib.parse.urlsplit(url)
        if (parts.scheme != "https" or parts.hostname != HOST
                or not parts.path.startswith("/sitemap")):
            raise RuntimeError("Sitemap index points outside the expected blog")
        visited.add(url)
        _, body = request(url)
        kind, entries = parse_sitemap(body)
        if kind == "sitemapindex":
            for link, _ in entries:
                if link:
                    pending.append(link)
        else:
            for link, modified in entries:
                post = canonical(link)
                if post:
                    posts[post] = max(posts.get(post, ""), modified)
        if len(posts) > 5000:
            raise RuntimeError("Unexpectedly large post list")
    if not posts:
        raise RuntimeError("Sitemap contains no published blog posts; refusing to update state")
    return posts


def collect_atom_updates() -> dict[str, str]:
    """Best-effort edit timestamps for posts whose sitemap has no lastmod."""
    updates: dict[str, str] = {}
    for start in (1, 151, 301):
        qs = urllib.parse.urlencode({"alt": "atom", "max-results": 150, "start-index": start})
        try:
            _, body = request(SITE + "feeds/posts/default?" + qs)
            root = ET.fromstring(body)
        except (RuntimeError, ET.ParseError) as exc:
            print(f"Atom feed unavailable; using sitemap only ({type(exc).__name__})")
            break
        entries = [e for e in root if xml_local(e.tag) == "entry"]
        for e in entries:
            modified = child_text(e, "updated")
            for link in e:
                if xml_local(link.tag) == "link" and link.get("rel") == "alternate":
                    post = canonical(link.get("href", ""))
                    if post and modified:
                        updates[post] = modified
        if len(entries) < 150:
            break
    return updates


def validate_state(data: dict) -> dict:
    """Fail closed rather than silently treating missing/corrupt receipts as new work."""
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("Indexing state version is invalid; refusing to re-submit")
    if not isinstance(data.get("bing"), dict) or not isinstance(data.get("google"), dict):
        raise ValueError("Indexing state structure is invalid; refusing to re-submit")
    if len(data["bing"]) > 5000:
        raise ValueError("Indexing state has unexpectedly many submissions")
    for url, record in data["bing"].items():
        if (not isinstance(url, str) or canonical(url) != url
                or not isinstance(record, dict)
                or not isinstance(record.get("fingerprint"), str)
                or not isinstance(record.get("submitted_at"), str)):
            raise ValueError("Indexing state contains an invalid Bing receipt")
    held = data.get("held_batches", {})
    if not isinstance(held, dict) or len(held) > 5000:
        raise ValueError("Indexing held batches are invalid; refusing to submit")
    seen = set()
    for batch_id, batch in held.items():
        if (not isinstance(batch_id, str) or not re.fullmatch(r"[0-9a-f]{32}", batch_id)
                or not isinstance(batch, dict)
                or batch.get("status") != "held"
                or utc_stamp(batch.get("prepared_at", "")) is None
                or not isinstance(batch.get("entries"), list)
                or not 1 <= len(batch["entries"]) <= MAX_BING):
            raise ValueError("Indexing held batch structure is invalid")
        for item in batch["entries"]:
            if (not isinstance(item, dict)
                    or not isinstance(item.get("url"), str)
                    or canonical(item["url"]) != item["url"]
                    or not isinstance(item.get("fingerprint"), str)
                    or item["url"] in seen):
                raise ValueError("Indexing held receipt is invalid")
            seen.add(item["url"])
    return data


def load_state() -> dict:
    if not STATE_PATH.is_file():
        raise RuntimeError("Indexing state is missing; refusing to re-submit all URLs")
    return validate_state(json.loads(STATE_PATH.read_text(encoding="utf-8")))


def write_json(path: Path, data: dict) -> None:
    """Replace JSON atomically; never expose a partially written state file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8",
                                         dir=path.parent, prefix=path.name + ".",
                                         suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def persist_state(previous: dict, updated: dict) -> None:
    """Keep an immediately prior valid snapshot and reject any receipt deletion."""
    validate_state(previous)
    validate_state(updated)
    if not set(previous["bing"]).issubset(updated["bing"]):
        raise ValueError("Indexing state would drop previous Bing receipts")
    backup = STATE_PATH.with_name("indexing-state.backup.json")
    write_json(backup, previous)
    write_json(STATE_PATH, updated)


def bing_verified_site(api_key: str) -> str:
    """Use the exact verified Bing property, including its registered scheme."""
    _, body = request(BING_API + "GetUserSites?" + urllib.parse.urlencode({"apikey": api_key}))
    sites = json.loads(body).get("d")
    if not isinstance(sites, list):
        raise RuntimeError("Bing GetUserSites returned an unexpected response")
    for entry in sites:
        if not isinstance(entry, dict) or entry.get("IsVerified") is not True:
            continue
        url = entry.get("Url", "")
        if not isinstance(url, str):
            continue
        try:
            parts = urllib.parse.urlsplit(url)
            if (parts.scheme in {"http", "https"} and parts.hostname == HOST
                    and parts.path in {"", "/"} and not parts.query
                    and not parts.fragment and parts.port is None
                    and parts.username is None and parts.password is None):
                return url
        except ValueError:
            continue
    raise RuntimeError("Bing API account has no verified Byeolsemso site property")


def utc_stamp(raw: str) -> dt.datetime | None:
    """Parse Blogger Atom/sitemap timestamps without lexicographical timezone bugs."""
    if not raw:
        return None
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def pending_queue(posts: dict[str, str], saved: dict,
                  at: dt.datetime | None = None) -> dict:
    """Classify changed public posts without treating submission as indexing."""
    at = at or dt.datetime.now(dt.timezone.utc)
    groups = {"recent_new": [], "recent_updated": [], "backlog": []}
    first_time = updated = no_timestamp = 0
    for url, stamp in posts.items():
        if saved.get(url, {}).get("fingerprint") == (stamp or "unknown"):
            continue
        previously_submitted = url in saved
        if previously_submitted:
            updated += 1
        else:
            first_time += 1
        timestamp = utc_stamp(stamp)
        if timestamp is None:
            no_timestamp += 1
        is_recent = timestamp is not None and dt.timedelta(0) <= (at - timestamp) <= dt.timedelta(days=7)
        category = ("recent_updated" if previously_submitted else "recent_new") if is_recent else "backlog"
        groups[category].append((url, stamp, timestamp))
    for category in ("recent_new", "recent_updated"):
        groups[category].sort(key=lambda row: (row[2], row[0]), reverse=True)
    # Older modified timestamps first; unknown timestamps have stable URL order.
    groups["backlog"].sort(
        key=lambda row: (row[2] or dt.datetime.min.replace(tzinfo=dt.timezone.utc), row[0]))
    return {**groups, "first_time": first_time, "updated": updated,
            "without_timestamp": no_timestamp}


def select_bing_candidates(posts: dict[str, str], saved: dict, limit: int,
                           at: dt.datetime | None = None) -> list[tuple[str, str]]:
    """Reserve up to 30 places for recent changes, remaining places for backlog.

    Within recent posts, prefer 70% first submissions and 30% updates when both
    groups are present. An unused category allocation is offered to the other.
    The preview and actual Bing submission call use the same deterministic order.
    """
    if limit <= 0:
        return []
    groups = pending_queue(posts, saved, at=at)
    fresh = groups["recent_new"]
    revised = groups["recent_updated"]
    backlog = groups["backlog"]
    priority_count = min(MAX_PRIORITY, limit, len(fresh) + len(revised))
    fresh_reserved = min(len(fresh), (priority_count * 7 + 9) // 10)
    revised_reserved = min(len(revised), priority_count - fresh_reserved)
    # Fill unused update slots with fresh posts, or vice versa.
    fresh_reserved += min(len(fresh) - fresh_reserved,
                          priority_count - fresh_reserved - revised_reserved)
    revised_reserved += min(len(revised) - revised_reserved,
                            priority_count - fresh_reserved - revised_reserved)
    selected = fresh[:fresh_reserved] + revised[:revised_reserved]
    selected += backlog[:max(0, limit - len(selected))]
    selected += fresh[fresh_reserved:fresh_reserved + max(0, limit - len(selected))]
    selected += revised[revised_reserved:revised_reserved + max(0, limit - len(selected))]
    return [(url, stamp) for url, stamp, _ in selected[:limit]]


class SubmissionOutcomeUnknown(RuntimeError):
    """Never automatically replay a POST when Bing's receipt is uncertain."""


def classify_failure(exc: Exception) -> str:
    """Public error categories only; never print raw URLs or API credentials."""
    if isinstance(exc, SubmissionOutcomeUnknown):
        return "submission_outcome_unknown"
    detail = str(exc)
    if any(word in detail for word in ("state is missing", "state version", "state structure",
                                       "invalid Bing receipt", "drop previous")):
        return "state_integrity"
    if any(word in detail for word in ("no verified Byeolsemso", "BING_API_KEY",
                                       "HTTP 401", "HTTP 403", "InvalidApiKey",
                                       "Unauthorized", "AccessDenied")):
        return "authentication"
    if "HTTP 429" in detail or "ThrottleHost" in detail:
        return "read_rate_limited"
    if "HTTP 50" in detail or "HTTP 52" in detail or "connection failed" in detail.lower():
        return "transient_read_failure"
    return "validation_or_unexpected"


def bing_submit(posts: dict[str, str], state: dict, api_key: str,
                diagnostics: dict | None = None) -> list[str]:
    saved = state["bing"]
    changed = [(url, stamp) for url, stamp in posts.items()
               if saved.get(url, {}).get("fingerprint") != (stamp or "unknown")]
    metrics = diagnostics if diagnostics is not None else {}
    metrics.update({"daily_quota_remaining_before": None, "monthly_quota_remaining_before": None,
                    "quota_exhausted": False, "api_verified": False, "selected_count": 0})
    if not changed:
        metrics["api_verified"] = False
        return []
    if not api_key:
        raise RuntimeError("BING_API_KEY GitHub Actions secret is missing")
    site_property = bing_verified_site(api_key)
    metrics["api_verified"] = True
    print(f"Bing verified Byeolsemso property: {site_property}")
    key_query = urllib.parse.urlencode({"apikey": api_key})
    quota_url = BING_API + "GetUrlSubmissionQuota?" + urllib.parse.urlencode(
        {"siteUrl": site_property, "apikey": api_key})
    _, quota_body = request(quota_url)
    quota = json.loads(quota_body).get("d") or {}
    daily = max(0, int(quota.get("DailyQuota", 0)))
    monthly = max(0, int(quota.get("MonthlyQuota", 0)))
    metrics["daily_quota_remaining_before"] = daily
    metrics["monthly_quota_remaining_before"] = monthly
    if not daily or not monthly:
        metrics["quota_exhausted"] = True
        print("Bing API quota exhausted; pending URLs will retry later")
        return []
    selection = select_bing_candidates(posts, saved, min(MAX_BING, daily, monthly))
    if not selection:
        return []
    urls = [url for url, _ in selection]
    metrics["selected_count"] = len(urls)
    try:
        _, response_body = request(BING_API + "SubmitUrlBatch?" + key_query,
                                   payload={"siteUrl": site_property, "urlList": urls})
        response_data = json.loads(response_body)
    except (RuntimeError, ValueError, urllib.error.URLError) as exc:
        raise SubmissionOutcomeUnknown(
            "Bing submission outcome uncertain; no automatic POST replay") from None
    if not isinstance(response_data, dict) or response_data.get("d", "unexpected") is not None:
        raise SubmissionOutcomeUnknown(
            "Bing submission response unrecognized; no automatic POST replay")
    submitted_at = now()
    for url, stamp in selection:
        saved[url] = {"fingerprint": stamp or "unknown", "submitted_at": submitted_at}
    return urls


def build_dashboard(posts: dict[str, str], state: dict, report: dict,
                    diagnostics: dict) -> dict:
    """Safe public aggregate: never contains API keys, raw GSC queries or credentials."""
    saved = state["bing"]
    snapshot_at = utc_stamp(report["generated_at"])
    queue = pending_queue(posts, saved, at=snapshot_at)
    pending = [(url, stamp) for url, stamp in posts.items()
               if saved.get(url, {}).get("fingerprint") != (stamp or "unknown")]
    # This is sorted by modified time, NOT time spent waiting in the queue.
    pending.sort(key=lambda row: (utc_stamp(row[1]) or dt.datetime.min.replace(
        tzinfo=dt.timezone.utc), row[0]), reverse=True)
    preview = select_bing_candidates(posts, saved, MAX_BING, at=snapshot_at)
    submitted_stamps = [v.get("submitted_at", "") for url, v in saved.items()
                        if url in posts and isinstance(v, dict) and v.get("submitted_at")]
    last_submission = max(submitted_stamps) if submitted_stamps else None
    return {
        "schema": 1, "site": SITE, "updated_at": report["generated_at"],
        "automation": {
            "last_successful_check_at": report["generated_at"],
            "schedule_expected_interval_hours": 2,
            "stale_after_hours": 5,
            "run_state": "ok",
        },
        "bing_submission": {
            "state": "quota_exhausted" if diagnostics.get("quota_exhausted") else "ok",
            "published_count": len(posts),
            "tracked_submitted_count": len(posts) - len(pending),
            "pending_count": len(pending),
            "submitted_this_run": len(report["bing_submitted"]),
            "last_successful_submission_at": last_submission,
            "daily_quota_remaining_before": diagnostics.get("daily_quota_remaining_before"),
            "monthly_quota_remaining_before": diagnostics.get("monthly_quota_remaining_before"),
            "per_run_cap": MAX_BING,
            "recent_pending": [url for url, stamp in pending[:12]],
            "queue_summary": {
                "first_time_pending": queue["first_time"],
                "changed_since_submission": queue["updated"],
                "recent_new": len(queue["recent_new"]),
                "recent_updated": len(queue["recent_updated"]),
                "older_or_undated": len(queue["backlog"]),
                "without_modified_timestamp": queue["without_timestamp"],
                "priority_preview": [
                    {"url": url,
                     "reason": ("recent_updated" if url in saved else "recent_new")
                     if (utc_stamp(stamp) is not None
                         and dt.timedelta(0) <= snapshot_at - utc_stamp(stamp) <= dt.timedelta(days=7))
                     else "older_or_undated"}
                    for url, stamp in preview[:12]
                ],
                "preview_note": "Illustrative next batch order, not a confirmed submission or queue wait duration.",
            },
            "note": "Bing API URL receipt only. This does not prove crawling, indexing or visibility.",
        },
        "metric_definitions": {
            "submitted": "Bing API accepted URL-submission request (not indexed)",
            "indexed": "Search engine index status, not directly available from Bing submission API",
            "impressions": "Search results display counts provided by Bing Webmaster performance API",
            "clicks": "Visits from Bing search result clicks, not equal to indexed URLs",
        }
    }


def run() -> dict:
    posts = collect_sitemap()
    atom = collect_atom_updates()
    for url, updated in atom.items():
        if url in posts:
            posts[url] = updated
    state = load_state()
    previous = json.loads(json.dumps(state))
    diagnostics = {}
    submitted = bing_submit(posts, state, os.environ.get("BING_API_KEY", ""), diagnostics)
    if state != previous:
        persist_state(previous, state)
    report = {
        "generated_at": now(),
        "site": SITE,
        "published_posts": len(posts),
        "bing_submitted": submitted,
        "bing_pending": sum(state["bing"].get(url, {}).get("fingerprint") != (stamp or "unknown")
                            for url, stamp in posts.items()),
        "note": "Bing URL submission does not guarantee search engine indexing."
    }
    write_json(REPORT_PATH, report)
    write_json(DASHBOARD_PATH, build_dashboard(posts, state, report, diagnostics))
    return report


def main() -> int:
    try:
        report = run()
        print(json.dumps(report, ensure_ascii=False, indent=2))
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            Path(summary).open("a", encoding="utf-8").write(
                "## Byeolsemso indexing\n"
                f"- Published posts: {report['published_posts']}\n"
                f"- Bing submitted this run: {len(report['bing_submitted'])}\n"
                f"- Bing pending: {report['bing_pending']}\n")
        return 0
    except Exception as exc:
        # Keep failure evidence safe for Actions artifacts; no raw exception,
        # endpoint URL, key, or URL list is ever serialized or printed.
        category = classify_failure(exc)
        evidence = {"site": SITE, "generated_at": now(),
                    "category": category, "failure_class": type(exc).__name__,
                    "submitted_this_run": "not_confirmed",
                    "automatic_post_retry": False}
        try:
            write_json(FAILURE_PATH, evidence)
        except OSError:
            pass
        print("::error::Byeolsemso indexing failed: " + category, file=sys.stderr)
        summary = os.environ.get("GITHUB_STEP_SUMMARY")
        if summary:
            with open(summary, "a", encoding="utf-8") as file:
                file.write("## Byeolsemso indexing failure\n"
                           + "- Category: " + category + "\n"
                           + "- POST retry: blocked\n")
        return 1


if __name__ == "__main__":
    # Never run the legacy one-stage pipeline: it cannot durably reserve a batch.
    print("Use scripts/indexing_safe.py prepare/submit through indexing.yml", file=sys.stderr)
    sys.exit(2)
