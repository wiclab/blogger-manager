#!/usr/bin/env python3
"""Public-news editorial leads for Byeolsemso, not verified facts or AI search volumes.

No private article bodies, credentials, visitor data, or search terms are persisted.
"""
from __future__ import annotations

import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HOST = "wic12.blogspot.com"
BLOG = "https://" + HOST + "/"
SOURCE = Path("data/news.json")
REPORT = Path("data/news-intelligence.json")
ALERT_STATE = Path("data/news-alert-state.json")
TITLE_CACHE = Path("data/blog-post-titles.json")
NOW_UTC = lambda: dt.datetime.now(dt.timezone.utc)

TOPIC_TERMS = ("요금", "가격", "수수료", "할인", "지원금", "상품권", "자동이체",
               "전기", "통신", "환불", "예매", "쿠폰", "보험", "세금", "연말정산",
               "청년", "교통", "주차", "기차", "공항", "스팀", "스위치", "게임",
               "생활", "지하철", "배터리", "소비", "신청", "기간", "전자제품",
               "연금", "대출", "카드", "배송", "난방", "러닝", "안전", "체크")
CHANGE_TERMS = ("변경", "개편", "인상", "인하", "조정", "확대", "축소",
                "연장", "마감", "종료", "시행", "폐지", "적용", "출시", "발표")
UTILITY_TERMS = ("방법", "기준", "비교", "계산", "얼마", "사용", "지급",
                 "대상", "절약", "확인", "신청", "조건", "기간", "언제")
FOREIGN_CONTEXT = ("베트남", "vietnam", "vnd", "하노이", "호치민",
                   "응우옌", "베트남미디어")
KOREAN_SOURCE_HINTS = ("뉴스", "신문", "일보", "경제", "비즈", "투데이",
                       "저널", "연합", "KBS", "MBC", "SBS", "YTN", "JTBC",
                       "인벤", "게임메카", "게임조선", "디스이즈게임",
                       "전자신문", "ZDNet", "아이뉴스", "헤럴드")
DOMESTIC_POLICY_TERMS = ("전기", "요금", "지원금", "세금", "연말정산",
                         "상품권", "교통비", "연금", "대출", "자동이체")


def foreign_policy_story(title: str, source: str) -> bool:
    combined = (title + " " + source).lower()
    return (any(x in combined for x in FOREIGN_CONTEXT) and
            any(x in title for x in DOMESTIC_POLICY_TERMS))


def trusted_focused_source(item: dict) -> bool:
    """Curated Korean news sources only for Korea-focused policy RSS searches."""
    source = str(item.get("source") or "")
    title = str(item.get("title") or "")
    if not source or foreign_policy_story(title, source):
        return False
    return any(x.lower() in source.lower() for x in KOREAN_SOURCE_HINTS)


AVOID_TERMS = ("사망", "살해", "성폭력", "피살", "강간", "자살", "실종",
               "도박", "폭행", "살인", "체포", "대선", "총선", "탄핵",
               "유세", "지지율", "전쟁", "교전", "미사일", "종목추천",
               "급등주", "코인추천")
STOP = {"2026", "2027", "오늘", "최근", "올해", "내년", "한국", "국내", "해외",
        "진짜", "단독", "속보", "이유", "논란", "화제", "시작", "이번",
        "지난", "이제", "정말", "아직", "바로", "때문", "관련", "우리",
        "있다", "없다", "한다", "했다", "대한", "위한", "누가", "어떻게",
        "news", "최신", "완벽", "정리", "총정리", "안내", "2025",
        "2024", "2023", "예정", "기준", "확인", "방법", "비교", "정보",
        "필수", "필요", "가격", "언제", "어디", "만원", "관계자"}
POST_PATH = re.compile(r"^/\d{4}/\d{2}/[^/]+\.html$")
TOKENS = re.compile(r"[가-힣a-zA-Z0-9]{2,}")
AT = "{http://www.w3.org/2005/Atom}"

