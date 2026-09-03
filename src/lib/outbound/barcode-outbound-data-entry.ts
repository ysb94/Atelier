import {
  applyIdleCollectStyleLookup,
  idleCollectRowLinked,
  type IdleCollectRow,
} from '@/lib/bulk-outbound/idle-collect'
import {
  compactOutboundPartnerKey,
  normalizeOutboundPartnerName,
  outboundPartnerUnitLabel,
} from '@/lib/codes/outbound-partner'
import type { ParsedSheet } from '@/lib/import/parse'
import type { CodeUsageTarget, CodeUsageTargetAlias, StyleRef } from '@/lib/types'

const VISIBLE_KEY_PREFIX = 'atelier:barcode-outbound-data-entry-target-ids:'
const DRAFT_KEY_PREFIX = 'atelier:barcode-outbound-data-entry-draft:'

export const BARCODE_DATA_ENTRY_SOURCE_REF_PREFIX = 'barcode-data-entry:'

export type BarcodeDataEntrySiteStatus =
  | 'matched'
  | 'unmatched'
  | 'inactive'
  | 'empty'

export type BarcodeDataEntryRow = {
  productName: string
  qty: number
  siteName: string
  styleNo: string
  styleId: string
  usageTargetId: string
  officialSiteName: string
  siteStatus: BarcodeDataEntrySiteStatus
}

export type BarcodeDataEntrySite = {
  key: string
  rawNames: string[]
  displayName: string
  rowCount: number
  status: BarcodeDataEntrySiteStatus
  usageTargetId: string | null
  officialName: string | null
}

export type BarcodeDataEntryDraft = {
  rows: BarcodeDataEntryRow[]
  note: string
}

export type BarcodeDataEntryBackupEntry = {
  usageTargetId: string
  styleId: string
  quantity: number
}

const NAME_HEADERS = [
  '상품명',
  '공식상품명',
  '품명',
  '상품이름',
  '상품',
  'productname',
]
const QTY_HEADERS = ['수량', '발주수량', '확정수량', 'qty', 'quantity']
const SITE_HEADERS = [
  '지점',
  '지점명',
  '매장',
  '매장명',
  '점포',
  '점포명',
  'site',
  'storename',
]

function normalizeHeader(value: string) {
  return value
    .normalize('NFC')
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\s_\-/().]/g, '')
    .toLocaleLowerCase('ko-KR')
    .trim()
}

function headerIndex(headerRow: string[], candidates: string[]) {
  const wanted = new Set(candidates.map(normalizeHeader))
  return headerRow.findIndex((cell) => wanted.has(normalizeHeader(cell)))
}

function parseQty(value: string) {
  const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function emptyStyleFields() {
  return { styleNo: '', styleId: '' }
}

function emptySiteFields(): Pick<
  BarcodeDataEntryRow,
  'usageTargetId' | 'officialSiteName' | 'siteStatus'
> {
  return {
    usageTargetId: '',
    officialSiteName: '',
    siteStatus: 'empty',
  }
}

export function emptyBarcodeDataEntryRow(
  input: Pick<BarcodeDataEntryRow, 'productName' | 'qty' | 'siteName'>,
): BarcodeDataEntryRow {
  return {
    productName: input.productName,
    qty: input.qty,
    siteName: normalizeOutboundPartnerName(input.siteName),
    ...emptyStyleFields(),
    ...emptySiteFields(),
  }
}

export function barcodeDataEntryCompanyKey(
  target: Pick<CodeUsageTarget, 'id' | 'groupId'>,
) {
  return target.groupId ?? `legacy:${target.id}`
}

export function barcodeDataEntrySourceRef(companyKey: string) {
  return `${BARCODE_DATA_ENTRY_SOURCE_REF_PREFIX}${companyKey}`
}

export function barcodeDataEntryVisibleKey(brandId: string) {
  return `${VISIBLE_KEY_PREFIX}${brandId}`
}

export function barcodeDataEntryDraftKey(brandId: string, companyKey: string) {
  return `${DRAFT_KEY_PREFIX}${brandId}:${companyKey}`
}

export function todayIsoDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  return `${year}-${month}-${day}`
}

