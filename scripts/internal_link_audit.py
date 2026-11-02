#!/usr/bin/env python3
"""Read-only audit of links to blog posts missing from the current LIVE list.

This is a review queue, NOT proof of HTTP 404, Google exclusion, or a broken
redirect. Never modify Blogger posts, submit URLs, or publish API keys.
"""
from __future__ import annotations

import datetime as dt
from collections import Counter
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SITE = "https://wic12.blogspot.com/"
HOST = "wic12.blogspot.com"
BLOGGER_API = "https://www.googleapis.com/blogger/v3"
POST = re.compile(r"^/\d{4}/\d{2}/[^/]+\.html$")
BLOG_ID = re.compile(r"^[0-9]+$")
REPORT = Path("data/internal-link-audit.json")
MAX_PAGES = 20
MAX_POSTS = 5000
MAX_FINDINGS = 100


def canonical_post(value: str, base: str | None = None) -> str | None:
    try:
        url = urllib.parse.urljoin(base or SITE, value)
        u = urllib.parse.urlsplit(url)
        if (u.scheme not in ("http", "https") or u.hostname != HOST
                or u.username or u.password or u.port is not None
                or not POST.fullmatch(u.path)):
            return None
        return "https://" + HOST + u.path
    except (ValueError, TypeError):
        return None


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.links.extend(value for key, value in attrs
                              if key.lower() == "href" and value)


