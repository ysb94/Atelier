# My home 알림·처리 대기

## 적용 상태

2026-11-02 사용자 승인 후 공유 운영 DB에 적용했다. 운영 사이트 화면 배포는 별도 단계다. 이번 적용 결과는 로컬에만 저장하고 추가 커밋·push는 보류했다.
마이그레이션은 `20261102081715_my_home_notification_queue.sql`이다. 기존 알림·인사 원본이나
기존 정책·RPC 서명은 바꾸지 않으며, 과거 승인 결과를 소급 발송하지 않는다.
서버 미적용 시 신청·퇴근 알림에 연결 대기를 표시하고 회의의 버전 검사 읽음 저장은 실패 안내를 표시한다.

## 공통 계약

- `useMyHomeNotifications`가 종합 알림창과 My home의 공통 조회·변환을 제공한다.
  실제 구독과 30초 갱신은 헤더의 coordinator 한 곳에서 실행한다.
- `target`에 원본 종류·항목 ID·이벤트 버전·탭·상세 경로를 넣는다. `action`은 읽음과 별개다.
  같은 `action.key`는 한 업무로 센다. `current=false`는 기록에만 표시한다.
- 알림 클릭은 이동만 한다. 표시 중인 상세 화면이 읽음을 저장하고 공유 쿼리를 갱신한다.
  KeepAlive 비활성 패널과 배경 브라우저 탭은 읽음을 저장하지 않는다.
- 회의는 기존 초대·호스트 알림의 `read_at`을 재사용하며 회차 잠금, 표시 일정 버전,
  원본 발송 시각을 검사한다. 호스트의 응답 현황 확인은 별도 명시 버튼으로 완료한다.
- 연차는 안내문이 실제 표시된 뒤 기존 view API를 호출하며 확인 버튼은 기존 confirm API를 쓴다.
  읽음·열람·본인 확인을 합치지 않는다. 직원 전환·미리보기에서 본인 확인 제한을 유지한다.
- 지각은 사유서 조회가 성공한 상세 화면에서 기존 읽음 API를 호출한다.
- 승인 요청은 기존 `list_my_approval_requests`와 승인자 판정을 재사용한다. 선사용 본인 승인은
  계속 제외한다. 일반 연차·외근의 즉시 등록에는 새 승인 요청을 만들지 않는다.
- 새 승인·반려 결과는 after-update 트리거에서 수신자와 원문 메모를 기록한다. 새 표는 RLS로
  본인 조회만 허용하며 결과 이벤트 직접 쓰기는 허용하지 않는다.
- 퇴근 확인은 유효 출퇴근 기록과 기존 미등록 조건으로 판단한다. 직전 출근일의 누락은
  오늘 출근 후 기존 `confirm_previous_clock_out` API로 확인한다. 더 오래된 자동 종료
  기록은 사유를 입력해 기존 출퇴근 정정 신청으로 제출하고 지정 승인자가 처리한다.
  자동 종료를 실제 퇴근으로 변환하거나 기존 기록을 직접 덮어쓰지 않는다.

## 검증과 운영 반영

Node 버전은 `.nvmrc`를 따른다.

```text
npm run build
npm run verify:my-home-notifications
npx --no-install tsx --tsconfig tsconfig.app.json src/features/settings/checkout-notice.verify.ts
node scripts/verify-checkout-notice-browser.mjs
npm run verify:diagnostics
npm run verify:personal-requests
npm run verify:my-attendance
npm run verify:meetings-db
npm run verify:meetings-browser
node scripts/verify-page-preview-browser.mjs --host-lunch-only
npm run verify:structure-map
```

브라우저 테스트는 `.tmp/my-home-notifications-browser`의 가짜 DB 연결만 사용하고 외부 요청을 차단한다.
DB 테스트는 격리 PGlite에서 실제 추가 마이그레이션을 실행한다. 운영 직원의 알림·확인 기록을 시험 생성하지 않는다.
운영 반영 때는 기존 데이터·정책·권한의 적용 전후 비교와 인증 역할 조회를 별도로 검증한다.
향후 기능의 알림 설계 기준은 AGENTS.md의 「업무 알림과 My home 연결」을 따른다.

## 운영 DB 적용 검증 (2026-11-02)

- 적용 직후 기존 데이터 13개 영역의 건수·해시, 기존 함수 469개·표 권한 177개·보안 정책 378개를 비교해 동일함을 확인했다.
- 재직 계정 33개의 authenticated 역할 조회 범위를 검증했다. 업무 읽음 3건·회의 읽음 17건·호스트 확인 1건은 트랜잭션 롤백으로 검증했다. 실제 직원의 읽음·본인 확인을 대신 남기지 않았다.
- 신규 읽음·결과 표는 검증 후 각 0건이며 소급 결과 발송이 없다. 신규 표의 Realtime 등록과 기존 보안 진단 유지도 확인했다.
- 검증 중 기존 출퇴근 42행 중 수동 퇴근 17:18(KST) 운영 활동이 발생해 해당 변경을 보존했다. 알림 마이그레이션과 검증은 출퇴근 원본에 쓰지 않는다.
- 증거는 로컬 docs/backups/my-home-notifications-before-20261102.json 및 my-home-notifications-verification-20261102.json에 보관한다.
