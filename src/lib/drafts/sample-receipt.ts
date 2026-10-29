import type { DraftSampleWorkOrder } from '../types'
import { latestFilledSampleWorkOrder, newSampleWorkOrder } from './sample-work-order'

export function sampleCountry(country: string) {
  if (/중국|china/i.test(country)) return { code: 'CN', label: '중국' }
  if (/한국|국내|korea/i.test(country)) return { code: 'KO', label: '한국' }
  return { code: country.trim() || '국가 미정', label: country.trim() || '국가 미정' }
}

/** 차수에 국가가 있으면 그 값을, 없으면 기획안 제조국을 본다. 한국은 어디에도 보내지 않는다. */
export function sampleSentToChinaTeam(orderCountry: string | undefined, draftCountry: string) {
  const country = orderCountry?.trim() || draftCountry.trim()
  if (!country) return true
  return sampleCountry(country).code === 'CN'
}

/** 아직 중국팀이 발송하지 않은 최신 작업지시서에 제조국을 남긴다. 한국이면 중국 담당을 비운다. */
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
  if (!country.trim()) throw new Error('제조국을 선택해 주세요.')
  const round = Math.max(0, ...orders.filter(order => order.url?.trim()).map(order => order.round)) + 1
  return [
    ...orders.filter(order => order.url?.trim()).map(order => ({ ...order, originCountry: order.originCountry || previousCountry })),
    { ...newSampleWorkOrder(round), url: file.url, name: file.name.trim(), shippedAt: at, originCountry: country,
      assigneeId: sampleCountry(country).code === 'CN' ? latest?.assigneeId ?? null : null,
      assigneeName: sampleCountry(country).code === 'CN' ? latest?.assigneeName ?? '' : '' },
  ]
}
