import { formatNumber } from '../utils'

/** 창고정리용·하차용 한 행을 저장하는 값. 숫자는 표시 문자열로 바꾸기 전의 값이다. */
export type CargoLineListValues = {
  lineId: string
  partIndex: number
  no: string
  name: string
  styleNo: string
  quantity: number | null
  unitsPerBox: number | null
  boxCount: number | null
  stow: string
  note: string
  shippedAt: string
  latestSlot: string
  latestBoxCount: number | null
  warehouseSlot: string
}

/** DB에 넣어 둔 창고정리용 행. 표시로 되돌릴 때 이 모양이면 된다. */
export type CargoLineListStoredRow = {
  lineId: string | null
  partIndex: number
  no: string
  name: string
  styleNo: string
  quantity: number | null
  unitsPerBox: number | null
  boxCount: number | null
  stow: string
  note: string
  shippedAt: string
  latestSlot: string
  latestBoxCount: number | null
  warehouseSlot: string
}

export type CargoLineListCells = {
  no: string
  name: string
  styleNo: string
  qty: string
  perBox: string
  boxes: string
  stow: string
  slot: string
  note: string
  shippedAt: string
  latestSlot: string
  latestBoxes: string
}

/** 총수량·박스당은 콤마 없이, 박스수·최신박스수는 화면과 같이 천 단위로 끊는다. */
export function formatCargoLineListCells(
  values: CargoLineListValues,
): CargoLineListCells {
  return {
    no: values.no.trim(),
    name: values.name.trim(),
    styleNo: values.styleNo.trim(),
    qty: formatPlainInteger(values.quantity),
    perBox: formatPlainInteger(values.unitsPerBox),
    boxes: formatBoxCount(values.boxCount),
    stow: values.stow.trim(),
    slot: values.warehouseSlot.trim(),
    note: values.note.trim(),
    shippedAt: values.shippedAt.trim(),
    latestSlot: values.latestSlot.trim(),
    latestBoxes: formatBoxCount(values.latestBoxCount),
  }
}

export function storedRowToCargoLineListValues(
  row: CargoLineListStoredRow,
): CargoLineListValues {
  return {
    lineId: row.lineId ?? '',
    partIndex: row.partIndex,
    no: row.no,
    name: row.name,
    styleNo: row.styleNo,
    quantity: row.quantity,
    unitsPerBox: row.unitsPerBox,
    boxCount: row.boxCount,
    stow: row.stow,
    note: row.note,
    shippedAt: row.shippedAt,
    latestSlot: row.latestSlot,
    latestBoxCount: row.latestBoxCount,
    warehouseSlot: row.warehouseSlot,
  }
}

/** 화물 명세의 수량 문자열을 저장용 정수로 읽는다. 비었거나 정수가 아니면 null. */
export function parseCargoLineListInteger(value: string): number | null {
  const normalized = value.replaceAll(',', '').trim()
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

function formatPlainInteger(value: number | null): string {
  if (value == null) return ''
  return String(value)
}

function formatBoxCount(value: number | null): string {
  if (value == null || value <= 0) return ''
  return formatNumber(value)
}
