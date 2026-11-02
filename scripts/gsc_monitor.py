#!/usr/bin/env python3
"""Read-only Search Console index monitor for Byeolsemso.

Public output contains only aggregate GSC statistics. Never submit indexing
requests or publish credentials / URL-level private Search Console records.
"""
from __future__ import annotations

import datetime as dt
import html.parser
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

SITE = "https://wic12.blogspot.com/"
HOST = "wic12.blogspot.com"
SITEMAP = SITE + "sitemap.xml"
INDEX_API = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
PUBLIC_PAGE = SITE + "p/blog-page.html"
MAX_INSPECTIONS = 20
MAX_MOBILE_INSPECTIONS = 5
MAX_HTTP_PROBES = 8
MAX_SITEMAPS = 15
ANDROID_UA = ("Mozilla/5.0 (Linux; Android 15; Pixel 8) "
              "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")


def is_blog_url(value: str, allow_query: bool = False) -> bool:
    try:
        p = urllib.parse.urlsplit(value)
        return (p.scheme == "https" and p.hostname == HOST
                and p.port is None and not p.username and not p.password
                and (allow_query or not p.query) and not p.fragment)
    except ValueError:
        return False


def get_bytes(url: str, limit: int = 3_000_000) -> bytes:
    if not is_blog_url(url, allow_query=True):
        raise ValueError("Unexpected host in sitemap URL")
    req = urllib.request.Request(url, headers={"User-Agent": "Byeolsemso-GSC-Monitor/1.0"})
    with urllib.request.urlopen(req, timeout=18) as response:
        if not is_blog_url(response.geturl(), allow_query=True):
            raise ValueError("Sitemap redirected to unexpected host")
        return response.read(limit + 1)[:limit]


def read_sitemap() -> list[str]:
    pending, seen, posts = [SITEMAP], set(), set()
    while pending:
        url = pending.pop(0)
        if url in seen:
            continue
        seen.add(url)
        if len(seen) > MAX_SITEMAPS:
            raise ValueError("Too many sitemap files")
        root = ET.fromstring(get_bytes(url))
        kind = root.tag.rsplit("}", 1)[-1]
        locs = [(e.text or "").strip() for e in root.iter()
                if e.tag.rsplit("}", 1)[-1] == "loc"]
        if kind == "sitemapindex":
            pending.extend(x for x in locs if is_blog_url(x, allow_query=True))
        elif kind == "urlset":
            posts.update(x for x in locs if is_blog_url(x) and
                         (re.match(r"^https://wic12\.blogspot\.com/\d{4}/\d{2}/[^/]+\.html$", x)
                          or x == PUBLIC_PAGE))
        else:
            raise ValueError("Unexpected sitemap XML structure")
    if not posts:
        raise ValueError("No published post URLs found; refusing empty report")
    posts.add(PUBLIC_PAGE)
    return sorted(posts)


def rotate(posts: list[str], day: dt.date, count: int = MAX_INSPECTIONS) -> list[str]:
    if not posts or count < 1:
        return []
    # Complete sweep, independent of the size of a Blogger sitemap.
    start = (day.toordinal() * count) % len(posts)
    return [posts[(start + n) % len(posts)] for n in range(min(count, len(posts)))]


