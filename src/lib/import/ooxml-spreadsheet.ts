/**
 * SheetJS가 비우는 한컴 HCell(x: 접두어) xlsx를 읽는다.
 * 표준 OOXML 워크시트·공유 문자열만 대상으로 한다.
 */

type ZipEntry = {
  name: string
  method: number
  compressed: Uint8Array
}

const LOCAL_SIG = 0x04034b50
const CD_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50

function u16(view: DataView, offset: number) {
  return view.getUint16(offset, true)
}

function u32(view: DataView, offset: number) {
  return view.getUint32(offset, true)
}

function findEocd(buffer: Uint8Array): number {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const start = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (u32(view, i) === EOCD_SIG) return i
  }
  throw new Error('엑셀 파일 형식을 읽지 못했습니다.')
}

function readZipEntries(buffer: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  const eocd = findEocd(buffer)
  const count = u16(view, eocd + 10)
  let offset = u32(view, eocd + 16)
  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntry>()

  for (let i = 0; i < count; i += 1) {
    if (u32(view, offset) !== CD_SIG) {
      throw new Error('엑셀 파일 목록을 읽지 못했습니다.')
    }
    const method = u16(view, offset + 10)
    const compact = u32(view, offset + 20)
    const nameLen = u16(view, offset + 28)
    const extraLen = u16(view, offset + 30)
    const commentLen = u16(view, offset + 32)
    const localOffset = u32(view, offset + 42)
    const name = decoder.decode(
      buffer.subarray(offset + 46, offset + 46 + nameLen),
    )
    if (u32(view, localOffset) !== LOCAL_SIG) {
      throw new Error(`엑셀 항목을 열지 못했습니다. (${name})`)
    }
    const localNameLen = u16(view, localOffset + 26)
    const localExtraLen = u16(view, localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    entries.set(name, {
      name,
      method,
      compressed: buffer.subarray(dataStart, dataStart + compact),
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const stream = new Blob([copy]).stream().pipeThrough(
    new DecompressionStream('deflate-raw'),
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function readZipText(
  entries: Map<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name)
  if (!entry) return null
  const bytes =
    entry.method === 0
      ? entry.compressed
      : entry.method === 8
        ? await inflateRaw(entry.compressed)
        : null
  if (!bytes) {
    throw new Error(`압축된 엑셀 항목을 풀지 못했습니다. (${name})`)
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&amp;/g, '&')
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return match?.[1] ?? ''
}

function columnIndex(ref: string) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? 'A'
  let index = 0
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

function parseSharedStrings(xml: string): string[] {
  const items: string[] = []
  const siRe = /<(?:x:)?si\b[^>]*>([\s\S]*?)<\/(?:x:)?si>/g
  let match: RegExpExecArray | null
  while ((match = siRe.exec(xml))) {
    const texts: string[] = []
    const tRe = /<(?:x:)?t\b[^>]*>([\s\S]*?)<\/(?:x:)?t>/g
    let textMatch: RegExpExecArray | null
    while ((textMatch = tRe.exec(match[1] ?? ''))) {
      texts.push(decodeXml(textMatch[1] ?? ''))
    }
    items.push(texts.join(''))
  }
  return items
}

function stringifyCellValue(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^-?\d+(\.0+)?$/.test(trimmed)) return String(Math.trunc(Number(trimmed)))
  return trimmed
}

function parseSheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = []
  const rowRe = /<(?:x:)?row\b[^>]*>([\s\S]*?)<\/(?:x:)?row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(xml))) {
    const cells: string[] = []
    const cellRe =
      /<(?:x:)?c\b([^>/]*)(?:\s*\/>|>([\s\S]*?)<\/(?:x:)?c>)/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRe.exec(rowMatch[1] ?? ''))) {
      const meta = cellMatch[1] ?? ''
      const body = cellMatch[2] ?? ''
      const ref = attr(meta, 'r')
      const type = attr(meta, 't')
      const valueMatch = /<(?:x:)?v\b[^>]*>([\s\S]*?)<\/(?:x:)?v>/.exec(body)
      const inlineMatch = /<(?:x:)?t\b[^>]*>([\s\S]*?)<\/(?:x:)?t>/.exec(body)
      let text = ''
      if (type === 's') {
        const index = Number(decodeXml(valueMatch?.[1] ?? ''))
        text = Number.isFinite(index) ? (shared[index] ?? '') : ''
      } else if (type === 'inlineStr' || inlineMatch) {
        text = decodeXml(inlineMatch?.[1] ?? '')
      } else if (valueMatch) {
        text = stringifyCellValue(decodeXml(valueMatch[1] ?? ''))
      }
      const col = columnIndex(ref)
      if (col >= 0) cells[col] = text.trim()
    }
    if (cells.some((cell) => cell)) {
      for (let i = 0; i < cells.length; i += 1) {
        if (cells[i] === undefined) cells[i] = ''
      }
      rows.push(cells)
    }
  }
  return rows
}

function firstWorksheetPath(workbookXml: string, relsXml: string | null) {
  const sheetMatch =
    /<(?:x:)?sheet\b[^>]*\br:id="([^"]+)"[^>]*>/.exec(workbookXml) ??
    /<(?:x:)?sheet\b[^>]*\bid="([^"]+)"[^>]*\br:id="([^"]+)"/.exec(workbookXml)
  const rId = sheetMatch?.[1]
  if (rId && relsXml) {
    const rel =
      new RegExp(
        `<Relationship\\b[^>]*\\bId="${rId}"[^>]*\\bTarget="([^"]+)"`,
      ).exec(relsXml) ??
      new RegExp(
        `<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rId}"`,
      ).exec(relsXml)
    const target = rel?.[1]
    if (target) {
      return target.startsWith('/')
        ? target.slice(1)
        : `xl/${target.replace(/^\.\//, '')}`
    }
  }
  return 'xl/worksheets/sheet1.xml'
}

export async function readPrefixedOfficeOpenXml(
  buffer: ArrayBuffer | Uint8Array,
): Promise<{ name: string; rows: string[][] }[]> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return []
  }

  const entries = readZipEntries(bytes)
  const workbookXml = await readZipText(entries, 'xl/workbook.xml')
  if (!workbookXml) return []

  const relsXml = await readZipText(entries, 'xl/_rels/workbook.xml.rels')
  const sheetPath = firstWorksheetPath(workbookXml, relsXml)
  const sheetXml = await readZipText(entries, sheetPath)
  if (!sheetXml) return []

  const sharedXml = await readZipText(entries, 'xl/sharedStrings.xml')
  const shared = sharedXml ? parseSharedStrings(sharedXml) : []
  const nameMatch = /<(?:x:)?sheet\b[^>]*\bname="([^"]+)"/.exec(workbookXml)
  const rows = parseSheetRows(sheetXml, shared)
  if (rows.length === 0) return []
  return [{ name: decodeXml(nameMatch?.[1] ?? 'Sheet1'), rows }]
}

export function canUsePrefixedOfficeOpenXmlFallback(
  sheets: Array<{ rows: string[][] }>,
) {
  return sheets.length === 0 || sheets.every((sheet) => sheet.rows.length === 0)
}
