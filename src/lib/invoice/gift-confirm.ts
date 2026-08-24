import {
  confirmInvoiceGiftAllocations,
  confirmInvoiceGiftSourceAllocations,
  getInvoiceGiftAllocations,
  getInvoiceGiftRequests,
  getInvoiceGiftSourceAllocations,
  getInvoiceGiftSourceMaps,
} from '@/lib/api'
import {
  planGiftAssignments,
  type GiftAssignmentPlan,
  type GiftConfirmCandidate,
} from '@/lib/invoice/gift-assign'
import type { GiftSourcePlan, GiftSourceSessionRule } from '@/lib/invoice/gift-source-transform'
import { planUnifiedGifts, type UnifiedGiftPlan } from '@/lib/invoice/gift-unified'
import type { InvoicePrefixPlan } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftSourceAllocation,
  InvoicePrefixRequest,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

export type FinalizeGiftPlanResult = {
  plan: GiftAssignmentPlan
  skippedCount: number
  confirmedNewCount: number
}

export type FinalizeUnifiedGiftPlanResult = {
  plan: GiftAssignmentPlan
  giftSourcePlan: GiftSourcePlan
  skippedCount: number
  confirmedNewCount: number
  confirmedSourceCount: number
}

function toConfirmInput(
  candidates: GiftConfirmCandidate[],
  sourceFileName?: string,
) {
  return candidates.map((item) => ({
    requestId: item.requestId,
    itemId: item.itemId,
    styleId: item.styleId,
    mallName: item.mallName,
    customerOrderNo: item.customerOrderNo,
    orderedAt: item.orderedAt,
    orderFingerprint: item.orderFingerprint,
    allocationKey: item.allocationKey,
    atomicGroupKey: item.atomicGroupKey,
    giftSlotIndex: item.giftSlotIndex,
    sourceFileName,
  }))
}

/**
 * 선착순 신규 배정을 원자 확정한 뒤, 최신 원장·한도로 계획을 다시 만든다.
 * 미리보기는 DB를 바꾸지 않고, 다운로드 직전에만 호출한다.
 */
export async function finalizeGiftPlanForDownload(options: {
  brandId: string
  rows: SabangnetOrderRow[]
  prefixPlan: InvoicePrefixPlan
  requests: InvoicePrefixRequest[]
  giftPlan: GiftAssignmentPlan
  seed: number
  excludedGiftStyleIds?: string[]
  sourceFileName?: string
}): Promise<FinalizeGiftPlanResult> {
  const newCandidates = options.giftPlan.newConfirmCandidates
  if (newCandidates.length === 0) {
    return {
      plan: options.giftPlan,
      skippedCount: 0,
      confirmedNewCount: 0,
    }
  }

  const confirmResult = await confirmInvoiceGiftAllocations(
    options.brandId,
    toConfirmInput(newCandidates, options.sourceFileName),
  )

  const [requests, allocations] = await Promise.all([
    getInvoiceGiftRequests(options.brandId),
    getInvoiceGiftAllocations(options.brandId, { activeOnly: false }),
  ])

  const plan = planGiftAssignments(
    options.rows,
    options.prefixPlan,
    requests,
    {
      seed: options.seed,
      excludedGiftStyleIds: options.excludedGiftStyleIds,
      existingAllocations: allocations,
    },
  )

  return {
    plan,
    skippedCount: confirmResult.skipped.length,
    confirmedNewCount: confirmResult.allocations.length,
  }
}

