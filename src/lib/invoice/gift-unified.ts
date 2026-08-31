import {
  collectCampaignGiftClaims,
  materializeCampaignGiftPlan,
  type GiftAssignmentPlan,
} from '@/lib/invoice/gift-assign'
import { resolveGiftDiversity } from '@/lib/invoice/gift-diversity'
import {
  collectSourceGiftClaims,
  emptyGiftSourcePlan,
  planGiftSourceTransform,
  type GiftSourcePlan,
  type GiftSourceSessionRule,
  type GiftSourceSlot,
} from '@/lib/invoice/gift-source-transform'
import type { InvoicePrefixPlan } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceGiftAllocation,
  InvoiceGiftSourceAllocation,
  InvoiceGiftSourceMap,
  InvoicePrefixRequest,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

export type UnifiedGiftPlan = {
  giftPlan: GiftAssignmentPlan
  giftSourcePlan: GiftSourcePlan
  unavoidableDuplicateCount: number
}

export function planUnifiedGifts(options: {
  campaignRows: SabangnetOrderRow[]
  sourceRows: SabangnetOrderRow[]
  prefixPlan: InvoicePrefixPlan
  requests: InvoicePrefixRequest[]
  seed: number
  excludedGiftStyleIds?: string[]
  existingAllocations?: InvoiceGiftAllocation[]
  tagRoles?: InvoiceProductNameTagRoleEntry[]
  maps?: InvoiceGiftSourceMap[]
  sourceAllocations?: InvoiceGiftSourceAllocation[]
  sessionRules?: ReadonlyMap<string, GiftSourceSessionRule>
  sessionAllocations?: ReadonlyMap<string, StyleRef>
  ignoredKeys?: ReadonlySet<string>
  appliedKeys?: ReadonlySet<string>
  sourceSlots?: GiftSourceSlot[]
}): UnifiedGiftPlan {
  const campaign = collectCampaignGiftClaims(
    options.campaignRows,
    options.prefixPlan,
    options.requests,
    {
      seed: options.seed,
      excludedGiftStyleIds: options.excludedGiftStyleIds,
      existingAllocations: options.existingAllocations,
    },
  )
  const source = collectSourceGiftClaims({
    rows: options.sourceRows,
    tagRoles: options.tagRoles,
    maps: options.maps,
    allocations: options.sourceAllocations,
    sessionRules: options.sessionRules,
    sessionAllocations: options.sessionAllocations,
    ignoredKeys: options.ignoredKeys,
    appliedKeys: options.appliedKeys,
    slots: options.sourceSlots,
  })
  const priorCounts = new Map(campaign.priorCounts)
  for (const [styleId, count] of source.priorCounts) {
    priorCounts.set(styleId, (priorCounts.get(styleId) ?? 0) + count)
  }
  const resolved = resolveGiftDiversity({
    claims: [...campaign.claims, ...source.claims],
    seed: options.seed,
    priorCounts,
    remainingByRequestStyle: campaign.remainingByRequestStyle,
    remainingByRequest: campaign.remainingByRequest,
  })
  const resolvedByAllocationKey = new Map<string, StyleRef>()
  for (const claim of source.claims) {
    const picked = resolved.byClaimId.get(claim.id)
    if (!picked) continue
    const allocationKey = claim.id.startsWith('source:')
      ? claim.id.slice('source:'.length)
      : claim.id
    resolvedByAllocationKey.set(allocationKey, picked.style)
  }
  const giftPlan = materializeCampaignGiftPlan(campaign, resolved)
  const giftSourcePlan =
    options.sourceRows.length === 0
      ? emptyGiftSourcePlan()
      : planGiftSourceTransform({
          rows: options.sourceRows,
          tagRoles: options.tagRoles,
          maps: options.maps,
          allocations: options.sourceAllocations,
          sessionRules: options.sessionRules,
          sessionAllocations: options.sessionAllocations,
          ignoredKeys: options.ignoredKeys,
          appliedKeys: options.appliedKeys,
          resolvedByAllocationKey,
          slots: options.sourceSlots,
        })
  return {
    giftPlan: {
      ...giftPlan,
      unavoidableDuplicateCount: resolved.unavoidableDuplicateCount,
    },
    giftSourcePlan,
    unavoidableDuplicateCount: resolved.unavoidableDuplicateCount,
  }
}
