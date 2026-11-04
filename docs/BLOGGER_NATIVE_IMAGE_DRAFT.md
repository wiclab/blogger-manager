# Blogger 자체 호스팅 대표이미지: 기존 임시글 보강 (실험)

**상태:** 기능 코드와 오프라인 브라우저 테스트 작성 완료. 실제 계정 로그인과 Google 서버 이미지 업로드 실험 전. 기존 게시물 또는 CMS 변경 없음.

## 목적

기존 Google Apps Script의 Blogger isDraft=true 초안 생성 후 해당 초안에만 이미지를 추가한다. Playwright Chromium으로 Blogger 편집기에서 PNG를 직접 붙여넣고, 새로 생성된 blogger.googleusercontent.com URL 및 ALT를 본문 최상단에 반영한 뒤 **저장만** 한다.

GitHub 저장소에 이미지를 영구 보관하지 않는다. Blogger 공식 미디어 관리(https://support.google.com/blogger/answer/41641)를 사용한다.

## 안전조건

- blog=byeol, 정확한 숫자형 blog ID + post ID, title 일치, Draft 상태 표시, 완성 원고의 본문 텍스트 일치 모두 확인.
- 기존 이미지가 있거나 사용자가 본문을 편집했다면 즉시 중단. 내용 덮어쓰기 금지.
- 새로 업로드된 고유 Google 호스팅 이미지 URL을 얻어야만 새 HTML을 저장.
- 저장 후 새로고침해서 이미지 URL·ALT·Draft 상태 재검증.
- 새 글 생성, 공개 발행, 예약, 삭제 명령 없음.
- 로그인 쿠키는 본인의 Chromium 프로필 안에 보관. GitHub, 채팅, 공유 Drive에 절대 저장하지 말 것.
- 이미지 업로드는 성공했으나 본문 저장이 실패하면 Blogger 미디어 관리에 미사용 파일이 남을 수 있음.

## 실행 전제

Google 계정으로 1회 수동 로그인한 Chromium 실행기 필요. 본인 PC 또는 격리된 개인 클라우드 호스트가 필요하며 Android 브라우저만으로 Node/Playwright 프로그램을 직접 구동할 수는 없다.

설치/실행 예시:

    git clone https://github.com/wiclab/blogger-manager.git
    cd blogger-manager
    git checkout feat/blogger-native-image-existing-draft-20261104
    npm install --no-save --no-package-lock playwright@1.56.1
    npx playwright install chromium

환경변수 BLOGGER_BYEOL_ID=1659014803305858421 설정.

수동 로그인:

    node scripts/draft_studio_blogger.cjs login byeol

이미 만들어진 Blogger 임시글 편집 URL에서 post ID를 실제로 확인하고, 아래 필드가 들어있는 job.json을 만든다. 지정한 제목과 본문은 **기존 Blogger 임시글의 원고와 정확히 동일**해야 한다.

    {
      "blog": "byeol",
      "mode": "draft_only",
      "publish": false,
      "postId": "확인된-숫자형-포스트-ID",
      "title": "정확히 일치하는 기존 임시글 제목",
      "html": "<article><h2>완성된 기존 본문</h2>...</article>",
      "alt": "이미지 설명"
    }

이미지 파일은 실제 PNG이고 1KB~15MB이어야 한다.

    node scripts/blogger_native_image_draft.cjs job.json featured.png

정확한 Blogger 초안 ID를 모르면 실행하지 말 것. CLI가 성공으로 보고할 때만 이미지와 ALT가 실제 저장됐다고 간주한다.

## ChatGPT 직접 자동 실행을 위한 남은 작업

현재 CLI는 자동으로 구동되지 않는다. Work 없이 매번 실행하려면 사용자 소유의 지속형 컴퓨터/호스트와 기존 Google Drive 원고 폴더를 읽는 인증된 큐 클라이언트, Blogger 초안 postId를 전달하는 방식, 중복 처리 기록, 로그인 만료 관리가 추가로 필요하다.

그리고 Blogger의 맞춤 퍼머링크 및 검색 설명은 본 CLI의 범위 밖이다. 이 두 메타 정보도 검증되어야 '사용자는 게시 버튼만 클릭' 단계에 도달한다.

## 테스트

    node --check scripts/blogger_native_image_draft.cjs
    node tests/blogger_native_image_draft_browser.cjs

CI는 실제 Google과 통신하지 않는 가짜 Blogger 화면이다. 통과하더라도 실사용 검증 전에는 운영에 자동 연결하지 말 것.
