# 본사 관리 대상과 물류 운영관리

## 현재 단계

로컬 코드와 `20261105080213_workforce_management_and_logistics_operations.sql`을 준비했다.
공유 운영 DB 적용과 main 배포는 아직 하지 않았다. 저장 RPC가 없는 서버에서는
기본 부서 구분과 적용 대기를 표시하며 새 설정·물류 기록 저장을 허용하지 않는다.

## 관리 범위

| 분류 | 직원 명부 | 본사 출퇴근·연차 | 업무 계정 |
| --- | --- | --- | --- |
| 본사 관리 | 유지 | 기존 흐름 | 기존 권한 유지 |
| 물류 별도 관리 | 인사·급여 명부 유지 | 제외 | 기존 권한 유지 |
| 외부 협력사 | 본사 직원 명부에서 제외 | 제외 | 기존 권한 유지 |

기본값은 부서 UUID를 사용한다. 물류팀은 `c5d4cfca-97ce-4ca7-b30a-6beed842cf1e`,
중국팀은 `bf926822-910c-422f-9c17-5fd3d8ddb3ba`이며 이름으로 권한을 추정하지 않는다.
운영지원 → 조직도 → 드롭다운 설정 옆의 **본사 관리 대상**에서 개인별 예외를 설정한다.
설정 저장은 기존 `org.manage`와 `app.can_edit_org_assignment()`만 사용한다.
직원 계정·소속·기존 permission_grants를 변경하지 않는다.

본사 관리로 복귀할 때 오늘 이후의 근태 시작일을 지정한다. 근태 집계는
사이트 도입일(2026-11-02), 입사일, 지정한 근태 시작일 중 가장 늦은 날부터 한다.
조회 실패 시 근태를 임의로 결근 처리하지 않는다.

## 물류 운영관리

- 경로: `/logistics/operations`, 물류 메뉴 아래.
- 사용자 지정에 따라 김보영 계정 `7f159ac7-9e05-41a4-8891-f9929d3af806`만 표시·조회·입력한다.
  같은 회사의 활성 계정을 매번 서버에서 확인한다. 개발자·회사 관리자 예외도 적용하지 않는다.
- 근무는 시작·종료 날짜/시각(한국 시간), 실제 휴게 분, 메모를 수기로 입력한다.
  날짜를 넘기거나 24시간을 초과하는 기록을 지원한다. 본사 점심시간을 자동 적용하지 않는다.
- 휴가는 기간, 종류(연차·반차·반반차·공가·기타), 사용 일수(0.25일 단위), 메모를 입력한다.
- 월 목록·합계는 시작일 기준이다. 휴가 잔액·급여·가산수당을 계산하거나 본사 원장에 차감하지 않는다.
- 같은 직원의 중복 근무 구간·겹치는 휴가를 차단한다. 부분 휴가와 근무 기록은 함께 입력할 수 있다.
- 수정 버전을 검사한다. 같은 내용 재시도는 중복 기록·이력을 만들지 않는다.
- 취소는 취소 시각과 변경 이력을 추가하며 원본 행을 지우지 않는다.
- 신규 수기 입력은 김보영 본인이 확인하므로 별도 신청·승인·수신자 알림을 만들지 않는다.

## 저장·접근·동기화

- `workforce_management_overrides`: 개인별 분류·근태 시작일·수정 버전.
- `app.workforce_management_events`: 분류 변경 전후와 변경자 기록(앱에 직접 노출하지 않음).
- `logistics_operation_records` / `logistics_operation_events`: 별도 수기 기록과 변경 이력.
- 모든 새 공개 테이블에 RLS를 적용한다. 수기 기록·이력은 김보영만 읽는다.
  직접 INSERT/UPDATE/DELETE를 허용하지 않으며 원자적 저장 RPC만 사용한다.
- 분류 조회는 같은 회사의 활성 사용자에게 직원 ID·분류·시작일·버전만 반환한다.
  급여·개인 서류·메모를 분류 API에 싣지 않는다.
- 같은 브라우저는 저장 후 공통 캐시를 갱신한다. 분류 변경은 앱의 단일 구독,
  물류 기록은 해당 화면 구독을 사용하고 30초 조회로 보완한다. 계정별 쿼리 키와
  실제 세션 ID 일치를 검사하며 계정 전환 때 이전 물류 화면을 유지하지 않는다.
- 원본 출퇴근·휴가·잔액·알림 읽음·권한 표는 백필·삭제·수정하지 않는다.

기존 연차 갱신·생일 휴가·연차 발송·출퇴근 확인 작업에는 관리 분류 조건만 추가한다.
각 함수의 원래 본문·설정·ACL을 보존하며, 적용 시 원래 삽입 지점이 바뀌었으면 중단한다.
기존 공개 API는 제거하지 않는다. 새 본사 알림 조회는 기존 호출자 권한으로 원본 알림을
읽고 관리 대상만 좁힌다. 원문·읽음·직원 확인 이력은 변경하지 않는다.

## 검증

```sh
npm run verify:workforce-management
npm run verify:my-home-notifications
npm run verify:company-capabilities
npm run verify:release-access
npm run verify:workflow-diagnostics
npm run verify:supabase-request-policy
node --experimental-strip-types src/features/operations-support/monthly-attendance.verify.ts
node scripts/verify-department-schedule-browser.mjs
node scripts/verify-holiday-work-browser.mjs
node scripts/verify-leave-balance-panel-browser.mjs
npm run build
npm run lint
npm run structure:map
npm run verify:structure-map
```

격리 PGlite DB에서 관리자·본사·물류·협력사·타사·미승인·익명의 실제 PostgreSQL 역할을
사용한다. 기존 데이터·정책·권한·작업 함수 ACL 보존, 겹침·재시도·동시 수정·취소 이력,
본사 관리 전환일, 근태/연차 작업의 제외 조건과 기존 알림 읽음 보존을 비교한다.
브라우저는 API를 가상 구현한 실제 화면 컴포넌트로 등록·수정·취소·실패/재시도·계정 전환과
메뉴/직접 주소 차단을 검증한다. 실제 직원 기록을 시험 입력하지 않는다.

위 검증은 Node 22에서 통과했다. 관리 대상 조회 실패 시 본사 출퇴근·신청을 노출하지 않고,
다시 조회한 뒤 복구하는 흐름과 My Schedule의 물류·중국팀 근태 입력 제외도 확인했다.
lint는 오류 없이 통과했으며 기존 경고와 공통 Context의 Fast Refresh 관련 경고는 남아 있다.

## 공유 운영 DB 적용

별도 승인 후 함수·정책·데이터의 적용 전 지문과 비교 자료를 로컬에 남기고 추가 마이그레이션만
적용한다. 기존 클라이언트의 API·권한을 유지한다. main 공개는 별도 승인 범위이며,
DB 미적용·화면 미배포를 실제 사용 가능 또는 완료로 보고하지 않는다.
