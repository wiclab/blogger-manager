"""Deterministic, offline regression tests for the editorial news radar."""
import datetime as dt
import unittest
from unittest.mock import patch
from scripts.news_intelligence import (
    build, canonical, match_posts, news_key, score_item, tokens,
    reconcile_coverage, focused_news,
)

NOW = dt.datetime(2026, 11, 2, 0, 0, tzinfo=dt.timezone.utc)


def article(title, category="경제"):
    return {
        "title": title, "url": "https://news.google.com/rss/articles/example",
        "source": "공개 뉴스", "publishedAt": NOW.isoformat(),
        "category": category,
    }


class NewsIntelligenceTests(unittest.TestCase):
    def test_blog_only_real_published_posts(self):
        self.assertEqual(
            canonical("http://wic12.blogspot.com/2026/11/post.html?m=1"),
            "https://wic12.blogspot.com/2026/11/post.html",
        )
        for url in ("https://qevnaxori.blogspot.com/2026/11/post.html",
                    "https://evil.com/2026/11/post.html",
                    "https://wic12.blogspot.com/feeds/posts/default",
                    "https://wic12.blogspot.com.evil.com/2026/11/post.html"):
            self.assertIsNone(canonical(url))

    def test_token_matching_requires_semantic_overlap(self):
        posts = [
            {"title": "디지털 온누리상품권 할인 구매 방법",
             "url": "https://wic12.blogspot.com/2026/11/onnuri.html"},
            {"title": "주 3회 러닝 운동 루틴",
             "url": "https://wic12.blogspot.com/2026/11/running.html"},
        ]
        matches = match_posts("디지털 온누리상품권 할인 기간 연장", posts)
        self.assertEqual(matches[0]["title"], posts[0]["title"])
        self.assertFalse(match_posts("불꽃놀이가 시작됐다", posts))

    def test_score_policy_and_exclusion(self):
        self.assertGreaterEqual(score_item(article("온누리상품권 할인 기간 연장"))[0], 80)
        self.assertEqual(score_item(article("총선 지지율 급등"))[0], 0)

    def test_update_requires_existing_post_and_change_signal(self):
        posts = [{"title": "디지털 온누리상품권 할인 구매 방법",
                  "url": "https://wic12.blogspot.com/2026/11/onnuri.html"}]
        items = [article("디지털 온누리상품권 할인 기간 연장"),
                 article("자동이체 수수료 인하 방법")]
        snap = {"generatedAt": NOW.isoformat(), "items": items, "failedCategories": []}
        result = build(snap, posts, "complete", NOW)
        self.assertEqual(result["postsChecked"], 1)
        self.assertEqual(len(result["updates"]), 1)
        self.assertTrue(result["updates"][0]["relatedPosts"])
        self.assertIn("공식 발표 검증", result["updates"][0]["reason"])

    def test_no_unverified_duplicate_claim_without_post_data(self):
        snap = {"generatedAt": NOW.isoformat(),
                "items": [article("온누리상품권 할인 기간 연장")],
                "failedCategories": []}
        result = build(snap, [], "unavailable", NOW)
        self.assertEqual(result["postCoverage"], "unavailable")
        self.assertFalse(result["updates"])

    def test_reject_degraded_or_stale_snapshot(self):
        snap = {"generatedAt": NOW.isoformat(),
                "items": [article("온누리상품권 할인 기간 연장")],
                "failedCategories": ["경제"]}
        with self.assertRaises(ValueError):
            build(snap, [], "complete", NOW)
        snap["failedCategories"] = []
        with self.assertRaises(ValueError):
            build(snap, [], "complete", NOW + dt.timedelta(hours=13))

    def test_public_post_count_mismatch_is_not_claimed_complete(self):
        posts = [{"url": "https://wic12.blogspot.com/2026/11/example.html",
                  "title": "이전 게시글"}] * 116
        with patch("scripts.news_intelligence.expected_post_count", return_value=219):
            coverage, expected = reconcile_coverage(posts, "complete")
        self.assertEqual(coverage, "partial")
        self.assertEqual(expected, 219)

    def test_focused_rss_failure_falls_back_to_existing_news(self):
        with patch("urllib.request.urlopen", side_effect=OSError("offline")):
            self.assertEqual(focused_news(NOW), [])

    def test_story_key_ignores_punctuation(self):
        first = article("온누리상품권 할인 기간 연장!")
        second = article("온누리상품권, 할인 기간 연장")
        self.assertEqual(news_key(first), news_key(second))

    def test_no_secret_logging_and_safe_failure(self):
        # Public report is computed without connecting to Telegram.
        snap = {"generatedAt": NOW.isoformat(),
                "items": [article("자동이체 수수료 인하 방법")],
                "failedCategories": []}
        with patch("scripts.news_intelligence.NOW_UTC", return_value=NOW):
            result = build(snap, [], "unavailable", NOW)
        self.assertEqual(result["site"], "https://wic12.blogspot.com/")
        self.assertNotIn("token", str(result).lower())


if __name__ == "__main__":
    unittest.main()
