import { compactOutboundPartnerKey, normalizeOutboundPartnerName } from '@/lib/codes/outbound-partner'
import { buildOrderFingerprint } from '@/lib/invoice/gift-assign'
import { normalizeInvoiceText, orderMomentOf } from '@/lib/invoice/prefix-transform'
import type { InvoiceOutputRow } from '@/lib/invoice/invoice-output'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { CodeUsageTarget, CodeUsageTargetAlias } from '@/lib/types'

export type InvoiceMallMatchStatus =
  | 'matched'
  | 'unmatched'
  | 'inactive'
  | 'empty'

export type InvoiceMallSite = {
  key: string
  rawNames: string[]
  displayName: string
  rowCount: number
  status: InvoiceMallMatchStatus
  usageTargetId: string | null
  officialName: string | null
}

export type InvoiceMallResolution = {
  sites: InvoiceMallSite[]
  uniqueCount: number
  matchedCount: number
  unmatchedCount: number
  inactiveCount: number
  emptyCount: number
  unresolvedCount: number
}

export type InvoiceSiteSummaryDraft = {
  usageTargetId: string
  officialName: string
  sourceMallNames: string
  orderCount: number
  sourceRowCount: number
  sourceQuantity: number
  cjOrderRowCount: number
  cjOrderQuantity: number
  cjGiftRowCount: number
  cjGiftQuantity: number
}

type PartnerHit = {
  target: CodeUsageTarget
  via: 'name' | 'alias'
}

function mallKeyOf(value: string): string {
  return compactOutboundPartnerKey(normalizeOutboundPartnerName(value))
}

function displayMallName(rawNames: readonly string[]): string {
  return rawNames[0] || '(빈 값)'
}

function buildPartnerIndex(
  targets: readonly CodeUsageTarget[],
  aliases: readonly CodeUsageTargetAlias[],
): Map<string, PartnerHit> {
  const byId = new Map(targets.map((target) => [target.id, target]))
  const index = new Map<string, PartnerHit>()

  targets.forEach((target) => {
    const key = target.normalizedName || mallKeyOf(target.name)
    if (!key || index.has(key)) return
    index.set(key, { target, via: 'name' })
  })

  aliases.forEach((alias) => {
    const key = alias.normalizedAlias || mallKeyOf(alias.alias)
    const target = byId.get(alias.targetId)
    if (!key || !target || index.has(key)) return
    index.set(key, { target, via: 'alias' })
  })

  return index
}

