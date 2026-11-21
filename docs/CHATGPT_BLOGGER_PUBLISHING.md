# ChatGPT → Blogger 자동 발행 (GitHub Issue 연결)

Blogger Manager에서 채팅으로 원고를 완성하면 **ChatGPT가 연결된 GitHub 도구로 발행 요청 Issue를 만들고**, GitHub Actions가 Google Blogger API를 호출해 별셈소/노바디에 직접 임시저장 또는 발행합니다. 기존 편집기 `editor.html`은 그대로 유지합니다.

**중요:** 이 코드를 main에 병합하고 최초 Google OAuth 발행 권한 3개를 등록하기 전에는 동작하지 않습니다. 이 방식은 Blogger 전용 ChatGPT 도구가 아니라, ChatGPT의 **GitHub 연결 도구**를 게시 요청 경로로 사용하는 방식입니다.

## 지원 대상

- `byeolsemso`: https://wic12.blogspot.com/
- `nobody`: https://qevnaxori.blogspot.com/
- Pigey Chain은 별도 WordPress 도구로 관리하며 이 자동 발행 기능의 대상이 아닙니다.

## 최초 한 번만 설정: Google OAuth 권한을 Actions Secrets로 연결

1. Google Cloud 프로젝트에서 **Blogger API v3**를 켭니다. Google OAuth 클라이언트 유형으로 **데스크톱 앱**을 별도로 생성합니다. 기존 웹 편집기용 OAuth 클라이언트는 사용하지 않습니다.
2. OAuth 동의 화면에서 해당 Blogger 관리 Google 계정이 사용 가능한지 확인합니다. 외부 OAuth 앱의 Testing 상태는 refresh token 유효기간이 제한될 수 있으므로, 실제 자동화 운영에서는 상태 및 재인증 주기를 점검하세요.
3. 개인 PC에 Python 3.12+와 [GitHub CLI](https://cli.github.com/)를 설치하고 `gh auth login`으로 저장소 관리자 권한을 가진 계정으로 로그인합니다.
4. **이 PR이 main에 병합된 이후** PC에서 다음을 실행합니다.

~~~bash
git clone https://github.com/wiclab/blogger-manager.git
cd blogger-manager
python -m scripts.blogger_agent_setup
~~~

5. 로컬 터미널에서 Google OAuth 데스크톱 앱의 Client ID와 Client Secret을 입력하고, 열린 Google 로그인 창에서 Blogger 접근을 허용합니다. 스크립트가 localhost의 OAuth 응답을 받고 refresh token을 `gh secret set`으로 **직접 비공개 등록**합니다. 비밀값은 출력하거나 파일에 기록하지 않습니다.

설정될 세 가지 GitHub Actions Secrets:

- `BLOGGER_AGENT_CLIENT_ID`
- `BLOGGER_AGENT_CLIENT_SECRET`
- `BLOGGER_AGENT_REFRESH_TOKEN`

등록 여부: [저장소 Actions Secrets](https://github.com/wiclab/blogger-manager/settings/secrets/actions)

**ChatGPT 채팅·GitHub Issue·커밋에 비밀값을 붙여넣지 마세요.** 기존 `BLOGGER_API_KEY`는 읽기용 API 키로서 글쓰기 권한이 없습니다.

## ChatGPT가 사용자 입력 없이 요청하는 방법

사용자가 "별셈소에 세대 급탕비 계산기 글 써서 게시해줘"라고 말하면 ChatGPT는 사실 확인·기존 글 중복·본문 HTML·내부링크를 점검하고 GitHub의 **create_issue** 도구로 아래 형식을 등록합니다.

Issue title: `[blogger-agent] 세대 급탕비 계산기`

Issue body: 아래 **하나의 JSON 객체만** 입력합니다.

~~~json
{
  "version": 1,
  "blog": "byeolsemso",
  "action": "create",
  "visibility": "publish",
  "allow_generated_permalink": true,
  "title": "세대 급탕비 계산 방법과 사용량 계산기",
  "labels": ["관리비", "생활정보"],
  "html": "<h2>세대 급탕비 계산</h2><p>검토한 실제 완성 원고 HTML을 넣습니다.</p>"
}
~~~

- `visibility: "draft"` 는 임시저장만, `visibility: "publish"` 는 임시글 생성 후 즉시 공개 발행을 뜻합니다.
- 자동 공개 시 반드시 `allow_generated_permalink: true` 를 명시해야 합니다. **Blogger API는 맞춤 퍼머링크와 검색설명을 공식 지원하지 않아 자동 URL로 발행됩니다.** 맞춤 URL이 필수인 경우 임시저장 후 Blogger 공식 편집기에서 조정해야 합니다.
- 기존 글 수정은 `action: "update"`, 숫자형 문자열 `post_id`, 서버에서 직전에 읽은 `expected_updated`, 제목/라벨/**전체** HTML을 전송합니다. 원문이 다른 곳에서 수정되면 덮어쓰지 않고 실패합니다. 현재 공개/임시 상태는 유지합니다.
- HTML 안의 안정적인 HTTPS 이미지 주소와 ALT는 넣을 수 있지만 **새 이미지 파일을 Blogger 내부에 업로드할 수 없습니다.** 계산기 JavaScript는 실제 Blogger 화면에서 별도 검증이 필요합니다.
- Issue 생성은 **발행 요청만 완료한 것**입니다. ChatGPT는 Actions 결과와 Issue 댓글의 실제 글 URL을 확인해야만 게시 성공을 보고할 수 있습니다.

실행 기록: [Blogger agent Actions](https://github.com/wiclab/blogger-manager/actions/workflows/blogger-agent.yml)

## 보안과 중복 발행 방지

- 워크플로는 **저장소 소유자 wiclab 계정**이 생성한 `[blogger-agent] ` 제목 Issue에만 실행됩니다.
- 항상 **main의 고정 코드**만 checkout하며 Issue 본문은 엄격하게 검증한 JSON **데이터**로만 취급합니다. Issue 내용으로 Shell 명령을 실행하지 않습니다.
- 두 개의 명시된 Blogspot 주소만 허용하고 Blogger API에서 실제 블로그 ID를 조회해 대조합니다. 삭제 기능은 없습니다.
- 생성은 **임시글 먼저 저장 후 발행**, 재시도 시 기존 글 HTML의 Issue 마커를 검색해 중복 작성이나 중간 실패 후 초안 누락을 막습니다. 기존 글 수정은 서버의 updated 시각 일치 조건으로 보호합니다.
- 실패하면 원인을 Issue 댓글에 남기고, 성공하면 ID·게시 상태·URL을 남깁니다.
- **이 저장소는 공개 저장소이므로 원고를 담은 Issue는 발행 전에도 외부에 보일 수 있습니다.** 비공개/민감한 원고는 넣지 마세요. 비밀 발행을 원하면 전용 비공개 저장소가 필요합니다.
- GitHub Actions Secrets와 Google OAuth 권한을 보호하세요. 초기에는 공개 발행보다 임시저장으로 실제 연동 테스트를 권장합니다.

## 오프라인 점검

~~~bash
python -m unittest discover -s tests -p 'test_blogger_agent.py' -v
python -m compileall -q scripts tests
~~~

오프라인 테스트 통과는 실제 Blogger 인증·저장·발행·이미지·계산기 실행 확인을 의미하지 않습니다.