def get_json(path: str, params: dict[str, str], api_key: str) -> dict:
    values = {**params, "key": api_key}
    url = BLOGGER_API + path + "?" + urllib.parse.urlencode(values)
    req = urllib.request.Request(url, headers={
        "Accept": "application/json", "User-Agent": "ByeolsemsoLinkAudit/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=35) as res:
            body = res.read(20_000_001)
        if len(body) > 20_000_000:
            raise RuntimeError("BLOGGER_RESPONSE_TOO_LARGE")
        result = json.loads(body)
        if not isinstance(result, dict):
            raise ValueError("Unexpected JSON root")
        return result
    except urllib.error.HTTPError as exc:
        # URLs contain API keys. Never log the request URL or error response.
        raise RuntimeError(f"BLOGGER_API_HTTP_{exc.code}") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("BLOGGER_API_NETWORK_ERROR") from None
    except (ValueError, UnicodeError):
        raise RuntimeError("BLOGGER_API_INVALID_RESPONSE") from None


def fetch_live_posts(api_key: str) -> list[dict]:
    if not api_key:
        raise RuntimeError("BLOGGER_API_KEY_MISSING")
    metadata = get_json("/blogs/byurl", {"url": SITE, "view": "READER"}, api_key)
    blog_id = str(metadata.get("id", ""))
    if (not BLOG_ID.fullmatch(blog_id)
            or urllib.parse.urlsplit(str(metadata.get("url", ""))).hostname != HOST):
        raise RuntimeError("BLOGGER_WRONG_BLOG")
    posts, token, seen_tokens = [], "", set()
    for _ in range(MAX_PAGES):
        options = {"status": "LIVE", "view": "READER",
                   "fetchBodies": "true", "maxResults": "500"}
        if token:
            options["pageToken"] = token
        page = get_json("/blogs/" + blog_id + "/posts", options, api_key)
        batch = page.get("items", [])
        if not isinstance(batch, list):
            raise RuntimeError("BLOGGER_POSTS_INVALID")
        posts.extend(batch)
        if len(posts) > MAX_POSTS:
            raise RuntimeError("BLOGGER_TOO_MANY_POSTS")
        next_token = page.get("nextPageToken")
        if not next_token:
            break
        if not isinstance(next_token, str) or next_token in seen_tokens:
            raise RuntimeError("BLOGGER_PAGINATION_INVALID")
        seen_tokens.add(next_token)
        token = next_token
    else:
        raise RuntimeError("BLOGGER_PAGINATION_EXCEEDED")
    if not posts:
        raise RuntimeError("BLOGGER_POSTS_EMPTY")
    # A partial or wrong-host list must never produce false missing-link claims.
    normalized, seen = [], set()
    for item in posts:
        if not isinstance(item, dict) or not isinstance(item.get("content"), str):
            raise RuntimeError("BLOGGER_POST_INVALID")
        url = canonical_post(item.get("url", ""))
        if not url:
            raise RuntimeError("BLOGGER_POST_WRONG_HOST_OR_PATH")
        if url in seen:
            raise RuntimeError("BLOGGER_DUPLICATE_POST_URL")
        seen.add(url)
        post_id = str(item.get("id") or "")
        normalized.append({"url": url, "content": item["content"],
                           "title": str(item.get("title") or ""),
                           "published": str(item.get("published") or ""),
                           "labels": item.get("labels") if isinstance(item.get("labels"), list) else [],
                           "blog_id": blog_id,
                           "post_id": post_id if BLOG_ID.fullmatch(post_id) else ""})
    return normalized


GENERIC_TERMS = {
    "방법", "확인", "확인하기", "확인할", "비교", "정리", "기준", "추천", "정보",
    "계산기", "계산", "가이드", "2026", "2027", "대한민국", "한국",
    "어떻게", "사용", "이유", "안내", "순서", "시간", "개월", "만원", "진짜",
    "얼마나", "얼마", "내야", "할까", "될까", "해야", "싶다면", "해지하면",
    "다를까", "뭐가", "사야", "언제", "전", "후", "기록", "일정", "종료된",
    "준비물", "지나면", "차이", "할인", "무료", "계속", "켜기", "다시",
    "매일", "하루", "일반", "만약", "변경", "공식", "기본", "핵심", "관리",
    "사례", "차이와", "상세", "누가", "어떤", "가지", "수수료", "할인", "대응",
    "체크", "체크리스트", "계산해봤습니다", "방법은", "됐는데", "바꾸면",
    "줄어들까", "안에", "분", "달", "개월권", "정말", "왜", "서비스",
    "휴대폰", "스마트폰", "아이폰", "갤럭시", "인터넷", "구글", "서울",
    "게임", "카드", "결제", "얼마일까", "될까요", "미리", "사용법", "안전",
    "목록", "일정은", "놓치면", "사이트", "조건", "필요", "대상", "결과",
    "the", "for", "and", "guide", "how", "best",
}
GENERIC_LABELS = {"생활정보", "생활 정보", "정보", "블로그", "blog", "data",
                  "생활계산", "게임", "건강·운동", "건강", "생활"}
TITLE_WORD = re.compile(r"[가-힣]{2,}|[a-zA-Z0-9]{3,}")


def title_terms(value: str) -> set[str]:
    return {x for x in TITLE_WORD.findall(value.lower())
            if x not in GENERIC_TERMS and not x.isdigit()}


def specific_labels(post: dict) -> set[str]:
    labels = post.get("labels") or []
    return {str(x).strip().lower() for x in labels
            if isinstance(x, str) and str(x).strip().lower() not in GENERIC_LABELS}


def blogger_edit_url(post: dict) -> str | None:
    """Official Blogger editor for a LIVE post, never a guessed post ID."""
    blog_id = str(post.get("blog_id") or "")
    post_id = str(post.get("post_id") or "")
    if not BLOG_ID.fullmatch(blog_id) or not BLOG_ID.fullmatch(post_id):
        return None
    if canonical_post(post.get("url", "")) != post.get("url"):
        return None
    return f"https://www.blogger.com/blog/post/edit/{blog_id}/{post_id}"


def opportunities(posts: list[dict], incoming: dict[str, set[str]],
                  outgoing: dict[str, set[str]], limit: int = 500) -> dict:
    """Candidate links only: 0/1 body inlinks, not proof of Google orphan status."""
    by_url = {p["url"]: p for p in posts}
    words = {u: title_terms(p.get("title", "")) for u, p in by_url.items()}
    labels = {u: specific_labels(p) for u, p in by_url.items()}
    frequency = Counter(term for terms in words.values() for term in terms)
    counts = {u: len(incoming[u]) for u in by_url}
    # Most isolated first, then oldest publish date (unknown dates last).
    candidates = sorted(by_url, key=lambda u: (
        counts[u], by_url[u].get("published") or "9999", u))
    underserved = [u for u in candidates if counts[u] <= 1]
    result = []
    for target in underserved[:limit]:
        suggestions = []
        for source in by_url:
            if source == target or target in outgoing[source]:
                continue
            common = sorted(words[target] & words[source])
            overlap = sorted(labels[target] & labels[source])
            # Require at least one distinct, relatively rare topic expression:
            # generic words and common devices/categories alone are not evidence.
            distinctive = [term for term in common
                           if len(term) >= 3 and frequency[term] <= 4]
            if not distinctive:
                continue
            if len(common) < 2 and not overlap:
                continue
            suggestions.append({
                "source": source,
                "source_title": by_url[source].get("title") or source.rsplit("/", 1)[-1],
                "source_edit_url": blogger_edit_url(by_url[source]),
                "shared_terms": common[:5],
                "shared_labels": overlap[:3],
                "confidence": "title_and_label" if overlap else "rare_title_term",
            })
        suggestions.sort(key=lambda x: (-len(x["shared_terms"]),
                                         -len(x["shared_labels"]), x["source"]))
        result.append({
            "url": target,
            "title": by_url[target].get("title") or target.rsplit("/", 1)[-1],
            "published": by_url[target].get("published") or None,
            "inbound_from_other_posts": counts[target],
            "suggested_sources": suggestions[:3],
            "suggestions_found": len(suggestions),
        })
    return {
        "zero_body_inbound_count": sum(count == 0 for count in counts.values()),
        "one_body_inbound_count": sum(count == 1 for count in counts.values()),
        "candidate_total": len(underserved),
        "candidates_truncated": len(underserved) > limit,
        "candidates": result,
        "definition": "Links counted only from <a href> in other LIVE post bodies; "
                      "site navigation, home, labels, sitemap and external links are "
                      "not included. Zero body inlinks does NOT prove orphaned URL, "
                      "low quality or Google indexing failure. Suggestions are "
                      "conservative distinctive title/label overlap candidates, not a directive "
                      "to add unrelated links.",
    }


def audit(posts: list[dict], *, at: dt.datetime | None = None) -> dict:
    if not posts:
        raise ValueError("Empty LIVE post list cannot verify missing targets")
    live_urls = {p["url"] for p in posts}
    if len(live_urls) != len(posts):
        raise ValueError("Duplicate post URL")
    incoming: dict[str, set[str]] = {}
    inbound_live: dict[str, set[str]] = {url: set() for url in live_urls}
    outbound_live: dict[str, set[str]] = {url: set() for url in live_urls}
    links_checked = 0
    known_links = 0
    for post in posts:
        source = post["url"]
        if canonical_post(source) != source:
            raise ValueError("Invalid source blog post URL")
        parser = LinkParser()
        parser.feed(post["content"])
        for href in parser.links:
            target = canonical_post(href, source)
            if not target:
                continue
            links_checked += 1
            if target in live_urls:
                known_links += 1
                if target != source:
                    inbound_live[target].add(source)
                    outbound_live[source].add(target)
                continue
            incoming.setdefault(target, set()).add(source)
    ordered = sorted(incoming.items(), key=lambda x: (-len(x[1]), x[0]))
    now = at or dt.datetime.now(dt.timezone.utc)
    return {
        "schema": 1, "site": SITE, "checked_at": now.isoformat(timespec="seconds"),
        "status": "review_required" if ordered else "no_missing_targets_observed",
        "live_posts_checked": len(posts),
        "post_links_checked": links_checked,
        "links_to_live_posts": known_links,
        "unlisted_target_count": len(ordered),
        "affected_source_count": len({s for _, sources in ordered for s in sources}),
        "link_opportunities": opportunities(posts, inbound_live, outbound_live),
        "findings_total": len(ordered),
        "findings_truncated": len(ordered) > MAX_FINDINGS,
        "findings": [{"target": target, "sources": sorted(sources)[:20],
                      "source_count": len(sources), "sources_truncated": len(sources) > 20,
                      "classification": "not_in_current_live_posts_list"}
                     for target, sources in ordered[:MAX_FINDINGS]],
        "note": "These post-like internal URLs are absent from the current Blogger "
                "LIVE list. They may be deleted, unpublished, redirected or an "
                "outdated link. This does not prove HTTP 404 or Google indexing "
                "failure. Review before editing; no posts were changed.",
    }


def main() -> int:
    data = audit(fetch_live_posts(os.environ.get("BLOGGER_API_KEY", "").strip()))
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    temp = REPORT.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")
    temp.replace(REPORT)
    print("Live posts scanned: " + str(data["live_posts_checked"]))
    print("Post-shaped internal hrefs checked: " + str(data["post_links_checked"]))
    print("Unlisted target URLs requiring review: " + str(data["unlisted_target_count"]))
    print("Zero incoming body-link posts: " + str(data["link_opportunities"]["zero_body_inbound_count"]))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError) as exc:
        # No API key, request URL, raw body or credentials in logs.
        print("Internal link audit failed: " + str(exc), file=sys.stderr)
        raise SystemExit(1)
