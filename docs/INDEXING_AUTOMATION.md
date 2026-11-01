# 별셈소 Bing 자동 제출·감시

대상: https://wic12.blogspot.com/ 전용. Nobody Asked Data와 궁금퐁은 제출하지 않습니다.

## 현재 운영하는 기능

- `indexing.yml`: 매 2시간 간격 Bing URL 제출. GitHub 예약 실행은 지연되거나 누락될 수 있습니다. 코드와 데이터는 서로 다른 브랜치에 있습니다.
- `scripts/indexing.py`: Blogger 사이트맵 및 Atom 피드의 공개 URL/수정 시각을 조회합니다.
- 수정 7일 이내 새 글·기존 글 재수정을 합쳐 최대 30개 우선 처리합니다. 두 유형이 함께 있을 때 신규 70%·수정 30%를 기본으로 하되 남는 우선 슬롯은 다른 유형에 넘기며, 오래된 대기 글에도 나머지 슬롯을 배정합니다. 수정일이 오래됐다는 사실로 대기 기간을 추정하지 않습니다.
- Bing 일·월 잔여 API 할당량과 실행당 최대 100개 상한 중 작은 값까지만 전송합니다.
- 실제 Bing API 성공 응답을 받은 URL만 **`indexing-data` 브랜치의** `data/indexing-state.json`에 제출 시간과 글 지문을 기록합니다. `main`에는 이 상태 파일을 저장하지 않습니다.
- 상태 변경 전 유효한 직전 버전을 `data/indexing-state.backup.json`에 보존하며, 상태 저장은 임시 파일에서 원자적으로 교체합니다.
- 상태 파일 유실·손상이나 기존 제출 기록 삭제를 감지하면 신규 제출을 멈추고 기존 기록을 보호합니다.
- Bing의 GET 조회는 429/5xx 및 일시적인 연결 실패에 최대 3회 시도합니다(1초, 2초 대기).
- 결과가 불명확한 제출 POST는 자동으로 즉시 재전송하지 않습니다. 실패 시 다음 정상 실행에서 상태와 할당량을 재확인합니다.
- `indexing-health.yml`: 독립적으로 정기 실행 성공 기록과 데이터 갱신 여부를 점검하고 5시간 이상 불확실하면 경고합니다. 감시 결과도 `indexing-data`에 저장합니다.
- `indexing-data` 브랜치의 `data/indexing-dashboard.json`: 공개 가능한 제출 상태·할당량·최근 실행 정보 및 다음 제출 후보 미리보기 12개(최근 신규·최근 수정·이전 변경)를 저장합니다. 웹 화면은 해당 브랜치의 공개 JSON을 직접 읽습니다.

## 화면과 데이터 해석