def credentials_from_secret():
    """Get short-lived Google token with only non-sensitive error categories."""
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        raise RuntimeError("GSC_SECRET_MISSING: GSC_SERVICE_ACCOUNT_JSON is not configured")
    try:
        info = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("GSC_SECRET_INVALID_JSON: paste the entire original JSON file") from None
    if not isinstance(info, dict) or info.get("type") != "service_account":
        raise RuntimeError("GSC_SECRET_WRONG_TYPE: a service_account JSON key is required")
    for field in ("client_email", "private_key", "private_key_id", "token_uri"):
        if not isinstance(info.get(field), str) or not info[field].strip():
            raise RuntimeError("GSC_SECRET_MISSING_FIELD: " + field) from None
    if not info["client_email"].endswith(".iam.gserviceaccount.com"):
        raise RuntimeError("GSC_SECRET_INVALID_ACCOUNT_EMAIL: check JSON client_email")
    if info["token_uri"] != "https://oauth2.googleapis.com/token":
        raise RuntimeError("GSC_SECRET_UNEXPECTED_TOKEN_ENDPOINT: use the original Google JSON key")
    if "\\n" in info["private_key"] and "\n" not in info["private_key"]:
        raise RuntimeError("GSC_SECRET_ESCAPED_KEY: keep JSON newline escaping unchanged")
    if not info["private_key"].startswith("-----BEGIN PRIVATE KEY-----"):
        raise RuntimeError("GSC_SECRET_INVALID_PRIVATE_KEY: use the original downloaded JSON")
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
        from google.auth.exceptions import RefreshError, TransportError
    except ImportError:
        raise RuntimeError("GSC_DEPENDENCY_MISSING: install google-auth") from None
    try:
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=[SCOPE])
    except (ValueError, TypeError):
        raise RuntimeError("GSC_SECRET_KEY_PARSE_ERROR: copied JSON key is invalid") from None
    try:
        creds.refresh(Request())
    except RefreshError as exc:
        # Do NOT log raw response, JWT, access token, private key, or account email.
        detail = str(exc).lower()
        if "invalid_grant" in detail or "invalid jwt signature" in detail:
            raise RuntimeError(
                "GSC_TOKEN_REJECTED_INVALID_GRANT: check JSON key is active, "
                "belongs to the service account, and is copied without changes") from None
        if "unauthorized_client" in detail or "invalid_client" in detail:
            raise RuntimeError(
                "GSC_TOKEN_CLIENT_REJECTED: verify service account/key is active") from None
        if "invalid_scope" in detail:
            raise RuntimeError("GSC_TOKEN_SCOPE_REJECTED: verify Google API configuration") from None
        raise RuntimeError(
            "GSC_TOKEN_REJECTED_OTHER: Google rejected the credential, "
            "check service-account key state") from None
    except TransportError:
        raise RuntimeError("GSC_TOKEN_NETWORK_ERROR: Google token endpoint unavailable") from None
    except (ValueError, TypeError):
        raise RuntimeError("GSC_TOKEN_OTHER_ERROR: failed to process Google token") from None
    if not creds.token:
        raise RuntimeError("GSC_TOKEN_EMPTY: token endpoint returned no access token")
    return creds.token

def google_api_access_error(error: urllib.error.HTTPError) -> str:
    """Return a safe fixed error category, never a raw Google error message."""
    code = error.code
    reasons = set()
    message = ""
    try:
        payload = json.loads(error.read(16_384).decode("utf-8"))
        info = payload.get("error", {})
        if isinstance(info, dict):
            message = str(info.get("message", "")).lower()
            for item in (info.get("errors") or []) + (info.get("details") or []):
                if isinstance(item, dict):
                    reasons.add(str(item.get("reason", "")).lower())
            reasons.add(str(info.get("status", "")).lower())
    except (ValueError, TypeError, UnicodeDecodeError, AttributeError):
        pass
    if ("service_disabled" in reasons or "accessnotconfigured" in reasons
            or "api has not been used in project" in message
            or ("search console api" in message and "disabled" in message)):
        return "GSC_API_DISABLED: enable Google Search Console API in the JSON key project"
    if ("user does not have sufficient permission for site" in message
            or "not a verified owner of this property" in message):
        return "GSC_PROPERTY_PERMISSION: check exact site property and account access"
    if ("access_token_scope_insufficient" in reasons or
            "insufficient authentication scopes" in message):
        return "GSC_AUTH_SCOPE: Google rejected the read-only scope"
    if code == 401:
        return "GSC_ACCESS_401: access token rejected by Search Console API"
    if code == 403:
        return ("GSC_ACCESS_403: verify API enabled, exact GSC property and "
                "service account permissions")
    if code == 429:
        return "GSC_API_QUOTA_429: rate or daily quota exceeded"
    return "GSC_API_HTTP_" + str(code)


