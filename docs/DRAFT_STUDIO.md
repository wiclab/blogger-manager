# 이미지 포함 Blogger 초안 자동 준비기

**배포 메뉴:** CMS → 작업 공간 → 이미지 포함 초안 자동 준비기
https://wiclab.github.io/blogger-manager/draft-studio.html

**사용자 목표:** 글 주제 하나를 입력하면 별셈소 또는 Nobody Asked Data의 원고+대표이미지를 AI로 생성하고, Blogger 공식 편집기에 이미지를 직접 업로드하여 본문·라벨·맞춤 퍼머링크·검색 설명을 설정한 뒤 **초안만 저장**합니다. 게시·예약·삭제 기능은 코드에 없습니다.

## 왜 로컬 Chromium 실행기가 필요한가

Blogger API v3는 \`isDraft=true\`로 초안 생성은 가능하지만 새 이미지 파일 업로드, 맞춤 퍼머링크 및 검색 설명 설정을 공식 Post API 필드로 제공하지 않습니다. 따라서 이 세 작업은 **사용자 본인이 로그인한 Blogger 편집기**에서만 실행합니다.

이 저장소의 GitHub Pages는 정적 UI입니다. UI만으로 로그인 쿠키를 읽거나 ChatGPT의 비공개 이미지 라이브러리 데이터를 가져오지 않습니다. 이를 위해 Chromium을 실제로 실행할 수 있는 본인 PC/Work 컴퓨터와 로컬 프로세스가 필요합니다.

**일반 ChatGPT 채팅의 '글 써줘' 메시지가 이 프로그램을 직접 호출하는 연결은 아직 없습니다.** CMS의 주제 입력 버튼으로 실행하거나, Work에서 파일을 전달해 아래 import 명령을 호출할 수 있습니다. 이 경계는 UI에서 숨기지 않습니다.

## 최초 연결 (사용자 PC/Work 컴퓨터)

Node.js 22+와 실제 Chromium 화면을 볼 수 있는 PC나 Work 컴퓨터가 필요합니다. Android 휴대전화 브라우저만으로는 이 PC용 백엔드를 직접 실행할 수 없습니다.

1. 저장소를 복제한 컴퓨터에서 \`npm install --no-save --no-package-lock playwright@1.56.1\` 실행
2. \`npx playwright install chromium\` 실행
3. 터미널 환경변수 설정(공개 저장소나 채팅에 입력하지 마세요):
   - \`OPENAI_API_KEY\`: 본인 OpenAI API 프로젝트 키. Plus 구독과 별도 과금
   - \`BLOGGER_BYEOL_ID\`: 별셈소 Blog ID
   - \`BLOGGER_NOBODY_ID\`: Nobody Asked Data Blog ID
   - (선택) \`OPENAI_TEXT_MODEL\`, \`OPENAI_IMAGE_MODEL\` (기본 gpt-4.1-mini / gpt-image-1)
4. 초기 인증: \`node scripts/draft_studio_blogger.cjs login byeol\` (또는 \`login nobody\`). Chromium에서 Google 로그인을 직접 마친 뒤 터미널에서 Enter. 비밀번호/쿠키는 소스·GitHub에 전송하지 않습니다.
5. 실행: \`node scripts/draft_studio_server.cjs\`
6. 같은 컴퓨터의 브라우저에서 http://127.0.0.1:8765/ 열기. 별셈소/Nobody, 기존 라벨 1개, 주제, 확인된 출처/메모 입력 → **이미지 만들고 Blogger 임시글까지 저장** 클릭.

생성 중 서버는 원고·이미지를 \`.local/draft-studio-jobs/\`에 임시 보관합니다. 이 경로는 \`.gitignore\`로 Git 추적에서 제외됩니다.

## WordPress, Blogger API 및 보안

- 블로그 대상은 등록된 2개 도메인뿐이며, ID는 각각 환경변수로 명시해야 합니다. 다른 블로그로 자동 전환하지 않습니다.
- API 키는 \`127.0.0.1\` 서버 프로세스에서만 사용하며 URL·GitHub Pages·브라우저 HTML에 전달하지 않습니다.
- 서버는 loopback 주소에만 바인딩, Host/Origin 검증, 1개 작업 동시 실행, 입력 크기 제한, 세션 메모리 기반 상태 조회.
- 한 번에 새 글 하나만 작성. 기존 게시글은 수정하지 않습니다. 이미지를 직접 Blogger 편집기에 붙여넣은 뒤 \`blogger.googleusercontent.com\` URL로 바뀌었을 때만 HTML에 삽입.
- 링크·검색 설명·퍼머링크·라벨을 입력하고 \`Save/저장\` 버튼만 누릅니다. Publish/게시/발행 버튼이나 API publish endpoint는 호출하지 않습니다.
- UI 요소 하나라도 확실하지 않으면 실패로 중단하고 **부분 초안이 생성됐을 수 있다는 점을 보고**합니다. 실패한 작업을 무조건 재시도하지 마세요.
- Blogger UI 변경과 로그인 만료 때문에 자동화를 다시 조정해야 할 수 있습니다.
- 메타 설정과 초안 상태 확인에 실패하면 저장 성공으로 보고하지 않습니다.
- 브라우저 프로필에는 민감한 Google 로그인 세션이 있으므로 파일 공유·Git commit 금지. \`.local\` 폴더를 개인 계정 파일로 취급하세요.
- AI 생성 원고는 반드시 사실 확인 후 발행하세요. 특히 최신 수치·법령·검색 의도·금융/건강 정보는 수동 검증이 필요합니다.
- Google에 의도치 않은 로그인 승인을 반복하지 않도록 수동 1회 로그인 방식을 유지합니다.

## Work/ChatGPT가 이미 이미지와 본문을 생성한 경우

Work가 **같은 컴퓨터 파일시스템**에서 이미지 PNG와 JSON 원고를 갖고 있다면 별도 API 생성 없이:

\`node scripts/draft_studio_import.cjs /path/to/article-package.json /path/to/featured.png\`

JSON 예시:

\`\`\`json
{
  "request": {
    "blog": "byeol",
    "topic": "휴대폰 변경 체크리스트",
    "label": "생활정보",
    "notes": "확인된 공식 출처 URL"
  },
  "article": {
    "title": "휴대폰 바꾸기 전 체크리스트",
    "slug": "phone-change-checklist",
    "description": "80~150자의 정확한 검색 설명을 작성합니다. 공식 자료와 검증 기준을 반영하고 핵심 내용을 구체적으로 알려드립니다.",
    "alt": "휴대폰과 체크리스트를 그린 일러스트",
    "image_prompt": "A detailed original flat editorial illustration of a phone checklist, no text, no photo.",
    "html": "<h2>주제별 핵심 점검</h2><p>충분히 작성된 실제 본문 HTML ...</p>"
  }
}
\`\`\`

원고가 너무 짧거나 메타·퍼머링크가 잘못됐으면 저장하지 않습니다. 모든 도구에서 **새 초안만** 만들며 이미 게시한 글은 바꾸지 않습니다.

## 진짜 발행 전에 확인할 것

- Blogger 임시글 편집 URL이 올바른 블로그인지
- Blogger 편집기에 이미지가 올라왔고 googleusercontent 주소로 호스팅되는지
- 대표이미지 1장, ALT, 제목, 단일 라벨, 지정 퍼머링크, 검색 설명
- 모바일에서 표/박스가 깨지지 않는지
- 공식 출처와 내부링크가 정확한지
- 최종 상태가 **Draft/임시글**이며 공개 글이 아닌지

**현재 검증 구분:** GitHub CI는 가짜 Blogger 편집기를 사용한 테스트이므로 실제 Google 계정·실제 Blogger 화면의 동작 성공을 의미하지 않습니다. 실제 로그인 후 1개 테스트 초안으로 처음부터 끝까지 확인해야 운영 준비가 완료됩니다. 일반 채팅에서 이 기능을 즉시 실행하려면 별도 인증된 Work/커넥터 연결이 필요합니다.
