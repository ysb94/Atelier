import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoicePrefixItem,
  InvoicePrefixRequest,
  InvoicePrefixRequestStatus,
} from '@/lib/types'

export type InvoicePrefixMatch = {
  requestId: string
  requestTitle: string
  itemId: string
  prefix: string
}

export type InvoicePrefixGroup = {
  key: string
  requestId: string
  requestTitle: string
  taskNo: string
  mallName: string
  productName: string
  prefix: string
  rowCount: number
}

export type InvoicePrefixConflict = {
  key: string
  mallName: string
  productName: string
  rowCount: number
  candidates: InvoicePrefixMatch[]
}

/** 요청서에는 있는데 이 파일에서 한 건도 못 찾은 항목. 상품명 오타를 잡는다. */
export type InvoicePrefixUnusedItem = {
  requestId: string
  requestTitle: string
  mallName: string
  productName: string
  prefix: string
  /** 품목명은 파일에 있는데 쇼핑몰명이 달라 못 붙인 경우 */
  fileMallNames: string[]
}

export type InvoicePrefixRowMatch = {
  requestId: string
  itemId: string
  prefix: string
}

export type InvoicePrefixPlan = {
  /** 원본 행 번호 -> 최종 품목명 앞에 붙일 접두어 */
  prefixByRowNumber: Map<number, string>
  /** 원본 행 번호 -> 걸린 요청 건·항목. 사은품 배정에 쓴다. */
  matchByRowNumber: Map<number, InvoicePrefixRowMatch>
  groups: InvoicePrefixGroup[]
  conflicts: InvoicePrefixConflict[]
  unusedItems: InvoicePrefixUnusedItem[]
  prefixedRowCount: number
  passedRowCount: number
  /** 주문일시를 읽을 수 없어 기간을 판단하지 못한 행 */
  undatedRowCount: number
  /** 상품명은 맞지만 주문일시가 행사 기간을 벗어난 행 */
  outOfPeriodRowCount: number
  /** 품목명은 파일에 있는데 쇼핑몰명이 다른 행 */
  mallMismatchRowCount: number
}

/** `app.normalize_invoice_lookup_key`와 같은 규칙으로 비교 키만 정리한다. 원문은 바꾸지 않는다. */
export function normalizeInvoiceText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[［\[]/g, '[')
    .replace(/[］\]]/g, ']')
    .replace(/[‐‑‒–—―]/g, '-')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\]\s+/g, ']')
    .toLocaleLowerCase('ko-KR')
}

function productKey(productName: string): string {
  return normalizeInvoiceText(productName)
}

function mallKey(mallName: string): string {
  return normalizeInvoiceText(mallName).replace(/\s+/g, '')
}

function pad2(value: number | string): string {
  return String(value).padStart(2, '0')
}

function orderYmd(
  first: string,
  second: string,
  third: string,
): { year: string; month: string; day: string } | null {
  const n1 = Number(first)
  const n2 = Number(second)
  const n3 = Number(third)
  if (!Number.isFinite(n1) || !Number.isFinite(n2) || !Number.isFinite(n3)) {
    return null
  }

  let year: number
  let month: number
  let day: number

  if (first.length === 4 || n1 >= 1000) {
    year = n1
    month = n2
    day = n3
  } else if (third.length === 4 || n3 >= 1000) {
    if (n1 <= 12) {
      month = n1
      day = n2
    } else {
      day = n1
      month = n2
    }
    year = n3
  } else if (n1 > 12 && n2 <= 12) {
    year = 2000 + n1
    month = n2
    day = n3
  } else {
    month = n1
    day = n2
    year = 2000 + n3
  }

  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000) return null
  return { year: String(year), month: pad2(month), day: pad2(day) }
}

/**
 * 사방넷 주문일시를 앱 표준 YYYY-MM-DD HH:MM으로 읽는다.
 * 기본은 `2026-08-08 20:54`. 엑셀이 만든 `8/13/26`, `2026. 8. 13`,
 * 오전/오후·AM/PM도 받는다. 시각이 없으면 00:00으로 본다.
 */
