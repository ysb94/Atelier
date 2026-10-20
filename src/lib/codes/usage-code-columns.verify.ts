/**
 * 사용처 코드 항목의 기본값·검증·값 해석.
 * 실행: npx tsx src/lib/codes/usage-code-columns.verify.ts
 */
import assert from 'node:assert/strict'
import type { UsageCodeColumn, UsageValueType } from './usage-code-columns'
import {
  DEFAULT_USAGE_CODE_COLUMNS,
  USAGE_SOURCE_LABELS,
  formatUsageValue,
  legacyUsageColumns,
  normalizeUsageColumns,
  parseUsageValue,
  usageCodeHeaderIndex,
  usageColumnsError,
  usageValueError,
} from './usage-code-columns'

const PRIVATE_ID = '00000000-0000-4000-8000-000000000010'
const LEGACY_ID = '00000000-0000-4000-8000-000000000011'
const EXTRA_ID = '00000000-0000-4000-8000-000000000012'

function cloneDefaults(): UsageCodeColumn[] {
  return legacyUsageColumns([])
}

function expectError(
  columns: UsageCodeColumn[],
  pattern: RegExp,
  previous?: UsageCodeColumn[],
) {
  const message = usageColumnsError(columns, previous)
  assert.equal(typeof message, 'string')
  assert.match(message ?? '', pattern)
}

function privateField(
  id: string,
  label: string,
  valueType: UsageValueType,
  sortOrder: number,
): UsageCodeColumn {
  return {
    id,
    kind: 'private',
    sourceKey: null,
    label,
    description: '업체에서 사용하는 값',
    valueType,
    visible: true,
    sortOrder,
  }
}

assert.deepEqual(
  (
    Object.keys(USAGE_SOURCE_LABELS) as Array<keyof typeof USAGE_SOURCE_LABELS>
  ).sort(),
  ['code', 'name', 'productName', 'status', 'styleNo'],
)
assert.match(USAGE_SOURCE_LABELS.code, /88코드/)
assert.match(USAGE_SOURCE_LABELS.name, /코드명/)
assert.match(USAGE_SOURCE_LABELS.status, /상태/)
assert.match(USAGE_SOURCE_LABELS.productName, /상품명/)
assert.match(USAGE_SOURCE_LABELS.styleNo, /M번호/)

const defaults = cloneDefaults()
const again = cloneDefaults()
assert.notEqual(defaults, DEFAULT_USAGE_CODE_COLUMNS)
assert.notEqual(defaults, again)
assert.notEqual(defaults[0], DEFAULT_USAGE_CODE_COLUMNS[0])
assert.notEqual(defaults[0], again[0])
assert.deepEqual(
  defaults.map((column) => ({
    id: column.id,
    kind: column.kind,
    sourceKey: column.sourceKey,
    label: column.label,
    valueType: column.valueType,
    visible: column.visible,
    sortOrder: column.sortOrder,
  })),
  [
    {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'common',
      sourceKey: 'code',
      label: '88코드',
      valueType: 'text',
      visible: true,
      sortOrder: 0,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      kind: 'common',
      sourceKey: 'name',
      label: '코드명',
      valueType: 'text',
      visible: true,
      sortOrder: 1,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      kind: 'operation',
      sourceKey: 'status',
      label: '상태',
      valueType: 'text',
      visible: true,
      sortOrder: 2,
    },
    {
      id: '00000000-0000-4000-8000-000000000004',
      kind: 'common',
      sourceKey: 'productName',
      label: '상품명',
      valueType: 'text',
      visible: true,
      sortOrder: 3,
    },
    {
      id: '00000000-0000-4000-8000-000000000005',
      kind: 'common',
      sourceKey: 'styleNo',
      label: 'M번호',
      valueType: 'text',
      visible: true,
      sortOrder: 4,
    },
  ],
)
for (const column of defaults) {
  assert.equal(column.description.trim().length > 0, true)
  assert.equal(column.kind === 'private', false)
}
assert.equal(usageColumnsError(defaults), null)

