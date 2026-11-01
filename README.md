# Blogger Manager

별셈소 콘텐츠 관리자와 자동 점검 시스템.

## 실행 중인 GitHub Pages 화면
- [콘텐츠 관리](https://wiclab.github.io/blogger-manager/)
- [통계](https://wiclab.github.io/blogger-manager/stats.html)
- [주제 발굴](https://wiclab.github.io/blogger-manager/write.html)
- [글 편집](https://wiclab.github.io/blogger-manager/editor.html)
- [뉴스](https://wiclab.github.io/blogger-manager/news.html)

## GitHub Actions
- `news.yml`: 4시간마다 뉴스 수집
- `news-health.yml`: 뉴스 수집과 스냅샷 유효성 점검
- `scan.yml`: 1시간마다 Blogger 게시물 품질 검사
- `editor-checks.yml`: 편집기 회귀 테스트
- `indexing.yml`: 별셈소 전용 Bing 자동 제출, Google Search Console 선택적 색인 점검

## 문서
- [색인 자동화 설정/운영](docs/INDEXING_AUTOMATION.md)
- [Blogger 편집기](docs/BLOGGER_EDITOR.md)
- [이전 R2 이미지 사용 중단 주의사항](docs/R2_RETIREMENT.md)

기존 비배포 MCP 실험 코드는 정리했습니다. 배포된 Cloudflare Worker 또는 과거 이미지 자산을 삭제하는 작업은 포함되지 않습니다.
