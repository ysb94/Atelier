import {
  normalizeInvoiceText,
  orderMomentOf,
  type InvoicePrefixPlan,
} from '@/lib/invoice/prefix-transform'
import {
  SABANGNET_COLUMNS,
  type SabangnetOrderRow,
} from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftAllocation,
  InvoicePrefixItem,
  InvoicePrefixRequest,
  StyleRef,
} from '@/lib/types'

export type GiftAssignment = {
  styleId: string
  styleNo: string
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
  mallName: string
  orderCount: number
  productNames: string[]
  assignments: GiftAssignment[]
  /** 같은 합포장 안의 모든 원본 행. 대상이 아닌 다른 주문 행도 포함한다. */
  rows: SabangnetOrderRow[]
}

export type PrefixReviewLine = {
  kind: 'gift' | 'order'
  key: string
  row: SabangnetOrderRow
  prefix: string
  matched: boolean
  isRandom: boolean
}

export type PrefixReviewShipment = {
  key: string
  recipientName: string
  recipientPhone: string
  recipientAddress: string
  mallName: string
  orderCount: number
  lines: PrefixReviewLine[]
}

export type PrefixReviewRequest = {
  request: InvoicePrefixRequest
  shipments: PrefixReviewShipment[]
  matchedRowCount: number
  giftCount: number
}

export type GiftTotal = {
  styleId: string
  styleNo: string
  giftName: string
  count: number
}

export type GiftConfirmCandidate = {
  requestId: string
  itemId: string
  styleId: string
  styleNo: string
  styleName: string
  mallName: string
  customerOrderNo: string
  orderedAt: string
  orderFingerprint: string
  allocationKey: string
  /** 같은 키의 후보는 DB에서 전부 또는 전혀 배정하지 않는다. */
  atomicGroupKey: string
  giftSlotIndex: number
  sourceRowNumber: number
  requestTitle: string
  isRandom: boolean
  isExisting: boolean
}

export type GiftQuotaPreview = {
  requestId: string
  styleId: string
  styleNo: string
  styleName: string
  quantityLimit: number
  usedCount: number
  plannedCount: number
  remainingCount: number
}

export type GiftSharedQuotaPreview = {
  requestId: string
  requestTitle: string
  quantityLimit: number
  usedCount: number
  plannedCount: number
  remainingCount: number
}

export type GiftAssignmentPlan = {
  shipments: GiftShipment[]
  totals: GiftTotal[]
  addedRows: SabangnetOrderRow[]
  /** 원 주문 행 번호 → 그 행 바로 뒤에 붙일 사은품 행 */
  giftsBySourceRowNumber: Map<number, SabangnetOrderRow[]>
  shipmentCount: number
  giftCount: number
  /** 다운로드 확정 RPC에 넘길 후보(기존 재사용 포함) */
  confirmCandidates: GiftConfirmCandidate[]
  /** 새로 확정해야 하는 후보만 */
  newConfirmCandidates: GiftConfirmCandidate[]
  quotaPreviews: GiftQuotaPreview[]
  sharedQuotaPreviews: GiftSharedQuotaPreview[]
  exhaustedSkipCount: number
  cancelledSkipCount: number
}