defaults[0]!.label = 'A코드'
again[1]!.description = 'B설명'
assert.equal(DEFAULT_USAGE_CODE_COLUMNS[0]!.label, '88코드')
assert.equal(again[0]!.label, '88코드')
assert.match(defaults[1]!.description, /코드명/)

const partnerA = legacyUsageColumns([
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    system_key: 'code',
    label: 'A코드',
    sort_order: 1,
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    system_key: null,
    label: 'A메모',
    sort_order: 2,
  },
])
const partnerB = legacyUsageColumns([
  {
    id: '00000000-0000-4000-8000-0000000000b1',
    system_key: 'code',
    label: 'B코드',
    sort_order: 4,
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2',
    system_key: 'custom',
    label: 'B메모',
    sort_order: 5,
  },
])
partnerA[1]!.label = '변경'
assert.equal(partnerB[1]!.label, 'B메모')
assert.equal(partnerA[0]!.id, '00000000-0000-4000-8000-0000000000a1')
assert.equal(partnerA[0]!.kind, 'common')
assert.equal(partnerA[0]!.sourceKey, 'code')
assert.equal(partnerA[1]!.kind, 'legacy')
assert.equal(partnerA[1]!.sourceKey, null)
assert.equal(partnerB[0]!.sortOrder, 4)
assert.equal(partnerB[1]!.kind, 'legacy')
assert.equal(partnerB[1]!.sourceKey, null)
assert.equal(partnerB[1]!.label, 'B메모')

const preserved = legacyUsageColumns([
  {
    id: '00000000-0000-4000-8000-0000000000c1',
    system_key: 'product_name',
    label: '상품',
    sort_order: 3,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c2',
    system_key: 'productName',
    label: '상품명 열',
    sort_order: 7,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c3',
    system_key: 'status',
    label: '현황',
    sort_order: 8,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c4',
    system_key: 'styleNo',
    label: 'M',
    sort_order: 9,
  },
  {
    id: '00000000-0000-4000-8000-0000000000c5',
    system_key: 'name',
    label: '이름표',
    sort_order: 6,
  },
])
assert.deepEqual(
  preserved.map((column) => [
    column.id,
    column.kind,
    column.sourceKey,
    column.label,
    column.sortOrder,
  ]),
  [
    ['00000000-0000-4000-8000-0000000000c1', 'legacy', null, '상품', 3],
    [
      '00000000-0000-4000-8000-0000000000c2',
      'common',
      'productName',
      '상품명 열',
      7,
    ],
    ['00000000-0000-4000-8000-0000000000c3', 'operation', 'status', '현황', 8],
    ['00000000-0000-4000-8000-0000000000c4', 'common', 'styleNo', 'M', 9],
    ['00000000-0000-4000-8000-0000000000c5', 'common', 'name', '이름표', 6],
  ],
)
assert.equal(
  preserved.every((column) => column.valueType === 'text' && column.visible),
  true,
)

const original = cloneDefaults()
const codeId = original.find((column) => column.sourceKey === 'code')!.id
const renamed = original.map((column) => {
  if (column.sourceKey === 'code') return { ...column, label: '자사코드' }
  if (column.sourceKey === 'status') return { ...column, label: '운영상태' }
  return column
})
assert.equal(usageColumnsError(renamed, original), null)
const renamedCode = renamed.find((column) => column.sourceKey === 'code')
assert.equal(renamedCode?.id, codeId)
assert.equal(renamedCode?.sourceKey, 'code')
assert.equal(renamedCode?.kind, 'common')
assert.equal(
  normalizeUsageColumns(renamed).find((column) => column.id === codeId)
    ?.sourceKey,
  'code',
)

const messy = cloneDefaults().map((column, index) => ({
  ...column,
  label: `  ${column.label}  `,
  description: `  ${column.description}  `,
  sortOrder: 100 - index,
}))
const messyBefore = messy.map((column) => ({ ...column }))
const ordered = normalizeUsageColumns(messy)
assert.deepEqual(messy, messyBefore)
assert.notEqual(ordered[0], messy[0])
assert.deepEqual(
  ordered.map((column) => column.sortOrder),
  [0, 1, 2, 3, 4],
)
assert.deepEqual(
  ordered.map((column) => column.sourceKey),
  ['styleNo', 'productName', 'status', 'name', 'code'],
)
assert.equal(ordered[0]!.label, 'M번호')
assert.equal(ordered[0]!.description.includes('  '), false)

