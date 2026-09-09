export const WAREHOUSE_SHEET_SYNC_MAX_ROWS = 8000
export const WAREHOUSE_SHEET_SYNC_BRAND_SLUG = 'masmarulez'
export const FORCED_PRIORITY_DATE = '000000'
export const SECOND_PRIORITY_DATE = '000001'
export const LAST_PRIORITY_DATE = '999999'
export const FINAL_LOCATION_MARK = '//'
export const EMPTY_WAREHOUSE_LOCATION_CODE = '(빈 자리)'

export type WarehouseUsagePriority = 'first' | 'second' | 'fifo' | 'last'
export type WarehouseQuantityStatus = 'known' | 'unknown'
export type WarehouseZone = 'box_storage' | 'picking'
export type WarehouseReviewFlag =
  | 'missing_style'
  | 'date_review'
  | 'duplicate_suspect'
  | 'special_location'
  | 'quantity_unknown'

export type StyleRef = {
  styleId: string
  styleNo: string
  name: string
}

export type WarehouseSheetSyncInputRow = {
  externalRowId: string
  sourceStyleNo: string
  sourceProductName: string
  locationRaw: string
  receivedOnRaw: string
  unitsPerBoxRaw: string
  remainingBoxesRaw: string
  note: string
  sourceRowNumber: number
}

export type PreparedWarehouseSheetSyncRow = WarehouseSheetSyncInputRow & {
  normalizedStyleNo: string
  locationCode: string
  isFinalLocation: boolean
  receivedOn: string | null
  isForcedPriority: boolean
  usagePriority: WarehouseUsagePriority
  quantityStatus: WarehouseQuantityStatus
  unitsPerBox: number | null
  remainingBoxes: number | null
  dateValid: boolean
  zone: WarehouseZone
  styleId: string | null
  styleName: string
  reviewFlags: WarehouseReviewFlag[]
}

const FIELD_LIMITS = {
  externalRowId: 80,
  sourceStyleNo: 80,
  sourceProductName: 300,
  locationRaw: 80,
  receivedOnRaw: 40,
  unitsPerBoxRaw: 40,
  remainingBoxesRaw: 40,
  note: 500,
} as const

