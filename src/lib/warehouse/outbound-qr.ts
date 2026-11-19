export const MAX_OUTBOUND_QR_RACKS = 200
export const OUTBOUND_SLOT_LEVELS = ['A', 'B', 'C', 'D'] as const
export const OUTBOUND_SLOT_COLUMNS = [1, 2, 3, 4] as const
export const OUTBOUND_SLOTS_PER_RACK = 16

export type OutboundQrInput = {
  mode: 'range' | 'list'
  warehouse: string
  row: string
  startRack: string
  endRack: string
  list: string
}
export type OutboundQrResult = { racks: string[]; error: string | null }

function rackInteger(value: string) {
  if (!/^\d+$/.test(value.trim())) return null
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

/** Components are identifiers, including legacy symbols; '-' and '_' separate parts. */
function rackPart(value: string) {
  const part = value.trim()
  return part && !/[\s_\-\p{Cc}]/u.test(part) ? part : null
}

export function buildOutboundRackCodes(input: OutboundQrInput): OutboundQrResult {
  if (input.mode === 'list') {
    const lines = input.list.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    if (!lines.length) return { racks: [], error: '렉 번호를 한 줄에 하나씩 입력해 주세요.' }
    const racks = new Set<string>()
    for (const [index, line] of lines.entries()) {
      const parts = line.split('-').map((part) => part.trim())
      if (parts.length !== 3 || parts.some((part) => !rackPart(part))) {
        return { racks: [], error: `${index + 1}번째 렉 번호를 확인해 주세요. #-7-1처럼 창고-줄-렉을 입력하고, _A1 같은 자리 표시는 제외해 주세요.` }
      }
      racks.add(parts.join('-'))
      if (racks.size > MAX_OUTBOUND_QR_RACKS) return { racks: [], error: `한 번에 렉 ${MAX_OUTBOUND_QR_RACKS}개까지 만들 수 있습니다. 범위를 나눠 주세요.` }
    }
    return { racks: [...racks], error: null }
  }
  const warehouse = rackPart(input.warehouse)
  const row = rackPart(input.row)
  const start = rackInteger(input.startRack)
  const end = rackInteger(input.endRack)
  if (warehouse === null || row === null) return { racks: [], error: '창고·줄을 입력해 주세요. 문자·특수기호를 사용할 수 있으며 공백과 구분자(-, _)는 제외해 주세요.' }
  if (start === null || end === null) return { racks: [], error: '연속 생성할 시작·끝 렉 번호는 0 이상의 정수로 입력해 주세요. 문자·특수기호가 있는 렉은 직접 입력을 이용해 주세요.' }
  if (end < start) return { racks: [], error: '끝 렉 번호는 시작 렉 번호 이상이어야 합니다.' }
  if (end - start + 1 > MAX_OUTBOUND_QR_RACKS) return { racks: [], error: `한 번에 렉 ${MAX_OUTBOUND_QR_RACKS}개까지 만들 수 있습니다. 범위를 나눠 주세요.` }
  return { racks: Array.from({ length: end - start + 1 }, (_, index) => `${warehouse}-${row}-${start + index}`), error: null }
}

/** A is the bottom level. Export A1..A4, B1..B4, C1..C4, D1..D4 per rack. */
export function outboundSlotCodes(rack: string) {
  return OUTBOUND_SLOT_LEVELS.flatMap((level) => OUTBOUND_SLOT_COLUMNS.map((column) => `${rack}_${level}${column}`))
}

/** Keep the full QR payload and split the two text fields for iLabel. */
export function outboundSlotExcelRows(racks: readonly string[]) {
  return [['QR', '렉자리', '렉박스자리'], ...racks.flatMap((rack) => outboundSlotCodes(rack).map((code) => [code, rack, code.slice(rack.length + 1)]))]
}

export function outboundRackLabelPages<T>(labels: readonly T[]): (T | null)[][] {
  return Array.from({ length: Math.ceil(labels.length / 4) }, (_, index) => Array.from({ length: 4 }, (_, cell) => labels[index * 4 + cell] ?? null))
}