export type GiftAssignOptions = {
  seed: number
  /** 품절 등으로 제외할 사은품. styles.id */
  excludedGiftStyleIds?: string[]
  /** 취소 이력을 포함한 배정 원장. 활성 건은 재사용하고 취소 주문은 재배정하지 않는다. */
  existingAllocations?: InvoiceGiftAllocation[]
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function phoneOf(row: SabangnetOrderRow): string {
  return digitsOnly(row.recipientPhone) || digitsOnly(row.recipientOtherPhone)
}

/** 받는분성명 + 전화번호 + 주소 + 쇼핑몰명. 전화는 숫자만, 나머지는 공백·대소문자만 정리한다. */
export function shipmentKeyOf(row: SabangnetOrderRow): string {
  return [
    normalizeInvoiceText(row.recipientName),
    phoneOf(row),
    normalizeInvoiceText(row.recipientAddress),
    normalizeInvoiceText(row.mallName),
  ].join('\u0000')
}

/** 같은 합포장 안에서 주문일시가 같으면 같은 주문건이다. */
export function orderKeyOf(row: SabangnetOrderRow): string {
  return orderMomentOf(row) || row.orderedAt.trim() || `#${row.rowNumber}`
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

/** PII를 저장하지 않는 짧은 비가역 지문. */
function simpleFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 주문 멱등 지문.
 * 고객주문번호가 있으면 쇼핑몰+주문번호+주문일시, 없으면 비가역 해시만 쓴다.
 */
export function buildOrderFingerprint(row: SabangnetOrderRow): string {
  const mall = normalizeInvoiceText(row.mallName)
  const orderNo = normalizeInvoiceText(row.customerOrderNo)
  const orderedAt = orderMomentOf(row) || row.orderedAt.trim()
  if (orderNo) {
    return `ono:${mall}|${orderNo}|${orderedAt}`
  }
  return `anon:${simpleFingerprint(
    [
      shipmentKeyOf(row),
      normalizeInvoiceText(row.productName),
      orderedAt,
      String(row.rowNumber),
    ].join('|'),
  )}`
}

/** Postgres text에 null byte를 넣을 수 없어 US(0x1f)로 구분한다. */
export function buildAllocationKey(
  orderFingerprint: string,
  itemId: string,
  styleId: string,
  giftSlotIndex: number,
): string {
  return `${orderFingerprint}\u001f${itemId}\u001f${styleId}\u001f${giftSlotIndex}`
}

function buildAtomicGroupKey(
  orderFingerprint: string,
  itemId: string,
  groupIndex: number,
): string {
  return `${orderFingerprint}\u001f${itemId}\u001fgroup:${groupIndex}`
}

function compareGiftOrder(left: SabangnetOrderRow, right: SabangnetOrderRow) {
  const leftMoment = orderMomentOf(left) || left.orderedAt.trim()
  const rightMoment = orderMomentOf(right) || right.orderedAt.trim()
  if (leftMoment !== rightMoment) {
    return leftMoment.localeCompare(rightMoment, 'ko-KR')
  }
  const leftOrder = normalizeInvoiceText(left.customerOrderNo)
  const rightOrder = normalizeInvoiceText(right.customerOrderNo)
  if (leftOrder !== rightOrder) {
    return leftOrder.localeCompare(rightOrder, 'ko-KR')
  }
  const leftFp = buildOrderFingerprint(left)
  const rightFp = buildOrderFingerprint(right)
  if (leftFp !== rightFp) return leftFp.localeCompare(rightFp, 'ko-KR')
  return left.rowNumber - right.rowNumber
}

function pickRandomGift(
  candidates: StyleRef[],
  usedInShipment: Set<string>,
  counts: Map<string, number>,
  rng: () => number,
): StyleRef | null {
  if (candidates.length === 0) return null
  const unused = candidates.filter((ref) => !usedInShipment.has(ref.styleId))
  const pool = unused.length > 0 ? unused : candidates
  let min = Infinity
  for (const ref of pool) {
    const n = counts.get(ref.styleId) ?? 0
    if (n < min) min = n
  }
  const tied = pool.filter((ref) => (counts.get(ref.styleId) ?? 0) === min)
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
          `${orderKeyOf(row)}\u0000${normalizeInvoiceText(row.productName)}`,
      ),
    )
    return keys.size
  }

  const orders = new Set(rows.map((row) => orderKeyOf(row)))
  return orders.size
}

/** 같은 합포장 안의 사은품 표시명. 번호는 합포장마다 1부터. */
export function formatGiftProductName(
  giftIndex: number,
  officialName: string,
): string {
  return `사은품(${giftIndex}) : ${officialName}`
}

