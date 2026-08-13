import type { InvoiceGiftAllocation } from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'
import { toAppMoment } from '@/lib/supabase/invoice-prefix-requests'

const ALLOCATION_SELECT = `
  id,
  request_id,
  item_id,
  style_id,
  mall_name,
  customer_order_no,
  ordered_at,
  order_fingerprint,
  allocation_key,
  gift_slot_index,
  source_file_name,
  cancelled_at,
  created_at,
  styles!invoice_gift_allocations_style_fkey(id, style_no, name)
`

type StyleEmbed = {
  id: string
  style_no: string
  name: string
}

type AllocationRow = {
  id: string
  request_id: string
  item_id: string
  style_id: string
  mall_name: string
  customer_order_no: string
  ordered_at: string | null
  order_fingerprint: string
  allocation_key: string
  gift_slot_index: number
  source_file_name: string
  cancelled_at: string | null
  created_at: string
  styles?: StyleEmbed | StyleEmbed[] | null
}

export class InvoiceGiftAllocationStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceGiftAllocationStoreError'
  }
}

function styleFromEmbed(
  embed: StyleEmbed | StyleEmbed[] | null | undefined,
): StyleEmbed | null {
  if (!embed) return null
  return Array.isArray(embed) ? (embed[0] ?? null) : embed
}

function toAllocation(row: AllocationRow): InvoiceGiftAllocation {
  const style = styleFromEmbed(row.styles)
  return {
    id: row.id,
    requestId: row.request_id,
    itemId: row.item_id,
    styleId: style?.id || row.style_id,
    styleNo: style?.style_no ?? '',
    styleName: style?.name ?? '',
    mallName: row.mall_name,
    customerOrderNo: row.customer_order_no,
    orderedAt: row.ordered_at ? toAppMoment(row.ordered_at) : '',
    orderFingerprint: row.order_fingerprint,
    allocationKey: row.allocation_key,
    giftSlotIndex: row.gift_slot_index,
    sourceFileName: row.source_file_name,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  }
}

export async function listInvoiceGiftAllocations(
  brandId: string,
  options?: {
    requestId?: string
    activeOnly?: boolean
  },
): Promise<InvoiceGiftAllocation[]> {
  let query = getSupabase()
    .from('invoice_gift_allocations')
    .select(ALLOCATION_SELECT)
    .eq('brand_id', brandId)
    .order('ordered_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (options?.requestId) {
    query = query.eq('request_id', options.requestId)
  }
  if (options?.activeOnly !== false) {
    query = query.is('cancelled_at', null)
  }

  const { data, error } = await query
  if (error) {
    throw new InvoiceGiftAllocationStoreError(
      errorMessage(error, '사은품 배정 원장을 불러오지 못했습니다.'),
    )
  }
  return ((data as AllocationRow[]) ?? []).map(toAllocation)
}

export type GiftAllocationCandidateInput = {
  requestId: string
  itemId: string
  styleId: string
  mallName: string
  customerOrderNo: string
  orderedAt: string
  orderFingerprint: string
  allocationKey: string
  atomicGroupKey: string
  giftSlotIndex: number
  sourceFileName?: string
}

export type ConfirmGiftAllocationsResult = {
  allocations: InvoiceGiftAllocation[]
  skipped: { allocationKey: string; reason: string }[]
}

/** 선착순 배정을 원자적으로 확정한다. */
export async function confirmInvoiceGiftAllocations(
  brandId: string,
  candidates: GiftAllocationCandidateInput[],
): Promise<ConfirmGiftAllocationsResult> {
  const payload = candidates.map((item) => ({
    request_id: item.requestId,
    item_id: item.itemId,
    style_id: item.styleId,
    mall_name: item.mallName,
    customer_order_no: item.customerOrderNo,
    ordered_at: item.orderedAt || null,
    order_fingerprint: item.orderFingerprint,
    allocation_key: item.allocationKey,
    atomic_group_key: item.atomicGroupKey,
    gift_slot_index: item.giftSlotIndex,
    source_file_name: item.sourceFileName ?? '',
  }))

  const { data, error } = await getSupabase().rpc(
    'confirm_invoice_gift_allocations',
    {
      p_brand_id: brandId,
      p_candidates: payload,
    },
  )

  if (error) {
    throw new InvoiceGiftAllocationStoreError(
      errorMessage(error, '사은품 배정을 확정하지 못했습니다.'),
    )
  }

  const raw = (data ?? {}) as {
    allocations?: Array<{
      id: string
      request_id: string
      item_id: string
      style_id: string
      mall_name: string
      customer_order_no: string
      ordered_at: string | null
      order_fingerprint: string
      allocation_key: string
      gift_slot_index: number
      reused?: boolean
    }>
    skipped?: Array<{ allocation_key: string; reason: string }>
  }

  const styleIds = [
    ...new Set((raw.allocations ?? []).map((row) => row.style_id)),
  ]
  const styleById = new Map<string, { styleNo: string; name: string }>()
  if (styleIds.length > 0) {
    const { data: styles, error: styleError } = await getSupabase()
      .from('styles')
      .select('id, style_no, name')
      .eq('brand_id', brandId)
      .in('id', styleIds)
    if (styleError) {
      throw new InvoiceGiftAllocationStoreError(
        errorMessage(styleError, '배정된 사은품 이름을 불러오지 못했습니다.'),
      )
    }
    for (const style of (styles as StyleEmbed[]) ?? []) {
      styleById.set(style.id, {
        styleNo: style.style_no,
        name: style.name,
      })
    }
  }

  return {
    allocations: (raw.allocations ?? []).map((row) => {
      const style = styleById.get(row.style_id)
      return {
        id: row.id,
        requestId: row.request_id,
        itemId: row.item_id,
        styleId: row.style_id,
        styleNo: style?.styleNo ?? '',
        styleName: style?.name ?? '',
        mallName: row.mall_name,
        customerOrderNo: row.customer_order_no,
        orderedAt: row.ordered_at ? toAppMoment(String(row.ordered_at)) : '',
        orderFingerprint: row.order_fingerprint,
        allocationKey: row.allocation_key,
        giftSlotIndex: row.gift_slot_index,
        sourceFileName: '',
        cancelledAt: null,
        createdAt: '',
      }
    }),
    skipped: (raw.skipped ?? []).map((row) => ({
      allocationKey: row.allocation_key,
      reason: row.reason,
    })),
  }
}

/** 주문 지문에 해당하는 활성 배정을 모두 취소한다. */
export async function cancelInvoiceGiftAllocations(
  brandId: string,
  requestId: string,
  orderFingerprint: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc(
    'cancel_invoice_gift_allocations',
    {
      p_brand_id: brandId,
      p_request_id: requestId,
      p_order_fingerprint: orderFingerprint,
    },
  )

  if (error) {
    throw new InvoiceGiftAllocationStoreError(
      errorMessage(error, '사은품 배정을 취소하지 못했습니다.'),
    )
  }
  return typeof data === 'number' ? data : Number(data ?? 0)
}

/** 요청 건에 활성·취소 포함 배정이 하나라도 있는지. */
export async function countInvoiceGiftAllocations(
  requestId: string,
): Promise<number> {
  const { count, error } = await getSupabase()
    .from('invoice_gift_allocations')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)

  if (error) {
    throw new InvoiceGiftAllocationStoreError(
      errorMessage(error, '사은품 배정 건수를 확인하지 못했습니다.'),
    )
  }
  return count ?? 0
}
