import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import type { ParsedSheet } from '@/lib/import/parse'
import type { StyleRef } from '@/lib/types'

export type IdleCollectRow = {
  productName: string
  qty: number
  styleNo: string
  styleId: string
}

function emptyStyleFields() {
  return { styleNo: '', styleId: '' }
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

export function parseIdleCollectSheets(sheets: ParsedSheet[]): {
  rows: IdleCollectRow[]
  error: string | null
} {
  for (const sheet of sheets) {
    for (let headerRowIndex = 0; headerRowIndex < Math.min(sheet.rows.length, 8); headerRowIndex += 1) {
      const headerRow = sheet.rows[headerRowIndex] ?? []
      const nameIndex = headerIndex(headerRow, NAME_HEADERS)
      const qtyIndex = headerIndex(headerRow, QTY_HEADERS)
      if (nameIndex < 0 || qtyIndex < 0) continue
      const rows: IdleCollectRow[] = []
      for (const cells of sheet.rows.slice(headerRowIndex + 1)) {
        const productName = (cells[nameIndex] ?? '').trim()
        if (!productName) continue
        rows.push({
          productName,
          qty: parseQty(cells[qtyIndex] ?? ''),
          ...emptyStyleFields(),
        })
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
      '첫 행에 「상품명」과 「수량」 헤더가 있어야 합니다. 열 위치는 상관없습니다.',
  }
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
  const match = trimmed.match(/^(.+?)\s+(\d+)\s*$/)
  if (!match) return []
  return [match[1].trim(), match[2]]
}

export function parseIdleCollectText(text: string): {
  rows: IdleCollectRow[]
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
      error: '붙여넣은 내용에서 상품명·수량을 찾지 못했습니다.',
    }
  }

  const headerRow = rawRows[0] ?? []
  const nameHeaderIndex = headerIndex(headerRow, NAME_HEADERS)
  const qtyHeaderIndex = headerIndex(headerRow, QTY_HEADERS)
  const hasHeader = nameHeaderIndex >= 0 && qtyHeaderIndex >= 0
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows

  const rows: IdleCollectRow[] = []
  for (const cells of dataRows) {
    let productName = ''
    let qty = 0
    if (hasHeader) {
      productName = (cells[nameHeaderIndex] ?? '').trim()
      qty = parseQty(cells[qtyHeaderIndex] ?? '')
    } else {
      const qtyCell = cells[cells.length - 1] ?? ''
      qty = parseQty(qtyCell)
      productName = cells.slice(0, -1).join(' ').trim()
    }
    if (!productName) continue
    rows.push({ productName, qty, ...emptyStyleFields() })
  }

  if (rows.length === 0) {
    return {
      rows: [],
      error: '붙여넣은 내용에서 상품명·수량을 찾지 못했습니다.',
    }
  }
  return { rows, error: null }
}

export function keepIdleCollectLinks(
  next: readonly IdleCollectRow[],
  previous: readonly IdleCollectRow[],
): IdleCollectRow[] {
  const leftover = [...previous]
  return next.map((row) => {
    const index = leftover.findIndex(
      (item) => item.productName === row.productName,
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

function uniqueStyleRefs(refs: readonly StyleRef[]) {
  const seen = new Set<string>()
  const unique: StyleRef[] = []
  for (const ref of refs) {
    if (seen.has(ref.styleId)) continue
    seen.add(ref.styleId)
    unique.push(ref)
  }
  return unique
}

export function applyIdleCollectStyleLookup(
  rows: readonly IdleCollectRow[],
  lookup: { byName: Map<string, StyleRef[]> },
): IdleCollectRow[] {
  const byLower = new Map<string, StyleRef[]>()
  const byCompact = new Map<string, StyleRef[]>()
  for (const group of lookup.byName.values()) {
    for (const ref of group) {
      const lower = ref.name.trim().toLocaleLowerCase('ko-KR')
      byLower.set(lower, [...(byLower.get(lower) ?? []), ref])
      const compact = compactProductNameKey(ref.name)
      if (!compact) continue
      byCompact.set(compact, [...(byCompact.get(compact) ?? []), ref])
    }
  }

  return rows.map((row) => {
    const lower = row.productName.trim().toLocaleLowerCase('ko-KR')
    const compact = compactProductNameKey(row.productName)
    const exact = uniqueStyleRefs(byLower.get(lower) ?? [])
    const compactHits = uniqueStyleRefs(byCompact.get(compact) ?? [])
    const hit =
      exact.length === 1
        ? exact[0]
        : compactHits.length === 1
          ? compactHits[0]
          : null
    if (!hit) {
      return { ...row, ...emptyStyleFields() }
    }
    return {
      ...row,
      styleNo: hit.styleNo,
      styleId: hit.styleId,
    }
  })
}

export function idleCollectRowLinked(row: IdleCollectRow) {
  return Boolean(row.styleNo && row.styleId)
}

export function idleCollectDisplayRows(rows: readonly IdleCollectRow[]) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftUnlinked = !idleCollectRowLinked(left.row)
      const rightUnlinked = !idleCollectRowLinked(right.row)
      if (leftUnlinked === rightUnlinked) return left.index - right.index
      return leftUnlinked ? -1 : 1
    })
}

export function idleCollectLinkedCount(rows: readonly IdleCollectRow[]) {
  return rows.filter((row) => idleCollectRowLinked(row)).length
}

export function idleCollectAllLinked(rows: readonly IdleCollectRow[]) {
  return rows.length > 0 && rows.every((row) => idleCollectRowLinked(row))
}

export function idleCollectBackupEntries(rows: readonly IdleCollectRow[]) {
  const merged = new Map<string, { styleId: string; quantity: number }>()
  for (const row of rows) {
    if (!row.styleId || row.qty <= 0) continue
    const existing = merged.get(row.styleId)
    if (existing) {
      existing.quantity += row.qty
      continue
    }
    merged.set(row.styleId, { styleId: row.styleId, quantity: row.qty })
  }
  return [...merged.values()]
}
