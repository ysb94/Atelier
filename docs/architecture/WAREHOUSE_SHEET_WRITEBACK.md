# Atelier 창고입력 연속 반영

Atelier의 행 수정, 상태 변경, 자리 이동, 실사 수량 조정, 소진, 수동 입고와 QR 상품 검수는 기존 저장 RPC를 사용한다. 마스마룰즈 연속 반영을 켠 뒤에는 재고와 작업별 이력이 같은 DB 트랜잭션에 저장된다. Finder의 입고·이동·자리 실사 및 기존 QR·재고 버전 검증은 기존 경로를 사용한다. 출고창고에서 다른 재고가 점유한 자리에 신규 입고하거나 옮기는 경우 저장을 거부한다.

- 시트 반영 계획은 같은 AA, QR 또는 출고창고 자리로 연결된 작업을 묶는다. 각 AA의 최초 이전값과 마지막 최종값을 사용한다. 이미 쓰기를 시작한 계획은 고정하며, 같은 AA의 나중 저장은 다음 버전을 기다린다.
- Apps Script는 기존 5분 작업과 공유 잠금을 사용한다. 중복 AA·QR, 출고 자리 점유, 수기 변경 및 대상 셀의 수식을 확인한다. 분할과 자리 교대는 한 번의 시트 요청으로 반영한다. B:H, S, AA의 필요한 입력값만 쓴다. 소진은 시트 입력값을 비우고 AA를 다시 읽어 확인한다. 완료 뒤 기존 WPS 삭제 흐름이 해당 행을 정리한다. [Google Sheets 일괄 업데이트](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate)
- B:H, S와 삭제된 AA를 다시 읽고 계획과 일치해야 해당 버전의 작업이 완료된다. 충돌한 묶음만 재시도하며 창고 관리에 기대 시트값, 실제 시트값, 목표값을 표시한다. 직접 시트 편집에는 값 조건부 쓰기 API가 없으므로 직전 비교 후 쓰고 즉시 다시 확인한다. [Apps Script 공유 잠금](https://developers.google.com/apps-script/reference/lock/lock-service)
- 전체 가져오기는 시트 읽기 시각 이후에 완료된 작업과 현재 대기의 AA를 활성 재고에서 가져온다. 해당 AA가 이미 소진됐으면 가져온 행에서 빼며, 이 범위 밖의 행은 기존 가져오기 로직으로 처리한다.

## 운영 반영 순서

2026-11-16 운영 이력. 로컬 `20261116094915_atelier_stock_sheet_writeback.sql`은 공유 DB 마이그레이션 `20261116102545`로 적용됐다. `warehouse-sheet-sync` v18에 같은 코드를 배포했다. 기존 Finder 미배치 QR, 박스 출고 확인, 상태 반영 검증 마이그레이션은 적용 이력을 확인했다.

1. 운영 변경 승인 후 대상 브랜드, 활성 재고와 대기 건, 구글 시트 B:H·S·AA, DB 함수 정의와 배포 중인 Apps Script 파일을 읽어 저장한다. `test`와 운영이 DB를 공유하므로 가상 데이터 검증은 별도 로컬 PostgreSQL과 시트 모의 환경에서 실행한다.
2. `20261116094915_atelier_stock_sheet_writeback.sql`을 적용한다. 운영 DB의 기존 `confirm_warehouse_stock_condition_exports`는 B:H·S 재조회값을 검증하는 버전이어야 한다. 적용 직후는 브랜드별 연속 반영이 꺼져 있다.
3. 새 `warehouse-sheet-sync`를 배포한다. 기존 서명·가져오기·상태/QR 반영 액션을 확인한다. 새 작업 조회는 활성화 전 `enabled: false`와 빈 목록을 반환한다.
4. 운영 `창고입력`에 연결된 프로젝트에서 `warehouse-qr-audit-sheet-sync.gs`만 갱신하고 기존 `syncAtelierWarehouseQrAuditSheet` 5분 트리거를 사용한다. Finder 파일, 웹앱 배포 URL과 버전, `warehouse-stock-condition-sync.gs` 및 기존 트리거를 유지한다. `enableAtelierStockSheetWritebackV2`로 DB 활성화 전 서버 응답을 확인하고 스크립트 속성 `ATELIER_STOCK_SHEET_WRITEBACK_V2`를 켠다.
5. 아래 M2363 확인을 마친 뒤 서비스 역할로 활성화한다. 현재 대기 중인 Atelier 작업만 새 계획으로 이관한다. 기존 시트 반영 경로는 Finder와 미이관 건을 계속 처리한다.
6. 작업 버전의 완료 시각, 실제 시트행 값, 활성 재고와 Finder 조회 결과를 확인한다. 창고 관리의 충돌 표시와 소진 사유 입력은 Atelier 웹 변경에 포함된다. 검수 화면 확인과 `main` 반영 승인을 거쳐 웹을 배포한다.

## M2363 기존 누락 건

확인한 행은 `창고입력` 2211행, AA `inb_68fa228a41c045f5`였다. 시트 B:H는 `M2363`, `스파클 퍼 트리밍 후드집업 블랙`, `4-6-8`, `260919`, `25`, `2`, `수선 필요`였고 S는 비어 있었다. DB의 활성 재고는 `!-0-0`, 3박스였다. 당시 2→3박스 정정은 완료 이력이 있었으며 뒤이은 이동은 시트 대기 상태였다.

운영 적용 중 Apps Script 편집기 연결이 중단되어, 현재 DB 값과 AA·기존 시트 입력값을 다시 대조한 뒤 승인된 D2211·G2211만 보정했다. 실제 시트 재조회에서 `!-0-0`·3박스와 기존 AA, 메모, 서식이 확인됐다.

승인 뒤 AA를 다시 찾아 현재 B:H·S와 DB 최종값 및 `updated_at`을 대조한다. 시트가 기존 관측값과 같고 현재 DB도 일치하면, 다음 두 호출을 한 트랜잭션에서 실행한다.

```sql
select public.activate_atelier_stock_sheet_writeback(:brand_id);
select public.reconcile_atelier_stock_sheet_baseline(
  :brand_id, :aa, :fresh_stock_updated_at, :fresh_sheet_observation::jsonb
);
```

`fresh_sheet_observation`은 `{"id":"…","qr":"","values":["B","C","D","E","F","G","H"]}` 형식이다. 이 호출은 과거 완료 정정의 이전 값과 방금 읽은 시트값이 같고, 활성 재고 버전과 대기 작업의 최종값이 일치하는 경우에만 대기 작업의 비교 시작값을 보정한다. 시트가 이미 최종값으로 맞으면 활성화 후 일반 재조회로 완료한다. 어느 쪽 값이라도 달라졌으면 바뀐 현재 값을 다시 확인한다. 완료 뒤 같은 AA에서 D=`!-0-0`, G=`3`, E=`260919`, H=`수선 필요`를 다시 읽는다.

운영에서 잠시 시트 쓰기를 멈춰야 하면 스크립트 속성을 끈다. 이 상태에서도 DB에 연속 저장과 대기를 쌓는다. 활성화 전 흐름으로 복귀하려면 새 작업과 AA 삭제 표지 정리를 먼저 완료한 뒤 같은 브랜드 잠금 아래 활성화 설정을 해제한다.

## 로컬 검증

### 기존 시트 보관 자리로 이동

등록된 자리를 먼저 조회하고, 없으면 같은 창고의 `warehouse_locations`에 남아 있는
유일한 `box_storage` 자리도 이동 대상으로 인정한다. 현재 재고가 비어 있는 원래 자리로도
돌아갈 수 있다. 등록되지 않은 출고 자리, 다른 창고의 자리, 중복 분류·대소문자 중복 자리,
존재하지 않는 새 자리는 허용하지 않는다. `%`는 검색 와일드카드가 아닌 자리번호의 문자다.
등록된 출고 자리의 분류와 점유 검증, 재고 버전·QR·권한 검사, Finder 동기화 차단은 유지한다.

로컬 마이그레이션 `20261116112508_warehouse_stock_move_existing_locations.sql`은
사용자 승인 후 공유 DB `20261116112801`로 적용했다. 기존 이동 RPC의 목적지 조회만
변경하므로 웹·Edge Function·Apps Script 재배포는 필요하지 않다.
실제 test 사이트의 기존 이동창에서 M2379 9박스 중 8박스를 `%-6-9`로 반환했고,
`3-5-5_B2`에는 1박스를 남겼다. 두 행 모두 입고일 `261027`, 박스당 32개를 유지한다.

- `npm run verify:warehouse-snapshot-finder-guard`는 격리된 로컬 PostgreSQL에서 실제 마이그레이션과 Finder/Atelier RPC를 실행한다.
- `npm run verify:warehouse-sheet-sync`는 모의 Apps Script에서 AA별 쓰기, 실제 값 재조회, 재시도, WPS 호환과 한 묶음의 실패가 다른 묶음을 막지 않는지 확인한다.
