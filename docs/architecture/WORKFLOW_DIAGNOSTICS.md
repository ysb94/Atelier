# 업무 단계와 DB 연결 진단

공통 클라이언트는 기존 인증·요청 제한·재시도 정책을 유지하면서 요청을 관찰한다.
외근·연차·회의·알림에는 화면 검사부터 DB 저장과 화면 갱신까지 명시적인 추적 문맥을 전달한다.
DB 스키마·RLS·권한·업무 원본을 변경하거나 진단 자료를 서버로 전송하지 않는다.

## 콘솔과 증거 확인

- `[workflow]`: 업무 종류·동작·진행 단계·실패 분류·추적 번호.
- `[db-request]`: RPC/테이블/Storage/함수 종류, 대상 이름, HTTP 상태, SQLSTATE,
  서버 요청 번호(응답 헤더에서 제공되는 경우), 전송/본문 수신 지연.
- 운영에서도 실패·검사 중단·3초 이상 대기를 기록한다. 정상 단계는 메모리에만 남기며,
  `atelierDebug.on()`을 실행하면 콘솔에서도 볼 수 있다. 기존 성능 감시는 새로고침 후 켜진다.
- `atelierDebug.report()`는 최근 240개 이벤트, 별도로 보존한 최근 40개 실패/검사 중단,
  배포 커밋·빌드 시각을 복사본으로 반환한다. 정상 주기 조회가 실패 기록을 모두 밀어내지 않는다.
  Chrome 콘솔의 `copy(JSON.stringify(atelierDebug.report(), null, 2))`로 복사할 수 있다.
- `atelierDebug.clear()`는 현재 브라우저 탭의 진단 기록만 비운다. 업무 자료나 읽음 상태를 바꾸지 않는다.
- 새로고침/탭 종료 시 메모리 기록은 사라진다. 오류 직후 복사한다. 과거 직원 브라우저의
  오류를 원격에서 조회하거나 서버에 자동 보관하는 기능은 포함하지 않는다.
- 같은 종류의 콘솔 기록은 10초에 최대 3번 출력한다. 메모리에는 최신 사건이 계속 남는다.

## 단계 해석

| 업무 | 주요 단계 |
| --- | --- |
| 외근·연차 신청 | 입력 정규화 → 근무 기준 조회 → 충돌 검사 → 서버 기능 확인 → DB 저장 → 관련 조회 갱신 |
| 단체 외근 | 참여자/서버 준비 검사 → 일괄 등록 → 관련 조회 갱신 |
| 본인 출근 기준 변경 | 기준 변경 저장 → 관련 조회 갱신 |
| 외근 복귀 | 복귀 RPC → 서버 상태 수신 → 출퇴근/외근 조회 갱신 |
| 승인·반려·취소 | DB 상태 변경 → 영향받는 조회 갱신. 변경 행이 없으면 `no_changed_row` |
| 회의 | 저장 대기열 → 버전 검사 → 스키마 준비 확인 → 저장/확정/응답 → 관련 조회 갱신 |
| 알림 | 현재 표시된 이벤트 버전 대조 → 읽음 저장 → 관련 조회 갱신 |
| 실시간 연결 | 구독 상태 수신 → 연결 실패 분류, 기존 주기 조회 유지 |

`traceId`가 같은 사건을 연결한다. 동시 요청의 문맥은 개별 객체/함수 인자로 전달하며
전역의 "현재 작업" 변수를 사용하지 않는다. 실제 SDK 요청에는 기존 허용 헤더인
`x-client-info`로 진단 문맥만 전달한다. 인증 헤더와 요청 본문은 바꾸지 않는다.

`pending`은 진행 중 경고이고 실패/취소를 뜻하지 않는다. `response_headers_pending`은
응답 헤더 대기, `response_body_pending`은 헤더 수신 후 본문 대기다. 본문 수신을 마쳐야
전송 완료로 기록한다. HTTP 성공은 전송 성공이며 업무 성공은 업무 단계의 완료로 확인한다.

DB 저장 후 갱신에서 실패하면 갱신 단계에 `writeOutcome: committed`를 남긴다.
전송이 끊긴 쓰기 요청은 결과를 확정할 수 없으므로 `unknown`이다.
진단 코드는 요청을 재전송하거나 새 시간 제한을 걸지 않는다. 불명확한 쓰기 결과는
현재 업무 기록을 확인한 후 처리한다.

검사 중단은 DB 오류와 구분한다. 예를 들어 `validate_conflicts`의 `blocked`에
`missingCount > 0`이 있으면 근무 기준 누락 여부부터 확인한다.
`groups_access/query_gate`에는 미리보기·계정 전환·계정 불일치·비활성·숨겨진 탭으로
조회가 꺼진 이유가 남으므로, 실제 통신 대기와 구분할 수 있다.

## DB 오류 분류와 한계