/** 사은품 표시는 품목명만 쓴다. 내품명에 같은 값을 넣으면 원본과 헷갈린다. */
function copyAsGiftRow(
  source: SabangnetOrderRow,
  giftLabel: string,
  rowNumber: number,
): SabangnetOrderRow {
  return {
    ...source,
    rowNumber,
    productName: giftLabel,
    itemName: '',
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
  earliestRow: SabangnetOrderRow
}

/**
 * 사은품 대상 행을 합포장 묶음으로 모아 사은품을 배정한다.
 * 선착순 요청은 주문일시 순으로 M번호별 잔여 한도 안에서만 배정한다.
 * 표시명은 합포장마다 `사은품(1) : 공식명`부터 번호를 매긴다.
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
    (options.excludedGiftStyleIds ?? [])
      .map((id) => id.trim())
      .filter(Boolean),
  )
  const activeAllocations = (options.existingAllocations ?? []).filter(
    (item) => !item.cancelledAt,
  )
  const existingByKey = new Map(
    activeAllocations.map((item) => [
      `${item.requestId}\u0000${item.allocationKey}`,
      item,
    ]),
  )
  const existingByFingerprintItem = new Map<string, InvoiceGiftAllocation[]>()
  const cancelledOrderItems = new Set<string>()
  for (const allocation of options.existingAllocations ?? []) {
    const key = `${allocation.requestId}\u0000${allocation.orderFingerprint}\u0000${allocation.itemId}`
    if (allocation.cancelledAt) {
      cancelledOrderItems.add(key)
      continue
    }
    const list = existingByFingerprintItem.get(key) ?? []
    list.push(allocation)
    existingByFingerprintItem.set(key, list)
  }
  for (const list of existingByFingerprintItem.values()) {
    list.sort((left, right) => left.giftSlotIndex - right.giftSlotIndex)
  }

  const remainingByRequestStyle = new Map<string, number>()
  const usedByRequestStyle = new Map<string, number>()
  const remainingByRequest = new Map<string, number>()
  const usedByRequest = new Map<string, number>()
  for (const request of requests) {
    if (!request.usesFirstCome) continue
    usedByRequest.set(request.id, request.firstComeUsedCount)
    if (
      request.firstComeLimitMode === 'shared_total' &&
      request.firstComeTotalLimit !== null
    ) {
      remainingByRequest.set(
        request.id,
        Math.max(0, request.firstComeTotalLimit - request.firstComeUsedCount),
      )
    }
    for (const quota of request.quotas) {
      const key = `${request.id}\u0000${quota.styleId}`
      remainingByRequestStyle.set(key, quota.remainingCount)
      usedByRequestStyle.set(key, quota.usedCount)
    }
  }

  const totalsById = new Map<string, GiftTotal>()
  const confirmCandidates: GiftConfirmCandidate[] = []
  let exhaustedSkipCount = 0
  let cancelledSkipCount = 0

  const allByKey = new Map<string, SabangnetOrderRow[]>()
  for (const row of rows) {
    const key = shipmentKeyOf(row)
    const list = allByKey.get(key)
    if (list) list.push(row)
    else allByKey.set(key, [row])
  }

  const buckets = new Map<string, ShipmentBucket>()
  for (const row of rows) {
    if (!prefixPlan.matchByRowNumber.has(row.rowNumber)) continue
    const key = shipmentKeyOf(row)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.firstRowNumber = Math.min(bucket.firstRowNumber, row.rowNumber)
      if (compareGiftOrder(row, bucket.earliestRow) < 0) {
        bucket.earliestRow = row
      }
      continue
    }
    buckets.set(key, {
      key,
      rows: allByKey.get(key) ?? [row],
      firstRowNumber: row.rowNumber,
      earliestRow: row,
    })
  }

  const rng = mulberry32(options.seed)
  // 랜덤 균형은 행사 전체 기존 배정 + 이번 계획 누적을 함께 본다.
  const counts = new Map<string, number>()
  for (const allocation of activeAllocations) {
    counts.set(
      allocation.styleId,
      (counts.get(allocation.styleId) ?? 0) + 1,
    )
  }

  const shipments: GiftShipment[] = []
  const addedRows: SabangnetOrderRow[] = []
  const giftsBySourceRowNumber = new Map<number, SabangnetOrderRow[]>()
  let nextRowNumber =
    rows.reduce((max, row) => Math.max(max, row.rowNumber), 0) + 1

  function bumpTotal(ref: StyleRef) {
    const previous = totalsById.get(ref.styleId)
    if (previous) {
      previous.count += 1
      return
    }
    totalsById.set(ref.styleId, {
      styleId: ref.styleId,
      styleNo: ref.styleNo,
      giftName: ref.name,
      count: 1,
    })
  }

  function remainingOf(requestId: string, styleId: string) {
    return remainingByRequestStyle.get(`${requestId}\u0000${styleId}`) ?? 0
  }

  function consumeRemaining(requestId: string, styleId: string) {
    const key = `${requestId}\u0000${styleId}`
    remainingByRequestStyle.set(key, Math.max(0, remainingOf(requestId, styleId) - 1))
  }

  function sharedRemainingOf(requestId: string) {
    return remainingByRequest.get(requestId) ?? 0
  }

  function consumeSharedRemaining(requestId: string, count: number) {
    remainingByRequest.set(
      requestId,
      Math.max(0, sharedRemainingOf(requestId) - count),
    )
  }

  const orderedBuckets = [...buckets.values()].sort((left, right) => {
    const byOrder = compareGiftOrder(left.earliestRow, right.earliestRow)
    if (byOrder !== 0) return byOrder
    return left.firstRowNumber - right.firstRowNumber
  })

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
    const matchedRows: SabangnetOrderRow[] = []
    let giftIndexInShipment = 0

    for (const row of bucket.rows) {
      orderNos.add(orderKeyOf(row))
      if (prefixPlan.matchByRowNumber.has(row.rowNumber)) {
        matchedRows.push(row)
        const key = normalizeInvoiceText(row.productName)
        if (seenProduct.has(key)) continue
        seenProduct.add(key)
        productNames.push(row.productName)
      }
    }

    const itemEntries = [...byItem.entries()]
      .map(([itemId, rows]) => [itemId, [...rows].sort(compareGiftOrder)] as const)
      .sort((left, right) => compareGiftOrder(left[1][0]!, right[1][0]!))

    for (const [itemId, itemRows] of itemEntries) {
      const indexed = itemById.get(itemId)
      if (!indexed) continue
      const { request, item } = indexed
      const liveRequest = requestById.get(request.id) ?? request
      const count = countGifts(itemRows, liveRequest)
      if (count <= 0) continue

      const rowFingerprints = itemRows.map(buildOrderFingerprint)
      const sourceIndexByFingerprint = new Map<string, number>()
      rowFingerprints.forEach((value, index) => {
        if (!sourceIndexByFingerprint.has(value)) {
          sourceIndexByFingerprint.set(value, index)
        }
      })
      // 사은품 그룹(세트 1개 단위)은 주문 행 하나에 붙여
      // atomicGroupKey와 allocationKey가 같은 주문 지문을 가리키게 한다.
      const sourceIndexOfGroup = (groupIndex: number) =>
        (groupIndex - 1) % itemRows.length
      const groupFingerprint = (groupIndex: number) =>
        rowFingerprints[sourceIndexOfGroup(groupIndex)]!
      const orderFingerprints = [...new Set(rowFingerprints)]
      const existingForOrder = orderFingerprints
        .flatMap(
          (orderFingerprint) =>
            existingByFingerprintItem.get(
              `${liveRequest.id}\u0000${orderFingerprint}\u0000${item.id}`,
            ) ?? [],
        )
        .sort((left, right) => left.giftSlotIndex - right.giftSlotIndex)
      const wasCancelled = orderFingerprints.some((orderFingerprint) =>
        cancelledOrderItems.has(
          `${liveRequest.id}\u0000${orderFingerprint}\u0000${item.id}`,
        ),
      )

      if (existingForOrder.length === 0 && wasCancelled) {
        cancelledSkipCount += count
        continue
      }

      const configuredCandidates = item.outgoingProducts.filter(
        (ref) => ref.styleId,
      )
      const candidates = configuredCandidates.filter(
        (ref) => !excluded.has(ref.styleId),
      )
      if (candidates.length === 0) continue
      // 고정 세트는 품절 제외된 구성품이 하나라도 있으면 일부만 지급하지 않는다.
      if (
        existingForOrder.length === 0 &&
        !item.isRandom &&
        candidates.length !== configuredCandidates.length
      ) {
        continue
      }

      const gifts: Array<
        StyleRef & {
          slot: number
          existing: boolean
          atomicGroupKey: string
          sourceIndex: number
        }
      > = []

      if (existingForOrder.length > 0) {
        for (const allocation of existingForOrder) {
          const groupIndex = item.isRandom
            ? allocation.giftSlotIndex
            : Math.floor(
                (allocation.giftSlotIndex - 1) /
                  Math.max(1, configuredCandidates.length),
              ) + 1
          gifts.push({
            styleId: allocation.styleId,
            styleNo: allocation.styleNo,
            name: allocation.styleName,
            slot: allocation.giftSlotIndex,
            existing: true,
            atomicGroupKey: buildAtomicGroupKey(
              allocation.orderFingerprint,
              item.id,
              groupIndex,
            ),
            sourceIndex:
              sourceIndexByFingerprint.get(allocation.orderFingerprint) ?? 0,
          })
          usedInShipment.add(allocation.styleId)
          bumpTotal({
            styleId: allocation.styleId,
            styleNo: allocation.styleNo,
            name: allocation.styleName,
          })
        }
      } else if (liveRequest.usesFirstCome) {
        let nextSlot = 1
        if (
          liveRequest.firstComeLimitMode === 'shared_total' &&
          item.isRandom
        ) {
          for (let i = 0; i < count; i += 1) {
            if (sharedRemainingOf(liveRequest.id) < 1) {
              exhaustedSkipCount += 1
              break
            }
            const picked = pickRandomGift(
              candidates,
              usedInShipment,
              counts,
              rng,
            )
            if (!picked) break
            gifts.push({
              ...picked,
              slot: nextSlot,
              existing: false,
              atomicGroupKey: buildAtomicGroupKey(
                groupFingerprint(i + 1),
                item.id,
                i + 1,
              ),
              sourceIndex: sourceIndexOfGroup(i + 1),
            })
            nextSlot += 1
            usedInShipment.add(picked.styleId)
            counts.set(picked.styleId, (counts.get(picked.styleId) ?? 0) + 1)
            consumeSharedRemaining(liveRequest.id, 1)
            bumpTotal(picked)
          }
        } else if (liveRequest.firstComeLimitMode === 'shared_total') {
          for (let i = 0; i < count; i += 1) {
            if (sharedRemainingOf(liveRequest.id) < candidates.length) {
              exhaustedSkipCount += 1
              break
            }
            const atomicGroupKey = buildAtomicGroupKey(
              groupFingerprint(i + 1),
              item.id,
              i + 1,
            )
            const sourceIndex = sourceIndexOfGroup(i + 1)
            for (const ref of candidates) {
              gifts.push({
                ...ref,
                slot: nextSlot,
                existing: false,
                atomicGroupKey,
                sourceIndex,
              })
              nextSlot += 1
              usedInShipment.add(ref.styleId)
              counts.set(ref.styleId, (counts.get(ref.styleId) ?? 0) + 1)
              bumpTotal(ref)
            }
            consumeSharedRemaining(liveRequest.id, candidates.length)
          }
        } else if (item.isRandom) {
          for (let i = 0; i < count; i += 1) {
            const withQuota = candidates.filter(
              (ref) => remainingOf(liveRequest.id, ref.styleId) > 0,
            )
            const picked = pickRandomGift(
              withQuota,
              usedInShipment,
              counts,
              rng,
            )
            if (!picked) {
              exhaustedSkipCount += 1
              break
            }
            gifts.push({
              ...picked,
              slot: nextSlot,
              existing: false,
              atomicGroupKey: buildAtomicGroupKey(
                groupFingerprint(i + 1),
                item.id,
                i + 1,
              ),
              sourceIndex: sourceIndexOfGroup(i + 1),
            })
            nextSlot += 1
            usedInShipment.add(picked.styleId)
            counts.set(picked.styleId, (counts.get(picked.styleId) ?? 0) + 1)
            consumeRemaining(liveRequest.id, picked.styleId)
            bumpTotal(picked)
          }
        } else {
          for (let i = 0; i < count; i += 1) {
            const canTakeSet = candidates.every(
              (ref) => remainingOf(liveRequest.id, ref.styleId) > 0,
            )
            if (!canTakeSet) {
              exhaustedSkipCount += 1
              break
            }
            const atomicGroupKey = buildAtomicGroupKey(
              groupFingerprint(i + 1),
              item.id,
              i + 1,
            )
            const sourceIndex = sourceIndexOfGroup(i + 1)
            for (const ref of candidates) {
              gifts.push({
                ...ref,
                slot: nextSlot,
                existing: false,
                atomicGroupKey,
                sourceIndex,
              })
              nextSlot += 1
              usedInShipment.add(ref.styleId)
              counts.set(ref.styleId, (counts.get(ref.styleId) ?? 0) + 1)
              consumeRemaining(liveRequest.id, ref.styleId)
              bumpTotal(ref)
            }
          }
        }
      } else if (item.isRandom) {
        let nextSlot = 1
        for (let i = 0; i < count; i += 1) {
          const picked = pickRandomGift(
            candidates,
            usedInShipment,
            counts,
            rng,
          )
          if (!picked) break
          gifts.push({
            ...picked,
            slot: nextSlot,
            existing: false,
            atomicGroupKey: buildAtomicGroupKey(
              groupFingerprint(i + 1),
              item.id,
              i + 1,
            ),
            sourceIndex: sourceIndexOfGroup(i + 1),
          })
          nextSlot += 1
          usedInShipment.add(picked.styleId)
          counts.set(picked.styleId, (counts.get(picked.styleId) ?? 0) + 1)
          bumpTotal(picked)
        }
      } else {
        let nextSlot = 1
        for (let i = 0; i < count; i += 1) {
          const atomicGroupKey = buildAtomicGroupKey(
            groupFingerprint(i + 1),
            item.id,
            i + 1,
          )
          const sourceIndex = sourceIndexOfGroup(i + 1)
          for (const ref of candidates) {
            gifts.push({
              ...ref,
              slot: nextSlot,
              existing: false,
              atomicGroupKey,
              sourceIndex,
            })
            nextSlot += 1
            usedInShipment.add(ref.styleId)
            counts.set(ref.styleId, (counts.get(ref.styleId) ?? 0) + 1)
            bumpTotal(ref)
          }
        }
      }

      for (const gift of gifts) {
        const giftSource = itemRows[gift.sourceIndex]!
        const giftFingerprint = rowFingerprints[gift.sourceIndex]!
        const allocationKey = buildAllocationKey(
          giftFingerprint,
          item.id,
          gift.styleId,
          gift.slot,
        )
        giftIndexInShipment += 1
        const giftLabel = formatGiftProductName(giftIndexInShipment, gift.name)
        assignments.push({
          styleId: gift.styleId,
          styleNo: gift.styleNo,
          giftName: giftLabel,
          sourceRowNumber: giftSource.rowNumber,
          requestId: liveRequest.id,
          requestTitle: liveRequest.title,
          itemId: item.id,
          isRandom: item.isRandom,
        })
        const giftRow = copyAsGiftRow(giftSource, giftLabel, nextRowNumber)
        addedRows.push(giftRow)
        const list = giftsBySourceRowNumber.get(giftSource.rowNumber) ?? []
        list.push(giftRow)
        giftsBySourceRowNumber.set(giftSource.rowNumber, list)
        nextRowNumber += 1

        if (liveRequest.usesFirstCome) {
          confirmCandidates.push({
            requestId: liveRequest.id,
            itemId: item.id,
            styleId: gift.styleId,
            styleNo: gift.styleNo,
            styleName: gift.name,
            mallName: giftSource.mallName,
            customerOrderNo: giftSource.customerOrderNo,
            orderedAt:
              orderMomentOf(giftSource) || giftSource.orderedAt.trim(),
            orderFingerprint: giftFingerprint,
            allocationKey,
            atomicGroupKey: gift.atomicGroupKey,
            giftSlotIndex: gift.slot,
            sourceRowNumber: giftSource.rowNumber,
            requestTitle: liveRequest.title,
            isRandom: item.isRandom,
            isExisting:
              gift.existing ||
              existingByKey.has(`${liveRequest.id}\u0000${allocationKey}`),
          })
        }
      }
    }

    if (matchedRows.length === 0) continue

    const first = bucket.rows[0]!
    shipments.push({
      key: bucket.key,
      recipientName: first.recipientName,
      recipientPhone: first.recipientPhone || first.recipientOtherPhone,
      recipientAddress: first.recipientAddress,
      mallName: first.mallName,
      orderCount: orderNos.size,
      productNames,
      assignments,
      rows: [...bucket.rows].sort((left, right) => left.rowNumber - right.rowNumber),
    })
  }

  const totals = [...totalsById.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.styleNo.localeCompare(right.styleNo, 'ko-KR') ||
      left.giftName.localeCompare(right.giftName, 'ko-KR'),
  )

  const newPlannedByRequestStyle = new Map<string, number>()
  const newPlannedByRequest = new Map<string, number>()
  for (const candidate of confirmCandidates) {
    if (candidate.isExisting) continue
    const key = `${candidate.requestId}\u0000${candidate.styleId}`
    newPlannedByRequestStyle.set(
      key,
      (newPlannedByRequestStyle.get(key) ?? 0) + 1,
    )
    newPlannedByRequest.set(
      candidate.requestId,
      (newPlannedByRequest.get(candidate.requestId) ?? 0) + 1,
    )
  }

  const quotaPreviews: GiftQuotaPreview[] = []
  const sharedQuotaPreviews: GiftSharedQuotaPreview[] = []
  for (const request of requests) {
    if (!request.usesFirstCome) continue
    if (
      request.firstComeLimitMode === 'shared_total' &&
      request.firstComeTotalLimit !== null
    ) {
      const usedCount =
        usedByRequest.get(request.id) ?? request.firstComeUsedCount
      const plannedCount = newPlannedByRequest.get(request.id) ?? 0
      sharedQuotaPreviews.push({
        requestId: request.id,
        requestTitle: request.title,
        quantityLimit: request.firstComeTotalLimit,
        usedCount,
        plannedCount,
        remainingCount:
          remainingByRequest.get(request.id) ??
          Math.max(
            0,
            request.firstComeTotalLimit - usedCount - plannedCount,
          ),
      })
      continue
    }
    for (const quota of request.quotas) {
      const key = `${request.id}\u0000${quota.styleId}`
      const usedCount = usedByRequestStyle.get(key) ?? quota.usedCount
      const plannedCount = newPlannedByRequestStyle.get(key) ?? 0
      quotaPreviews.push({
        requestId: request.id,
        styleId: quota.styleId,
        styleNo: quota.styleNo,
        styleName: quota.styleName,
        quantityLimit: quota.quantityLimit,
        usedCount,
        plannedCount,
        remainingCount:
          remainingByRequestStyle.get(key) ??
          Math.max(0, quota.quantityLimit - usedCount - plannedCount),
      })
    }
  }

  return {
    shipments,
    totals,
    addedRows,
    giftsBySourceRowNumber,
    shipmentCount: shipments.length,
    giftCount: addedRows.length,
    confirmCandidates,
    newConfirmCandidates: confirmCandidates.filter((item) => !item.isExisting),
    quotaPreviews,
    sharedQuotaPreviews,
    exhaustedSkipCount,
    cancelledSkipCount,
  }
}

/**
 * 요청 건별로 합포장을 펼친다.
 * 원 주문 행 바로 뒤에 사은품 행을 넣고, 같은 합포장의 다른 주문 행도 함께 보여 준다.
 */
export function buildPrefixReview(
  requests: InvoicePrefixRequest[],
  prefixPlan: InvoicePrefixPlan,
  giftPlan: GiftAssignmentPlan,
): PrefixReviewRequest[] {
  const giftsBySource = new Map<number, GiftAssignment[]>()
  for (const shipment of giftPlan.shipments) {
    for (const assignment of shipment.assignments) {
      const list = giftsBySource.get(assignment.sourceRowNumber) ?? []
      list.push(assignment)
      giftsBySource.set(assignment.sourceRowNumber, list)
    }
  }

  return requests.map((request) => {
    const shipments: PrefixReviewShipment[] = []
    let matchedRowCount = 0
    let giftCount = 0

    for (const shipment of giftPlan.shipments) {
      const belongs = shipment.rows.some((row) => {
        const match = prefixPlan.matchByRowNumber.get(row.rowNumber)
        return match?.requestId === request.id
      })
      if (!belongs) continue

      const lines: PrefixReviewLine[] = []
      for (const row of shipment.rows) {
        const match = prefixPlan.matchByRowNumber.get(row.rowNumber)
        const matched = match?.requestId === request.id
        const gifts = (giftsBySource.get(row.rowNumber) ?? []).filter(
          (assignment) => assignment.requestId === request.id,
        )
        if (matched) matchedRowCount += 1
        lines.push({
          kind: 'order',
          key: `order-${row.rowNumber}`,
          row,
          prefix: '',
          matched: Boolean(matched),
          isRandom: false,
        })
        for (const [index, assignment] of gifts.entries()) {
          giftCount += 1
          lines.push({
            kind: 'gift',
            key: `gift-${assignment.sourceRowNumber}-${index}-${assignment.giftName}`,
            row: {
              ...row,
              productName: assignment.giftName,
              itemName: '',
              quantity: '1',
              ownProductCode: '',
            },
            prefix: assignment.styleNo || assignment.giftName,
            matched: true,
            isRandom: assignment.isRandom,
          })
        }
      }

      shipments.push({
        key: shipment.key,
        recipientName: shipment.recipientName,
        recipientPhone: shipment.recipientPhone,
        recipientAddress: shipment.recipientAddress,
        mallName: shipment.mallName,
        orderCount: shipment.orderCount,
        lines,
      })
    }

    return { request, shipments, matchedRowCount, giftCount }
  })
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
