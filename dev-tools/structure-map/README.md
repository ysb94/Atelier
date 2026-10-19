# Atelier AI 전용 코드 목차 (Structure Map)

사람용 웹 뷰어 없이 **AI의 토큰 절감과 즉각적인 코드 위치 특정**만을 위해 설계된 정적 분석 목차 도구다.
앱 코드와 분리되어 있으며 `npm run build`나 운영 배포 번들에 포함하지 않는다.

## 생성 파일 (`dev-tools/structure-map/generated/`)

1. **`ai-index.md` (AI 1차 조회용 초고밀도 마크다운 목차)**
   - **Section 0 (`L1-L10`)**: 도메인별 줄 번호 구간(`L시작-L끝`) 및 Routes / Supabase Resources 위치 안내.
   - **Section 1 (`Routes`)**: 모든 URL 경로 → 메뉴명 → 진입 컴포넌트/파일 및 정의 줄 번호.
   - **Section 2 (`Files by Domain`)**: 도메인별 파일 경로, 총 줄 수(`lines`), 한글 기능명, 모든 export 심볼과 시작 줄 번호(`심볼:줄번호`), UI 주요 제목, 직접 사용하는 Supabase 테이블/RPC 및 API 위임 대상.
   - **Section 3 (`Supabase Resources`)**: `table:*`, `rpc:*`, `storage:*`, `function:*` 역방향 호출 파일:줄번호 색인.
2. **`structure.json` (자동화 파이프라인용 압축 그래프 JSON)**
   - `dev-tools/ai-workflow` 계획·검토 도구가 참조하는 단일 라인 JSON 그래프.

## AI 최소 토큰 탐색 순서

1. `Read`로 `dev-tools/structure-map/generated/ai-index.md`의 `offset: 1, limit: 85`만 읽는다.
2. 화면/URL 관련 작업이면 `Section 1. Routes`에서 진입 파일을 바로 확인하고, 도메인 작업이면 `Section 0`의 도메인 줄 번호 범위(`L시작-L끝`)만 `Read`한다.
3. 목차에 적힌 `파일경로 (총줄수)`와 `exp: 함수명:줄번호`를 보고 대상 소스 파일의 필요한 줄 구간(`offset`, `limit`)만 바로 읽는다.

## 갱신 및 검증 명령

- `npm run dev` 실행 시 백그라운드 감시 프로세스가 2초 간격으로 코드 변경을 감지해 `ai-index.md`와 `structure.json`을 자동 갱신한다.
- 수동 갱신: `npm run structure:map`
- 분석기 테스트: `npm run verify:structure-map`