const blanked = cloneDefaults().map((column) =>
  column.sourceKey === 'name' ? { ...column, label: ' \t ' } : column,
)
const keptBlank = normalizeUsageColumns(blanked)
assert.equal(keptBlank.length, blanked.length)
assert.equal(keptBlank.find((column) => column.sourceKey === 'name')?.label, '')
expectError(keptBlank, /이름/)

const gapped = cloneDefaults().map((column, index) => ({
  ...column,
  sortOrder: (index + 1) * 10,
}))
assert.equal(usageColumnsError(gapped), null)
expectError(
  cloneDefaults().map((column, index) =>
    index === 0 ? { ...column, sortOrder: -1 } : column,
  ),
  /정렬/,
)
expectError(
  cloneDefaults().map((column, index) =>
    index === 0 ? { ...column, sortOrder: 1.5 } : column,
  ),
  /정렬/,
)

const trimmedDuplicate = cloneDefaults().map((column) =>
  column.sourceKey === 'name' ? { ...column, label: '  88코드  ' } : column,
)
expectError(trimmedDuplicate, /같은 항목 이름이 중복됩니다/)

const base = cloneDefaults()
const previous = [
  ...base,
  privateField(PRIVATE_ID, '단가', 'number', 5),
  {
    id: LEGACY_ID,
    kind: 'legacy' as const,
    sourceKey: null,
    label: '예전 메모',
    description: '이전 시스템',
    valueType: 'text' as const,
    visible: true,
    sortOrder: 6,
  },
]
const hiddenPrivate = previous.map((column) =>
  column.id === PRIVATE_ID ? { ...column, visible: false } : column,
)
assert.equal(usageColumnsError(hiddenPrivate, previous), null)
assert.equal(
  hiddenPrivate.find((column) => column.id === PRIVATE_ID)?.visible,
  false,
)
assert.equal(
  hiddenPrivate.some((column) => column.id === PRIVATE_ID),
  true,
)

const removedPrivate = previous.filter((column) => column.id !== PRIVATE_ID)
expectError(removedPrivate, /삭제할 수 없습니다/, previous)

const replacedCode = base.map((column) =>
  column.sourceKey === 'code'
    ? { ...column, id: '00000000-0000-4000-8000-0000000000ff' }
    : column,
)
expectError(replacedCode, /삭제할 수 없습니다/, base)

const toPrivate = base.map((column) =>
  column.sourceKey === 'styleNo'
    ? { ...column, kind: 'private' as const, sourceKey: null }
    : column,
)
assert.equal(
  toPrivate.find((column) => column.label === 'M번호')?.kind,
  'private',
)
expectError(toPrivate, /바꿀 수 없습니다/, base)

const swapped = base.map((column) => {
  if (column.sourceKey === 'name')
    return { ...column, sourceKey: 'productName' as const }
  if (column.sourceKey === 'productName')
    return { ...column, sourceKey: 'name' as const }
  return column
})
expectError(swapped, /바꿀 수 없습니다/, base)

const typeChanged = previous.map((column) =>
  column.id === PRIVATE_ID ? { ...column, valueType: 'text' as const } : column,
)
expectError(typeChanged, /바꿀 수 없습니다/, previous)
expectError(
  base.map((column) =>
    column.sourceKey === 'name'
      ? { ...column, valueType: 'number' as const }
      : column,
  ),
  /글자만/,
  base,
)

const legacyEdited = previous.map((column) =>
  column.id === LEGACY_ID
    ? { ...column, label: '보관 메모', visible: false, description: '숨김' }
    : column,
)
assert.equal(usageColumnsError(legacyEdited, previous), null)
const legacyConverted = previous.map((column) =>
  column.id === LEGACY_ID ? { ...column, kind: 'private' as const } : column,
)
expectError(legacyConverted, /바꿀 수 없습니다/, previous)

