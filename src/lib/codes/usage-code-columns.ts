export const USAGE_CODE_SYSTEM_KEYS = [
  'code',
  'name',
  'status',
  'productName',
  'styleNo',
] as const

export type UsageCodeSystemKey = (typeof USAGE_CODE_SYSTEM_KEYS)[number]

export type UsageCodeColumn = {
  id: string
  systemKey: UsageCodeSystemKey | null
  label: string
  sortOrder: number
}

export const USAGE_CODE_LOCKED_KEYS = new Set<UsageCodeSystemKey>(['code', 'status'])

const CODE_HEADER_ALIASES = ['88코드', '바코드', '코드', 'ean', 'barcode', 'code']
const STATUS_HEADER_ALIASES = ['상태', 'status', '사용상태']

function compactHeader(value: string) {
  return value.toLowerCase().replace(/[\s_\-/().]/g, '').trim()
}

export const DEFAULT_USAGE_CODE_COLUMNS: Array<Omit<UsageCodeColumn, 'id'>> = [
  { systemKey: 'code', label: '88코드', sortOrder: 0 },
  { systemKey: 'name', label: '코드명', sortOrder: 1 },
  { systemKey: 'status', label: '상태', sortOrder: 2 },
  { systemKey: 'productName', label: '상품명', sortOrder: 3 },
  { systemKey: 'styleNo', label: 'M번호', sortOrder: 4 },
]

export function isUsageCodeSystemKey(value: string | null): value is UsageCodeSystemKey {
  return USAGE_CODE_SYSTEM_KEYS.includes(value as UsageCodeSystemKey)
}

export function usageCodeColumnLocked(column: Pick<UsageCodeColumn, 'systemKey'>) {
  return column.systemKey != null && USAGE_CODE_LOCKED_KEYS.has(column.systemKey)
}

export function normalizeUsageCodeColumns(columns: UsageCodeColumn[]): UsageCodeColumn[] {
  return [...columns]
    .map((column) => ({ ...column, label: column.label.trim() }))
    .filter((column) => column.label.length > 0)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, 'ko'))
    .map((column, index) => ({ ...column, sortOrder: index }))
}

export function usageCodeColumnError(columns: UsageCodeColumn[]): string | null {
  const labels = columns.map((column) => column.label.trim()).filter(Boolean)
  if (new Set(labels).size !== labels.length) return '같은 이름의 헤더가 있습니다.'
  for (const key of USAGE_CODE_LOCKED_KEYS) {
    if (!columns.some((column) => column.systemKey === key && column.label.trim())) {
      return key === 'code' ? '88코드 헤더는 빼지 마세요.' : '상태 헤더는 빼지 마세요.'
    }
  }
  return null
}

export function usageCodeTemplateLabels(
  columns: Array<Pick<UsageCodeColumn, 'label'>>,
) {
  const source = columns.length > 0 ? columns : DEFAULT_USAGE_CODE_COLUMNS
  return source.map((column) => column.label)
}

/** 등록 양식에서 88코드·상태 열을 찾는다. 헤더 설정에서 바꾼 이름을 먼저 본다. */
export function usageCodeHeaderIndex(
  headerCells: string[],
  columns: Array<Pick<UsageCodeColumn, 'systemKey' | 'label'>> | undefined,
  key: 'code' | 'status',
) {
  const header = headerCells.map(compactHeader)
  const configured = columns?.find((column) => column.systemKey === key)?.label
  const labels = [
    configured,
    ...(key === 'code' ? CODE_HEADER_ALIASES : STATUS_HEADER_ALIASES),
  ]
  for (const label of labels) {
    if (!label?.trim()) continue
    const wanted = compactHeader(label)
    const index = header.findIndex((cell) => cell === wanted)
    if (index >= 0) return index
  }
  return -1
}
