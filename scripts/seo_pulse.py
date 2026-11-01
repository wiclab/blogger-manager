#!/usr/bin/env python3
"""Public-safe Byeolsemso SEO pulse.

Collect Bing performance privately inside Actions, publish only site totals,
non-sensitive page review links, and reviewable public post expiry signals.
Never persist raw search queries, API keys or Blogger post bodies.
"""
from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

HOST = "wic12.blogspot.com"
SITE = "https://" + HOST + "/"
BING_ROOT = "https://ssl.bing.com/webmaster/api.svc/json/"
BLOGGER_ROOT = "https://www.googleapis.com/blogger/v3"
REPORT = Path("data/seo-pulse.json")
SEO_TZ = ZoneInfo("Asia/Seoul")
BLOG_POST_PATH = re.compile(r"^/\d{4}/\d{2}/[^/]+\.html$")
DATE_JSON = re.compile(r"/Date\((-?\d{10,15})(?:[+-]\d{4})?\)/")
EVENT_TERMS = re.compile(
    r"행사|특별.?할인|혜택|이벤트|모집|접수|마감|신청|공연|예매|쿠폰|캠페인|기간|"
    r"참여|지원|예약|발매|티켓|추첨|스위스|8강|4강|결승|경기|승부의\s*신|종료",
    re.I,
)
DATE_RANGE = re.compile(
    r"(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일?\s*"
    r"(?:부터\s*|[~∼～\-–—]\s*)"
    r"(?:(?:(20\d{2})년\s*)?(\d{1,2})월\s*)?(\d{1,2})일"
)
DATE_DEADLINE = re.compile(
    r"(?:(20\d{2})년\s*)?(\d{1,2})월\s*(\d{1,2})일\s*"
    r"(?:까지|마감|종료|접수\s*종료|신청\s*종료)"
)
ISO_RANGE = re.compile(
    r"(20\d{2})[.-](\d{1,2})[.-](\d{1,2})\s*"
    r"[~∼～\-–—]\s*(?:(20\d{2})[.-])?(\d{1,2})[.-](\d{1,2})"
)


def today_kst() -> dt.date:
    return dt.datetime.now(SEO_TZ).date()


def canonical(raw: str) -> str | None:
    try:
        u = urllib.parse.urlsplit(raw.strip())
        if (u.hostname != HOST or u.scheme not in {"http", "https"}
                or u.username or u.password or u.port is not None
                or not BLOG_POST_PATH.fullmatch(u.path)):
            return None
        return "https://" + HOST + u.path
    except (ValueError, AttributeError):
        return None


