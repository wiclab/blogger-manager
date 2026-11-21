# 별셈소 Blogger 자체 이미지 업로드 — 가끔 켜는 PC 운영 가이드

## 목적

앞으로 일반 ChatGPT 대화에서 글과 대표이미지를 만들고 Drive에 전달하면, Google Apps Script가 Blogger 임시글을 만든 뒤 Google Drive 안에 **이미지 작업 파일**을 남깁니다. PC가 꺼져 있어도 파일은 보관되며, PC를 켜면 실행기가 **이미 만들어진 임시글에만 Blogger 자체 호스팅 이미지**를 업로드합니다.

이 방법은 GitHub Pages 이미지 호스팅을 사용하지 않습니다. 장기 블로그 이미지 링크는 Blogger의 **blogger.googleusercontent.com** 주소를 사용합니다.

**현재 상태: 코드 및 가짜 Blogger 기반 오프라인 자동 테스트 완료, 실계정 PC 설치/이미지 업로드 검증 전. 따라서 ‘게시 버튼만 누르면 끝’ 완성은 아닙니다.**

## 동작 흐름

1. ChatGPT가 Google Drive의 ‘별셈소 ChatGPT 임시글 큐’에 원고 Google Docs 문서와 PNG 이미지를 저장합니다.
2. Apps Script (기존 5분 트리거)가 Blogger DRAFT 생성 후, **실제 post ID**를 포함한 JSON 파일 READY_IMAGE__slug__postId.json을 같은 폴더에 만듭니다.
3. **Google Drive for desktop**이 JSON 및 PNG를 개인 PC에 동기화합니다.
4. PC가 켜진 동안 실행기 스크립트를 실행하면 JSON의 post ID를 기준으로 Blogger **기존 임시글만** 엽니다.
5. 제목·본문·Draft 상태 검증 → PNG 클립보드 붙여넣기 → googleusercontent URL 확인 → 이미지 상단 1장/ALT 저장 → 편집기 새로고침·재검증.
6. 성공: READY_IMAGE__...json 파일명이 DONE_IMAGE__...json으로 변경됩니다. 미확정 오류: REVIEW_IMAGE__...json으로 변경되어 반복 재시도를 금지합니다.

PC가 꺼져 있는 동안 이미지 작업은 대기합니다. PC를 켠 뒤 로그인되어 있고 Google Drive 동기화가 완료되어야 작동합니다. 이미지가 적용되지 않은 임시글을 바로 발행하지 마세요.

## 1. 최초 한 번 Google Apps Script 연결 코드 갱신

기존 Google Apps Script 프로젝트를 재사용합니다. 새 프로젝트나 별도 OAuth 앱을 만들 필요는 없습니다.

현재 GitHub 저장소 PR #53 브랜치의 **최신 Code.gs**를 기존 Google Apps Script 프로젝트에 반영해야 합니다.

https://github.com/wiclab/blogger-manager/blob/feat/chat-to-blogger-draft-bridge-20261104/integrations/drive-draft-bridge/Code.gs

**중요:** GitHub 수정만으로 Google Apps Script 프로젝트가 자동 업데이트되지 않습니다. 기존 Code.gs가 다르게 수정돼 있다면 백업하고 차이를 확인한 뒤 반영하세요. 스크립트 속성 BLOG_ID/INBOX_FOLDER_ID와 기존 5분 트리거는 그대로 유지합니다.

이전부터 임시저장된 와이파이 글에는 Google Apps Script의 preparePendingImageQueues 함수를 **한 번 직접 실행**하세요. 삭제된 예전 초안은 건너뛰고 실제 살아 있는 DRAFT만 검사합니다. 같은 JSON sidecar를 중복 생성하지 않습니다.

**미래 글에서는** PNG가 초안보다 늦게 들어오더라도 다음 트리거에서 backfillWaitingImageQueues_를 통해 이미지 작업 파일을 다시 준비합니다. 미리 저장된 글을 재발행하거나 재생성하지 않습니다.

## 2. 이미지 파일 이름 고정

- 제목·퍼머링크용 영문 slug: wifi-connected-no-internet-troubleshooting
- 이미지 파일: wifi-connected-no-internet-troubleshooting-featured.png
- 위치: 기존 비공개 Drive 폴더에 원고 Google Docs와 **같은 폴더**

이름이 규칙에 안 맞거나 PNG가 없으면 이미지 작업은 생성되지 않습니다. 대표이미지는 PNG로 저장하세요.

Drive 폴더: https://drive.google.com/drive/folders/1Xi-7jbr9epijmFHcdoUVnJoXOsRMzySC

Drive는 중간 전달/백업 용도입니다. Google Drive의 원본 PNG는 저장 용량을 차지합니다. Blogger 업로드·재열람 검증이 성공한 뒤 보관 여부를 정할 수 있습니다. 자동 삭제는 구현하지 않았습니다.

