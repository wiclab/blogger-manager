# 별셈소 대표이미지 자동 업로드 (Cloudflare R2)

## 가장 쉬운 배포: GitHub Actions 한 번 실행

**코드는 준비됐지만, Cloudflare 계정 비밀값이 없으므로 아직 실제 배포되지 않았습니다.**

Cloudflare 계정에서 [API 토큰](https://dash.cloudflare.com/profile/api-tokens)을 만듭니다.
`Edit Cloudflare Workers` 템플릿을 선택하거나 계정 단위로 **Workers Scripts Write, Workers R2 Storage Write** 권한을 가진 토큰을 발급하세요. 가능하면 현재 사용하는 Cloudflare 계정으로만 범위를 제한하세요.

[GitHub 저장소 Actions Secrets](https://github.com/wiclab/blogger-manager/settings/secrets/actions)에서 다음 **Repository secrets 세 개**를 직접 등록합니다. 값을 채팅에 보내면 안 됩니다.

| GitHub Secret 이름 | 넣는 값 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 위에서 생성한 Cloudflare API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 계정의 Account ID |
| `BLOGGER_ADMIN_EMAIL` | Google Blogger 관리자 로그인 이메일 |

이후 [GitHub Actions: Deploy Byeolsemso image uploader](https://github.com/wiclab/blogger-manager/actions/workflows/deploy-image-worker.yml)로 이동해 **Run workflow** → 브랜치 `main` → **Run workflow**를 누르세요.

자동 배포 작업은 아래 단계를 처리하도록 만들어져 있습니다.

1. 이미지 Worker 테스트
2. R2 버킷 `byeolsemso-images` 확인, 없으면 자동 생성
3. Cloudflare에 별도 이미지 Worker 배포
4. Google 관리자 이메일을 Worker 비밀 설정에 등록
5. Worker의 `/api/health` 응답 검사
6. 성공 시 GitHub Pages의 `image-upload-config.js`에 검증된 Worker 주소 자동 반영

**중요:** Cloudflare 계정에서 R2 사용이 활성화되어 있어야 하고, Workers.dev 도메인 배포가 가능한 상태여야 합니다. 계정 설정이나 권한이 부족하면 GitHub Actions에서 실패합니다. 이는 무료 제공량을 넘을 때 비용이 발생할 수도 있는 서비스입니다.

토큰은 GitHub Secrets에만 등록하며 공개 저장소에 절대 복사하지 마세요.


Blogger 이미지 선택기의 Google 쿠키/로그인 오류 없이, 파일 또는 클립보드 이미지 → WebP 최적화 → R2 업로드 → Blogger 본문 상단 HTML 삽입을 수행합니다.

**현재 상태:** 코드 구현. Cloudflare 실제 배포와 Google 관리자 계정 로그인, Blogger 썸네일 통합 테스트는 아직 진행하지 않았습니다.

## 1. R2 버킷 생성

Cloudflare R2 대시보드에서 이름이 byeolsemso-images인 버킷을 생성합니다.
버킷의 공개 액세스는 켤 필요가 없습니다.

터미널 작업이 가능하다면 다음과 같이 생성할 수도 있습니다.

    npx wrangler login
    npx wrangler r2 bucket create byeolsemso-images

## 2. 이미지 Worker 배포

    git clone https://github.com/wiclab/blogger-manager.git
    cd blogger-manager/image-worker
    npm install
    npm test
    npm run deploy

Worker 이름은 byeolsemso-image-worker, R2 바인딩 이름은 IMAGES입니다.
기존 blogger-manager-api Worker는 건드리지 않습니다.

배포된 Worker 주소 형식:

    https://byeolsemso-image-worker.YOUR-SUBDOMAIN.workers.dev

## 3. 관리자 계정의 Google 이메일 보호 설정

이미지 Worker 디렉터리에서 다음 명령을 실행합니다.

    npx wrangler secret put ALLOWED_GOOGLE_EMAIL

질문이 나타나면 Blogger 관리자 Google 계정의 이메일을 **터미널에 직접** 입력합니다.
이메일과 토큰, 비밀번호를 공개 GitHub 파일이나 ChatGPT 대화에 넣지 마세요.

이 프로젝트는 기존 Blogger Manager의 Google OAuth 웹 클라이언트 ID를 사용하며, Google Cloud 콘솔에서 승인된 JavaScript 출처에 https://wiclab.github.io 가 등록돼 있어야 합니다.
선택적으로 Google 사용자의 sub 식별자를 ALLOWED_GOOGLE_SUB secret으로 더 강하게 고정할 수 있습니다.

## 4. 콘솔에 실제 Worker 주소 연결

GitHub 저장소 루트의 image-upload-config.js를 열고 다음 설정을 변경합니다.

현재:

    window.BLOGGER_IMAGE_WORKER_URL = "";

변경 예:

    window.BLOGGER_IMAGE_WORKER_URL = "https://byeolsemso-image-worker.YOUR-SUBDOMAIN.workers.dev";

이 파일은 공개 파일이므로 비밀번호, R2 API 키 또는 ID 토큰을 넣으면 안 됩니다.

주소가 비어 있으면 업로드 버튼은 비활성화됩니다.

## 5. 실제 업로드

1. https://wiclab.github.io/blogger-manager/editor.html 를 엽니다.
2. Google 계정을 연결합니다. 이미지 패널의 관리자 Google 로그인도 완료합니다.
3. ALT 텍스트를 적습니다.
4. 이미지 선택 버튼을 누르면 자동으로 WebP 변환, R2 업로드, HTML 상단 삽입이 실행됩니다.
5. 또는 ChatGPT에서 이미지를 복사하고 클립보드 이미지 붙여넣기 버튼을 누릅니다.
6. 편집 콘솔의 저장 버튼을 눌러야 Blogger 글이 실제로 변경됩니다.
7. 발행 전 Blogger의 본문 표시 및 목록 썸네일 노출을 확인하세요.

Worker 건강 상태:

    https://byeolsemso-image-worker.YOUR-SUBDOMAIN.workers.dev/api/health

configured 표시는 서버 기본 설정이 있다는 뜻이지 실 업로드가 성공했다는 의미는 아닙니다.

## 주의사항

- Google ID 토큰의 서명, audience, 발급자, 유효기간 및 관리자 이메일을 서버에서 확인합니다.
- 업로드는 https://wiclab.github.io 출처에서만 허용됩니다.
- PNG, JPEG, WebP만 허용합니다. Worker 업로드 크기는 최대 5MB입니다.
- 브라우저에서 최대변 1254픽셀, 목표 약 210KB의 WebP로 압축합니다.
- R2 버킷은 비공개이고 공개된 개별 이미지 URL은 Worker가 제공합니다.
- 이미지 파일이 Blogger 자체 서버에 저장되는 것은 아닙니다.
- Worker URL, 배포 서비스 또는 R2 버킷을 제거하면 기존 블로그 이미지가 깨질 수 있습니다.
- Blogger 테마에 따라 외부 이미지의 글 목록 썸네일이 자동 생성되지 않을 수 있으므로 테스트가 필요합니다.
- 이미지 최적화는 업로드 완료 후 자동 반영되지만 Blogger 게시물 저장 및 발행은 별도 동작입니다.
- Workers와 R2의 무료 할당량 초과 시 요금 또는 제한이 발생할 수 있습니다.
- ChatGPT 안에서 생성한 이미지가 이 서버로 즉시 무인 전송되는 기능은 포함하지 않습니다. 현재는 파일 선택 또는 이미지 복사가 필요합니다.

## 공식 참고

- https://developers.cloudflare.com/r2/get-started/workers-api/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
