"""Offline tests for the GitHub Issue -> Blogger API agent. No credentials/network."""
import unittest

from scripts import blogger_agent as agent


def issue(body, number=42, owner="wiclab"):
    import json
    return {
        "number": number,
        "title": "[blogger-agent] Sample topic",
        "body": json.dumps(body, ensure_ascii=False),
        "state": "open",
        "user": {"login": owner},
    }


def payload(**overrides):
    base = {
        "version": 1,
        "blog": "byeolsemso",
        "action": "create",
        "visibility": "publish",
        "allow_generated_permalink": True,
        "title": "Sample Blogger article",
        "labels": ["생활정보"],
        "html": "<h2>Introduction</h2><p>" + ("Valid article content. " * 8) + "</p>",
    }
    base.update(overrides)
    return base


class FakeBlogger:
    def __init__(self, posts=None):
        self.posts = [dict(p) for p in (posts or [])]
        self.calls = []

    def blog_id(self, blog):
        assert blog in agent.BLOGS
        return "123456789"

    def all_posts(self, blog_id):
        yield from self.posts

    def get_post(self, blog_id, post_id):
        return next(dict(p) for p in self.posts if str(p["id"]) == str(post_id))

    def api(self, method, path, value=None):
        self.calls.append((method, path, value))
        if method == "POST" and path.endswith("?isDraft=true"):
            post = {
                "id": "987654321",
                "title": value["title"],
                "labels": value["labels"],
                "content": value["content"],
                "status": "DRAFT",
                "url": "https://wic12.blogspot.com/2026/11/sample.html",
            }
            self.posts.append(post)
            return dict(post)
        if method == "POST" and path.endswith("/publish"):
            target = next(p for p in self.posts if path.endswith("/" + p["id"] + "/publish"))
            target["status"] = "LIVE"
            return dict(target)
        if method == "PATCH":
            post = next(p for p in self.posts if path.endswith("/" + p["id"]))
            post.update(value)
            post["updated"] = "2026-11-21T00:00:00Z"
            return dict(post)
        raise AssertionError((method, path))


class AgentUnitTests(unittest.TestCase):
    def test_author_and_target_blog_are_restricted(self):
        with self.assertRaises(agent.PublishError):
            agent.validated_request(issue(payload(), owner="stranger"))
        with self.assertRaises(agent.PublishError):
            agent.validated_request(issue(payload(blog="otherblog")))

    def test_publish_requires_explicit_generated_permalink_consent(self):
        with self.assertRaisesRegex(agent.PublishError, "allow_generated_permalink"):
            agent.validated_request(issue(payload(allow_generated_permalink=False)))
        self.assertEqual(agent.validated_request(issue(payload()))["blog"], "byeolsemso")

    def test_invalid_html_and_unknown_fields_rejected(self):
        for change in ({"html": "hello"}, {"command": "rm -rf /"}, {"html": "<iframe>bad</iframe>"}, {"labels": "tag"}):
            with self.subTest(change=change):
                with self.assertRaises(agent.PublishError):
                    agent.validated_request(issue(payload(**change)))

    def test_draft_create_never_publishes(self):
        data = agent.validated_request(issue(payload(visibility="draft", allow_generated_permalink=False)))
        api = FakeBlogger()
        post = agent.execute(api, issue(data), data)
        self.assertEqual(post["status"], "DRAFT")
        self.assertEqual(len(api.calls), 1)
        self.assertIn("<!-- blogger-agent-issue:42 -->", post["content"])

    def test_published_post_readback(self):
        data = agent.validated_request(issue(payload()))
        api = FakeBlogger()
        post = agent.execute(api, issue(data), data)
        self.assertEqual(post["status"], "LIVE")
        self.assertEqual([call[0] for call in api.calls], ["POST", "POST"])

    def test_retry_never_creates_second_post(self):
        data = agent.validated_request(issue(payload()))
        api = FakeBlogger()
        agent.execute(api, issue(data), data)
        api.calls.clear()
        agent.execute(api, issue(data), data)
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(api.calls, [])

    def test_retry_recovers_a_draft_before_publish(self):
        data = agent.validated_request(issue(payload()))
        old = FakeBlogger()
        created = agent.execute(old, issue(data), {**data, "visibility": "draft"})
        api = FakeBlogger([created])
        post = agent.execute(api, issue(data), data)
        self.assertEqual(post["status"], "LIVE")
        self.assertEqual([call[0] for call in api.calls], ["POST"])

    def test_exact_title_duplicate_blocks_creation(self):
        data = agent.validated_request(issue(payload()))
        api = FakeBlogger([{"id": "7", "title": data["title"], "content": "<p>existing</p>", "status": "LIVE"}])
        with self.assertRaisesRegex(agent.PublishError, "exact title"):
            agent.execute(api, issue(data), data)
        self.assertEqual(api.calls, [])

    def test_update_requires_fresh_snapshot(self):
        data = agent.validated_request(issue(payload(
            action="update", visibility=None, post_id="987654321",
            expected_updated="2026-11-20T00:00:00Z"
        )))
        api = FakeBlogger([{
            "id": "987654321", "title": "Original", "content": "<p>Earlier</p>",
            "status": "LIVE", "updated": "2026-11-21T00:00:00Z",
        }])
        with self.assertRaisesRegex(agent.PublishError, "changed since"):
            agent.execute(api, issue(data), data)
        self.assertEqual(api.calls, [])

    def test_update_uses_patch_only_once(self):
        data = agent.validated_request(issue(payload(
            action="update", visibility=None, post_id="987654321",
            expected_updated="2026-11-20T00:00:00Z"
        )))
        api = FakeBlogger([{
            "id": "987654321", "title": "Original", "content": "<p>Earlier</p>",
            "status": "LIVE", "updated": "2026-11-20T00:00:00Z",
        }])
        first = agent.execute(api, issue(data), data)
        self.assertIn("blogger-agent-issue:42", first["content"])
        second = agent.execute(api, issue(data), data)
        self.assertEqual(first, second)
        self.assertEqual(len(api.calls), 1)

    def test_plaintext_has_no_credentials_or_dynamic_target(self):
        self.assertEqual(
            set(agent.BLOGS),
            {"byeolsemso", "nobody"},
        )


if __name__ == "__main__":
    unittest.main()
