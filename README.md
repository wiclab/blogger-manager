# Blogger Manager

별셈소 콘텐츠 관리자와 자동 점검 시스템.

## 실행 중인 GitHub Pages 화면
- [콘텐츠 관리](https://wiclab.github.io/blogger-manager/)
- [Bing 성과·오래된 정보 점검](https://wiclab.github.io/blogger-manager/seo.html)
- [Bing 제출·예약 실행·색인·검색 실적 분리 대시보드](https://wiclab.github.io/blogger-manager/indexing.html)

공통 상단 메뉴는 Bing SEO 화면의 남색 헤더 디자인으로 통일되었습니다. 사용하지 않는 GSC·GA4 전용 통계 화면은 제거했으며 주제 발굴 기능은 유지됩니다.
- [주제 발굴](https://wiclab.github.io/blogger-manager/write.html)
- [글 편집](https://wiclab.github.io/blogger-manager/editor.html)
- [뉴스](https://wiclab.github.io/blogger-manager/news.html)

- [텔레그램 별셈소 방문 알림 시스템 설정](visitor-alert/README.md) — Cloudflare Worker, 전역 5분 간격, 모바일/PC 구분, GitHub Actions 자동 배포

## GitHub Actions
- `news.yml`: 4시간마다 뉴스 수집
- `news-health.yml`: 뉴스 수집과 스냅샷 유효성 점검
- `scan.yml`: 1시간마다 Blogger 게시물 품질 검사
- `editor-checks.yml`: 편집기 회귀 테스트
- `indexing.yml`: 별셈소 Bing 전용 제출(회당 최대 100개, 실제 API 할당량 우선)과 제출 요약 생성. 미사용 GSC 검사 기능 제거
- `indexing-health.yml`: 4시간마다 독립적으로 예약 실행 성공과 제출 요약의 갱신 시각 점검 (5시간 초과 시 경고)
- `seo-pulse.yml`: 매일 Bing 검색 유입 집계 및 지난 행사·신청 날짜 검토
- `visitor-alert.yml`: 방문 알림 Worker 테스트·조건부 배포 (Cloudflare/Telegram Secrets 필요)

## 문서
- [색인 자동화 설정/운영](docs/INDEXING_AUTOMATION.md)
- [Bing 성과·오래된 정보 자동 점검](docs/SEO_PULSE.md)
- [Blogger 편집기](docs/BLOGGER_EDITOR.md)
- [이전 R2 이미지 사용 중단 주의사항](docs/R2_RETIREMENT.md)

기존 비배포 MCP 실험 코드는 정리했습니다. 배포된 Cloudflare Worker 또는 과거 이미지 자산을 삭제하는 작업은 포함되지 않습니다.
