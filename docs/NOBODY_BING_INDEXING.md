# Nobody Asked Data Bing 자동 URL 제출

대상 블로그: https://qevnaxori.blogspot.com/ 만.
별셈소(wic12) 및 궁금퐁(ggpong) URL은 제출 불가.

## 작동
- 워크플로: `.github/workflows/nobody-indexing.yml`
- 예약: 2시간 간격 (UTC 00:17, 02:17, ...)
- 새 글과 수정된 글: Blogger 공개 사이트맵 + Atom 수정 시각으로 판별
- 1회 최대 100개, Bing API 잔여 일/월 할당량 이내
- 기존 `scripts/indexing.py` 및 `scripts/indexing_safe.py`의 2단계 보호 전송을 재사용
- Bing에 제출한 URL만 저장하고, 접수가 불분명하면 제출 보류를 유지하며 자동 반복 POST 금지
- 제출 성공 기록이 실제 크롤링이나 색인 성공을 뜻하지 않음

## 분리 저장
- 노바디 제출 이력: `nobody-indexing-data:data/indexing-state.json`
- 노바디 공개 대시보드: `nobody-indexing-data:data/indexing-dashboard.json`
- 별셈소 `indexing-data` 브랜치와 별도로 읽기/쓰기
- Workflow 동시성 그룹: `nobody-indexing-data`
- 현황: https://wiclab.github.io/blogger-manager/nobody-indexing.html

## 사용 전 필수 조건
1. Bing Webmaster Tools에서 `https://qevnaxori.blogspot.com/` 소유권 검증
2. GitHub 저장소 Secrets의 `BING_API_KEY`가 해당 사이트를 검증한 Bing 계정의 API 키일 것
3. `nobody-indexing-data` 브랜치의 seed 파일 2개가 존재할 것
4. GitHub Actions와 워크플로가 활성화돼 있을 것

Bing API의 GetUserSites에서 정확히 qevnaxori.blogspot.com verified property를 찾지 못하면 제출하지 않음.
BING_API_KEY를 PR 코드/로그/대시보드에 저장하지 않음.

## 최초 배포 확인
- PR에서 오프라인 테스트만 수행 (Bing API 호출 없음)
- main 병합 시 push 이벤트로 초기 실행 (실제 실행 여부는 Actions에서 확인)
- Secrets 및 사이트 검증이 모두 맞으면 `Prepare` -> 상태 예약 원격 push -> Bing POST 1회 -> 접수 기록 push
- 성공 실행의 `Bing acknowledged URLs: N` 로그와 별도 데이터 브랜치 `bing` 기록 확인
- 실패 시 URL을 임의로 재제출하지 않음. 미확정 보류는 Bing 접수 결과를 먼저 대조

## 주의
- Blogger의 비공개/임시 글, 블로그 홈, 라벨/검색 URL은 제출하지 않음
- 사이트맵이나 Atom 접근 불가 시 0건으로 간주하지 않고 실패 처리
- GitHub Actions 예약은 지연 또는 누락될 수 있음
- 색인 수는 Bing Webmaster Tools에서 직접 확인