def fetch_json(url: str, *, max_bytes: int = 15_000_000) -> dict:
    req = urllib.request.Request(url, headers={
        "User-Agent": "ByeolsemsoSeoPulse/1.0",
        "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=35) as res:
            body = res.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError("API response exceeds permitted size")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError("Unexpected JSON response")
        return result
    except urllib.error.HTTPError as exc:
        # Never print the request URL: Bing uses a secret in its query string.
        raise RuntimeError(f"Remote API HTTP {exc.code}") from None
    except urllib.error.URLError:
        raise RuntimeError("Remote API network error") from None


def bing_call(method: str, site: str, key: str) -> list:
    args = urllib.parse.urlencode({"siteUrl": site, "apikey": key})
    result = fetch_json(f"{BING_ROOT}{method}?{args}")
    if not isinstance(result.get("d"), list):
        raise ValueError(f"{method} returned unexpected Bing data")
    return result["d"]


def verified_bing_site(key: str) -> str:
    sites = fetch_json(BING_ROOT + "GetUserSites?" + urllib.parse.urlencode({"apikey": key})).get("d")
    if not isinstance(sites, list):
        raise ValueError("GetUserSites returned unexpected data")
    for entry in sites:
        if not isinstance(entry, dict) or entry.get("IsVerified") is not True:
            continue
        raw = str(entry.get("Url", ""))
        try:
            u = urllib.parse.urlsplit(raw)
            if (u.hostname == HOST and u.scheme in {"https", "http"}
                    and u.path in {"", "/"} and not u.query and not u.fragment
                    and not u.username and not u.password and u.port is None):
                return raw
        except ValueError:
            continue
    raise ValueError("No verified Byeolsemso Bing site found")


def int_safe(value: object) -> int:
    try:
        return max(0, int(value))
    except (ValueError, TypeError):
        return 0


def ms_date(value: object) -> dt.date | None:
    match = DATE_JSON.fullmatch(str(value or ""))
    if not match:
        return None
    try:
        stamp = int(match.group(1)) / 1000
        return dt.datetime.fromtimestamp(stamp, dt.timezone.utc).date()
    except (OverflowError, OSError, ValueError):
        return None


def summary(rows: list[dict]) -> dict:
    clicks = sum(int_safe(row.get("Clicks")) for row in rows)
    impressions = sum(int_safe(row.get("Impressions")) for row in rows)
    return {
        "clicks": clicks, "impressions": impressions,
        "ctr_pct": round(100 * clicks / impressions, 2) if impressions else 0.0,
    }


def bing_pulse(key: str, reference: dt.date) -> dict:
    property_url = verified_bing_site(key)
    daily = bing_call("GetRankAndTrafficStats", property_url, key)
    queries = bing_call("GetQueryStats", property_url, key)
    pages = bing_call("GetPageStats", property_url, key)

    # Bing can return historical rows without a date window parameter.
    cutoff = reference - dt.timedelta(days=27)
    daily_recent = [r for r in daily if isinstance(r, dict) and
                    (day := ms_date(r.get("Date"))) and cutoff <= day <= reference]
    by_day: dict[str, dict] = {}
    for row in daily_recent:
        day = ms_date(row.get("Date")).isoformat()
        value = by_day.setdefault(day, {"date": day, "clicks": 0, "impressions": 0})
        value["clicks"] += int_safe(row.get("Clicks"))
        value["impressions"] += int_safe(row.get("Impressions"))
    trend = sorted(by_day.values(), key=lambda x: x["date"])
    totals = summary(trend)

    # Page stats may use weekly timestamps; use a 56-day window.
    window = reference - dt.timedelta(days=55)
    filtered_pages = [r for r in pages if isinstance(r, dict) and
                      (day := ms_date(r.get("Date"))) and window <= day <= reference]
    grouped = defaultdict(lambda: {"clicks": 0, "impressions": 0})
    for row in filtered_pages:
        url = canonical(str(row.get("Query", "")))
        if url:
            grouped[url]["clicks"] += int_safe(row.get("Clicks"))
            grouped[url]["impressions"] += int_safe(row.get("Impressions"))
    suggestions = []
    for url, values in grouped.items():
        clicks, impressions = values["clicks"], values["impressions"]
        if impressions >= 20 and (clicks / impressions) < .025:
            suggestions.append((impressions, url))
    suggestions.sort(reverse=True)

    filtered_queries = [r for r in queries if isinstance(r, dict) and
                        (day := ms_date(r.get("Date"))) and window <= day <= reference]
    # Private query strings are deliberately discarded, not written to files or logs.
    query_impressions = defaultdict(lambda: {"clicks": 0, "impressions": 0})
    for row in filtered_queries:
        term = str(row.get("Query", "")).strip()
        if term:
            query_impressions[term]["clicks"] += int_safe(row.get("Clicks"))
            query_impressions[term]["impressions"] += int_safe(row.get("Impressions"))
    low_ctr_terms = sum(1 for values in query_impressions.values()
                        if values["impressions"] >= 20
                        and values["clicks"] / values["impressions"] < .025)

    return {
        "status": "ok",
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "site_property": SITE,
        "window": {"from": cutoff.isoformat(), "to": reference.isoformat(), "type": "daily API values"},
        "totals": totals,
        "daily": trend,
        "query_rows_analyzed": len(query_impressions),
        "low_ctr_query_count": low_ctr_terms,
        "page_review_candidates": [{"url": url, "reason": "노출 대비 클릭률이 낮은 글"}
                                   for _, url in suggestions[:15]],
        "note": "Bing query and page rows can be updated weekly; raw keywords and per-URL metrics are not public.",
    }


def blogger_posts(key: str) -> list[dict]:
    blog = fetch_json(BLOGGER_ROOT + "/blogs/byurl?" + urllib.parse.urlencode({
        "url": SITE, "view": "READER", "key": key,
    }))
    blog_id = str(blog.get("id", ""))
    if not blog_id.isdigit():
        raise ValueError("Unexpected Blogger blog ID")
    collected: list[dict] = []
    token = ""
    pages = 0
    while True:
        args = {"key": key, "maxResults": "500", "fetchBodies": "true",
                "status": "LIVE", "view": "READER"}
        if token:
            args["pageToken"] = token
        data = fetch_json(f"{BLOGGER_ROOT}/blogs/{blog_id}/posts?" +
                          urllib.parse.urlencode(args))
        collected.extend(data.get("items") or [])
        token = str(data.get("nextPageToken") or "")
        pages += 1
        if not token:
            break
        if pages >= 30 or len(collected) > 6000:
            raise ValueError("Unexpected Blogger pagination")
    if not collected:
        raise ValueError("Blogger returned no public posts")
    return [p for p in collected if canonical(str(p.get("url", "")))]


def plaintext(raw: str) -> str:
    clean = re.sub(r"<(script|style)\b[^>]*>[\s\S]*?</\1\s*>", " ", raw, flags=re.I)
    clean = re.sub(r"<[^>]+>", " ", clean)
    clean = html.unescape(clean).replace("\u00a0", " ")
    return re.sub(r"\s+", " ", clean).strip()


def dated(year: int, month: int, day: int) -> dt.date | None:
    try:
        return dt.date(year, month, day)
    except ValueError:
        return None


def detect_deadlines(text: str, year_hint: int) -> list[tuple[dt.date, str]]:
    """Return reviewable date signals, never infer whether an event truly ended."""
    candidates: list[tuple[dt.date, str]] = []
    seen: set[dt.date] = set()
    for pattern in (ISO_RANGE, DATE_RANGE, DATE_DEADLINE):
        for m in pattern.finditer(text):
            left = max(0, m.start() - 55)
            right = min(len(text), m.end() + 22)
            context = text[left:right]
            if not EVENT_TERMS.search(context):
                continue
            if pattern is ISO_RANGE:
                year = int(m.group(4) or m.group(1))
                month, day = int(m.group(5)), int(m.group(6))
            elif pattern is DATE_RANGE:
                year = int(m.group(4) or m.group(1) or year_hint)
                month = int(m.group(5) or m.group(2))
                day = int(m.group(6))
            else:
                year = int(m.group(1) or year_hint)
                month, day = int(m.group(2)), int(m.group(3))
            date = dated(year, month, day)
            if date and date not in seen:
                seen.add(date)
                candidates.append((date, context[:155]))
    return candidates


def stale_pulse(posts: list[dict], reference: dt.date) -> dict:
    items = []
    for post in posts:
        url = canonical(str(post.get("url", "")))
        if not url:
            continue
        published = str(post.get("published", ""))
        year = int(published[:4]) if re.match(r"^20\d{2}", published) else reference.year
        title = str(post.get("title") or "")[:180]
        # Scan both title and public body; only review candidates are persisted.
        content = title + " " + plaintext(str(post.get("content") or ""))[:60000]
        signals = detect_deadlines(content, year)
        valid = [(date, snippet) for date, snippet in signals
                 if -90 <= (date - reference).days <= 7]
        if not valid:
            continue
        # Expired review signals take precedence over approaching dates.
        valid.sort(key=lambda item: (item[0] > reference, abs((item[0] - reference).days)))
        end, snippet = valid[0]
        items.append({
            "title": title,
            "url": url,
            "deadline": end.isoformat(),
            "status": "expired" if end < reference else "upcoming",
            "reason": "본문에 종료/행사 기간으로 보이는 날짜 발견 · 사실 확인 필요",
            "context": snippet,
        })
    items.sort(key=lambda r: (r["status"] != "expired", r["deadline"], r["title"]))
    return {
        "status": "ok", "checked_posts": len(posts),
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "expired_count": sum(x["status"] == "expired" for x in items),
        "upcoming_count": sum(x["status"] == "upcoming" for x in items),
        "items": items[:80],
        "note": "Potential dates only: context can be historical or already updated. Do not auto-edit posts."
    }


def run() -> dict:
    reference = today_kst()
    prior = {}
    if REPORT.exists():
        try:
            prior = json.loads(REPORT.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            prior = {}
    result = {"schema": 1, "site": SITE, "checked_date": reference.isoformat()}
    errors = []
    bing_key = os.environ.get("BING_API_KEY", "").strip()
    blogger_key = os.environ.get("BLOGGER_API_KEY", "").strip()
    try:
        result["bing"] = bing_pulse(bing_key, reference) if bing_key else {
            "status": "not_configured"}
    except Exception as error:
        errors.append(f"Bing API: {type(error).__name__}: {error}")
        result["bing"] = {**prior.get("bing", {}), "status": "stale"}
    try:
        result["stale"] = stale_pulse(blogger_posts(blogger_key), reference) if blogger_key else {
            "status": "not_configured"}
    except Exception as error:
        errors.append(f"Blogger: {type(error).__name__}: {error}")
        result["stale"] = {**prior.get("stale", {}), "status": "stale"}
    result["warnings"] = errors
    if (result["bing"].get("status") == "ok" or
            result["stale"].get("status") == "ok"):
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
                          encoding="utf-8")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as file:
            file.write("## 별셈소 SEO Pulse\n")
            file.write(f"- Bing: {result['bing'].get('status')}\n")
            file.write(f"- 오래된 정보 후보: {result['stale'].get('expired_count', '미확인')}\n")
            file.write(f"- 오류: {len(errors)}\n")
    for warning in errors:
        print("::warning::SEO Pulse: " + warning, file=sys.stderr)
    print(json.dumps({
        "site": SITE, "bing_status": result["bing"].get("status"),
        "bing_clicks_28d": result["bing"].get("totals", {}).get("clicks"),
        "stale_status": result["stale"].get("status"),
        "stale_expired_count": result["stale"].get("expired_count"),
        "warnings": errors
    }, ensure_ascii=False))
    return result


if __name__ == "__main__":
    output = run()
    sys.exit(0 if (output["bing"].get("status") == "ok" or
                   output["stale"].get("status") == "ok") else 1)
