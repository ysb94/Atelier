/**
 * 사용처별 코드 표의 항목 정의와 개별 값 검증.
 * 공통·작업 항목의 뜻은 유지하고, 모르는 예전 항목은 읽기 전용으로 남긴다.
 */

export type UsageSourceKey =
  'code' | 'name' | 'status' | 'productName' | 'styleNo'

export type UsageColumnKind = 'common' | 'private' | 'operation' | 'legacy'

export type UsageValueType = 'text' | 'number' | 'date'

export type UsageCodeColumn = {
  id: string
  kind: UsageColumnKind
  sourceKey: UsageSourceKey | null
  label: string
  description: string
  valueType: UsageValueType
  visible: boolean
  sortOrder: number
}

export type UsagePrivateValue = string | number | null

export const USAGE_SOURCE_LABELS: Record<UsageSourceKey, string> = {
  code: '바코드 마스터 > 88코드',
  name: '바코드 마스터 > 코드명',
  status: '사용처 > 상태',
  productName: '상품 > 상품명',
  styleNo: '상품 > M번호',
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DECIMAL_PATTERN = /^[+-]?\d+(?:\.\d+)?$/

const CODE_HEADER_ALIASES = [
  '88코드',
  '바코드',
  '코드',
  'ean',
  'barcode',
  'code',
] as const

const STATUS_HEADER_ALIASES = ['상태', 'status', '사용상태'] as const

const DEFAULT_COLUMN_LIST: UsageCodeColumn[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'common',
    sourceKey: 'code',
    label: '88코드',
    description: '바코드 마스터에 등록된 88코드입니다.',
    valueType: 'text',
    visible: true,
    sortOrder: 0,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    kind: 'common',
    sourceKey: 'name',
    label: '코드명',
    description: '바코드 마스터의 코드명입니다.',
    valueType: 'text',
    visible: true,
    sortOrder: 1,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'operation',
    sourceKey: 'status',
    label: '상태',
    description: '사용처 연결의 사용 상태입니다.',
    valueType: 'text',
    visible: true,
    sortOrder: 2,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    kind: 'common',
    sourceKey: 'productName',
    label: '상품명',
    description: '연결된 상품의 상품명입니다.',
    valueType: 'text',
    visible: true,
    sortOrder: 3,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    kind: 'common',
    sourceKey: 'styleNo',
    label: 'M번호',
    description: '연결된 상품의 M번호입니다.',
    valueType: 'text',
    visible: true,
    sortOrder: 4,
  },
]

for (const column of DEFAULT_COLUMN_LIST) Object.freeze(column)

export const DEFAULT_USAGE_CODE_COLUMNS: UsageCodeColumn[] = Object.freeze(
  DEFAULT_COLUMN_LIST,
) as UsageCodeColumn[]

function cloneUsageColumn(column: UsageCodeColumn): UsageCodeColumn {
  return {
    id: column.id,
    kind: column.kind,
    sourceKey: column.sourceKey,
    label: column.label,
    description: column.description,
    valueType: column.valueType,
    visible: column.visible,
    sortOrder: column.sortOrder,
  }
}

function legacySource(systemKey: string | null): {
  kind: UsageColumnKind
  sourceKey: UsageSourceKey | null
} {
  if (systemKey === 'code') return { kind: 'common', sourceKey: 'code' }
  if (systemKey === 'name') return { kind: 'common', sourceKey: 'name' }
  if (systemKey === 'status') return { kind: 'operation', sourceKey: 'status' }
  if (systemKey === 'productName')
    return { kind: 'common', sourceKey: 'productName' }
  if (systemKey === 'styleNo') return { kind: 'common', sourceKey: 'styleNo' }
  return { kind: 'legacy', sourceKey: null }
}

export function legacyUsageColumns(
  rows: Array<{
    id: string
    system_key: string | null
    label: string
    sort_order: number
  }>,
): UsageCodeColumn[] {
  if (rows.length === 0) {
    return DEFAULT_USAGE_CODE_COLUMNS.map(cloneUsageColumn)
  }

  return rows.map((row) => {
    const source = legacySource(row.system_key)
    return {
      id: row.id,
      kind: source.kind,
      sourceKey: source.sourceKey,
      label: row.label,
      description: '',
      valueType: 'text',
      visible: true,
      sortOrder: row.sort_order,
    }
  })
}

export function normalizeUsageColumns(
  columns: UsageCodeColumn[],
): UsageCodeColumn[] {
  const ordered = columns.map((column, index) => ({
    index,
    column: {
      id: column.id,
      kind: column.kind,
      sourceKey: column.sourceKey,
      label: column.label.trim(),
      description: column.description.trim(),
      valueType: column.valueType,
      visible: column.visible,
      sortOrder: column.sortOrder,
    },
  }))
  ordered.sort(
    (left, right) =>
      left.column.sortOrder - right.column.sortOrder ||
      left.index - right.index,
  )
  return ordered.map(({ column }, index) => ({
    ...column,
    sortOrder: index,
  }))
}

