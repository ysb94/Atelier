import type { DraftColorRow, DraftColorSampleRound, DraftSpecs } from '../types'

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
      round,
      url,
      name: typeof row.name === 'string' ? row.name : '',
      shippedAt: colorSampleTimestamp(row.shippedAt),
      returnedAt: colorSampleTimestamp(row.returnedAt),
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

/** 같은 컬러 샘플 작업지시서로 다음 차수를 다시 요청한다. 파일은 바꾸지 않는다. */
export function requestNextColorSampleRound(
  rounds: readonly DraftColorSampleRound[],
  at = new Date().toISOString(),
): DraftColorSampleRound[] {
  const list = rounds.map((round) => ({ ...round }))
  const latest = list[list.length - 1]
  if (!latest?.url || !latest.returnedAt || latest.passed) return list
  const round = Math.max(0, ...list.map((item) => item.round)) + 1
  return [
    ...list,
    newColorSampleRound(round, { url: latest.url, name: latest.name }, at),
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
