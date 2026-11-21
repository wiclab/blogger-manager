# 완성 원고 발행 검토

별셈소 또는 Nobody Asked Data의 완성 HTML과 PNG·JPG·WebP 대표이미지를 검토하고 Blogger 편집기로 넘기는 로컬 도구입니다. GitHub Issue에는 원고를 올리지 않습니다.

## 내 PC에서 실행

1. [임시글 스튜디오의 Chromium 설정](DRAFT_STUDIO.md)을 따라 Playwright와 Chromium을 설치하고 사용할 블로그의 ID를 환경변수로 설정합니다. 발행 검토에는 OpenAI API 키나 GitHub Actions용 OAuth Secrets가 필요하지 않습니다.
2. 기존 로컬 프로필에 Blogger 세션이 없으면 `node scripts/draft_studio_blogger.cjs login byeol` 또는 `node scripts/draft_studio_blogger.cjs login nobody`를 실행합니다. 열린 창에서 본인 Google 계정으로 로그인하고 터미널에서 Enter를 누릅니다.
3. 저장소 루트에서 `node scripts/draft_studio_server.cjs`를 실행한 뒤 [Blogger 발행 검토 화면](http://127.0.0.1:8765/publisher-review.html)을 엽니다.

## 검토와 게시

1. 대상 블로그, 제목, 맞춤 퍼머링크, 라벨, 대표이미지와 대체 텍스트를 입력합니다. 검색 설명은 선택입니다. 본문 HTML을 파일로 가져오거나 붙여넣습니다.
2. **검토본 만들기**에서 제목·라벨·맞춤 퍼머링크·본문·내부링크 주소를 확인합니다. 모바일 너비로도 볼 수 있습니다. 이 단계에서는 Blogger 임시글이나 게시물이 생성되지 않습니다. 본문의 JavaScript는 미리보기에서 실행되지 않습니다.
3. **승인하고 Blogger 편집기 열기**를 선택하면 승인된 원고와 대표이미지가 Blogger에 임시글로 저장됩니다. Chromium 자동 입력이 완료되면 임시글 편집기가 열린 상태로 유지됩니다.
4. 열린 Blogger 편집기에서 공개할 글을 최종 확인하고 Blogger의 **게시** 및 확인 버튼을 직접 누릅니다. Blogger의 글 목록에서 게시 상태와 실제 공개 URL을 확인합니다.

전송 오류나 브라우저 종료 후에는 Blogger의 임시글·게시물 목록을 먼저 확인하세요. 같은 블로그·퍼머링크의 반복 전송을 막기 위해 전송 직전에 로컬 기록을 저장합니다. Blogger에 해당 전송이 반영되지 않은 것을 확인한 경우에만 해당 파일 하나를 `.local/draft-studio-jobs/publish-receipts/`에서 제거한 후 재시도할 수 있습니다.

검토본은 서버 메모리에 보관되며 승인 전에 30분이 지나거나 새 검토본을 만들면 이전 승인은 만료됩니다. 로컬 Chromium 로그인 세션은 `.local/draft-studio-profile/`에 저장됩니다.
