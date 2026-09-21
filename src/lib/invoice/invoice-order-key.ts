import { compactOutboundPartnerKey } from '@/lib/codes/outbound-partner'
import { shipmentKeyOf } from '@/lib/invoice/gift-assign'
import { hashInvoiceWorkFingerprint } from '@/lib/invoice/mall-resolution'
import { productExclusionKey } from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceText, orderMomentOf } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceProductNameExclusion } from '@/lib/types'

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

export type InvoiceOrderKeyExclusionRule = Pick<
  InvoiceProductNameExclusion,
  'mallName' | 'productName' | 'itemName' | 'isActive'
>

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

function shipmentMomentKeyOf(row: SabangnetOrderRow): string | null {
  const orderedAt = orderMomentOf(row)
  if (!orderedAt) return null
  return `${shipmentKeyOf(row)}\u0000${orderedAt}`
}

function isActiveExclusionRow(
  row: SabangnetOrderRow,
  activeKeys: ReadonlySet<string>,
) {
  return activeKeys.has(
    productExclusionKey(row.mallName, row.productName, row.itemName),
  )
}

/**
 * 과거 백업이 상품 연결 예외 행의 주문 키를 남기지 않은 이력을 호환한다.
 * 활성 예외 규칙·같은 합포장+주문일시·미일치 주문키 묶음 전체가 예외일 때만
 * 확장하고, 일반 상품·다른 주소/시각·비활성 예외는 남긴다.
 */
export function expandBackedUpExclusionWithProductNameExceptions(input: {
  rows: readonly SabangnetOrderRow[]
  match: InvoiceOrderKeyMatch
  exclusions: readonly InvoiceOrderKeyExclusionRule[]
}): InvoiceOrderKeyMatch {
  const { rows, match, exclusions } = input
  if (match.rowNumbers.length === 0) return match

  const activeKeys = new Set(
    exclusions
      .filter((item) => item.isActive)
      .map((item) =>
        productExclusionKey(item.mallName, item.productName, item.itemName),
      ),
  )
  if (activeKeys.size === 0) return match

  const matchedNumbers = new Set(match.rowNumbers)
  const rowByNumber = new Map<number, SabangnetOrderRow>()
  for (const row of rows) {
    rowByNumber.set(row.rowNumber, row)
  }

  const backedUpBundleKeys = new Set<string>()
  const backedUpMainBundleKeys = new Set<string>()
  for (const rowNumber of matchedNumbers) {
    const row = rowByNumber.get(rowNumber)
    if (!row) continue
    const bundleKey = shipmentMomentKeyOf(row)
    if (!bundleKey) continue
    backedUpBundleKeys.add(bundleKey)
    if (!isActiveExclusionRow(row, activeKeys)) {
      backedUpMainBundleKeys.add(bundleKey)
    }
  }
  if (backedUpBundleKeys.size === 0) return match

  const remainingByPayload = new Map<string, SabangnetOrderRow[]>()
  const keylessRows: SabangnetOrderRow[] = []
  for (const row of rows) {
    if (matchedNumbers.has(row.rowNumber)) continue
    const payload = buildInvoiceOrderKeyPayload(row)
    if (!payload) {
      keylessRows.push(row)
      continue
    }
    const group = remainingByPayload.get(payload)
    if (group) {
      group.push(row)
      continue
    }
    remainingByPayload.set(payload, [row])
  }

  const expandedNumbers: number[] = []
  let expandedOrderCount = 0
  for (const group of remainingByPayload.values()) {
    if (group.some((row) => !isActiveExclusionRow(row, activeKeys))) continue
    if (
      group.some((row) => {
        const bundleKey = shipmentMomentKeyOf(row)
        return !bundleKey || !backedUpBundleKeys.has(bundleKey)
      })
    ) {
      continue
    }
    expandedOrderCount += 1
    for (const row of group) expandedNumbers.push(row.rowNumber)
  }

  for (const row of keylessRows) {
    if (!isActiveExclusionRow(row, activeKeys)) continue
    const bundleKey = shipmentMomentKeyOf(row)
    if (!bundleKey || !backedUpMainBundleKeys.has(bundleKey)) continue
    expandedNumbers.push(row.rowNumber)
  }

  if (expandedNumbers.length === 0) return match

  const rowNumbers = [...match.rowNumbers, ...expandedNumbers].sort(
    (left, right) => left - right,
  )
  return {
    orderCount: match.orderCount + expandedOrderCount,
    rowCount: rowNumbers.length,
    rowNumbers,
    hashes: match.hashes,
  }
}
