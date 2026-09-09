import { normalizeStyleNo } from '@/lib/import/transform'
import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import type {
  StyleRef,
  WarehouseQuantityStatus,
  WarehouseReviewFlag,
  WarehouseStockAction,
  WarehouseStockPosition,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'

export const FORCED_PRIORITY_DATE = '000000'
export const SECOND_PRIORITY_DATE = '000001'
export const LAST_PRIORITY_DATE = '999999'
export const FINAL_LOCATION_MARK = '//'
export const EMPTY_WAREHOUSE_LOCATION_CODE = '(빈 자리)'

export const WAREHOUSE_USAGE_PRIORITY_ORDER: Record<
  WarehouseUsagePriority,
  number
> = {
  first: 0,
  second: 1,
  fifo: 2,
  last: 3,
}

export const WAREHOUSE_USAGE_PRIORITY_LABEL: Record<
  WarehouseUsagePriority,
  string
> = {
  first: '최우선',
  second: '차순위',
  fifo: '입고순',
  last: '마지막',
}

export const WAREHOUSE_REVIEW_FLAG_LABEL: Record<WarehouseReviewFlag, string> =
  {
    missing_style: '상품 미연결',
    date_review: '날짜 검수',
    duplicate_suspect: '중복 의심',
    special_location: '특수 위치',
    quantity_unknown: '수량 미확인',
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
  usagePriority: WarehouseUsagePriority
  quantityStatus: WarehouseQuantityStatus
  unitsPerBox: number | null
  remainingBoxes: number | null
  unitsPerBoxRaw: string
  remainingBoxesRaw: string
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
  quantityUnknown: number
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

export function formatWarehouseLocation(row: {
  locationCode: string
  isFinalLocation: boolean
}) {
  return row.isFinalLocation
    ? `${row.locationCode}${FINAL_LOCATION_MARK}`
    : row.locationCode
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

export function parseWarehouseQuantity(
  raw: string,
  options?: { min?: number },
): { value: number | null; raw: string } {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return { value: null, raw: trimmed }
  const parsed = Number(trimmed.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(parsed)) return { value: null, raw: trimmed }
  if (options?.min != null && parsed < options.min) {
    return { value: null, raw: trimmed }
  }
  return { value: parsed, raw: trimmed }
}

export function parseWarehouseReceivedOn(raw: string): {
  receivedOn: string | null
  receivedOnRaw: string
  isForcedPriority: boolean
  usagePriority: WarehouseUsagePriority
  dateValid: boolean
} {
  const receivedOnRaw = raw.trim()
  if (!receivedOnRaw || receivedOnRaw === FORCED_PRIORITY_DATE) {
    return {
      receivedOn: null,
      receivedOnRaw: receivedOnRaw || FORCED_PRIORITY_DATE,
      isForcedPriority: true,
      usagePriority: 'first',
      dateValid: true,
    }
  }
  if (receivedOnRaw === SECOND_PRIORITY_DATE) {
    return {
      receivedOn: null,
      receivedOnRaw,
      isForcedPriority: false,
      usagePriority: 'second',
      dateValid: true,
    }
  }
  if (receivedOnRaw === LAST_PRIORITY_DATE) {
    return {
      receivedOn: null,
      receivedOnRaw,
      isForcedPriority: false,
      usagePriority: 'last',
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
      usagePriority: 'fifo',
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
      usagePriority: 'fifo',
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
      usagePriority: 'fifo',
      dateValid,
    }
  }

  return {
    receivedOn: null,
    receivedOnRaw,
    isForcedPriority: false,
    usagePriority: 'fifo',
    dateValid: false,
  }
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
    const units = parseWarehouseQuantity(cells[unitsIdx] ?? '', { min: 1 })
    const boxes = parseWarehouseQuantity(cells[boxesIdx] ?? '', { min: 0 })
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
      usagePriority: received.usagePriority,
      quantityStatus:
        units.value == null || boxes.value == null ? 'unknown' : 'known',
      unitsPerBox: units.value,
      remainingBoxes: boxes.value,
      unitsPerBoxRaw: units.raw,
      remainingBoxesRaw: boxes.raw,
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
    row.unitsPerBoxRaw || String(row.unitsPerBox ?? ''),
    row.remainingBoxesRaw || String(row.remainingBoxes ?? ''),
  ].join('\u001f')
}

function resolveWarehouseImportStyle(
  row: ParsedWarehouseSheetRow,
  byStyleNo: Map<string, StyleRef>,
  byCompactName: Map<string, StyleRef[]>,
): StyleRef | null {
  if (row.normalizedStyleNo) {
    return byStyleNo.get(row.normalizedStyleNo) ?? null
  }
  const compactName = compactProductNameKey(row.sourceProductName)
  if (!compactName) return null
  const matches = byCompactName.get(compactName) ?? []
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function prepareWarehouseImportRows(
  rows: ParsedWarehouseSheetRow[],
  styles: StyleRef[],
): PreparedWarehouseImportRow[] {
  const byStyleNo = new Map<string, StyleRef>()
  const byCompactName = new Map<string, StyleRef[]>()
  for (const style of styles) {
    byStyleNo.set(normalizeStyleNo(style.styleNo), style)
    const compactName = compactProductNameKey(style.name)
    if (!compactName) continue
    const matches = byCompactName.get(compactName) ?? []
    matches.push(style)
    byCompactName.set(compactName, matches)
  }
  const seen = new Map<string, number>()
  for (const row of rows) {
    const key = duplicateKey(row)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  return rows.map((row) => {
    const style = resolveWarehouseImportStyle(row, byStyleNo, byCompactName)
    const reviewFlags: WarehouseReviewFlag[] = []
    if (!style) reviewFlags.push('missing_style')
    if (!row.dateValid) reviewFlags.push('date_review')
    if (!row.locationCode) reviewFlags.push('special_location')
    if (row.quantityStatus === 'unknown') reviewFlags.push('quantity_unknown')
    if ((seen.get(duplicateKey(row)) ?? 0) > 1) {
      reviewFlags.push('duplicate_suspect')
    }
    return {
      ...row,
      normalizedStyleNo: style
        ? normalizeStyleNo(style.styleNo)
        : row.normalizedStyleNo,
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
    quantityUnknown: rows.filter((row) =>
      row.reviewFlags.includes('quantity_unknown'),
    ).length,
  }
}

export function resolveWarehouseUsagePriority(
  row: Pick<
    WarehouseStockPosition,
    'isForcedPriority' | 'receivedOnRaw'
  > & {
    usagePriority?: WarehouseUsagePriority | null
  },
): WarehouseUsagePriority {
  if (row.usagePriority) return row.usagePriority
  if (row.isForcedPriority) return 'first'
  if (row.receivedOnRaw === SECOND_PRIORITY_DATE) return 'second'
  if (row.receivedOnRaw === LAST_PRIORITY_DATE) return 'last'
  return 'fifo'
}

export function compareWarehouseUsageOrder(
  left: Pick<
    WarehouseStockPosition,
    | 'isFinalLocation'
    | 'isForcedPriority'
    | 'receivedOn'
    | 'sourceRowNumber'
  > & {
    usagePriority?: WarehouseUsagePriority | null
    receivedOnRaw?: string
  },
  right: Pick<
    WarehouseStockPosition,
    | 'isFinalLocation'
    | 'isForcedPriority'
    | 'receivedOn'
    | 'sourceRowNumber'
  > & {
    usagePriority?: WarehouseUsagePriority | null
    receivedOnRaw?: string
  },
) {
  if (left.isFinalLocation !== right.isFinalLocation) {
    return left.isFinalLocation ? 1 : -1
  }
  const leftPriority = resolveWarehouseUsagePriority({
    isForcedPriority: left.isForcedPriority,
    receivedOnRaw: left.receivedOnRaw ?? '',
    usagePriority: left.usagePriority,
  })
  const rightPriority = resolveWarehouseUsagePriority({
    isForcedPriority: right.isForcedPriority,
    receivedOnRaw: right.receivedOnRaw ?? '',
    usagePriority: right.usagePriority,
  })
  if (leftPriority !== rightPriority) {
    return (
      WAREHOUSE_USAGE_PRIORITY_ORDER[leftPriority] -
      WAREHOUSE_USAGE_PRIORITY_ORDER[rightPriority]
    )
  }
  if (leftPriority === 'fifo' && rightPriority === 'fifo') {
    const leftDate = left.receivedOn ?? '9999-12-31'
    const rightDate = right.receivedOn ?? '9999-12-31'
    if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1
  }
  return left.sourceRowNumber - right.sourceRowNumber
}

export function isWarehouseQuantityKnown(row: {
  quantityStatus?: WarehouseQuantityStatus | null
  unitsPerBox?: number | null
  remainingBoxes?: number | null
}) {
  if (row.quantityStatus === 'unknown') return false
  return row.unitsPerBox != null && row.remainingBoxes != null
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
  > & {
    usagePriority?: WarehouseUsagePriority | null
    receivedOnRaw?: string
    quantityStatus?: WarehouseQuantityStatus | null
    unitsPerBox?: number | null
  },
>(rows: T[]): Array<T & { usageRank: number | null }> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = normalizeStyleNo(row.styleNo)
    if (!key) continue
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  const ranked = new Map<T, number | null>()
  for (const list of groups.values()) {
    const active = list
      .filter(
        (row) =>
          isWarehouseQuantityKnown(row) &&
          ((row.remainingBoxes ?? 0) > 0 || row.openedUnits > 0),
      )
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
  remainingBoxes?: number | null
  unitsPerBox?: number | null
  openedUnits?: number | null
  quantityStatus?: WarehouseQuantityStatus | null
}) {
  if (!isWarehouseQuantityKnown(row)) return 0
  return (row.remainingBoxes ?? 0) * (row.unitsPerBox ?? 0) + (row.openedUnits ?? 0)
}

export type StyleWarehouseStockSummary = {
  styleNo: string
  boxLocation: string | null
  pickingLocation: string | null
  boxQty: number
  pickingQty: number
  totalQty: number
}

type WarehouseStockSummaryRow = Pick<
  WarehouseStockPosition,
  | 'styleNo'
  | 'locationCode'
  | 'isFinalLocation'
  | 'isForcedPriority'
  | 'receivedOn'
  | 'sourceRowNumber'
  | 'remainingBoxes'
  | 'openedUnits'
  | 'unitsPerBox'
  | 'zone'
> & {
  usagePriority?: WarehouseUsagePriority | null
  receivedOnRaw?: string
  quantityStatus?: WarehouseQuantityStatus | null
}

export function summarizeWarehouseStockByStyle(
  positions: WarehouseStockSummaryRow[],
): Map<string, StyleWarehouseStockSummary> {
  const ranked = (['box_storage', 'picking'] as const).flatMap((zone) =>
    assignWarehouseUsageRanks(positions.filter((row) => row.zone === zone)),
  )
  const summaries = new Map<string, StyleWarehouseStockSummary>()

  for (const row of ranked) {
    const styleNo = normalizeStyleNo(row.styleNo)
    if (!styleNo) continue
    const current = summaries.get(styleNo) ?? {
      styleNo,
      boxLocation: null,
      pickingLocation: null,
      boxQty: 0,
      pickingQty: 0,
      totalQty: 0,
    }
    const qty = warehousePositionQty(row)
    if (!isWarehouseQuantityKnown(row)) {
      summaries.set(styleNo, current)
      continue
    }
    if (row.zone === 'picking') current.pickingQty += qty
    else current.boxQty += qty
    current.totalQty = current.boxQty + current.pickingQty
    if (row.usageRank === 1) {
      const location = formatWarehouseLocation(row) || null
      if (row.zone === 'picking') current.pickingLocation = location
      else current.boxLocation = location
    }
    summaries.set(styleNo, current)
  }

  return summaries
}

export function formatWarehouseCount(value: number | null | undefined) {
  if (value == null) return '미확인'
  return String(value)
}

export function formatWarehouseReceivedOn(row: {
  receivedOn: string | null
  receivedOnRaw: string
}) {
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
  usage_priority: WarehouseUsagePriority
  quantity_status: WarehouseQuantityStatus
  units_per_box: number | null
  remaining_boxes: number | null
  units_per_box_raw: string
  remaining_boxes_raw: string
  review_flags: WarehouseReviewFlag[]
  source_row_number: number
  note: string
}

export function toWarehouseImportRpcRows(
  rows: PreparedWarehouseImportRow[],
  zone: WarehouseZone,
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
    usage_priority: row.usagePriority,
    quantity_status: row.quantityStatus,
    units_per_box: row.unitsPerBox,
    remaining_boxes: row.remainingBoxes,
    units_per_box_raw: row.unitsPerBoxRaw,
    remaining_boxes_raw: row.remainingBoxesRaw,
    review_flags: row.reviewFlags,
    source_row_number: row.sourceRowNumber,
    note: row.note,
  }))
}

export const WAREHOUSE_UPLOAD_SHEET_NAME = '상품업로드'

export const WAREHOUSE_UPLOAD_HEADERS = [
  'M번호',
  '제품명',
  '창고 관리 번호',
  '입고일',
  '박스당 갯수',
  '박스 수',
  '비고',
] as const

export const WAREHOUSE_UPLOAD_EXAMPLE_ROWS: string[][] = [
  ['M100', '검정 티셔츠', 'A-01', '000000', '20', '2', '강제우선 예시'],
  ['M100', '검정 티셔츠', 'A-02', '250101', '20', '3', '일반 입고일 YYMMDD'],
  ['M0487', '슬림백 블랙', '4-3-15//', '250825', '20', '1', '마지막 위치는 끝에 //'],
]

const WAREHOUSE_TEMPLATE_GUIDE_ROWS: string[][] = [
  ['열', '필수', '예시', '설명'],
  ['M번호', 'Y', 'M100', '상품 마스터에 있는 품번. 연결은 이 값으로 합니다'],
  ['제품명', 'N', '검정 티셔츠', '참고용 표시명. 없어도 가져옵니다'],
  [
    '창고 관리 번호',
    'Y',
    'A-01 또는 4-3-15//',
    `끝의 ${FINAL_LOCATION_MARK}는 마지막 위치입니다`,
  ],
  [
    '입고일',
    'Y',
    '250101 또는 000000',
    `YYMMDD 또는 YYYY-MM-DD. ${FORCED_PRIORITY_DATE} 최우선, ${SECOND_PRIORITY_DATE} 차순위, ${LAST_PRIORITY_DATE} 마지막`,
  ],
  ['박스당 갯수', 'N', '20', '한 박스의 입수. 비우면 수량 미확인'],
  ['박스 수', 'N', '2', '남은 박스 수. 비우면 수량 미확인'],
  ['비고', 'N', '', '메모'],
  [
    '',
    '',
    '',
    '예시 행을 지운 뒤 실제 재고를 넣고, 시트 이름 상품업로드와 첫 줄 헤더는 그대로 두세요',
  ],
]

export function warehouseInventoryTemplateSheets() {
  return [
    {
      name: WAREHOUSE_UPLOAD_SHEET_NAME,
      rows: [
        [...WAREHOUSE_UPLOAD_HEADERS],
        ...WAREHOUSE_UPLOAD_EXAMPLE_ROWS.map((row) => [...row]),
      ],
    },
  ]
}

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function safeFilePart(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'brand'
}

/** 선택한 창고 존 교체용 양식. 헤더와 예시 3줄을 넣는다. */
export async function downloadWarehouseInventoryTemplate(
  brandName: string,
  zone: WarehouseZone = 'box_storage',
) {
  const XLSX = await import('xlsx')
  const workbook = XLSX.utils.book_new()
  const warehouseLabel = zone === 'picking' ? '출고창고' : '박스창고'
  const uploadSheet = XLSX.utils.aoa_to_sheet(
    warehouseInventoryTemplateSheets()[0]!.rows,
  )
  uploadSheet['!cols'] = [
    { wch: 10 },
    { wch: 22 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 28 },
  ]
  const guideSheet = XLSX.utils.aoa_to_sheet([
    [
      '대상 창고',
      '필수',
      warehouseLabel,
      `${warehouseLabel}만 교체하고 다른 창고는 유지합니다`,
    ],
    ...WAREHOUSE_TEMPLATE_GUIDE_ROWS,
  ])
  guideSheet['!cols'] = [{ wch: 16 }, { wch: 6 }, { wch: 22 }, { wch: 56 }]
  XLSX.utils.book_append_sheet(
    workbook,
    uploadSheet,
    WAREHOUSE_UPLOAD_SHEET_NAME,
  )
  XLSX.utils.book_append_sheet(workbook, guideSheet, '작성안내')
  XLSX.writeFile(
    workbook,
    `${safeFilePart(brandName)}_${warehouseLabel}양식_${todayStamp()}.xlsx`,
  )
}
