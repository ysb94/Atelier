# Mamam 임시 아이디어 공모

정적 사이트는 Netlify에 따로 배포하고, 접수 데이터만 기존 Atelier Supabase에
격리해 저장한다. 로그인 없는 공개 화면에서는 제출만 가능하며 목록 조회·수정·삭제는
허용하지 않는다.

## 운영 리소스

- 공개 주소: `https://masmarulez-idea-contest.netlify.app`
- Netlify 사이트 ID: `2e1448d7-acbb-47fe-81f6-728e95476e0f`
- 테이블: `public.mamam_idea_submissions`
- 비공개 Storage 버킷: `mamam-idea-images`
- 비공개 함수 스키마: `mamam_private`
- 공개 제출 RPC:
  - `public.begin_mamam_idea_submission`
  - `public.complete_mamam_idea_submission`
- 내부 접수함: Atelier `/idea-contest`
  - 활성 `dev@atelier.local` 계정과 직책이 `대표이사`인 활성 계정만 표시·조회
  - `app.mamam_inbox_company_id()`로 회사와 권한을 함께 제한
  - 비공개 이미지는 `app.can_read_mamam_idea_image(text)`와 Storage SELECT 정책으로 제한
- Netlify 배포 원본: `mamam/`

정상 완료된 접수 내용과 첨부 이미지는 Atelier 내부 접수함에서 확인한다. 원본은
Supabase Dashboard의 Table Editor와 비공개
`mamam-idea-images/{접수 UUID}/` Storage 폴더에 있고, 테이블의 `image_paths`와
연결된다. 실패한 `uploading` 행은 내부 접수함에 표시하지 않는다.

## 제거 순서

제거는 파괴적 작업이므로 먼저 테이블을 CSV/XLSX로 내보내고 이미지 버킷을 내려받은
뒤 사용자 승인을 받아 마이그레이션으로 처리한다.

1. Netlify 사이트를 비활성화해 새 접수를 막는다.
2. 접수 테이블과 이미지 버킷을 백업한다.
3. 버킷의 객체와 버킷을 제거한다.
4. `mamam_idea_images_insert`, `mamam_idea_images_inbox_read`,
   `mamam_idea_submissions_inbox_read` 정책을 제거한다.
5. `app.mamam_inbox_company_id()`, `app.can_read_mamam_idea_image(text)`와
   두 공개 제출 RPC를 제거한다.
6. `public.mamam_idea_submissions`와 `mamam_private` 스키마를 제거한다.
7. Atelier의 `/idea-contest` 화면과 사이드바 메뉴를 제거한다.
8. Netlify 사이트를 삭제한다.

다른 Atelier 업무 테이블·버킷과 이름이나 권한을 공유하지 않으므로 위 리소스만
제거하면 된다.
