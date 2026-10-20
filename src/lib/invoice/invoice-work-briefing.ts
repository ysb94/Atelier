import type {
  InvoiceDiscontinuedStyle,
  InvoiceGiftRequest,
  InvoicePreorderHold,
} from '@/lib/types'

export type InvoiceBriefingEventPhase = 'running' | 'later-today'

export type InvoiceBriefingGift = {
  id: string
  /** 사은품이 붙는 주문 품목명 */
  productName: string
  /** 나가는 사은품 상품명 */
  giftNames: string[]
}

export type InvoiceBriefingEvent = {
  id: string
  title: string
  mallName: string
  startsAt: string
  endsAt: string
  phase: InvoiceBriefingEventPhase
  gifts: InvoiceBriefingGift[]
}

export type InvoiceBlockedShipmentReason = 'reservation' | 'discontinued'

export type InvoiceBlockedShipmentProduct = {
  id: string
  styleId: string
  styleNo: string
  name: string
  reason: InvoiceBlockedShipmentReason
  detail: string
}

export const INVOICE_BLOCKED_SHIPMENT_REASON_LABEL: Record<
  InvoiceBlockedShipmentReason,
  string
> = {
  reservation: '예약발송',
  discontinued: '단종',
}

/** 오늘 날짜에 걸리고, 아직 끝나지 않은 활성 사은품 행사. */
export function giftEventsValidToday(
  requests: readonly InvoiceGiftRequest[],
  now: string,
): InvoiceBriefingEvent[] {
  const today = now.slice(0, 10)
  return requests
    .filter((request) => {
      if (!request.isActive) return false
      if (request.startsAt.slice(0, 10) > today) return false
      if (request.endsAt.slice(0, 10) < today) return false
      return now <= request.endsAt
    })
    .map((request) => {
      const gifts = request.items.map((item) => {
        const giftNames = [
          ...new Set(
            item.outgoingProducts
              .map((product) => product.name.trim() || product.styleNo)
              .filter(Boolean),
          ),
        ]
        return {
          id: item.id,
          productName: item.productName.trim() || '품목명 없음',
          giftNames,
        }
      })
      return {
        id: request.id,
        title: request.title,
        mallName: request.mallName,
        startsAt: request.startsAt,
        endsAt: request.endsAt,
        phase: now < request.startsAt ? 'later-today' : 'running',
        gifts,
      } satisfies InvoiceBriefingEvent
    })
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.title.localeCompare(right.title, 'ko'))
}

/**
 * 지금 송장에서 빼야 하는 상품.
 * 같은 M번호가 단종과 예약발송에 있으면 단종을 보여 준다.
 * 재고부족은 기준정보 목록이 아직 없다.
 */
export function blockedShipmentProducts(
  holds: readonly InvoicePreorderHold[],
  discontinued: readonly InvoiceDiscontinuedStyle[],
): InvoiceBlockedShipmentProduct[] {
  const byStyle = new Map<string, InvoiceBlockedShipmentProduct>()
  for (const item of discontinued) {
    byStyle.set(item.styleId, {
      id: item.id,
      styleId: item.styleId,
      styleNo: item.styleNo,
      name: item.name,
      reason: 'discontinued',
      detail: item.note.trim() || '단종 목록에 등록된 상품입니다.',
    })
  }
  for (const hold of holds) {
    if (hold.status !== 'active' || byStyle.has(hold.styleId)) continue
    const reason = hold.reason.trim()
    byStyle.set(hold.styleId, {
      id: hold.id,
      styleId: hold.styleId,
      styleNo: hold.styleNo,
      name: hold.name,
      reason: 'reservation',
      detail: reason ? `출고 예정 ${hold.shipOn} · ${reason}` : `출고 예정 ${hold.shipOn}`,
    })
  }
  return [...byStyle.values()].sort((left, right) => {
    if (left.reason !== right.reason) return left.reason === 'discontinued' ? -1 : 1
    return left.styleNo.localeCompare(right.styleNo, 'ko')
  })
}
