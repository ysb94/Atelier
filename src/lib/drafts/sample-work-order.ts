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

/** 날짜만 있는 값, ISO 시각, PostgreSQL의 공백·마이크로초·짧은 시차 표기를 함께 읽는다. */
function sampleDate(value: string | null) {
  const text = value?.trim()
  if (!text) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text)
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}[T\s]+\d{2}:\d{2}/.test(text)) return null
  const source = dateOnly ? `${text}T00:00:00` : text
    .replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00')
  const date = new Date(source)
  if (Number.isNaN(date.getTime())) return null
  if (dateOnly && (date.getFullYear() !== Number(text.slice(0, 4)) || date.getMonth() + 1 !== Number(text.slice(5, 7)) || date.getDate() !== Number(text.slice(8, 10)))) return null
  return date
}

export function sheetDay(value: string | null) {
  const date = sampleDate(value)
  if (!date) return ''
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export function sampleElapsedDays(value: string | null, now = new Date()) {
  const date = sampleDate(value)
  if (!date) return null
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000))
}

export function sampleElapsedDaysLabel(value: string | null, now = new Date()) {
  const days = sampleElapsedDays(value, now)
  if (days == null) return ''
  return `${days}일 경과`
}

function sampleCalendarDay(value: string) {
  const date = sampleDate(value)
  if (!date) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** 요청일부터 회신일까지 지난 날짜 수. 같은 날이면 0일이다. */
export function sampleTripSpanDays(sentAt: string | null, returnedAt: string | null) {
  if (!sentAt || !returnedAt) return null
  const sent = sampleCalendarDay(sentAt)
  const returned = sampleCalendarDay(returnedAt)
  if (!sent || !returned) return null
  return Math.max(0, Math.round((returned.getTime() - sent.getTime()) / 86_400_000))
}

export function sampleHistoryDay(value: string | null) {
  const day = value ? sampleCalendarDay(value) : null
  if (!day) return ''
  return `${day.getFullYear()}.${String(day.getMonth() + 1).padStart(2, '0')}.${String(day.getDate()).padStart(2, '0')}`
}

export function draftStatePercent(draft: {
  nameKo: string
  nameEn: string
  colors: readonly unknown[]
  sampleDone: boolean
  orderInProgress: boolean
  orderDone: boolean
  photoSampleDone: boolean
  costConfirmed: boolean
  retailPrice: number | null
}) {
  const flags = [
    Boolean(draft.nameKo.trim() || draft.nameEn.trim()),
    draft.colors.length > 0,
    draft.sampleDone,
    draft.orderInProgress,
    draft.orderDone,
    draft.photoSampleDone,
    draft.costConfirmed,
    draft.retailPrice != null,
  ]
  return Math.round((flags.filter(Boolean).length / flags.length) * 100)
}

export function newSampleWorkOrder(round = 1): DraftSampleWorkOrder {
  return {
    id: newId(),
    round,
    url: null,
    name: '',
    shipped: false,
    shippedAt: null,
    returnedAt: null,
    passed: false,
    passedAt: null,
    failReason: '',
    assigneeId: null,
    assigneeName: '',
    fileCheckedAt: null,
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
  if (phase === 'passed') return '컬러별 샘플로 진행'
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
      (latest.shipped || latest.receivedAt) &&
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

/** 중국팀 저장 함수는 완료 표시 대신 발송일만 기록하는 버전도 있다. */
function sampleShipmentRecorded(shipped: unknown, returnedAt: unknown) {
  return Boolean(shipped || (typeof returnedAt === 'string' && sampleDate(returnedAt)))
}

export function sanitizeSampleWorkOrders(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
) {
  return filledSampleWorkOrders(orders).map((order, index) => {
    const shipped = sampleShipmentRecorded(order.shipped, order.returnedAt)
    return {
      ...order,
      round: index + 1,
      name: order.name.trim(),
      shipped,
      shippedAt: order.url?.trim() ? (order.shippedAt ?? null) : null,
      returnedAt: shipped && order.returnedAt ? order.returnedAt : null,
      receivedAt: order.receivedAt ?? null,
      passed: Boolean((shipped || order.receivedAt) && order.passed),
      passedAt:
        (shipped || order.receivedAt) && order.passed
          ? (order.passedAt ?? new Date().toISOString())
          : null,
      failReason: shipped && !order.passed ? order.failReason.trim() : '',
    }
  })
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
  return orders.map((order) => {
    if (order.id !== id) return order
    return {
      ...order,
      shipped,
      returnedAt: shipped
        ? (order.returnedAt ?? (order.shipped ? null : at))
        : null,
      passed: shipped ? order.passed : false,
      passedAt: shipped ? order.passedAt : null,
      failReason: shipped ? order.failReason : '',
    }
  })
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
  if (!latest || (!latest.shipped && !latest.receivedAt)) return orders
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

export function attachSampleWorkOrderFile(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
  file: { url: string; name: string },
  sentAt = new Date().toISOString(),
): DraftSampleWorkOrder[] {
  const url = file.url.trim()
  const name = file.name.trim()
  const list = orders?.length ? orders.map((order) => ({ ...order })) : [newSampleWorkOrder(1)]
  if (!url) return list
  const pendingIndex = list.findIndex((order) => !order.url?.trim())
  const attached = {
    url,
    name,
    shipped: false,
    shippedAt: sentAt,
    returnedAt: null,
    passed: false,
    passedAt: null,
    failReason: '',
    assigneeId: null,
    assigneeName: '',
    fileCheckedAt: null,
  }
  const pending = pendingIndex >= 0 ? list[pendingIndex] : undefined
  if (pending) {
    list[pendingIndex] = { ...pending, ...attached }
    return list
  }
  const round = Math.max(0, ...list.map((order) => order.round)) + 1
  return [...list, { ...newSampleWorkOrder(round), ...attached }]
}

/** 아직 요청하지 않은 최신 차수에 작업지시서 파일을 붙인다. */
export function attachOpenSampleWorkOrder(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
  file: { url: string; name: string },
  at = new Date().toISOString(),
): DraftSampleWorkOrder[] {
  const list = orders?.length ? orders.map((order) => ({ ...order })) : []
  const latest = latestFilledSampleWorkOrder(list)
  const url = file.url.trim()
  const name = file.name.trim()
  if (!url || !latest?.url || latest.shippedAt || latest.returnedAt || latest.passed) return list
  return list.map((order) => order.id === latest.id ? { ...order, url, name, shippedAt: at, fileCheckedAt: null } : order)
}

/** 돌아온 차수 다음에 새 작업지시서 파일을 붙여 요청한다. 이전 파일은 바꾸지 않는다. */
export function requestNextSampleRound(
  orders: readonly DraftSampleWorkOrder[] | null | undefined,
  file: { url: string; name: string },
  at = new Date().toISOString(),
): DraftSampleWorkOrder[] {
  const list = orders?.length ? orders.map((order) => ({ ...order })) : []
  const latest = latestFilledSampleWorkOrder(list)
  const url = file.url.trim()
  const name = file.name.trim()
  if (!url || !latest?.url || !latest.returnedAt || latest.passed || latest.failReason.trim()) return list
  if (list.some((order) => !order.url?.trim())) return list
  const round = Math.max(0, ...list.map((order) => order.round)) + 1
  return [
    ...list,
    {
      ...newSampleWorkOrder(round),
      url,
      name,
      shippedAt: at,
      assigneeId: latest.assigneeId,
      assigneeName: latest.assigneeName,
    },
  ]
}

export function setSampleWorkOrderAssignee(
  orders: DraftSampleWorkOrder[],
  id: string,
  assigneeId: string | null,
  assigneeName: string,
) {
  return orders.map((order) =>
    order.id === id
      ? {
          ...order,
          assigneeId,
          assigneeName: assigneeId ? assigneeName.trim() : '',
        }
      : order,
  )
}

export function setSampleWorkOrderFileChecked(
  orders: DraftSampleWorkOrder[],
  id: string,
  at = new Date().toISOString(),
) {
  return orders.map((order) =>
    order.id === id && !order.fileCheckedAt
      ? { ...order, fileCheckedAt: at }
      : order,
  )
}

export function patchSampleWorkOrder(
  orders: DraftSampleWorkOrder[],
  id: string,
  patch: Partial<DraftSampleWorkOrder>,
) {
  return orders.map((order) => {
    if (order.id !== id) return order
    if (order.receivedAt && patch.url !== undefined && patch.url !== order.url) throw new Error('수령한 샘플의 작업지시서는 바꿀 수 없습니다. 다음 차수를 등록해 주세요.')
    const next = { ...order, ...patch }
    if (!next.url?.trim()) {
      next.url = null
      next.name = ''
      next.shipped = false
      next.shippedAt = null
      next.returnedAt = null
      next.receivedAt = null
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
        returnedAt: null,
        passed: false,
        passedAt: null,
        failReason: '',
        assigneeId: null,
        assigneeName: '',
        fileCheckedAt: null,
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
  const receivedAt = url && typeof row.receivedAt === 'string' && !Number.isNaN(Date.parse(row.receivedAt)) ? row.receivedAt : null
  const shipped = Boolean(url && sampleShipmentRecorded(row.shipped, row.returnedAt))
  return {
    id: typeof row.id === 'string' && row.id ? row.id : newId(),
    sampleStage: row.sampleStage === 'final' ? 'final' : 'numbered',
    round: Number.isFinite(round) && round > 0 ? Math.floor(round) : 1,
    url,
    name: typeof row.name === 'string' ? row.name : '',
    shipped,
    shippedAt:
      url && typeof row.shippedAt === 'string' && row.shippedAt
        ? row.shippedAt
        : null,
    returnedAt:
      url &&
      shipped &&
      typeof row.returnedAt === 'string' &&
      row.returnedAt
        ? row.returnedAt
        : null,
    receivedAt,
    originCountry: typeof row.originCountry === 'string' ? row.originCountry : undefined,
    passed: Boolean(url && (shipped || receivedAt) && row.passed),
    passedAt:
      url && (shipped || receivedAt) && row.passed && typeof row.passedAt === 'string'
        ? row.passedAt
        : null,
    failReason:
      url && !row.passed && typeof row.failReason === 'string'
        ? row.failReason
        : '',
    assigneeId:
      url && typeof row.assigneeId === 'string' && row.assigneeId
        ? row.assigneeId
        : null,
    assigneeName:
      url && typeof row.assigneeName === 'string' ? row.assigneeName.trim() : '',
    fileCheckedAt:
      url && typeof row.fileCheckedAt === 'string' && row.fileCheckedAt
        ? row.fileCheckedAt
        : null,
  }
}

export function draftHasSampleWorkOrder(draft: {
  sampleWorkOrders?: DraftSampleWorkOrder[] | null
  sampleWorkOrderUrl?: string | null
  colors?: { sampleWorkOrderUrl?: string | null }[]
}) {
  return Boolean(
    latestFilledSampleWorkOrder(draft.sampleWorkOrders)?.url ||
      draft.sampleWorkOrderUrl?.trim() ||
      draft.colors?.some((color) => color.sampleWorkOrderUrl?.trim()),
  )
}

export function draftToInput(draft: ProductDraft): ProductDraftInput {
  const {
    id: _id,
    createdBy: _creator,
    companyId: _companyId,
    draftNo: _draftNo,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    promotedStyleId: _promoted,
    ...input
  } = draft
  return { ...input, expectedUpdatedAt: draft.updatedAt }
}
