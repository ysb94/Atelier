export type PastedGiftTargetRow = {
  productName: string
}

export type GiftTargetPasteResult = {
  rows: PastedGiftTargetRow[]
  skippedHeader: boolean
  /** 열이 부족해 읽지 못한 줄 번호 */
  invalidLines: number[]
}

/** @deprecated PastedGiftTargetRow 사용 */
export type PastedPrefixRow = PastedGiftTargetRow
/** @deprecated GiftTargetPasteResult 사용 */
export type PrefixPasteResult = GiftTargetPasteResult

const HEADER_WORDS = [
  '채널상품번호',
  '상품명',
  '접두어',
  '상품번호',
  '품목명',
  '원본품목명',
  '내품명',
]

const PRODUCT_NAME_HEADERS = ['원본품목명', '품목명', '상품명']

/** 엑셀·표에서 복사하면 탭으로 붙는다. 탭이 없으면 쉼표나 넓은 공백으로 나눈다. */
function splitCells(line: string): string[] {
  const raw = line.includes('\t')
    ? line.split('\t')
    : line.includes(',')
      ? line.split(',')
      : line.split(/ {2,}/)
  const cells = raw.map((cell) => cell.trim())

  while (cells.length > 0 && !cells[cells.length - 1]) cells.pop()
  return cells
}

function compactHeader(cell: string) {
  return cell.replace(/\s+/g, '')
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((cell) => HEADER_WORDS.includes(compactHeader(cell)))
}

function headerProductNameIndex(cells: string[]): number | null {
  const normalized = cells.map(compactHeader)
  const itemNameIdx = normalized.indexOf('내품명')
  for (const label of PRODUCT_NAME_HEADERS) {
    const idx = normalized.indexOf(label)
    if (idx >= 0 && idx !== itemNameIdx) return idx
  }
  return null
}

function looksLikeChannelProductNo(value: string): boolean {
  return /^[0-9]{4,}$/.test(value.trim())
}

function productNameFromCells(
  cells: string[],
  namedIndex: number | null,
): string {
  if (namedIndex != null) return (cells[namedIndex] ?? '').trim()

  const [first = '', second = ''] = cells
  if (cells.length >= 3 && looksLikeChannelProductNo(first) && second) {
    return second
  }
  return first
}

/**
 * 사은품·작업 지시 대상은 원본 품목명만 읽는다. 내품명은 쓰지 않는다.
 * - 머리글에 품목명이 있으면 그 열
 * - 1~2열: 첫 열
 * - 3열 이상: 사방넷(품목명·내품명·…)은 첫 열, 예전 요청서(채널상품번호·상품명·접두어)만 가운데
 */
export function parseGiftTargetPaste(text: string): GiftTargetPasteResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const rows: PastedGiftTargetRow[] = []
  const invalidLines: number[] = []
  let skippedHeader = false
  let namedIndex: number | null = null
  const seen = new Set<string>()

  lines.forEach((line, index) => {
    if (!line.trim()) return

    const cells = splitCells(line)
    if (looksLikeHeader(cells)) {
      skippedHeader = true
      const fromHeader = headerProductNameIndex(cells)
      if (fromHeader != null) namedIndex = fromHeader
      return
    }

    const productName = productNameFromCells(cells, namedIndex)
    if (!productName) {
      invalidLines.push(index + 1)
      return
    }

    const key = productName.trim().toLocaleLowerCase('ko-KR')
    if (seen.has(key)) return
    seen.add(key)
    rows.push({ productName })
  })

  return { rows, skippedHeader, invalidLines }
}

/** @deprecated parseGiftTargetPaste 사용 */
export function parsePrefixPaste(text: string): GiftTargetPasteResult {
  return parseGiftTargetPaste(text)
}
