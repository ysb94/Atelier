export type PastedPrefixRow = {
  productName: string
  prefix: string
}

export type PrefixPasteResult = {
  rows: PastedPrefixRow[]
  skippedHeader: boolean
  /** 열이 부족해 읽지 못한 줄 번호 */
  invalidLines: number[]
}

const HEADER_WORDS = ['채널상품번호', '상품명', '접두어', '상품번호']

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

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((cell) => HEADER_WORDS.includes(cell.replace(/\s+/g, '')))
}

/**
 * 요청서에서 복사한 상품명·접두어를 읽는다.
 * 채널상품번호가 앞에 붙은 3열도 받되 채널상품번호는 버린다.
 */
export function parsePrefixPaste(text: string): PrefixPasteResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const rows: PastedPrefixRow[] = []
  const invalidLines: number[] = []
  let skippedHeader = false

  lines.forEach((line, index) => {
    if (!line.trim()) return

    const cells = splitCells(line)
    if (looksLikeHeader(cells)) {
      skippedHeader = true
      return
    }

    const [first = '', second = '', third = ''] = cells

    if (cells.length >= 3) {
      // 채널상품번호 · 상품명 · 접두어 → 앞열 무시
      if (!second || !third) {
        invalidLines.push(index + 1)
        return
      }
      rows.push({ productName: second, prefix: third })
      return
    }

    if (cells.length === 2 && first && second) {
      rows.push({ productName: first, prefix: second })
      return
    }

    invalidLines.push(index + 1)
  })

  return { rows, skippedHeader, invalidLines }
}
