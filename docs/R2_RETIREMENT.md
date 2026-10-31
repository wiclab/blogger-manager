# Cloudflare R2 이미지 업로드 기능 사용 중단

2026-11-01부터 Blogger Manager의 **R2 이미지 업로드 UI, 브라우저 업로드 코드, 이미지 Worker 배포 워크플로와 Worker 소스**를 GitHub 저장소에서 제거했습니다.

## 앞으로 사용하는 방식

- ChatGPT에서 대표이미지 제작
- ChatGPT 이미지 라이브러리의 **이미지 복사** (링크 복사가 아닌 이미지 데이터)
- Blogger 공식 관리자 편집기에 붙여넣기
- Blogger 측 이미지 주소 확인, ALT 설정, 임시저장/재열기 검증
- Blogger Manager는 제목·라벨·본문 HTML 수정, 임시저장, 발행에 사용

## 반드시 유지해야 하는 것

GitHub 파일과 워크플로를 제거하는 것은 **이미 Cloudflare에 배포된 Worker를 삭제하거나 버킷/이미지를 삭제하는 것이 아닙니다.**

이전 글에서 `byeolsemso-image-worker.chldndlf91.workers.dev/images/...`를 참조할 수 있으므로, 모든 관련 글을 Blogger 자체 이미지 주소로 이전하고 게시물과 목록 썸네일을 재검증할 때까지 다음 리소스를 유지하세요.

- Cloudflare Worker: `byeolsemso-image-worker`
- Cloudflare R2 버킷: `byeolsemso-images`

GitHub Actions Secrets(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BLOGGER_ADMIN_EMAIL`)는 이번 변경에서 수정·삭제하지 않았습니다. 기타 워크플로의 사용 여부와 이전된 이미지 참조를 먼저 확인하고 사용하지 않는 비밀키는 별도로 정리할 수 있습니다.

R2 이미지 삭제는 **해당 URL을 참조하는 모든 글 및 임시글에서 이전 완료가 확인된 다음**에만 검토하세요. Git 히스토리에는 복구용 이전 코드가 남아 있습니다.
