import assert from 'node:assert/strict'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  usageCodeHeaderIndex,
  usageColumnsError,
  usageValueError,
  type UsageCodeColumn,
} from './usage-code-columns'
import { prepareUsageRows } from './usage-import'
import { usageColumnText } from './usage-code-display'
import type { ProductCode } from '@/lib/types'

const columns = DEFAULT_USAGE_CODE_COLUMNS.map((c) => ({
  ...c,
  label:
    c.sourceKey === 'code'
      ? '우리 코드'
      : c.sourceKey === 'status'
        ? '판매 상태'
        : c.label,
}))
const extra: UsageCodeColumn = {
  id: '30000000-0000-4000-8000-000000000001',
  kind: 'private',
  sourceKey: null,
  label: '상품 메모',
  description: '업체 메모',
  valueType: 'text',
  visible: true,
  sortOrder: 5,
}
const code = {
  id: 'code-a',
  kind: 'own',
  code: '8801234000015',
  name: '원본 코드명',
  components: [
    { styleId: 'sku-s', styleNo: 'M001-BLACK-S', qty: 2 },
    { styleId: 'sku-m', styleNo: 'M002-BLACK-M', qty: 1 },
  ],
} as ProductCode
const before = JSON.stringify(code)
const rows = prepareUsageRows({
  rows: [
    ['우리 코드', '판매 상태', '상품 메모'],
    [code.code, '일시중지', '원본을 바꾸면 안 됨'],
  ],
  columns: [...columns, extra],
  ownCodes: [code],
  existingByCodeId: new Map([[code.id, 'active']]),
})
assert.equal(rows[0].productCodeId, code.id)
assert.equal(rows[0].status, 'paused')
assert.equal(JSON.stringify(code), before)
const privateAlias = { ...extra, label: '상태' }
assert.equal(
  usageCodeHeaderIndex(
    ['우리 코드', '상태'],
    [...columns, privateAlias],
    'status',
  ),
  -1,
)
assert.match(
  usageColumnsError([...columns, { ...extra, label: '판매_상태' }]) ?? '',
  /엑셀/,
)
const missing = prepareUsageRows({
  rows: [
    ['품번', '상품명'],
    [code.code, '무관한 값'],
  ],
  columns,
  ownCodes: [code],
  existingByCodeId: new Map(),
})
assert.equal(missing[0].statusLabel, 'error')
assert.equal(
  usageColumnText(
    columns.find((c) => c.sourceKey === 'styleNo')!,
    code,
    'active',
    new Map(),
  ),
  'M001-BLACK-S ×2\nM002-BLACK-M',
)
assert.equal(
  usageColumnText(extra, code, 'active', new Map(), { [extra.id]: 0 }),
  '0',
)
assert.notEqual(
  usageValueError({ ...extra, valueType: 'date' }, '0000-02-29'),
  null,
)
console.log(
  'PASS import/source binding: configured headers, extra-column isolation, ambiguous alias rejection, missing-code rejection, multi-SKU quantities, zero and calendar validation',
)
