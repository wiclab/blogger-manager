# 별셈소 Google Search Console 관제 연결 안내

[Google 색인 관제 화면](https://wiclab.github.io/blogger-manager/gsc.html) · [작업 실행](https://github.com/wiclab/blogger-manager/actions/workflows/gsc-monitor.yml)

## 기능 및 한계
- **별셈소 전용, 읽기 전용**. Search Console URL Inspection API로 Google이 저장한 색인 상태를 조회한다.
- 매일 09:23 KST (예약 지연 가능). 상세 암호 설정 시 Work 보고서의 공개 URL 15개를 매일 고정 추적하고 나머지는 이전 오류/순환 표본으로 총 원본 최대 26개를 검사한다. 미설정 시 기존 20개 순환을 유지한다.
- 고정 15개는 원본과 ?m=1을 모두 조회한다. 나머지는 처음 5개 범위에서만 모바일 추가 조회하며 최대 API 호출은 41회/실행이다.
- Android 사용자 에이전트로 기존 HTTP 오류 최대 6개·고정 15개·일반 표본을 합쳐 최대 29개에 대해 HTTP 이동 경로, canonical 및 noindex를 검사한다. 이것은 실제 Googlebot이 아니다.
- 변경된 새로운 오류 신호만 기존 텔레그램 Secrets로 알릴 수 있다.
- 공개된 gsc-data 브랜치의 집계 JSON에는 **집계 숫자와 30일 이력만** 저장한다. 별도의 Secret을 활성화하면 URL별 기록은 AES-256-GCM **암호문**으로만 별도 저장된다. 원본 GSC 상세 기록은 평문으로 공개하지 않는다.
- GitHub 저장소가 공개 상태이므로 집계 수치와 **암호문 자체**는 누구나 열 수 있다. 상세 기록을 복호화하려면 별도의 강력한 암호가 필요하다.
- **색인 요청·재요청·Blogger 수정·사이트맵 제출을 하지 않는다.** Google Indexing API는 일반 Blogger 게시글 색인 요청 수단이 아니다.
- 결과는 전체 블로그 색인 수가 아닌 **당일 표본의 검사 결과**다.
- GSC URL Inspection API는 저장된 색인 상태를 반환하며 **실시간 테스트가 아니다**. 표본의 원본과 ?m=1에 다른 기록이 있어도 그 자체로 오류라는 뜻은 아니다.

## 최초 연결 (본인 계정에서 한 번만)

1. [Google Cloud Console](https://console.cloud.google.com/apis/library/searchconsole.googleapis.com)에서 프로젝트를 선택 또는 생성하고 **Google Search Console API**를 사용 설정한다. Indexing API가 아니라 Search Console API다.
2. [서비스 계정](https://console.cloud.google.com/iam-admin/serviceaccounts) 하나를 만들어 JSON 키를 발급한다. 키 파일은 외부에 공유하거나 GitHub 코드·이슈에 넣지 않는다.
3. [Google Search Console](https://search.google.com/search-console)의 **https://wic12.blogspot.com/** 속성에서 설정 → 사용자 및 권한 → 사용자 추가로 서비스 계정의 **client_email**을 추가한다. 권한은 읽기에 충분한 범위의 사용자 권한을 우선 사용한다. 권한 오류가 발생하면 속성 및 Google 계정 권한을 확인한다.
4. 저장소 [Actions Secrets](https://github.com/wiclab/blogger-manager/settings/secrets/actions)에서 repository secret **GSC_SERVICE_ACCOUNT_JSON**을 만든다. 값은 JSON 키 파일의 전체 원문이다. 채팅에 붙여넣지 않는다.
5. 저장소 [Actions Variables](https://github.com/wiclab/blogger-manager/settings/variables/actions)에서 repository variable **GSC_MONITOR_ENABLED**를 값 **true**로 만든다. 이 변수 전에는 예약 실행이 수집을 건너뛰도록 설계했다.
6. [GSC 관제 Actions](https://github.com/wiclab/blogger-manager/actions/workflows/gsc-monitor.yml)에서 **Run workflow**를 한 번 실행한다. 정상 완료 시 gsc-data 브랜치의 data/gsc-dashboard.json을 갱신하며, 관제 화면에 실제 표본 수치가 나타난다.
7. 선택: 이미 등록된 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID가 있으면 새 HTTP 리디렉션·noindex·canonical 이상 신호가 추가될 때만 알린다. 알림 실패 때문에 색인 조회 자체가 중단되지는 않는다.

설정 전 화면에 '미연결 또는 수집 전'이 나타나는 것이 정상이다. 사용량 제한, Google 권한 오류 또는 크롤링 오류는 자동으로 해결되지 않는다.

## 안전장치
- 공개 URL만 sitemap.xml에서 찾는다. 검사 대상은 별셈소 호스트만 허용한다.
- GSC API를 호출할 수 없다면 성공한 것처럼 숫자를 생성하지 않는다.
- 기존 데이터가 유효하지 않으면 덮어쓰지 않는다. 모든 GSC 요청이 실패하면 새 리포트를 발행하지 않는다.
- 모든 비밀은 GitHub Actions의 Secrets로만 전달하고 페이지 JavaScript에는 넣지 않는다.
- 기존 Bing indexing.yml, seo-pulse.yml, Blogger 테마, AdSense, 기타 블로그는 건드리지 않는다.
- Google API 검사 수: 실행당 원본 최대 26개 + 모바일 15개(기존 모드는 20+5). 상세 기능 활성화 후 이전에 오류가 있었던 URL 최대 5개를 다음 검사에 우선 포함하고, 나머지는 순환한다. 실패 시 페이지별 결과는 평문 공개하지 않는다.
- 발생한 이상 징후는 판단 근거다. 시스템이 Blogger 글을 수정하거나 Google 색인 요청을 실행하지 않는다.

## URL별 원인 분석기 — 암호화 저장 설정 (선택)

> 설정 이전에 수집한 7개 가져오기 문제 URL은 상세 기록이 저장되지 않았으므로 **소급 복구할 수 없다**. 새로 검사해야 목록에 나타난다. 기존 집계 자동화는 설정 없이 계속 작동한다.

1. [GitHub Actions Secrets](https://github.com/wiclab/blogger-manager/settings/secrets/actions)에서 **New repository secret**을 눌러 이름을 **GSC_DETAIL_PASSPHRASE**로 한다.
2. 값에는 서비스 계정 JSON 키가 아닌 **별개의 새로운 암호**를 넣는다. 비밀번호 관리자로 만든 무작위 32자 이상의 강한 암호 권장(최소 20자, 최대 1024바이트). 이 암호는 사용자가 안전하게 따로 보관해야 한다. GitHub Secret은 등록 후 값을 다시 표시하지 않는다.
3. [GSC 수집 Actions](https://github.com/wiclab/blogger-manager/actions/workflows/gsc-monitor.yml)에서 **Run workflow → main**으로 실행한다. 기존 집계와 별도로 gsc-data 브랜치의 암호화된 데이터 파일 **data/gsc-details.enc.json**이 생성된다.
4. [Google 색인 관제](https://wiclab.github.io/blogger-manager/gsc.html)에서 URL별 상세 원인 분석 → 잠금 해제에 해당 암호를 입력한다. 브라우저 기기 내부에서만 PBKDF2-SHA256(60만 회)+AES-256-GCM으로 복호화하고, 암호는 서버로 전송·저장하지 않는다.
5. 우선 검사 대상, GSC 가져오기 문제, 원본/모바일 기록 차이, 미색인, 전체 기록으로 필터링한다. 이전/이후 비교 시 같은 URL의 검사 날짜를 확인해야 한다.

### 상세 기록 범위 및 제한

- 검사한 글 URL, GSC 색인/커버리지/가져오기/크롤러 종류/마지막 크롤링/robots/indexing/canonical 상태.
- 고정 15개 및 일부 순환 표본의 모바일 ?m=1 GSC 기록과 최대 29개의 Android HTTP 실제 접근 결과. HTTP 요청은 인증된 Googlebot이 아니다.
- 글별 **최근 32개 UTC 날짜의 상태와 최근 64개 변경 사건**, 최대 500개 URL. 같은 날짜 재실행은 그날 기록을 덮어쓴다.
- 우선순위 1등급의 실제 가져오기/현재 HTTP/robots 문제 글 최대 5개를 다음 날 다시 검사하고 나머지는 순환한다.
- GSC 저장 기록은 실시간 URL 테스트가 아니며, 모바일 기록 차이나 과거 fetch error만으로 색인 오류의 원인을 단정하지 않는다.

### 보안 및 비밀 유지

- 저장소와 gsc-data 브랜치는 **공개**이며 암호문 자체도 공개된다. 암호 추측 공격을 방지하려면 강력하고 고유한 랜덤 암호를 사용해야 한다.
- 상세 암호를 Google JSON 개인키, Gmail 로그인 암호와 재사용하거나 채팅·GitHub Issue·소스코드에 올리지 않는다.
- 암호를 잃어버리거나 기존 Secret을 변경하면 이전 암호문을 열 수 없다. 기존 암호문을 복호화하지 못하면 자동화는 **실패하고 암호문을 덮어쓰지 않는다**. 키 변경은 백업 후 별도 안전한 절차가 필요하다.
- 브라우저에서 암호화 해제 후 페이지를 새로 고치거나 닫으면 기록은 다시 잠긴다. 브라우저 저장소에 암호를 남기지 않는다.
- **GSC_SERVICE_ACCOUNT_JSON 기존 Secret은 변경하지 않는다.** 상세 기록 암호와 인증키를 반드시 분리한다.
## 문제 해결
- 작업이 SKIPPED: GSC_MONITOR_ENABLED 변수가 true인지 확인.
- 401/403: API 사용 설정, 서비스 계정 주소의 정확한 GSC 속성 접근 권한, Secret 내용 점검.
- 429: 사용량 한도 또는 Google API 제한. 자동 반복·우회 제출하지 않는다.
- 화면에 옛날 수치: 해당 날짜 실행이 실패했는지 Actions에서 확인.
- 표본 내 미색인이 줄었지만 전체 색인이 늘지 않았을 수 있다. 매일 서로 다른 URL 집합을 검사하므로 수치를 단순 전일 증감으로 해석하지 않는다.

## 공식 자료
- URL 검사 API: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- 반환 필드: https://developers.google.com/webmaster-tools/v1/urlInspection.index/UrlInspectionResult
- Google Indexing API 제한: https://developers.google.com/search/apis/indexing-api/v3/using-api


## 원인 분리 추적 (2026-11-02)

기준: Work `byeolsemso_cause_isolation_20261102.md`. 코드에는 공개 글 URL 15개만 저장하며 과거 GSC 상태는 평문으로 옮기지 않는다. 과거 암호문은 같은 AAD/키/알고리즘으로 열고 확장 필드를 추가한다. 다른 사이트를 검사하거나 색인 요청하는 기능은 없다.

- **일반 HTTP**: 각 요청 URL·상태·Location·이동 횟수·최종 응답·검사시각·판정 근거를 암호화 기록에 저장한다. 정상 `302 → 같은 경로 ?m=1 → 200`은 정상으로 표시한다. 순환/Location 누락/잘못된 Location/추적 한도/범위 밖 목적지를 구분한다. 동일 호스트 HTTP↔HTTPS는 인증 없는 공개 GET으로만 추적한다. 외부 호스트·포트·인증정보·fragment가 포함된 목적지는 따라가지 않고 `inconclusive`로 구분하며 리디렉션 오류 건수에 넣지 않는다. GSC API 대상은 기존 HTTPS 전용으로 유지한다.
- **실제 Google 기록**: 원본/모바일의 저장 API 필드와 각각의 마지막 크롤링을 보존한다. HTTP 요청은 `ordinary_http_android`, API는 `gsc_saved_url_inspection_api` 출처로 분리한다. 저장된 리디렉션 오류의 정확한 실패 경로는 API가 제공하지 않는다.
- **수정 이후 확인**: 현재 공개 HTML의 `dateModified`(없으면 updated/메타)를 읽고, 접근을 완료하지 못하면 같은 실행에서 읽은 sitemap의 lastmod를 출처와 함께 사용하고 저장된 각 주소의 크롤링과 비교한다. 날짜 부재·해석 불가는 미확인. 수정 이후 요청이 있었어도 fetch 실패면 성공 재수집으로 세지 않는다. HTTP 200이나 fetch 성공을 색인 완료로 세지 않는다.
- **변화**: 같은 UTC 날짜의 최신 상태를 보관하고, 동일 날짜 재실행에서도 변경 사건은 별도 유지한다. 기준 이전 상태가 없으면 PASS라도 ‘색인 상태 확인’이지 ‘새 색인 전환’이 아니다.
- **기존 6건**: 이전 암호문에서 `bad_redirect`인 URL 최대 6개를 가장 먼저 HTTP 재검사한다. 기존 로그에는 체인이 없어 과거의 6건별 실패 단계는 복구할 수 없다. 과거 원인 미확정과 현재 경로를 함께 표시한다.

### 크롤링 통계와 저장 검사 비교

URL Inspection API는 크롤링 통계를 제공하지 않는다. 일반 HTTP 200을 Googlebot 증거로 자동 변환하지 않는다. 기본적으로 비교 증거 미수집이다.

GSC에서 직접 확보한 예시를 아래 형식으로 넣을 수 있다. 시각은 시간대가 포함된 ISO8601이어야 한다. 화면에서만 비교하려면 잠금 해제 후 로컬 JSON 파일을 선택한다. 서버로 업로드하지 않으며 잠금을 닫으면 메모리에서 제거한다.

```json
[{"url":"https://wic12.blogspot.com/2026/09/example.html?m=1","crawled_at":"2026-10-17T00:52:00+09:00","status":200,"agent":"SMARTPHONE"}]
```

예약 수집에도 보존하려면 같은 JSON을 선택적 repository secret `GSC_CRAWL_EVIDENCE_JSON`에 등록한다. 이 Secret은 필수가 아니며 기존 인증키·상세 암호를 변경하지 않는다. 입력 증거는 암호문에만 저장되고 공개 요약에는 건수만 나온다. 원본 GSC 내보내기와 대조하지 않은 추측 시각·에이전트는 넣지 않는다. Googlebot 종류를 확인하지 못했다면 agent를 생략한다.

동일 주소의 200 크롤링 증거가 저장 검사보다 최신이거나 저장 크롤링이 없으면 별도 불일치로 표시한다. 이는 보고 갱신 차이의 관측이지 Google 내부 원인이나 canonical 오류의 확정이 아니다. GSC 전체 요청량, 119·51개 총수는 이 표본에서 자동 복원하지 않는다.