- [Bing 제출 현황](https://wiclab.github.io/blogger-manager/indexing.html)
- [Bing 검색 실적·날짜 갱신 점검](https://wiclab.github.io/blogger-manager/seo.html)
- **URL 제출**은 Bing API가 요청을 접수했다는 뜻이며, 실제 크롤링·검색 색인을 보장하지 않습니다.
- **검색 색인 여부**는 별도로 Bing Webmaster Tools에서 확인해야 합니다.
- **노출·클릭·CTR**은 Bing 검색 성과 API의 관측 가능한 구간만 반영한 통계이며 제출 건수와 다릅니다. 실제 제공된 일별 행 개수를 함께 표시하고, 노출이 있으나 클릭이 없을 때 제목·검색 설명 개선 검토를 안내합니다. 클릭이 없다는 이유로 색인 실패를 단정하지 않습니다.
- GSC·GA4 전용 통계 페이지 및 사용하지 않는 GSC URL Inspection 자동 점검 코드는 제거했습니다.
- 일반 Blogger 글에 대한 Google 색인 생성 요청 API는 운영하지 않습니다.

## 코드·색인 데이터 분리

- 코드·워크플로·Blogger Manager HTML은 `main` 브랜치에서 관리합니다.
- Bing의 저장된 URL 접수 상태·백업·공개 대시보드·감시 결과는 `indexing-data` 브랜치에서 관리합니다.
- 자동화는 먼저 `indexing-data`를 checkout하여 유효한 상태를 확인하고, Bing 제출 뒤 **그 브랜치에만** 변경 사항을 push합니다.
- 색인 자동화와 감시 작업은 `byeolsemso-indexing-data` 동시성 그룹을 공유하므로 제출 기록 업데이트와 건강 상태 갱신이 충돌하지 않게 직렬화합니다.
- PR에서는 오프라인 회귀 테스트만 실행하며 Bing API를 호출하거나 저장된 제출 상태를 변경하지 않습니다.
- 뉴스 보고서·텔레그램 중복 알림 상태는 `news-data`, SEO 보고서·공개 제목 캐시는 `seo-data` 브랜치에 각각 저장합니다. 뉴스 수집은 두 브랜치의 제목 캐시와 `indexing-data`의 게시글 수 정보를 읽습니다.
- `main`의 데이터 파일 5개는 원본과 새 브랜치 간 내용 해시를 대조한 후 제거했습니다. 대시보드·뉴스 건강 감시도 각 브랜치의 공개 데이터를 읽습니다.
- 공통 `Required code integrity / code-integrity` 체크는 모든 PR에서 전체 Python 회귀 테스트, 정적 JavaScript 구문, 데이터 경로 분리 및 `main`으로의 자동 저장 재발을 검사합니다.
- `Protect main` Ruleset은 사용자가 2026-11-02에 필수 PR 및 `code-integrity` 상태 검사, 강제 푸시·삭제 차단을 활성화했습니다. 필수 리뷰 수는 0명이며 설정 변경 시 GitHub Rulesets에서 다시 확인해야 합니다.

## 실패 분류 · 안전 복구 · 텔레그램 장애 알림

- 조회 전용 GET(Blogger 사이트맵·Atom, Bing 계정/할당량)은 HTTP 429/일시적 5xx/연결 오류에 1초·2초 간격으로 최대 3회 시도합니다. 인증 오류(401/403)와 JSON·상태 파일 손상은 자동 재시도하지 않습니다.
- Bing `SubmitUrlBatch` POST는 결과가 불명확할 때 **한 번도 자동 재호출하지 않습니다.** 성공 수신 전까지 제출 기록도 늘리지 않습니다. 다음 예약 실행에서 Bing 할당량과 저장 상태를 다시 확인하지만, 미확정 POST의 실제 수신 여부는 반드시 운영자가 필요 시 점검해야 합니다.
- GitHub 색인 데이터 저장과 독립 감시 데이터 저장은 같은 커밋 `git push`만 최대 3번 재시도합니다. 강제 푸시, 상태 덮어쓰기, 새 API 제출은 재시도 과정에 없습니다. 원격 브랜치가 변경되어 비-FF 거절되면 중단합니다.
- 제출 실패 시 민감 정보를 제거한 `data/indexing-failure.json` 분류 보고서를 7일 Actions artifact에 보존하며 API 키·상세 오류 URL·URL 목록은 저장하지 않습니다.
- 감시는 예약 실행 연속 실패 횟수, 최근 성공 실행, 대시보드 갱신 시각을 따로 확인합니다. GitHub Actions 실패 단계명만으로 코드 검사·상태 무결성·인증·Bing 제출·Git 저장 실패 등 범주를 나눕니다.
- 텔레그램 장애 알림은 **2회 연속 예약 실행 실패** 또는 **5시간 이상 예약 실행/대시보드 미갱신**, 또는 독립 모니터 자체의 확인 오류에만 보냅니다. 정상적인 Bing 할당량 소진은 장애 알림이 아닙니다.
- 동일한 진행 중 장애는 24시간 동안 추가 알림을 억제하고, 복구되면 알림을 한 번 보냅니다. 중복 방지 상태 `data/indexing-alert-state.json`은 `indexing-data` 브랜치에 보존되며, 파일이 없어지거나 손상되면 중복 발송 대신 알림을 중지합니다.
- 텔레그램은 기존 `TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID` Actions Secrets를 재사용합니다. 이 토큰은 소스·데이터 파일·로그에 쓰지 않습니다.
- `indexing-health.yml`의 독립 감시는 해당 워크플로만으로 메시지를 보냅니다. 알림 수신 없이 상태가 경고로 남으면 해당 Actions와 Secrets를 점검하세요.

## 안전과 실패 대응

- 비밀키 `BING_API_KEY`는 GitHub Actions Secrets에만 유지하세요. 소스 코드나 공개 보고서에 저장하지 않습니다.
- `indexing-data` 브랜치의 `data/indexing-state.json`을 삭제하지 마세요. 파일이 사라지면 자동화가 **안전하게 중지**되며 빈 상태로 재제출하지 않습니다.
- 최근 백업은 `indexing-data` 브랜치의 `data/indexing-state.backup.json`에 남습니다. 복구는 기존 제출 기록을 대조한 후 수동으로 진행하세요. 백업을 자동 복원하지 않습니다.
- API 호출 전 `compileall`, 오프라인 단위 테스트, 상태 스키마 검증, 대시보드 JavaScript 검사를 통과해야 제출 단계로 진행합니다.
- 코드 변경은 `main`의 PR 필수 및 `code-integrity` 검사 보호를 받습니다. 제출·검색 성과는 서로 다른 데이터 브랜치에서 관리되므로 API 키를 저장하거나 합산된 노출을 색인 완료 건수로 사용하지 않습니다.
- API 일·월 할당량이 소진되면 미제출 상태를 유지하고 다음 실행에 재시도합니다.
- 정기 실행이 멈추면 [Actions 목록](https://github.com/wiclab/blogger-manager/actions/workflows/indexing.yml)에서 활성화 및 오류 기록을 확인하세요.
- Blogger 글 게시·수정·삭제나 Google 색인 요청은 이 자동화에서 수행하지 않습니다.

공식 Bing URL Batch API: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submiturlbatch?view=bing-webmaster-dotnet
