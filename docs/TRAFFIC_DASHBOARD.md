# 별셈소 방문 통계 대시보드

- 화면: https://wiclab.github.io/blogger-manager/traffic.html
- 대상 블로그: `https://wic12.blogspot.com/` **고정** (다른 Blogger 블로그 조회/표시 금지)
- 코드: `traffic.html`, `assets/traffic-dashboard.js`
- 성격: 관리자용 읽기 전용. 게시물 수정·삭제·발행 및 자동 공개 스냅샷 저장 없음.

## Blogger 전체 조회수

1. 방문 통계 화면에서 'Google 계정으로 Blogger 연결'을 누릅니다.
2. 별셈소를 관리하는 Google 계정에서 Blogger 권한을 승인합니다.
3. `/users/self/blogs`에서 URL 호스트가 `wic12.blogspot.com`인 블로그만 확인합니다.
4. `GET /blogs/{blogId}/pageviews?range=7DAYS`, `30DAYS`, `all`을 각각 호출하고 3개 카드를 표시합니다.
5. 호출 실패/응답 불일치/권한 만료 시 '-'로 표시하고 오류 메시지를 출력합니다.

Blogger API가 요구하는 권한은 `https://www.googleapis.com/auth/blogger`입니다. 이 화면은 읽기 요청만 하며 OAuth access token은 실행 중인 탭의 JavaScript 메모리에만 남고 영구 저장·외부 공개되지 않습니다. Google 로그인 버튼의 웹 출처 등록 및 Blogger API 활성화가 전제입니다.

공식 API: https://developers.google.com/blogger/docs/3.0/reference/pageViews/get

## GA4 상세 통계

- 기존 CMS 관리자 Google ID token 확인 → 기존 Cloudflare Worker의 `/auth/check`로 관리자 검증.
- 같은 탭의 기존 `sessionStorage.bloggerManagerIdToken` 세션이 있다면 재사용합니다.
- `GET /stats/overview?blog=wic12&days={7|28|90}` 호출. `analytics.summary`의 활성 사용자, 세션, 페이지뷰 값을 표시합니다.
- `analytics.pages`에서 페이지뷰 상위 10개를 정렬해 보여줍니다.
- 게시글 링크는 `wic12.blogspot.com` 호스트로만 구성하며 주소의 경로만 사용합니다. 제목은 `textContent`로 표시합니다.
- GA4 연결 실패, 권한 오류 또는 데이터 부재는 0으로 위장하지 않고 '—' 및 오류 메시지를 표시합니다.

GA4 API 연결은 **기존 CMS Worker에 구성된 통계 기능에 의존**합니다. 이 페이지 자체에는 GA4 서비스 계정 키, 프로퍼티 ID, 비밀값을 넣지 않습니다. 관리자 세션 검증/정상 응답은 배포 환경에서 직접 확인해야 합니다.

## 한계와 주의

- Blogger API는 7일/30일/누적 블로그 전체 조회수만 제공하며, 게시글별 통계를 제공하지 않습니다.
- 7일/30일 Blogger와 7일/28일/90일 GA4는 **집계 방식과 기간이 달라 직접 비교할 수 없습니다**.
- 새로고침은 수동입니다. 데이터가 없을 때 임의 예시 수치를 표시하지 않습니다.
- Blogger OAuth와 CMS 관리자 ID token 인증은 **서로 다른 인증 절차**입니다. GA4 관리자 인증을 마쳐도 Blogger 권한은 별도 승인할 수 있습니다.
- CMS 로그아웃은 GA4 관리자 세션만 해제합니다. Blogger 연결 해제는 별도 버튼을 사용합니다.

## 검증

- `node --check assets/traffic-dashboard.js`
- `python -m unittest tests/test_traffic_dashboard.py`
- 전체 자동화: Required code integrity / Blogger editor checks (PR에서 확인)
- 배포 후 실제 계정으로 7일·30일·누적 Blogger 수치와 7일·28일·90일 GA4 값이 표시되는지 비교
- 모바일 화면의 작은 너비에서 사이드바와 인기글 목록이 가로 스크롤 없이 보이는지 확인
