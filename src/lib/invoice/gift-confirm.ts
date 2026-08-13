import {
  confirmInvoiceGiftAllocations,
  getInvoiceGiftAllocations,
  getInvoiceGiftRequests,
} from '@/lib/api'
import {
  planGiftAssignments,
  type GiftAssignmentPlan,
  type GiftConfirmCandidate,
} from '@/lib/invoice/gift-assign'
import type { InvoicePrefixPlan } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoicePrefixRequest } from '@/lib/types'

export type FinalizeGiftPlanResult = {
  plan: GiftAssignmentPlan
  skippedCount: number
  confirmedNewCount: number
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