- `42501`/HTTP 403: 권한. HTTP 401: 인증·세션.
- `PGRST202/204/205`, `42883/42P01/42703`: 함수·열·테이블/스키마 연결 확인.
- `23505/23503`: 중복/참조 기록. `P0001`: 업무 규칙, 알려진 일정 충돌·잔여 연차는 별도 분류.
- `40001/40P01/55P03`: 동시 변경/교착/잠금. `57014`: DB 시간 제한.
- `53300/53400`: DB 연결·자원 부족. HTTP 429: 요청 한도. HTTP 5xx: 서버 오류.
- `PGRST000/001/002`, `08xxx`, `57P01/02/03`: API 서버에서 DB 연결 실패.
- `PGRST003`: DB 연결 풀을 기다리다 시간 초과. 일반 네트워크/응답 지연과 구분한다.
- 브라우저 연결 실패/취소/응답 시간 초과를 구분한다.

DB 내부 SQL의 세부 진행과 사이트가 닫힌 동안 실행된 Cron의 단계는 브라우저에서 직접
관찰할 수 없다. 외근 상태 동기화로 확인된 결과와 RPC 경계까지 기록한다. DB 내부 원인은
SQLSTATE·RPC 이름·발생 시각·서버 요청 번호로 Supabase의 해당 로그를 대조한다.
서버 요청 번호는 CORS/서비스에 따라 응답에 노출되지 않을 수 있다.

## 기록 금지 항목

새 진단에는 직원 이름/UUID/이메일, 날짜별 신청 본문, 장소, 메모, 승인 의견, 검색어,
쿼리 필터, 전체 URL, 파일명/Storage 경로, API 키/토큰/인증 헤더, 성공 응답 행을 넣지 않는다.
마지막 조작은 이벤트와 요소 종류만 기록한다. 동적 URL 구간은 `:id`, 검색/해시는 제거한다.
DB 오류의 원문 message/details/hint도 복사하지 않고 오류 코드·알려진 원인 분류·존재 여부만 남긴다.
JSON 오류 응답만 최대 8KB/1초 범위에서 보조 분석한다. 성공 응답/파일/토큰을 분석용으로 복제하지 않는다.

## 새 기능 연결

공통 `getSupabase()`를 쓰는 API는 전송 진단이 자동 적용된다. 업무별 실패 단계는 아래처럼 추가한다.

```ts
const trace = startWorkflow('leave', 'submit')
try {
  trace.step('validate_input')
  if (!valid) { trace.block('invalid_input'); return }
  await trace.run('save', context => diagnosticQuery(
    'leave', 'insert', getSupabase().from('company_leave_requests').insert(payload), context,
  ))
  await trace.run('refresh_queries', refresh, { writeOutcome: 'committed' })
  trace.done({ writeOutcome: 'committed' })
} catch (error) { trace.fail(error); /* 기존 화면 오류 처리 */ }
```

동작·단계·사유는 코드에 고정한 영문 식별자를 사용하고 사용자 입력을 이름으로 넣지 않는다.
부가 정보는 허용된 횟수/상태/여부만 기록한다. TanStack Mutation을 통과하는 문맥은
`tracedInput(input, context)`와 `inputDiagnosticContext(input)`의 WeakMap으로 연결한다.
입력 객체에 진단 필드를 추가하지 않는다. 외부에 새 RPC/실시간 채널을 만들 때도 같은 문맥과
`diagnosticRealtime`을 사용하고, 원본 권한과 읽음/처리 완료 조건은 별도로 보존한다.

## 검증

`npm run verify:workflow-diagnostics`는 실제 SDK와 격리된 브라우저/로컬 HTTP fixture로
단계 연결, SQLSTATE, 검사에서 DB 전송 차단, 헤더/본문 지연, 연결 실패, 취소, 스트리밍 보존,
쓰기 재시도 없음, 개인정보 제외, 동시 문맥 분리, 메모리/콘솔 제한과 보고서 복사를 검증한다.
공유 DB나 실제 직원 정보를 사용하지 않는다. 기존 `verify:diagnostics`와 업무 회귀 검증도 실행한다.

공식 API 근거: [클라이언트의 custom fetch](https://supabase.com/docs/reference/javascript/initializing),
[반환되는 DB 오류](https://supabase.com/docs/guides/api/handling-errors-in-supabase-js),
[SDK 재시도 정책](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js),
[PostgREST 오류 코드](https://docs.postgrest.org/en/stable/references/errors.html).

2026-11-04 Node 22 검증: workflow-diagnostics, diagnostics, overnight-annual, offsite-groups,
offsite-workday-start, my-home-notifications, desktop-notifications, meetings-db와 회차 역할 브라우저
검증을 통과했다. 기존 요청 제한 정책의 HTTP/본문 취소·인증 세션 보존 검증도 통과했다.
구조 목차를 갱신하고 분석기 9개 검증을 통과했다. lint는 기존 경고가 있으며 오류는 없다.
공유 DB 변경·직원 자료 생성 없이 로컬/격리 fixture로 검증했다.
