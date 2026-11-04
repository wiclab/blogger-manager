# 별셈소 ChatGPT → Blogger 임시글 전송 실험 (Work 미사용)

**상태: 1차 코드 / 미배포 / 실제 Google·Blogger 계정 테스트 전.** 기존 CMS·공개글·GitHub Pages를 변경하지 않습니다.

## 의도와 남은 한계

ChatGPT의 연결된 Google Drive 도구는 개인 Drive에 문서를 만들 수 있습니다. 사용자가 Google Apps Script에 이 폴더의 문서 감시 트리거를 **한 번 설치·인증**하면, 새 문서가 `READY__`로 표시될 때 Blogger API v3에 `isDraft=true`로 원고를 임시저장하고 실제 DRAFT 상태를 다시 읽어 확인합니다. **공개 발행, 예약 발행, 게시물 수정·삭제 기능은 전혀 없습니다.**

이 프로토타입은 **사용자가 원하는 완전 자동 최종형이 아닙니다.** Blogger 공식 API는 맞춤 퍼머링크, 게시글 검색 설명, 새로운 로컬 이미지 바이너리 업로드를 지원하지 않습니다. 따라서 이 실험은 제목·본문·라벨만 Blogger 임시저장합니다. 퍼머링크와 검색 설명은 Blogger 공식 편집기에서 아직 설정해야 하고, 이미지도 기존에 `blogger.googleusercontent.com`에 업로드된 URL이 없는 한 별도 추가가 필요합니다. **문서에 슬러그·설명이 포함되어 있어도 Blogger에 적용했다고 주장하면 안 됩니다.**

최종 목표인 “글 써줘 → 이미지·메타까지 준비된 Blogger 임시글 → 사용자는 게시 버튼만 클릭”에는 추가로 인증된 Blogger 편집 UI 자동화 실행 환경 또는 지원되는 정식 쓰기 커넥터가 필요합니다. 현재 구현만으로 완료했다고 말하지 마세요.

## 사전 준비 (본인 Google 계정에서 1회)

