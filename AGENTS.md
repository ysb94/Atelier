# Atelier AI 작업 지침

## 도메인 핵심 사실

제안·설계·분석 전에 아래를 전제로 둔다. 반대로 가정하면 결론이 통째로 틀린다.

- **M번호는 SKU 단위다.** `styles.style_no`(UI의 「M번호」)는 색상·사이즈까지
  구분해 부여한다. 같은 상품이라도 색상이나 사이즈가 다르면 M번호가 다르다.
  "상품 하나를 확정하면 색상·사이즈 조합이 한꺼번에 해결된다"는 가정은 틀렸다.
  조회 키 하나가 해결하는 것은 그 키와 같은 주문 행들뿐이다.
- **품목명 오류와 내품명 오류의 경중을 나누지 않는다.** 어느 쪽이든 잘못 나가면
  고객 CS·교환·재출고·시간 비용이 발생하고, 상품 단가가 100원이어도 마찬가지다.
  내품명이 덜 중요하다는 이유로 검수 강도나 자동 확정 기준을 낮추지 않는다.

## 성능·진단 지침 (콘솔에 드러나게 만든다)

"화면이 멈추는데 콘솔에는 아무것도 없다"를 다시 만들지 않는다. 오류 없이 도는 렌더
루프·무거운 재계산은 브라우저가 알려주지 않으므로 우리가 직접 콘솔에 남긴다.

진단 인프라는 `src/lib/diagnostics/` 에 있고 `App.tsx` 에서 한 번 설치한다.

- 스위치: 개발 모드는 항상 켜짐. 배포 사이트는 콘솔에서 `atelierDebug.on()` 실행 뒤
  새로고침(`localStorage['atelier:debug']`). 끄기는 `atelierDebug.off()`.
- 접두어로 필터한다. `[perf]` 긴 작업·프레임 정지·느린 쿼리, `[render-storm]`
  1초에 25회 이상 렌더, `[query-storm]` 같은 쿼리 반복 조회·실패, `[app-error]`
  잡히지 않은 오류, `[invoice-work]` 송장작업 단계별 소요 시간.
- 모든 진단 로그에는 현재 경로와 마지막 사용자 입력(무엇을 눌렀는지)이 붙는다.
  렉 보고를 받으면 먼저 이 로그부터 보고, 없으면 `atelierDebug.on()` 을 안내한다.

새 코드를 쓸 때 지켜야 할 규칙:

- 페이지 단위 컴포넌트나 1,000행 이상 처리하는 패널을 만들면 최상단에
  `useRenderWatch('컴포넌트명')` 한 줄을 넣는다.
- 200ms 를 넘을 수 있는 동기 계산(원장 매칭, 파일 파싱, 대량 정렬)은
  `timeInvoiceWork(이름, fn)` 처럼 이름 붙여 계측한다. 새 도메인이면 같은 형태의
  타이머를 만들고 접두어를 정한다. 200ms 이상은 `info`, 1초 이상은 `warn` 으로 올려
  기본 콘솔 필터에서도 보이게 한다. `console.debug` 만으로는 Chrome 기본 설정에서
  보이지 않는다.
- 조용히 삼키는 `catch {}` 를 두지 않는다. 사용자에게 보여주지 않는 오류라도
  `console.warn('[영역] 무엇이 실패', { 맥락 })` 을 남긴다. localStorage 접근처럼
  무시해도 되는 경우만 주석으로 이유를 적고 넘어간다.
- 렌더 루프의 전형을 피한다.
  - `query.data ?? []` 는 매 렌더 새 배열이다. `emptyList()`(`@/lib/utils`) 를 쓰거나
    `useMemo` 로 감싼다. 이 배열이 `useEffect` 의존성으로 들어가고 그 안에서 `setState`
    하면 오류 없이 무한 루프가 된다.
  - `useQueries` 의 기본 반환 배열도 매 렌더 새 참조다. 반드시
    `combine: combineListQueries<T>`(`@/lib/query/list-queries`) 로 받아 구조 공유되는
    객체를 쓴다. 이 배열이 `useMemo` 체인을 타고 react-table `data` 로 들어가면 자동
    페이지 초기화와 맞물려 숨겨진 탭에서 초당 20회씩 영원히 렌더된다(실제로 있었던 버그).
  - Context `value` 는 `useMemo` 로 고정한다. 참조가 바뀌면 KeepAlive 로 숨겨진 탭까지
    전부 다시 렌더된다.
  - `useEffect` 안에서 `setSearchParams`·`navigate` 를 호출하면
    `useWorkspaceTabActivity()` 가 true 인 탭에서만 실행한다. 숨겨진 탭이 주소를 고치면
    사용자가 보던 탭이 바뀐다.
  - TanStack Query 는 전역으로 `refetchOnWindowFocus: false` 다. 다른 창을 오갈 때
    열린 탭 전체가 재조회되며 원장 재매칭이 연쇄되는 것을 막기 위한 결정이므로 개별
    쿼리에서 다시 켜지 않는다. 최신화가 필요하면 저장 뒤 `invalidateQueries` 로 한다.
- `npm run lint` 의 `react-hooks(exhaustive-deps)` 경고 중 "changes every render" 는
  성능 버그로 취급하고 새로 만들지 않는다.
- 검증: `npm run verify:diagnostics` 가 임계값·보고 규칙을 확인한다.

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
