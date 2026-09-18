# 임시 창고관리 DB 연동 인수인계

## 1. 문서 목적

작업자가 사용하는 별도 창고 관리 프로그램을 Atelier의 「임시 창고관리」와 같은
Supabase 데이터에 연결하기 위한 구현 기준이다.

이 문서의 핵심 원칙은 다음과 같다.

- 새 Supabase 프로젝트나 별도 DB를 만들지 않는다.
- E&J 조직의 기존 `Atelier` Supabase 프로젝트를 사용한다.
- 개별 박스 원본은 `public.warehouse_boxes`다.
- 박스 작업 이력은 `public.warehouse_box_movements`에 저장한다.
- 읽기는 테이블 조회를 사용하고, 쓰기는 반드시 제공된 RPC를 사용한다.
- 박스창고에서는 박스를 개봉하거나 수량을 차감하지 않는다.
- 개봉하려면 박스 전체를 출고창고의 택배 포장 또는 대량 출고 자리로 먼저 옮긴다.
- 기존 묶음 재고인 `warehouse_stock_positions`는 이 기능에서 변경하지 않는다.

## 2. Supabase 연결

### 대상 프로젝트

- 프로젝트명: `Atelier`
- 프로젝트 ref: `pmzgdqvtzwfwqmvhzcyo`
- 기존 Atelier 웹앱과 동일한 프로젝트를 사용한다.

### 클라이언트 환경변수

```env
VITE_SUPABASE_URL=https://pmzgdqvtzwfwqmvhzcyo.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<기존 Atelier publishable 키>
```