export function parseMoment(value: string): string | null {
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null

  const ampmMatch = text.match(
    /^(\d{1,4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,4})(?:[ T,]+)?(오전|오후|AM|PM|am|pm)\s*(\d{1,2}):(\d{2})(?::\d{2})?$/,
  )
  if (ampmMatch) {
    const ymd = orderYmd(ampmMatch[1]!, ampmMatch[2]!, ampmMatch[3]!)
    if (!ymd) return null
    let hour = Number(ampmMatch[5])
    const minute = ampmMatch[6]!
    const meridem = ampmMatch[4]!
    const isPm = /오후|pm/i.test(meridem)
    const isAm = /오전|am/i.test(meridem)
    if (isPm && hour < 12) hour += 12
    if (isAm && hour === 12) hour = 0
    return `${ymd.year}-${ymd.month}-${ymd.day} ${pad2(hour)}:${pad2(minute)}`
  }

  const fullMatch = text.match(
    /^(\d{1,4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,4})(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/,
  )
  if (!fullMatch) return null

  const ymd = orderYmd(fullMatch[1]!, fullMatch[2]!, fullMatch[3]!)
  if (!ymd) return null
  const hour = fullMatch[4] ?? '0'
  const minute = fullMatch[5] ?? '0'
  return `${ymd.year}-${ymd.month}-${ymd.day} ${pad2(hour)}:${pad2(minute)}`
}

/** 사방넷 주문행의 주문일시를 YYYY-MM-DD HH:MM으로 뽑는다. */
export function orderMomentOf(row: SabangnetOrderRow): string | null {
  return parseMoment(row.orderedAt)
}

/** @deprecated orderMomentOf를 쓰세요. */
export function orderDateOf(row: SabangnetOrderRow): string | null {
  return orderMomentOf(row)
}

export function invoicePrefixRequestStatus(
  request: InvoicePrefixRequest,
  now: string,
): InvoicePrefixRequestStatus {
  if (!request.isActive) return 'paused'
  if (now < request.startsAt) return 'scheduled'
  if (now > request.endsAt) return 'ended'
  return 'running'
}

/** 로컬 벽시계 기준 YYYY-MM-DD HH:MM. 상태 배지·기간 판정에 쓴다. */
export function nowMoment(date = new Date()): string {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  return `${year}-${month}-${day} ${hour}:${minute}`
}

/** @deprecated nowMoment를 쓰세요. */
export function todayDateString(date = new Date()): string {
  return nowMoment(date).slice(0, 10)
}

/** datetime-local 입력값(YYYY-MM-DDTHH:MM) ↔ 앱 표준(YYYY-MM-DD HH:MM) */
export function toDatetimeLocalValue(moment: string): string {
  if (!moment) return ''
  return moment.replace(' ', 'T').slice(0, 16)
}

export function fromDatetimeLocalValue(value: string): string {
  if (!value) return ''
  return value.replace('T', ' ').slice(0, 16)
}

/** 시작 시각이 있을 때 같은 날 23:59를 제안한다. */
export function suggestEndOfDay(startsAt: string): string {
  const moment = parseMoment(startsAt)
  if (!moment) return ''
  return `${moment.slice(0, 10)} 23:59`
}

type IndexedItem = {
  request: InvoicePrefixRequest
  item: InvoicePrefixItem
}

/**
 * 쇼핑몰명과 원본 품목명이 완전 일치하고 주문일시가 행사 기간 안인 행에
 * 붙일 접두어를 계산한다. 자체품번코드 변환이 원본 품목명을 덮어쓰기 때문에
 * 이 단계를 먼저 실행한다. 규칙이 없는 조합은 그대로 통과시킨다.
 *
 * 같은 조합에 기간이 겹치는 요청 건이 둘 이상이면 접두어를 정하지 않고
 * 충돌로 보고한다. `resolutions`로 사용자가 고른 요청 건을 넘기면 그것을 쓴다.
 */
export function planInvoicePrefixes(
  rows: SabangnetOrderRow[],
  requests: InvoicePrefixRequest[],
  resolutions: Record<string, string> = {},
): InvoicePrefixPlan {
  const itemsByKey = new Map<string, IndexedItem[]>()
  for (const request of requests) {
    if (!request.isActive) continue
    for (const item of request.items) {
      const key = `${mallKey(request.mallName)}\u0000${productKey(item.productName)}`
      const list = itemsByKey.get(key) ?? []
      list.push({ request, item })
      itemsByKey.set(key, list)
    }
  }

  const prefixByRowNumber = new Map<number, string>()
  const matchByRowNumber = new Map<number, InvoicePrefixRowMatch>()
  const groupByKey = new Map<string, InvoicePrefixGroup>()
  const conflictByKey = new Map<string, InvoicePrefixConflict>()
  const usedItemIds = new Set<string>()
  let prefixedRowCount = 0
  let undatedRowCount = 0
  let outOfPeriodRowCount = 0
  let mallMismatchRowCount = 0

  const requestProducts = new Map<string, IndexedItem[]>()
  for (const request of requests) {
    if (!request.isActive) continue
    for (const item of request.items) {
      const key = productKey(item.productName)
      const list = requestProducts.get(key) ?? []
      list.push({ request, item })
      requestProducts.set(key, list)
    }
  }

  for (const row of rows) {
    const key = `${mallKey(row.mallName)}\u0000${productKey(row.productName)}`
    const candidates = itemsByKey.get(key)
    if (!candidates || candidates.length === 0) {
      const sameProduct = requestProducts.get(productKey(row.productName))
      if (sameProduct && sameProduct.length > 0) mallMismatchRowCount += 1
      continue
    }

    const moment = orderMomentOf(row)
    if (!moment) {
      undatedRowCount += 1
      continue
    }

    const inPeriod = candidates.filter(
      ({ request }) =>
        moment >= request.startsAt && moment <= request.endsAt,
    )
    if (inPeriod.length === 0) {
      outOfPeriodRowCount += 1
      continue
    }

    let chosen = inPeriod[0]!
    if (inPeriod.length > 1) {
      const resolvedId = resolutions[key]
      const resolved = resolvedId
        ? inPeriod.find(({ request }) => request.id === resolvedId)
        : undefined

      if (!resolved) {
        const conflict = conflictByKey.get(key)
        if (conflict) {
          conflict.rowCount += 1
        } else {
          conflictByKey.set(key, {
            key,
            mallName: row.mallName,
            productName: row.productName,
            rowCount: 1,
            candidates: inPeriod.map(({ request, item }) => ({
              requestId: request.id,
              requestTitle: request.title,
              itemId: item.id,
              prefix: item.prefix,
            })),
          })
        }
        continue
      }
      chosen = resolved
    }

    prefixByRowNumber.set(row.rowNumber, chosen.item.prefix)
    matchByRowNumber.set(row.rowNumber, {
      requestId: chosen.request.id,
      itemId: chosen.item.id,
      prefix: chosen.item.prefix,
    })
    prefixedRowCount += 1
    usedItemIds.add(chosen.item.id)

    const groupKey = `${chosen.request.id}\u0000${chosen.item.id}`
    const group = groupByKey.get(groupKey)
    if (group) {
      group.rowCount += 1
      continue
    }
    groupByKey.set(groupKey, {
      key: groupKey,
      requestId: chosen.request.id,
      requestTitle: chosen.request.title,
      taskNo: chosen.request.taskNo,
      mallName: chosen.request.mallName,
      productName: chosen.item.productName,
      prefix: chosen.item.prefix,
      rowCount: 1,
    })
  }

  const fileMoments = rows
    .map(orderMomentOf)
    .filter((moment): moment is string => Boolean(moment))
    .sort()
  const firstMoment = fileMoments[0]
  const lastMoment = fileMoments[fileMoments.length - 1]

  const fileMallsByProduct = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = productKey(row.productName)
    if (!key) continue
    const malls = fileMallsByProduct.get(key) ?? new Set<string>()
    if (row.mallName.trim()) malls.add(row.mallName.trim())
    fileMallsByProduct.set(key, malls)
  }

  const unusedItems: InvoicePrefixUnusedItem[] = []
  for (const request of requests) {
    if (!request.isActive) continue
    const mallInFile = rows.some(
      (row) => mallKey(row.mallName) === mallKey(request.mallName),
    )
    const productInFile = request.items.some((item) =>
      fileMallsByProduct.has(productKey(item.productName)),
    )
    const periodOverlaps =
      !firstMoment ||
      !lastMoment ||
      !(request.endsAt < firstMoment || request.startsAt > lastMoment)
    if (!periodOverlaps && !mallInFile && !productInFile) continue
    for (const item of request.items) {
      if (usedItemIds.has(item.id)) continue
      unusedItems.push({
        requestId: request.id,
        requestTitle: request.title,
        mallName: request.mallName,
        productName: item.productName,
        prefix: item.prefix,
        fileMallNames: [
          ...(fileMallsByProduct.get(productKey(item.productName)) ?? []),
        ],
      })
    }
  }

  return {
    prefixByRowNumber,
    matchByRowNumber,
    groups: [...groupByKey.values()].sort(
      (left, right) => right.rowCount - left.rowCount,
    ),
    conflicts: [...conflictByKey.values()],
    unusedItems,
    prefixedRowCount,
    passedRowCount: rows.length - prefixedRowCount,
    undatedRowCount,
    outOfPeriodRowCount,
    mallMismatchRowCount,
  }
}

/** 모든 변환이 끝난 뒤 최종 품목명 앞에 접두어를 붙인다. */
export function applyInvoicePrefix(prefix: string, finalName: string): string {
  const trimmedPrefix = prefix.trim()
  const trimmedName = finalName.trim()
  if (!trimmedPrefix) return trimmedName
  if (!trimmedName) return trimmedPrefix
  return `${trimmedPrefix} ${trimmedName}`
}
