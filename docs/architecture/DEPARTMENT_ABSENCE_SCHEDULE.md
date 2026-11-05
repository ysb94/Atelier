# My Schedule 같은 부서 일정

## 범위와 표시

My home → My Schedule의 기존 달력에 `같은 부서 일정` 표시를 추가한다. 기본은 켜짐이다. 날짜 칸에는 동료 일정 두 건과 초과 건수를 표시하고, 날짜를 선택하면 아래에 그날의 전체 동료 목록을 펼친다. 기존 개인 출퇴근·신청·회의·To-do 표시와 본인 신청 상세/취소 경로는 유지한다.

- 현재 로그인한 활성 직원의 같은 회사·현재 부서에 속한 활성 동료만 조회한다. 본인은 기존 개인 일정으로 표시한다.
- 확정(`approved`)된 연차·반차·반반차·외근·공가만 공유한다. 대기·반려·취소, 야근·정정·재택은 제외한다.
- 공유 값은 이름·종류·날짜·시각뿐이다. 사유·외근 장소·첨부·승인 의견·급여·개인정보를 조회하거나 표시하지 않는다.
- 연차·공가는 종일, 반차·반반차·외근은 등록된 시간으로 표시한다. 연속/밤샘 외근은 각 날짜에 겹치는 시간만 표시하고, 자정 종료는 다음 날을 점유하지 않는다.
- 부서 배치가 없는 계정은 안내를 표시하고 조회하지 않는다. 부서 변경은 현재 프로필 기준이며 과거 신청의 부서 스냅샷으로 동료를 판단하지 않는다.
- 동료 일정은 읽기 전용이다. 상세 신청·첨부·승인·취소 버튼을 제공하지 않으며 업무 알림 읽음도 기록하지 않는다.

## 코드와 조회

- `src/features/settings/department-schedule.ts`: 월 범위, 날짜별 시간 투영, 검색·정렬·중복 제거. 저장 기간이 길어도 표시 월의 최대 31일만 계산한다.
- `src/lib/supabase/department-schedule.ts`: 최소 조회 RPC 어댑터. 결과 열을 명시적으로 매핑하고 500행 단위로 페이지를 조회한다. 원본 신청 표를 직접 조회하는 fallback은 두지 않는다.
- `src/features/settings/DepartmentSchedule.tsx`: 부서 표시 선택, 날짜 칩·목록과 조회 훅.
- `src/features/settings/MyAttendancePanel.tsx`: 기존 달력에 연결.
- `src/features/settings/personal-requests.css`: 기존 달력 스타일과 공용 색 토큰을 이용한 동료 일정 표시.

조회 키는 `company-leave-requests / 로그인 UUID / department-schedule / 회사 UUID / 부서 UUID / 월`이다. 기존 신청 저장의 공통 무효화 경로를 사용한다. 본문이 활성 상태이고 표시가 켜져 있을 때만 조회하며, 같은 화면의 중복 소비자는 캐시를 공유한다. 정상 시 30초 간격, 오류 시 최소 60초 후 조회하며 포커스 재조회는 켜지 않는다. 수동 새로고침을 제공한다.

계정·회사·부서·월 변경에는 이전 키의 결과를 placeholder로 넘기지 않는다. 세션과 프로필이 일치하지 않거나 권한/조회 오류가 있으면 기존 동료 결과를 숨긴다. 서버 함수 미적용은 별도 준비 중 안내로 표시하고 자동 반복 조회를 중단한다. 실패를 ‘빈 일정’으로 확정하지 않는다.

업무 단계 진단은 `leave / department_schedule / db_request`를 사용한다. 공통 진단 클라이언트와 서버 오류 코드를 유지하며 이름·직원 UUID·사유 같은 원본 정보를 새 진단에 넣지 않는다.

## DB 적용 경계

로컬 준비 SQL: `supabase/migrations/20261105054259_department_absence_schedule.sql`.

1. 비노출 app 스키마의 `app.my_department_absences(date,date)` — 서버의 로그인 UUID에서 회사·부서를 직접 확인하고 최대 62일의 최소 일정만 반환하는 읽기 전용 함수.
2. 공개 `list_my_department_absences(date,date)` — security invoker 래퍼. 두 함수 모두 PUBLIC/anon 실행을 회수하고 authenticated에만 실행을 허용한다.

기존 신청 표의 전체 상세 RLS를 넓히지 않고 제한된 projection으로 공유 범위를 구현한다. 기존 데이터·표·정책·승인자·상태·쓰기 권한은 변경하지 않는다. 프런트에서 직원/회사/부서 UUID를 인수로 받아 신뢰하지 않는다.

사용자의 구체적 승인 후 공유 DB에 **`20261105060910_department_absence_schedule`**을 적용했다. 적용 전 서버 구조·기존 함수 부재와 app 스키마 접근 권한을 대조했다. 두 함수와 실행 권한만 추가했으며 test/main 사이트 배포는 하지 않았다. 로컬에서 기존 My Schedule을 새로고침하면 실제 부서 일정을 조회한다.

실제 직원 38개의 인증 역할로 2026년 11월의 반환값을 서버 원본에서 계산한 최소 projection과 비교해 모두 일치했다. 미승인 직원·인증 UUID 없는 역할·anon의 3개 접근을 차단했고, 활성 계정별 과도한 조회 기간 거절도 검증했다. 해당 측정에서 가장 느린 함수 조회는 2.723ms였다(HTTP/화면 시간 제외). REST에서도 새 API가 준비됐으며 비로그인 요청은 HTTP 401 / SQLSTATE 42501로 거절됐다.

기존 직원·부서·명부·신청·승인자·지정 권한·출퇴근·야근 수동 기록·외근 후처리의 9개 표 원본 해시가 모두 동일하다. 해당 표의 RLS·권한과 기존 연차/출퇴근/승인 함수 정의·권한도 동일하다. 보안 진단은 기존 98개 항목을 유지하며 새 항목은 없다. 검증은 읽기 전용 트랜잭션에서 수행해 직원 상태나 테스트 기록을 추가하지 않았다. 적용 전 지문과 검증 결과는 Git 제외 대상인 `docs/backups/department-absence-*-20261105.json`에 보관한다.

## 검증

Node는 `.nvmrc`의 22를 사용한다.

```text
node scripts/verify-department-schedule.mjs
node scripts/verify-department-schedule-db.mjs
node scripts/verify-department-schedule-browser.mjs
npm run verify:hidden-schedule
npm run verify:workflow-diagnostics
npm run build
npm run structure:map
npm run verify:structure-map
```

- 순수 계산/실제 API 어댑터: 종일·시간제·매일/연속/밤샘 외근·자정 경계·월 경계·장기간 계산 제한·검색·중복 제거·페이지 처리·응답 필드 제한·미적용/실패 구분.
- 격리 PostgreSQL: 확정 다섯 종류, 본인/동료/타부서/타사/미승인/미배치/익명, 현재 부서 변경, 기간 제한, 원본 상세/쓰기 차단, 기존 자료·RLS·표 권한 보존. 실제 직원 자료는 시험 변경하지 않는다.
- 실제 My Schedule 컴포넌트의 격리 브라우저: PC/모바일, 날짜 선택·초과 목록·검색·표시 끄기·월 이동·기존 개인 상세·계정 변경 격리·숨겨진 탭 조회 중단·조회 실패/서버 미적용. 외부 네트워크와 저장을 차단한다.