def inspect(url: str, token: str) -> dict:
    if not is_blog_url(url, allow_query=True):
        raise ValueError("Inspection URL outside Byeolsemso")
    payload = json.dumps({"inspectionUrl": url, "siteUrl": SITE,
                          "languageCode": "ko-KR"}).encode()
    req = urllib.request.Request(
        INDEX_API, data=payload,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=22) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(google_api_access_error(error)) from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise RuntimeError("GSC API connection or response failed") from None
    data = result.get("inspectionResult", {}).get("indexStatusResult")
    if not isinstance(data, dict):
        raise RuntimeError("GSC inspection response missing indexStatusResult")
    # Transient in-memory detail. Never serialize this into the public dashboard.
    return {key: data.get(key) for key in
            ("verdict", "coverageState", "robotsTxtState", "indexingState",
             "lastCrawlTime", "pageFetchState", "userCanonical",
             "googleCanonical", "crawledAs")}


class Tags(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonicals = []
        self.robots = []
        self.modified_at = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and "canonical" in (a.get("rel") or "").lower().split():
            self.canonicals.append(a.get("href") or "")
        if tag == "meta" and (a.get("name") or "").lower() in ("robots", "googlebot"):
            self.robots.append(a.get("content") or "")
        if tag == "meta" and a.get("property") == "article:modified_time":
            self.modified_at = a.get("content")
        if tag == "time" and "updated" in (a.get("class") or "").split():
            self.modified_at = a.get("datetime") or self.modified_at


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_chain(url: str, max_hops: int = 4) -> dict:
    opener = urllib.request.build_opener(NoRedirect)
    seen, current, status, body, chain = set(), url, None, b"", []
    checked_at = dt.datetime.now(dt.timezone.utc).isoformat()
    def finish(result, reason, **extra):
        return {"result": result, "reason": reason, "source": "ordinary_http_android",
                "checked_at": checked_at, "chain": chain,
                "redirects": sum(s.get("status") in (301, 302, 303, 307, 308) for s in chain),
                "final_url": chain[-1]["url"] if chain else url,
                "final_status": chain[-1]["status"] if chain else None,
                "unfetched_target": current if chain and current != chain[-1]["url"] else None, **extra}
    for hop in range(max_hops + 1):
        if current in seen:
            return finish("bad_redirect", "redirect_loop")
        if not is_blog_url(current, allow_query=True):
            return finish("bad_redirect", "out_of_scope_target_not_followed")
        seen.add(current)
        req = urllib.request.Request(current, headers={"User-Agent": ANDROID_UA})
        try:
            with opener.open(req, timeout=12) as r:
                status = r.status
                location = r.headers.get("Location")
                body = r.read(400_000)
        except urllib.error.HTTPError as e:
            status = e.code
            location = e.headers.get("Location")
            body = b""
        except (urllib.error.URLError, TimeoutError, OSError):
            status = None
            chain.append({"url": current, "status": None, "location": None})
            return finish("network_error", "network_error")
        chain.append({"url": current, "status": status, "location": location})
        if status in (301, 302, 303, 307, 308):
            if not location:
                return finish("bad_redirect", "missing_location")
            if hop == max_hops:
                return finish("bad_redirect", "redirect_limit_reached")
            try:
                current = urllib.parse.urljoin(current, location)
            except ValueError:
                return finish("bad_redirect", "invalid_location")
            continue
        if status != 200:
            return finish("http_" + str(status), "terminal_http_status")
        parser = Tags()
        text = body.decode("utf-8", errors="replace")
        parser.feed(text)
        modified = re.search(r'"dateModified"\s*:\s*"([^"<>]+)"', text)
        origin = url.split("?", 1)[0]
        mobile_redirect = len(chain) == 2 and chain[0]["status"] == 302 and current == origin + "?m=1"
        return finish("ok", "normal_blogger_mobile_redirect" if mobile_redirect else "http_success",
                      canonical_ok=len(parser.canonicals) == 1 and parser.canonicals[0] == origin,
                      canonicals=parser.canonicals, noindex=any("noindex" in r.lower() for r in parser.robots),
                      modified_at=modified[1] if modified else parser.modified_at)
    raise AssertionError("unreachable")


def collect(day: dt.date, previous: dict | None = None,
            detail_sink: list[dict] | None = None,
            priority_urls: list[str] | None = None,
            focus_urls: list[str] | None = None,
            legacy_http_urls: list[str] | None = None) -> dict:
    token = credentials_from_secret()
    all_urls = read_sitemap()
    focused = list(dict.fromkeys(focus_urls or []))[:15]
    if any(not is_blog_url(u) for u in focused):
        raise RuntimeError("GSC_FOCUS_INVALID: outside allowed blog")
    prioritized = [u for u in (priority_urls or []) if is_blog_url(u)][:6]
    # Retain known targets even when absent from a sitemap; don't silently drop failures.
    capacity = 26 if focused else MAX_INSPECTIONS
    prioritized = list(dict.fromkeys(focused + prioritized))
    regular = rotate(all_urls, day, max(0, capacity - len(prioritized)))
    urls = list(dict.fromkeys(prioritized + regular))
    if len(urls) < min(capacity, len(all_urls)):
        urls.extend(u for u in all_urls if u not in urls)
        urls = urls[:capacity]
    if not urls:
        raise RuntimeError("No URLs selected")
    outcomes, errors, mobile_differences = [], {}, 0
    mobile_checked = 0
    fatal = ("GSC_API_DISABLED", "GSC_PROPERTY_PERMISSION", "GSC_AUTH_SCOPE",
             "GSC_ACCESS_401", "GSC_ACCESS_403", "GSC_API_QUOTA_429",
             "GSC permission denied", "GSC API quota")
    for index, url in enumerate(urls):
        entry = {"url": url, "original": {}, "mobile": None, "http": None,
                 "inspection_source": "gsc_saved_url_inspection_api", "errors": {}}
        variants = ("original", "mobile") if url in focused or index < MAX_MOBILE_INSPECTIONS else ("original",)
        for variant in variants:
            try:
                data = inspect(url + ("?m=1" if variant == "mobile" else ""), token)
                entry[variant] = data
                if variant == "original":
                    outcomes.append(data)
                else:
                    mobile_checked += 1
            except RuntimeError as e:
                category = str(e)
                errors[category] = errors.get(category, 0) + 1
                entry["errors"][variant] = category
                if category.startswith(fatal):
                    raise RuntimeError(category) from None
        if entry["original"] and entry["mobile"] and any(
                entry["original"].get(k) != entry["mobile"].get(k) for k in
                ("verdict", "coverageState", "pageFetchState", "lastCrawlTime", "userCanonical", "googleCanonical")):
            mobile_differences += 1
        if detail_sink is not None:
            detail_sink.append(entry)
    if not outcomes:
        raise RuntimeError("No successful GSC inspections; report unchanged")
    counts = {"indexed": 0, "not_indexed": 0, "unknown": 0,
              "fetch_problem": 0, "noindex": 0, "robots_blocked": 0,
              "recent_crawl": 0}
    cutoff = dt.datetime.combine(day - dt.timedelta(days=7), dt.time.min,
                                 tzinfo=dt.timezone.utc)
    for record in outcomes:
        verdict = record.get("verdict")
        key = "indexed" if verdict == "PASS" else (
            "not_indexed" if verdict in ("FAIL", "NEUTRAL") else "unknown")
        counts[key] += 1
        if record.get("pageFetchState") not in (None, "SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"):
            counts["fetch_problem"] += 1
        if record.get("indexingState") == "BLOCKED_BY_META_TAG" or (
            "BLOCKED" in str(record.get("indexingState"))):
            counts["noindex"] += 1
        if record.get("robotsTxtState") == "DISALLOWED":
            counts["robots_blocked"] += 1
        try:
            crawled = dt.datetime.fromisoformat(
                str(record.get("lastCrawlTime") or "").replace("Z", "+00:00"))
            if crawled.tzinfo and crawled >= cutoff:
                counts["recent_crawl"] += 1
        except ValueError:
            pass
    http_urls = list(dict.fromkeys([u for u in (legacy_http_urls or []) if is_blog_url(u)] + focused + urls[:MAX_HTTP_PROBES]))[:29]
    checks = [http_chain(url) for url in http_urls]
    if detail_sink is not None:
        details_by_url = {e["url"]: e for e in detail_sink}
        for url, check in zip(http_urls, checks):
            if url in details_by_url:
                details_by_url[url]["http"] = check
            else:
                detail_sink.append({"url": url, "original": {}, "mobile": None,
                                    "http": check, "inspection_source": "not_inspected_this_run"})
    http_summary = {"checked": len(checks), "ok": sum(c["result"] == "ok" for c in checks),
                    "redirect_problem": sum(c["result"] == "bad_redirect" for c in checks),
                    "other_error": sum(c["result"] not in ("ok", "bad_redirect") for c in checks),
                    "canonical_mismatch": sum(c["result"] == "ok" and
                                              not c["canonical_ok"] for c in checks),
                    "noindex": sum(bool(c.get("noindex")) for c in checks)}
    from collections import Counter
    http_summary["reason_counts"] = dict(Counter(c.get("reason", "legacy_unknown") for c in checks))
    legacy_checks = [c for u, c in zip(http_urls, checks) if u in (legacy_http_urls or [])]
    http_summary["previous_anomalies_rechecked"] = len(legacy_checks)
    http_summary["previous_anomaly_results"] = dict(Counter(c.get("reason", "legacy_unknown") for c in legacy_checks))
    time = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    alerts = sorted(x for x, hit in (
        ("http_redirect", http_summary["redirect_problem"] > 0),
        ("http_canonical", http_summary["canonical_mismatch"] > 0),
        ("http_noindex", http_summary["noindex"] > 0),
        ("gsc_noindex", counts["noindex"] > 0),
        ("gsc_robots", counts["robots_blocked"] > 0)) if hit)
    entry = {"date": day.isoformat(), "checked": len(outcomes),
             "indexed": counts["indexed"], "not_indexed": counts["not_indexed"],
             "fetch_problem": counts["fetch_problem"], "http_redirect_problem":
             http_summary["redirect_problem"]}
    history = [x for x in (previous or {}).get("history", [])
               if isinstance(x, dict) and x.get("date") != entry["date"]][-29:]
    history.append(entry)
    return {"schema": 1, "site": SITE, "updated_at": time, "status":
            "partial" if errors else "ok", "sample_only": True,
            "sample": {"eligible_urls": len(all_urls), "inspected_original": len(outcomes),
                       "mobile_gsc_compared": mobile_checked,
                       "mobile_status_differences": mobile_differences,
                       "inspection_errors": sum(errors.values()), "counts": counts},
            "http": http_summary, "alerts": alerts, "history": history,
            "note": "Sample inspection only; not the total number of indexed pages. "
                    "GSC API is saved-index status, not a live crawl or indexing request. "
                    "HTTP mobile probes simulate an Android browser, not verified Googlebot."}


def notify_on_new_alerts(current: dict, previous: dict) -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat = os.environ.get("TELEGRAM_CHAT_ID")
    new = set(current.get("alerts", [])) - set(previous.get("alerts", []))
    if not (token and chat and new):
        return
    msg = "⚠️ 별셈소 GSC 관제: 새 이상 징후\n" + ", ".join(sorted(new))
    data = urllib.parse.urlencode({"chat_id": chat, "text": msg}).encode()
    url = "https://api.telegram.org/bot" + token + "/sendMessage"
    try:
        urllib.request.urlopen(urllib.request.Request(url, data=data), timeout=10).close()
    except (urllib.error.URLError, TimeoutError):
        print("Warning: Telegram alert delivery failed", file=sys.stderr)


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/gsc-dashboard.json")
    previous = {}
    if output.is_file():
        try:
            previous = json.loads(output.read_text(encoding="utf-8"))
            if previous.get("site") != SITE:
                raise ValueError("Wrong site in previous report")
        except (ValueError, OSError):
            raise RuntimeError("Existing dashboard invalid; refusing overwrite") from None
    detail_passphrase = os.environ.get("GSC_DETAIL_PASSPHRASE", "")
    details = [] if detail_passphrase else None
    previous_details = None
    encrypted_path = output.with_name("gsc-details.enc.json")
    if detail_passphrase:
        from scripts import gsc_private
        gsc_private.check_passphrase(detail_passphrase)
        if encrypted_path.is_file():
            try:
                sealed = json.loads(encrypted_path.read_text(encoding="utf-8"))
                previous_details = gsc_private.decrypt(sealed, detail_passphrase)
            except (ValueError, OSError):
                raise RuntimeError("GSC_DETAIL_ENCRYPTED_INVALID: refusing overwrite") from None
    selected_focus = (gsc_private.recurring_priority(previous_details,
                      [r["url"] for r in (previous_details or {}).get("records", [])])
                      if detail_passphrase else None)
    from scripts import gsc_diagnostics
    legacy_http_urls = [r["url"] for r in (previous_details or {}).get("records", [])
                        if (r.get("observations") or [{}])[-1].get("http", {}) and
                        (r.get("observations") or [{}])[-1]["http"].get("result") == "bad_redirect"][:6]
    selected_focus = list(dict.fromkeys(legacy_http_urls + (selected_focus or [])))[:6]
    result = collect(dt.datetime.now(dt.timezone.utc).date(), previous,
                     detail_sink=details, priority_urls=selected_focus,
                     focus_urls=list(gsc_diagnostics.FOCUS_URLS) if detail_passphrase else None,
                     legacy_http_urls=legacy_http_urls)
    output.parent.mkdir(parents=True, exist_ok=True)
    if detail_passphrase:
        next_details = gsc_private.merge(previous_details, details, result["updated_at"],
                                        gsc_diagnostics.crawl_evidence_from_secret())
        tracked = [r for r in next_details["records"] if r["url"] in gsc_diagnostics.FOCUS_URLS]
        result["tracking"] = {"focus_target": 15, "focus_recorded": len(tracked),
            "crawl_stats_evidence_loaded": len(next_details.get("crawl_evidence", [])),
            "crawl_stats_mismatches": sum(bool(r["observations"][-1].get("crawl_stats_mismatches")) for r in tracked),
            "modified_dates_known": sum(bool(r.get("modified_at")) for r in tracked),
            "successful_recrawls_after_modification": sum(any(v == "successful_after_modification" for v in r["observations"][-1]["recrawl"]["variants"].values()) for r in tracked)}
        encrypted = gsc_private.encrypt(next_details, detail_passphrase)
        encrypted_tmp = encrypted_path.with_suffix(".tmp")
        encrypted_tmp.write_text(json.dumps(encrypted, separators=(",", ":")) + "\n",
                                 encoding="utf-8")
        encrypted_tmp.replace(encrypted_path)
        print("GSC private URL diagnostics updated (encrypted only)")
    temp = output.with_suffix(".tmp")
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    temp.replace(output)
    notify_on_new_alerts(result, previous)
    print("GSC monitoring: " + result["status"] + ", inspected " +
          str(result["sample"]["inspected_original"]) + " URLs")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, urllib.error.URLError, ET.ParseError) as exc:
        print("GSC monitoring failed: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
