# Atelier AI 작업 지침

## Supabase 작업

Supabase, PostgreSQL, 데이터 모델, Auth, Storage, RLS, MCP, 마이그레이션 또는 백엔드
이전과 관련된 작업을 시작하기 전에 반드시
[`docs/architecture/SUPABASE.md`](docs/architecture/SUPABASE.md)를 읽고 따른다.

핵심 결정:

- 회사 소유 Organization 하나를 사용한다.
- Project는 브랜드별이 아니라 환경별(`prod`, `staging`)로 나눈다.
- 현재는 `E&J` 조직의 `Atelier` 프로젝트 하나로 운영하고, staging은 전체 데이터를 처음
  적재하기 직전에 만든다.
- 여러 브랜드는 한 DB에서 `brand_id`로 엄격히 구분한다.
- UUID, 브랜드별 고유 제약, 브랜드 경로 Storage와 RLS를 사용해 향후 독립 이전이
  가능하게 유지한다.
- staging 이후에는 MCP를 staging 우선으로 쓴다. 단일 프로젝트 기간에는 조회를 우선하고
  파괴적 작업 전에 XLSX 스냅샷을 남긴다.
- 파괴적 작업은 사용자 승인과 백업 없이 실행하지 않는다.
- 위 경계나 권한 모델을 바꾸기 전에 사용자에게 영향과 이전 계획을 설명하고 승인받는다.

## Cursor Cloud specific instructions

이 저장소는 단일 Vite 웹앱(React + TypeScript + Supabase)이다. 환경은
`.cursor/environment.json`이 관리한다(설치 `npm install`, dev 터미널이 자동 기동).
표준 명령은 `package.json` scripts 참고: `npm run dev`(포트 5173), `npm run build`,
`npm run lint`(oxlint), 로직 검증은 `npm run verify:*`.

비자명한 주의사항:

- **`npm ci`는 실패한다.** 커밋된 `package-lock.json`이 리눅스용 선택적 의존성
  (`@emnapi/core`, `@emnapi/wasi-threads`)을 누락해 sync 오류가 난다. `npm install`을 쓴다.
- **Supabase 연결은 env로 주입된다.** 앱은 `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`를 읽는다. Vite는 `VITE_*` 접두 변수를 process env에서
  그대로 인라인하므로, 시크릿이 주입된 Cloud 환경에서는 `.env.local` 없이도 앱이 연결된다.
  (선택) `VITE_DEV_LOGIN_EMAIL`/`VITE_DEV_LOGIN_PASSWORD`가 있으면 로그인 화면의
  "개발 로그인" 버튼으로 Google OAuth 없이 이메일 로그인이 된다.
- **`.env.local`을 직접 파싱하는 스크립트가 6개 있다**(`npm run check:supabase`,
  `verify:ai-learning-rpc`, `verify:ai-learning-deployment`, `verify:ai-feedback-cache-fix`,
  `scripts/snapshot-*.mjs`). 이들은 process env가 아니라 파일을 읽으므로, 실행 전
  주입된 값으로 `.env.local`을 만들어야 한다(파일은 `.gitignore`의 `*.local`로 제외됨):
  `for v in VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_DEV_LOGIN_EMAIL VITE_DEV_LOGIN_PASSWORD; do printf '%s=%s\n' "$v" "$(printenv "$v")"; done > .env.local`
- **`npm run verify:option-maps`는 현재 `main`에서 도메인 로직 assert로 실패한다**
  (환경 문제 아님, 앱 코드 미수정 상태의 기존 이슈).
- **`npm run verify:ai-learning-deployment`는 배포된 `ai-gateway` 엣지 함수를 호출**하며,
  서버측 설정에 따라 HTTP 500이 날 수 있다. 로컬 환경 설정과 무관한 배포측 상태다.
