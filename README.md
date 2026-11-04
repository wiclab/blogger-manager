# Blogger Manager

별셈소 콘텐츠 관리자와 자동 점검 시스템.

## 실행 중인 GitHub Pages 화면
- [CMS 운영 대시보드](https://wiclab.github.io/blogger-manager/dashboard.html) — 글감·뉴스·SEO·색인 스냅샷을 읽기 전용으로 요약. 표본 값은 전체 사이트 지표가 아닙니다.
- [방문 통계](https://wiclab.github.io/blogger-manager/traffic.html) — Blogger 전체 조회수(7일/30일/누적) + CMS 관리자 인증을 통한 GA4 기간별 요약/인기 페이지. 조회는 인증 후 브라우저에서만 수행.
- [콘텐츠 관리](https://wiclab.github.io/blogger-manager/)
- [Bing 성과·오래된 정보 점검](https://wiclab.github.io/blogger-manager/seo.html)
- [Bing 제출·예약 실행·색인·검색 실적 분리 대시보드](https://wiclab.github.io/blogger-manager/indexing.html)
- [Google 색인·모바일 URL 관제](https://wiclab.github.io/blogger-manager/gsc.html) — 별셈소 표본 조회·오류 감시 (GSC API 인증 필요)

공통 상단 메뉴는 Bing SEO 화면의 남색 헤더 디자인으로 통일되었습니다. GSC는 비밀키를 노출하지 않는 읽기 전용 관제를 별도 화면으로 운영하며 주제 발굴 기능은 유지됩니다.
- [주제 발굴](https://wiclab.github.io/blogger-manager/write.html)
- [글 편집](https://wiclab.github.io/blogger-manager/editor.html)
- [뉴스](https://wiclab.github.io/blogger-manager/news.html)
- [뉴스 인텔리전스](https://wiclab.github.io/blogger-manager/intelligence.html) — 뉴스 글감, 기존 글 갱신 후보, 조건부 Telegram 알림
- [모바일 레이아웃 점검](https://wiclab.github.io/blogger-manager/mobile-audit.html) — 공개 글의 모바일 표시 문제를 읽기 전용으로 확인
- [공식 출처 링크 점검](https://wiclab.github.io/blogger-manager/sources.html) — 근거 링크의 상태를 읽기 전용으로 확인
- [임시글 스튜디오](https://wiclab.github.io/blogger-manager/draft-studio.html) — 로컬 Chromium 환경을 이용하는 실험 기능(자동 배포·실제 로그인 보장 아님)

- [텔레그램 별셈소 방문 알림 시스템 설정](visitor-alert/README.md) — Cloudflare Worker, 방문마다 즉시 알림(대량 요청 보호 최대 60건/분), 모바일/PC 구분, GitHub Actions 자동 배포

## GitHub Actions
- `news.yml`: 4시간마다 뉴스 수집 → 별셈소 공개 글 제목과 비교 → 규칙 기반 편집 후보 및 조건부 Telegram 요약 알림
- `news-health.yml`: 뉴스 수집과 스냅샷 유효성 점검
- `scan.yml`: 1시간마다 Blogger 게시물 품질 검사
- `editor-checks.yml`: 편집기 회귀 테스트
- `indexing.yml`: 별셈소 Bing 전용 제출(회당 최대 100개, 실제 API 할당량 우선)과 제출 요약 생성. 미사용 GSC 검사 기능 제거
- `indexing-health.yml`: 4시간마다 독립적으로 예약 실행 성공과 제출 요약의 갱신 시각 점검 (5시간 초과 시 경고)
- `seo-pulse.yml`: 매일 Bing 검색 유입 집계 및 지난 행사·신청 날짜 검토
- `gsc-monitor.yml`: Google Search Console 표본 검사 및 모바일 리디렉션 감시 (명시적 활성화 전에는 실행하지 않음)
- `visitor-alert.yml`: 방문 알림 Worker 테스트·조건부 배포 (Cloudflare/Telegram Secrets 필요)

## 문서
- [뉴스 인텔리전스·Telegram 알림](docs/NEWS_INTELLIGENCE.md)
- [색인 자동화 설정/운영](docs/INDEXING_AUTOMATION.md)
- [별셈소 Google 색인 관제 연결 절차](docs/GSC_MONITOR.md)
- [Bing 성과·오래된 정보 자동 점검](docs/SEO_PULSE.md)
- [Blogger 편집기](docs/BLOGGER_EDITOR.md)
- [이전 R2 이미지 사용 중단 주의사항](docs/R2_RETIREMENT.md)

기존 비배포 MCP 실험 코드는 정리했습니다. 배포된 Cloudflare Worker 또는 과거 이미지 자산을 삭제하는 작업은 포함되지 않습니다.

## 운영 코드와 상태 데이터 구분

- `main`은 CMS 화면·스크립트·테스트·Actions 설정을 관리합니다. 자동 수집 결과는 `news-data`, `seo-data`, `indexing-data`, `nobody-indexing-data`, `link-data`, `mobile-audit-data`, `gsc-data` 등 별도 브랜치에 저장합니다. 이 데이터 브랜치를 불필요한 정리 대상으로 판단해 삭제하지 마세요.
- GitHub에서 코드나 PR을 수정했다고 **Blogger 게시글, Google Apps Script 운영 프로젝트, Cloudflare에 자동 적용되는 것은 아닙니다.** 각 서비스의 실제 적용 및 검증을 별도로 확인해야 합니다.
- 미병합 실험 PR은 배포 완료 기능으로 간주하지 않습니다. 자동화 비활성화·삭제·예약 변경 전에 해당 워크플로의 데이터 의존성과 마지막 실행 기록을 확인하세요.

## 변경 전후 기본 점검

```bash
python -m compileall -q scripts tests
python -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/draft_studio.test.cjs
node tests/cms_auth_flow.cjs
node tests/cms_login_reuse.cjs
(cd visitor-alert && npm run check && npm test)
```

브라우저가 필요한 테스트는 `Blogger editor checks`, `Draft studio Chromium fixture`, `Mobile layout hunter`의 GitHub Actions 실행 결과로 추가 확인합니다. 오프라인 테스트 통과는 Google 계정 로그인이나 실제 Blogger 저장·이미지 업로드 성공을 보장하지 않습니다.