export function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function siteNameKey(value: string) {
  return compactOutboundPartnerKey(normalizeOutboundPartnerName(value))
}

/** null = 아직 설정 안 함(전체 표시). 빈 배열 = 의도적으로 없음. */
export function readBarcodeDataEntryVisibleIds(
  brandId: string,
): string[] | null {
  try {
    const raw = localStorage.getItem(barcodeDataEntryVisibleKey(brandId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return null
  }
}

export function writeBarcodeDataEntryVisibleIds(
  brandId: string,
  ids: string[],
) {
  localStorage.setItem(
    barcodeDataEntryVisibleKey(brandId),
    JSON.stringify([...new Set(ids)]),
  )
}

export function visibleCompanyKeysFromUnitIds(
  targets: readonly CodeUsageTarget[],
  visibleIds: string[] | null,
): Set<string> | null {
  if (visibleIds == null) return null
  const byId = new Map(targets.map((target) => [target.id, target]))
  const keys = new Set<string>()
  for (const id of visibleIds) {
    const target = byId.get(id)
    if (target) keys.add(barcodeDataEntryCompanyKey(target))
  }
  return keys
}

export function unitIdsForCompanyKeys(
  targets: readonly CodeUsageTarget[],
  companyKeys: ReadonlySet<string>,
) {
  return targets
    .filter((target) => companyKeys.has(barcodeDataEntryCompanyKey(target)))
    .map((target) => target.id)
}

export function filterTargetsByVisibleIds(
  targets: readonly CodeUsageTarget[],
  visibleIds: string[] | null,
): CodeUsageTarget[] {
  const companyKeys = visibleCompanyKeysFromUnitIds(targets, visibleIds)
  if (companyKeys == null) return [...targets]
  return targets.filter((target) =>
    companyKeys.has(barcodeDataEntryCompanyKey(target)),
  )
}

function isBarcodeDataEntryRow(value: unknown): value is BarcodeDataEntryRow {
  if (!value || typeof value !== 'object') return false
  const row = value as BarcodeDataEntryRow
  return (
    typeof row.productName === 'string' &&
    typeof row.qty === 'number' &&
    Number.isFinite(row.qty)
  )
}

function normalizeDraftRow(value: unknown): BarcodeDataEntryRow | null {
  if (!isBarcodeDataEntryRow(value)) return null
  const status = value.siteStatus
  const siteStatus: BarcodeDataEntrySiteStatus =
    status === 'matched' ||
    status === 'unmatched' ||
    status === 'inactive' ||
    status === 'empty'
      ? status
      : 'empty'
  return {
    productName: value.productName,
    qty: value.qty,
    siteName: typeof value.siteName === 'string' ? value.siteName : '',
    styleNo: typeof value.styleNo === 'string' ? value.styleNo : '',
    styleId: typeof value.styleId === 'string' ? value.styleId : '',
    usageTargetId:
      typeof value.usageTargetId === 'string' ? value.usageTargetId : '',
    officialSiteName:
      typeof value.officialSiteName === 'string' ? value.officialSiteName : '',
    siteStatus,
  }
}

export function emptyBarcodeDataEntryDraft(): BarcodeDataEntryDraft {
  return { rows: [], note: '' }
}

export function readBarcodeDataEntryDraft(
  brandId: string,
  companyKey: string,
): BarcodeDataEntryDraft {
  try {
    const raw = localStorage.getItem(
      barcodeDataEntryDraftKey(brandId, companyKey),
    )
    if (!raw) return emptyBarcodeDataEntryDraft()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return emptyBarcodeDataEntryDraft()
    }
    const draft = parsed as { rows?: unknown; note?: unknown }
    const rows = Array.isArray(draft.rows)
      ? draft.rows
          .map(normalizeDraftRow)
          .filter((row): row is BarcodeDataEntryRow => row != null)
      : []
    return {
      rows,
      note: typeof draft.note === 'string' ? draft.note : '',
    }
  } catch {
    return emptyBarcodeDataEntryDraft()
  }
}

export function writeBarcodeDataEntryDraft(
  brandId: string,
  companyKey: string,
  draft: BarcodeDataEntryDraft,
) {
  localStorage.setItem(
    barcodeDataEntryDraftKey(brandId, companyKey),
    JSON.stringify({
      rows: draft.rows,
      note: draft.note,
    }),
  )
}

export function aliasesByTargetId(
  aliases: readonly CodeUsageTargetAlias[],
): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const alias of aliases) {
    const list = map.get(alias.targetId) ?? []
    list.push(alias.alias)
    map.set(alias.targetId, list)
  }
  return map
}

