# 별셈소 ChatGPT MCP 연결 앱 — Cloudflare Worker

별셈소(\`wic12.blogspot.com\`) 전용 **원격 MCP 서버**입니다. Google Blogger API v3를 이용해 ChatGPT에서 Blogger 글을 조회하고 임시저장·수정·발행하는 도구를 제공합니다.

**상태: 개발 코드. Google OAuth 계정 연결과 실서비스 배포·통합 테스트는 아직 완료되지 않았습니다.**
기존 GitHub Pages의 \`editor.html\` 기능과는 별개의 백엔드 Worker이며, 기존 \`blogger-manager-api\` Worker는 건드리지 않습니다.

## 사용 가능한 도구

| 도구 | 기능 |
| --- | --- |
| \`blog_info\` | 허용된 Blogger 블로그 정보 확인 |
| \`list_posts\` | 임시글·발행글·예약글 목록 |
| \`get_post\` | 전체 본문 HTML, 제목, 라벨, 수정일 확인 |
| \`create_draft\` | 새 임시글 생성 (공개 발행 아님) |
| \`update_post\` | 기존 글 일부 필드만 PATCH, 수정 시각 일치 검증 |
| \`publish_draft\` | 임시글 발행 (명시적 PUBLISH 확인값 및 수정 시각 요구) |

**삭제·되돌리기·일괄 수정 도구는 제공하지 않습니다.**

## 비용과 ChatGPT 연결 제약

Cloudflare Workers / KV는 무료 할당량 내에서는 별도 서비스 요금 없이 사용할 수 있습니다. 할당량이나 계정 설정에 따라 비용 조건이 달라질 수 있습니다.

2026-10-31 기준 OpenAI 안내에서 **Full MCP(쓰기/수정)은 ChatGPT Business, Enterprise, Edu에 제공**됩니다. Plus의 일반 대화에서는 이 서버를 만들었다는 이유만으로 쓰기 도구를 사용할 수 없습니다. [공식 안내](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

Plus 계정이라면 지금 당장은 ChatGPT Work의 브라우저/컴퓨터 조작으로 기존 \`editor.html\`을 사용하는 편이 현실적입니다.

## 준비물

- Google Cloud Console에서 Blogger API v3 활성화
- **웹 애플리케이션** 유형의 Google OAuth 클라이언트 ID·클라이언트 비밀키
- Blogger 편집자 권한이 있는 Google 계정. OAuth 테스트 앱이라면 테스트 사용자로 등록
- Cloudflare 계정, Node.js, npm / Wrangler
- 직접 사용할 고유 \`workers.dev\` 주소

> **주의:** 개인 비밀번호, Google OAuth client secret, refresh token, API access token을 ChatGPT 대화나 공개 GitHub에 붙여넣지 마세요.

## 배포 절차

### 1. 저장소 준비

\`\`\`bash
git clone https://github.com/wiclab/blogger-manager.git
cd blogger-manager/mcp
npm install
\`\`\`

### 2. Cloudflare KV 네임스페이스

\`\`\`bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
\`\`\`

출력되는 ID를 \`wrangler.jsonc\`의 \`kv_namespaces[0].id\`에 입력합니다. **\`REPLACE_WITH_YOUR_KV_NAMESPACE_ID\`를 그대로 두고 배포하면 안 됩니다.**

### 3. Worker 도메인 정하기

\`wrangler.jsonc\`의 \`vars.MCP_RESOURCE\`를 실제 사용 주소로 변경합니다.

예시:

\`\`\`json
{
  "MCP_RESOURCE": "https://byeolsemso-blogger-mcp.YOUR-SUBDOMAIN.workers.dev/mcp",
  "ALLOWED_BLOG_HOST": "wic12.blogspot.com"
}
\`\`\`

\`MCP_RESOURCE\`는 **\`/mcp\`를 포함**해야 합니다. 실제 Cloudflare 계정의 서브도메인으로 교체하세요.

### 4. Google Cloud OAuth 설정

Google Cloud Console → Google Auth Platform → **클라이언트**에서 OAuth 웹 앱을 만듭니다(기존 콘솔 웹 클라이언트와 분리 권장).

**승인된 리디렉션 URI:**

\`\`\`text
https://byeolsemso-blogger-mcp.YOUR-SUBDOMAIN.workers.dev/callback
\`\`\`

Google OAuth 동의 화면의 데이터 액세스 범위에 \`https://www.googleapis.com/auth/blogger\`를 추가합니다. 개인 테스트 단계에서는 본인 Google 계정을 테스트 사용자로 등록합니다. Google이 OAuth 검증/보안 경고를 표시할 수 있으며, 테스트 환경의 refresh token은 짧은 유효기간이 적용될 수 있습니다.

### 5. 비밀키 등록

배포 주소가 확정되면 터미널에서 다음 명령을 각각 실행하고 값은 **직접 입력**합니다.

\`\`\`bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put ALLOWED_EMAIL
npx wrangler secret put COOKIE_ENCRYPTION_KEY
\`\`\`

\`COOKIE_ENCRYPTION_KEY\`는 충분히 긴 난수(예: \`openssl rand -hex 32\`)로 생성합니다.
\`ALLOWED_EMAIL\`은 본인이 직접 승인하려는 Google 계정 주소로 설정합니다.

### 6. 검사와 배포

\`\`\`bash
npm run type-check
npm run deploy
\`\`\`

테스트를 위해 MCP Inspector를 사용할 수 있습니다.

\`\`\`bash
npx @modelcontextprotocol/inspector@latest
\`\`\`

Inspector에서 서버 URL \`https://...workers.dev/mcp\`로 연결 → Google 로그인 및 승인 → \`blog_info\`, \`list_posts\`로 읽기 테스트 → **테스트용 임시글만 생성**해서 Blogger 관리자에서 확인하세요.

## ChatGPT 연결 (지원되는 계정/워크스페이스에 한함)

ChatGPT 웹 → Plugins → \`+\` → **Add custom MCP server**, 또는 해당 워크스페이스의 설정 → Apps → Create에서 MCP 서버의 \`https://...workers.dev/mcp\` URL을 등록합니다. OAuth 동의와 도구 스캔이 성공하면 채팅에 이 앱을 선택하여 작업할 수 있습니다.

출처: [OpenAI 연결 안내](https://developers.openai.com/api/docs/guides/custom-mcp-server), [Cloudflare Google OAuth MCP 예시](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-google-oauth).

## 원본 보존과 제약

1. **작성:** 먼저 \`create_draft\`로 임시저장하세요.
2. **퍼머링크/검색설명:** Blogger API v3가 맞춤 퍼머링크·검색설명 필드를 공식 제공하지 않습니다. 발행 전 Blogger 관리자에서 직접 지정해야 합니다.
3. **이미지:** 기존 HTML 이미지 태그는 유지 가능하지만 신규 로컬 대표이미지 업로드 기능은 없습니다.
4. **수정:** \`get_post\`의 \`updated\`값을 \`update_post.expected_updated\`에 넣어 충돌을 확인합니다. HTML 변경 시 기존 전체 본문을 보존하고 필요한 부분만 수정한 HTML을 보냅니다.
5. **발행:** 사용자의 발행 요청과 실제 Blogger 설정 확인 후 \`publish_draft\`를 호출합니다.
6. **보안:** Google 비밀번호를 받지 않습니다. 상위 Google OAuth 및 MCP 동의 흐름으로 승인하고, ALLOWED_EMAIL 및 ALLOWED_BLOG_HOST 두 가지 제한을 둡니다.
7. **토큰:** Google OAuth refresh token이 제공되면 서버에서 자동 갱신할 수 있습니다. 앱/Google 설정에 따라 갱신 토큰이 없거나 무효화되면 다시 연결해야 합니다.

## 출처 및 라이선스

OAuth 동의·state·CSRF 보호 유틸리티는 Cloudflare의 공식
[\`remote-mcp-google-oauth\` 예시](https://github.com/cloudflare/ai/tree/main/demos/remote-mcp-google-oauth) (MIT License)를 기반으로 사용했습니다.
서비스 운영 전에는 [Cloudflare MCP 보안 가이드](https://developers.cloudflare.com/agents/model-context-protocol/guides/securing-mcp-server/)에 따른 보안 검증이 권장됩니다.
