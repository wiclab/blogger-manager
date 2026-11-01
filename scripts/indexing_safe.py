#!/usr/bin/env python3
"""Two-phase, fail-closed Bing submission with a durable pre-POST hold.

prepare: compute next batch, save held intent locally; Actions must commit/push
         indexing-state.json to indexing-data BEFORE invoking submit.
submit:  require a verified successful remote intent push; POST exactly once;
         save successful receipts locally for a SECOND protected push.
If any step fails, remote held entries stay blocked until manual reconciliation.
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import sys
import uuid

from scripts import indexing as core

PLAN_PATH = Path("data/indexing-plan.json")


def held_urls(state):
    return {entry["url"] for batch in state.get("held_batches", {}).values()
            for entry in batch["entries"]}


def quota_and_site(api_key):
    if not api_key:
        raise RuntimeError("BING_API_KEY missing")
    site = core.bing_verified_site(api_key)
    _, raw = core.request(core.BING_API + "GetUrlSubmissionQuota?"
                          + core.urllib.parse.urlencode({"siteUrl": site, "apikey": api_key}))
    response = json.loads(raw)
    quota = response.get("d")
    if not isinstance(quota, dict):
        raise ValueError("Bing quota response invalid")
    daily, monthly = int(quota["DailyQuota"]), int(quota["MonthlyQuota"])
    if daily < 0 or monthly < 0:
        raise ValueError("Bing quota response negative")
    return site, daily, monthly


def snapshot_posts():
    posts = core.collect_sitemap()
    updates = core.collect_atom_updates()
    for url, stamp in updates.items():
        if url in posts:
            posts[url] = stamp
    return posts


def make_report(posts, submitted, diagnostics):
    report = {"generated_at": core.now(), "site": core.SITE,
              "published_posts": len(posts), "bing_submitted": submitted,
              "bing_pending": None,
              "note": "API submission receipt is not search indexing."}
    return report


def prepare():
    posts = snapshot_posts()
    state = core.load_state()
    held = held_urls(state)
    remaining = {url: stamp for url, stamp in posts.items() if url not in held}
    # No POST is possible until the new hold is confirmed on indexing-data.
    saved = state["bing"]
    changed = {url: stamp for url, stamp in remaining.items()
               if saved.get(url, {}).get("fingerprint") != (stamp or "unknown")}
    metrics = {"daily_quota_remaining_before": None,
               "monthly_quota_remaining_before": None,
               "quota_exhausted": False}
    plan = {"version": 1, "action": "none", "site": core.SITE,
            "posts": posts, "diagnostics": metrics, "batch_id": None,
            "site_property": None, "entries": []}
    if changed:
        site, daily, monthly = quota_and_site(os.environ.get("BING_API_KEY", "").strip())
        metrics["daily_quota_remaining_before"] = daily
        metrics["monthly_quota_remaining_before"] = monthly
        if daily == 0 or monthly == 0:
            metrics["quota_exhausted"] = True
        else:
            selection = core.select_bing_candidates(
                remaining, saved, min(core.MAX_BING, daily, monthly))
            if selection:
                batch_id = uuid.uuid4().hex
                entries = [{"url": url, "fingerprint": stamp or "unknown"}
                           for url, stamp in selection]
                original = json.loads(json.dumps(state))
                state.setdefault("held_batches", {})[batch_id] = {
                    "prepared_at": core.now(), "status": "held", "entries": entries}
                core.persist_state(original, state)
                plan.update({"action": "submit", "batch_id": batch_id,
                             "site_property": site, "entries": entries})
    core.validate_state(state)
    report = make_report(posts, [], metrics)
    report["bing_pending"] = sum(
        state["bing"].get(url, {}).get("fingerprint") != (stamp or "unknown")
        for url, stamp in posts.items())
    core.write_json(core.REPORT_PATH, report)
    core.write_json(core.DASHBOARD_PATH, core.build_dashboard(posts, state, report, metrics))
    core.write_json(PLAN_PATH, plan)
    print("Prepared Bing batch: " + str(len(plan["entries"])) +
          "; durable held URLs: " + str(len(held_urls(state))) +
          "; quota depleted: " + str(metrics["quota_exhausted"]))
    return plan


def submit():
    if os.environ.get("INDEXING_RESERVATION_COMMITTED") != "true":
        raise RuntimeError("Durable reservation confirmation missing; no POST")
    plan = json.loads(PLAN_PATH.read_text(encoding="utf-8"))
    if plan.get("version") != 1 or plan.get("site") != core.SITE or plan.get("action") != "submit":
        raise ValueError("Unexpected indexing submission plan")
    state = core.load_state()
    batch_id = plan.get("batch_id")
    held = state.get("held_batches", {}).get(batch_id)
    entries = plan.get("entries")
    if (not held or not isinstance(entries, list) or not entries
            or entries != held["entries"] or len(entries) > core.MAX_BING
            or not isinstance(plan.get("site_property"), str)):
        raise ValueError("Stored held batch does not match prepared batch")
    # Validate before any POST. No request is made if state/plan changed.
    core.validate_state(state)
    api_key = os.environ.get("BING_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("BING_API_KEY missing")
    urls = [row["url"] for row in entries]
    query = core.urllib.parse.urlencode({"apikey": api_key})
    try:
        _, response = core.request(
            core.BING_API + "SubmitUrlBatch?" + query,
            payload={"siteUrl": plan["site_property"], "urlList": urls})
        parsed = json.loads(response)
    except (RuntimeError, ValueError, core.urllib.error.URLError):
        raise core.SubmissionOutcomeUnknown("Bing POST status uncertain; held URLs require manual reconciliation") from None
    if not isinstance(parsed, dict) or parsed.get("d", "invalid") is not None:
        raise core.SubmissionOutcomeUnknown("Bing POST response invalid; held URLs require manual reconciliation")
    old = json.loads(json.dumps(state))
    received_at = core.now()
    for entry in entries:
        state["bing"][entry["url"]] = {
            "fingerprint": entry["fingerprint"], "submitted_at": received_at}
    del state["held_batches"][batch_id]
    core.persist_state(old, state)
    posts = plan["posts"]
    metrics = plan["diagnostics"]
    report = make_report(posts, urls, metrics)
    report["bing_pending"] = sum(
        state["bing"].get(url, {}).get("fingerprint") != (stamp or "unknown")
        for url, stamp in posts.items())
    core.write_json(core.REPORT_PATH, report)
    core.write_json(core.DASHBOARD_PATH, core.build_dashboard(posts, state, report, metrics))
    print("Bing acknowledged URLs: " + str(len(urls)) + "; awaiting protected receipt push")
    return report


def main():
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in {"prepare", "submit"}:
            raise ValueError("Usage: indexing_safe.py prepare|submit")
        if sys.argv[1] == "prepare":
            prepare()
        else:
            submit()
        return 0
    except Exception as exc:
        category = core.classify_failure(exc)
        # No URLs, tokens or request bodies in artifact or error logs.
        core.write_json(core.FAILURE_PATH, {"site": core.SITE,
                         "category": category, "timestamp": core.now(),
                         "post_retry": False, "type": type(exc).__name__})
        print("::error::Protected Bing phase failed: " + category, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