export function buildCompanySiteIndex(
  units: readonly CodeUsageTarget[],
  aliasesByTarget: ReadonlyMap<string, readonly string[]>,
): Map<string, CodeUsageTarget> {
  const index = new Map<string, CodeUsageTarget>()

  function add(key: string, unit: CodeUsageTarget) {
    if (!key || index.has(key)) return
    index.set(key, unit)
  }

  for (const unit of units) {
    add(siteNameKey(unit.siteName), unit)
    add(siteNameKey(outboundPartnerUnitLabel(unit)), unit)
    add(siteNameKey(unit.name), unit)
    add(unit.normalizedSiteName, unit)
    add(unit.normalizedName, unit)
    for (const alias of aliasesByTarget.get(unit.id) ?? []) {
      add(siteNameKey(alias), unit)
    }
  }
  return index
}

export function resolveBarcodeDataEntrySite(
  siteName: string,
  index: ReadonlyMap<string, CodeUsageTarget>,
  singleUnit: CodeUsageTarget | null = null,
): Pick<
  BarcodeDataEntryRow,
  'usageTargetId' | 'officialSiteName' | 'siteStatus'
> {
  const key = siteNameKey(siteName)
  if (!key) {
    if (!singleUnit) return emptySiteFields()
    return {
      usageTargetId: singleUnit.id,
      officialSiteName: outboundPartnerUnitLabel(singleUnit),
      siteStatus: singleUnit.active ? 'matched' : 'inactive',
    }
  }
  const hit = index.get(key)
  if (!hit) {
    return {
      usageTargetId: '',
      officialSiteName: '',
      siteStatus: 'unmatched',
    }
  }
  return {
    usageTargetId: hit.id,
    officialSiteName: outboundPartnerUnitLabel(hit),
    siteStatus: hit.active ? 'matched' : 'inactive',
  }
}

export function applyBarcodeDataEntrySiteLookup(
  rows: readonly BarcodeDataEntryRow[],
  units: readonly CodeUsageTarget[],
  aliasesByTarget: ReadonlyMap<string, readonly string[]>,
): BarcodeDataEntryRow[] {
  const index = buildCompanySiteIndex(units, aliasesByTarget)
  const singleUnit = units.length === 1 ? (units[0] ?? null) : null
  return rows.map((row) => ({
    ...row,
    ...resolveBarcodeDataEntrySite(row.siteName, index, singleUnit),
  }))
}

export function keepBarcodeDataEntryLinks(
  next: readonly BarcodeDataEntryRow[],
  previous: readonly BarcodeDataEntryRow[],
): BarcodeDataEntryRow[] {
  const leftover = [...previous]
  return next.map((row) => {
    const index = leftover.findIndex(
      (item) =>
        item.productName === row.productName && item.siteName === row.siteName,
    )
    if (index < 0) return { ...row }
    const [matched] = leftover.splice(index, 1)
    return {
      ...row,
      styleNo: row.styleNo || matched.styleNo,
      styleId: row.styleId || matched.styleId,
    }
  })
}

export function applyBarcodeDataEntryStyleLookup(
  rows: readonly BarcodeDataEntryRow[],
  lookup: { byName: Map<string, StyleRef[]> },
): BarcodeDataEntryRow[] {
  const asIdle: IdleCollectRow[] = rows.map((row) => ({
    productName: row.productName,
    qty: row.qty,
    styleNo: row.styleNo,
    styleId: row.styleId,
  }))
  const resolved = applyIdleCollectStyleLookup(asIdle, lookup)
  return rows.map((row, index) => ({
    ...row,
    styleNo: resolved[index]?.styleNo ?? '',
    styleId: resolved[index]?.styleId ?? '',
  }))
}

const LINE_SPLIT = /\r\n|\n|\r/
const COL_SPLIT = /\t+|,|;| {2,}/

