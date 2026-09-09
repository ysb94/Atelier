import { normalizeStyleNo } from '@/lib/import/transform'
import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import type {
  StyleRef,
  WarehouseQuantityStatus,
  WarehouseReviewFlag,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'
import {
  EMPTY_WAREHOUSE_LOCATION_CODE,
  LAST_PRIORITY_DATE,
  parseWarehouseLocation,
  parseWarehouseQuantity,
  parseWarehouseReceivedOn,
  SECOND_PRIORITY_DATE,
} from '@/lib/warehouse/stock'

export const WAREHOUSE_SHEET_SYNC_MAX_ROWS = 8000
export const WAREHOUSE_SHEET_SYNC_BRAND_SLUG = 'masmarulez'

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

export type PreparedWarehouseSheetSyncRow = {
  externalRowId: string
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
  sourceRowNumber: number
  dateValid: boolean
  zone: WarehouseZone
  styleId: string | null
  styleName: string
  reviewFlags: WarehouseReviewFlag[]
}

export type WarehouseSheetSyncIssue = {
  rowNumber: number
  message: string
}

export type WarehouseSheetSyncSummary = {
  total: number
  missingStyle: number
  quantityUnknown: number
  dateReview: number
  duplicateSuspect: number
  unlinked: number
  boxStorage: number
  picking: number
  first: number
  second: number
  fifo: number
  last: number
}

export type WarehouseSnapshotRpcRow = {
  external_row_id: string
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

function textLen(value: string) {
  return [...value].length
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

export function classifyWarehouseSheetZone(
  locationCode: string,
  pickingCodes: Iterable<string>,
): WarehouseZone {
  const code = locationCode.trim() || EMPTY_WAREHOUSE_LOCATION_CODE
  const registered = new Set(
    [...pickingCodes].map((item) => item.trim()).filter(Boolean),
  )
  return registered.has(code) ? 'picking' : 'box_storage'
}

export function parseWarehouseSheetSyncRow(
  input: WarehouseSheetSyncInputRow,
  pickingCodes: Iterable<string> = [],
): PreparedWarehouseSheetSyncRow {
  const location = parseWarehouseLocation(input.locationRaw)
  const received = parseWarehouseReceivedOn(input.receivedOnRaw)
  const units = parseWarehouseQuantity(input.unitsPerBoxRaw, { min: 1 })
  const boxes = parseWarehouseQuantity(input.remainingBoxesRaw, { min: 0 })
  const quantityStatus: WarehouseQuantityStatus =
    units.value == null || boxes.value == null ? 'unknown' : 'known'
  const locationCode = location.locationCode
  return {
    externalRowId: input.externalRowId.trim(),
    sourceStyleNo: input.sourceStyleNo.trim(),
    normalizedStyleNo: normalizeStyleNo(input.sourceStyleNo),
    sourceProductName: input.sourceProductName.trim(),
    locationCode,
    locationRaw: location.locationRaw,
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
    note: input.note.trim(),
    sourceRowNumber: input.sourceRowNumber,
    dateValid: received.dateValid,
    zone: classifyWarehouseSheetZone(locationCode, pickingCodes),
    styleId: null,
    styleName: input.sourceProductName.trim(),
    reviewFlags: [],
  }
}

function resolveSheetStyle(
  row: PreparedWarehouseSheetSyncRow,
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

export function prepareWarehouseSheetSyncRows(
  rows: WarehouseSheetSyncInputRow[],
  styles: StyleRef[],
  pickingCodes: Iterable<string> = [],
): PreparedWarehouseSheetSyncRow[] {
  const parsed = rows.map((row) =>
    parseWarehouseSheetSyncRow(row, pickingCodes),
  )
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
  for (const row of parsed) {
    const key = duplicateKey(row)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  return parsed.map((row) => {
    const style = resolveSheetStyle(row, byStyleNo, byCompactName)
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

export function validateWarehouseSheetSyncPayload(rows: unknown): {
  rows: WarehouseSheetSyncInputRow[]
  issues: WarehouseSheetSyncIssue[]
} {
  const issues: WarehouseSheetSyncIssue[] = []
  if (!Array.isArray(rows)) {
    return {
      rows: [],
      issues: [{ rowNumber: 0, message: '행 배열이 필요합니다.' }],
    }
  }
  if (rows.length === 0) {
    issues.push({ rowNumber: 0, message: '보낼 창고 행이 없습니다.' })
    return { rows: [], issues }
  }
  if (rows.length > WAREHOUSE_SHEET_SYNC_MAX_ROWS) {
    issues.push({
      rowNumber: 0,
      message: `한 번에 ${WAREHOUSE_SHEET_SYNC_MAX_ROWS}행까지 보낼 수 있습니다.`,
    })
    return { rows: [], issues }
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
    } else if (textLen(row.externalRowId) > FIELD_LIMITS.externalRowId) {
      issues.push({ rowNumber, message: 'AA 행 ID가 너무 깁니다.' })
    } else if (seenIds.has(row.externalRowId)) {
      issues.push({
        rowNumber,
        message: `AA 행 ID가 ${seenIds.get(row.externalRowId)}행과 중복입니다.`,
      })
    } else {
      seenIds.set(row.externalRowId, rowNumber)
    }
    const tooLong = (
      [
        ['sourceStyleNo', 'M번호'],
        ['sourceProductName', '제품명'],
        ['locationRaw', '자리번호'],
        ['receivedOnRaw', '입고일'],
        ['unitsPerBoxRaw', '박스당 갯수'],
        ['remainingBoxesRaw', '박스 수'],
        ['note', '비고'],
      ] as const
    ).find(
      ([key, _label]) =>
        textLen(row[key]) > FIELD_LIMITS[key],
    )
    if (tooLong) {
      issues.push({ rowNumber, message: `${tooLong[1]}이 너무 깁니다.` })
    }
    if (
      !row.sourceStyleNo &&
      !row.sourceProductName &&
      !row.locationRaw &&
      !row.receivedOnRaw &&
      !row.unitsPerBoxRaw &&
      !row.remainingBoxesRaw &&
      !row.note
    ) {
      issues.push({ rowNumber, message: 'B~H가 모두 비어 있습니다.' })
    }
    parsed.push(row)
  })
  return { rows: parsed, issues }
}

export function summarizeWarehouseSheetSync(
  rows: PreparedWarehouseSheetSyncRow[],
): WarehouseSheetSyncSummary {
  return {
    total: rows.length,
    missingStyle: rows.filter((row) =>
      row.reviewFlags.includes('missing_style'),
    ).length,
    quantityUnknown: rows.filter((row) => row.quantityStatus === 'unknown')
      .length,
    dateReview: rows.filter((row) => row.reviewFlags.includes('date_review'))
      .length,
    duplicateSuspect: rows.filter((row) =>
      row.reviewFlags.includes('duplicate_suspect'),
    ).length,
    unlinked: rows.filter((row) => !row.styleId).length,
    boxStorage: rows.filter((row) => row.zone === 'box_storage').length,
    picking: rows.filter((row) => row.zone === 'picking').length,
    first: rows.filter((row) => row.usagePriority === 'first').length,
    second: rows.filter((row) => row.usagePriority === 'second').length,
    fifo: rows.filter((row) => row.usagePriority === 'fifo').length,
    last: rows.filter((row) => row.usagePriority === 'last').length,
  }
}

export function toWarehouseSnapshotRpcRows(
  rows: PreparedWarehouseSheetSyncRow[],
): WarehouseSnapshotRpcRow[] {
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

export function buildWarehouseSheetSyncFixture(count = 2028): {
  rows: WarehouseSheetSyncInputRow[]
  pickingCodes: string[]
} {
  const rows: WarehouseSheetSyncInputRow[] = [
    {
      externalRowId: 'inb_fixture_missing_style',
      sourceStyleNo: '',
      sourceProductName: '불량 모음',
      locationRaw: '불량-1',
      receivedOnRaw: LAST_PRIORITY_DATE,
      unitsPerBoxRaw: '10',
      remainingBoxesRaw: '1',
      note: 'M번호 없음',
      sourceRowNumber: 3,
    },
    {
      externalRowId: 'inb_fixture_unknown_qty',
      sourceStyleNo: 'M100',
      sourceProductName: '검정 티셔츠',
      locationRaw: 'A-01',
      receivedOnRaw: SECOND_PRIORITY_DATE,
      unitsPerBoxRaw: '',
      remainingBoxesRaw: '',
      note: '수량 미확인',
      sourceRowNumber: 4,
    },
    {
      externalRowId: 'inb_fixture_first',
      sourceStyleNo: 'M100',
      sourceProductName: '검정 티셔츠',
      locationRaw: 'A-02',
      receivedOnRaw: '000000',
      unitsPerBoxRaw: '20',
      remainingBoxesRaw: '2',
      note: '최우선',
      sourceRowNumber: 5,
    },
    {
      externalRowId: 'inb_fixture_picking',
      sourceStyleNo: 'M0487',
      sourceProductName: '슬림백 블랙',
      locationRaw: 'PICK-1',
      receivedOnRaw: '250817',
      unitsPerBoxRaw: '20',
      remainingBoxesRaw: '3',
      note: '등록된 출고 자리',
      sourceRowNumber: 6,
    },
  ]
  const start = 7
  for (let index = rows.length; index < count; index += 1) {
    rows.push({
      externalRowId: `inb_fixture_${String(index).padStart(5, '0')}`,
      sourceStyleNo: 'M100',
      sourceProductName: '검정 티셔츠',
      locationRaw: `B-${index}`,
      receivedOnRaw: '250101',
      unitsPerBoxRaw: '20',
      remainingBoxesRaw: '1',
      note: '',
      sourceRowNumber: start + index - 4,
    })
  }
  return { rows, pickingCodes: ['PICK-1'] }
}