## 3. PC에 최초 한 번 설치

Windows 또는 macOS PC에 [데스크톱용 Google Drive](https://www.google.com/drive/download/)를 설치하여 앞의 별셈소 폴더가 탐색기에 보이게 합니다. **Google Docs 자체가 아닌 일반 JSON과 PNG 파일**을 로컬 실행기가 읽습니다. 스트리밍을 사용한다면 Drive 앱이 동작 중이고 인터넷 연결도 필요합니다.

Node.js 22 이상, npm, Git 및 Playwright Chromium이 필요합니다. 터미널에서:

    git clone https://github.com/wiclab/blogger-manager.git
    cd blogger-manager
    git checkout feat/blogger-native-image-existing-draft-20261104
    npm install --no-save --no-package-lock playwright@1.56.1
    npx playwright install chromium

기존에 저장소를 받은 적 있다면 새로 복제하지 말고 해당 브랜치 코드를 가져오세요.

### Windows

CMD 창에서 로그인용 환경변수 설정 후 **본인 PC의 Chromium 창**에서 직접 Google 로그인:

    set BLOGGER_BYEOL_ID=1659014803305858421
    node scripts/draft_studio_blogger.cjs login byeol

최초 로그인/권한 승인 이후 프로그램은 저장소의 .local/draft-studio-profile에만 로그인 세션을 둡니다. 그 폴더를 GitHub, Drive 또는 타인에게 절대 업로드하지 마세요.

이후 Windows 탐색기에서 다음 파일을 더블클릭:

    scripts/byeolsemso-image-queue-windows.cmd

처음 실행할 때 데스크톱용 Google Drive의 **별셈소 ChatGPT 임시글 큐 폴더 전체 경로**를 입력합니다. 경로는 PC의 .local/byeolsemso-drive-path.txt에만 보관합니다. 실행 후 완료/오류 내용을 확인합니다.

PC가 켜져 있는 동안 새로 들어오는 글까지 자동 처리하려면:

    scripts/byeolsemso-image-queue-windows.cmd --watch

15분 간격으로 대기 작업을 확인합니다. Windows의 Win+R → shell:startup에서 위 스크립트에 --watch를 준 **바로가기**를 시작프로그램에 등록하면, PC에 로그인할 때 자동으로 실행되도록 구성할 수 있습니다. 화면 잠금을 해제하고 Google 로그인 세션이 유효해야 합니다. PC가 꺼져 있을 때에는 아무 작업도 실행되지 않습니다.

### Mac/Linux

Google 계정 로그인에 필요한 환경변수를 지정한 후:

    export BLOGGER_BYEOL_ID=1659014803305858421
    node scripts/draft_studio_blogger.cjs login byeol

다음 실행기를 사용합니다.

    sh scripts/byeolsemso-image-queue-macos-linux.sh

PC가 켜져 있는 동안 자동 확인하고 싶으면:

    sh scripts/byeolsemso-image-queue-macos-linux.sh --watch

## 4. 오류가 나면

- READY_IMAGE__: 아직 처리하지 않았거나 PNG가 동기화되지 않았습니다. PNG가 없는 경우에는 큐 이름을 바꾸지 않습니다.
- DONE_IMAGE__: 기존 Blogger 임시글의 이미지 URL·ALT·Draft 상태까지 재검증에 성공했습니다.
- REVIEW_IMAGE__: 이미지가 올라갔는지/저장됐는지 불확실하거나 원고가 달랐습니다. **절대 자동 재시도하지 말고** 해당 Blogger 편집 URL을 열어 사실을 확인해야 합니다.

Blogger의 로그인 페이지로 이동하거나, 드래프트 제목·본문이 변경되었거나, 기존 이미지가 있다면 실행기가 저장을 거절합니다. 일치 여부를 확인하려고 초안을 삭제하거나 복제해서는 안 됩니다.

## 5. 여전히 남은 기능

이 버전은 **Blogger 서버 이미지 + ALT + 기존 임시글 보완**에 집중합니다. 맞춤 퍼머링크와 검색 설명 자동 설정은 아직 완료하지 않았습니다.

Blogger의 이미지 업로드 UI가 변경되면 테스트가 통과했더라도 실사용에서는 실패할 수 있습니다. PR #53과 #54는 두 개의 **별도 실험 브랜치**이므로, 각각 검증되고 운영 앱에 반영될 때까지 새로운 코드가 실계정에 적용된 것이 아닙니다.

미검증 상태에서 공개 게시글을 변경하지 않고, 어느 단계에서도 **게시/예약/삭제/임의의 새 글 생성**을 하지 않도록 제한했습니다.
