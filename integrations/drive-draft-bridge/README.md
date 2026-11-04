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
