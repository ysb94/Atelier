/**
 * 창고정리용 선적일 검증.
 * 실행: npx tsx src/lib/cargo/warehouse-tidy.verify.ts
 */
import { resolveWarehouseTidyShippedOn } from './warehouse-tidy'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 13,
    partIndex: 0,
    partCount: 1,
  }) === '260910',
  '합 13 단독 행은 선적일 그대로',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '260909',
  '합 16 단독 행은 하루 앞',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 14,
    partIndex: 2,
    partCount: 3,
  }) === '260911',
  '갈라진 마지막 행은 하루 뒤',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 16,
    partIndex: 1,
    partCount: 2,
  }) === '260911',
  '합 16이면서 마지막 행이면 하루 뒤가 우선',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 15,
    partIndex: 0,
    partCount: 1,
  }) === '260910',
  '최신자리 NEW인 단독 행은 선적일 그대로',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-01',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '260831',
  '하루 앞이 월을 넘긴다',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-12-31',
    boxSum: 14,
    partIndex: 1,
    partCount: 2,
  }) === '270101',
  '하루 뒤가 연을 넘긴다',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '',
  '빈 선적일은 빈 문자열',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '미정',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '',
  '형식이 아니면 빈 문자열',
)

console.log('warehouse-tidy.verify ok')
