# 별셈소 검색엔진 자동화 (GitHub Actions)

대상: **https://wic12.blogspot.com/** 전용. Nobody Asked Data와 궁금퐁은 제출하지 않습니다.

## 작동 방법

- 스케줄: UTC **짝수 시각의 37분**마다 2시간 간격으로 제출을 시도합니다. GitHub Actions에서 수동 실행도 가능합니다. 예약 실행은 GitHub 정책상 지연·누락될 수 있으므로 별도 감시 워크플로가 4시간마다 확인합니다.
- Blogger의 \`sitemap.xml\` 전체를 파싱하고, Atom 피드가 열려 있으면 수정 시각을 보강합니다.
- URL은 해당 호스트의 \`/YYYY/MM/post.html\` 형태인 공개 게시글만 허용합니다.
- Bing: 마지막 **성공 제출** 이후 변경되거나 처음 발견된 URL만 전송합니다. 현재는 **한 실행당 최대 100개**로 제한하며, Bing API `GetUrlSubmissionQuota`의 일일·월간 **실제 잔여 할당량 중 작은 값**을 우선 적용합니다. 가장 최근 7일 내 업데이트된 신규/수정 글은 최대 30개까지 우선 제출하고, 나머지는 오래 기다린 글부터 순차 제출해 신규 글만으로 백로그가 계속 밀리지 않도록 했습니다. 할당량이 0이면 성공했다고 기록하지 않고 다음 실행에 재시도합니다. Bing의 공식 배치 최대치는 500개지만 운영 안전을 위해 100개로 제한합니다.
- Google: OAuth 비밀키를 선택적으로 설정하면 Search Console에 기존 Sitemap을 한 번 등록하고, URL Inspection API로 최근 색인 상태를 확인합니다. 한 번에 최대 6개, URL별 재점검 간격 7일입니다.
- **Google 일반 블로그 글에 대한 자동 색인 생성 요청은 지원하지 않습니다.** Google Indexing API를 일반 콘텐츠에 적용하지 않습니다.
- 성공 처리된 상태는 \`data/indexing-state.json\`에 기록됩니다. 실행 결과는 Actions Summary, 7일간 보관되는 \`indexing-report-<run_id>\` Artifact에서 확인합니다. 보고서 때문에 매번 git commit 하지 않습니다.

## 필수 설정 (Bing)

1. [Bing Webmaster Tools](https://www.bing.com/webmasters/)에서 별셈소 속성이 검증되어 있어야 합니다.
2. Bing Webmaster API 키를 얻습니다. 공식 URL Submission API의 JSON 메서드를 사용합니다.
3. GitHub 저장소 \`Settings → Secrets and variables → Actions → New repository secret\`에서 \`BING_API_KEY\`로 저장합니다.
4. \`Actions → Byeolsemso indexing automation → Run workflow\` 실행 후 로그에서 성공 여부와 제출 수를 확인합니다.

키가 없는 경우 워크플로가 **실패**하여 제출되었다고 잘못 보고하지 않습니다. GitHub 저장소에 키를 하드코딩하거나 이슈/채팅에 게시하지 마세요.

JSON endpoint: \`https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch\`
공식 문서: https://blogs.bing.com/webmaster/2019/11/Accessing-Bing-webmaster-tools-api-using-cURL/

## 선택 설정 (Google Search Console)

Google 색인 상태도 자동 조사하려는 경우에만 설정하세요.

1. Google Cloud 프로젝트에서 **Search Console API**를 사용 설정합니다.
2. Google OAuth 클라이언트 ID, Secret, 사용자 승인 후 발급된 **offline refresh token**을 준비합니다. 대상 계정에 별셈소 Search Console 속성 권한이 있어야 합니다.
3. 승인 범위: \`https://www.googleapis.com/auth/webmasters\` (사이트맵 등록/URL 점검). 테스트 모드의 토큰은 만료될 수 있습니다.
4. GitHub Actions Secrets에 \`GSC_CLIENT_ID\`, \`GSC_CLIENT_SECRET\`, \`GSC_REFRESH_TOKEN\` 3개를 저장합니다.
5. 수동 실행 후 Google inspected URL 수와 보고서의 \`google_needs_review\`를 확인합니다.

Google 인증 정보가 없으면 Google 작업만 건너뛰고 Bing 기능은 정상 실행됩니다. 세 개 중 일부만 있으면 오류를 표시합니다. Search Console URL Inspection은 **Google 색인에 있는 버전**을 검사하며 라이브 URL의 색인 가능성 테스트 또는 색인 요청이 아닙니다.

공식 문서:
- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/webmaster-tools/v1/api_reference_index
- https://developers.google.com/search/apis/indexing-api/v3/using-api

## 비용·운영 및 주의

- Python 표준 라이브러리만 사용해 별도 유료 서비스나 패키지가 필요하지 않습니다. GitHub Actions 무료/유료 한도와 API 쿼터는 계정에 따라 달라집니다.
- GitHub Actions schedule은 정시 실행이 보장되지 않으며 지연될 수 있습니다.
- 0개 제출은 **이미 성공 제출한 URL과 수정 시각이 같은 경우** 정상입니다.
- 수정한 글의 업데이트 시각을 Blogger가 sitemap/Atom에 제공하지 않으면 변경을 알아채지 못할 수 있습니다. 이 경우 수동 실행만으로 같은 URL이 강제 재제출되지는 않습니다.
- 최초 실행은 수집된 공개 글 중 API 할당량을 넘지 않는 범위에서 매회 최대 100개씩 처리합니다. 이전 Bing 수동 제출 이력과 별개이므로 첫 실행에 일부 중복이 발생할 수 있습니다.
- Bing/Google API 접수는 검색 결과 색인을 보장하지 않습니다.
- 404/삭제 글은 자동으로 Bing에 제출하지 않습니다. 삭제 페이지 관리는 별도 승인된 절차로 처리합니다.
- 블로그 점검 \`scan.yml\`, 뉴스 수집 \`news.yml\`, 뉴스 상태 점검 \`news-health.yml\`, 편집기 검사 \`editor-checks.yml\`은 모두 유지합니다.

## 점검과 실패 대응

- GitHub Actions 실패 로그의 오류 유형을 확인하세요. API Key 혹은 Google OAuth 인증 오류는 관리자 재설정이 필요합니다.
- \`data/indexing-state.json\`을 임의로 삭제하면 기존 게시글이 모두 재제출 후보로 돌아오니 삭제하지 마세요.
- URL 기록은 블로그 공개 URL과 제출 시간만 저장하며 API 키/토큰은 저장하지 않습니다.

## 예약 실행 감시 및 경고

- 워크플로: `.github/workflows/indexing-health.yml`
- 감시 스케줄: UTC 01:23 / 05:23 / 09:23 / 13:23 / 17:23 / 21:23 (4시간 간격) + 수동 실행
- 감시 데이터: `data/indexing-health.json` (공개 정보만 포함)
- 독립 감시에서 **최근 5시간 내 성공한 `schedule` 이벤트**가 존재하는지와 최근 5시간 내 색인 제출 대시보드가 갱신됐는지를 검사합니다.
- `push`/수동 실행이 성공했더라도 **정기 실행 성공으로 둔갑시키지 않습니다**. 실행 주기가 끊기면 보고서를 경고 상태로 남기고 Actions 실행을 실패로 표시해 해당 실행 로그를 확인할 수 있습니다.
- `schedule` 자체가 비활성화되거나 GitHub에서 트리거되지 않으면 감시 워크플로까지 실행되지 않을 수 있으므로, 대시보드 화면에서도 마지막 갱신 시각이 오래되면 경고를 표시합니다.
- 경고가 지속된다면 [GitHub indexing Actions](https://github.com/wiclab/blogger-manager/actions/workflows/indexing.yml)에서 **Enable workflow** 상태 확인, 설정 및 수동 `Run workflow` 실행, GitHub Actions 알림 설정을 점검하세요. 현재 코드는 작업이 없더라도 API 검사 후 보고서를 갱신합니다.
- 관리자가 직접 활성화하지 않는 한 GitHub 계정의 알림 설정을 자동 변경하지 않습니다.

## 지표를 혼동하지 않는 방법

| 지표 | 데이터 출처 | 의미 | 한계 |
|---|---|---|---|
| Bing **제출 기록** | `data/indexing-state.json` | API 제출 성공으로 저장된 현재 URL·수정지문 | 색인 완료를 의미하지 않음. 과거 수동 요청은 포함 안 됨 |
| Bing **제출 대기** | Sitemap/Atom과 상태 파일 비교 | 현재 블로그 내용 기준 아직 해당 지문으로 API 제출 안 된 URL | Bing 실제 미색인 페이지 수가 아님 |
| Bing **실제 색인** | Bing Webmaster Tools 별도 확인 | 실제 Bing 검색 색인에 포함된 URL | URL Submission API만으로 확인 불가, 대시보드에서는 '미확인' |
| Google **색인 점검** | 선택적 GSC URL Inspection | 검사한 일부 URL의 상태 | 전체 글 색인률로 환산할 수 없음, Google 자동 색인 요청 아님 |
| Bing **노출/클릭/CTR** | `data/seo-pulse.json` Bing 검색 성과 API | 검색 결과 노출·클릭과 클릭률 | 제출 URL 수 및 색인 수와 무관, 데이터 지연 가능 |

데이터 표시 페이지: https://wiclab.github.io/blogger-manager/indexing.html

Bing URL Submission API 공식 배치 최대 500개: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submiturlbatch?view=bing-webmaster-dotnet
