# 모바일 오류 사냥꾼 — 별셈소 + Nobody Asked Data

## 화면

- CMS 메뉴: 검색 · 품질 → 모바일 오류 사냥꾼: https://wiclab.github.io/blogger-manager/mobile-audit.html
- 운영 대시보드에 두 블로그의 오류 의심 건수와 바로가기 표시
- 공개 결과: https://raw.githubusercontent.com/wiclab/blogger-manager/mobile-audit-data/data/mobile-audit.json
- 실행/스크린샷 기록: https://github.com/wiclab/blogger-manager/actions/workflows/mobile-audit.yml

## 작동

- GitHub Actions 예약: 매 6시간(UTC 01:13, 07:13, 13:13, 19:13), 수동 실행도 지원. 예약은 지연 또는 누락 가능.
- 별셈소 https://wic12.blogspot.com/ 및 Nobody https://qevnaxori.blogspot.com/ 의 공개 게시글만 수집.
- 블로그당 최대 12개 글/실행, 각 글 320·360·390·430 CSS px. 새로 수정된 글, 미검사 글, 오래 검사한 글 순으로 순환.
- Chromium + Playwright로 실제 브라우저 렌더링. 7일 보존 Actions artifact와 문제 위치 스크린샷(최대 12장)을 공개 데이터 브랜치에 보존.
- 검사 항목: 좁은 텍스트 세로 줄바꿈, 본문 가로 넘침, 비의도적 표 넘침, 입력/버튼 화면 이탈, 뷰포트 이상, 런타임 JavaScript 오류 단서.
- JavaScript 오류는 계산기 수식 오류 확정이 아님. 자동 클릭·입력·제출·계산 로직 변경을 하지 않으므로 계산기 결과값 정확성은 별도 수동 확인 필요.
- 실제 Android/iPhone 물리 장비 테스트 아님. 휴리스틱 거짓 양성 가능성이 있어 실제 기기 검증 후 수정을 결정해야 함.

## 안전

- 읽기 전용: Blogger 게시글, 이미지, 검색 설명, 퍼머링크, 테마를 수정하지 않음.
- 제3자 실행 스크립트, 외부 fetch/XHR, 비콘을 차단해 방문 알림 및 추적 요청을 줄임. 사이트 내 같은 출처 스크립트 및 허용 정적 리소스의 효과를 100% 억제하지는 못함.
- 두 블로그 도메인 고정; 타 도메인·비공개 글·검색/라벨 URL 차단.
- GitHub Secrets, Blogger OAuth, Bing API 사용하지 않음.
- 공개 글 스크린샷과 공개 URL만 공개 보고서로 제공. 개인정보나 비공개 로그인 화면 캡처하지 않음.
- 빈/이상 사이트맵은 실패로 처리하며 기존 유효 보고서를 보존. CI 오류나 중단을 정상으로 표시하지 않음.
- 보고서·이미지는 모바일 전용 mobile-audit-data 브랜치에만 저장. indexing-data, nobody-indexing-data, news-data, gsc-data, main 기존 운영 데이터에는 쓰지 않음.
- CMS는 두 블로그별 공개 글 수, 검사 완료, 검사 대기, 문제 후보를 구분. 미검사 글을 정상으로 표시하지 않음.
- 스크린샷 생성에 실패해도 오류 텍스트는 기록함.

## 최초 배포 점검

1. PR CI의 Python·Node 단위 테스트, CMS 회귀 테스트, JavaScript 구문 검사 통과
2. main 병합 직후 첫 GitHub Actions 실행의 공개 사이트맵 읽기 확인
3. Actions 로그의 Mobile audit sample 및 Mobile audit N posts scanned 확인
4. mobile-audit-data/data/mobile-audit.json의 updated_at, 각 사이트 체크 수 확인 (초기 데이터만 남아 있다면 미완료)
5. CMS 메뉴, 모바일 햄버거 메뉴, 오류 리스트 및 스크린샷 링크 확인

## 성능

기본 24개 글/회 × 4개 뷰포트(글당 한 번 로딩 후 화면 너비 변경). 순환 검사로 전체 게시글을 점차 점검. 대상 사이트가 느리거나 사이트맵 접근이 막히면 해당 회차는 실패하거나 일부만 검사할 수 있음.
