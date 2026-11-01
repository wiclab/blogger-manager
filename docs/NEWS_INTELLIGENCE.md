# 별셈소 뉴스 인텔리전스

대시보드: https://wiclab.github.io/blogger-manager/intelligence.html
데이터: data/news-intelligence.json (공개 뉴스 헤드라인·별셈소 공개 글 제목)
실행: Collect daily news GitHub Actions 내 RSS 수집 후 scripts/news_intelligence.py

## 분류 기준
1. 기존 RSS 뉴스 수집본의 생성 시각과 실패 카테고리를 확인합니다. 12시간 이상 오래된 자료는 분석하지 않습니다.
2. BLOGGER_API_KEY가 있으면 Blogger 공개 LIVE 글의 제목·URL을 가져오고, 없거나 실패하면 별셈소 공개 Atom 피드를 사용합니다.
3. 생활 비용, 정책, 신청, 할인, 교통, 게임 등 주제와 실제 확인 필요 여부에 따라 0~99점의 **규칙 기반 편집 우선순위**를 계산합니다.
4. 뉴스 제목이 기존 글 제목과 유사하고 변경·마감·연장 표현이 있으면 '갱신 검토'로 표시합니다.
5. 기사나 공식 자료의 진위는 판단하지 않습니다. 제안은 검토용이며 **어떤 Blogger 글도 자동 수정하거나 게시하지 않습니다.**

점수는 검색량이나 검색 순위, SEO 성공 확률, AI 판단 결과가 아닙니다. 기존 글 목록이 불완전하면 상태를 표시하고, 비교에 실패했을 때 신규 주제가 독창적이라고 주장하지 않습니다.

## 텔레그램 알림(선택)
GitHub 저장소 Settings → Secrets and variables → Actions에 TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID 두 가지 Repository Secrets를 등록합니다. 별셈소 방문 알림에 사용한 기존 Secrets가 있다면 재사용합니다. 토큰이나 채팅 ID를 소스 코드에 넣지 않습니다.

82점 이상 미전송 후보가 있으면 실행당 최대 한 건의 요약 메시지에 세 후보를 담습니다. 전송 기록에는 24자리 후보 해시와 일시만 기록합니다. Chat ID, 토큰, 개인 방문 정보는 저장하지 않습니다. 알림은 실제 정책 변경이나 사실 검증 완료를 의미하지 않습니다.

Telegram 자격증명이 누락됐거나 전송에 실패하면 분석 데이터는 계속 갱신되고 알림은 건너뜁니다. 게시물 제목 비교가 불가능하면 신규 글감 경보는 발송하지 않습니다.

## 테스트·유지 관리
- 오프라인 테스트 명령: python -m unittest discover -s tests -p 'test_news*.py' -v
- GitHub Actions → Collect daily news의 테스트, 수집, 분석, 저장 단계 확인
- data/news-intelligence.json 의 generatedAt과 postCoverage 필드를 확인
- 4시간마다 수집하도록 설정되어 있으나 GitHub Actions 예약 실행은 지연될 수 있습니다.
- RSS 및 Blogger 공개 데이터가 비정상일 때 결과를 성공으로 위장하지 않습니다.

참고: https://developers.google.com/blogger/docs/3.0/using , https://core.telegram.org/bots/api