export function normalizeStyleNo(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[_/\\]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function compactProductNameKey(value: string): string {
  return value.replace(/[^0-9a-z가-힣]/gi, '').toLocaleLowerCase('ko-KR')
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

export function parseWarehouseLocation(raw: string) {
  const trimmed = raw.trim()
  const isFinalLocation = trimmed.endsWith(FINAL_LOCATION_MARK)
  const locationCode = (
    isFinalLocation ? trimmed.slice(0, -FINAL_LOCATION_MARK.length) : trimmed
  ).trim()
  return { locationCode, locationRaw: trimmed, isFinalLocation }
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
      receivedOn: dateValid ? `${iso[1]}-${iso[2]}-${iso[3]}` : null,
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

export function classifyWarehouseSheetZone(
  locationCode: string,
  pickingCodes: Iterable<string>,
): WarehouseZone {
  const code = locationCode.trim() || EMPTY_WAREHOUSE_LOCATION_CODE
  return new Set([...pickingCodes].map((item) => item.trim()).filter(Boolean)).has(
    code,
  )
    ? 'picking'
    : 'box_storage'
}

function duplicateKey(row: {
  normalizedStyleNo: string
  locationCode: string
  isFinalLocation: boolean
  receivedOnRaw: string
  unitsPerBoxRaw: string
  remainingBoxesRaw: string
}) {
  return [
    row.normalizedStyleNo,
    row.locationCode,
    row.isFinalLocation ? 'final' : 'open',
    row.receivedOnRaw,
    row.unitsPerBoxRaw,
    row.remainingBoxesRaw,
  ].join('\u001f')
}

export function validateWarehouseSheetSyncPayload(rows: unknown): {
  rows: WarehouseSheetSyncInputRow[]
  issues: Array<{ rowNumber: number; message: string }>
} {
  const issues: Array<{ rowNumber: number; message: string }> = []
  if (!Array.isArray(rows)) {
    return { rows: [], issues: [{ rowNumber: 0, message: '행 배열이 필요합니다.' }] }
  }
  if (rows.length === 0) {
    return { rows: [], issues: [{ rowNumber: 0, message: '보낼 창고 행이 없습니다.' }] }
  }
  if (rows.length > WAREHOUSE_SHEET_SYNC_MAX_ROWS) {
    return {
      rows: [],
      issues: [
        {
          rowNumber: 0,
          message: `한 번에 ${WAREHOUSE_SHEET_SYNC_MAX_ROWS}행까지 보낼 수 있습니다.`,
        },
      ],
    }
  }
  const parsed: WarehouseSheetSyncInputRow[] = []
  const seenIds = new Map<string, number>()
  rows.forEach((item, index) => {
    const rowNumber =
      item && typeof item === 'object' && 'sourceRowNumber' in item
        ? Number((item as { sourceRowNumber?: unknown }).sourceRowNumber) ||
          index + 3
        : index + 3
    if (!item || typeof item !== 'object') {
      issues.push({ rowNumber, message: '행 형식이 올바르지 않습니다.' })
      return
    }
    const raw = item as Record<string, unknown>
    const read = (key: string) => String(raw[key] ?? '').trim()
    const row: WarehouseSheetSyncInputRow = {
      externalRowId: read('externalRowId'),
      sourceStyleNo: read('sourceStyleNo'),
      sourceProductName: read('sourceProductName'),
      locationRaw: read('locationRaw'),
      receivedOnRaw: read('receivedOnRaw'),
      unitsPerBoxRaw: read('unitsPerBoxRaw'),
      remainingBoxesRaw: read('remainingBoxesRaw'),
      note: read('note'),
      sourceRowNumber: rowNumber,
    }
    if (!row.externalRowId) {
      issues.push({ rowNumber, message: 'AA 행 ID가 없습니다.' })
    } else if ([...row.externalRowId].length > FIELD_LIMITS.externalRowId) {
      issues.push({ rowNumber, message: 'AA 행 ID가 너무 깁니다.' })
    } else if (seenIds.has(row.externalRowId)) {
      issues.push({
        rowNumber,
        message: `AA 행 ID가 ${seenIds.get(row.externalRowId)}행과 중복입니다.`,
      })
    } else {
      seenIds.set(row.externalRowId, rowNumber)
    }
    parsed.push(row)
  })
  return { rows: parsed, issues }
}

export function prepareWarehouseSheetSyncRows(
  rows: WarehouseSheetSyncInputRow[],
  styles: StyleRef[],
  pickingCodes: Iterable<string> = [],
): PreparedWarehouseSheetSyncRow[] {
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
  const parsed = rows.map((input) => {
    const location = parseWarehouseLocation(input.locationRaw)
    const received = parseWarehouseReceivedOn(input.receivedOnRaw)
    const units = parseWarehouseQuantity(input.unitsPerBoxRaw, { min: 1 })
    const boxes = parseWarehouseQuantity(input.remainingBoxesRaw, { min: 0 })
    const quantityStatus: WarehouseQuantityStatus =
      units.value == null || boxes.value == null ? 'unknown' : 'known'
    return {
      ...input,
      normalizedStyleNo: normalizeStyleNo(input.sourceStyleNo),
      locationCode: location.locationCode,
      isFinalLocation: location.isFinalLocation,
      receivedOn: received.receivedOn,
      receivedOnRaw: received.receivedOnRaw,
      isForcedPriority: received.isForcedPriority,
      usagePriority: received.usagePriority,
      quantityStatus,
      unitsPerBox: units.value,
      remainingBoxes: boxes.value,
      unitsPerBoxRaw: units.raw,
      remainingBoxesRaw: boxes.raw,
      dateValid: received.dateValid,
      zone: classifyWarehouseSheetZone(location.locationCode, pickingCodes),
      styleId: null,
      styleName: input.sourceProductName.trim(),
      reviewFlags: [] as WarehouseReviewFlag[],
    }
  })
  const seen = new Map<string, number>()
  for (const row of parsed) {
    const key = duplicateKey(row)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return parsed.map((row) => {
    let style: StyleRef | null = null
    if (row.normalizedStyleNo) style = byStyleNo.get(row.normalizedStyleNo) ?? null
    else {
      const compactName = compactProductNameKey(row.sourceProductName)
      const matches = compactName ? (byCompactName.get(compactName) ?? []) : []
      style = matches.length === 1 ? (matches[0] ?? null) : null
    }
    const reviewFlags: WarehouseReviewFlag[] = []
    if (!style) reviewFlags.push('missing_style')
    if (!row.dateValid) reviewFlags.push('date_review')
    if (!row.locationCode) reviewFlags.push('special_location')
    if (row.quantityStatus === 'unknown') reviewFlags.push('quantity_unknown')
    if ((seen.get(duplicateKey(row)) ?? 0) > 1) reviewFlags.push('duplicate_suspect')
    return {
      ...row,
      normalizedStyleNo: style ? normalizeStyleNo(style.styleNo) : row.normalizedStyleNo,
      styleId: style?.styleId ?? null,
      styleName: style?.name ?? row.sourceProductName,
      reviewFlags,
    }
  })
}

export function summarizeWarehouseSheetSync(
  rows: PreparedWarehouseSheetSyncRow[],
) {
  return {
    total: rows.length,
    missingStyle: rows.filter((row) => row.reviewFlags.includes('missing_style')).length,
    quantityUnknown: rows.filter((row) => row.quantityStatus === 'unknown').length,
    unlinked: rows.filter((row) => !row.styleId).length,
    boxStorage: rows.filter((row) => row.zone === 'box_storage').length,
    picking: rows.filter((row) => row.zone === 'picking').length,
  }
}

export function toWarehouseSnapshotRpcRows(rows: PreparedWarehouseSheetSyncRow[]) {
  return rows.map((row) => ({
    external_row_id: row.externalRowId,
    location_code: row.locationCode || EMPTY_WAREHOUSE_LOCATION_CODE,
    zone: row.zone,
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
