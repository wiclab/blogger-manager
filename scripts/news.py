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

def deduplicate(rows):
    selected = []
    for row in rows:
        key = re.sub(r'[^\w]', '', row['title'].lower())
        if any(row['url'] == x['url'] or difflib.SequenceMatcher(None, key, re.sub(r'[^\w]', '', x['title'].lower())).ratio() >= .78 for x in selected):
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
    items = deduplicate(mixed)[:200]
    validate_items(items)
    payload = dict(generatedAt=now.isoformat(), date=now.astimezone(KST).date().isoformat(), windowHours=24, failedCategories=failures, items=items)
    target = Path('data/news.json')
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Collected {len(items)} headlines; failed feeds: {len(failures)}')

if __name__ == '__main__':
    main()