# Works both as `python scripts/news_intelligence.py` and as a tested import.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FOCUSED_SEARCHES = (
    ("온누리상품권 OR 정부지원금 OR 소비쿠폰", "경제"),
    ("전기요금 OR 난방비 OR 가스요금", "경제"),
    ("KTX OR 지하철요금 OR 버스요금", "한국"),
    ("연말정산 OR 연금저축 OR 세액공제", "경제"),
    ("스팀할인 OR 닌텐도게임 OR 게임구독", "문화"),
    ("카드환불 OR 자동이체 OR 통신요금", "경제"),
)


def focused_news(now: dt.datetime) -> list[dict]:
    """Optional fresh editorial search RSS; failures never block the base collector."""
    from scripts.news import BASE, PARAMS, parse_feed

    def query_search(entry: tuple[str, str]) -> list[dict]:
        query, category = entry
        url = BASE + "/search?" + urllib.parse.urlencode({
            "q": query, "hl": "ko", "gl": "KR", "ceid": "KR:ko"
        })
        req = urllib.request.Request(
            url, headers={"User-Agent": "ByeolsemsoNewsIntelligence/1.0"})
        with urllib.request.urlopen(req, timeout=12) as response:
            contents = response.read(2_000_001)
        if len(contents) > 2_000_000:
            raise ValueError("Focused RSS response too large")
        return parse_feed(contents, category, now)[:15]

    output = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(query_search, query) for query in FOCUSED_SEARCHES]
        for future in futures:
            try:
                output.extend(future.result())
            except Exception:
                print("One focused news search is unavailable")
    return [x for x in output if trusted_focused_source(x)]



def canonical(url: str) -> str | None:
    try:
        p = urllib.parse.urlsplit(str(url).strip())
        if (p.scheme not in ("http", "https") or p.hostname != HOST or
                p.username or p.password or p.port is not None or
                not POST_PATH.fullmatch(p.path)):
            return None
        return "https://" + HOST + p.path
    except (ValueError, TypeError):
        return None


def tokens(title: str) -> set[str]:
    result = set()
    for raw in TOKENS.findall(title.lower()):
        word = raw
        if word in STOP or word.isdigit():
            continue
        for suffix in ("에서는", "에게는", "으로는", "부터", "까지", "보다", "에서",
                       "으로", "에게", "에도", "에는", "이면", "이면", "했다",
                       "해도", "인데", "이라", "라고", "이라면", "은", "는",
                       "이", "가", "을", "를", "의", "도", "만"):
            if len(word) > len(suffix) + 2 and word.endswith(suffix):
                word = word[:-len(suffix)]
                break
        if len(word) >= 2 and word not in STOP:
            result.add(word)
    return result


def fetch_posts_from_atom() -> tuple[list[dict], str]:
    """Read only public Atom titles and permalinks; never post HTML."""
    posts = {}
    for start in range(1, 2102, 150):
        params = urllib.parse.urlencode({"alt": "atom", "max-results": 150,
                                         "start-index": start})
        req = urllib.request.Request(BLOG + "feeds/posts/default?" + params,
                                     headers={"User-Agent": "ByeolsemsoNewsIntelligence/1.0"})
        with urllib.request.urlopen(req, timeout=18) as response:
            xml = response.read(3_000_001)
        if len(xml) > 3_000_000:
            raise RuntimeError("Atom response too large")
        root = ET.fromstring(xml)
        entries = root.findall(AT + "entry")
        for entry in entries:
            title = (entry.findtext(AT + "title") or "").strip()[:200]
            for link in entry.findall(AT + "link"):
                if link.get("rel") == "alternate":
                    url = canonical(link.get("href", ""))
                    if url and title:
                        posts[url] = title
        if len(entries) < 150:
            if not posts:
                raise RuntimeError("No published posts returned")
            return ([{"url": url, "title": title} for url, title in posts.items()],
                    "complete")
    return ([{"url": url, "title": title} for url, title in posts.items()],
            "partial")


