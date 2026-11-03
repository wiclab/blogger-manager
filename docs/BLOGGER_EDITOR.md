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
  
## 대표이미지 추가 (Blogger 자체 저장)
  
Blogger Manager의 별도 R2 이미지 업로드 기능은 제거되었습니다. 이미지 추가는 **Blogger 공식 관리자 편집기**에서 진행합니다.

1. ChatGPT 이미지 라이브러리에서 생성한 이미지를 열고 이미지 데이터의 **이미지 복사**를 선택합니다(링크 복사 아님).
2. Blogger 공식 글 편집기의 본문 맨 위에 커서를 두고 붙여넣습니다.
3. Blogger가 제공한 이미지 태그와 주소를 확인하고 ALT를 설정합니다.
4. 저장 후 다시 글을 열어 실제 이미지 표시를 검증합니다.
5. 기존 Blogger Manager는 HTML·제목·라벨 관리에 계속 사용합니다.

**기존 이미지 주의:** 이전에 R2를 사용했던 글은 여전히 외부 이미지 주소를 참조할 수 있습니다. 저장소와 Cloudflare 이미지 Worker를 삭제하기 전에 모든 공개 글과 임시글의 이미지 URL을 확인해야 합니다. 자세한 주의 사항은 [R2 사용 중단 안내](R2_RETIREMENT.md)를 참고하세요.

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


## 미리보기 갱신과 검증 (2026-11-04)

- `showPreview()`는 미리보기 전용 `assets/editor-preview.js`에 현재 원고와 선택 너비를 전달합니다. 인증·저장·발행 함수는 변경하지 않았습니다.
- 매 갱신마다 새 iframe을 만들고, `load` 등록 후 `srcdoc`를 지정합니다. 이전 갱신의 이벤트·타이머는 취소합니다.
- 로드 이벤트만으로 성공을 판정하지 않습니다. 실제 텍스트/이미지 레이아웃, 이미지 로딩, 화면 너비 및 가로 넘침을 확인하고, 실패나 10초 초과 시 오류를 표시합니다.
- 360/375/412px 선택은 프레임 내부의 실제 뷰포트 기준입니다. CMS 패널이 더 좁으면 화면에 맞게 줄며 확인 메시지에 실제 너비를 표시합니다. 정확한 선택 너비 검사는 충분히 넓은 CMS 창에서 합니다.
- 원문 HTML의 특수문자는 HTML로 한 번만 파싱합니다. 원고 입력값은 변경하지 않습니다. 미리보기 복제본에서 script·base·refresh/CSP meta·중첩 iframe/object/embed를 제거합니다.
- 부모의 렌더링 검사를 위해 iframe에 `allow-same-origin`만 부여합니다. `allow-scripts`는 부여하지 않으며 CSP도 `script-src 'none'`입니다. 폼 전송·팝업·상위 탐색을 허용하지 않습니다. 토큰은 미리보기 문서에 전달하지 않습니다.

### 재현과 한계

운영 클라우드 브라우저에서 최초 원문은 표시됐지만 HTML 수정 후 같은 iframe의 srcdoc를 다시 설정하면 한 줄 문장에서도 빈 화면이 관찰됐습니다. 인증/API 조회는 정상이고 iframe 내부에는 텍스트가 있었습니다. 이전 구현에는 load/렌더링 검사와 실패 안내가 없었습니다.

별도 Chromium 143 환경에서는 이전 구현의 8회 갱신이 정상이라 브라우저 내부의 정확한 트리거는 확정하지 않았습니다. 확인된 결함은 오래된 프레임을 그대로 재사용하면서 로드와 표시 실패를 관찰하지 못하는 처리입니다. 특수문자나 CSP가 원인이었다고 단정하지 않습니다.

### 오프라인 브라우저 회귀 검사

```sh
npm install --no-save --no-package-lock playwright@1.56.1
npx playwright install chromium
node tests/editor_preview_browser.cjs
```

일반 문장, 문단·특수문자, H2, 표, 이미지, FAQ, 긴 본문을 정확한 360/375/412px 프레임에서 렌더링하고 CMS 페이지 자체도 세 너비에서 확인합니다. 20회 갱신, 늦게 도착한 이전 로드 이벤트, 빈/숨겨진 본문, 이미지 실패, 가로 넘침, 로드 시간 초과, 사용자 스크립트 차단을 검사합니다. Google/Blogger 요청은 차단하며 실제 게시글을 읽거나 쓰지 않습니다.
