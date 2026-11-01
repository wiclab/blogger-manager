# 별셈소 방문 알림 (Cloudflare Worker + Telegram)

이 저장소에는 **별셈소 전용 방문 알림 프로그램과 배포 자동화**가 들어 있습니다. 실제 알림은 Cloudflare Worker 배포, Telegram 봇 연결, Blogger 테마에 감지 스크립트 삽입을 모두 마친 후 시작됩니다. **코드가 GitHub에 있다고 알림이 자동으로 켜지는 것은 아닙니다.**

## 동작

- 별셈소 홈과 공개 글을 열 때마다 방문 이벤트를 서버에 전송합니다. 단, **전체 방문에 공통으로 최소 5분 간격**을 적용하므로 5분 안에 추가로 열린 페이지는 새 알림을 보내지 않습니다.
- 텔레그램에는 **공개 글 제목, 공개 페이지 경로(쿼리 제외), 모바일/PC 분류, 한국시간**만 보냅니다.
- IP 주소, 쿠키, 사용자 ID, 방문자 지문, 검색어, 전체 접속 기록은 저장하지 않습니다. Durable Object에는 **마지막 알림 전송 시도 시각** 하나만 저장합니다.
- 요청 Origin·Referer·User-Agent 및 가능한 경우 Cloudflare 봇 판별 정보를 검사합니다. 공개 브라우저 이벤트는 실제 사람 방문을 증명하지 못하므로 위조나 봇 요청을 **완전히 막을 수는 없습니다.**
- Cloudflare Durable Object 한 인스턴스를 사용해 동시 요청에도 전역 간격을 유지합니다. Telegram 오류 후에도 잠시 재시도를 제한합니다.
- 기존 Cloudflare 인증 Worker, 별셈소 게시글, 다른 블로그, GitHub 원고 발행 워크플로는 수정하지 않습니다.

## 1. GitHub Secrets 등록

공개 리포지토리의 [Settings → Secrets and variables → Actions](https://github.com/wiclab/blogger-manager/settings/secrets/actions)에서 아래 네 가지 Repository Secrets를 설정하세요.

| 이름 | 입력할 값 |
|---|---|
| CLOUDFLARE_ACCOUNT_ID | 새 Worker를 배포할 Cloudflare 계정 ID |
| CLOUDFLARE_API_TOKEN | 해당 계정에 한정된 최소 권한 Workers 배포 API 토큰 |
| TELEGRAM_BOT_TOKEN | [@BotFather](https://t.me/BotFather)에서 생성한 Telegram 봇 토큰 |
| TELEGRAM_CHAT_ID | 알림을 받을 자신의 Telegram chat.id |

봇을 생성한 뒤 Telegram에서 봇에게 **/start** 메시지를 먼저 보내세요. Telegram 공식 Bot API의 getUpdates 메서드에서 자신의 chat.id를 확인할 수 있습니다. **봇 토큰과 Cloudflare API 토큰은 공개 저장소·이슈·채팅에 붙여 넣지 마세요.**

기존 Cloudflare 계정의 다른 Worker를 임의로 배포/삭제하지 않도록 API 토큰은 필요한 권한과 계정으로 제한하세요. GitHub Actions 배포 절차: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

## 2. GitHub Actions 실행

- [Byeolsemso Telegram visitor alert deploy](https://github.com/wiclab/blogger-manager/actions/workflows/visitor-alert.yml) → Run workflow
- 필수 Secrets가 없으면 Node 테스트만 수행하고 **배포는 건너뜁니다.**
- 네 값이 모두 있을 때 Cloudflare Wrangler로 별도 Worker 이름 byeolsemso-visitor-alert를 배포하고 Telegram 비밀값을 Worker Secret으로 설정합니다.
- 배포 로그에서 **실제 Worker URL**을 확인하세요. URL은 자동 추측하거나 코드에 고정하지 않습니다.
- 배포된 Worker의 https://실제-주소/health 에서 별셈소 상태 정보가 나오는지 확인할 수 있습니다.

## 3. Blogger에 감지 코드 한 번 삽입 (필수)

1. Blogger → 별셈소 → 테마 → **백업** → HTML 편집
2. [blogger-embed.js](./blogger-embed.js)의 script 태그 전체를 테마 HTML의 **닫는 body 태그 바로 앞**에 복사
3. 파일에 있는 WORKER_URL을 **실제 배포된 workers.dev URL**로 바꾸고 저장
4. 별셈소 공개 글을 모바일에서 열어 알림을 확인하고 **5분 이상 지난 뒤** PC에서 다시 열어 기기 구분을 검증
5. 본인 방문도 알림 대상입니다. Browser의 JavaScript/추적 차단기 때문에 일부 방문은 누락될 수 있습니다.

**중요:** Blogger Posts API로는 테마 HTML에 방문 감지 스크립트를 삽입할 수 없습니다. Blogger 테마 작업은 별도로 완료해야 합니다. 스크립트를 중복 삽입하지 마세요.

## 알림·보안 특성

- URL의 쿼리 문자열·해시와 검색어, 전체 Referer를 수집하거나 전송하지 않습니다.
- HTTP 응답은 no-store로 설정되어 방문 정보를 캐시하지 않습니다. 서버에서는 이벤트 히스토리를 만들지 않습니다.
- Origin 헤더는 브라우저 차원의 보호이며, 직접 만든 HTTP 클라이언트가 위조할 수 있습니다. 5분 전역 제한이 과도한 텔레그램 메시지를 억제합니다.
- 방문자 개인정보 처리 안내 및 국외 서비스 전송 관련 고지가 필요한지 운영자가 확인하세요.
- 다른 분석 스크립트(Clarity 등)는 필요 없고 이 스크립트를 통해 추가하는 방문 분석은 알림만 담당합니다.
- 끄려면 Blogger 테마에 넣은 스크립트를 제거하세요. Worker 중지는 Cloudflare에서 **byeolsemso-visitor-alert만** 대상으로 해야 하며 기존 Cloudflare 인증 Worker는 변경하지 마세요.

## 테스트

- GitHub Actions에서 npm run check, npm test가 통과해야 배포 단계로 넘어갑니다.
- Tests는 실제 Telegram 발송 대신 네트워크 모의 객체로 CORS·잘못된 출처·봇 차단·5분 간격·비밀정보 미저장을 검사합니다.

참고: https://core.telegram.org/bots/api , https://developers.cloudflare.com/durable-objects/platform/pricing/