expectError(
  base.map((column) =>
    column.sourceKey === 'code' ? { ...column, visible: false } : column,
  ),
  /88코드 항목은 숨길 수 없습니다/,
)
expectError(
  base.filter((column) => column.sourceKey !== 'status'),
  /상태 항목이 필요합니다/,
)
expectError(
  base.map((column) =>
    column.sourceKey === 'status' ? { ...column, visible: false } : column,
  ),
  /상태 항목은 숨길 수 없습니다/,
)
expectError(
  [
    ...base,
    {
      ...base[0]!,
      id: '00000000-0000-4000-8000-000000000099',
      label: '다른 코드',
    },
  ],
  /같은 출처가 중복됩니다/,
)
expectError(
  [
    ...base,
    {
      ...base[1]!,
      id: EXTRA_ID,
      label: '다른 코드명',
    },
  ],
  /같은 출처가 중복됩니다/,
)

const uppercased = base.map((column) => ({
  ...column,
  id: column.id.toUpperCase(),
}))
assert.equal(usageColumnsError(uppercased, base), null)
expectError(
  [
    base[0]!,
    { ...base[0]!, id: base[0]!.id.toUpperCase(), label: '다른 이름' },
    ...base.slice(1),
  ],
  /같은 항목 ID가 중복됩니다/,
)
expectError(
  base.map((column, index) =>
    index === 0 ? { ...column, id: 'not-a-uuid' } : column,
  ),
  /ID 형식/,
)
expectError([], /항목이 없습니다/)
expectError(
  Array.from({ length: 101 }, () => cloneDefaults()[0]!),
  /100개/,
)
expectError(
  [
    ...cloneDefaults(),
    { ...privateField(PRIVATE_ID, '업체명', 'text', 5), description: '' },
  ],
  /의미/,
)
expectError(
  base.map((column, index) =>
    index === 4 ? { ...column, label: '가'.repeat(41) } : column,
  ),
  /1~40자/,
)
assert.equal(
  usageColumnsError(
    base.map((column, index) =>
      index === 4 ? { ...column, label: ` ${'가'.repeat(40)} ` } : column,
    ),
  ),
  null,
)
expectError(
  base.map((column, index) =>
    index === 0 ? { ...column, description: '가'.repeat(501) } : column,
  ),
  /500자/,
)

const price = privateField(PRIVATE_ID, '단가', 'number', 5)
const memo = privateField(EXTRA_ID, '메모', 'text', 6)
const opened = privateField(
  '00000000-0000-4000-8000-000000000013',
  '시작일',
  'date',
  7,
)
const withPrivate = [...cloneDefaults(), price, memo]
assert.equal(usageColumnsError(withPrivate), null)
assert.equal(parseUsageValue(price, '0'), 0)
assert.equal(parseUsageValue(price, '0.0'), 0)
assert.equal(parseUsageValue(price, '  0  '), 0)
assert.equal(parseUsageValue(price, '+0'), 0)
const negativeZero = parseUsageValue(price, '-0')
assert.equal(negativeZero, 0)
assert.equal(Object.is(negativeZero, -0), false)
assert.equal(parseUsageValue(price, ''), null)
assert.equal(parseUsageValue(price, '   '), null)
assert.notEqual(parseUsageValue(price, '0'), parseUsageValue(price, ''))
assert.equal(parseUsageValue(price, '-3.5'), -3.5)
assert.equal(parseUsageValue(price, '+2'), 2)
assert.equal(formatUsageValue(0), '0')
assert.equal(formatUsageValue(-0), '0')
assert.equal(formatUsageValue(parseUsageValue(price, '0')), '0')
assert.equal(formatUsageValue(null), '미등록')
assert.equal(formatUsageValue(undefined), '미등록')
assert.equal(formatUsageValue(parseUsageValue(price, ' ')), '미등록')
assert.notEqual(formatUsageValue(0), formatUsageValue(null))
for (const input of [
  'Infinity',
  '-Infinity',
  '+Infinity',
  'NaN',
  'nan',
  '0x10',
  '0XFF',
  '1e2',
  '1E+2',
  '9'.repeat(400),
]) {
  assert.match(usageValueError(price, input) ?? '', /10진수/, input)
  assert.throws(() => parseUsageValue(price, input), /10진수/)
}