def cached_public_posts() -> list[dict]:
    """Reuse fresh SEO-pulse public title cache during Blogger/Atom outages."""
    try:
        record = json.loads(TITLE_CACHE.read_text(encoding="utf-8"))
        timestamp = dt.datetime.fromisoformat(record["updatedAt"].replace("Z", "+00:00"))
        if record.get("site") != BLOG or (NOW_UTC() - timestamp).total_seconds() > 72 * 3600:
            return []
        if timestamp > NOW_UTC() + dt.timedelta(minutes=5):
            return []
        items = record.get("posts", [])
        if not isinstance(items, list) or len(items) > 10000:
            return []
        checked = {}
        for row in items:
            url = canonical(row.get("url", ""))
            title = str(row.get("title") or "")[:200]
            if url and title:
                checked[url] = title
        return [{"url": url, "title": title} for url, title in checked.items()]
    except (OSError, ValueError, TypeError, KeyError):
        return []


def fetch_posts() -> tuple[list[dict], str]:
    """Try Blogger API, then Atom, then use the public-only title cache."""
    api_key = os.environ.get("BLOGGER_API_KEY", "").strip()
    if api_key:
        try:
            from scripts.seo_pulse import blogger_posts
            posts = [{"url": canonical(p.get("url", "")),
                      "title": str(p.get("title") or "")[:200]}
                     for p in blogger_posts(api_key)]
            posts = [p for p in posts if p["url"] and p["title"]]
            if posts:
                return posts, "complete"
        except Exception:
            print("Blogger title API unavailable; trying public Atom feed")
    try:
        posts, coverage = fetch_posts_from_atom()
    except Exception as exc:
        print("Public post Atom unavailable; trying public title cache:",
              type(exc).__name__)
        posts, coverage = [], "unavailable"
    saved = cached_public_posts()
    if len(saved) > len(posts):
        print("Using latest public title cache for fuller post comparison")
        return saved, "complete"
    return posts, coverage


def expected_post_count() -> int:
    """Cross-check a public sitemap-derived count from the existing indexer."""
    path = Path("data/indexing-dashboard.json")
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        updated = dt.datetime.fromisoformat(record["updated_at"].replace("Z", "+00:00"))
        if abs((NOW_UTC() - updated).total_seconds()) > 7 * 86400:
            return 0
        if record.get("site") != BLOG:
            return 0
        count = record.get("bing_submission", {}).get("published_count", 0)
        return int(count) if 0 < int(count) <= 10000 else 0
    except (OSError, ValueError, KeyError, TypeError):
        return 0


def reconcile_coverage(posts: list[dict], declared: str) -> tuple[str, int]:
    expected = expected_post_count()
    # Public Atom sometimes exposes fewer titles than the real sitemap.
    # Refuse to label that incomplete comparison as complete.
    if declared == "complete" and expected and len(posts) < expected:
        return ("near_complete" if len(posts) >= expected * .95 else "partial"), expected
    return declared, expected


def score_item(item: dict) -> tuple[int, list[str]]:
    title = str(item.get("title", ""))
    category = str(item.get("category", ""))
    if not title or foreign_policy_story(title, str(item.get("source") or "")) or any(term in title for term in AVOID_TERMS):
        return 0, ["편집 제외 주제"]
    score = {"생활·건강": 49, "경제": 49, "기술·AI": 40,
             "한국": 39, "문화": 29, "해외": 22}.get(category, 25)
    reasons = []
    topical = [x for x in TOPIC_TERMS if x in title]
    if topical:
        score += min(28, len(topical) * 11)
        reasons.append("생활형 핵심어: " + ", ".join(topical[:3]))
    changed = [x for x in CHANGE_TERMS if x in title]
    if changed:
        score += 15
        reasons.append("변경·시점 표현: " + ", ".join(changed[:2]))
    useful = [x for x in UTILITY_TERMS if x in title]
    if useful:
        score += min(13, len(useful) * 5)
        reasons.append("독자 질문으로 확장 가능")
    if "?" in title or "까?" in title:
        score += 4
    if category == "해외" and not topical:
        score -= 20
    if not topical:
        score = min(score, 57)
    return max(0, min(99, score)), reasons


