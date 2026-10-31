# Blogger 글 편집 콘솔

Blogger Manager의 **글 편집·발행** 메뉴에서 `editor.html`로 이동합니다.

## 제공 기능

- 내 Google 계정으로 Blogger API OAuth 2.0 권한 승인
- Blogger 계정의 블로그 선택 (별셈소 도메인 우선 선택)
- 임시글·공개글·예약글 목록, 제목 검색, 페이지 추가 로드
- 기존 글의 제목·라벨·HTML 불러오기/편집/미리보기
- 새 글 **비공개 임시저장**, 기존 글 수정, 임시글 발행
- 서버 원문 변경 검증(다른 편집기에서 변경된 게시물을 덮어쓰지 않음)
- 발행 전 확인 창 2회, 보안상 삭제/일괄 수정 미지원
- Google 액세스 토큰은 현재 브라우저 탭의 메모리에만 보관(로컬 스토리지 및 자체 서버 저장 안 함)

## 1회 설정 및 테스트

1. Google Cloud Console의 기존 Google OAuth 웹 클라이언트 `745983224346-2bir36jrfv79g8igk46aocv49o44u50f.apps.googleusercontent.com`에 GitHub Pages 사이트의 **JavaScript 출처**가 등록됐는지 확인합니다. (일반적으로 `https://wiclab.github.io`)
2. 프로젝트에서 **Blogger API v3**가 활성화돼 있어야 합니다.
3. OAuth 동의 화면의 테스트 단계라면 해당 Google 계정이 테스트 사용자로 등록되어야 합니다. Blogger API 권한 `https://www.googleapis.com/auth/blogger`을 요구합니다.
4. `https://wiclab.github.io/blogger-manager/editor.html`에서 Google 계정을 연결하고 블로그/게시물 목록을 조회합니다.
5. 먼저 테스트용 임시글을 생성하고 Blogger 관리자에서 실제 글을 확인합니다. 그 뒤 공개 발행을 테스트하세요.

주의: 기존 Cloudflare Workers의 `/oauth/blogger/status`로 처리하는 **관리자 로그인(ID 토큰)**과 이 페이지의 **Blogger API 액세스 토큰**은 별개입니다. 이 페이지는 Google API에 직접 요청합니다. Blogger 권한을 가진 Google 계정만 본인의 블로그를 수정할 수 있습니다.

## 퍼머링크와 검색설명

Blogger API v3의 현재 Post resource에는 맞춤 퍼머링크 및 검색설명을 설정하는 공식 지원 필드가 없습니다. 편집 콘솔은 해당 값을 자동 설정한다고 주장하지 않습니다. **신규 글은 임시저장 → Blogger 관리자 화면에서 퍼머링크·검색설명·대표이미지 설정 → 콘솔에서 발행** 순서로 처리합니다.

API로 HTML을 저장하면 본문의 기존 이미지 태그는 유지할 수 있지만, 새로운 로컬 이미지 파일을 Blogger에 업로드하는 기능은 제공하지 않습니다.

## ChatGPT에서 직접 조작하기

이 페이지는 사용자가 직접 조작하거나 **ChatGPT Work의 컴퓨터/브라우저 제어**로 사용할 수 있는 웹 UI입니다. 이 파일을 GitHub에 추가하는 것만으로 일반 ChatGPT 대화에 Blogger 수정 도구가 설치되는 것은 아닙니다.

ChatGPT에 직접 API 쓰기 도구를 연결하려면 별도 원격 MCP 서버와 OAuth 인증, 계정/요금제의 해당 앱 연결 기능이 필요합니다.

## 보안

- 게시물 목록/본문은 구글 Blogger API에서 직접 가져옵니다.
- Google API 토큰을 URL 파라미터·서버·Storage에 저장하지 않습니다.
- 미리보기 iframe은 `sandbox` 속성으로 스크립트 실행을 막습니다.
- 새 임시글 작성/수정/발행에 사용자 버튼 클릭과 확인을 요구합니다.
- 원문이 다른 기기에서 업데이트되면 기존 글 수정을 중단합니다.

## 공식 문서

- [Blogger API v3](https://developers.google.com/blogger/docs/3.0/reference)
- [Blogger Posts](https://developers.google.com/blogger/docs/3.0/reference/posts)
- [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/overview)
