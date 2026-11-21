"""One-time desktop OAuth setup for the Blogger GitHub Issue publisher.

Run ONLY on your own PC (not a remote CI server). Requires GitHub CLI 'gh'
already logged in, and a Google OAuth Desktop client with Blogger API enabled.
This script never prints or writes OAuth secrets; it pipes them to 'gh secret set'.
"""
from __future__ import annotations

import base64
import getpass
import hashlib
import secrets
import shutil
import subprocess
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlparse

from scripts.blogger_agent import PublishError, request_json

REPO = "wiclab/blogger-manager"
SCOPE = "https://www.googleapis.com/auth/blogger"


def setup():
    if not shutil.which("gh"):
        raise PublishError("Install GitHub CLI (gh) and run 'gh auth login' first.")
    auth = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True, check=False)
    if auth.returncode:
        raise PublishError("Run 'gh auth login' with repository access before setup.")

    print("Google Cloud에서 만든 OAuth 2.0 '데스크톱 앱' 클라이언트를 사용합니다.")
    client_id = input("Google OAuth Desktop client ID: ").strip()
    client_secret = getpass.getpass("Google OAuth Desktop client secret (hidden): ").strip()
    if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
        raise PublishError("Invalid OAuth desktop client credentials.")

    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    result = {}

    class CallbackHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            values = parse_qs(urlparse(self.path).query)
            if values.get("state", [""])[0] != state:
                result["error"] = "OAuth state verification failed."
            elif "error" in values:
                result["error"] = "Google authorization was denied."
            elif "code" in values:
                result["code"] = values["code"][0]
            else:
                result["error"] = "No authorization code returned."
            self.send_response(200 if "code" in result else 400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(("<h2>Google Blogger authorization received.</h2>"
                              "<p>You can return to the terminal. This window can be closed.</p>"
                              if "code" in result else "<h2>Authorization failed.</h2>").encode("utf-8"))

        def log_message(self, *_):
            pass  # Never put OAuth codes in HTTP access logs.

    server = HTTPServer(("127.0.0.1", 0), CallbackHandler)
    server.timeout = 150
    redirect = f"http://127.0.0.1:{server.server_port}/"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode({
        "client_id": client_id, "redirect_uri": redirect,
        "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent",
        "code_challenge": challenge, "code_challenge_method": "S256",
        "state": state,
    })
    print("브라우저에서 Google Blogger 권한을 승인하세요. (2분 30초 내)")
    if not webbrowser.open(url):
        print("Browser open failed. Open this local OAuth authorization URL on this PC:\n" + url)
    try:
        server.handle_request()
    finally:
        server.server_close()
    if "code" not in result:
        raise PublishError(result.get("error", "OAuth callback timed out."))

    token_response = request_json("POST", "https://oauth2.googleapis.com/token", payload={
        "client_id": client_id, "client_secret": client_secret,
        "code": result["code"], "code_verifier": verifier,
        "redirect_uri": redirect, "grant_type": "authorization_code",
    }, form=True)
    refresh_token = token_response.get("refresh_token")
    if not refresh_token:
        raise PublishError("No refresh token returned. Reauthorize with prompt=consent; check OAuth app settings.")

    for key, value in (
        ("BLOGGER_AGENT_CLIENT_ID", client_id),
        ("BLOGGER_AGENT_CLIENT_SECRET", client_secret),
        ("BLOGGER_AGENT_REFRESH_TOKEN", refresh_token),
    ):
        proc = subprocess.run(
            ["gh", "secret", "set", key, "--repo", REPO],
            input=value, capture_output=True, text=True, check=False
        )
        if proc.returncode:
            raise PublishError(f"GitHub secret {key} was not saved. Check repository admin rights and gh authorization.")
        print(f"GitHub Actions secret {key}: configured (value never shown).")
    print("설정 완료. ChatGPT가 본인 GitHub 계정으로 [blogger-agent] Issue를 생성하면 Actions가 처리합니다.")


if __name__ == "__main__":
    try:
        setup()
    except (PublishError, KeyboardInterrupt) as exc:
        print("Setup stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
