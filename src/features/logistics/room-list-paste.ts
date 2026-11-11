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