def match_posts(title: str, posts: list[dict]) -> list[dict]:
    needle = tokens(title)
    if not needle:
        return []
    matches = []
    for post in posts:
        seen = tokens(post["title"])
        shared = needle & seen
        if not shared:
            continue
        # Two meaningful shared terms, or one distinctive proper/topic term
        # plus a strong fractional match. Still review-only, never automatic.
        distinctive = {x for x in shared if len(x) >= 5 and x not in STOP}
        ratio = len(shared) / max(2, min(len(needle), len(seen)))
        if ((len(shared) >= 2 and ratio >= .37) or
                (distinctive and ratio >= .48)):
            matches.append((ratio, len(shared), post, sorted(shared)))
    matches.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return [{"title": row["title"], "url": row["url"],
             "overlap": shared[:5]} for _, _, row, shared in matches[:3]]


def news_key(item: dict) -> str:
    """Stable across syndicated links and minor punctuation edits."""
    normalized = "".join(sorted(tokens(item.get("title", ""))))
    return hashlib.sha256((item.get("category", "") + ":" + normalized).encode()).hexdigest()[:24]


def build(snapshot: dict, posts: list[dict], coverage: str, now: dt.datetime) -> dict:
    generated_raw = str(snapshot.get("generatedAt") or "")
    generated = dt.datetime.fromisoformat(generated_raw.replace("Z", "+00:00"))
    if generated.tzinfo is None:
        raise ValueError("Naive collection timestamp")
    age_hours = max(0.0, (now - generated).total_seconds() / 3600)
    if age_hours > 12 or age_hours < -0.15:
        raise ValueError("News snapshot is stale or dated in the future")
    items = snapshot.get("items")
    if not isinstance(items, list) or not items or snapshot.get("failedCategories"):
        raise ValueError("News snapshot is incomplete")
    ideas, updates, seen = [], [], set()
    for item in items:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        url = str(item.get("url", "")).strip()
        if not title or not url.startswith("https://"):
            continue
        points, reasons = score_item(item)
        if points < 65:
            continue
        key = news_key(item)
        if key in seen:
            continue
        seen.add(key)
        matches = match_posts(title, posts) if coverage != "unavailable" else []
        entry = {"id": key, "headline": title[:230], "category": item.get("category", ""),
                 "source": str(item.get("source") or "")[:100], "url": url,
                 "publishedAt": item.get("publishedAt", ""),
                 "score": points, "reasons": reasons, "relatedPosts": matches}
        changed = any(term in title for term in CHANGE_TERMS)
        if changed and matches:
            entry["reason"] = "뉴스에 변경·시점 표현이 있고 기존 글 제목과 핵심어가 겹침. 공식 발표 검증 필요."
            updates.append(entry)
        else:
            entry["reason"] = ("이미 다룬 주제와 유사함: 별도 신규 발행 전에 차별점 확인."
                               if matches else "독자 질문형 신규 글감 후보. 중복·사실관계 추가 확인 필요.")
            ideas.append(entry)
    ideas.sort(key=lambda x: (-x["score"], x["headline"]))
    updates.sort(key=lambda x: (-x["score"], x["headline"]))
    return {"version": 1, "site": BLOG, "generatedAt": now.isoformat(),
            "newsGeneratedAt": generated.isoformat(), "newsCount": len(items),
            "postsChecked": len(posts), "postCoverage": coverage,
            "postExpectedCount": expected_post_count(),
            "scoring": "규칙 기반 편집 우선순위, 검색량/검색순위/사실 검증 결과가 아님",
            "ideas": ideas[:40], "updates": updates[:30],
            "note": "검토용 제안. 기사나 공공 정책의 내용은 공식 원문으로 다시 확인하세요. 자동 수정·발행하지 않습니다."}


