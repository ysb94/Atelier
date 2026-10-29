import type { DraftColorRow, DraftColorSampleRound, DraftSpecs } from '../types'
import { canReceiveSample } from './sample-receipt'

export function isColorSampleOrdered(draft: {
  orderInProgress?: boolean
  orderDone?: boolean
}) {
  return Boolean(draft.orderInProgress || draft.orderDone)
}

export function isColorSampleReadyForPhoto(draft: {
  orderInProgress?: boolean
  orderDone?: boolean
  photoSampleDone?: boolean
}) {
  return isColorSampleOrdered(draft) && !draft.photoSampleDone
}

export function startColorSamples(colors: DraftColorRow[]) {
  return colors.map((color) =>
    color.name.trim() ? { ...color, sampleInProgress: true } : color,
  )
}

export function sanitizeColorWorkOrder(color: DraftColorRow): DraftColorRow {
  const url = color.sampleWorkOrderUrl?.trim() || null
  const shipped = Boolean(url && color.sampleWorkOrderShipped)
  return {
    ...color,
    sampleWorkOrderUrl: url,
    sampleWorkOrderName: url ? (color.sampleWorkOrderName?.trim() ?? '') : '',
    sampleWorkOrderShipped: shipped,
    sampleWorkOrderShippedAt: shipped
      ? (color.sampleWorkOrderShippedAt ?? new Date().toISOString())
      : null,
    sampleInProgress: Boolean(color.sampleInProgress || url),
  }
}

export function colorWorkOrderFileName(color: DraftColorRow) {
  return (
    color.sampleWorkOrderName.trim() ||
    `${color.name.trim() || '컬러'} 샘플 작업 지시서`
  )
}

export function filledColorWorkOrders(colors: readonly DraftColorRow[]) {
  return colors.filter((color) => Boolean(color.sampleWorkOrderUrl?.trim()))
}

export function setColorWorkOrderShipped(
  colors: DraftColorRow[],
  colorId: string,
  shipped: boolean,
  at = new Date().toISOString(),
) {
  const sharedUrl = colors.find((color) => color.id === colorId)?.sampleWorkOrderUrl?.trim()
  return colors.map((color) => {
    const sameOrder =
      color.id === colorId ||
      Boolean(sharedUrl && color.sampleWorkOrderUrl?.trim() === sharedUrl)
    if (!sameOrder) return color
    return {
      ...color,
      sampleWorkOrderShipped: shipped,
      sampleWorkOrderShippedAt: shipped
        ? (color.sampleWorkOrderShippedAt ?? at)
        : null,
    }
  })
}

