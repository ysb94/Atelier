# Atelier 작업별 참고 지침

공통 작업 규칙은 [AGENTS.md](../../AGENTS.md)를 따른다. 아래에서 작업에 해당하는 항목을 읽는다.

## 코드 탐색

- `dev-tools/structure-map/generated/ai-index.md`의 처음 85줄에서 URL 라우트와 도메인별 줄 범위(`Section 0`)를 찾는다. 해당 도메인 구간에서 파일·export 심볼·DB 연결을 좁힌 뒤 실제 소스의 필요한 범위를 읽는다.
- 자동화는 압축된 `dev-tools/structure-map/generated/structure.json` 또는 `source-reader`의 `structure_evidence`를 사용한다. `structure.json` 전체를 출력하지 않는다.
- `npm run dev`의 자동 감시 또는 `npm run structure:map`으로 목차를 갱신한다. 분석기 자체 검증은 `npm run verify:structure-map`을 사용한다.
- 파일과 연결은 자동 분석한다. 분류와 용어 해석은 `domains.json`과 `labels.mjs`의 공통 규칙으로 고친다. 생성된 목차는 개발 전용으로 운영 화면·라우트·번들에 포함하지 않는다.

## 화면 디자인

기획안 화면을 기준으로 기존 공용 부품을 사용한다.

- 포인트 색은 `primary`(`src/index.css`)를 사용한다. 별도 색은 `success`·`warning`·`danger` 등 의미 있는 상태에 사용한다. 화면에 장식용 색이나 고정 색상값을 추가하지 않는다.
- 페이지 제목에는 `PageHeader`를 쓰고, 위 섹션 이름은 `company-workspace-nav.ts`의 메뉴 구성에서 가져온다.
- 표는 `Card`로 감싸고 헤더에 `bg-primary text-primary-foreground`를 사용한다. 행 호버·숫자 정렬은 `index.css` 기본값을 따른다.
- 검색·선택 상자는 `FilterBar`, 상태별 건수 탭은 `FilterTabs`, 요약 숫자는 `StatTile`·`StatGrid`를 사용한다.
- 목록 상태는 `StatusPill`, 진행률은 `SegmentProgress`, 짧은 꼬리표는 `Badge`를 사용한다.
- 입력·선택·여러 줄 입력·버튼은 `src/components/ui`의 `Input`·`Select`·`Textarea`·`Button`을 사용한다. 선택 상자 화살표는 공용 CSS를 따른다.
- 카드는 `Card` 또는 `rounded-xl border border-border bg-card shadow-sm`을 사용한다. 자체 색 체계가 필요한 화면(출퇴근 달력, 연출컷 스튜디오 등)의 별도 CSS는 해당 화면으로 한정한다.

## 업무 알림

- 수신자, 발생 조건, 연결 메뉴·탭·상세, 읽음 시점, 처리 완료 조건, 중복 방지 키, 조회·처리 권한을 함께 정의한다. 새 업무 탭도 종합 알림과 공통 연결에 등록한다.
- 종합 알림과 해당 탭은 같은 서버 알림·읽음 기록을 사용한다. 화면별 읽음 복사본이나 `localStorage` 읽음 기록을 만들지 않는다. 상세 내용이 권한 확인 뒤 정상 표시될 때만 읽음을 저장한다. 클릭·탭 진입·목록 조회·숨겨진 탭 렌더만으로 읽음 처리하지 않는다.
- 새 알림은 점, 승인·응답·본인 확인·정정 대기는 고유 업무 단위의 숫자로 표시한다. 읽었어도 실제 처리 전까지 대기를 유지한다. 이벤트 버전으로 이전 상세의 읽음 요청이 새 알림을 지우지 않도록 한다.
- 연차 안내의 읽음·열람·본인 확인은 승인·출퇴근 원본·권한과 별개다. 알림으로 승인 권한을 부여하거나 관리자 열람을 본인 확인으로 기록하지 않는다. 취소·다른 담당자의 선처리·권한 해제는 최신 원본과 맞춘다.
- 양방향 상세 열람, 미처리 유지, 처리 후 동기화, 일정 재변경, 중복, 네트워크 실패, 다른 기기·계정 전환·권한 차단을 검증한다. 과거 완료 건의 소급 알림은 별도 합의한다.

## 성능과 진단

- `src/lib/diagnostics/`의 진단은 `App.tsx`에서 한 번 설치한다. 개발 모드에서는 항상 켜진다. 배포 사이트에서는 콘솔에서 `atelierDebug.on()`을 실행하고 새로고침한다. `atelierDebug.off()`로 끈다.
- `[perf]`는 긴 작업·프레임 정지·느린 쿼리, `[render-storm]`은 1초에 25회 이상 렌더, `[query-storm]`은 반복 조회·실패, `[app-error]`는 잡히지 않은 오류, `[invoice-work]`는 송장 단계별 소요 시간이다. 경로와 마지막 조작을 확인하고 기록이 없으면 진단을 켠다.
- DB와 연결하는 업무 변경은 [업무 단계 진단](WORKFLOW_DIAGNOSTICS.md)을 따른다. `startWorkflow`로 입력 검사·권한/기준 확인·DB 처리·화면 갱신을 나누고 같은 추적 문맥을 전달한다. 공통 `getSupabase()`의 요청 감시, 오류 코드와 서버 요청 번호를 보존한다. 원본 입력·직원 식별값·토큰·DB 오류 원문을 기록하지 않는다. 오류 직후 `atelierDebug.report()`로 증거를 확인한다.
- 페이지 컴포넌트나 1,000행 이상 처리하는 패널 상단에 `useRenderWatch('컴포넌트명')`을 추가한다. 200ms를 넘을 수 있는 동기 계산은 `timeInvoiceWork(이름, fn)`처럼 도메인별 접두어와 타이머로 계측한다. 200ms 이상은 `info`, 1초 이상은 `warn`으로 남긴다.
- 화면에 표시하지 않는 오류도 민감정보 없이 `console.warn('[영역] 무엇이 실패', { 맥락 })`으로 남긴다. 무시해도 되는 오류는 이유를 주석에 적는다.

### 렌더링과 조회

- `query.data ?? []`가 매 렌더마다 새 참조를 만들면 `useEffect`의 `setState`와 맞물려 렌더가 반복될 수 있다. `emptyList()`(`@/lib/utils`) 또는 `useMemo`를 사용한다.
- `useQueries`는 `combine: combineListQueries<T>`(`@/lib/query/list-queries`)로 구조 공유되는 값을 받는다. 새 배열 참조가 `react-table`까지 전파되어 자동 페이지 초기화가 반복되는 것을 막는다.
- Context의 `value`는 `useMemo`로 고정해 KeepAlive에 보관된 탭의 불필요한 렌더를 막는다.
- `useEffect`에서 `setSearchParams`·`navigate`를 실행할 때 `useWorkspaceTabActivity()`로 활성 탭을 확인한다.
- TanStack Query의 전역 `refetchOnWindowFocus: false`를 개별 쿼리에서 켜지 않는다. 저장 후 갱신은 `invalidateQueries`를 사용한다.
- `npm run lint`의 `react-hooks(exhaustive-deps)` 경고 중 `changes every render`는 성능 문제로 다룬다. `npm run verify:diagnostics`로 임계값과 보고 규칙을 검증한다. DB 연동 진단은 `npm run verify:workflow-diagnostics`도 실행한다.
