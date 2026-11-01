# 별셈소 검색엔진 자동화 (GitHub Actions)

대상: **https://wic12.blogspot.com/** 전용. Nobody Asked Data와 궁금퐁은 제출하지 않습니다.

## 작동 방법

- 스케줄: UTC 기준 2시간마다, Actions에서 수동 실행 가능.
- Blogger의 \`sitemap.xml\` 전체를 파싱하고, Atom 피드가 열려 있으면 수정 시각을 보강합니다.
- URL은 해당 호스트의 \`/YYYY/MM/post.html\` 형태인 공개 게시글만 허용합니다.
- Bing: 마지막 **성공 제출** 이후 변경되거나 처음 발견된 URL만 한 번에 최대 25개 제출합니다. API에서 남은 제출 한도를 확인하며 0이면 다음 실행으로 넘깁니다.
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
- 최초 실행은 수집된 공개 글 중 매회 최대 25개씩 처리합니다. 이전 Bing 수동 제출 이력과 별개이므로 첫 실행에 일부 중복이 발생할 수 있습니다.
- Bing/Google API 접수는 검색 결과 색인을 보장하지 않습니다.
- 404/삭제 글은 자동으로 Bing에 제출하지 않습니다. 삭제 페이지 관리는 별도 승인된 절차로 처리합니다.
- 블로그 점검 \`scan.yml\`, 뉴스 수집 \`news.yml\`, 뉴스 상태 점검 \`news-health.yml\`, 편집기 검사 \`editor-checks.yml\`은 모두 유지합니다.

## 점검과 실패 대응

- GitHub Actions 실패 로그의 오류 유형을 확인하세요. API Key 혹은 Google OAuth 인증 오류는 관리자 재설정이 필요합니다.
- \`data/indexing-state.json\`을 임의로 삭제하면 기존 게시글이 모두 재제출 후보로 돌아오니 삭제하지 마세요.
- URL 기록은 블로그 공개 URL과 제출 시간만 저장하며 API 키/토큰은 저장하지 않습니다.
