import type { DraftSampleWorkOrder } from '../types'
import { latestFilledSampleWorkOrder, newSampleWorkOrder } from './sample-work-order'

const PROMOTION_DESTINATION = 'PROMOTION [중국]'
export const CHINA_TEAM_DESTINATION = { value: '중국', label: 'CHINA (김웅사장님)' } as const
export const CHINA_EXTERNAL_DESTINATION = { value: 'CN-EXT', label: 'CHINA (외부 업체)' } as const
export const SAMPLE_DESTINATIONS = [
  CHINA_TEAM_DESTINATION,
  CHINA_EXTERNAL_DESTINATION,
  { value: '한국', label: 'KOREA' },
  { value: PROMOTION_DESTINATION, label: PROMOTION_DESTINATION },
] as const

export function sampleCountry(country: string) {
  const value = country.trim()
  if (value === CHINA_EXTERNAL_DESTINATION.value || value === CHINA_EXTERNAL_DESTINATION.label) {
    return { code: CHINA_EXTERNAL_DESTINATION.value, label: CHINA_EXTERNAL_DESTINATION.label }
  }
  if (/^promotion\s*\[(중국|china)\]$/i.test(value)) return { code: 'PROMO', label: PROMOTION_DESTINATION }
  if (/중국|china/i.test(value)) return { code: 'CN', label: CHINA_TEAM_DESTINATION.label }
  if (/한국|국내|korea/i.test(value)) return { code: 'KO', label: 'KOREA' }
  return { code: value || '국가 미정', label: value || '국가 미정' }
}

export function isSampleDestination(value: string) {
  const { code } = sampleCountry(value)
  return code === 'CN' || code === CHINA_EXTERNAL_DESTINATION.value || code === 'KO' || code === 'PROMO'
}

/** 차수의 진행처를 우선한다. 외부 업체·KOREA·PROMOTION은 기획안에 기록한다. */
export function sampleSentToChinaTeam(orderCountry: string | undefined, draftCountry: string) {
  const country = orderCountry?.trim() || draftCountry.trim()
  if (!country) return true
  return sampleCountry(country).code === 'CN'
}

/** 최신 작업지시서의 진행처를 저장한다. 기획안에만 남기는 샘플은 중국 담당을 비운다. */
export function applySampleOrigin(orders: readonly DraftSampleWorkOrder[], country: string) {
  const latest = latestFilledSampleWorkOrder(orders)
  const nextCountry = country.trim()
  if (!latest || !nextCountry || latest.passed || latest.receivedAt) return orders.map((order) => ({ ...order }))
  if (latest.shipped && sampleCountry(latest.originCountry || '').code === 'CN' && sampleCountry(nextCountry).code !== 'CN') {
    return orders.map((order) => ({ ...order }))
  }
  const china = sampleCountry(nextCountry).code === 'CN'
  return orders.map((order) => order.id === latest.id ? {
    ...order,
    originCountry: nextCountry,
    assigneeId: china ? order.assigneeId : null,
    assigneeName: china ? order.assigneeName : '',
  } : { ...order })
}

export function canReceiveSample(order: Pick<DraftSampleWorkOrder, 'url' | 'shippedAt' | 'receivedAt' | 'passed' | 'originCountry' | 'shipped'>, country: string) {
  return Boolean(order.url?.trim() && order.shippedAt && !order.receivedAt && !order.passed &&
    (sampleCountry(order.originCountry || country).code !== 'CN' || order.shipped))
}

/** 실물 수령일만 기록한다. 반복 확인은 기존 날짜를 유지한다. */
export function receiveSample(
  orders: readonly DraftSampleWorkOrder[], id: string, country: string,
  at = new Date().toISOString(),
) {
  const latest = latestFilledSampleWorkOrder(orders)
  if (latest?.id !== id) throw new Error('현재 진행 중인 샘플만 수령 확인할 수 있습니다.')
  if (latest.receivedAt) return [...orders]
  if (!canReceiveSample(latest, country)) throw new Error('작업지시서 등록과 발송 상태를 먼저 확인해 주세요.')
  if (Number.isNaN(Date.parse(at))) throw new Error('수령 날짜를 확인해 주세요.')
  return orders.map(order => order.id === id ? { ...order, receivedAt: at, originCountry: order.originCountry || country } : { ...order })
}

/** 회의 뒤 새 파일을 등록한 시점에만 다음 차수를 추가한다. 이전 차수와 파일은 보존한다. */
export function sampleReadyForNextStage(order: Pick<DraftSampleWorkOrder, 'url' | 'receivedAt' | 'passed'> | null | undefined) {
  // Older records may only contain the legacy completion flag; do not rewrite their dates.
  return Boolean(order?.url?.trim() && (order.receivedAt || order.passed))
}

export function registerNextReceivedSample(
  orders: readonly DraftSampleWorkOrder[], file: { url: string; name: string },
  country: string, previousCountry: string, at = new Date().toISOString(),
) {
  const latest = latestFilledSampleWorkOrder(orders)
  if (!sampleReadyForNextStage(latest)) throw new Error('실물 수령을 확인한 뒤 다음 작업지시서를 등록해 주세요.')
  if (!file.url.trim() || !file.name.trim()) throw new Error('새 작업지시서 파일을 선택해 주세요.')
  if (!country.trim()) throw new Error('샘플 진행처를 선택해 주세요.')
  const round = Math.max(0, ...orders.filter(order => order.url?.trim()).map(order => order.round)) + 1
  return [
    ...orders.filter(order => order.url?.trim()).map(order => ({ ...order, originCountry: order.originCountry || previousCountry })),
    { ...newSampleWorkOrder(round), url: file.url, name: file.name.trim(), shippedAt: at, originCountry: country,
      assigneeId: sampleCountry(country).code === 'CN' ? latest?.assigneeId ?? null : null,
      assigneeName: sampleCountry(country).code === 'CN' ? latest?.assigneeName ?? '' : '' },
  ]
}
