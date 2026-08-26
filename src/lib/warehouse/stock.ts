import { normalizeStyleNo } from '@/lib/import/transform'
import type {
  StyleRef,
  WarehouseReviewFlag,
  WarehouseStockAction,
  WarehouseStockPosition,
  WarehouseZone,
} from '@/lib/types'

export const FORCED_PRIORITY_DATE = '000000'
export const FINAL_LOCATION_MARK = '//'
export const EMPTY_WAREHOUSE_LOCATION_CODE = '(빈 자리)'

export const WAREHOUSE_REVIEW_FLAG_LABEL: Record<WarehouseReviewFlag, string> =
  {
    missing_style: '상품 미연결',
    date_review: '날짜 검수',
    duplicate_suspect: '중복 의심',
    special_location: '특수 위치',
  }

export const WAREHOUSE_STOCK_ACTION_LABEL: Record<WarehouseStockAction, string> =
  {
    import: '가져오기',
    receive: '신규 입고',
    move: '자리 이동',
    deplete: '자리 소진',
    adjust: '실사 수정',
    replenish: '출고 충원',
    open: '박스 개봉',
    label: '박스 ID 전환',
  }

export type ParsedWarehouseSheetRow = {
  sourceRowNumber: number
  sourceStyleNo: string
  normalizedStyleNo: string
  sourceProductName: string
  locationCode: string
  locationRaw: string
  isFinalLocation: boolean
  receivedOn: string | null
  receivedOnRaw: string
  isForcedPriority: boolean
  unitsPerBox: number
  remainingBoxes: number
  note: string
  dateValid: boolean
}

export type PreparedWarehouseImportRow = ParsedWarehouseSheetRow & {
  styleId: string | null
  styleName: string
  reviewFlags: WarehouseReviewFlag[]
}

export type WarehouseImportSummary = {
  total: number
  ok: number
  missingStyle: number
  dateReview: number
  duplicateSuspect: number
}

const HEADER_ALIASES: Record<
  'style' | 'name' | 'location' | 'date' | 'units' | 'boxes' | 'note',
  string[]
> = {
  style: ['m번호', 'm 번호', '품번'],
  name: ['제품명', '제품명 [connected]', '상품명'],
  location: ['창고 관리 번호', '창고 자리번호', '자리번호', '위치'],
  date: ['입고일'],
  units: ['박스당 갯수', '박스당 개수', '입수'],
  boxes: ['박스 수', '박스수'],
  note: ['비고'],
}

function compactHeader(value: string) {
  return value.trim().toLocaleLowerCase('ko-KR').replace(/\s+/g, ' ')
}

function findColumn(
  headers: string[],
  key: keyof typeof HEADER_ALIASES,
) {
  const aliases = HEADER_ALIASES[key]
  return headers.findIndex((header) => aliases.includes(compactHeader(header)))
}

export function parseWarehouseLocation(raw: string) {
  const trimmed = raw.trim()
  const isFinalLocation = trimmed.endsWith(FINAL_LOCATION_MARK)
  const locationCode = (
    isFinalLocation ? trimmed.slice(0, -FINAL_LOCATION_MARK.length) : trimmed
  ).trim()
  return { locationCode, locationRaw: trimmed, isFinalLocation }
}

function isValidYmd(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

export function parseWarehouseReceivedOn(raw: string): {
  receivedOn: string | null
  receivedOnRaw: string
  isForcedPriority: boolean
  dateValid: boolean
} {
  const receivedOnRaw = raw.trim()
  if (!receivedOnRaw || receivedOnRaw === FORCED_PRIORITY_DATE) {
    return {
      receivedOn: null,
      receivedOnRaw: receivedOnRaw || FORCED_PRIORITY_DATE,
      isForcedPriority: true,
      dateValid: true,
    }
  }

  const iso = receivedOnRaw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s|$)/)
  if (iso) {
    const year = Number(iso[1])
    const month = Number(iso[2])
    const day = Number(iso[3])
    const dateValid = isValidYmd(year, month, day)
    return {
      receivedOn: dateValid
        ? `${iso[1]}-${iso[2]}-${iso[3]}`
        : null,
      receivedOnRaw,
      isForcedPriority: false,
      dateValid,
    }
  }

  const compact = receivedOnRaw.replace(/[^0-9]/g, '')
  if (compact.length === 6) {
    const year = 2000 + Number(compact.slice(0, 2))
    const month = Number(compact.slice(2, 4))
    const day = Number(compact.slice(4, 6))
    const dateValid = isValidYmd(year, month, day)
    return {
      receivedOn: dateValid
        ? `${String(year).padStart(4, '0')}-${compact.slice(2, 4)}-${compact.slice(4, 6)}`
        : null,
      receivedOnRaw,
      isForcedPriority: false,
      dateValid,
    }
  }

  if (compact.length === 8) {
    const year = Number(compact.slice(0, 4))
    const month = Number(compact.slice(4, 6))
    const day = Number(compact.slice(6, 8))
    const dateValid = isValidYmd(year, month, day)
    return {
      receivedOn: dateValid
        ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
        : null,
      receivedOnRaw,
      isForcedPriority: false,
      dateValid,
    }
  }

  return {
    receivedOn: null,
    receivedOnRaw,
    isForcedPriority: false,
    dateValid: false,
  }
}

