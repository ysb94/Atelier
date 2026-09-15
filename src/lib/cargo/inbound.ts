export type CargoInboundStage = 'shipped' | 'scheduled' | 'done'

export type CargoInboundLineDraft = {
  no: string
  name: string
  photo: string
  styleNo: string
  qty: string
  perBox: string
  boxes: string
  note: string
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
  return Object.values(row).some((value) => value.trim().length > 0)
}
