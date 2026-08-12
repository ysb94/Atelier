import {
  normalizeInvoiceText,
  type InvoicePrefixPlan,
} from '@/lib/invoice/prefix-transform'
import {
  SABANGNET_COLUMNS,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'
import type { InvoicePrefixItem, InvoicePrefixRequest } from '@/lib/types'

export type GiftAssignment = {
  giftName: string
  sourceRowNumber: number
  requestId: string
  requestTitle: string
  itemId: string
  isRandom: boolean
}

export type GiftShipment = {
  key: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  orderCount: number
  productNames: string[]
  assignments: GiftAssignment[]
}

export type GiftTotal = {
  giftName: string
  count: number
}

export type GiftAssignmentPlan = {
  shipments: GiftShipment[]
  totals: GiftTotal[]
  addedRows: SabangnetOrderRow[]
  shipmentCount: number
  giftCount: number
}

export type GiftAssignOptions = {
  seed: number
  excludedGiftNames?: string[]
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function phoneOf(row: SabangnetOrderRow): string {
  return digitsOnly(row.recipientPhone) || digitsOnly(row.recipientOtherPhone)
}

/** 받는분성명 + 전화번호 + 주소. 전화는 숫자만, 이름·주소는 공백·대소문자만 정리한다. */
export function shipmentKeyOf(row: SabangnetOrderRow): string {
  return [
    normalizeInvoiceText(row.recipientName),
    phoneOf(row),
    normalizeInvoiceText(row.recipientAddress),
  ].join('\u0000')
}

function parseQuantity(value: string): number {
  const parsed = Number(value.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.floor(parsed)
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const next = [...items]
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const left = next[i]!
    next[i] = next[j]!
    next[j] = left
  }
  return next
}

export function createGiftSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0
}

function pickRandomGift(
  candidates: string[],
  usedInShipment: Set<string>,
  counts: Map<string, number>,
  rng: () => number,
): string | null {
  if (candidates.length === 0) return null
  const unused = candidates.filter((name) => !usedInShipment.has(name))
  const pool = unused.length > 0 ? unused : candidates
  let min = Infinity
  for (const name of pool) {
    const n = counts.get(name) ?? 0
    if (n < min) min = n
  }
  const tied = pool.filter((name) => (counts.get(name) ?? 0) === min)
  return shuffle(tied, rng)[0] ?? null
}

function countGifts(
  rows: SabangnetOrderRow[],
  request: InvoicePrefixRequest,
): number {
  if (request.mergeBasis === 'per_shipment') return 1

  if (request.countBasis === 'per_quantity') {
    return rows.reduce((sum, row) => sum + parseQuantity(row.quantity), 0)
  }

  if (request.countBasis === 'per_product') {
    const keys = new Set(
      rows.map(
        (row) =>
          `${row.customerOrderNo.trim()}\u0000${normalizeInvoiceText(row.productName)}`,
      ),
    )
    return keys.size
  }

  const orders = new Set(rows.map((row) => row.customerOrderNo.trim() || `#${row.rowNumber}`))
  return orders.size
}

function copyAsGiftRow(
  source: SabangnetOrderRow,
  giftName: string,
  rowNumber: number,
): SabangnetOrderRow {
  return {
    ...source,
    rowNumber,
    productName: giftName,
    itemName: giftName,
    quantity: '1',
    ownProductCode: '',
  }
}

type IndexedItem = {
  request: InvoicePrefixRequest
  item: InvoicePrefixItem
}

type ShipmentBucket = {
  key: string
  rows: SabangnetOrderRow[]
  firstRowNumber: number
}

/**
 * 접두어가 걸린 행을 합포장 묶음으로 모아 사은품을 배정한다.
 * 랜덤은 파일 안에서 종류별 같은 수량을 맞추고, 같은 상자 안에서는 겹치지 않게 고른다.
 */
export function planGiftAssignments(
  rows: SabangnetOrderRow[],
  prefixPlan: InvoicePrefixPlan,
  requests: InvoicePrefixRequest[],
  options: GiftAssignOptions,
): GiftAssignmentPlan {
  const requestById = new Map(requests.map((request) => [request.id, request]))
  const itemById = new Map<string, IndexedItem>()
  for (const request of requests) {
    for (const item of request.items) {
      itemById.set(item.id, { request, item })
    }
  }

  const excluded = new Set(
    (options.excludedGiftNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean),
  )

  const buckets = new Map<string, ShipmentBucket>()
  for (const row of rows) {
    if (!prefixPlan.matchByRowNumber.has(row.rowNumber)) continue
    const key = shipmentKeyOf(row)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.rows.push(row)
      bucket.firstRowNumber = Math.min(bucket.firstRowNumber, row.rowNumber)
      continue
    }
    buckets.set(key, { key, rows: [row], firstRowNumber: row.rowNumber })
  }

  const rng = mulberry32(options.seed)
  const counts = new Map<string, number>()
  const shipments: GiftShipment[] = []
  const addedRows: SabangnetOrderRow[] = []
  let nextRowNumber =
    rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) + 1

  const orderedBuckets = [...buckets.values()].sort(
    (left, right) => left.firstRowNumber - right.firstRowNumber,
  )

  for (const bucket of orderedBuckets) {
    const byItem = new Map<string, SabangnetOrderRow[]>()
    for (const row of bucket.rows) {
      const match = prefixPlan.matchByRowNumber.get(row.rowNumber)
      if (!match) continue
      const list = byItem.get(match.itemId) ?? []
      list.push(row)
      byItem.set(match.itemId, list)
    }

    const usedInShipment = new Set<string>()
    const assignments: GiftAssignment[] = []
    const productNames: string[] = []
    const seenProduct = new Set<string>()
    const orderNos = new Set<string>()

    for (const row of bucket.rows) {
      orderNos.add(row.customerOrderNo.trim() || `#${row.rowNumber}`)
      const key = normalizeInvoiceText(row.productName)
      if (seenProduct.has(key)) continue
      seenProduct.add(key)
      productNames.push(row.productName)
    }

    for (const [itemId, itemRows] of byItem) {
      const indexed = itemById.get(itemId)
      if (!indexed) continue
      const { request, item } = indexed
      const liveRequest = requestById.get(request.id) ?? request
      const count = countGifts(itemRows, liveRequest)
      if (count <= 0) continue

      const candidates = item.outgoingProductNames.filter(
        (name) => name.trim() && !excluded.has(name),
      )
      if (candidates.length === 0) continue

      const gifts: string[] = []
      if (item.isRandom) {
        for (let i = 0; i < count; i += 1) {
          const picked = pickRandomGift(
            candidates,
            usedInShipment,
            counts,
            rng,
          )
          if (!picked) break
          gifts.push(picked)
          usedInShipment.add(picked)
          counts.set(picked, (counts.get(picked) ?? 0) + 1)
        }
      } else {
        for (let i = 0; i < count; i += 1) {
          for (const name of candidates) {
            gifts.push(name)
            usedInShipment.add(name)
            counts.set(name, (counts.get(name) ?? 0) + 1)
          }
        }
      }

      itemRows.sort((left, right) => left.rowNumber - right.rowNumber)
      gifts.forEach((giftName, index) => {
        const source = itemRows[index % itemRows.length]!
        assignments.push({
          giftName,
          sourceRowNumber: source.rowNumber,
          requestId: liveRequest.id,
          requestTitle: liveRequest.title,
          itemId: item.id,
          isRandom: item.isRandom,
        })
        addedRows.push(copyAsGiftRow(source, giftName, nextRowNumber))
        nextRowNumber += 1
      })
    }

    if (assignments.length === 0) continue

    const first = bucket.rows[0]!
    shipments.push({
      key: bucket.key,
      recipientName: first.recipientName,
      recipientPhone: first.recipientPhone || first.recipientOtherPhone,
      recipientAddress: first.recipientAddress,
      orderCount: orderNos.size,
      productNames,
      assignments,
    })
  }

  const totals = [...counts.entries()]
    .map(([giftName, count]) => ({ giftName, count }))
    .sort((left, right) => right.count - left.count || left.giftName.localeCompare(right.giftName, 'ko-KR'))

  return {
    shipments,
    totals,
    addedRows,
    shipmentCount: shipments.length,
    giftCount: addedRows.length,
  }
}

function todayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

/** 사은품으로 추가될 행을 사방넷 열 순서 그대로 내려받는다. */
export async function downloadGiftRows(options: {
  fileName?: string
  rows: SabangnetOrderRow[]
}) {
  const XLSX = await import('xlsx')
  const headers = SABANGNET_COLUMNS.map((column) => column.label)
  const body = options.rows.map((row) =>
    SABANGNET_COLUMNS.map((column) => String(row[column.key] ?? '')),
  )
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...body])
  sheet['!cols'] = SABANGNET_COLUMNS.map((column) => ({
    wch: Math.min(36, Math.max(12, column.label.length + 4)),
  }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, '사은품행')
  const fileName =
    options.fileName?.trim() || `사은품행_${todayStamp()}.xlsx`
  XLSX.writeFile(workbook, fileName)
}
