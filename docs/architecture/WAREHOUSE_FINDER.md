# 창고 파인더 Supabase 연결

이 문서는 Firebase `masma_finder`의 검색·자리 조회를 Atelier Supabase
연습 창고 스냅샷으로 옮기는 기준이다. 구현은 이 문서를 따른다.

관련 문서: [`SUPABASE.md`](./SUPABASE.md), [`INVENTORY.md`](./INVENTORY.md).

## 권장 구조

```text
Google 시트 창고입력
  → warehouse-sheet-sync
  → Supabase 활성 sandbox 세트
  → Atelier 창고 파인더 / 창고 관리 / 송장 읽기
Google 시트 창고입력
  -. 전환 기간만 병행 .-> Firebase warehouses_product_search
```

- 기준 원본은 Firebase가 아니라 Google 시트 `창고입력`이다.
- 1차 목표는 Firebase 데이터를 다시 복사하는 것이 아니라, 이미 들어온
  Supabase 스냅샷을 파인더가 직접 검색하게 만드는 것이다.
- Works 일일업무, 입고리스트, 라벨 OCR, 자리이동, 첨부, Finder 전용 승인은
`docs/architecture/SUPABASE.md`의 Masma Finder 절과
`scripts/masma-finder-migrate/mapping.md`를 본다.
- `warehouse_stock_positions`는 연습 스냅샷이다. 실재고·예약·출고 차감으로
  부르지 않는다.

## 1. 필드 대응

| 시트 | Firestore | Supabase | 규칙 |
| --- | --- | --- | --- |
| B · M번호 | `chinaCode` | `source_style_no`, `normalized_style_no` | 검색은 `styles.style_no` exact. 상품명 우회 금지 |
| C · 제품명 | `productName` | `source_product_name` | 카드 기본 이름은 시트 원문. 연결되면 `styles.name`을 공식명으로 표시 |
| D · 자리번호 | `libraryNumber` | `warehouse_locations.code` + `is_final_location` | 끝 `//`는 마지막 위치 표시 |
| E · 입고일 | `arrivalDate` | `received_on`, `received_on_raw` | `000000` 최우선, `000001` 차순위, `999999` 마지막 |
| F · 박스당 갯수 | `unitsPerBox` | `units_per_box`, `units_per_box_raw` | 빈 값은 unknown. 0/1로 추정하지 않음 |
| G · 박스 수 | `boxCount` | `remaining_boxes`, `remaining_boxes_raw` | 미확인이면 계산 수량을 합산하지 않음 |
| H · 비고 | `note` | `note` | 원문 유지 |
| AA · 행 ID | 문서 ID | `external_row_id` | 이중 조회의 기본 키 |
| X · 상품 참조 | `productRef` | `(brand_id, style_id)` | Firebase 경로 대신 SKU FK |

코드 상수: `WAREHOUSE_FINDER_FIELD_MAP` (`src/lib/warehouse/finder.ts`).

특수값 검증 묶음: M번호, 상품명 prefix, 자리 단축(`211`→`2-1-1`), `//`,
`000000`/`000001`/`999999`, 수량 빈 행.

## 2. 조회 경계

- 대상은 브랜드의 활성 `sandbox` 세트 하나다.
- RPC: `search_warehouse_finder_rows`, `list_warehouse_finder_inbounds`.
- 권한은 `app.can_access_warehouse_finder` =
  `can_read_brand OR can_use_masma_finder`. `can_read_brand` 자체는
  넓히지 않는다. 쓰기는 없다.
- 브라우저는 재고 전량을 받지 않는다. 상한은 상품명·M번호 100, 자리 200.
- 실시간은 `warehouse_inventory_sets` 교체 이벤트만 구독한다. 신호가 오면
  현재 검색만 다시 실행한다.
- 이미지는 Firebase `products`가 아니라 `styles.style_no`와 CDN 규칙을 쓴다.

검색 규칙:

- 상품명: `source_product_name` 또는 공식명 prefix. exact가 하나라도 있으면
  exact만 보여 준다.
