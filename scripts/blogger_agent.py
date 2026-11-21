"""Blogger publish agent, triggered only by owner-created GitHub Issues.

The issue is the request envelope; OAuth refresh credentials remain in Actions secrets.
Never run code from the issue body. No network calls are made during imports/tests.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

BLOGS = {
    "byeolsemso": "https://wic12.blogspot.com/",
    "nobody": "https://qevnaxori.blogspot.com/",
}
ISSUE_PREFIX = "[blogger-agent] "
RESULT_MARKER = "<!-- blogger-agent-success:v1 -->"
BLOGGER_API = "https://www.googleapis.com/blogger/v3"
OWNER = "wiclab"


class PublishError(Exception):
    pass


def validated_request(issue: dict) -> dict:
    if not isinstance(issue, dict):
        raise PublishError("Issue event is missing.")
    if issue.get("user", {}).get("login") != OWNER:
        raise PublishError("Only the repository owner can request publishing.")
    if issue.get("state") != "open" or not str(issue.get("title", "")).startswith(ISSUE_PREFIX):
        raise PublishError("Not an eligible publishing Issue.")
    number = issue.get("number")
    if type(number) is not int or not 1 <= number <= 999999999:
        raise PublishError("Invalid issue number.")
    body = issue.get("body") or ""
    if not isinstance(body, str) or len(body.encode("utf-8")) > 60000:
        raise PublishError("Request body is missing or too large (max 60 KB).")
    try:
        data = json.loads(body)
    except (TypeError, ValueError) as exc:
        raise PublishError("Issue body must be a single JSON object.") from exc
    if not isinstance(data, dict) or set(data) - {
        "version", "blog", "action", "visibility", "title", "labels",
        "html", "post_id", "expected_updated", "allow_generated_permalink",
    }:
        raise PublishError("Invalid or unsupported request fields.")
    if data.get("version") != 1 or data.get("blog") not in BLOGS:
        raise PublishError("Unsupported version or target blog.")
    if data.get("action") not in ("create", "update"):
        raise PublishError("Action must be create or update.")
    if not isinstance(data.get("title"), str) or not 5 <= len(data["title"].strip()) <= 180:
        raise PublishError("Title length must be 5–180 characters.")
    if any(ch in data["title"] for ch in "\r\n"):
        raise PublishError("Title contains newlines.")
    if not isinstance(data.get("html"), str) or not 80 <= len(data["html"]) <= 55000:
        raise PublishError("HTML length must be 80–55,000 characters.")
    if not re.search(r"<(?:p|h2|div|section|table|ul|ol)\b", data["html"], re.I):
        raise PublishError("HTML must contain actual article markup.")
    if re.search(r"<(?:html|head|body|iframe|object|embed|form)\b", data["html"], re.I):
        raise PublishError("Provide only Blogger article-body HTML.")
    if not isinstance(data.get("labels"), list) or len(data["labels"]) > 10:
        raise PublishError("labels must be an array of at most 10 items.")
    if any(not isinstance(s, str) or not 1 <= len(s.strip()) <= 50 for s in data["labels"]):
        raise PublishError("Invalid label.")
    if data["action"] == "create":
        if data.get("visibility") not in ("draft", "publish"):
            raise PublishError("visibility must be draft or publish.")
        if data["visibility"] == "publish" and data.get("allow_generated_permalink") is not True:
            raise PublishError("Publishing requires allow_generated_permalink=true; Blogger API cannot set a custom permalink.")
        if data.get("post_id") is not None or data.get("expected_updated") is not None:
            raise PublishError("Create requests cannot specify an existing post.")
    else:
        if data.get("visibility") is not None:
            raise PublishError("Update preserves current visibility.")
        if not re.fullmatch(r"[0-9]{5,30}", str(data.get("post_id", ""))):
            raise PublishError("Update needs the numeric Blogger post_id.")
        if not isinstance(data.get("expected_updated"), str) or not data["expected_updated"]:
            raise PublishError("Update needs expected_updated for overwrite protection.")
    return data


def request_json(method: str, url: str, token: str = "", payload=None, form=False):
    headers = {"Accept": "application/json", "User-Agent": "wiclab-blogger-agent/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = None
    if payload is not None:
        if form:
            body = urlencode(payload).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json; charset=utf-8"
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=25) as response:
            raw = response.read(2_000_000)
        return json.loads(raw) if raw else {}
    except HTTPError as exc:
        # Do not print response bodies, authorization codes or secrets to public logs.
        raise PublishError(f"External API rejected {method} request (HTTP {exc.code}).") from exc
    except (URLError, TimeoutError) as exc:
        raise PublishError("External API connection failed; result may be uncertain. Rerun uses post-marker recovery.") from exc
    except ValueError as exc:
        raise PublishError("External API returned invalid JSON.") from exc


class Blogger:
    def __init__(self, client_id: str, client_secret: str, refresh_token: str):
        if not all((client_id, client_secret, refresh_token)):
            raise PublishError("Set BLOGGER_AGENT_CLIENT_ID, BLOGGER_AGENT_CLIENT_SECRET and BLOGGER_AGENT_REFRESH_TOKEN secrets.")
        oauth = request_json("POST", "https://oauth2.googleapis.com/token", payload={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }, form=True)
        self.token = oauth.get("access_token")
        if not isinstance(self.token, str) or not self.token:
            raise PublishError("OAuth response did not provide an access token.")

    def api(self, method: str, path: str, payload=None):
        return request_json(method, BLOGGER_API + path, self.token, payload)

    def blog_id(self, blog: str) -> str:
        expected = BLOGS[blog]
        item = self.api("GET", "/blogs/byurl?" + urlencode({"url": expected}))
        host = urlparse(str(item.get("url", ""))).hostname
        if host != urlparse(expected).hostname or not str(item.get("id", "")).isdigit():
            raise PublishError("Blogger returned an unexpected target blog.")
        return str(item["id"])

    def get_post(self, blog_id: str, post_id: str):
        return self.api("GET", f"/blogs/{blog_id}/posts/{post_id}?view=ADMIN")

    def all_posts(self, blog_id: str):
        # Fail closed if enumeration fails: otherwise retries could create duplicates.
        for status in ("draft", "live", "scheduled"):
            page = ""
            seen = set()
            for _ in range(100):
                params = {"status": status, "view": "ADMIN", "fetchBodies": "true", "maxResults": "500"}
                if page:
                    params["pageToken"] = page
                response = self.api("GET", f"/blogs/{blog_id}/posts?" + urlencode(params))
                for post in response.get("items") or []:
                    yield post
                next_page = response.get("nextPageToken")
                if not next_page:
                    break
                if next_page in seen:
                    raise PublishError("Blogger pagination loop; refusing unsafe retry.")
                seen.add(next_page)
                page = next_page
            else:
                raise PublishError("Too many Blogger pages; refusing unsafe retry.")


def find_existing(client, blog_id: str, marker: str, title: str):
    existing_marker = None
    duplicate_title = None
    for post in client.all_posts(blog_id):
        if marker in str(post.get("content", "")):
            if existing_marker:
                raise PublishError("Multiple posts contain the same request marker.")
            existing_marker = post
        if str(post.get("title", "")).strip().casefold() == title.strip().casefold():
            duplicate_title = post
    if existing_marker:
        return existing_marker
    if duplicate_title:
        raise PublishError("An existing post already has this exact title. Review duplicates before creating.")
    return None


def execute(client, issue: dict, data: dict) -> dict:
    blog_id = client.blog_id(data["blog"])
    marker = f"<!-- blogger-agent-issue:{issue['number']} -->"
    content = data["html"].rstrip() + "\n" + marker
    if data["action"] == "update":
        post = client.get_post(blog_id, data["post_id"])
        if marker in str(post.get("content", "")):
            return post  # Safe rerun: the previous PATCH already took effect.
        if post.get("updated") != data["expected_updated"]:
            raise PublishError("Post changed since it was read. Refresh expected_updated; no overwrite attempted.")
        payload = {"title": data["title"].strip(), "labels": [s.strip() for s in data["labels"]], "content": content}
        result = client.api("PATCH", f"/blogs/{blog_id}/posts/{data['post_id']}", payload)
        return client.get_post(blog_id, str(result["id"]))
    existing = find_existing(client, blog_id, marker, data["title"])
    if existing:
        post = existing  # A previous run may have created a draft before failing.
    else:
        payload = {"title": data["title"].strip(), "labels": [s.strip() for s in data["labels"]], "content": content}
        post = client.api("POST", f"/blogs/{blog_id}/posts?isDraft=true", payload)
        if not str(post.get("id", "")).isdigit():
            raise PublishError("Blogger created a post but returned no valid ID; inspect draft list before retry.")
    if data["visibility"] == "publish" and post.get("status", "").upper() != "LIVE":
        post = client.api("POST", f"/blogs/{blog_id}/posts/{post['id']}/publish")
    verified = client.get_post(blog_id, str(post["id"]))
    expected = "LIVE" if data["visibility"] == "publish" else "DRAFT"
    if str(verified.get("status", "")).upper() != expected or marker not in str(verified.get("content", "")):
        raise PublishError("Final Blogger read-back did not confirm the expected status/content.")
    return verified


def github_api(method: str, route: str, token: str, payload=None):
    repo = os.getenv("GITHUB_REPOSITORY", "")
    if repo != "wiclab/blogger-manager":
        raise PublishError("Unexpected GitHub repository.")
    if not token:
        raise PublishError("Missing GitHub issue-write token.")
    return request_json(method, f"https://api.github.com/repos/{repo}{route}", token, payload)


def post_comment(issue_number: int, token: str, message: str):
    github_api("POST", f"/issues/{issue_number}/comments", token, {"body": message})


def has_success_comment(issue_number: int, token: str) -> bool:
    for page in range(1, 21):
        response = github_api("GET", f"/issues/{issue_number}/comments?per_page=100&page={page}", token)
        if not isinstance(response, list):
            raise PublishError("Cannot inspect prior issue results.")
        if any(RESULT_MARKER in str(c.get("body", "")) and c.get("user", {}).get("login") == "github-actions[bot]" for c in response):
            return True
        if len(response) < 100:
            return False
    raise PublishError("Too many issue comments; refusing unsafe retry.")


def main() -> int:
    path = os.getenv("GITHUB_EVENT_PATH")
    if not path:
        raise PublishError("Missing GitHub event payload.")
    event = json.loads(Path(path).read_text(encoding="utf-8"))
    issue = event.get("issue") or {}
    data = validated_request(issue)
    if os.getenv("GITHUB_ACTOR") != OWNER or os.getenv("GITHUB_REPOSITORY") != "wiclab/blogger-manager":
        raise PublishError("Only wiclab's own Issue event is allowed.")
    gh_token = os.getenv("GH_TOKEN", "")
    if has_success_comment(issue["number"], gh_token):
        print("Already completed. No Blogger write attempted.")
        return 0
    try:
        client = Blogger(
            os.getenv("BLOGGER_AGENT_CLIENT_ID", ""),
            os.getenv("BLOGGER_AGENT_CLIENT_SECRET", ""),
            os.getenv("BLOGGER_AGENT_REFRESH_TOKEN", ""),
        )
        result = execute(client, issue, data)
        post_id = str(result.get("id", ""))
        url = str(result.get("url", ""))
        if not post_id or urlparse(url).hostname != urlparse(BLOGS[data["blog"]]).hostname or urlparse(url).scheme not in ("http", "https"):
            raise PublishError("Blogger returned an unexpected result URL. Inspect post manually.")
        message = (
            RESULT_MARKER + "\n"
            + f"**Blogger 처리 완료** · {data['blog']} · {data['action']} · "
            + f"{result.get('status', '?')}\n\n"
            + f"게시물 ID: \x60{post_id}\x60\n\n"
            + f"URL: {url}\n\n"
            + "맞춤 퍼머링크·검색설명·새 이미지 업로드는 API로 보장되지 않습니다. "
            + "Blogger 관리자에서 최종 확인하세요."
        )
        post_comment(issue["number"], gh_token, message)
        print(f"Completed Issue #{issue['number']} for {data['blog']}, post id {post_id}.")
        return 0
    except PublishError as exc:
        # Never leak exception chains, raw HTTP response bodies or credentials.
        try:
            post_comment(issue["number"], gh_token, "**Blogger 처리 중단**\n\n" + str(exc))
        except PublishError:
            pass
        raise


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (PublishError, ValueError, KeyError) as exc:
        print("Blogger agent stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
