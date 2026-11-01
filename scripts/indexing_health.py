#!/usr/bin/env python3
"""Independent read-only monitor: GitHub schedule runs and indexing dashboard freshness."""
from __future__ import annotations

import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
import sys
import urllib.error
import urllib.request

REPO = "wiclab/blogger-manager"
SITE = "https://wic12.blogspot.com/"
HEALTH_PATH = Path("data/indexing-health.json")
DASHBOARD_PATH = Path("data/indexing-dashboard.json")
ALERT_STATE_PATH = Path("data/indexing-alert-state.json")
ALERT_COOLDOWN_HOURS = 24
STALE_HOURS = 5


def parse_time(raw):
    if not isinstance(raw, str) or not raw:
        return None
    try:
        stamp=dt.datetime.fromisoformat(raw.replace("Z","+00:00"))
        return stamp.replace(tzinfo=dt.timezone.utc) if not stamp.tzinfo else stamp.astimezone(dt.timezone.utc)
    except ValueError:
        return None


def recent(stamp, at):
    return stamp is not None and dt.timedelta(0) <= at-stamp <= dt.timedelta(hours=STALE_HOURS)


def failing_step_category(jobs):
    """Use only GitHub Actions step names, not error log text or credentials."""
    for job in jobs:
        for step in job.get("steps", []):
            if step.get("conclusion") != "failure":
                continue
            name = step.get("name", "").lower()
            if any(x in name for x in ("receipt", "restore", "state integrity")):
                return "state_integrity"
            if any(x in name for x in ("compile", "validate", "unit test", "syntax")):
                return "code_validation"
            if any(x in name for x in ("persist", "push", "publish")):
                return "state_persistence"
            if "submit changed" in name:
                return "bing_execution"
            if "configuration" in name:
                return "configuration"
    return "unknown"


def assess(runs, dashboard, at=None, failure_kind="unknown"):
    at = at or dt.datetime.now(dt.timezone.utc)
    if dashboard.get("site") not in (None, SITE):
        raise ValueError("Dashboard references a different blog")
    scheduled = sorted((r for r in runs if r.get("event") == "schedule"),
                       key=lambda r: parse_time(r.get("created_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
                       reverse=True)
    completed = [run for run in runs if run.get("conclusion") == "success"]
    successes = [run for run in scheduled if run.get("conclusion") == "success"]
    def latest(rows):
        return max((t for row in rows if (t := parse_time(row.get("created_at"))) is not None),
                   default=None)
    last_scheduled = latest(scheduled)
    last_success = latest(successes)
    last_any_success = latest(completed)
    last_dashboard = parse_time(dashboard.get("updated_at"))
    streak = 0
    for run in scheduled:
        if run.get("conclusion") in ("failure", "timed_out"):
            streak += 1
        else:
            break
    issues, codes = [], []
    if not recent(last_success, at):
        issues.append("최근 5시간 내 성공한 예약 실행이 없습니다.")
        codes.append("schedule_stale")
    if not recent(last_dashboard, at):
        issues.append("색인 제출 대시보드가 5시간 이상 갱신되지 않았습니다.")
        codes.append("dashboard_stale")
    if streak >= 2:
        issues.append(f"예약 실행이 {streak}회 연속 실패했습니다.")
        codes.append("repeated_failure")
    iso = lambda t: t.isoformat(timespec="seconds") if t else None
    return {"schema": 1, "site": SITE, "checked_at": iso(at),
            "status": "ok" if not issues else "warning",
            "last_scheduled_run_at": iso(last_scheduled),
            "last_scheduled_success_at": iso(last_success),
            "last_any_success_at": iso(last_any_success),
            "last_dashboard_update_at": iso(last_dashboard),
            "consecutive_schedule_failures": streak,
            "failure_category": failure_kind if streak else None,
            "issue_codes": codes, "expected_interval_hours": 2,
            "warning_after_hours": STALE_HOURS, "issues": issues,
            "note": "Scheduled workflow health, not Bing indexing proof. A quota-exhausted successful run is healthy."}


def validate_alert_state(state):
    if (not isinstance(state, dict) or state.get("version") != 1
            or (state.get("active_signature") is not None
                and not isinstance(state.get("active_signature"), str))
            or (state.get("last_sent_at") is not None
                and parse_time(state.get("last_sent_at")) is None)):
        raise ValueError("Indexing alert state is invalid; refuse notification to avoid duplicate alerts")
    return state


def plan_notification(health, previous, at=None):
    """Notify on actionable changes; suppress repeats for 24h; recover once."""
    at = at or dt.datetime.now(dt.timezone.utc)
    validate_alert_state(previous)
    codes = sorted(set(health.get("issue_codes", [])))
    signature = "|".join(codes) if health.get("status") == "warning" and codes else None
    current = previous.get("active_signature")
    if signature is None:
        return ("recovered", "✅ 별셈소 Bing 자동화가 정상 상태로 복구됐어.") if current else (None, None)
    if signature == current:
        last = parse_time(previous.get("last_sent_at"))
        if last and dt.timedelta(0) <= at - last < dt.timedelta(hours=ALERT_COOLDOWN_HOURS):
            return None, None
    labels = {
        "schedule_stale": "최근 5시간 내 예약 실행 성공 기록 없음",
        "dashboard_stale": "색인 대시보드 5시간 이상 갱신되지 않음",
        "repeated_failure": "예약 실행 연속 2회 이상 실패",
        "monitor_unavailable": "독립 감시 API 또는 보고서 확인 실패",
    }
    kind = health.get("failure_category")
    kind_labels = {
        "code_validation": "Python/JavaScript 검사 오류 (재실행 금지)",
        "state_integrity": "제출 기록 무결성 문제 (자동 복원 금지)",
        "state_persistence": "GitHub 데이터 저장 실패 (기록 확인 필요)",
        "bing_execution": "Bing API 처리 실패 (제출 POST 재전송 금지)",
        "configuration": "Bing 설정 문제 (비밀키 점검 필요)",
        "unknown": "원인 불명 (실행 로그 확인 필요)",
    }
    detail = kind_labels.get(kind, kind_labels["unknown"]) if "repeated_failure" in codes else ""
    lines = ["⚠️ 별셈소 Bing 자동화 점검 필요",
             *(f"• {labels.get(c, '자동화 상태 확인 필요')}" for c in codes)]
    if detail:
        lines.append("• 실패 유형: " + detail)
    lines.append("• https://github.com/wiclab/blogger-manager/actions/workflows/indexing.yml")
    lines.append("※ Bing URL 접수 기록과 실제 검색 색인은 다릅니다.")
    return "warning", "\n".join(lines)


def send_telegram(message, token, chat_id):
    """Never print or embed token in public artifacts or exception messages."""
    if not token or not chat_id:
        return False
    url = "https://api.telegram.org/bot" + token + "/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": message,
                          "disable_web_page_preview": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            return json.load(response).get("ok") is True
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, TimeoutError):
        return False


def alert_if_needed(health, at=None):
    """Fail closed on corrupt dedup state; save a new state only after Telegram ack."""
    at = at or dt.datetime.now(dt.timezone.utc)
    previous = validate_alert_state(json.loads(ALERT_STATE_PATH.read_text(encoding="utf-8")))
    kind, message = plan_notification(health, previous, at)
    if not kind:
        return "suppressed"
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return "not_configured"
    if not send_telegram(message, token, chat_id):
        return "send_failed"
    signature = "|".join(sorted(set(health.get("issue_codes", [])))) if kind == "warning" else None
    new = {"version": 1, "active_signature": signature,
           "last_sent_at": at.isoformat(timespec="seconds")}
    ALERT_STATE_PATH.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n",
                                encoding="utf-8")
    return "sent_" + kind


