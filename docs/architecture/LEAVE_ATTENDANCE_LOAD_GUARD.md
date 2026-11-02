# 연차 조회·근태 잠금 부하 보완

2026-11-02 / `261102-3`. **로컬 검증 완료, 공유 DB 적용 승인 대기.** test·main 배포 없음.

## 화면

- 조직도와 연차 현황은 사용자별 명부·추가 연차 조회 한 건을 공유한다. 추가 연차 계산 후 명부 값을 읽는다.
- 연차 조회는 활성 작업 탭에서만 5분 간격으로 갱신한다. 오류가 나면 자동 반복·재시도를 멈추고 수동 재조회를 제공한다.
- 저장·취소·잔여 수정은 즉시 관련 조회를 갱신한다. 숨겨진 탭은 무효화만 하고 다시 열 때 조회한다. 다른 기기의 변경·날짜 경계는 정상 연결에서 5분 이내 후속 조회로 반영한다.
- 새로고침은 잔여와 선사용 내역을 함께 갱신한다. 계정 전환 시 다른 계정의 캐시를 사용하지 않는다.

## DB 적용 대기 범위

- `20261102101948_attendance_lock_contention_guard.sql`: `app.advance_attendance_presence`, `app.my_attendance_presence`, `app.offsite_attendance_state`, `app.process_attendance_presence`, `app.clock_out_today`, `app.undo_clock_out_today`, `app.confirm_previous_clock_out`의 7개 정의와 `app.clock_in_today` 잠금 대기 설정.
- 직원 잠금 → 출퇴근 행 → 확인 상태 순서를 유지한다. 사용자 요청은 잠금 대기 2초 후 실패하고 부분 저장하지 않는다. 자동 처리는 직원 잠금을 즉시 얻지 못하거나 행 잠금 100ms를 넘으면 그 직원만 롤백·보류하고 다음 분에 다시 처리하며 경고를 남긴다.
- `20261102102010_leave_refresh_load_guard.sql`: `app.fefo_budget`의 동일값 쓰기 생략, `app.leave_advance_summary`의 기간 계산 재사용·다음 발생일 후보 축소. 날짜 캐시나 새 데이터 표는 추가하지 않는다.
- 기존 업무 행·테이블·정책·함수 서명·권한·cron 주기는 변경하지 않는다. 잠금 대기 제한은 전체 계산시간 제한이 아니며, 서버 적용 후 요청 시간·잠금 대기 추이를 별도로 확인해야 한다.
- 적용 직전 서버 정의를 다시 대조한다. 복구는 보관한 기존 함수 정의와 설정을 복원하며 업무 데이터를 되돌리지 않는다. 서버 원본 10개 정의·ACL은 로컬 `docs/backups/leave-attendance-load-before-20261102.json`에 보관(커밋 제외).

## 검증

- Node 22 빌드, diagnostics, lint(기존 경고), 구조도 생성·분석기 검증.
- `npm run verify:leave-balance-browser`: 외부 API를 차단한 브라우저에서 중복 조회 제거, 30초 무호출·5분 갱신, 숨김/실패 중지, 수동 복구, 계정 전환, 저장·취소·모바일 회귀.
- `npm run verify:leave-load`: 기존 기본·추가·생일·선사용 회귀, 250개 날짜 조합의 기존 요약과 전체 JSON 일치, 동일값 반복 UPDATE 0회, 데이터·ACL·RLS 보존.
- `npm run verify:attendance-locks`: 합성 DB에서 직원별 롤백·후속 처리·기존 데이터/권한/cron 보존. 기존 presence/offsite/attendance-entry DB 검증도 통과.
- `npm run verify:attendance-lock-concurrency`: 운영 DB에 연결하지 않는 임시 로컬 PostgreSQL(이 PC는 18.3) 두 연결의 실제 잠금 경합 검증. 운영 DB는 PostgreSQL 17이며 17에 지원되는 잠금 기능만 사용한다.
