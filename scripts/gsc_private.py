"""Encrypted URL-level GSC diagnostics for the public Byeolsemso repository.

Only ciphertext may be committed to gsc-data. Raw inspections exist solely in
memory during the Actions job. No secrets, plaintext URLs or raw GSC records in
GitHub build logs, artifacts, branch data or the public Pages HTML.
"""
from __future__ import annotations

import base64
import datetime as dt
import json
import os
from typing import Any

SITE = "https://wic12.blogspot.com/"
AAD = b"byeolsemso-gsc-private-v1|https://wic12.blogspot.com/"
ITERATIONS = 600_000
MAX_RECORDS = 500
MAX_OBSERVATIONS = 8
MAX_PLAINTEXT_SIZE = 1_500_000


def check_passphrase(passphrase: str) -> None:
    if len(passphrase) < 20 or len(passphrase.encode("utf-8")) > 1024:
        raise RuntimeError(
            "GSC_DETAIL_KEY_INVALID: use a long, unique 20+ character passphrase "
            "in the GSC_DETAIL_PASSPHRASE GitHub secret")


def _derive(passphrase: str, salt: bytes) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                      salt=salt, iterations=ITERATIONS).derive(passphrase.encode("utf-8"))


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _unb64(s: str) -> bytes:
    return base64.b64decode(s, validate=True)


def encrypt(data: dict, passphrase: str) -> dict:
    """Produce public-safe authenticated ciphertext (AES-256-GCM)."""
    check_passphrase(passphrase)
    if data.get("schema") != 1 or data.get("site") != SITE:
        raise RuntimeError("GSC_DETAIL_SCHEMA_INVALID: unexpected private report")
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    plaintext = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(plaintext) > MAX_PLAINTEXT_SIZE:
        raise RuntimeError("GSC_DETAIL_TOO_LARGE: report exceeds safety limit")
    salt, nonce = os.urandom(16), os.urandom(12)
    ciphertext = AESGCM(_derive(passphrase, salt)).encrypt(nonce, plaintext, AAD)
    return {"schema": 1, "site": SITE, "algorithm": "PBKDF2-SHA256/AES-256-GCM",
            "iterations": ITERATIONS, "salt": _b64(salt), "nonce": _b64(nonce),
            "ciphertext": _b64(ciphertext)}


def decrypt(sealed: dict, passphrase: str) -> dict:
    check_passphrase(passphrase)
    if (sealed.get("schema") != 1 or sealed.get("site") != SITE or
            sealed.get("algorithm") != "PBKDF2-SHA256/AES-256-GCM" or
            sealed.get("iterations") != ITERATIONS):
        raise RuntimeError("GSC_DETAIL_FORMAT_INVALID: encrypted report format mismatch")
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        salt, nonce = _unb64(sealed["salt"]), _unb64(sealed["nonce"])
        ciphertext = _unb64(sealed["ciphertext"])
        if len(salt) != 16 or len(nonce) != 12 or len(ciphertext) > MAX_PLAINTEXT_SIZE + 16:
            raise ValueError("bad size")
        plaintext = AESGCM(_derive(passphrase, salt)).decrypt(nonce, ciphertext, AAD)
        obj = json.loads(plaintext.decode("utf-8"))
        if obj.get("schema") != 1 or obj.get("site") != SITE or not isinstance(obj.get("records"), list):
            raise ValueError("bad schema")
        return obj
    except (ValueError, TypeError, KeyError, UnicodeError):
        raise RuntimeError(
            "GSC_DETAIL_DECRYPT_FAILED: wrong passphrase or damaged encrypted report; "
            "existing report was NOT overwritten") from None
    except Exception as exc:
        from cryptography.exceptions import InvalidTag
        if isinstance(exc, InvalidTag):
            raise RuntimeError(
                "GSC_DETAIL_DECRYPT_FAILED: wrong passphrase or damaged encrypted report; "
                "existing report was NOT overwritten") from None
        raise