function cellsFromPasteLine(line: string) {
  const trimmed = line.replace(/\u00A0/g, ' ').replace(/^\uFEFF/, '').trim()
  if (!trimmed) return []
  const cells = trimmed
    .split(COL_SPLIT)
    .map((cell) => cell.trim())
    .filter(Boolean)
  if (cells.length >= 2) return cells
  const match = trimmed.match(/^(.+?)\s+(\d+)\s+(.+)$/)
  if (match) return [match[1].trim(), match[2], match[3].trim()]
  const two = trimmed.match(/^(.+?)\s+(\d+)\s*$/)
  if (!two) return []
  return [two[1].trim(), two[2]]
}

function rowFromCells(
  productName: string,
  qty: number,
  siteName: string,
): BarcodeDataEntryRow | null {
  const name = productName.trim()
  if (!name) return null
  return emptyBarcodeDataEntryRow({
    productName: name,
    qty,
    siteName,
  })
}

function rowFromPlainCells(cells: string[]): BarcodeDataEntryRow | null {
  if (cells.length >= 3) {
    const qty = parseQty(cells[1] ?? '')
    if (qty > 0) {
      return rowFromCells(
        cells[0] ?? '',
        qty,
        cells.slice(2).join(' '),
      )
    }
  }
  const qty = parseQty(cells[cells.length - 1] ?? '')
  if (qty <= 0) return null
  return rowFromCells(cells.slice(0, -1).join(' '), qty, '')
}

export function parseBarcodeDataEntryText(text: string): {
  rows: BarcodeDataEntryRow[]
  error: string | null
} {
  const rawRows = text
    .replace(/^\uFEFF/, '')
    .split(LINE_SPLIT)
    .map(cellsFromPasteLine)
    .filter((cells) => cells.length >= 2)

  if (rawRows.length === 0) {
    return {
      rows: [],
      error: '붙여넣은 내용에서 상품명·수량·지점을 찾지 못했습니다.',
    }
  }

  const headerRow = rawRows[0] ?? []
  const nameHeaderIndex = headerIndex(headerRow, NAME_HEADERS)
  const qtyHeaderIndex = headerIndex(headerRow, QTY_HEADERS)
  const siteHeaderIndex = headerIndex(headerRow, SITE_HEADERS)
  const hasHeader = nameHeaderIndex >= 0 && qtyHeaderIndex >= 0
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows

  const rows: BarcodeDataEntryRow[] = []
  for (const cells of dataRows) {
    const parsed = hasHeader
      ? rowFromCells(
          cells[nameHeaderIndex] ?? '',
          parseQty(cells[qtyHeaderIndex] ?? ''),
          siteHeaderIndex >= 0
            ? (cells[siteHeaderIndex] ?? '')
            : (cells[2] ?? ''),
        )
      : rowFromPlainCells(cells)
    if (parsed) rows.push(parsed)
  }

  if (rows.length === 0) {
    return {
      rows: [],
      error: '붙여넣은 내용에서 상품명·수량·지점을 찾지 못했습니다.',
    }
  }
  return { rows, error: null }
}

export function parseBarcodeDataEntrySheets(sheets: ParsedSheet[]): {
  rows: BarcodeDataEntryRow[]
  error: string | null
} {
  for (const sheet of sheets) {
    for (
      let headerRowIndex = 0;
      headerRowIndex < Math.min(sheet.rows.length, 8);
      headerRowIndex += 1
    ) {
      const headerRow = sheet.rows[headerRowIndex] ?? []
      const nameIndex = headerIndex(headerRow, NAME_HEADERS)
      const qtyIndex = headerIndex(headerRow, QTY_HEADERS)
      if (nameIndex < 0 || qtyIndex < 0) continue
      const siteIndex = headerIndex(headerRow, SITE_HEADERS)
      const rows: BarcodeDataEntryRow[] = []
      for (const cells of sheet.rows.slice(headerRowIndex + 1)) {
        const parsed = rowFromCells(
          cells[nameIndex] ?? '',
          parseQty(cells[qtyIndex] ?? ''),
          siteIndex >= 0 ? (cells[siteIndex] ?? '') : (cells[2] ?? ''),
        )
        if (parsed) rows.push(parsed)
      }
      if (rows.length === 0) {
        return {
          rows: [],
          error: '상품명·수량이 있는 행을 찾지 못했습니다.',
        }
      }
      return { rows, error: null }
    }
  }
  return {
    rows: [],
    error:
      '첫 행에 「상품명」과 「수량」 헤더가 있어야 합니다. 「지점명」 열은 있으면 읽습니다.',
  }
}