- 상품명 입력 중에는 같은 prefix 조회 결과의 `source_product_name`을 공백·NFKC·
  대소문자 기준으로 중복 제거해 연관 검색어로 보여 준다. 재고 전량을 별도로 받지 않는다.
- 창고자리: 단축 입력을 푼 뒤 `warehouse_locations.code` prefix.
  카드의 자리 옆 숫자는 그 자리 전체의 중복 제거된 제품 종류다. 입고
  건수가 아니다. 종류 키는 M번호, 없으면 상품명이다.
- M번호: `normalizeStyleNo` 후보(`0885`/`M0885`) exact. 이름을 경유하지 않는다.

화면 `/logistics/finder`는 읽기 전용이다. 자리이동·입고·차감 버튼은 두지 않는다.
검수 플래그(`수량 미확인`, `상품 미연결`, `날짜 검수`, `중복 의심`)는 경고
카드로만 구분하고 정상 재고처럼 합산하지 않는다.

## 3. 이중 조회 검증과 전환

전환 전에 같은 AA(`external_row_id`)로 Firebase 검색 문서와 Supabase
스냅샷을 비교한다.

통과 조건 (`decideWarehouseFinderSwitch`):

- 양쪽 행 수가 같다.
- 한쪽에만 있는 AA가 없다.
- `chinaCode`, `productName`, `libraryNumber`, `arrivalDateRaw`,
  `unitsPerBoxRaw`, `boxCountRaw`, `note`가 모두 같다.

비교 함수: `compareWarehouseFinderParity`.
실행: `npm run verify:warehouse-finder`.

운영 전환 순서:

1. 시트 동기화 직후 위 비교를 한다.
2. 통과하면 파인더 기본 조회를 Supabase로 둔다.
3. 짧은 기간 Firebase는 폴백·오류 로그만 남긴다.
4. 불일치가 나오면 기본 조회를 Firebase로 되돌리고 시트 원본을 확인한다.

롤백 조건: AA 누락, 자리/`//` 표기 불일치, 특수 입고일 불일치, 수량 원문 불일치.

## 5. Masma Finder 앱 전환

- 검색 RPC는 Atelier 직원(`can_read_brand`)과 Finder 전용 승인
  (`can_use_masma_finder`)이 모두 호출할 수 있다. 회사 셸 권한은 넓히지 않는다.
- Works·입고·자리이동·라벨·첨부는 Finder 승인만으로 연다.
- 재고 수량만 `firebase-product-onhand`가 Firebase `products.onhand`를 읽는다.
- 백업: `scripts/masma-finder-migrate/` 스냅샷. Firebase 원본은 검증 전까지 유지.
- Works 화면은 UI를 유지하고, CRUD/Realtime은 `masma_finder/src/lib/works/`
  Provider·Repository가 맡는다. 채널당 `subscribe()`는 한 번만 호출한다.
- 롤백: masma_finder 앱 URL/배포를 직전 버전으로 돌린다. 시트 자리이동 계약은
  그대로다.

## 4. 시트 동기화 분리

현재 기본값: 시트 → Firebase가 전 행 성공한 뒤에만 Supabase를 교체한다.

안정화 후: 시트 → Supabase를 Firebase 성공 여부와 분리한다.
Apps Script 속성 `ATELIER_WAREHOUSE_SYNC_INDEPENDENT=true` 이면
전 행을 읽은 뒤 Firebase 실패와 무관하게 `warehouse-sheet-sync`를 호출한다.

규칙 함수: `shouldSyncAtelierWarehouseSnapshot`.

- 시트 전 행을 읽기 전에는 스냅샷을 갈아끼우지 않는다.
- 단독 동기화를 켜기 전에는 Firebase 실패 시 사이트를 갱신하지 않는다.
- 메뉴 `사이트 DB 전체 동기화 재시도`는 기존처럼 언제든 시트 원본으로
  Supabase만 다시 보낸다.

Firebase 검색 컬렉션과 `WPS_DOCUMENT_SECRET` 폐기는 단독 동기화가 안정된
뒤로 미룬다.
