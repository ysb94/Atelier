import { compactOutboundPartnerKey } from '@/lib/codes/outbound-partner'
import { hashInvoiceWorkFingerprint } from '@/lib/invoice/mall-resolution'
import { normalizeInvoiceText, orderMomentOf } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'

export const INVOICE_ORDER_KEY_PREFIX = 'ono:v1'

const HASH_RE = /^[0-9a-f]{64}$/

export type InvoiceOrderKeyGroup = {
  payload: string
  rowNumbers: number[]
}

export type InvoiceOrderKeyMatch = {
  orderCount: number
  rowCount: number
  rowNumbers: number[]
  hashes: string[]
}

/** 고객주문번호·쇼핑몰명·주문일시가 모두 있을 때만 비가역 해시용 원문을 만든다. */
export function buildInvoiceOrderKeyPayload(
  row: SabangnetOrderRow,
): string | null {
  const mall = compactOutboundPartnerKey(row.mallName)
  const orderNo = normalizeInvoiceText(row.customerOrderNo)
  const orderedAt = orderMomentOf(row)
  if (!mall || !orderNo || !orderedAt) return null
  return `${INVOICE_ORDER_KEY_PREFIX}|${mall}|${orderNo}|${orderedAt}`
}

export function collectInvoiceOrderKeyGroups(
  rows: readonly SabangnetOrderRow[],
): InvoiceOrderKeyGroup[] {
  const groups = new Map<string, number[]>()
  for (const row of rows) {
    const payload = buildInvoiceOrderKeyPayload(row)
    if (!payload) continue
    const list = groups.get(payload)
    if (list) {
      list.push(row.rowNumber)
      continue
    }
    groups.set(payload, [row.rowNumber])
  }
  return [...groups.entries()]
    .map(([payload, rowNumbers]) => ({
      payload,
      rowNumbers: [...rowNumbers].sort((left, right) => left - right),
    }))
    .sort((left, right) => left.payload.localeCompare(right.payload))
}

export async function hashInvoiceOrderKeyPayload(
  payload: string,
): Promise<string> {
  return hashInvoiceWorkFingerprint(payload)
}

export async function hashInvoiceOrderKeyPayloads(
  payloads: readonly string[],
): Promise<string[]> {
  const hashes: string[] = []
  for (const payload of payloads) {
    hashes.push(await hashInvoiceOrderKeyPayload(payload))
  }
  return hashes
}

export function isInvoiceOrderKeyHash(value: string): boolean {
  return HASH_RE.test(value)
}

export function matchBackedUpInvoiceOrderKeys(
  groups: readonly InvoiceOrderKeyGroup[],
  hashes: readonly string[],
  backedUpHashes: readonly string[],
): InvoiceOrderKeyMatch {
  const hit = new Set(backedUpHashes.filter(isInvoiceOrderKeyHash))
  const matchedHashes: string[] = []
  const rowNumbers: number[] = []
  groups.forEach((group, index) => {
    const hash = hashes[index]
    if (!hash || !hit.has(hash)) return
    matchedHashes.push(hash)
    rowNumbers.push(...group.rowNumbers)
  })
  rowNumbers.sort((left, right) => left - right)
  return {
    orderCount: matchedHashes.length,
    rowCount: rowNumbers.length,
    rowNumbers,
    hashes: matchedHashes,
  }
}

export function filterRowsByExcludedNumbers(
  rows: readonly SabangnetOrderRow[],
  excludedRowNumbers: ReadonlySet<number>,
): SabangnetOrderRow[] {
  if (excludedRowNumbers.size === 0) return [...rows]
  return rows.filter((row) => !excludedRowNumbers.has(row.rowNumber))
}
