import { normalizeStyleNo } from '@/lib/import/transform'
import type {
  WarehouseQuantityStatus,
  WarehouseReviewFlag,
  WarehouseUsagePriority,
  WarehouseZone,
} from '@/lib/types'
import {
  WAREHOUSE_REVIEW_FLAG_LABEL,
  WAREHOUSE_USAGE_PRIORITY_LABEL,
  WAREHOUSE_USAGE_PRIORITY_ORDER,
  formatWarehouseLocation,
  formatWarehouseReceivedOn,
  isWarehouseQuantityKnown,
  parseWarehouseLocation,
} from '@/lib/warehouse/stock'

export const WAREHOUSE_FINDER_SEARCH_MODES = [
  'product',
  'warehouse',
  'mnumber',
] as const

export type WarehouseFinderSearchMode =
  (typeof WAREHOUSE_FINDER_SEARCH_MODES)[number]

export const WAREHOUSE_FINDER_SEARCH_LIMITS = {
  product: 100,
  warehouse: 200,
  mnumber: 100,
  inbounds: 200,
} as const

export const WAREHOUSE_FINDER_HISTORY_KEY = 'atelier:warehouse-finder-history'
export const WAREHOUSE_FINDER_HISTORY_MAX = 10 // 검색 모드별 상한
export const WAREHOUSE_FINDER_SUGGESTION_DEBOUNCE_MS = 150

export const WAREHOUSE_FINDER_SEARCH_MODE_LABEL: Record<
  WarehouseFinderSearchMode,
  string
> = {
  product: '상품명',
  warehouse: '창고자리',
  mnumber: 'M번호',
}

export const WAREHOUSE_FINDER_FIELD_MAP = [
  {
    sheet: 'B · M번호',
    firestore: 'chinaCode',
    supabase: 'source_style_no / normalized_style_no',
    note: '검색 키는 styles.style_no exact. 상품명으로 우회하지 않는다.',
  },
  {
    sheet: 'C · 제품명',
    firestore: 'productName',
    supabase: 'source_product_name',
    note: '카드 기본 이름은 시트 원문. 연결되면 styles.name을 공식명으로 곁들인다.',
  },
  {
    sheet: 'D · 창고 자리번호',
    firestore: 'libraryNumber',
    supabase: 'warehouse_locations.code + is_final_location',
    note: '끝 //는 자리 코드가 아니라 마지막 위치 표시다.',
  },
  {
    sheet: 'E · 입고일',
    firestore: 'arrivalDate',
    supabase: 'received_on + received_on_raw',
    note: '000000 최우선, 000001 차순위, 999999 마지막. 빈 칸은 000000으로 본다.',
  },
  {
    sheet: 'F · 박스당 갯수',
    firestore: 'unitsPerBox',
    supabase: 'units_per_box + units_per_box_raw',
    note: '빈 값은 0/1로 추정하지 않고 unknown이다.',
  },
  {
    sheet: 'G · 박스 수',
    firestore: 'boxCount',
    supabase: 'remaining_boxes + remaining_boxes_raw',
    note: '남은 박스. 미확인이면 계산 수량을 합산하지 않는다.',
  },
  {
    sheet: 'H · 비고',
    firestore: 'note',
    supabase: 'note',
    note: '원문 유지.',
  },
  {
    sheet: 'AA · 행 ID',
    firestore: '문서 ID',
    supabase: 'external_row_id',
    note: '이중 조회·전환 검증의 기본 키.',
  },
  {
    sheet: 'X · 상품 참조',
    firestore: 'productRef',
    supabase: '(brand_id, style_id)',
    note: 'Firebase 문서 경로 대신 SKU FK. 이름 매칭으로 덮어쓰지 않는다.',
  },
] as const

export type WarehouseFinderParityRow = {
  externalRowId: string
  chinaCode: string
  productName: string
  libraryNumber: string
  arrivalDateRaw: string
  unitsPerBoxRaw: string
  boxCountRaw: string
  note: string
}

