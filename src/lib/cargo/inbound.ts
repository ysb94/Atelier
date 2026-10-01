export type CargoInboundStage = 'shipped' | 'scheduled' | 'done'

export type CargoInboundLineDraft = {
  id: string
  no: string
  name: string
  photo: string
  styleNo: string
  qty: string
  perBox: string
  boxes: string
  note: string
  requestNote: string
}

export function parseCargoInteger(
  value: string,
  label: string,
): number | null {
  const normalized = value.replaceAll(',', '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label}은 0 이상의 정수로 입력하세요: ${value}`)
  }
  return parsed
}

export function cargoLineHasContent(row: CargoInboundLineDraft): boolean {
  return [
    row.no,
    row.name,
    row.photo,
    row.styleNo,
    row.qty,
    row.perBox,
    row.boxes,
    row.note,
  ].some((value) => value.trim().length > 0)
}

/** 한 줄이라도 저장된 요청 사항이 있으면 창고정리용을 출력할 수 있다. */
export function hasSavedCargoRequestNote(
  lines: readonly { requestNote: string }[],
): boolean {
  return lines.some((line) => line.requestNote.trim().length > 0)
}

/** 등록 비고를 유지하고, 요청 사항은 그 아래 줄에 붙인다. */
export function formatCargoWarehouseNote(
  note: string,
  requestNote: string,
): string {
  const original = note.trim()
  const request = requestNote.trim()
  if (original && request) return `${original}\n${request}`
  return request || original
}

/** 하차용 한 칸에 올릴 수 있는 박스수+최신박스수 한도 */
export const UNLOAD_STACK_BOX_LIMIT = 16

export function parseUnloadBoxCount(value: string): number {
  const normalized = value.replaceAll(',', '').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Math.floor(parsed)
}

/**
 * 박스수+최신박스수가 한도를 넘지 않게 행을 나눈다.
 * 첫 행은 최신박스수를 먼저 넣고 남은 칸에 박스수를 채운다.
 * 남은 박스수는 한도만큼씩 이어 붙인다.
 */
export function splitUnloadStackRows(
  incomingBoxes: number,
  latestBoxes: number,
  limit = UNLOAD_STACK_BOX_LIMIT,
): Array<{ incomingBoxes: number; latestBoxes: number }> {
  const incoming = Math.max(0, Math.floor(incomingBoxes))
  const latest = Math.max(0, Math.floor(latestBoxes))
  if (incoming === 0 && latest === 0) {
    return [{ incomingBoxes: 0, latestBoxes: 0 }]
  }

  const rows: Array<{ incomingBoxes: number; latestBoxes: number }> = []
  let remainingIncoming = incoming
  let placedLatest = false

  while (remainingIncoming > 0 || !placedLatest) {
    const latestThisRow = placedLatest ? 0 : Math.min(latest, limit)
    const incomingThisRow = Math.min(
      remainingIncoming,
      Math.max(0, limit - latestThisRow),
    )
    rows.push({
      incomingBoxes: incomingThisRow,
      latestBoxes: latestThisRow,
    })
    remainingIncoming -= incomingThisRow
    placedLatest = true
    if (remainingIncoming <= 0) break
  }

  return rows
}

export type UnloadSplitQueueRow<T> = {
  value: T
  sourceIndex: number
  partIndex: number
  partCount: number
}

/**
 * Google Sheets 분할 함수처럼 원본 행은 제자리에 두고 분할된 다음 행은
 * 목록 맨 아래에 추가한다. 추가된 행도 다시 분할되면 그 나머지는 다시
 * 맨 아래로 간다. 그룹의 null은 순서 자리만 차지하고 결과에서는 빠진다.
 */
export function queueUnloadSplitRows<T>(
  groups: ReadonlyArray<ReadonlyArray<T | null>>,
): UnloadSplitQueueRow<T>[] {
  type QueuedPart = {
    value: T | null
    sourceIndex: number
    partIndex: number
    partCount: number
  }
  const queue: QueuedPart[] = []
  groups.forEach((group, sourceIndex) => {
    if (group.length === 0) return
    queue.push({
      value: group[0] ?? null,
      sourceIndex,
      partIndex: 0,
      partCount: group.length,
    })
  })

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]
    const nextPartIndex = current.partIndex + 1
    const next = groups[current.sourceIndex]?.[nextPartIndex]
    if (next === undefined) continue
    queue.push({
      value: next,
      sourceIndex: current.sourceIndex,
      partIndex: nextPartIndex,
      partCount: current.partCount,
    })
  }

  return queue.filter(
    (row): row is UnloadSplitQueueRow<T> => row.value !== null,
  )
}
