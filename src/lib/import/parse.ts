export type ParsedSheet = {
  name: string
  rows: string[][]
}

/** 첫 줄의 구분자 후보 개수를 세어 탭/쉼표/세미콜론 중 하나를 고른다. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const candidates = ['\t', ',', ';']
  let best = ','
  let bestCount = 0
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += char
      i += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (char === '\r') {
      i += 1
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }

    field += char
    i += 1
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''))
}

export function parseText(text: string, name = '붙여넣은 데이터'): ParsedSheet {
  // 엑셀에서 내보낸 CSV는 앞에 BOM이 붙어 첫 헤더 이름이 깨진다.
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const delimiter = detectDelimiter(cleaned)
  return { name, rows: parseDelimited(cleaned, delimiter) }
}

function isSpreadsheet(file: File) {
  return /\.(xlsx|xls|xlsm)$/i.test(file.name)
}

function stringifyCell(cell: unknown): string {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const year = cell.getFullYear()
    const month = String(cell.getMonth() + 1).padStart(2, '0')
    const day = String(cell.getDate()).padStart(2, '0')
    const hour = String(cell.getHours()).padStart(2, '0')
    const minute = String(cell.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${minute}`
  }
  return String(cell ?? '').trim()
}

export async function parseFile(file: File): Promise<ParsedSheet[]> {
  if (isSpreadsheet(file)) {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
    return workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName]
      const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        blankrows: false,
        defval: '',
        raw: false,
        dateNF: 'yyyy-mm-dd hh:mm',
      })
      const rows = raw
        .map((cells) => cells.map((cell) => stringifyCell(cell)))
        .filter((cells) => cells.some((cell) => cell !== ''))
      return { name: sheetName, rows }
    }).filter((sheet) => sheet.rows.length > 0)
  }

  const text = await file.text()
  return [parseText(text, file.name)]
}