function parseCount(raw: string) {
  const parsed = Number(String(raw).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : NaN
}

export function parseWarehouseUploadRows(
  sheets: Array<{ name: string; rows: string[][] }>,
): ParsedWarehouseSheetRow[] {
  const sheet =
    sheets.find((item) => compactHeader(item.name) === '상품업로드') ??
    sheets.find((item) =>
      item.rows[0]?.some((cell) => compactHeader(cell) === '입고일'),
    )
  if (!sheet || sheet.rows.length < 2) {
    throw new Error('상품업로드 시트를 찾지 못했습니다.')
  }

  const headers = sheet.rows[0] ?? []
  const styleIdx = findColumn(headers, 'style')
  const nameIdx = findColumn(headers, 'name')
  const locationIdx = findColumn(headers, 'location')
  const dateIdx = findColumn(headers, 'date')
  const unitsIdx = findColumn(headers, 'units')
  const boxesIdx = findColumn(headers, 'boxes')
  const noteIdx = findColumn(headers, 'note')
  if (
    styleIdx < 0 ||
    locationIdx < 0 ||
    dateIdx < 0 ||
    unitsIdx < 0 ||
    boxesIdx < 0
  ) {
    throw new Error(
      '상품업로드 헤더에 M번호·자리번호·입고일·박스당 갯수·박스 수가 필요합니다.',
    )
  }

  const parsed: ParsedWarehouseSheetRow[] = []
  sheet.rows.slice(1).forEach((cells, index) => {
    const sourceStyleNo = (cells[styleIdx] ?? '').trim()
    const locationRaw = (cells[locationIdx] ?? '').trim()
    if (!sourceStyleNo && !locationRaw) return
    const location = parseWarehouseLocation(locationRaw)
    const received = parseWarehouseReceivedOn(cells[dateIdx] ?? '')
    const unitsPerBox = parseCount(cells[unitsIdx] ?? '')
    const remainingBoxes = parseCount(cells[boxesIdx] ?? '')
    parsed.push({
      sourceRowNumber: index + 2,
      sourceStyleNo,
      normalizedStyleNo: normalizeStyleNo(sourceStyleNo),
      sourceProductName: (nameIdx >= 0 ? cells[nameIdx] : '')?.trim() ?? '',
      locationCode: location.locationCode,
      locationRaw: location.locationRaw,
      isFinalLocation: location.isFinalLocation,
      receivedOn: received.receivedOn,
      receivedOnRaw: received.receivedOnRaw,
      isForcedPriority: received.isForcedPriority,
      unitsPerBox: Number.isFinite(unitsPerBox) ? Math.max(0, unitsPerBox) : 0,
      remainingBoxes: Number.isFinite(remainingBoxes)
        ? Math.max(0, remainingBoxes)
        : 0,
      note: (noteIdx >= 0 ? cells[noteIdx] : '')?.trim() ?? '',
      dateValid: received.dateValid,
    })
  })
  if (parsed.length === 0) {
    throw new Error('가져올 창고 행이 없습니다.')
  }
  return parsed
}

function duplicateKey(row: ParsedWarehouseSheetRow) {
  return [
    row.normalizedStyleNo,
    row.locationCode,
    row.isFinalLocation ? 'final' : 'open',
    row.receivedOnRaw,
    String(row.unitsPerBox),
    String(row.remainingBoxes),
  ].join('\u001f')
}

export function prepareWarehouseImportRows(
  rows: ParsedWarehouseSheetRow[],
  styles: StyleRef[],
): PreparedWarehouseImportRow[] {
  const byStyleNo = new Map<string, StyleRef>()
  for (const style of styles) {
    byStyleNo.set(normalizeStyleNo(style.styleNo), style)
  }
  const seen = new Map<string, number>()
  for (const row of rows) {
    const key = duplicateKey(row)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  return rows.map((row) => {
    const style = byStyleNo.get(row.normalizedStyleNo) ?? null
    const reviewFlags: WarehouseReviewFlag[] = []
    if (!style) reviewFlags.push('missing_style')
    if (!row.dateValid) reviewFlags.push('date_review')
    if (!row.locationCode) reviewFlags.push('special_location')
    if ((seen.get(duplicateKey(row)) ?? 0) > 1) {
      reviewFlags.push('duplicate_suspect')
    }
    return {
      ...row,
      styleId: style?.styleId ?? null,
      styleName: style?.name ?? row.sourceProductName,
      reviewFlags,
    }
  })
}

export function summarizeWarehouseImport(
  rows: PreparedWarehouseImportRow[],
): WarehouseImportSummary {
  return {
    total: rows.length,
    ok: rows.filter((row) => row.reviewFlags.length === 0).length,
    missingStyle: rows.filter((row) =>
      row.reviewFlags.includes('missing_style'),
    ).length,
    dateReview: rows.filter((row) => row.reviewFlags.includes('date_review'))
      .length,
    duplicateSuspect: rows.filter((row) =>
      row.reviewFlags.includes('duplicate_suspect'),
    ).length,
  }
}

export function compareWarehouseUsageOrder(
  left: Pick<
    WarehouseStockPosition,
    | 'isFinalLocation'
    | 'isForcedPriority'
    | 'receivedOn'
    | 'sourceRowNumber'
  >,
  right: Pick<
    WarehouseStockPosition,
    | 'isFinalLocation'
    | 'isForcedPriority'
    | 'receivedOn'
    | 'sourceRowNumber'
  >,
) {
  if (left.isFinalLocation !== right.isFinalLocation) {
    return left.isFinalLocation ? 1 : -1
  }
  if (left.isForcedPriority !== right.isForcedPriority) {
    return left.isForcedPriority ? -1 : 1
  }
  const leftDate = left.receivedOn ?? '9999-12-31'
  const rightDate = right.receivedOn ?? '9999-12-31'
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
  return left.sourceRowNumber - right.sourceRowNumber
}

export function assignWarehouseUsageRanks<
  T extends Pick<
    WarehouseStockPosition,
    | 'styleNo'
    | 'isFinalLocation'
    | 'isForcedPriority'
    | 'receivedOn'
    | 'sourceRowNumber'
    | 'remainingBoxes'
    | 'openedUnits'
  >,
>(rows: T[]): Array<T & { usageRank: number | null }> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = normalizeStyleNo(row.styleNo)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  const ranked = new Map<T, number | null>()
  for (const list of groups.values()) {
    const active = list
      .filter((row) => row.remainingBoxes > 0 || row.openedUnits > 0)
      .sort(compareWarehouseUsageOrder)
    active.forEach((row, index) => {
      ranked.set(row, index + 1)
    })
    for (const row of list) {
      if (!ranked.has(row)) ranked.set(row, null)
    }
  }

  return rows.map((row) => ({
    ...row,
    usageRank: ranked.get(row) ?? null,
  }))
}

export function warehousePositionQty(row: {
  remainingBoxes: number
  unitsPerBox: number
  openedUnits: number
}) {
  return row.remainingBoxes * row.unitsPerBox + row.openedUnits
}

export function formatWarehouseReceivedOn(row: {
  isForcedPriority: boolean
  receivedOn: string | null
  receivedOnRaw: string
}) {
  if (row.isForcedPriority) return '우선'
  if (row.receivedOn) {
    const [year, month, day] = row.receivedOn.split('-')
    return `${year?.slice(2)}.${month}.${day}`
  }
  return row.receivedOnRaw || '—'
}

export function planWarehouseBoxMove(input: {
  remainingBoxes: number
  moveBoxes: number
}) {
  if (input.moveBoxes <= 0) {
    throw new Error('옮길 박스 수는 1 이상이어야 합니다.')
  }
  if (input.moveBoxes > input.remainingBoxes) {
    throw new Error('남은 박스보다 많이 옮길 수 없습니다.')
  }
  return {
    sourceRemaining: input.remainingBoxes - input.moveBoxes,
    movedBoxes: input.moveBoxes,
    splitsRow: input.moveBoxes < input.remainingBoxes,
  }
}

export function assertNonNegativeStock(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label}은 0 미만이 될 수 없습니다.`)
  }
}

export function defaultWarehouseZone(): WarehouseZone {
  return 'box_storage'
}

export type WarehouseImportRpcRow = {
  location_code: string
  zone: WarehouseZone
  style_id: string | null
  source_style_no: string
  normalized_style_no: string
  source_product_name: string
  received_on: string | null
  received_on_raw: string
  is_forced_priority: boolean
  is_final_location: boolean
  units_per_box: number
  remaining_boxes: number
  review_flags: WarehouseReviewFlag[]
  source_row_number: number
  note: string
}

export function toWarehouseImportRpcRows(
  rows: PreparedWarehouseImportRow[],
  zone: WarehouseZone = 'box_storage',
): WarehouseImportRpcRow[] {
  return rows.map((row) => ({
    location_code: row.locationCode || EMPTY_WAREHOUSE_LOCATION_CODE,
    zone,
    style_id: row.styleId,
    source_style_no: row.sourceStyleNo,
    normalized_style_no: row.normalizedStyleNo,
    source_product_name: row.sourceProductName,
    received_on: row.receivedOn,
    received_on_raw: row.receivedOnRaw,
    is_forced_priority: row.isForcedPriority,
    is_final_location: row.isFinalLocation,
    units_per_box: Math.max(row.unitsPerBox, 1),
    remaining_boxes: Math.max(row.remainingBoxes, 0),
    review_flags: row.reviewFlags,
    source_row_number: row.sourceRowNumber,
    note: row.note,
  }))
}