function isSourceKey(value: unknown): value is UsageSourceKey {
  return (
    value === 'code' ||
    value === 'name' ||
    value === 'status' ||
    value === 'productName' ||
    value === 'styleNo'
  )
}

function isColumnKind(value: unknown): value is UsageColumnKind {
  return (
    value === 'common' ||
    value === 'private' ||
    value === 'operation' ||
    value === 'legacy'
  )
}

function isValueType(value: unknown): value is UsageValueType {
  return value === 'text' || value === 'number' || value === 'date'
}

function columnCombinationError(
  column: UsageCodeColumn,
  label: string,
): string | null {
  if (!isColumnKind(column.kind)) {
    return `항목 종류를 확인할 수 없습니다. (${label || column.id})`
  }
  if (!isValueType(column.valueType)) {
    return `값 형식을 확인할 수 없습니다. (${label || column.id})`
  }
  if (column.sourceKey !== null && !isSourceKey(column.sourceKey)) {
    return `출처를 확인할 수 없습니다. (${label || column.id})`
  }

  if (column.kind === 'common') {
    if (column.valueType !== 'text') {
      return `공통 항목은 글자만 사용할 수 있습니다. (${label || column.id})`
    }
    if (
      column.sourceKey !== 'code' &&
      column.sourceKey !== 'name' &&
      column.sourceKey !== 'productName' &&
      column.sourceKey !== 'styleNo'
    ) {
      return `공통 항목의 출처가 올바르지 않습니다. (${label || column.id})`
    }
    return null
  }

  if (column.kind === 'operation') {
    if (column.valueType !== 'text') {
      return `작업 항목은 글자만 사용할 수 있습니다. (${label || column.id})`
    }
    if (column.sourceKey !== 'status') {
      return `작업 항목의 출처는 상태만 사용할 수 있습니다. (${label || column.id})`
    }
    return null
  }

  if (column.sourceKey !== null) {
    return `개별 항목과 예전 항목에는 출처를 둘 수 없습니다. (${label || column.id})`
  }
  return null
}

function requiredSourceError(
  columns: UsageCodeColumn[],
  sourceKey: 'code' | 'status',
  kind: 'common' | 'operation',
  name: string,
): string | null {
  const found = columns.filter((column) => column.sourceKey === sourceKey)
  const column = found[0]
  if (
    found.length !== 1 ||
    !column ||
    column.kind !== kind ||
    column.valueType !== 'text'
  ) {
    return `${name} 항목이 필요합니다.`
  }
  if (column.visible !== true) {
    return `${name} 항목은 숨길 수 없습니다.`
  }
  return null
}

export function usageColumnsError(
  columns: UsageCodeColumn[],
  previous: UsageCodeColumn[] = [],
): string | null {
  if (!Array.isArray(columns) || columns.length === 0) return '항목이 없습니다.'
  if (columns.length > 100)
    return '한 업체에는 항목을 100개까지 설정할 수 있습니다.'

  const seenIds = new Set<string>()
  const seenLabels = new Set<string>()
  const seenImportLabels = new Set<string>()
  const seenSources = new Set<UsageSourceKey>()

  for (const column of columns) {
    if (!column || typeof column !== 'object')
      return '항목을 확인할 수 없습니다.'
    if (typeof column.id !== 'string' || !UUID_PATTERN.test(column.id)) {
      return '항목 ID 형식이 올바르지 않습니다.'
    }
    const idKey = column.id.toLowerCase()
    if (seenIds.has(idKey)) return `같은 항목 ID가 중복됩니다. (${column.id})`
    seenIds.add(idKey)

    if (typeof column.label !== 'string')
      return '항목 이름이 올바르지 않습니다.'
    const label = column.label.trim()
    if (label.length < 1 || label.length > 40) {
      return `항목 이름은 1~40자여야 합니다. (${column.id})`
    }
    if (seenLabels.has(label)) return `같은 항목 이름이 중복됩니다. (${label})`
    seenLabels.add(label)
    const importLabel = normalizeUsageHeader(label)
    if (!importLabel || seenImportLabels.has(importLabel))
      return '엑셀에서 구분할 수 있는 서로 다른 헤더 이름을 사용하세요.'
    seenImportLabels.add(importLabel)

    if (typeof column.description !== 'string')
      return '항목 설명이 올바르지 않습니다.'
    if (column.description.trim().length > 500) {
      return `항목 설명은 500자 이하여야 합니다. (${label})`
    }
    if (column.kind === 'private' && !column.description.trim()) {
      return `업체 전용 항목의 의미를 입력하세요. (${label})`
    }
    if (typeof column.visible !== 'boolean')
      return '표시 여부가 올바르지 않습니다.'
    if (!Number.isInteger(column.sortOrder) || column.sortOrder < 0) {
      return '정렬 순서는 0 이상의 정수여야 합니다.'
    }

    const combinationError = columnCombinationError(column, label)
    if (combinationError) return combinationError

    if (column.sourceKey) {
      if (seenSources.has(column.sourceKey)) {
        return `같은 출처가 중복됩니다. (${USAGE_SOURCE_LABELS[column.sourceKey]})`
      }
      seenSources.add(column.sourceKey)
    }
  }

  const codeError = requiredSourceError(columns, 'code', 'common', '88코드')
  if (codeError) return codeError
  const statusError = requiredSourceError(
    columns,
    'status',
    'operation',
    '상태',
  )
  if (statusError) return statusError

  if (!Array.isArray(previous)) return '기존 항목을 확인할 수 없습니다.'
  const nextById = new Map(
    columns.map((column) => [column.id.toLowerCase(), column]),
  )
  for (const existing of previous) {
    if (!existing || typeof existing.id !== 'string' || existing.id === '') {
      return '기존 항목을 확인할 수 없습니다.'
    }
    const next = nextById.get(existing.id.toLowerCase())
    const name =
      typeof existing.label === 'string' && existing.label.trim()
        ? existing.label.trim()
        : existing.id
    if (!next) return `기존 항목은 삭제할 수 없습니다. 숨겨 주세요. (${name})`
    if (
      next.kind !== existing.kind ||
      next.sourceKey !== existing.sourceKey ||
      next.valueType !== existing.valueType
    ) {
      return `기존 항목의 종류·출처·값 형식은 바꿀 수 없습니다. (${name})`
    }
  }

  return null
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30
  return 31
}