export function parseInvoiceQuantity(value: string): number {
  const parsed = Number(String(value).replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.floor(parsed)
}

export function countUniqueInvoiceOrders(
  rows: readonly SabangnetOrderRow[],
): number {
  return new Set(rows.map((row) => buildOrderFingerprint(row))).size
}

/** 공식 사이트 안에서 같은 주문번호는 한 건이다. 주문번호가 없으면 기존 지문을 쓴다. */
export function siteOrderIdentity(row: SabangnetOrderRow): string {
  const orderNo = normalizeInvoiceText(row.customerOrderNo)
  const orderedAt = orderMomentOf(row) || row.orderedAt.trim()
  if (orderNo) return `ono:${orderNo}|${orderedAt}`
  return buildOrderFingerprint(row)
}

export function isInvoiceMallReady(resolution: InvoiceMallResolution): boolean {
  return resolution.unresolvedCount === 0
}

/** 활성 출고업체로 연결된 쇼핑몰만 원장 업체로 쓴다. */
export function usageTargetIdForMallName(
  mallName: string,
  resolution: InvoiceMallResolution,
): string | null {
  const site = resolution.sites.find((item) => item.key === mallKeyOf(mallName))
  return site?.status === 'matched' ? site.usageTargetId : null
}

/**
 * 사방넷 행의 고유 쇼핑몰명을 활성 출고업체 정식명·별칭과 exact 매칭한다.
 * 빈 값과 미등록은 차단하고, 비활성 일치는 자동 연결하지 않는다.
 */
export function resolveInvoiceMalls(
  rows: readonly SabangnetOrderRow[],
  targets: readonly CodeUsageTarget[],
  aliases: readonly CodeUsageTargetAlias[],
): InvoiceMallResolution {
  const index = buildPartnerIndex(targets, aliases)
  const groups = new Map<
    string,
    { rawNames: Set<string>; rowCount: number }
  >()

  rows.forEach((row) => {
    const raw = normalizeOutboundPartnerName(row.mallName)
    const key = mallKeyOf(raw)
    const current = groups.get(key)
    if (current) {
      if (raw) current.rawNames.add(raw)
      current.rowCount += 1
      return
    }
    groups.set(key, {
      rawNames: raw ? new Set([raw]) : new Set(),
      rowCount: 1,
    })
  })

  const sites: InvoiceMallSite[] = [...groups.entries()].map(([key, group]) => {
    const rawNames = [...group.rawNames].sort((a, b) => a.localeCompare(b, 'ko'))
    if (!key) {
      return {
        key: '',
        rawNames,
        displayName: displayMallName(rawNames),
        rowCount: group.rowCount,
        status: 'empty',
        usageTargetId: null,
        officialName: null,
      }
    }

    const hit = index.get(key)
    if (!hit) {
      return {
        key,
        rawNames,
        displayName: displayMallName(rawNames),
        rowCount: group.rowCount,
        status: 'unmatched',
        usageTargetId: null,
        officialName: null,
      }
    }
    if (!hit.target.active) {
      return {
        key,
        rawNames,
        displayName: displayMallName(rawNames),
        rowCount: group.rowCount,
        status: 'inactive',
        usageTargetId: hit.target.id,
        officialName: hit.target.name,
      }
    }
    return {
      key,
      rawNames,
      displayName: displayMallName(rawNames),
      rowCount: group.rowCount,
      status: 'matched',
      usageTargetId: hit.target.id,
      officialName: hit.target.name,
    }
  })

  sites.sort((a, b) => {
    const rank = { empty: 0, unmatched: 1, inactive: 2, matched: 3 }
    return rank[a.status] - rank[b.status] || a.displayName.localeCompare(b.displayName, 'ko')
  })

  const matchedCount = sites.filter((site) => site.status === 'matched').length
  const unmatchedCount = sites.filter((site) => site.status === 'unmatched').length
  const inactiveCount = sites.filter((site) => site.status === 'inactive').length
  const emptyCount = sites.filter((site) => site.status === 'empty').length

  return {
    sites,
    uniqueCount: sites.length,
    matchedCount,
    unmatchedCount,
    inactiveCount,
    emptyCount,
    unresolvedCount: unmatchedCount + inactiveCount + emptyCount,
  }
}

/**
 * 수령인·전화·주소를 뺀 원본 열로 같은 파일을 가리키는 지문 원문을 만든다.
 * 파일 이름과 행 순서가 달라도 같은 내용이면 같은 문자열이 된다.
 */
export function invoiceWorkFingerprintPayload(
  rows: readonly SabangnetOrderRow[],
): string {
  return [...rows]
    .map((row) =>
      [
        row.rowNumber,
        row.productName,
        row.itemName,
        row.quantity,
        row.shippingType,
        row.customerOrderNo,
        row.mallName,
        row.orderedAt,
        row.ownProductCode,
      ].join('\t'),
    )
    .sort((a, b) => a.localeCompare(b, 'ko'))
    .join('\n')
}

export async function hashInvoiceWorkFingerprint(
  payload: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(payload)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export async function fingerprintInvoiceWorkRows(
  rows: readonly SabangnetOrderRow[],
): Promise<string> {
  return hashInvoiceWorkFingerprint(invoiceWorkFingerprintPayload(rows))
}

function targetIdForRow(
  row: SabangnetOrderRow,
  byKey: Map<string, InvoiceMallSite>,
): string | null {
  const site = byKey.get(mallKeyOf(row.mallName))
  return site?.status === 'matched' ? site.usageTargetId : null
}

/**
 * 공식 사이트별로 주문 건수와 원본·CJ 수량을 합친다.
 * 주문 지문은 메모리에서만 중복 제거하고 반환값에 넣지 않는다.
 */
export function summarizeInvoiceWorkSites(options: {
  sourceRows: readonly SabangnetOrderRow[]
  outputRows: readonly InvoiceOutputRow[]
  resolution: InvoiceMallResolution
}): InvoiceSiteSummaryDraft[] {
  const byKey = new Map(
    options.resolution.sites.map((site) => [site.key, site]),
  )
  const drafts = new Map<
    string,
    InvoiceSiteSummaryDraft & {
      fingerprints: Set<string>
      mallNames: Set<string>
    }
  >()

  function draftOf(
    site: InvoiceMallSite,
  ):
    | (InvoiceSiteSummaryDraft & {
        fingerprints: Set<string>
        mallNames: Set<string>
      })
    | null {
    if (site.status !== 'matched' || !site.usageTargetId) return null
    const current = drafts.get(site.usageTargetId)
    if (current) {
      site.rawNames.forEach((name) => current.mallNames.add(name))
      return current
    }
    const created = {
      usageTargetId: site.usageTargetId,
      officialName: site.officialName ?? site.displayName,
      sourceMallNames: '',
      orderCount: 0,
      sourceRowCount: 0,
      sourceQuantity: 0,
      cjOrderRowCount: 0,
      cjOrderQuantity: 0,
      cjGiftRowCount: 0,
      cjGiftQuantity: 0,
      fingerprints: new Set<string>(),
      mallNames: new Set(site.rawNames),
    }
    drafts.set(site.usageTargetId, created)
    return created
  }

  options.resolution.sites.forEach((site) => {
    draftOf(site)
  })

  options.sourceRows.forEach((row) => {
    const site = byKey.get(mallKeyOf(row.mallName))
    const draft = site ? draftOf(site) : null
    if (!draft) return
    draft.sourceRowCount += 1
    draft.sourceQuantity += parseInvoiceQuantity(row.quantity)
    draft.fingerprints.add(siteOrderIdentity(row))
  })

  options.outputRows.forEach((row) => {
    const targetId = targetIdForRow(row, byKey)
    const draft = targetId ? drafts.get(targetId) : null
    if (!draft) return
    const quantity = parseInvoiceQuantity(row.quantity)
    if (row.kind === 'gift') {
      draft.cjGiftRowCount += 1
      draft.cjGiftQuantity += quantity
      return
    }
    draft.cjOrderRowCount += 1
    draft.cjOrderQuantity += quantity
  })

  return [...drafts.values()]
    .map((draft) => ({
      usageTargetId: draft.usageTargetId,
      officialName: draft.officialName,
      sourceMallNames: [...draft.mallNames]
        .sort((a, b) => a.localeCompare(b, 'ko'))
        .join(', '),
      orderCount: draft.fingerprints.size,
      sourceRowCount: draft.sourceRowCount,
      sourceQuantity: draft.sourceQuantity,
      cjOrderRowCount: draft.cjOrderRowCount,
      cjOrderQuantity: draft.cjOrderQuantity,
      cjGiftRowCount: draft.cjGiftRowCount,
      cjGiftQuantity: draft.cjGiftQuantity,
    }))
    .sort((a, b) => a.officialName.localeCompare(b.officialName, 'ko'))
}
