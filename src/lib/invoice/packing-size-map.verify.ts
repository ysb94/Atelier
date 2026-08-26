/**
 * 포장 규격 정규화·현재값/과거 매핑 병합·변경분 계산 검증.
 * 실행: npm run verify:packing-size-map
 */
import {
  mergeInvoicePackingSizeRows,
  normalizePackingSizeValue,
  packingSizeMapChanges,
} from '@/lib/invoice/packing-size-map'
import type {
  InvoicePackingSizeMap,
  InvoicePackingSizeSourceValue,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  normalizePackingSizeValue('  B-１１８  ') === 'b-118',
  'NFKC·공백·대소문자를 정규화해야 한다',
)
assert(
  normalizePackingSizeValue('35*45   박스') === '35*45 박스',
  '연속 공백을 한 칸으로 줄여야 한다',
)

const sources: InvoicePackingSizeSourceValue[] = [
  {
    fieldId: 'field',
    sourceValue: '35*45',
    normalizedSourceValue: '35*45',
    styleCount: 946,
  },
  {
    fieldId: 'field',
    sourceValue: 'B-118',
    normalizedSourceValue: 'b-118',
    styleCount: 15,
  },
]
const maps: InvoicePackingSizeMap[] = [
  {
    id: 'map-current',
    brandId: 'brand',
    fieldId: 'field',
    sourceValue: 'B-118',
    normalizedSourceValue: 'b-118',
    displayValue: 'M',
    createdAt: '2026-08-26T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
  },
  {
    id: 'map-old',
    brandId: 'brand',
    fieldId: 'field',
    sourceValue: '예전 규격',
    normalizedSourceValue: '예전 규격',
    displayValue: 'OLD',
    createdAt: '2026-08-26T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
  },
]
const sourceSnapshot = JSON.stringify(sources)
const mapSnapshot = JSON.stringify(maps)
const rows = mergeInvoicePackingSizeRows(sources, maps)

assert(rows.length === 3, '현재 고유값과 과거 매핑을 모두 보여야 한다')
assert(rows[0]?.sourceValue === '35*45', '미설정 원본을 맨 위에 두어야 한다')
assert(
  rows.findIndex((row) => row.sourceValue === '35*45') <
    rows.findIndex((row) => row.sourceValue === 'B-118'),
  '미설정이 저장된 매핑보다 앞에 와야 한다',
)
const currentMap = rows.find((row) => row.normalizedSourceValue === 'b-118')
assert(currentMap?.displayValue === 'M', '저장된 간단 표시값을 붙여야 한다')
assert(currentMap?.styleCount === 15, '사용 상품 수를 보존해야 한다')
const oldMap = rows.find((row) => row.normalizedSourceValue === '예전 규격')
assert(oldMap?.isCurrent === false, '사라진 원본은 과거 매핑으로 표시해야 한다')
assert(oldMap?.styleCount === 0, '사라진 원본의 사용 수는 0이어야 한다')

const changes = packingSizeMapChanges(rows, {
  '35*45': 'L',
  'b-118': 'M',
  '예전 규격': '',
})
assert(changes.length === 2, '실제로 달라진 매핑만 저장해야 한다')
assert(
  changes.some(
    (change) =>
      change.sourceValue === '35*45' && change.displayValue === 'L',
  ),
  '새 간단 표시값을 저장해야 한다',
)
assert(
  changes.some(
    (change) =>
      change.sourceValue === '예전 규격' && change.displayValue === '',
  ),
  '비운 표시값은 매핑 제거 요청으로 남겨야 한다',
)
assert(JSON.stringify(sources) === sourceSnapshot, '원본 고유값을 바꾸면 안 된다')
assert(JSON.stringify(maps) === mapSnapshot, '저장 매핑 입력을 바꾸면 안 된다')

console.log('verify:packing-size-map ok')
