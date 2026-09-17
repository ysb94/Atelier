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