def classify(original: dict, mobile: dict | None, http: dict | None) -> dict:
    """Prioritize actionable evidence, not assumed causes of non-indexing."""
    fetch = str(original.get("pageFetchState") or "")
    index_state = str(original.get("indexingState") or "")
    http = http or {}
    original_state = (original.get("verdict"), original.get("coverageState"))
    mobile_state = (mobile.get("verdict"), mobile.get("coverageState")) if mobile else None
    mobile_diff = mobile_state is not None and mobile_state != original_state
    if http.get("result") not in (None, "ok"):
        return {"priority": 1, "reason": "CURRENT_HTTP_ERROR", "mobile_difference": mobile_diff}
    if http.get("noindex") or original.get("robotsTxtState") == "DISALLOWED" or "BLOCKED" in index_state:
        return {"priority": 1, "reason": "INDEXING_DIRECTIVE_OR_ROBOTS", "mobile_difference": mobile_diff}
    if fetch and fetch not in ("SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"):
        return {"priority": 1, "reason": "SAVED_GSC_FETCH_PROBLEM", "mobile_difference": mobile_diff}
    if http.get("canonical_ok") is False:
        return {"priority": 2, "reason": "CURRENT_CANONICAL_DIFFERENCE", "mobile_difference": mobile_diff}
    if mobile_diff:
        return {"priority": 2, "reason": "GSC_ORIGINAL_MOBILE_DIFFERENCE", "mobile_difference": True}
    if original.get("verdict") != "PASS":
        return {"priority": 3, "reason": "NOT_INDEXED_CAUSE_UNCONFIRMED", "mobile_difference": False}
    return {"priority": 4, "reason": "INDEXED_SNAPSHOT", "mobile_difference": False}


def merge(previous: dict | None, observations: list[dict], checked_at: str) -> dict:
    """Keep one latest observation per UTC date and last eight dates per URL."""
    from scripts.gsc_monitor import is_blog_url
    prev = previous or {"schema": 1, "site": SITE, "records": []}
    if prev.get("site") != SITE or prev.get("schema") != 1:
        raise RuntimeError("GSC_DETAIL_PREVIOUS_INVALID: report belongs to another site")
    records = {}
    for item in prev.get("records", []):
        if not isinstance(item, dict):
            raise RuntimeError("GSC_DETAIL_PREVIOUS_INVALID: malformed record")
        url = item.get("url")
        if not isinstance(url, str) or not is_blog_url(url):
            raise RuntimeError("GSC_DETAIL_PREVIOUS_INVALID: unsafe URL")
        records[url] = item
    date = checked_at[:10]
    for item in observations:
        url, original = item.get("url"), item.get("original")
        if not isinstance(url, str) or not is_blog_url(url):
            raise RuntimeError("GSC_DETAIL_URL_REJECTED: outside allowed blog")
        if not isinstance(original, dict):
            raise RuntimeError("GSC_DETAIL_OBSERVATION_INVALID: missing GSC response")
        mobile = item.get("mobile")
        http = item.get("http")
        status = classify(original, mobile, http)
        snapshot = {"date": date, "observed_at": checked_at, "original": original,
                    "mobile": mobile, "http": http, **status}
        previous_row = records.get(url, {})
        earlier = [s for s in previous_row.get("observations", [])
                   if isinstance(s, dict) and s.get("date") != date][-MAX_OBSERVATIONS + 1:]
        history = earlier + [snapshot]
        records[url] = {"url": url, "first_seen": previous_row.get("first_seen") or checked_at,
                        "last_checked": checked_at, "priority": status["priority"],
                        "reason": status["reason"], "mobile_difference": status["mobile_difference"],
                        "observations": history}
    sorted_records = sorted(
        records.values(),
        key=lambda x: (x.get("last_checked", ""), x.get("url", "")), reverse=True)
    sorted_records = sorted_records[:MAX_RECORDS]
    sorted_records.sort(key=lambda x: (x.get("priority", 9), x.get("url", "")))
    return {"schema": 1, "site": SITE, "updated_at": checked_at,
            "records": sorted_records}


def recurring_priority(previous: dict | None, available_urls: list[str], cap: int = 5) -> list[str]:
    """Re-check real high-priority failures without starving other sitemap URLs."""
    available = set(available_urls)
    rows = [r for r in (previous or {}).get("records", []) if
            isinstance(r, dict) and r.get("url") in available and
            r.get("priority") == 1]
    # Oldest last-check first, so fresh problems don't monopolize the sample.
    rows.sort(key=lambda r: (r.get("last_checked") or "", r["url"]))
    return [r["url"] for r in rows[:cap]]