def fetch_failure_category(token, run_id):
    if not token or not isinstance(run_id, int):
        return "unknown"
    url = f"https://api.github.com/repos/{REPO}/actions/runs/{run_id}/jobs?per_page=20"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token,
                                                "Accept": "application/vnd.github+json",
                                                "User-Agent": "ByeolsemsoIndexMonitor/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            payload = json.load(response)
        return failing_step_category(payload.get("jobs", []))
    except (urllib.error.HTTPError, urllib.error.URLError, ValueError, OSError):
        return "unknown"


def fetch_runs(token):
    if not token:
        raise RuntimeError("GitHub Actions token missing")
    url=f"https://api.github.com/repos/{REPO}/actions/workflows/indexing.yml/runs?per_page=50"
    req=urllib.request.Request(url,headers={"Authorization":"Bearer "+token,
         "Accept":"application/vnd.github+json","User-Agent":"ByeolsemsoIndexMonitor/1.0"})
    try:
        with urllib.request.urlopen(req,timeout=20) as response:
            data=json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"GitHub Actions returned HTTP {error.code}") from None
    if not isinstance(data,dict) or not isinstance(data.get("workflow_runs"),list):
        raise RuntimeError("Invalid workflow run response")
    return data["workflow_runs"]


def main():
    token = os.environ.get("GH_HEALTH_TOKEN", "")
    try:
        dashboard = json.loads(DASHBOARD_PATH.read_text(encoding="utf-8"))
        runs = fetch_runs(token)
        scheduled = sorted((r for r in runs if r.get("event") == "schedule"),
                           key=lambda r: parse_time(r.get("created_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc),
                           reverse=True)
        latest = scheduled[0] if scheduled else {}
        category = (fetch_failure_category(token, latest.get("id"))
                    if latest.get("conclusion") in ("failure", "timed_out") else "unknown")
        result = assess(runs, dashboard, failure_kind=category)
    except (ValueError, OSError, RuntimeError, KeyError, TypeError) as error:
        result = {"schema": 1, "site": SITE, "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                  "status": "warning", "issue_codes": ["monitor_unavailable"],
                  "issues": ["점검 실패: " + type(error).__name__],
                  "failure_category": "unknown",
                  "note": "Unavailable monitoring must not report healthy."}
    HEALTH_PATH.parent.mkdir(parents=True, exist_ok=True)
    HEALTH_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        notification = alert_if_needed(result)
    except (OSError, ValueError, KeyError, TypeError):
        notification = "dedup_state_unavailable"
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as file:
            file.write("## Byeolsemso indexing schedule\n- Status: " + result["status"]
                       + "\n- Telegram: " + notification + "\n")
            for issue in result["issues"]:
                file.write("- " + issue + "\n")
    for issue in result["issues"]:
        print("::warning::" + issue)
    print("Indexing schedule health: " + result["status"] + "; notification: " + notification)
    return 0 if result["status"] == "ok" else 1

if __name__=="__main__":
    sys.exit(main())
