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
   - 코드 구조를 프로그램에서 읽을 수 있는 단일 라인 JSON 그래프.
3. **`data-index.md` (데이터 연결 검색)**
   - 업무 용어, DB 테이블과 열, RPC, Storage, Edge Function, 외부 연결, 브라우저 저장소의 코드 위치를 검색한다.
   - [업무 데이터 기록](../../docs/architecture/data-flows.json)의 기준, 수정, 반영, 별도 저장값과 이유를 같이 표시한다. 자동 목록에는 마이그레이션의 과거 정의도 들어가므로 실제 소스와 적용 이력을 대조한다.

## AI 최소 토큰 탐색 순서

1. `Read`로 `dev-tools/structure-map/generated/ai-index.md`의 `offset: 1, limit: 85`만 읽는다.
2. 화면/URL 관련 작업이면 `Section 1. Routes`에서 진입 파일을 바로 확인하고, 도메인 작업이면 `Section 0`의 도메인 줄 번호 범위(`L시작-L끝`)만 `Read`한다.
3. 데이터 변경이면 `data-index.md`에서 업무 용어나 자원 키를 검색한다. 화면 변경이면 코드 목차의 `파일경로 (총줄수)`와 `exp: 함수명:줄번호`를 찾는다. 해당 소스의 필요한 줄 구간을 읽는다.

## 갱신 및 검증 명령

- `npm run dev`의 감시 프로세스가 코드·마이그레이션·업무 기록 변경을 감지해 세 생성 파일을 갱신한다.
- `npm run structure:map`으로 바로 갱신한다.
- `npm run verify:structure-map`은 분석기 테스트와 데이터 연결 검증을 실행한다.
- `npm run verify:data-map`은 현재 작업 트리를 `HEAD`와 비교해 저장소 코드·DB 마이그레이션·Apps Script의 데이터 연결 변경과 관련 업무 기록을 검사한다. 커밋한 변경을 검사하려면 `npm run verify:data-map -- --base <변경 전 커밋 또는 브랜치>`를 사용한다. 상세 기준은 [데이터 연결 기록](../../docs/architecture/AI_WORK_REFERENCE.md#데이터-연결-기록)을 따른다.
