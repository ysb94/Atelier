import assert from 'node:assert/strict'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  normalizeUsageCodeColumns,
  usageCodeColumnError,
  usageCodeHeaderIndex,
  usageCodeTemplateLabels,
  type UsageCodeColumn,
} from './usage-code-columns.ts'

const columns = DEFAULT_USAGE_CODE_COLUMNS.map((column, index) => ({
  ...column,
  id: `col-${index}`,
}))

assert.deepEqual(usageCodeTemplateLabels(columns), [
  '88코드',
  '코드명',
  '상태',
  '상품명',
  'M번호',
])
assert.deepEqual(usageCodeTemplateLabels([]), [
  '88코드',
  '코드명',
  '상태',
  '상품명',
  'M번호',
])

assert.equal(usageCodeColumnError(columns), null)
assert.equal(
  usageCodeColumnError(columns.filter((column) => column.systemKey !== 'code')),
  '88코드 헤더는 빼지 마세요.',
)
assert.equal(
  usageCodeColumnError(columns.filter((column) => column.systemKey !== 'status')),
  '상태 헤더는 빼지 마세요.',
)
assert.equal(
  usageCodeColumnError([
    ...columns,
    { id: 'dup', systemKey: null, label: '88코드', sortOrder: 9 },
  ]),
  '같은 이름의 헤더가 있습니다.',
)

const renamed: UsageCodeColumn[] = columns.map((column) =>
  column.systemKey === 'code'
    ? { ...column, label: '바코드번호' }
    : column.systemKey === 'status'
      ? { ...column, label: '진행 상태' }
      : column,
)
const header = ['메모', '진행 상태', '바코드번호', 'M번호']
assert.equal(usageCodeHeaderIndex(header, renamed, 'code'), 2)
assert.equal(usageCodeHeaderIndex(header, renamed, 'status'), 1)
assert.equal(usageCodeHeaderIndex(['EAN', 'Status'], undefined, 'code'), 0)
assert.equal(usageCodeHeaderIndex(['EAN', 'Status'], undefined, 'status'), 1)

const normalized = normalizeUsageCodeColumns([
  { id: 'b', systemKey: 'status', label: ' 상태 ', sortOrder: 3 },
  { id: 'a', systemKey: 'code', label: '88코드', sortOrder: 1 },
  { id: 'empty', systemKey: null, label: '   ', sortOrder: 0 },
])
assert.deepEqual(
  normalized.map((column) => column.label),
  ['88코드', '상태'],
)
assert.deepEqual(
  normalized.map((column) => column.sortOrder),
  [0, 1],
)

console.log('usage-code-columns verify ok')
