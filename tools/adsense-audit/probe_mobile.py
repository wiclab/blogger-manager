#!/usr/bin/env python3
"""Small read-only diagnostic for Blogger ?m=1 redirects; never treats tool errors as site redirects."""
import json
import time
from urllib.parse import urlsplit, urlunsplit
import requests

ROOT = "https://wic12.blogspot.com"
PATHS = [
    "/2026/09/google-nuclear-power-20-years-ai-electricity.html",
    "/2026/09/ai-data-center-korea-power-nuclear-20.html",
    "/2026/11/digital-onnuri-10-percent-november-2026.html",
]
TIMEOUT = 16
UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36"


def inspect(session, url):
    try:
        r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
    except requests.TooManyRedirects as exc:
        return {"requested_url": url, "outcome": "REDIRECT_LOOP", "detail": str(exc)[:180]}
    except requests.RequestException as exc:
        return {"requested_url": url, "outcome": "NETWORK_ERROR", "detail": str(exc)[:180]}
    chain = [{"status": item.status_code, "url": item.url,
              "location": item.headers.get("Location", "")} for item in r.history]
    res = {"requested_url": url, "status": r.status_code, "final_url": r.url,
           "redirect_count": len(chain), "history": chain,
           "content_type": r.headers.get("Content-Type", ""),
           "content_length": len(r.content),
           "server": r.headers.get("Server", "")}
    if r.status_code == 429:
        res["outcome"] = "RATE_LIMIT_NOT_REDIRECT"
        res["retry_after"] = r.headers.get("Retry-After", "")
    elif r.status_code == 200:
        res["outcome"] = "OK_WITH_REDIRECT" if chain else "OK_NO_REDIRECT"
    elif 300 <= r.status_code < 400:
        res["outcome"] = "UNRESOLVED_REDIRECT"
    else:
        res["outcome"] = "OTHER_HTTP_ERROR"
    return res


def main():
    session = requests.Session()
    session.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    results = []
    for path in PATHS:
        for suffix in ("", "?m=1"):
            url = ROOT + path + suffix
            result = inspect(session, url)
            print(json.dumps(result, ensure_ascii=False), flush=True)
            results.append(result)
            if result.get("status") == 429:
                print("Stopping after HTTP 429 to respect rate limit", flush=True)
                with open("mobile-probe.json", "w", encoding="utf-8") as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)
                return
            time.sleep(1.5)
    with open("mobile-probe.json", "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