- 키 값은 소스코드에 하드코딩하지 않는다.
- 작업자 프로그램에는 publishable 키만 사용한다.
- `service_role` 또는 secret 키는 브라우저·작업자 PC에 절대 배포하지 않는다.
- Supabase Auth 로그인 세션이 있어야 데이터 조회와 RPC 실행이 가능하다.

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
```

## 3. 데이터 모델

### 3.1 `public.warehouse_boxes`

고유번호가 붙은 실제 박스 한 개를 나타내는 원장이다. 한 박스에는 하나의
SKU(M번호)와 하나의 입고일만 들어간다.

주요 컬럼:

- `id uuid`
  - 박스 내부 PK
  - 화면과 RPC에서 박스를 지정할 때 사용한다.
- `brand_id uuid`
  - 박스 소유 브랜드
  - 모든 조회와 RPC에 현재 브랜드 ID를 명시해야 한다.
- `set_id uuid null`
  - 연습 XLSX 스냅샷 연결값
  - 임시 창고관리에서 새로 등록한 박스는 `null`이다.
- `display_code text`
  - 작업자가 보는 박스 고유번호
  - 저장 시 대문자와 앞뒤 공백 제거가 적용된다.
  - `(brand_id, display_code)` 범위에서 유일하다.
- `location_id uuid`
  - `warehouse_locations.id` 참조
- `style_id uuid`
  - 실제 SKU인 `styles.id` 참조
  - M번호 문자열만 저장하면 안 된다.
- `received_on date null`
  - 입고일
- `initial_qty integer`
  - 최초 입수
  - 1 이상의 정수여야 한다.
- `current_qty integer`
  - 현재 남은 수량
  - `0 <= current_qty <= initial_qty`여야 한다.
- `status text`
  - `sealed`, `opened`, `depleted` 중 하나
  - 클라이언트가 임의 지정하지 않고 DB가 수량으로 계산한다.
- `usage_priority text`
  - `first`, `second`, `fifo`, `last` 중 하나
- `note text`
  - 검수 내용이나 특이사항
- `source_position_id uuid null`
  - 향후 묶음 재고를 개별 박스로 전환할 때 사용할 원본 위치
  - 현재 임시 창고관리에서는 `null`로 둔다.
- `created_by uuid null`
  - 등록 사용자
- `archived_at timestamptz null`
  - `null`이면 활성 박스
  - 값이 있으면 보관된 박스
- `archived_by uuid null`
  - 보관 처리 사용자
- `created_at`, `updated_at`
  - 생성·수정 시각

### 3.2 `public.warehouse_box_movements`

개별 박스의 모든 작업 이력을 저장한다.

주요 컬럼:

- `id uuid`: 이력 PK
- `brand_id uuid`: 브랜드
- `box_id uuid`: 대상 박스
- `action text`: 작업 종류
- `from_location_id`, `from_location_code`, `from_zone`: 작업 전 자리
- `to_location_id`, `to_location_code`, `to_zone`: 작업 후 자리
- `from_qty`, `to_qty`: 작업 전후 수량
- `reason text`: 작업 사유
- `actor_id uuid null`: 실행 사용자
- `created_at timestamptz`: 실행 시각

`action` 값:

- `create`: 박스 등록
- `update`: 수량·사용 순서·비고 수정
- `move`: 자리 또는 창고 구역 이동
- `open`: 최초 개봉
- `deplete`: 수량 소진
- `archive`: 보관 처리

이력은 수정·삭제하지 않고 조회용으로 사용한다.

### 3.3 관련 테이블

#### `public.warehouse_locations`

- 박스가 실제로 놓인 자리다.
- `zone`은 `box_storage` 또는 `picking`이다.
- 자리 유일 범위는 `(warehouse_id, zone, code)`다.
- 같은 자리 코드라도 구역이 다르면 별도 자리로 취급될 수 있다.

구역 의미:

- `box_storage`: 박스창고, 밀봉 박스 전용
- `picking`: 출고창고, 택배 포장 또는 대량 출고 작업 구역

#### `public.warehouse_registered_slots`

- 창고관리에서 등록한 자리 목록이다.
- 작업자 프로그램의 자리 선택 목록에 사용할 수 있다.
- 구역별로 조회하여 박스창고와 출고창고 자리를 구분한다.

#### `public.styles`

- 실제 SKU(M번호) 원장이다.
- `styles.style_no`가 화면에 표시되는 M번호다.
- M번호는 색상과 사이즈까지 구분되는 SKU 단위다.
- 박스 등록 시 사용자가 검색한 M번호의 `styles.id`를 `style_id`로 전달한다.

#### `public.warehouse_stock_positions`

- 박스 ID가 없는 기존 묶음 재고다.
- 개별 박스 원장과 목적이 다르다.
- 임시 창고관리 등록·이동·개봉으로 이 테이블을 차감하거나 수정하면 안 된다.

## 4. 반드시 지켜야 하는 업무 규칙

### 박스 상태

- `current_qty = initial_qty`이면 `sealed`
- `0 < current_qty < initial_qty`이면 `opened`
- `current_qty = 0`이면 `depleted`

### 박스창고 개봉 금지

`box_storage` 구역에서는 반드시 다음 조건을 만족해야 한다.

```text
current_qty = initial_qty
status = sealed
```

따라서 다음 요청은 DB에서 거절된다.

- 박스창고에 있는 박스의 현재 수량 차감
- 박스창고에 개봉 또는 소진 상태로 신규 등록
- 개봉 또는 소진된 박스를 박스창고로 다시 이동

개봉 절차:

1. 밀봉 박스를 박스창고에 등록한다.
2. `move_warehouse_box`로 출고창고의 택배 포장 또는 대량 출고 자리로 이동한다.
3. 이동 성공 응답을 받은 뒤 `update_warehouse_box`로 현재 수량을 줄인다.
4. DB가 상태를 `opened` 또는 `depleted`로 변경하고 이력을 남긴다.

이 순서를 클라이언트에서 한꺼번에 성공한 것으로 표시하면 안 된다. 이동 RPC가
성공한 것을 확인한 다음 수량 변경을 실행한다.

### 기타 제약

- 현재 수량은 음수가 될 수 없다.
- 현재 수량은 최초 입수보다 많을 수 없다.
- 브랜드 안에서 박스 고유번호는 중복될 수 없다.
- 다른 브랜드의 상품이나 박스를 현재 브랜드 요청에 사용할 수 없다.
- 보관된 박스는 다시 수정하거나 이동할 수 없다.
- 삭제 대신 보관 처리를 사용한다.

## 5. 권한과 RLS

두 원장 모두 RLS가 활성화되어 있다.

- 읽기: `app.can_read_brand(brand_id)`
- 쓰기: `app.can_edit_brand(brand_id)`
- 비로그인 `anon` 사용자는 RPC를 실행할 수 없다.
- RPC는 `SECURITY INVOKER`이므로 로그인 사용자의 RLS와 권한으로 실행된다.

작업자 계정에 대상 브랜드 읽기·수정 권한이 없으면 클라이언트에서 우회하지 말고
관리자에게 브랜드 권한을 요청해야 한다.

## 6. 조회 구현

### 활성 박스 목록

```ts
const PAGE_SIZE = 1000

