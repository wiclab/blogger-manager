#!/usr/bin/env python3
"""Independent read-only monitor: GitHub schedule runs and indexing dashboard freshness."""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

REPO = "wiclab/blogger-manager"
SITE = "https://wic12.blogspot.com/"
HEALTH_PATH = Path("data/indexing-health.json")
DASHBOARD_PATH = Path("data/indexing-dashboard.json")
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


def assess(runs, dashboard, at=None):
    at=at or dt.datetime.now(dt.timezone.utc)
    if dashboard.get("site") not in (None,SITE):
        raise ValueError("Dashboard references a different blog")
    scheduled=[run for run in runs if run.get("event")=="schedule"]
    completed=[run for run in runs if run.get("conclusion")=="success"]
    done=[run for run in scheduled if run.get("conclusion")=="success"]
    def latest(rows):
        return max((t for row in rows if (t:=parse_time(row.get("created_at"))) is not None),default=None)
    last_scheduled=latest(scheduled)
    last_scheduled_success=latest(done)
    last_any_success=latest(completed)
    last_dashboard=parse_time(dashboard.get("updated_at"))
    issues=[]
    if not recent(last_scheduled_success,at):
        issues.append("최근 5시간 내 성공한 예약 실행이 없습니다. Actions에서 schedule 활성화를 확인하세요.")
    if not recent(last_dashboard,at):
        issues.append("Bing 제출 대시보드 자료가 5시간 이상 갱신되지 않았습니다.")
    if recent(last_scheduled,at) and not recent(last_scheduled_success,at):
        issues.append("예약 실행 기록은 있으나 정상 완료되지 않았습니다.")
    iso=lambda t:t.isoformat(timespec="seconds") if t else None
    return {"schema":1,"site":SITE,"checked_at":iso(at),"status":"ok" if not issues else "warning",
            "last_scheduled_run_at":iso(last_scheduled),"last_scheduled_success_at":iso(last_scheduled_success),
            "last_any_success_at":iso(last_any_success),"last_dashboard_update_at":iso(last_dashboard),
            "expected_interval_hours":2,"warning_after_hours":STALE_HOURS,"issues":issues,
            "note":"Scheduled workflow health, not proof of search engine indexing."}


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
    try:
        dashboard=json.loads(DASHBOARD_PATH.read_text(encoding="utf-8")) if DASHBOARD_PATH.exists() else {}
        result=assess(fetch_runs(os.environ.get("GH_HEALTH_TOKEN","")),dashboard)
    except (ValueError,OSError,RuntimeError,KeyError) as error:
        result={"schema":1,"site":SITE,"checked_at":dt.datetime.now(dt.timezone.utc).isoformat(),
                "status":"warning","issues":["점검 실패: "+type(error).__name__],
                "note":"Unavailable monitoring must not report healthy."}
    HEALTH_PATH.parent.mkdir(parents=True,exist_ok=True)
    HEALTH_PATH.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    summary=os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary,"a",encoding="utf-8") as f:
            f.write("## Byeolsemso indexing schedule\n- Status: "+result["status"]+"\n")
            for issue in result["issues"]:
                f.write("- "+issue+"\n")
    for issue in result["issues"]:
        print("::warning::"+issue)
    print("Indexing schedule health: "+result["status"])
    return 0 if result["status"]=="ok" else 1

if __name__=="__main__":
    sys.exit(main())