def save_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def telegram_send(payload: dict, token: str) -> bool:
    """Never print the request URL or credentials."""
    request = urllib.request.Request(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return json.loads(response.read(10000)).get("ok") is True
    except (urllib.error.URLError, ValueError, OSError):
        return False


def alert(report: dict, previous: dict | None = None) -> str:
    """One deduplicated Telegram digest per run, max three leads."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return "not_configured"
    history = {"sent": []}
    if ALERT_STATE.exists():
        try:
            history = json.loads(ALERT_STATE.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            pass
    sent = history.get("sent", [])
    if not isinstance(sent, list):
        sent = []
    recent = {r.get("id") for r in sent if isinstance(r, dict)}
    previous = previous or {}
    invalid_alerts = [
        row for row in (previous.get("ideas", []) + previous.get("updates", []))
        if row.get("id") in recent and
        foreign_policy_story(str(row.get("headline", "")), str(row.get("source", "")))
    ]
    if invalid_alerts and not history.get("foreign_correction_sent"):
        correction = {
            "chat_id": chat_id, "parse_mode": "HTML",
            "disable_web_page_preview": True,
            "text": ("<b>⚠️ 별셈소 뉴스 알림 정정</b>\n"
                     "앞서 보낸 '11월 1일부터 전기요금 2% 인하' 관련 후보는 "
                     "<b>베트남 전기요금 뉴스</b>입니다. 한국 전기요금 인하 "
                     "근거로 사용하면 안 됩니다.\n"
                     "해외 정책 기사는 국내 글감 후보에서 제외하도록 필터를 보강했습니다."),
        }
        if telegram_send(correction, token):
            history["foreign_correction_sent"] = True
            save_json(ALERT_STATE, {**history, "version": 1, "sent": sent})
            return "foreign_policy_correction_sent"
        return "foreign_policy_correction_pending"
    # Post match coverage must be complete to avoid false "new" recommendations.
    candidates = report["updates"] + (report["ideas"] if report["postCoverage"] in {"complete", "near_complete"} else [])
    candidates = [row for row in candidates if row["score"] >= 82 and row["id"] not in recent]
    candidates.sort(key=lambda x: (x not in report["updates"], -x["score"]))
    selected = candidates[:3]
    if not selected:
        return "no_new_high_priority_leads"
    lines = ["<b>별셈소 뉴스 인텔리전스 · 검토 후보</b>",
             "헤드라인만으로 사실 확정 불가 · 자동 게시 없음"]
    for row in selected:
        flag = "갱신 검토" if row in report["updates"] else "신규 글감"
        lines.append(f"• [{flag} {row['score']}점] {html.escape(row['headline'][:100])}")
    lines.append("공식 자료 확인 후 글 작성/갱신 여부를 결정하세요.")
    payload = {"chat_id": chat_id, "text": "\n".join(lines), "parse_mode": "HTML",
               "disable_web_page_preview": True,
               "reply_markup": {"inline_keyboard": [[{
                   "text": "뉴스 인텔리전스 열기",
                   "url": "https://wiclab.github.io/blogger-manager/intelligence.html"
               }]]}}
    if not telegram_send(payload, token):
        return "telegram_unavailable"
    stamped = NOW_UTC().isoformat()
    saved = [{"id": row["id"], "at": stamped} for row in selected]
    save_json(ALERT_STATE, {**history, "version": 1, "sent": (sent + saved)[-150:]})
    return f"sent_{len(selected)}"


def run() -> dict:
    snapshot = json.loads(SOURCE.read_text(encoding="utf-8"))
    now = NOW_UTC()
    posts, coverage = fetch_posts()
    coverage, expected = reconcile_coverage(posts, coverage)
    focused = focused_news(now)
    original_count = len(snapshot.get("items", []))
    snapshot["items"] = (snapshot["items"] + focused)
    report = build(snapshot, posts, coverage, now)
    report["primaryNewsCount"] = original_count
    report["focusedNewsCount"] = len(focused)
    report["postExpectedCount"] = expected
    previous = {}
    if REPORT.exists():
        try:
            previous = json.loads(REPORT.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
    save_json(REPORT, report)
    result = alert(report, previous)
    print(json.dumps({"newsCount": report["newsCount"],
                      "postsChecked": report["postsChecked"],
                      "postCoverage": report["postCoverage"],
                      "ideas": len(report["ideas"]), "updates": len(report["updates"]),
                      "telegram": result}, ensure_ascii=False))
    return report


if __name__ == "__main__":
    run()
