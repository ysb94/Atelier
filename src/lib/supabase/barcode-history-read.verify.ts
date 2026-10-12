import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listBarcodeDataEntryShipments } from './outbound-shipments'

type Row = Record<string, string | number | null>
type Request = { table: string; from?: number; ids?: string[] }

/** 실제 조회 함수에 읽기 전용 가짜 클라이언트를 넣어 다중 페이지·권한 누락·실패를 검증한다. */
export async function verifyBarcodeHistoryRead() {
  const brandId = 'brand-a'
  const shipments: Row[] = Array.from({ length: 2401 }, (_, index) => ({
    id: `line-${String(2401 - index).padStart(5, '0')}`,
    brand_id: brandId,
    style_id: `style-${index % 401}`,
    usage_target_id: `target-${index % 201}`,
    shipped_on: '2026-10-01',
    quantity: 2,
    source: 'bulk',
    source_ref: 'barcode-data-entry:run-1',
    note: '원본 비고',
    created_at: '2026-10-02T01:00:00Z',
  }))
  const styles: Row[] = Array.from({ length: 401 }, (_, index) => ({
    id: `style-${index}`, brand_id: brandId, style_no: `M${index}`, name: `상품 ${index}`,
  }))
  const targets: Row[] = Array.from({ length: 201 }, (_, index) => ({
    id: `target-${index}`, brand_id: brandId, name: `업체 ${index}`, group_id: 'group', site_name: `지점 ${index}`,
  }))
  // RLS가 참조 행을 숨기면 기존 LEFT JOIN처럼 출고 행과 ID·수량은 유지하고 이름만 비운다.
  styles[400]!.brand_id = 'brand-b'
  targets[200]!.brand_id = 'brand-b'
  const tables: Record<string, Row[]> = { outbound_shipments: shipments, styles, code_usage_targets: targets }
  const requests: Request[] = []
  let active = 0
  let maxActive = 0
  let failure: { table: string; from?: number } | null = null

  const client = {
    from(table: string) {
      const filters = new Map<string, string>()
      const request: Request = { table }
      let end = 0
      let prefix = ''
      let selected: string[] = []
      const builder = {
        select(columns: string, options?: unknown) {
          assert.equal(options, undefined, 'exact COUNT를 반복하지 않는다')
          assert.ok(!columns.includes('('), '원장 조회에서 상품·업체 조인을 하지 않는다')
          selected = columns.split(',').map((column) => column.trim())
          return builder
        },
        eq(column: string, value: string) { filters.set(column, value); return builder },
        like(column: string, value: string) {
          assert.equal(column, 'source_ref')
          prefix = value.slice(0, -1)
          return builder
        },
        order() { return builder },
        range(from: number, to: number) { request.from = from; end = to; return builder },
        in(column: string, ids: string[]) {
          assert.equal(column, 'id')
          assert.ok(ids.length > 0 && ids.length <= 200, '참조 조회는 200건 이하')
          request.ids = ids
          return builder
        },
        then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
          return (async () => {
            assert.equal(filters.get('brand_id'), brandId, '모든 조회는 브랜드 범위를 유지한다')
            active += 1
            maxActive = Math.max(maxActive, active)
            requests.push(request)
            await new Promise((done) => setTimeout(done, 0))
            active -= 1
            if (failure?.table === table && (failure.from === undefined || failure.from === request.from)) {
              return { data: null, error: { code: '57014', message: 'test query failure' } }
            }
            let data = tables[table]!.filter((row) =>
              [...filters].every(([key, value]) => row[key] === value) &&
              (!prefix || String(row.source_ref ?? '').startsWith(prefix)) &&
              (!request.ids || request.ids.includes(String(row.id))),
            )
            if (request.from !== undefined) data = data.slice(request.from, end + 1)
            return { data: data.map((row) => Object.fromEntries(selected.map((key) => [key, row[key]]))), error: null }
          })().then(resolve, reject)
        },
      }
      return builder
    },
  } as unknown as SupabaseClient

  const rows = await listBarcodeDataEntryShipments(brandId, client)
  assert.equal(rows.length, 2401, '1000행 뒤의 출고 데이터도 전부 읽는다')
  assert.equal(maxActive, 1, '출고·참조 페이지를 순차 조회한다')
  assert.deepEqual(requests.filter((request) => request.table === 'outbound_shipments').map((request) => request.from), [0, 1000, 2000])
  assert.deepEqual(rows.map((row) => row.id), shipments.map((row) => row.id), '원장 순서와 ID를 유지한다')
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 4802, '수량을 유지한다')
  assert.equal(rows[0]!.styleNo, 'M0')
  assert.equal(rows[0]!.styleName, '상품 0')
  assert.equal(rows[0]!.note, '원본 비고')
  assert.equal(rows[0]!.createdAt, '2026-10-02T01:00:00Z')
  assert.equal(rows[0]!.sourceRef, 'barcode-data-entry:run-1')
  assert.equal(rows[400]!.styleNo, '', '브랜드 범위 밖 상품명은 노출하지 않는다')
  assert.equal(rows[200]!.partnerName, '', '브랜드 범위 밖 업체명은 노출하지 않는다')
  for (const table of ['styles', 'code_usage_targets']) {
    const ids = requests.filter((request) => request.table === table).flatMap((request) => request.ids ?? [])
    assert.equal(ids.length, new Set(ids).size, '반복되는 참조 ID는 한 번만 조회한다')
  }

  const originalWarn = console.warn
  console.warn = () => undefined // 의도적으로 유발하는 오류 로그만 테스트 동안 숨긴다.
  try {
    failure = { table: 'outbound_shipments', from: 1000 }
    await assert.rejects(listBarcodeDataEntryShipments(brandId, client), /test query failure/, '부분 목록을 성공으로 반환하지 않는다')
    failure = { table: 'styles' }
    await assert.rejects(listBarcodeDataEntryShipments(brandId, client), /test query failure/, '참조 조회 실패를 빈 상품명으로 삼키지 않는다')
  } finally {
    console.warn = originalWarn
  }
  failure = null
  tables.outbound_shipments = shipments.slice(0, 2000)
  requests.length = 0
  assert.equal((await listBarcodeDataEntryShipments(brandId, client)).length, 2000)
  assert.deepEqual(requests.filter((request) => request.table === 'outbound_shipments').map((request) => request.from), [0, 1000, 2000], '정확히 1000행 배수면 빈 마지막 페이지에서 종료한다')
  tables.outbound_shipments = []
  requests.length = 0
  assert.deepEqual(await listBarcodeDataEntryShipments(brandId, client), [])
  assert.equal(requests.length, 1, '빈 이력은 상품·업체 전체 조회를 하지 않는다')
  console.log('barcode-history-read.verify ok')
}