export type WarehouseFinderCard = {
  positionId: string
  setId: string
  externalRowId: string
  productName: string
  officialStyleName: string
  styleId: string | null
  styleNo: string
  sourceStyleNo: string
  locationCode: string
  locationDisplay: string
  locationBase: string
  isFinalLocation: boolean
  zone: WarehouseZone
  receivedOn: string | null
  receivedOnRaw: string
  receivedOnLabel: string
  usagePriority: WarehouseUsagePriority
  quantityStatus: WarehouseQuantityStatus
  unitsPerBox: number | null
  remainingBoxes: number | null
  openedUnits: number
  computedQty: number | null
  reviewFlags: WarehouseReviewFlag[]
  note: string
  /** 같은 자리 전체의 중복 제거된 제품 종류 수. 입고 건수가 아니다. */
  inboundCount: number
}

export type WarehouseFinderSearchQuery = {
  mode: WarehouseFinderSearchMode
  raw: string
  normalized: string
  styleNoCandidates: string[]
  limit: number
}

export type WarehouseFinderParityMismatch = {
  externalRowId: string
  field: keyof Omit<WarehouseFinderParityRow, 'externalRowId'>
  left: string
  right: string
}

export type WarehouseFinderParityReport = {
  leftCount: number
  rightCount: number
  matched: number
  missingInRight: string[]
  missingInLeft: string[]
  fieldMismatches: WarehouseFinderParityMismatch[]
  ok: boolean
}

export type WarehouseFinderSwitchDecision = {
  ready: boolean
  reasons: string[]
}

function compactText(value: string) {
  return String(value ?? '').trim()
}

export function warehouseLocationBase(raw: string) {
  return compactText(raw).replace(/\/\/$/, '')
}

/**
 * 창고 자리 단축 입력. 예: 211 → 2-1-1, 4012 → 4-0-12, $12 → $-1-2
 * 이미 `-`가 있으면 자리 base만 남긴다.
 */
