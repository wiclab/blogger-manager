import datetime as dt
import unittest
from scripts.news import FEEDS, deduplicate, failed_categories, parse_feed
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
if __name__ == '__main__':
    unittest.main()
