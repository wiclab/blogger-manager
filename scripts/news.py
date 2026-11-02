"""Collect public RSS headlines without API keys or third-party packages."""
import concurrent.futures
import datetime as dt
import difflib
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

KST = dt.timezone(dt.timedelta(hours=9))
BASE = 'https://news.google.com/rss'
PARAMS = '?hl=ko&gl=KR&ceid=KR:ko'
FEEDS = [('한국', BASE + PARAMS)] + [(name, BASE + '/headlines/section/topic/' + topic + PARAMS) for name, topic in [('해외','WORLD'), ('경제','BUSINESS'), ('기술·AI','TECHNOLOGY'), ('문화','ENTERTAINMENT'), ('생활·건강','HEALTH')]]
REQUIRED_ITEM_FIELDS = ('title', 'url', 'source', 'publishedAt', 'category')
FEED_CATEGORIES = {category for category, _ in FEEDS}

def parse_feed(xml, category, now):
    result = []
    for item in ET.fromstring(xml).findall('./channel/item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        source = (item.findtext('source') or '').strip()
        try:
            published = parsedate_to_datetime(item.findtext('pubDate') or '')
            if published.tzinfo is None:
                published = published.replace(tzinfo=dt.timezone.utc)
        except (ValueError, TypeError, OverflowError):
            continue
        age = (now - published).total_seconds()
        if not title or not link.startswith('https://') or not 0 <= age <= 86400:
            continue
        if source and title.endswith(' - ' + source):
            title = title[:-len(source)-3]
        result.append(dict(title=title, url=link, source=source, publishedAt=published.isoformat(), category=category))
    return result

def collect(feed, now):
    category, url = feed
    request = urllib.request.Request(url, headers={'User-Agent':'BloggerManagerNews/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return parse_feed(response.read(2_000_000), category, now)

MATERIAL_CONTRASTS = (
    ('인상', '인하'), ('확대', '축소'), ('시작', '종료'),
    ('승인', '거절'), ('합격', '탈락'), ('유지', '폐지'),
    ('증가', '감소'), ('가능', '불가능'),
)
NUMBERS = re.compile(r'\d+(?:[.,]\d+)*%?')


def materially_different(first, second):
    """Protect titles where amounts, dates or contrasting outcomes differ."""
    a, b = str(first).lower(), str(second).lower()
    if NUMBERS.findall(a) != NUMBERS.findall(b):
        return True
    for left, right in MATERIAL_CONTRASTS:
        if ((left in a and right in b and right not in a)
                or (right in a and left in b and left not in a)):
            return True
    return False


def deduplicate(rows):
    selected = []
    for row in rows:
        key = re.sub(r'[^\w]', '', row['title'].lower())
        if any(
            row['url'] == existing['url'] or (
                not materially_different(row['title'], existing['title'])
                and difflib.SequenceMatcher(
                    None, key, re.sub(r'[^\w]', '', existing['title'].lower())
                ).ratio() >= .78
            )
            for existing in selected
        ):
            continue
        selected.append(row)
    return selected


def validate_items(items):
    """Reject malformed output before it can replace the last good snapshot."""
    if not items:
        raise RuntimeError('News collection produced no items; preserving previous snapshot')
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise RuntimeError(f'News item {index} is not an object; preserving previous snapshot')
        missing = [
            field for field in REQUIRED_ITEM_FIELDS
            if not isinstance(item.get(field), str) or not item[field].strip()
        ]
        if missing:
            raise RuntimeError(
                f'News item {index} missing required fields: {", ".join(missing)}; preserving previous snapshot'
            )
        if not item['url'].startswith('https://'):
            raise RuntimeError(f'News item {index} has an invalid URL; preserving previous snapshot')
        if item['category'] not in FEED_CATEGORIES:
            raise RuntimeError(f'News item {index} has an invalid category; preserving previous snapshot')
        try:
            dt.datetime.fromisoformat(item['publishedAt'])
        except ValueError as error:
            raise RuntimeError(
                f'News item {index} has an invalid publishedAt; preserving previous snapshot'
            ) from error


def failed_categories(groups, failures):
    """Return feed categories that cannot provide a usable snapshot.

    A successful HTTP response is not enough: a feed with no valid, fresh
    headlines is unusable for this snapshot and must not be mistaken for a
    healthy category.
    """
    failed = set(failures)
    failed.update(category for category, _ in FEEDS if not groups.get(category))
    return [category for category, _ in FEEDS if category in failed]

def quality_report(groups, deduped, selected):
    """Public-only metrics describing what entered and left the news collector."""
    categories = {}
    for category, _ in FEEDS:
        raw = groups.get(category, [])
        kept = [row for row in selected if row['category'] == category]
        dates = [row['publishedAt'] for row in raw]
        categories[category] = {
            'fetched': len(raw),
            'displayed': len(kept),
            'uniqueSources': len({row['source'] for row in kept}),
            'newestPublishedAt': max(dates) if dates else None,
        }
    sources = {}
    for row in selected:
        sources[row['source']] = sources.get(row['source'], 0) + 1
    return {
        'version': 1,
        'rawFetched': sum(len(rows) for rows in groups.values()),
        'uniqueAfterDedup': len(deduped),
        'published': len(selected),
        'removedAsDuplicate': sum(len(rows) for rows in groups.values()) - len(deduped),
        'truncatedAtCap': len(deduped) - len(selected),
        'distinctSources': len(sources),
        'topSourceCount': max(sources.values(), default=0),
        'categories': categories,
        'note': 'RSS headline counts only; source diversity is not independent fact verification. '
                'Duplicate similarity is approximate; monetary, date and outcome differences '
                'are conservatively preserved.',
    }


def main():
    now = dt.datetime.now(dt.timezone.utc)
    groups, failures = {}, []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(collect, feed, now): feed[0] for feed in FEEDS}
        for future in concurrent.futures.as_completed(futures):
            category = futures[future]
            try:
                groups[category] = sorted(future.result(), key=lambda x: x['publishedAt'], reverse=True)
            except Exception as error:
                failures.append(category)
                print(f'Feed failed: {category}: {type(error).__name__}')
    failed = failed_categories(groups, failures)
    if failed:
        counts = ', '.join(f'{category}={len(groups.get(category, []))}' for category, _ in FEEDS)
        raise RuntimeError(
            'News collection degraded for '
            + ', '.join(failed)
            + f' ({counts}); preserving previous snapshot'
        )
    # Round robin prevents any one topic from taking all 200 slots.
    mixed = []
    for i in range(max(map(len, groups.values()), default=0)):
        for category, _ in FEEDS:
            if i < len(groups.get(category, [])):
                mixed.append(groups[category][i])
    deduped = deduplicate(mixed)
    items = deduped[:200]
    validate_items(items)
    quality = quality_report(groups, deduped, items)
    payload = dict(generatedAt=now.isoformat(), date=now.astimezone(KST).date().isoformat(), windowHours=24, failedCategories=failures, quality=quality, items=items)
    target = Path('data/news.json')
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Collected {len(items)} headlines; failed feeds: {len(failures)}')

if __name__ == '__main__':
    main()
