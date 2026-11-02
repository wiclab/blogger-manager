import datetime as dt
import unittest
from scripts.news import FEEDS, deduplicate, failed_categories, parse_feed, validate_items, quality_report, materially_different
class NewsCollectorTests(unittest.TestCase):
    def test_empty_category_is_treated_as_collection_failure(self):
        groups = {category: [{'title': category}] for category, _ in FEEDS}
        groups['생활·건강'] = []
        self.assertEqual(
            failed_categories(groups, []),
            ['생활·건강'],
        )
    def test_exception_category_is_reported_in_feed_order(self):
        groups = {category: [{'title': category}] for category, _ in FEEDS}
        self.assertEqual(
            failed_categories(groups, ['경제', '한국']),
            ['한국', '경제'],
        )
    def test_all_categories_are_required(self):
        groups = {}
        self.assertEqual(
            failed_categories(groups, []),
            [category for category, _ in FEEDS],
        )
    def test_parse_feed_accepts_only_fresh_items(self):
        now = dt.datetime(2026, 10, 3, 4, 34, tzinfo=dt.timezone.utc)
        xml = '''
        <rss><channel>
          <item><title>Fresh</title><link>https://example.com/fresh</link>
            <source>Example</source><pubDate>Sat, 03 Oct 2026 04:00:00 GMT</pubDate></item>
          <item><title>Old</title><link>https://example.com/old</link>
            <source>Example</source><pubDate>Fri, 02 Oct 2026 04:33:59 GMT</pubDate></item>
          <item><title>Future</title><link>https://example.com/future</link>
            <source>Example</source><pubDate>Sat, 03 Oct 2026 04:35:00 GMT</pubDate></item>
        </channel></rss>
        '''
        rows = parse_feed(xml.encode(), '한국', now)
        self.assertEqual([row['title'] for row in rows], ['Fresh'])

    def test_validate_items_rejects_incomplete_output(self):
        with self.assertRaisesRegex(RuntimeError, 'missing required fields: source'):
            validate_items([
                {
                    'title': 'Headline',
                    'url': 'https://example.com/news',
                    'publishedAt': '2026-10-03T04:00:00+00:00',
                    'category': '한국',
                },
            ])

    def test_validate_items_rejects_empty_output(self):
        with self.assertRaisesRegex(RuntimeError, 'produced no items'):
            validate_items([])

    def test_deduplicate_removes_same_url_and_similar_title(self):
        rows = [
            {'title': 'AI가 만든 뉴스', 'url': 'https://example.com/1'},
            {'title': 'AI가 만든 뉴스', 'url': 'https://example.com/2'},
            {'title': '완전히 다른 뉴스', 'url': 'https://example.com/3'},
        ]
        self.assertEqual(
            [row['url'] for row in deduplicate(rows)],
            ['https://example.com/1', 'https://example.com/3'],
        )

    def test_numeric_changes_do_not_get_suppressed_as_duplicate_news(self):
        rows = [
            {'title': '통신요금 10% 인상 발표', 'url': 'https://news.google.com/1'},
            {'title': '통신요금 20% 인상 발표', 'url': 'https://news.google.com/2'},
            {'title': '지원금 신청 11월 2일 마감', 'url': 'https://news.google.com/3'},
            {'title': '지원금 신청 11월 3일 마감', 'url': 'https://news.google.com/4'},
        ]
        self.assertEqual(len(deduplicate(rows)), 4)

    def test_opposite_change_and_duplicate_still_distinguished(self):
        rows = [
            {'title': '전기요금 5% 인상 확정', 'url': 'https://news.google.com/a'},
            {'title': '전기요금 5% 인하 확정', 'url': 'https://news.google.com/b'},
            {'title': '전기요금 5% 인상 확정!', 'url': 'https://news.google.com/c'},
        ]
        self.assertEqual([x['url'] for x in deduplicate(rows)],
                         ['https://news.google.com/a', 'https://news.google.com/b'])
        self.assertTrue(materially_different(rows[0]['title'], rows[1]['title']))
        self.assertFalse(materially_different(rows[0]['title'], rows[2]['title']))

    def test_quality_report_counts_coverage_and_duplicate_losses(self):
        now = '2026-11-02T10:00:00+00:00'
        def item(title, category, source):
            return {'title': title, 'category': category, 'source': source,
                    'url': 'https://news.google.com/' + title, 'publishedAt': now}
        groups = {c: [item(c + ' X', c, '통신사')] for c, _ in FEEDS}
        mixed = [row for cat in groups.values() for row in cat]
        mixed.append(item('한국 X', '한국', '신문사'))
        deduped = deduplicate(mixed)
        report = quality_report(groups, deduped, deduped[:3])
        self.assertEqual(report['rawFetched'], 6)
        self.assertEqual(report['published'], 3)
        self.assertEqual(report['truncatedAtCap'], len(deduped) - 3)
        self.assertEqual(report['categories']['한국']['fetched'], 1)
        self.assertEqual(report['categories']['한국']['uniqueSources'], 1)
        self.assertEqual(report['distinctSources'], 1)
        self.assertEqual(report['topSourceCount'], 3)

if __name__ == '__main__':
    unittest.main()