function colorSampleRoundId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `csr-${crypto.randomUUID()}`
  }
  return `csr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function colorSampleTimestamp(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

export function normalizeColorSampleRounds(raw: unknown): DraftColorSampleRound[] {
  if (!Array.isArray(raw)) return []
  const rounds: DraftColorSampleRound[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<DraftColorSampleRound>
    const url = typeof row.url === 'string' ? row.url.trim() : ''
    const round = Number(row.round)
    if (!url || !Number.isFinite(round) || round < 1) continue
    rounds.push({
      id: typeof row.id === 'string' && row.id.trim() ? row.id : `csr-${round}`,
      originCountry: typeof row.originCountry === 'string' ? row.originCountry : undefined,
      round,
      url,
      name: typeof row.name === 'string' ? row.name : '',
      shippedAt: colorSampleTimestamp(row.shippedAt),
      returnedAt: colorSampleTimestamp(row.returnedAt),
      receivedAt: colorSampleTimestamp(row.receivedAt),
      passed: Boolean(row.passed),
    })
  }
  return rounds.sort((left, right) => left.round - right.round)
}

export function newColorSampleRound(
  round: number,
  file: { url: string; name: string },
  shippedAt: string | null,
): DraftColorSampleRound {
  return {
    id: colorSampleRoundId(),
    round,
    url: file.url.trim(),
    name: file.name.trim(),
    shippedAt,
    returnedAt: null,
    passed: false,
  }
}

/** 저장된 차수가 없으면 컬러에 올라간 파일 하나를 1차로 본다. */
export function resolveColorSampleRounds(draft: {
  specs: Pick<DraftSpecs, 'colorSampleRounds' | 'colorSampleRequestedAt'>
  colors: readonly DraftColorRow[]
}): DraftColorSampleRound[] {
  const stored = normalizeColorSampleRounds(draft.specs.colorSampleRounds)
  if (stored.length) return stored
  const color = draft.colors.find((item) => item.sampleWorkOrderUrl?.trim())
  const url = color?.sampleWorkOrderUrl?.trim()
  if (!color || !url) return []
  return [
    {
      id: 'csr-legacy-1',
      round: 1,
      url,
      name: color.sampleWorkOrderName?.trim() ?? '',
      shippedAt: colorSampleTimestamp(draft.specs.colorSampleRequestedAt),
      returnedAt: color.sampleWorkOrderShipped
        ? colorSampleTimestamp(color.sampleWorkOrderShippedAt)
        : null,
      passed: false,
    },
  ]
}

export function passLatestColorSampleRound(
  rounds: readonly DraftColorSampleRound[],
): DraftColorSampleRound[] {
  const latest = rounds[rounds.length - 1]
  if (!latest?.returnedAt || latest.passed) return [...rounds]
  return rounds.map((round, index) =>
    index === rounds.length - 1 ? { ...round, passed: true } : round,
  )
}

/** 아직 요청하지 않은 최신 컬러 샘플 차수에 작업지시서를 붙인다. */
export function attachOpenColorSampleRound(
  rounds: readonly DraftColorSampleRound[],
  file: { url: string; name: string },
  at = new Date().toISOString(),
): DraftColorSampleRound[] {
  const list = rounds.map((round) => ({ ...round }))
  const latest = list[list.length - 1]
  const url = file.url.trim()
  const name = file.name.trim()
  if (!url || !latest?.url || latest.shippedAt || latest.returnedAt || latest.passed) return list
  return list.map((round, index) => index === list.length - 1 ? { ...round, url, name, shippedAt: at } : round)
}

/** 다음 컬러 차수 파일을 저장하고, 중국팀 작업 지시서가 새 파일을 미발송으로 보게 한다. */
export function publishNextColorSampleRound(
  colors: readonly DraftColorRow[],
  rounds: readonly DraftColorSampleRound[],
  file: { url: string; name: string },
  at = new Date().toISOString(),
): { colors: DraftColorRow[]; rounds: DraftColorSampleRound[] } {
  const next = requestNextColorSampleRound(rounds, file, at)
  const latest = next[next.length - 1]
  if (!latest || latest.round === rounds[rounds.length - 1]?.round) {
    return { colors: colors.map((color) => ({ ...color })), rounds: next }
  }
  return {
    rounds: next,
    colors: colors.map((color) => ({
      ...color,
      sampleWorkOrderUrl: latest.url,
      sampleWorkOrderName: latest.name,
      sampleWorkOrderShipped: false,
      sampleWorkOrderShippedAt: null,
      sampleInProgress: true,
    })),
  }
}

/** 돌아온 컬러 샘플 다음에 새 작업지시서 파일을 붙여 요청한다. */
export function requestNextColorSampleRound(
  rounds: readonly DraftColorSampleRound[],
  file: { url: string; name: string },
  at = new Date().toISOString(),
): DraftColorSampleRound[] {
  const list = rounds.map((round) => ({ ...round }))
  const latest = list[list.length - 1]
  const url = file.url.trim()
  const name = file.name.trim()
  if (!url || !latest?.url || !(latest.receivedAt || latest.passed)) return list
  const round = Math.max(0, ...list.map((item) => item.round)) + 1
  return [
    ...list,
    newColorSampleRound(round, { url, name }, at),
  ]
}

export function markLatestColorSampleReturned(
  rounds: readonly DraftColorSampleRound[],
  at = new Date().toISOString(),
): DraftColorSampleRound[] {
  const latestIndex = rounds.length - 1
  const latest = rounds[latestIndex]
  if (!latest?.url || latest.returnedAt) return [...rounds]
  return rounds.map((round, index) =>
    index === latestIndex ? { ...round, returnedAt: at } : round,
  )
}

/** 등록·발송 기록을 보존하고 현재 컬러샘플의 실물 수령만 확인한다. */
export function receiveColorSample(
  rounds: readonly DraftColorSampleRound[], id: string, country: string,
  at = new Date().toISOString(),
): DraftColorSampleRound[] {
  const latest = rounds.at(-1)
  if (latest?.id !== id) throw new Error('현재 진행 중인 컬러샘플만 수령 확인할 수 있습니다.')
  if (latest.receivedAt) return [...rounds]
  if (!canReceiveSample({ ...latest, shipped: Boolean(latest.returnedAt) }, country)) throw new Error('작업지시서 등록과 발송 상태를 먼저 확인해 주세요.')
  if (Number.isNaN(Date.parse(at))) throw new Error('수령 날짜를 확인해 주세요.')
  return rounds.map(round => round.id === id ? { ...round, receivedAt: at, originCountry: round.originCountry || country } : { ...round })
}
