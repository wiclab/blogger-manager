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

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "link" and "canonical" in (a.get("rel") or "").lower().split():
            self.canonicals.append(a.get("href") or "")
        if tag == "meta" and (a.get("name") or "").lower() in ("robots", "googlebot"):
            self.robots.append(a.get("content") or "")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http_chain(url: str, max_hops: int = 4) -> dict:
    opener = urllib.request.build_opener(NoRedirect)
    seen, current, status, body = set(), url, None, b""
    for hop in range(max_hops + 1):
        if current in seen or not is_blog_url(current, allow_query=True):
            return {"result": "bad_redirect", "redirects": hop}
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
        except (urllib.error.URLError, TimeoutError):
            return {"result": "network_error", "redirects": hop}
        if status in (301, 302, 303, 307, 308):
            if not location:
                return {"result": "bad_redirect", "redirects": hop}
            current = urllib.parse.urljoin(current, location)
            continue
        if status != 200:
            return {"result": "http_" + str(status), "redirects": hop}
        parser = Tags()
        parser.feed(body.decode("utf-8", errors="replace"))
        return {"result": "ok", "redirects": hop,
                "canonical_ok": len(parser.canonicals) == 1 and
                                 parser.canonicals[0] == url.split("?", 1)[0],
                "noindex": any("noindex" in r.lower() for r in parser.robots)}
    return {"result": "bad_redirect", "redirects": max_hops + 1}


def collect(day: dt.date, previous: dict | None = None) -> dict:
    token = credentials_from_secret()
    urls = rotate(read_sitemap(), day)
    if not urls:
        raise RuntimeError("No URLs selected")
    outcomes, errors, mobile_differences = [], {}, 0
    mobile_checked = 0
    for index, url in enumerate(urls):
        try:
            original = inspect(url, token)
            outcomes.append(original)
            if index < MAX_MOBILE_INSPECTIONS:
                mobile = inspect(url + "?m=1", token)
                mobile_checked += 1
                if ((original.get("verdict"), original.get("coverageState")) !=
                    (mobile.get("verdict"), mobile.get("coverageState"))):
                    mobile_differences += 1
        except RuntimeError as e:
            category = str(e)
            errors[category] = errors.get(category, 0) + 1
            if category.startswith((
                "GSC_API_DISABLED", "GSC_PROPERTY_PERMISSION", "GSC_AUTH_SCOPE",
                "GSC_ACCESS_401", "GSC_ACCESS_403", "GSC_API_QUOTA_429",
                "GSC permission denied", "GSC API quota"
            )):
                raise RuntimeError(category) from None
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
    checks = [http_chain(url) for url in urls[:MAX_HTTP_PROBES]]
    http_summary = {"checked": len(checks), "ok": sum(c["result"] == "ok" for c in checks),
                    "redirect_problem": sum(c["result"] == "bad_redirect" for c in checks),
                    "other_error": sum(c["result"] not in ("ok", "bad_redirect") for c in checks),
                    "canonical_mismatch": sum(c["result"] == "ok" and
                                              not c["canonical_ok"] for c in checks),
                    "noindex": sum(bool(c.get("noindex")) for c in checks)}
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
            "sample": {"eligible_urls": len(read_sitemap()), "inspected_original": len(outcomes),
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
    result = collect(dt.datetime.now(dt.timezone.utc).date(), previous)
    output.parent.mkdir(parents=True, exist_ok=True)
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