export function barcodeDataEntryStyleLinked(row: BarcodeDataEntryRow) {
  return idleCollectRowLinked(row)
}

export function barcodeDataEntrySiteLinked(row: BarcodeDataEntryRow) {
  return row.siteStatus === 'matched' && Boolean(row.usageTargetId)
}

export function barcodeDataEntryRowReady(row: BarcodeDataEntryRow) {
  return barcodeDataEntryStyleLinked(row) && barcodeDataEntrySiteLinked(row)
}

export function barcodeDataEntryAllReady(rows: readonly BarcodeDataEntryRow[]) {
  return rows.length > 0 && rows.every((row) => barcodeDataEntryRowReady(row))
}

export function barcodeDataEntryStyleLinkedCount(
  rows: readonly BarcodeDataEntryRow[],
) {
  return rows.filter((row) => barcodeDataEntryStyleLinked(row)).length
}

export function barcodeDataEntryDisplayRows(
  rows: readonly BarcodeDataEntryRow[],
) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftBlocked = !barcodeDataEntryRowReady(left.row)
      const rightBlocked = !barcodeDataEntryRowReady(right.row)
      if (leftBlocked === rightBlocked) return left.index - right.index
      return leftBlocked ? -1 : 1
    })
}

export function collectBarcodeDataEntrySites(
  rows: readonly BarcodeDataEntryRow[],
): BarcodeDataEntrySite[] {
  const groups = new Map<
    string,
    {
      rawNames: Set<string>
      rowCount: number
      status: BarcodeDataEntrySiteStatus
      usageTargetId: string | null
      officialName: string | null
    }
  >()

  for (const row of rows) {
    const key = siteNameKey(row.siteName)
    const current = groups.get(key)
    if (current) {
      if (row.siteName) current.rawNames.add(row.siteName)
      current.rowCount += 1
      continue
    }
    groups.set(key, {
      rawNames: row.siteName ? new Set([row.siteName]) : new Set(),
      rowCount: 1,
      status: row.siteStatus,
      usageTargetId: row.usageTargetId || null,
      officialName: row.officialSiteName || null,
    })
  }

  return [...groups.entries()]
    .map(([key, group]) => {
      const rawNames = [...group.rawNames].sort((left, right) =>
        left.localeCompare(right, 'ko'),
      )
      return {
        key,
        rawNames,
        displayName: rawNames[0] || '(빈 값)',
        rowCount: group.rowCount,
        status: group.status,
        usageTargetId: group.usageTargetId,
        officialName: group.officialName,
      }
    })
    .sort((left, right) => {
      const rank = { empty: 0, unmatched: 1, inactive: 2, matched: 3 }
      return (
        rank[left.status] - rank[right.status] ||
        left.displayName.localeCompare(right.displayName, 'ko')
      )
    })
}

export function barcodeDataEntryUnresolvedSites(
  rows: readonly BarcodeDataEntryRow[],
) {
  return collectBarcodeDataEntrySites(rows).filter(
    (site) => site.status !== 'matched',
  )
}

export function barcodeDataEntryBackupEntries(
  rows: readonly BarcodeDataEntryRow[],
): BarcodeDataEntryBackupEntry[] {
  const merged = new Map<string, BarcodeDataEntryBackupEntry>()
  for (const row of rows) {
    if (!barcodeDataEntryRowReady(row) || row.qty <= 0) continue
    const key = `${row.usageTargetId}:${row.styleId}`
    const existing = merged.get(key)
    if (existing) {
      existing.quantity += row.qty
      continue
    }
    merged.set(key, {
      usageTargetId: row.usageTargetId,
      styleId: row.styleId,
      quantity: row.qty,
    })
  }
  return [...merged.values()]
}
