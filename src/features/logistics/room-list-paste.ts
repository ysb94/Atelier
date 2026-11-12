import { roomListProductName } from './room-list-locations'

export type RoomListRow = [productName: string, quantity: string]

/** 엑셀은 탭이나 줄바꿈이 있는 셀을 따옴표로 감싼다. */
export function parseRoomListPaste(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  const quotedCell = /"((?:[^"]|"")*)"(?=[\t\n]|$)/y
  let row: string[] = []
  let cell = ''

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]
    if (char === '"' && cell === '') {
      quotedCell.lastIndex = index
      const match = quotedCell.exec(normalized)
      if (match) {
        cell = match[1].replaceAll('""', '"').replace(/[\t\n]/g, ' ')
        index = quotedCell.lastIndex - 1
        continue
      }
    }
    if (char === '\t' || char === '\n') {
      row.push(cell)
      cell = ''
      if (char === '\n') {
        rows.push(row)
        row = []
      }
    } else {
      cell += char
    }
  }
  if (row.length > 0 || cell !== '') rows.push([...row, cell])
  const first = rows[0]
  if (first?.length === 2 && first[0].trim() === '상품명' && first[1].trim() === '수량') rows.shift()
  return rows
}

export function emptyRoomListRow(): RoomListRow {
  return ['', '']
}

export function isRoomListQuantity(value: string) {
  return /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)
}

export function normalizeRoomListQuantity(value: string) {
  if (!value.includes('.')) return value
  const quantity = value.trim()
  return isRoomListQuantity(quantity) ? quantity.replace(/0+$/, '').replace(/\.$/, '') : value
}

type QuantityTotal = { units: bigint; places: number }

function addQuantity(total: QuantityTotal, value: string): QuantityTotal {
  const [whole, fraction = ''] = value.replaceAll(',', '').split('.')
  const places = Math.max(total.places, fraction.length)
  const units = BigInt(whole + fraction)
  return {
    units: total.units * 10n ** BigInt(places - total.places) + units * 10n ** BigInt(places - fraction.length),
    places,
  }
}

function formatQuantity({ units, places }: QuantityTotal) {
  const digits = (units < 0n ? -units : units).toString().padStart(places + 1, '0')
  const separator = digits.length - places
  const whole = BigInt(digits.slice(0, separator)).toLocaleString('ko-KR')
  const fraction = digits.slice(separator).replace(/0+$/, '')
  return `${units < 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

export function sumRoomListQuantities(quantities: Iterable<string>) {
  let total: QuantityTotal = { units: 0n, places: 0 }
  for (const quantity of quantities) {
    const value = quantity.trim()
    if (!value) continue
    if (!isRoomListQuantity(value)) return null
    total = addQuantity(total, value)
  }
  return formatQuantity(total)
}

/** 빈 수량은 합계에서 건너뛰며, 숫자가 아닌 값은 행을 지우기 전에 알려준다. */
export function mergeRoomListRows(rows: RoomListRow[]) {
  const merged: RoomListRow[] = []
  const byName = new Map<string, { mergedIndex: number; inputIndex: number }>()
  const totals = new Map<number, QuantityTotal>()
  let duplicates = 0

  for (const [index, row] of rows.entries()) {
    const name = roomListProductName(row[0])
    const firstRow = byName.get(name)
    if (!firstRow) {
      if (name) byName.set(name, { mergedIndex: merged.length, inputIndex: index })
      const quantity = normalizeRoomListQuantity(row[1])
      merged.push(quantity === row[1] ? row : [row[0], quantity])
      continue
    }

    const first = firstRow.mergedIndex
    const quantities = [{ value: row[1].trim(), inputIndex: index }]
    if (!totals.has(first)) {
      quantities.unshift({ value: merged[first][1].trim(), inputIndex: firstRow.inputIndex })
    }
    for (const { value, inputIndex } of quantities) {
      if (value && !isRoomListQuantity(value)) {
        return { invalidRow: inputIndex + 1 } as const
      }
      if (value) totals.set(first, addQuantity(totals.get(first) ?? { units: 0n, places: 0 }, value))
    }
    duplicates++
  }

  for (const [index, quantity] of totals) {
    merged[index] = [merged[index][0], formatQuantity(quantity)]
  }
  return { rows: merged, duplicates } as const
}