export async function listWarehouseBoxes(brandId: string) {
  const all = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('warehouse_boxes')
      .select(`
        id,
        brand_id,
        set_id,
        display_code,
        location_id,
        style_id,
        received_on,
        initial_qty,
        current_qty,
        status,
        usage_priority,
        note,
        source_position_id,
        created_by,
        archived_at,
        archived_by,
        created_at,
        updated_at,
        warehouse_locations!warehouse_boxes_location_fkey(code, zone),
        styles!warehouse_boxes_style_fkey(style_no, name)
      `)
      .eq('brand_id', brandId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error

    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }

  return all
}
```

보관 박스까지 조회해야 하는 관리 화면에서만 `archived_at is null` 필터를 제거한다.

### 박스 이력

```ts
export async function listWarehouseBoxMovements(
  brandId: string,
  boxId: string,
) {
  const { data, error } = await supabase
    .from('warehouse_box_movements')
    .select(`
      id,
      brand_id,
      box_id,
      action,
      from_location_id,
      from_location_code,
      from_zone,
      to_location_id,
      to_location_code,
      to_zone,
      from_qty,
      to_qty,
      reason,
      actor_id,
      created_at
    `)
    .eq('brand_id', brandId)
    .eq('box_id', boxId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })

  if (error) throw error
  return data ?? []
}
```

이력도 1,000행을 넘을 수 있으므로 운영 구현에서는 박스 목록과 같은 방식으로
페이지 처리한다.

## 7. 쓰기 RPC

테이블에 직접 `INSERT`, `UPDATE`, `DELETE`하지 않는다. 자리 생성·검증, 상태 계산,
이력 저장이 같은 트랜잭션에서 처리되도록 아래 RPC를 사용한다.

### 7.1 박스 등록

RPC: `public.create_warehouse_box`

```ts
const { data, error } = await supabase.rpc('create_warehouse_box', {
  p_brand_id: brandId,
  p_display_code: displayCode,
  p_style_id: styleId,
  p_location_code: locationCode,
  p_zone: 'box_storage',
  p_received_on: receivedOn,
  p_initial_qty: initialQty,
  p_current_qty: initialQty,
  p_usage_priority: 'fifo',
  p_note: note ?? '',
  p_source_position_id: null,
})

if (error) throw error
```

박스창고 등록이면 `p_current_qty`는 반드시 `p_initial_qty`와 같아야 한다.

### 7.2 수량·순서·비고 수정

RPC: `public.update_warehouse_box`

```ts
const { data, error } = await supabase.rpc('update_warehouse_box', {
  p_brand_id: brandId,
  p_box_id: boxId,
  p_current_qty: nextCurrentQty,
  p_usage_priority: null,
  p_note: null,
})

if (error) throw error
```

- 전달하지 않는 수정값은 `null`로 보낸다.
- 수량 차감은 박스가 `picking` 구역에 있을 때만 가능하다.
- 최초 차감이면 `update` 이력과 `open` 이력이 함께 남는다.
- 수량이 0이 되면 `deplete` 이력이 추가된다.

### 7.3 자리·구역 이동

RPC: `public.move_warehouse_box`

```ts
const { data, error } = await supabase.rpc('move_warehouse_box', {
  p_brand_id: brandId,
  p_box_id: boxId,
  p_location_code: destinationLocationCode,
  p_zone: 'picking',
})

if (error) throw error
```

- 등록되지 않은 유효한 자리는 서버가 같은 회사 창고에 생성·등록한다.
- 개봉·소진 박스에 `p_zone: 'box_storage'`를 보내면 거절된다.

### 7.4 보관 처리

RPC: `public.archive_warehouse_box`

```ts
const { data, error } = await supabase.rpc('archive_warehouse_box', {
  p_brand_id: brandId,
  p_box_id: boxId,
  p_reason: '작업자 프로그램 보관',
})

