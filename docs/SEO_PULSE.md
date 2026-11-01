# 별셈소 SEO Pulse — Bing 검색 성과와 날짜 갱신 점검

전용 화면: https://wiclab.github.io/blogger-manager/seo.html

## 실행
GitHub Actions의 seo-pulse.yml이 매일 02:47 UTC(한국 11:47) 실행됩니다. 수동 실행도 지원합니다. 이미 설정된 BING_API_KEY와 BLOGGER_API_KEY만 사용합니다.

## Bing 분석
공식 GetRankAndTrafficStats, GetQueryStats, GetPageStats API로 일별 성과와 검색어·페이지별 성과를 읽습니다. API가 날짜 범위를 지원하지 않아 수집 후 28일/56일 구간으로 필터링합니다. 업데이트는 주간 단위로 지연될 수 있습니다.

대시보드에는 검색 클릭·노출·CTR, 낮은 CTR 검색어의 개수 및 개선 후보 글의 공개 제목·주소를 표시합니다. 공개 GitHub 저장소에 개별 검색어 원문이나 페이지별 성과 수치는 저장하지 않습니다. 자세한 검색어는 Bing Webmaster Tools에서 직접 확인하세요.

## 오래된 정보 감지
Blogger API로 별셈소 공개 게시글 본문을 읽어 행사·신청·할인·예매·마감 등의 문맥에 연결된 기간/마감일을 추출합니다. 지난 90일이나 다음 7일에 해당하는 내용만 후보로 보여줍니다. 날짜 감지만으로 행사가 실제 종료되었다고 단정하지 않으며, 글을 자동 수정·발행·삭제하지 않습니다.

## 보안
- 원본 검색어, 게시글 본문, 비밀키는 GitHub 저장소나 실행 로그에 출력하지 않습니다.
- 공개 보고서 data/seo-pulse.json은 집계 값과 기존 공개 글 링크, 의심 날짜만 기록합니다.
- wic12.blogspot.com만 대상이며 Nobody Asked Data와 궁금퐁은 제외됩니다.
- 기존 뉴스·블로그 검사·Bing 제출 워크플로와 분리해 작동합니다.
- API 장애 시 해당 기능의 지난 보고서를 stale 상태로 유지하고 다른 기능은 계속 실행합니다.

## 테스트
Actions > Byeolsemso SEO pulse > Run workflow 실행 후 seo.html을 열어 데이터 상태와 날짜 후보를 확인합니다.

공식 문서:
https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet
https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getpagestats?view=bing-webmaster-dotnet
