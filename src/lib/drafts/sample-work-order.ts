import type {
  DraftSampleWorkOrder,
  ProductDraft,
  ProductDraftInput,
} from '@/lib/types'

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `swo-${crypto.randomUUID()}`
  }
  return `swo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function newSampleWorkOrder(round = 1): DraftSampleWorkOrder {
  return {
    id: newId(),
    round,
    url: null,
    name: '',
    shipped: false,
    shippedAt: null,
    passed: false,
    passedAt: null,
    failReason: '',
  }
}

export type SamplePhase = 'empty' | 'in_progress' | 'shipped' | 'passed'

export function samplePhase(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
): SamplePhase {
  const latest = latestFilledSampleWorkOrder(orders)
  if (!latest) return 'empty'
  if (latest.passed) return 'passed'
  if (latest.shipped) return 'shipped'
  return 'in_progress'
}

export function samplePhaseLabel(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const latest = latestFilledSampleWorkOrder(orders)
  const phase = samplePhase(orders)
  if (!latest || phase === 'empty') return '샘플 진행 중'
  const round = sampleWorkOrderLabel(latest.round)
  if (phase === 'passed') return `${round} 샘플 합격`
  if (phase === 'shipped') return `${round} 샘플 발송완료`
  return `${round} 샘플 진행중`
}

export function samplePhaseHint(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const phase = samplePhase(orders)
  if (phase === 'passed') return '발주로 진행'
  if (phase === 'shipped') return '도착 후 합격·불합격'
  if (phase === 'in_progress') return '중국팀 제작'
  return '작업 지시서를 올리면 시작합니다'
}

export function isSamplePassed(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  return samplePhase(orders) === 'passed'
}

export function sampleWorkOrderLabel(round: number) {
  return `${round}차`
}

export function sampleWorkOrderFileName(order: DraftSampleWorkOrder) {
  return (
    order.name.trim() || `${sampleWorkOrderLabel(order.round)} 샘플 작업 지시서`
  )
}

export function filledSampleWorkOrders(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  return (orders ?? []).filter((order) => Boolean(order.url?.trim()))
}

export function latestFilledSampleWorkOrder(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const filled = filledSampleWorkOrders(orders)
  return filled[filled.length - 1]
}

export function canAddNextSampleWorkOrder(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const latest = latestFilledSampleWorkOrder(orders)
  return Boolean(
    latest?.url &&
      latest.shipped &&
      !latest.passed &&
      !latest.failReason.trim(),
  )
}

export function canPassLatestSampleWorkOrder(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  return canAddNextSampleWorkOrder(orders)
}

export function addNextSampleWorkOrder(orders: DraftSampleWorkOrder[]) {
  if (!canAddNextSampleWorkOrder(orders)) return orders
  if (orders.some((order) => !order.url?.trim())) return orders
  return [...orders, newSampleWorkOrder(orders.length + 1)]
}

export function failLatestSampleWorkOrder(
  orders: DraftSampleWorkOrder[],
  reason: string,
) {
  if (!canAddNextSampleWorkOrder(orders)) return orders
  const failReason = reason.trim()
  if (!failReason) return orders
  const latest = latestFilledSampleWorkOrder(orders)
  if (!latest || orders.some((order) => !order.url?.trim())) return orders
  return [
    ...orders.map((order) =>
      order.id === latest.id
        ? { ...order, failReason, passed: false, passedAt: null }
        : order,
    ),
    newSampleWorkOrder(orders.length + 1),
  ]
}

export function previousSampleFailReason(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
  orderId: string,
) {
  const list = orders ?? []
  const index = list.findIndex((order) => order.id === orderId)
  if (index <= 0) return ''
  return list[index - 1]?.failReason?.trim() ?? ''
}

/** 불합격 뒤 아직 안 올린 다음 칸을 화면에 다시 붙인다. */
export function withPendingNextSampleWorkOrder(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const list = orders?.length ? [...orders] : [newSampleWorkOrder(1)]
  const latest = latestFilledSampleWorkOrder(list)
  if (
    latest?.shipped &&
    !latest.passed &&
    latest.failReason.trim() &&
    !list.some((order) => !order.url?.trim())
  ) {
    return [...list, newSampleWorkOrder(list.length + 1)]
  }
  return list
}

export function sanitizeSampleWorkOrders(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  return filledSampleWorkOrders(orders).map((order, index) => ({
    ...order,
    round: index + 1,
    name: order.name.trim(),
    shipped: Boolean(order.shipped),
    shippedAt: order.shipped ? (order.shippedAt ?? new Date().toISOString()) : null,
    passed: Boolean(order.shipped && order.passed),
    passedAt:
      order.shipped && order.passed
        ? (order.passedAt ?? new Date().toISOString())
        : null,
    failReason:
      order.shipped && !order.passed ? order.failReason.trim() : '',
  }))
}

export function legacyWorkOrderFields(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  const latest = latestFilledSampleWorkOrder(orders)
  return {
    sampleWorkOrderUrl: latest?.url ?? null,
    sampleWorkOrderName: latest?.name ?? '',
  }
}

export function setSampleWorkOrderShipped(
  orders: DraftSampleWorkOrder[],
  id: string,
  shipped: boolean,
  at = new Date().toISOString(),
) {
  return orders.map((order) =>
    order.id === id
      ? {
          ...order,
          shipped,
          shippedAt: shipped ? (order.shippedAt ?? at) : null,
          passed: shipped ? order.passed : false,
          passedAt: shipped ? order.passedAt : null,
          failReason: shipped ? order.failReason : '',
        }
      : order,
  )
}

export function setLatestSampleWorkOrderShipped(
  orders: DraftSampleWorkOrder[],
  shipped: boolean,
  at = new Date().toISOString(),
) {
  const latest = latestFilledSampleWorkOrder(orders)
  if (!latest) return orders
  return setSampleWorkOrderShipped(orders, latest.id, shipped, at)
}

export function setLatestSampleWorkOrderPassed(
  orders: DraftSampleWorkOrder[],
  passed: boolean,
  at = new Date().toISOString(),
) {
  const latest = latestFilledSampleWorkOrder(orders)
  if (!latest?.shipped) return orders
  return orders.map((order) =>
    order.id === latest.id
      ? {
          ...order,
          passed,
          passedAt: passed ? (order.passedAt ?? at) : null,
          failReason: passed ? '' : order.failReason,
        }
      : { ...order, passed: false, passedAt: null },
  )
}

export function patchSampleWorkOrder(
  orders: DraftSampleWorkOrder[],
  id: string,
  patch: Partial<DraftSampleWorkOrder>,
) {
  return orders.map((order) => {
    if (order.id !== id) return order
    const next = { ...order, ...patch }
    if (!next.url?.trim()) {
      next.url = null
      next.name = ''
      next.shipped = false
      next.shippedAt = null
      next.passed = false
      next.passedAt = null
      next.failReason = ''
    }
    return next
  })
}

export function removeSampleWorkOrder(
  orders: DraftSampleWorkOrder[],
  id: string,
) {
  const removed = orders.find((order) => order.id === id)
  const next = orders.filter((order) => order.id !== id)
  if (next.length === 0) return [newSampleWorkOrder(1)]
  const remapped = next.map((order, index) => ({ ...order, round: index + 1 }))
  if (removed && !removed.url?.trim()) {
    const last = remapped[remapped.length - 1]
    if (last?.failReason.trim()) {
      return remapped.map((order, index) =>
        index === remapped.length - 1 ? { ...order, failReason: '' } : order,
      )
    }
  }
  return remapped
}

export function normalizeSampleWorkOrders(
  raw: unknown,
  fallbackUrl?: string | null,
  fallbackName?: string,
): DraftSampleWorkOrder[] {
  const fromJson = Array.isArray(raw)
    ? raw.flatMap((value) => {
        const parsed = parseSampleWorkOrder(value)
        return parsed ? [parsed] : []
      })
    : []
  const filled = sanitizeSampleWorkOrders(fromJson)
  if (filled.length > 0) return filled
  if (fallbackUrl?.trim()) {
    return [
      {
        id: newId(),
        round: 1,
        url: fallbackUrl,
        name: fallbackName?.trim() ?? '',
        shipped: false,
        shippedAt: null,
        passed: false,
        passedAt: null,
        failReason: '',
      },
    ]
  }
  return [newSampleWorkOrder(1)]
}

function parseSampleWorkOrder(value: unknown): DraftSampleWorkOrder | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const url = typeof row.url === 'string' && row.url.trim() ? row.url : null
  const round = Number(row.round)
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newId(),
    round: Number.isFinite(round) && round > 0 ? Math.floor(round) : 1,
    url,
    name: typeof row.name === 'string' ? row.name : '',
    shipped: Boolean(url && row.shipped),
    shippedAt:
      url && row.shipped && typeof row.shippedAt === 'string'
        ? row.shippedAt
        : null,
    passed: Boolean(url && row.shipped && row.passed),
    passedAt:
      url && row.shipped && row.passed && typeof row.passedAt === 'string'
        ? row.passedAt
        : null,
    failReason:
      url && !row.passed && typeof row.failReason === 'string'
        ? row.failReason
        : '',
  }
}

export function draftHasSampleWorkOrder(draft: {
  sampleWorkOrders?: DraftSampleWorkOrder[] | null
  sampleWorkOrderUrl?: string | null
}) {
  return Boolean(
    latestFilledSampleWorkOrder(draft.sampleWorkOrders)?.url ||
      draft.sampleWorkOrderUrl?.trim(),
  )
}

export function draftToInput(draft: ProductDraft): ProductDraftInput {
  const {
    id: _id,
    companyId: _companyId,
    draftNo: _draftNo,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    promotedStyleId: _promoted,
    ...input
  } = draft
  return input
}