function rebuildUnifiedPlan(options: {
  rows: SabangnetOrderRow[]
  campaignRows: SabangnetOrderRow[]
  prefixPlan: InvoicePrefixPlan
  requests: InvoicePrefixRequest[]
  seed: number
  excludedGiftStyleIds?: string[]
  existingAllocations: Awaited<ReturnType<typeof getInvoiceGiftAllocations>>
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  maps: Awaited<ReturnType<typeof getInvoiceGiftSourceMaps>>
  sourceAllocations: InvoiceGiftSourceAllocation[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
}): UnifiedGiftPlan {
  return planUnifiedGifts({
    campaignRows: options.campaignRows,
    sourceRows: options.rows,
    prefixPlan: options.prefixPlan,
    requests: options.requests,
    seed: options.seed,
    excludedGiftStyleIds: options.excludedGiftStyleIds,
    existingAllocations: options.existingAllocations,
    tagRoles: options.tagRoles,
    maps: options.maps,
    sourceAllocations: options.sourceAllocations,
    sessionRules: options.sessionRules,
    sessionAllocations: options.sessionAllocations,
    ignoredKeys: options.ignoredKeys,
    appliedKeys: options.appliedKeys,
  })
}

/**
 * 선착순 캠페인을 확정·재조회한 뒤 통합 배정을 다시 만들고,
 * 품목명 대체의 최종 style_id를 확정한다.
 */
export async function finalizeUnifiedGiftPlanForDownload(options: {
  brandId: string
  rows: SabangnetOrderRow[]
  campaignRows: SabangnetOrderRow[]
  prefixPlan: InvoicePrefixPlan
  requests: InvoicePrefixRequest[]
  giftPlan: GiftAssignmentPlan
  giftSourcePlan: GiftSourcePlan
  seed: number
  excludedGiftStyleIds?: string[]
  sourceFileName?: string
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
}): Promise<FinalizeUnifiedGiftPlanResult> {
  const campaignFinalized = await finalizeGiftPlanForDownload({
    brandId: options.brandId,
    rows: options.campaignRows,
    prefixPlan: options.prefixPlan,
    requests: options.requests,
    giftPlan: options.giftPlan,
    seed: options.seed,
    excludedGiftStyleIds: options.excludedGiftStyleIds,
    sourceFileName: options.sourceFileName,
  })

  const [requests, allocations, maps, sourceAllocations] = await Promise.all([
    getInvoiceGiftRequests(options.brandId),
    getInvoiceGiftAllocations(options.brandId, { activeOnly: false }),
    getInvoiceGiftSourceMaps(options.brandId, { activeOnly: true }),
    getInvoiceGiftSourceAllocations(options.brandId),
  ])

  const rebuilt = rebuildUnifiedPlan({
    rows: options.rows,
    campaignRows: options.campaignRows,
    prefixPlan: options.prefixPlan,
    requests,
    seed: options.seed,
    excludedGiftStyleIds: options.excludedGiftStyleIds,
    existingAllocations: allocations,
    tagRoles: options.tagRoles,
    maps,
    sourceAllocations,
    sessionRules: options.sessionRules,
    sessionAllocations: options.sessionAllocations,
    ignoredKeys: options.ignoredKeys,
    appliedKeys: options.appliedKeys,
  })

  const newSource = rebuilt.giftSourcePlan.confirmCandidates.filter(
    (item) => !item.isExisting,
  )
  let confirmedSourceCount = 0
  if (newSource.length > 0) {
    const confirmed = await confirmInvoiceGiftSourceAllocations(
      options.brandId,
      newSource.map((item) => ({
        mapId: item.mapId,
        styleId: item.styleId,
        allocationKey: item.allocationKey,
        orderFingerprint: item.orderFingerprint,
        quantitySlot: item.quantitySlot,
        mallName: item.mallName,
        customerOrderNo: item.customerOrderNo,
        orderedAt: item.orderedAt,
        sourceFileName: options.sourceFileName,
      })),
    )
    confirmedSourceCount = confirmed.length
  }

  const latestSourceAllocations =
    newSource.length > 0
      ? await getInvoiceGiftSourceAllocations(options.brandId)
      : sourceAllocations
  const latest = rebuildUnifiedPlan({
    rows: options.rows,
    campaignRows: options.campaignRows,
    prefixPlan: options.prefixPlan,
    requests,
    seed: options.seed,
    excludedGiftStyleIds: options.excludedGiftStyleIds,
    existingAllocations: allocations,
    tagRoles: options.tagRoles,
    maps,
    sourceAllocations: latestSourceAllocations,
    sessionRules: options.sessionRules,
    sessionAllocations: options.sessionAllocations,
    ignoredKeys: options.ignoredKeys,
    appliedKeys: options.appliedKeys,
  })

  return {
    plan: latest.giftPlan,
    giftSourcePlan: latest.giftSourcePlan,
    skippedCount: campaignFinalized.skippedCount,
    confirmedNewCount: campaignFinalized.confirmedNewCount,
    confirmedSourceCount,
  }
}
