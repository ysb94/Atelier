import type { DraftSampleWorkOrder, ProductDraftInput } from '../types'
import { latestFilledSampleWorkOrder, legacyWorkOrderFields } from './sample-work-order'
import { registerNextReceivedSample, sampleCountry } from './sample-receipt'
import { newColorSampleRound, publishNextColorSampleRound, resolveColorSampleRounds } from './draft-flow'

export type SampleRegistrationStage = 'next' | 'final' | 'color'

type StageOrder = Pick<DraftSampleWorkOrder, 'id' | 'round'> & { sampleStage?: 'numbered' | 'final' }

/** 0은 최종, 1은 최최종, 2는 최최최종이다. */
export function finalSampleLabel(depth: number) {
  return `${'최'.repeat(Math.max(0, Math.floor(depth)))}최종 샘플`
}

export function sampleRegistrationLabel(stage: SampleRegistrationStage, nextRound: number, finalCount = 0) {
  if (stage === 'color') return '컬러샘플'
  if (stage === 'final') return finalSampleLabel(finalCount)
  return `${nextRound}차 샘플`
}

export function nextRegistrationStages(latestIsFinal: boolean): SampleRegistrationStage[] {
  return latestIsFinal ? ['final', 'color'] : ['next', 'final', 'color']
}

export function sampleOrderLabel(order: StageOrder, orders: readonly StageOrder[] = [order]) {
  if (order.sampleStage !== 'final') return `${order.round}차 샘플`
  const finals = orders.filter((item) => item.sampleStage === 'final')
  const depth = finals.findIndex((item) => item.id === order.id)
  return finalSampleLabel(depth < 0 ? 0 : depth)
}

/** 선택만으로는 바꾸지 않고 등록 시점에 새 지시서와 단계만 추가한다. */
export function registerDraftSampleStage(
  input: ProductDraftInput, stage: SampleRegistrationStage,
  file: { url: string; name: string }, country: string,
  at = new Date().toISOString(),
): ProductDraftInput {
  if (!file.url.trim() || !file.name.trim()) throw new Error('작업지시서 파일을 선택해 주세요.')
  if (!['CN', 'KO'].includes(sampleCountry(country).code)) throw new Error('제조국을 선택해 주세요.')
  const latest = latestFilledSampleWorkOrder(input.sampleWorkOrders)
  if (stage !== 'color') {
    const orders = registerNextReceivedSample(input.sampleWorkOrders, file, country, input.originCountry, at)
    const nextId = latestFilledSampleWorkOrder(orders)!.id
    const sampleWorkOrders = orders.map(order => order.id === nextId ? { ...order, sampleStage: stage === 'final' ? 'final' as const : 'numbered' as const } : order)
    return { ...input, originCountry: country, sampleWorkOrders, ...legacyWorkOrderFields(sampleWorkOrders), sampleDone: false }
  }
  if (!latest?.passed) throw new Error('대표 샘플 합격 후 컬러샘플을 등록할 수 있습니다.')
  if (!input.specs.colorsConfirmed || !input.colors.some(color => color.name.trim())) throw new Error('컬러 구성을 먼저 등록·확정해 주세요.')
  const before = resolveColorSampleRounds(input)
  const published = before.length ? publishNextColorSampleRound(input.colors, before, file, at) : {
    rounds: [newColorSampleRound(1, file, at)],
    colors: input.colors.map(color => ({ ...color, sampleWorkOrderUrl: file.url, sampleWorkOrderName: file.name, sampleWorkOrderShipped: false, sampleWorkOrderShippedAt: null, sampleInProgress: true })),
  }
  if (before.length && published.rounds.length === before.length) throw new Error('진행 중인 컬러샘플의 발송·검토 상태를 먼저 확인해 주세요.')
  const lastId = published.rounds.at(-1)!.id
  const rounds = published.rounds.map(round => ({ ...round, originCountry: round.id === lastId ? country : ('originCountry' in round && typeof round.originCountry === 'string' ? round.originCountry : input.originCountry) }))
  return {
    ...input, originCountry: country,
    sampleWorkOrders: input.sampleWorkOrders.map(order => ({ ...order, originCountry: order.originCountry || input.originCountry })),
    colors: published.colors,
    specs: { ...input.specs, colorSampleRequestedAt: at, colorSampleRounds: rounds },
  }
}
