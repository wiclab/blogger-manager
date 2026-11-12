# 별셈소 AdSense 사전 검수 (읽기 전용)

대상: https://wic12.blogspot.com / pub-3994646975949050

Google의 내부 심사 결과를 예측하거나 승인 보장 점수를 계산하지 않습니다. Google 공식 도움말에서 요구하는 접근성, 원본 콘텐츠, 사용성 관련 **검토 후보**를 수집하는 도구입니다.

## 실행

GitHub: 이 PR을 병합한 뒤 Actions > Byeolsemso AdSense preflight > Run workflow. 실행이 끝나면 Artifacts에서 report 파일을 내려받아 index.html을 열거나 posts.csv를 확인합니다.

로컬(인터넷 연결 환경):

    python -m pip install -r tools/adsense-audit/requirements.txt
    python tools/adsense-audit/scan.py --out adsense-audit-output

이전 감사의 공개 페이지 JSON 스냅샷으로 오프라인 재검사:

    python tools/adsense-audit/scan.py --snapshot previous_public_posts.json --out adsense-audit-snapshot

스냅샷 모드의 결과는 **과거 보관 데이터**이며 현재 공개 상태 확인 결과가 아닙니다. 원본 HTML이 없는 스냅샷은 메타태그, 대표 이미지, 링크 등 일부 검사 불가능합니다.

## 검사 내용

- Blogger sitemap.xml + 공개 피드를 통합해 글 URL 수집. 수집이 실패해도 0개 정상으로 오판하지 않음
- 공개 HTML 응답 상태, 정규 URL 불일치, noindex, 본문 길이, H2, 이미지 대체텍스트
- 특수문자 깨짐/편집 중 남은 인용 마커, 종료된 행사일 수 있는 안내 문구
- 사이트의 robots.txt에서 Mediapartners-Google과 Googlebot 접근 허용 여부를 표본 경로로 정적 판독
- 공개 URL 목록에서 빠진 내부 게시글 링크를 **미검증 후보**로 기록 (404로 단정하지 않음)
- AdSense 게시자 코드 문자열의 공개 HTML 포함 여부 (미검출은 위반 확정이 아님)

## 출력

- index.html: 검색 가능한 URL별 검사 목록
- posts.csv: CSV 내 스프레드시트 수식 실행 방지 처리
- report.json: 항목별 근거와 사용자 확인 권고, 실행 시간 및 검사 방식

## 한계와 주의

- 저작권 소유, 사진 사용 허락, 의료·금융 정보 정확성, 복제 콘텐츠 여부, Google 애드센스 승인 여부는 **자동 확정 불가**.
- HTTP 200은 실제 AdSense 크롤러 접근 성공과 다름. robots.txt는 공개 규칙만 정적 판독.
- 콘텐츠 길이와 H2는 편의 지표이지 Google 심사 문턱값이 아님.
- 모바일 렌더링 결과는 별도 Chromium 모바일 점검에 위임. CSS 계산/화면 캡처는 이 스크립트가 수행하지 않음.
- 만료 가능 문구는 사람이 현재 시점 공식자료와 대조.
- Google 승인 상태/정책센터는 로그인된 계정에서 별도로 확인.
- 기존 Blogger 게시글, 이미지, AdSense, 다른 블로그, GitHub 데이터 브랜치에 **쓰기 없음**. GitHub Actions는 보고서를 artifact로만 보관하며 공개 브랜치에 밀어넣지 않음.
- URL 탐색 시 0.2초 간격으로 요청하며 실패 시 오류를 공개적으로 보고. 정책 우회/로그인 우회 없음.

## 공식 기준

- https://support.google.com/adsense/answer/12176698
- https://support.google.com/adsense/answer/7299563
- https://support.google.com/adsense/answer/2381908
- https://support.google.com/adsense/answer/48182
