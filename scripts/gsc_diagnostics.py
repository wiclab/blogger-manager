"""Evidence-aware diagnostics. No submissions; no private GSC baseline in code."""
from __future__ import annotations

import datetime as dt
import json
import os
import urllib.parse

SITE = "https://wic12.blogspot.com/"
# Only public URLs, not historical GSC results, are kept on the code branch.
FOCUS_PATHS = (
    "2026/09/power-strip-daisy-chain-overload-calculator.html",
    "2026/09/computer-24-hours-electricity-cost-sleep-shutdown-calculator.html",
    "2026/09/water-meter-moving-no-use-leak-check-calculation.html",
    "2026/09/home-water-leak-who-to-call-guide.html",
    "2026/09/overseas-card-cancel-refund-exchange-rate.html",
    "2026/09/auto-transfer-weekend-holiday-withdrawal.html",
    "2026/08/credit-card-payment-date-change.html",
    "2026/09/credit-card-payment-afternoon-deposit.html",
    "2026/09/bump-ice-pack-how-long.html",
    "2026/09/2026-chuseok-national-events.html",
    "2026/09/first-trail-running-too-hard-recovery.html",
    "2026/09/beginner-running-three-times-a-week-rest-days.html",
    "2026/09/what-koreans-do-after-work.html",
    "2026/09/one-won-verification-million-times.html",
    "2026/09/semiconductor-exports-drop-korea-total-exports.html",
)
FOCUS_URLS = tuple(SITE + p for p in FOCUS_PATHS)


def group_url(url: str) -> str:
    from scripts.gsc_monitor import is_blog_url
    if not is_blog_url(url, allow_query=True):
        raise ValueError("GSC_DETAIL_URL_REJECTED: outside allowed blog")
    parts = urllib.parse.urlsplit(url)
    if parts.query not in ("", "m=1"):
        raise ValueError("GSC_DETAIL_URL_REJECTED: unsupported query")
    return urllib.parse.urlunsplit(parts._replace(query=""))


def timestamp(value):
    try:
        t = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return t if t.tzinfo else None
    except (ValueError, TypeError):
        return None


def crawl_evidence_from_secret() -> list[dict]:
    """Optional manually exported crawl-stat evidence, never a simulated probe.

    Search Console has no Crawl Stats API. Never fabricate an API data feed.
    The user can supply an export as GSC_CRAWL_EVIDENCE_JSON, or import locally
    in the dashboard. This secret is optional; existing monitoring still works.
    """
    raw = os.environ.get("GSC_CRAWL_EVIDENCE_JSON", "")
    if not raw:
        return []
    try:
        values = json.loads(raw)
        if not isinstance(values, list) or len(values) > 500:
            raise ValueError()
        clean = []
        for x in values:
            if not isinstance(x, dict) or not timestamp(x.get("crawled_at")):
                raise ValueError()
            group_url(x["url"])
            if type(x.get("status")) is not int or not 100 <= x["status"] <= 599:
                raise ValueError()
            clean.append({"url": x["url"], "crawled_at": x["crawled_at"],
                          "status": x["status"], "source": "gsc_crawl_stats_export",
                          "agent": x.get("agent") if x.get("agent") in ("SMARTPHONE", "DESKTOP") else None,
                          "imported_at": dt.datetime.now(dt.timezone.utc).isoformat()})
        return clean
    except (ValueError, TypeError, KeyError):
        raise RuntimeError("GSC_CRAWL_EVIDENCE_INVALID: invalid private crawl export") from None


def differences(before: dict, after: dict) -> list[dict]:
    changes = []
    for variant in ("original", "mobile"):
        old, new = before.get(variant), after.get(variant)
        if not isinstance(old, dict) or not isinstance(new, dict) or not old or not new:
            continue
        for key in ("verdict", "coverageState", "pageFetchState", "lastCrawlTime",
                    "userCanonical", "googleCanonical", "robotsTxtState", "indexingState"):
            if old.get(key) != new.get(key):
                changes.append({"variant": variant, "field": key,
                                "before": old.get(key), "after": new.get(key)})
    return changes


def recrawl_state(snapshot: dict, modified_at: str | None) -> dict:
    modified = timestamp(modified_at)
    result = {}
    for variant in ("original", "mobile"):
        record = snapshot.get(variant) or {}
        crawled = timestamp(record.get("lastCrawlTime"))
        result[variant] = ("unknown" if not modified or not crawled else
                           "successful_after_modification" if crawled >= modified and
                           record.get("pageFetchState") == "SUCCESSFUL" else
                           "attempted_after_modification_fetch_failed" if crawled >= modified else
                           "crawl_predates_modification")
    return {"modified_at": modified_at, "modified_source": "current_public_html",
            "variants": result}


def evidence_mismatches(url: str, snapshot: dict, evidence: list[dict]) -> list[dict]:
    found = []
    for e in evidence:
        if group_url(e["url"]) != url or e.get("status") != 200:
            continue
        variant = "mobile" if e["url"].endswith("?m=1") else "original"
        saved = snapshot.get(variant)
        if not isinstance(saved, dict) or not saved:
            continue
        observed, saved_time = timestamp(e.get("crawled_at")), timestamp(saved.get("lastCrawlTime"))
        if observed and (not saved_time or observed > saved_time):
            found.append({"variant": variant, "evidence": e,
                          "reason": "crawl_stats_success_missing_or_newer_than_saved_inspection",
                          "cause": "unconfirmed"})
    return found