/** Date로 만들면 없는 날이 다음 달로 넘어가므로 달력 일수로 확인한다. */
function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1 || month < 1 || month > 12) return false
  return day >= 1 && day <= daysInMonth(year, month)
}

export function usageValueError(
  column: UsageCodeColumn,
  input: string,
): string | null {
  if (column.kind === 'common') return '공통 항목은 직접 고칠 수 없습니다.'
  if (column.kind === 'operation') return '작업 항목은 직접 고칠 수 없습니다.'
  if (column.kind === 'legacy') return '예전 항목은 직접 고칠 수 없습니다.'
  if (column.kind !== 'private') return '이 항목은 직접 고칠 수 없습니다.'
  if (!isValueType(column.valueType)) return '값 형식을 확인할 수 없습니다.'
  if (typeof input !== 'string') return '값을 확인할 수 없습니다.'

  const trimmed = input.trim()
  if (trimmed === '') return null
  if (column.valueType === 'text') {
    if (trimmed.length > 4000) return '내용은 4000자 이하여야 합니다.'
    return null
  }
  if (column.valueType === 'number') {
    if (!DECIMAL_PATTERN.test(trimmed) || !Number.isFinite(Number(trimmed))) {
      return '유한한 10진수로 입력하세요.'
    }
    return null
  }
  if (!isRealCalendarDate(trimmed)) {
    return '날짜는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.'
  }
  return null
}

export function parseUsageValue(
  column: UsageCodeColumn,
  input: string,
): UsagePrivateValue {
  const message = usageValueError(column, input)
  if (message) throw new Error(message)
  const trimmed = input.trim()
  if (trimmed === '') return null
  if (column.valueType === 'number') {
    const value = Number(trimmed)
    return Object.is(value, -0) ? 0 : value
  }
  return trimmed
}

export function formatUsageValue(value: unknown): string {
  if (value === null || value === undefined) return '미등록'
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Object.is(value, -0) ? '0' : String(value)
  }
  throw new Error('표시할 수 없는 값입니다.')
}

/** 사용처 등록과 같이 공백과 _-/(). 를 빼고 소문자로 맞춘다. */
function normalizeUsageHeader(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_/().-]/g, '')
    .trim()
}

export function usageCodeHeaderIndex(
  headers: string[],
  columns: UsageCodeColumn[],
  key: 'code' | 'status',
): number {
  const normalizedHeaders = headers.map((header) =>
    normalizeUsageHeader(header),
  )
  const configured = columns.find((column) => column.sourceKey === key)
  if (configured && typeof configured.label === 'string') {
    const label = normalizeUsageHeader(configured.label)
    if (label) {
      const configuredIndex = normalizedHeaders.indexOf(label)
      if (configuredIndex >= 0) return configuredIndex
    }
  }

  const aliases = new Set(
    (key === 'code' ? CODE_HEADER_ALIASES : STATUS_HEADER_ALIASES).map(
      (alias) => normalizeUsageHeader(alias),
    ),
  )
  // An alias belonging to another configured field must never be treated as this source.
  const occupied = new Set(
    columns
      .filter((column) => column.sourceKey !== key)
      .map((column) => normalizeUsageHeader(column.label)),
  )
  const aliasIndex = normalizedHeaders.findIndex(
    (header) => header !== '' && aliases.has(header) && !occupied.has(header),
  )
  if (aliasIndex >= 0) return aliasIndex
  return -1
}
