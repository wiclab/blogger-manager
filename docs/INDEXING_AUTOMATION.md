# 별셈소 Bing 자동 제출·감시

대상: https://wic12.blogspot.com/ 전용. Nobody Asked Data와 궁금퐁은 제출하지 않습니다.

## 현재 운영하는 기능

- `indexing.yml`: 매 2시간 간격 Bing URL 제출. GitHub 예약 실행은 지연되거나 누락될 수 있습니다.
- `scripts/indexing.py`: Blogger 사이트맵 및 Atom 피드의 공개 URL/수정 시각을 조회합니다.
- 수정 7일 이내 새 글은 최대 30개 우선 처리하며, 남는 제출 슬롯은 오래된 대기 글에 배정합니다.
- Bing 일·월 잔여 API 할당량과 실행당 최대 100개 상한 중 작은 값까지만 전송합니다.
- 실제 Bing API 성공 응답을 받은 URL만 `data/indexing-state.json`에 제출 시간과 글 지문을 기록합니다.
- 상태 변경 전 유효한 직전 버전을 `data/indexing-state.backup.json`에 보존하며, 상태 저장은 임시 파일에서 원자적으로 교체합니다.
- 상태 파일 유실·손상이나 기존 제출 기록 삭제를 감지하면 신규 제출을 멈추고 기존 기록을 보호합니다.
- Bing의 GET 조회는 429/5xx 및 일시적인 연결 실패에 최대 3회 시도합니다(1초, 2초 대기).
- 결과가 불명확한 제출 POST는 자동으로 즉시 재전송하지 않습니다. 실패 시 다음 정상 실행에서 상태와 할당량을 재확인합니다.
- `indexing-health.yml`: 독립적으로 정기 실행 성공 기록과 데이터 갱신 여부를 점검하고 5시간 이상 불확실하면 경고합니다.
- `data/indexing-dashboard.json`: 공개 가능한 제출 상태·할당량·최근 실행 정보를 저장합니다.

## 화면과 데이터 해석

- [Bing 제출 현황](https://wiclab.github.io/blogger-manager/indexing.html)
- [Bing 검색 실적·날짜 갱신 점검](https://wiclab.github.io/blogger-manager/seo.html)
- **URL 제출**은 Bing API가 요청을 접수했다는 뜻이며, 실제 크롤링·검색 색인을 보장하지 않습니다.
- **검색 색인 여부**는 별도로 Bing Webmaster Tools에서 확인해야 합니다.
- **노출·클릭·CTR**은 Bing 검색 성과 API의 통계이며 제출 건수와 다릅니다.
- GSC·GA4 전용 통계 페이지 및 사용하지 않는 GSC URL Inspection 자동 점검 코드는 제거했습니다.
- 일반 Blogger 글에 대한 Google 색인 생성 요청 API는 운영하지 않습니다.

## 안전과 실패 대응

- 비밀키 `BING_API_KEY`는 GitHub Actions Secrets에만 유지하세요. 소스 코드나 공개 보고서에 저장하지 않습니다.
- `data/indexing-state.json`을 삭제하지 마세요. 파일이 사라지면 자동화가 **안전하게 중지**되며 빈 상태로 재제출하지 않습니다.
- 최근 백업은 `data/indexing-state.backup.json`에 남습니다. 복구는 기존 제출 기록을 대조한 후 수동으로 진행하세요. 백업을 자동 복원하지 않습니다.
- API 호출 전 `compileall`, 오프라인 단위 테스트, 상태 스키마 검증, 대시보드 JavaScript 검사를 통과해야 제출 단계로 진행합니다.
- 실제로 잘못된 코드의 `main` 병합을 막으려면 GitHub Settings → Branches/Rulesets에서 PR 필수 및 상태 검사 필수를 별도 설정해야 합니다. 워크플로 검증만으로 직접 push를 차단하지는 않습니다.
- API 일·월 할당량이 소진되면 미제출 상태를 유지하고 다음 실행에 재시도합니다.
- 정기 실행이 멈추면 [Actions 목록](https://github.com/wiclab/blogger-manager/actions/workflows/indexing.yml)에서 활성화 및 오류 기록을 확인하세요.
- Blogger 글 게시·수정·삭제나 Google 색인 요청은 이 자동화에서 수행하지 않습니다.

공식 Bing URL Batch API: https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.submiturlbatch?view=bing-webmaster-dotnet