assert.equal(parseUsageValue(opened, '2024-02-29'), '2024-02-29')
assert.equal(parseUsageValue(opened, ' 2024-02-29 '), '2024-02-29')
assert.equal(usageValueError(opened, '2000-02-29'), null)
assert.equal(parseUsageValue(opened, ''), null)
for (const input of [
  '2023-02-29',
  '1900-02-29',
  '2100-02-29',
  '2024-02-30',
  '2024-04-31',
  '2024-13-01',
  '2024-02-29T00:00:00',
  '2024/02/29',
  '02-29-2024',
]) {
  assert.match(usageValueError(opened, input) ?? '', /YYYY-MM-DD/, input)
  assert.throws(() => parseUsageValue(opened, input))
}

assert.equal(parseUsageValue(memo, '   '), null)
assert.equal(parseUsageValue(memo, '  메모  '), '메모')
assert.equal(usageValueError(memo, 'a'.repeat(4000)), null)
assert.match(usageValueError(memo, 'a'.repeat(4001)) ?? '', /4000/)
assert.equal(formatUsageValue('그대로'), '그대로')
assert.equal(formatUsageValue(''), '')
assert.equal(formatUsageValue('0'), '0')
assert.throws(() => formatUsageValue({ value: 1 }))
assert.throws(() => formatUsageValue([0]))
assert.throws(() => formatUsageValue(true))
assert.throws(() => formatUsageValue(Number.POSITIVE_INFINITY))
assert.throws(() => formatUsageValue(Number.NaN))

for (const column of cloneDefaults()) {
  assert.match(usageValueError(column, '값') ?? '', /직접 고칠 수 없습니다/)
  assert.throws(() => parseUsageValue(column, '값'))
}
assert.match(usageValueError(preserved[0]!, '값') ?? '', /예전 항목/)

assert.equal(
  usageCodeHeaderIndex(['상품명', '88코드', '상태'], cloneDefaults(), 'code'),
  1,
)
assert.equal(
  usageCodeHeaderIndex(['상품명', '88코드', '상태'], cloneDefaults(), 'status'),
  2,
)
assert.equal(
  usageCodeHeaderIndex(['바코드', '88코드'], cloneDefaults(), 'code'),
  1,
)
assert.equal(
  usageCodeHeaderIndex(['status', '상태'], cloneDefaults(), 'status'),
  1,
)
assert.equal(
  usageCodeHeaderIndex(['메모', '코드', 'barcode'], cloneDefaults(), 'code'),
  1,
)
assert.equal(
  usageCodeHeaderIndex(['BAR-CODE', '메모'], cloneDefaults(), 'code'),
  0,
)
assert.equal(
  usageCodeHeaderIndex(['메모', '사용_상태'], cloneDefaults(), 'status'),
  1,
)
assert.equal(usageCodeHeaderIndex(['(Status)'], cloneDefaults(), 'status'), 0)
assert.equal(usageCodeHeaderIndex(['EAN'], cloneDefaults(), 'code'), 0)
assert.equal(usageCodeHeaderIndex(['메모'], cloneDefaults(), 'code'), -1)
assert.equal(usageCodeHeaderIndex(['메모'], cloneDefaults(), 'status'), -1)

assert.equal(
  usageCodeHeaderIndex(['barcode', '자사코드', '운영상태'], renamed, 'code'),
  1,
)
assert.equal(usageCodeHeaderIndex(['메모', '자사 코드'], renamed, 'code'), 1)
assert.equal(usageCodeHeaderIndex(['메모', '운영상태'], renamed, 'status'), 1)
assert.equal(usageCodeHeaderIndex(['BAR CODE', '메모'], renamed, 'code'), 0)
assert.equal(usageCodeHeaderIndex(['메모', '사용 상태'], renamed, 'status'), 1)
assert.equal(usageColumnsError(renamed, original), null)

console.log('usage-code-columns.verify ok')