1. ChatGPT가 만들어 둔 **비공개** Google Drive 폴더(별셈소 ChatGPT 임시글 큐)를 사용합니다. 폴더를 공유하거나 공개하지 마세요.
2. [Google Apps Script](https://script.google.com/)에서 개인 스크립트 프로젝트를 만듭니다.
3. `Code.gs`와 `appsscript.json`의 내용을 복사해 넣습니다. 프로젝트 설정에서 manifest 표시를 켜면 됩니다.
4. 프로젝트 설정 → 스크립트 속성에 `BLOG_ID`(본인 Blogger **별셈소** ID), `INBOX_FOLDER_ID`(위 Drive 폴더 ID)를 설정합니다. **OAuth refresh token, 비밀번호, API 키를 문서/채팅/저장소에 입력하지 마세요.**
5. **Blogger API를 연결된 Google Cloud 프로젝트에서 먼저 사용 설정합니다.** `UrlFetchApp` 직접 호출만으로는 API가 활성화되지 않습니다. 기본 관리형 프로젝트에서 `403 accessNotConfigured / SERVICE_DISABLED`가 발생하면 사용자 소유 표준 Cloud 프로젝트에 Blogger API를 활성화하고 Apps Script 설정에서 해당 프로젝트를 연결해야 합니다. Cloud 프로젝트 변경 시 OAuth 구성을 검토하고 재인증합니다. 이 오류 상태에서는 트리거 설치와 전송을 진행하지 않습니다.
6. `installDraftInboxTrigger`를 **본인 계정에서 최초 1회 실행**하고 Google OAuth 권한을 검토해 승인합니다. `drive`, `documents`, `blogger`, 외부 HTTP 요청, 트리거 관리 권한이 필요합니다.
7. 권한/대상 블로그 검사를 통과하면 5분 주기 트리거가 만들어집니다. 처음부터 실제 게시글 생성 테스트를 하지 말고 테스트용 내용을 준비해 본인 Blogger 관리자에서 비공개 초안 상태와 URL을 검증하세요.

스크립트 속성의 `BLOG_ID`는 Blogger 관리자나 검증된 기존 CMS에서 확인해야 합니다. 다른 블로그 ID를 넣으면 코드에서 고정 호스트를 검사하고 중단합니다.

## 입력 원고 형식

사용자의 개인 Google Drive **전용 폴더 안**에서 새 Google Docs 문서를 만들고, 문서 제목을 `READY__<글 제목>`으로 설정합니다. **본문 전체를 아래 JSON 원문 그대로** 넣습니다.

```json
{
  "version": 1,
  "blog": "byeol",
  "publish": false,
  "mode": "draft_only",
  "title": "예시가 아닌 실제 제목을 입력합니다",
  "label": "생활정보",
  "slug": "verified-english-slug",
  "description": "실제 원고의 검색 설명 60~165자를 입력합니다. API는 이 값을 Blogger에 저장할 수 없어 별도 수동 확인이 필요합니다.",
  "alt": "대표 이미지가 무엇을 보여주는지 설명하는 접근성 텍스트",
  "imageUrl": "",
  "html": "<h2>본문 첫 소제목</h2><p>실제로 사실 확인한 충분한 HTML 본문...</p>"
}
```

`html`은 최소 1,300자, 최대 100,000자입니다. `imageUrl`이 있다면 허용된 HTTPS 이미지 호스트와 동일 URL/ALT가 이미 `html`에 포함돼 있어야 합니다. URL이 비어 있으면 본문만 임시저장되고 이미지 업로드는 완료된 것으로 간주되지 않습니다.

본문에는 `h1`, `script`, `iframe`, `form`과 실행 이벤트 핸들러·data URI 등을 넣지 않습니다.

## 상태와 중복 방지

- `READY__`: 처리 대상. Google Drive 문서가 이 이름일 때만 확인.
- `SAVED_NEEDS_SETTINGS__`: Blogger DRAFT 생성·재조회 확인. **미완료 메타/이미지를 확인하기 전 발행 금지.**
- `REVIEW_DUPLICATE__`: 제목 또는 슬러그가 기존 게시글·임시글과 충돌. Blogger 새 글 생성 없음.
- `REVIEW_FAILED__`: 인증 오류/검증 오류/원격 네트워크 실패. Google Apps Script의 **실행 기록** 및 `listDraftBridgeResults` 상태를 확인.
- 기록을 `IN_FLIGHT`로 먼저 남기므로 Blogger API가 타임아웃으로 결과를 반환하지 않아도 **자동 재시도하지 않습니다**. 해당 글이 이미 생성됐는지 관리자가 먼저 확인해야 합니다.
- 자동화는 사용자 의도 없이 삭제·발행·기존 글 변경을 수행하지 않습니다.

## 테스트

저장소 루트에서 다음 단위 테스트를 실행합니다.

```bash
node --test tests/drive_draft_bridge.test.cjs
```

오프라인 테스트는 Blogger API와 Apps Script 서비스를 가짜로 대체합니다. **실제 Google 로그인 및 Blogger 임시저장이 됐다는 증거는 아닙니다.**

## 이후 개선이 필요한 사항

- ChatGPT의 Google Drive 도구를 통해 HTML+이미지 모두 안전하게 전달하는 바이너리 경로.
- 실제 Blogger 편집 화면에서 이미지 업로드, 퍼머링크·검색 설명 설정·ALT·모바일 360/375/412px을 검증하는 별도, 사용자 승인된 자동화.
- 현재 ChatGPT Plus 계정에서 사용자 정의 MCP 쓰기 도구가 실제 활성화 가능한지 계정·서비스 최신 기능 점검.
- 위 조건을 모두 통과하기 전에는 **‘게시 버튼만 누르면 되는 자동완성’이라고 표시하지 말 것**.

## 연결 진단 보정

Google Docs에서 가져온 JSON 앞의 BOM(U+FEFF)은 제거한 뒤 파싱합니다. API 오류에서는 원문 응답이나 토큰을 기록하지 않고 HTTP 상태와 허용된 영문 reason 코드만 기록합니다. BOM 및 API 비활성화 회귀 테스트를 포함한 오프라인 테스트 7개가 통과했습니다. 실제 임시글 생성 성공을 뜻하지 않습니다.

공식 참고: https://developers.google.com/apps-script/guides/cloud-platform-projects


## PC를 상시 켜두지 않는 이미지 업로드 연결 (추가 실험)

Google Apps Script의 새 Code.gs 버전은 Blogger에 DRAFT를 실제로 저장한 뒤, **같은 비공개 Drive 폴더**에서 `<slug>-featured.png`가 발견되면 파일 `READY_IMAGE__<slug>__<postId>.json`을 생성합니다. JSON에는 실제 Blogger 초안 ID, 원고 HTML, ALT, 정확한 이미지 파일명이 저장됩니다. 비밀번호·토큰은 기록하지 않습니다.

이 JSON은 **Google Docs 문서가 아닌 일반 .json 파일**이므로 데스크톱용 Google Drive에서 PC의 파일로 동기화할 수 있습니다. 원본 PNG도 같은 폴더에 있어야 합니다.

- GitHub 코드를 업데이트한 것만으로 **이미 운영 중인 Apps Script 프로젝트는 자동 갱신되지 않습니다.** 사용자는 본인 Apps Script 편집기에서 새 `Code.gs`를 기존 파일에 교체해 저장해야 합니다.
- 이미 생성된 이전 임시글용 큐는 스크립트의 `preparePendingImageQueues` 함수를 본인 Google 계정에서 **한 번 실행**해 만들 수 있습니다. 이 함수는 기존 게시글을 수정하거나 새 글을 만들지 않습니다. 동일한 sidecar를 중복 생성하지 않습니다.
- `<slug>-featured.png`가 없으면 `WAITING_FOR_PNG` 상태만 기록합니다. 이미 만든 임시글은 유지되며 이미지가 생기면 **별도로 backfill 함수를 다시 실행**해야 합니다.
- PC용 로컬 실행기는 별도 Draft PR #54 `scripts/blogger_native_image_queue.cjs`에 있습니다. **Blogger 편집 화면에 이미지 붙여넣기 및 ALT/저장 확인**을 수행하지만, 실제 Blogger 로그인 및 업로드 성공 테스트는 아직 이루어지지 않았습니다.
- PC가 꺼져 있으면 Blogger 글은 **이미지 미설정 임시글**로 남습니다. PC가 켜진 동안에만 실행됩니다.
- 설정 후에도 **맞춤 퍼머링크·검색 설명 자동 설정은 아직 별개 과제**입니다.

두 PR 모두 실계정 테스트를 통과한 뒤에만 운영에 반영해야 합니다.


## ✅ 모바일만으로 대표이미지 업로드 → 채팅 "이미지 올렸어" → 자동 HTML 정리

**새로운 무료/PC 불필요 옵션.** 사용자가 휴대폰 Blogger 편집기에서 기존 임시글에 대표이미지를 **한 장 직접 업로드하고 임시저장**한 후, 같은 ChatGPT 채팅에 **"이미지 올렸어"**라고 말하면 연결된 Google Drive 도구가 아래 요청 파일을 생성하도록 설계되었습니다.

### 진행 순서

1. 기존 별셈소 본문을 Drive → Apps Script → Blogger **임시글**로 생성합니다. 자동화 원본 Docs ID와 실제 Blogger post ID는 Apps Script의 Script Properties에 연결되어 있습니다.
2. 사용자는 Blogger 모바일 웹 편집기에서 그림 1장을 직접 업로드한 뒤 **임시저장**을 누릅니다. 이미지가 Blogger 자체 서버에서 호스팅됩니다.
3. ChatGPT는 `별셈소 ChatGPT 임시글 큐` 폴더에 Google Docs 1개를 만듭니다.
   - 제목: `READY_CLEANUP__<원본 Google Docs ID>`
   - 본문:
     ```json
     {
       "version": 1,
       "action": "tidy_uploaded_blogger_image",
       "blog": "byeol",
       "publish": false,
       "mode": "draft_only",
       "sourceDocId": "<원본 Google Docs ID>"
     }
     ```
   - 대상 원고를 확인할 수 없거나 여러 후보가 있으면 임의로 선택하지 않습니다.
   - 요청 문서를 먼저 `HOLD__` 상태로 만들고 JSON 원문/폴더 확인 후 `READY_CLEANUP__`로 이름을 변경합니다.
4. 기존 **5분 주기 Apps Script 트리거**가 `processDraftInbox` 실행 시 요청을 처리합니다. 별도의 PC, 유료 API, Cloudflare 브라우저 또는 Work가 필요하지 않습니다.
5. Apps Script는 원본 Docs에 기록된 실제 Blogger draft ID를 찾고 Blogger API로 해당 초안 **현재 HTML**을 읽습니다.
6. 다음 조건을 전부 확인한 경우에만 **content 필드에 PATCH**를 요청합니다.
   - 대상은 별셈소 블로그이고 `status=DRAFT` (공개/예약 글은 수정하지 않습니다).
   - 원본 Docs 제목이 일치하며 본문의 **텍스트 및 비이미지 링크가 일치**합니다.
   - **Blogger 자체 googleusercontent 이미지가 정확히 1장** 있고, 원본 원고에는 이미지가 없습니다.
   - 대표이미지의 불필요한 이미지 전용 div/a 래퍼를 제거하고 상단에 중앙 정렬.
   - 원래 저장한 ALT, max-width 100%, height auto, 모바일 대응, 바깥 테두리 제거.
   - **본문 텍스트/제목/라벨/퍼머링크/검색 설명은 건드리지 않습니다.**
7. 저장 이후 API 재조회로 ALT, 이미지 주소, 본문 보존, DRAFT 여부를 확인합니다.
   - 성공: 요청 문서 이름 `DONE_CLEANUP__<원본 ID>`, 기록 `IMAGE_CLEANED`.
   - 실패/모호: `REVIEW_CLEANUP__<원본 ID>`, 기록 `REVIEW_IMAGE_CLEANUP`. **자동 재시도하지 않습니다.**
   - 이미 별도로 준비한 `READY_IMAGE__...` PC 대기열이 있다면 성공 후 `SKIP_IMAGE__...`로 표시합니다. 삭제하지 않습니다.

**중요:** GitHub PR에 이 코드가 추가되더라도 현재 Google Apps Script 프로젝트는 **자동으로 변경되지 않습니다.** 기존 프로젝트의 `Code.gs`를 [최신 브랜치 코드](https://github.com/wiclab/blogger-manager/blob/feat/chat-to-blogger-draft-bridge-20261104/integrations/drive-draft-bridge/Code.gs)로 **최초 한 번 수동 갱신**해야 합니다. 이 기능은 GitHub **모의 테스트**만 통과했으며 실제 Blogger HTML API 수정 검증은 아직 진행하지 않았습니다. 테스트 성공을 실제 글 변경 완료로 착각하지 마세요.

공식 Blogger API는 게시글 수정에 `PATCH /blogs/{blogId}/posts/{postId}`를 지원합니다: https://developers.google.com/blogger/docs/3.0/using#updating_a_post_with_patch_semantics