export function expandWarehouseFinderShortcut(raw: string) {
  const cleaned = compactText(raw).replace(/\s+/g, '')
  if (!cleaned) return ''
  if (cleaned.includes('-')) return warehouseLocationBase(cleaned)

  const symbolMatch = cleaned.match(/^([$%#!])(.+)$/)
  if (symbolMatch) {
    const [, symbol, rest] = symbolMatch
    if (rest.length >= 2 && /^\d[\d.]*$/.test(rest)) {
      return warehouseLocationBase(`${symbol}-${rest[0]}-${rest.slice(1)}`)
    }
    return warehouseLocationBase(cleaned)
  }

  if (cleaned.length >= 3 && /^\d\d[\d.]+$/.test(cleaned)) {
    return warehouseLocationBase(
      `${cleaned[0]}-${cleaned[1]}-${cleaned.slice(2)}`,
    )
  }

  return warehouseLocationBase(cleaned)
}

export function buildWarehouseFinderStyleNoCandidates(value: string) {
  const normalized = normalizeStyleNo(value)
  if (!normalized) return []

  const candidates = new Set<string>([normalized])
  if (/^M\d+$/.test(normalized)) candidates.add(normalized.slice(1))
  else if (/^\d+$/.test(normalized)) candidates.add(`M${normalized}`)
  return Array.from(candidates)
}

export function normalizeWarehouseFinderQuery(
  mode: WarehouseFinderSearchMode,
  raw: string,
): WarehouseFinderSearchQuery {
  const trimmed = compactText(raw)
  if (mode === 'warehouse') {
    const normalized = expandWarehouseFinderShortcut(trimmed)
    return {
      mode,
      raw: trimmed,
      normalized,
      styleNoCandidates: [],
      limit: WAREHOUSE_FINDER_SEARCH_LIMITS.warehouse,
    }
  }
  if (mode === 'mnumber') {
    const styleNoCandidates = buildWarehouseFinderStyleNoCandidates(trimmed)
    return {
      mode,
      raw: trimmed,
      normalized: styleNoCandidates[0] ?? normalizeStyleNo(trimmed),
      styleNoCandidates,
      limit: WAREHOUSE_FINDER_SEARCH_LIMITS.mnumber,
    }
  }
  return {
    mode,
    raw: trimmed,
    normalized: trimmed,
    styleNoCandidates: [],
    limit: WAREHOUSE_FINDER_SEARCH_LIMITS.product,
  }
}

export function warehouseFinderComputedQty(row: {
  quantityStatus?: WarehouseQuantityStatus | null
  unitsPerBox?: number | null
  remainingBoxes?: number | null
  openedUnits?: number | null
}) {
  if (!isWarehouseQuantityKnown(row)) return null
  return (row.remainingBoxes ?? 0) * (row.unitsPerBox ?? 0) + (row.openedUnits ?? 0)
}

export function formatWarehouseFinderLibraryNumber(row: {
  locationCode: string
  isFinalLocation: boolean
}) {
  return formatWarehouseLocation(row)
}

export function mapSheetWarehouseRowToParity(row: {
  externalRowId?: string
  sourceStyleNo?: string
  sourceProductName?: string
  locationRaw?: string
  receivedOnRaw?: string
  unitsPerBoxRaw?: string
  remainingBoxesRaw?: string
  note?: string
}): WarehouseFinderParityRow {
  const location = parseWarehouseLocation(compactText(row.locationRaw ?? ''))
  return {
    externalRowId: compactText(row.externalRowId ?? ''),
    chinaCode: compactText(row.sourceStyleNo ?? ''),
    productName: compactText(row.sourceProductName ?? ''),
    libraryNumber: formatWarehouseLocation(location),
    arrivalDateRaw: compactText(row.receivedOnRaw ?? ''),
    unitsPerBoxRaw: compactText(row.unitsPerBoxRaw ?? ''),
    boxCountRaw: compactText(row.remainingBoxesRaw ?? ''),
    note: compactText(row.note ?? ''),
  }
}

export function mapFirestoreSearchDocToParity(row: {
  _id?: string
  id?: string
  chinaCode?: string
  productName?: string
  libraryNumber?: string
  arrivalDate?: string
  unitsPerBox?: string | number
  boxCount?: string | number
  note?: string
}): WarehouseFinderParityRow {
  return {
    externalRowId: compactText(row._id ?? row.id ?? ''),
    chinaCode: compactText(row.chinaCode ?? ''),
    productName: compactText(row.productName ?? ''),
    libraryNumber: compactText(row.libraryNumber ?? ''),
    arrivalDateRaw: compactText(String(row.arrivalDate ?? '')),
    unitsPerBoxRaw: compactText(String(row.unitsPerBox ?? '')),
    boxCountRaw: compactText(String(row.boxCount ?? '')),
    note: compactText(row.note ?? ''),
  }
}

export function mapSupabasePositionToParity(row: {
  externalRowId?: string | null
  sourceStyleNo?: string
  sourceProductName?: string
  locationCode?: string
  isFinalLocation?: boolean
  receivedOnRaw?: string
  unitsPerBoxRaw?: string
  remainingBoxesRaw?: string
  note?: string
}): WarehouseFinderParityRow {
  return {
    externalRowId: compactText(row.externalRowId ?? ''),
    chinaCode: compactText(row.sourceStyleNo ?? ''),
    productName: compactText(row.sourceProductName ?? ''),
    libraryNumber: formatWarehouseLocation({
      locationCode: compactText(row.locationCode ?? ''),
      isFinalLocation: Boolean(row.isFinalLocation),
    }),
    arrivalDateRaw: compactText(row.receivedOnRaw ?? ''),
    unitsPerBoxRaw: compactText(row.unitsPerBoxRaw ?? ''),
    boxCountRaw: compactText(row.remainingBoxesRaw ?? ''),
    note: compactText(row.note ?? ''),
  }
}

export function toWarehouseFinderCard(row: {
  positionId: string
  setId: string
  externalRowId?: string | null
  productName?: string
  officialStyleName?: string | null
  styleId?: string | null
  styleNo?: string
  sourceStyleNo?: string
  locationCode: string
  isFinalLocation: boolean
  zone: WarehouseZone
  receivedOn: string | null
  receivedOnRaw: string
  usagePriority: WarehouseUsagePriority
  quantityStatus: WarehouseQuantityStatus
  unitsPerBox: number | null
  remainingBoxes: number | null
  openedUnits?: number | null
  reviewFlags?: WarehouseReviewFlag[]
  note?: string
  inboundCount?: number
}): WarehouseFinderCard {
  const locationDisplay = formatWarehouseLocation(row)
  const styleNo = normalizeStyleNo(row.styleNo ?? row.sourceStyleNo ?? '')
  const productName = compactText(row.productName ?? '')
  const officialStyleName = compactText(row.officialStyleName ?? '')
  return {
    positionId: row.positionId,
    setId: row.setId,
    externalRowId: compactText(row.externalRowId ?? ''),
    productName,
    officialStyleName:
      officialStyleName && officialStyleName !== productName
        ? officialStyleName
        : '',
    styleId: row.styleId ?? null,
    styleNo,
    sourceStyleNo: compactText(row.sourceStyleNo ?? ''),
    locationCode: compactText(row.locationCode),
    locationDisplay,
    locationBase: warehouseLocationBase(locationDisplay),
    isFinalLocation: row.isFinalLocation,
    zone: row.zone,
    receivedOn: row.receivedOn,
    receivedOnRaw: row.receivedOnRaw,
    receivedOnLabel: formatWarehouseReceivedOn(row),
    usagePriority: row.usagePriority,
    quantityStatus: row.quantityStatus,
    unitsPerBox: row.unitsPerBox,
    remainingBoxes: row.remainingBoxes,
    openedUnits: row.openedUnits ?? 0,
    computedQty: warehouseFinderComputedQty(row),
    reviewFlags: row.reviewFlags ?? [],
    note: compactText(row.note ?? ''),
    inboundCount: row.inboundCount ?? 0,
  }
}

function compareFinderArrival(
  left: Pick<WarehouseFinderCard, 'usagePriority' | 'receivedOn' | 'receivedOnRaw'>,
  right: Pick<WarehouseFinderCard, 'usagePriority' | 'receivedOn' | 'receivedOnRaw'>,
) {
  const priority =
    WAREHOUSE_USAGE_PRIORITY_ORDER[left.usagePriority] -
    WAREHOUSE_USAGE_PRIORITY_ORDER[right.usagePriority]
  if (priority !== 0) return priority
  if (left.receivedOn && right.receivedOn && left.receivedOn !== right.receivedOn) {
    return left.receivedOn.localeCompare(right.receivedOn)
  }
  return left.receivedOnRaw.localeCompare(right.receivedOnRaw, 'ko-KR')
}

export function sortWarehouseFinderCards(items: WarehouseFinderCard[]) {
  return [...items].sort((left, right) => {
    const byDate = compareFinderArrival(left, right)
    if (byDate !== 0) return byDate
    if (left.isFinalLocation !== right.isFinalLocation) {
      return left.isFinalLocation ? 1 : -1
    }
    return left.locationDisplay.localeCompare(right.locationDisplay, 'ko-KR')
  })
}

export function dedupeWarehouseFinderCards(items: WarehouseFinderCard[]) {
  const map = new Map<string, WarehouseFinderCard>()
  for (const item of items) {
    const key = [
      item.productName,
      item.locationBase,
      item.externalRowId || item.positionId,
    ].join('|')
    const prev = map.get(key)
    if (!prev || compareFinderArrival(prev, item) > 0) map.set(key, item)
  }
  return Array.from(map.values())
}

export function finalizeWarehouseFinderResults(
  query: WarehouseFinderSearchQuery,
  items: WarehouseFinderCard[],
) {
  const source = Array.isArray(items) ? items : []
  if (query.mode === 'product' && query.normalized) {
    const exact = source.filter((item) => item.productName === query.normalized)
    if (exact.length > 0) {
      return sortWarehouseFinderCards(dedupeWarehouseFinderCards(exact))
    }
  }
  return sortWarehouseFinderCards(dedupeWarehouseFinderCards(source))
}

export function warehouseFinderProductKindKey(row: {
  styleNo?: string
  sourceStyleNo?: string
  productName?: string
}) {
  const styleNo = compactText(row.styleNo ?? '')
  if (styleNo) return styleNo
  const sourceStyleNo = compactText(row.sourceStyleNo ?? '')
    .replace(/\s+/g, '')
    .toUpperCase()
  if (sourceStyleNo) return sourceStyleNo
  return compactText(row.productName ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ko-KR')
}

export function uniqueWarehouseFinderProductNames(items: WarehouseFinderCard[]) {
  const names = new Map<string, string>()
  for (const item of items) {
    const name = compactText(item.productName).normalize('NFKC')
    const key = name.toLocaleLowerCase('ko-KR')
    if (name && !names.has(key)) names.set(key, name)
  }
  return Array.from(names.values())
}

export function warehouseFinderWarningLabels(flags: WarehouseReviewFlag[]) {
  return flags.map((flag) => WAREHOUSE_REVIEW_FLAG_LABEL[flag])
}

export function warehouseFinderPriorityLabel(priority: WarehouseUsagePriority) {
  return WAREHOUSE_USAGE_PRIORITY_LABEL[priority]
}

export function compareWarehouseFinderParity(
  left: WarehouseFinderParityRow[],
  right: WarehouseFinderParityRow[],
): WarehouseFinderParityReport {
  const leftMap = new Map(
    left
      .filter((row) => row.externalRowId)
      .map((row) => [row.externalRowId, row]),
  )
  const rightMap = new Map(
    right
      .filter((row) => row.externalRowId)
      .map((row) => [row.externalRowId, row]),
  )
  const missingInRight = [...leftMap.keys()].filter((id) => !rightMap.has(id))
  const missingInLeft = [...rightMap.keys()].filter((id) => !leftMap.has(id))
  const fieldMismatches: WarehouseFinderParityMismatch[] = []
  const fields: Array<keyof Omit<WarehouseFinderParityRow, 'externalRowId'>> = [
    'chinaCode',
    'productName',
    'libraryNumber',
    'arrivalDateRaw',
    'unitsPerBoxRaw',
    'boxCountRaw',
    'note',
  ]
  for (const [id, leftRow] of leftMap) {
    const rightRow = rightMap.get(id)
    if (!rightRow) continue
    for (const field of fields) {
      if (leftRow[field] !== rightRow[field]) {
        fieldMismatches.push({
          externalRowId: id,
          field,
          left: leftRow[field],
          right: rightRow[field],
        })
      }
    }
  }
  return {
    leftCount: leftMap.size,
    rightCount: rightMap.size,
    matched: leftMap.size - missingInRight.length,
    missingInRight,
    missingInLeft,
    fieldMismatches,
    ok:
      missingInRight.length === 0 &&
      missingInLeft.length === 0 &&
      fieldMismatches.length === 0,
  }
}

export function decideWarehouseFinderSwitch(report: WarehouseFinderParityReport) {
  const reasons: string[] = []
  if (report.leftCount !== report.rightCount) {
    reasons.push(
      `행 수가 다릅니다. Firebase ${report.leftCount} / Supabase ${report.rightCount}`,
    )
  }
  if (report.missingInRight.length > 0) {
    reasons.push(`Supabase에 없는 AA ${report.missingInRight.length}건`)
  }
  if (report.missingInLeft.length > 0) {
    reasons.push(`Firebase에 없는 AA ${report.missingInLeft.length}건`)
  }
  if (report.fieldMismatches.length > 0) {
    reasons.push(`필드 불일치 ${report.fieldMismatches.length}건`)
  }
  return {
    ready: reasons.length === 0,
    reasons,
  } satisfies WarehouseFinderSwitchDecision
}

export function shouldSyncAtelierWarehouseSnapshot(input: {
  finishedAll: boolean
  firebaseFailures: number
  independent: boolean
}) {
  if (!input.finishedAll) return false
  if (input.independent) return true
  return input.firebaseFailures === 0
}

export function warehouseFinderHistoryStorageKey(brandId: string) {
  return `${WAREHOUSE_FINDER_HISTORY_KEY}:${brandId}`
}

export type WarehouseFinderHistoryItem = {
  mode: WarehouseFinderSearchMode
  query: string
}

function isWarehouseFinderHistoryItem(
  item: unknown,
): item is WarehouseFinderHistoryItem {
  return (
    Boolean(item) &&
    typeof item === 'object' &&
    WAREHOUSE_FINDER_SEARCH_MODES.includes(
      (item as WarehouseFinderHistoryItem).mode,
    ) &&
    typeof (item as WarehouseFinderHistoryItem).query === 'string'
  )
}

export function warehouseFinderHistoryForMode(
  items: WarehouseFinderHistoryItem[],
  mode: WarehouseFinderSearchMode,
) {
  return items.filter((item) => item.mode === mode)
}

export function capWarehouseFinderHistory(items: WarehouseFinderHistoryItem[]) {
  const seen = new Set<string>()
  const counts: Record<WarehouseFinderSearchMode, number> = {
    product: 0,
    warehouse: 0,
    mnumber: 0,
  }
  const next: WarehouseFinderHistoryItem[] = []
  for (const item of items) {
    const query = compactText(item.query)
    if (!query) continue
    const key = `${item.mode}:${query}`
    if (seen.has(key)) continue
    if (counts[item.mode] >= WAREHOUSE_FINDER_HISTORY_MAX) continue
    seen.add(key)
    counts[item.mode] += 1
    next.push({ mode: item.mode, query })
  }
  return next
}

export function readWarehouseFinderHistory(brandId: string) {
  try {
    const raw = localStorage.getItem(warehouseFinderHistoryStorageKey(brandId))
    if (!raw) return [] as WarehouseFinderHistoryItem[]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return capWarehouseFinderHistory(parsed.filter(isWarehouseFinderHistoryItem))
  } catch {
    // 브라우저 UI 설정. 읽기 실패는 검색에 영향을 주지 않는다.
    return []
  }
}

export function writeWarehouseFinderHistory(
  brandId: string,
  items: WarehouseFinderHistoryItem[],
) {
  try {
    localStorage.setItem(
      warehouseFinderHistoryStorageKey(brandId),
      JSON.stringify(capWarehouseFinderHistory(items)),
    )
  } catch {
    // 브라우저 UI 설정. 저장 실패는 검색에 영향을 주지 않는다.
  }
}

export function pushWarehouseFinderHistory(
  items: WarehouseFinderHistoryItem[],
  next: WarehouseFinderHistoryItem,
) {
  const query = compactText(next.query)
  if (!query) return items
  return capWarehouseFinderHistory([
    { mode: next.mode, query },
    ...items,
  ])
}

export function removeWarehouseFinderHistory(
  items: WarehouseFinderHistoryItem[],
  target: WarehouseFinderHistoryItem,
) {
  const query = compactText(target.query)
  return items.filter(
    (item) => !(item.mode === target.mode && item.query === query),
  )
}