if (error) throw error
```

- 실제 행을 삭제하지 않는다.
- `archived_at`, `archived_by`를 채우고 `archive` 이력을 남긴다.
- 성공 후 활성 목록에서는 사라져야 한다.

## 8. 작업자 화면 요구사항

### 박스 등록 화면

- 현재 브랜드를 명확히 표시한다.
- M번호 검색 결과에서 실제 `style_id`를 선택한다.
- 박스창고 선택 시 현재 수량을 최초 입수와 같게 고정한다.
- 박스창고에서는 현재 수량 입력창을 비활성화한다.
- 출고창고는 택배 포장 또는 대량 출고 자리로 표시한다.
- RPC 성공 응답을 받기 전에는 저장 완료로 표시하지 않는다.

### 박스 목록

- 기본 목록은 `archived_at is null`인 박스만 표시한다.
- 박스번호, 창고 구역, M번호, 상품명, 자리, 입고일, 최초 입수, 현재 수량,
  상태와 사용 순서를 표시한다.
- 박스창고 행에서는 수량 수정 버튼을 비활성화한다.
- 버튼 문구는 `출고창고 이동 후 개봉`처럼 작업 순서를 알려준다.
- 출고창고 행에서만 수량 수정 UI를 활성화한다.
- 개봉 또는 소진 박스는 박스창고 이동 선택을 비활성화한다.

### 저장 후 동기화

각 RPC 성공 후 다음 데이터를 다시 조회한다.

- 활성 박스 목록
- 현재 보고 있는 박스의 작업 이력
- 필요한 경우 구역별 자리 목록

서버 오류가 발생하면 로컬 화면만 성공 상태로 변경하지 않는다.

## 9. 주요 오류 처리

사용자에게 DB 오류 메시지를 가능한 한 그대로 보여준다.

예상 오류:

- `이미 등록된 박스 고유번호입니다.`
- `개별 박스를 수정할 권한이 없습니다.`
- `박스창고에서는 개봉하거나 수량을 차감할 수 없습니다. 택배 포장 또는 대량 출고 자리로 먼저 이동하세요.`
- `현재 수량은 최초 입수보다 많을 수 없습니다.`
- `보관된 박스는 수정할 수 없습니다.`
- `박스 자리가 브랜드 창고와 맞지 않습니다.`
- `박스를 찾지 못했습니다.`

네트워크 오류와 권한 오류는 콘솔에도 작업명, `brand_id`, `box_id`를 함께 기록한다.

## 10. 적용 완료 검증

작업자 프로그램에서 아래 순서가 모두 통과해야 한다.

1. 로그인하지 않은 사용자의 조회·RPC가 거절된다.
2. 읽기 권한만 있는 사용자의 목록 조회는 성공하고 쓰기는 거절된다.
3. 수정 권한이 있는 사용자가 박스창고에 밀봉 박스를 등록한다.
4. 같은 브랜드에서 같은 박스번호를 다시 등록하면 거절된다.
5. 박스창고에서 현재 수량을 줄이면 거절된다.
6. 박스를 출고창고의 택배 포장 또는 대량 출고 자리로 이동한다.
7. 이동 후 현재 수량을 줄이면 상태가 `opened`로 바뀐다.
8. 개봉 박스를 박스창고로 돌려보내면 거절된다.
9. 현재 수량을 0으로 수정하면 상태가 `depleted`로 바뀐다.
10. 보관 처리 후 활성 목록에서 사라진다.
11. 이력에 `create`, `move`, `update`, `open`, `deplete`, `archive`가 순서대로 남는다.
12. 위 작업 동안 `warehouse_stock_positions` 값은 바뀌지 않는다.

## 11. 현재 Atelier 구현 참고 파일

- Supabase 클라이언트: `src/lib/supabase/client.ts`
- 타입: `src/lib/types.ts`
- 개별 박스 저장소: `src/lib/supabase/warehouse-stock.ts`
- 공개 API 래퍼: `src/lib/api/index.ts`
- 작업 화면: `src/features/logistics/TemporaryWarehousePanel.tsx`
- 페이지: `src/features/logistics/TemporaryWarehousePage.tsx`

적용된 마이그레이션:

- `supabase/migrations/20260918184500_warehouse_boxes_individual.sql`
- `supabase/migrations/20260918185000_warehouse_box_fk_indexes.sql`
- `supabase/migrations/20260918191000_warehouse_box_open_only_in_picking.sql`

위 마이그레이션은 기존 Atelier Supabase 프로젝트에 이미 적용되어 있다. 작업자
프로그램은 새 DB를 만들거나 같은 마이그레이션을 다시 실행하지 않고, 기존 프로젝트에
로그인하여 조회와 RPC를 연결하면 된다.
