import type { CargoLineListCells } from './line-list'

/** 현장 목록 인쇄. 글자가 잘리지 않는 선에서 한 장을 가장 크게 채운다. */
export const CARGO_LINE_LIST_PRINT_LINE_HEIGHT = 1.2
export const CARGO_LINE_LIST_PRINT_TITLE_PT = 14
export const CARGO_LINE_LIST_PRINT_META_PT = 9

const MIN_FONT_PT = 7
const MAX_FONT_PT = 16
const FONT_STEP_PT = 0.5
const HEADER_FONT_RATIO = 0.8
const TEXT_WIDTH_FUDGE = 1.04
const TEXT_WIDTH_SLACK_MM = 0.2
const NAME_WRAP_FUDGE = 1.02
const PAD_X_MM = 1.5
const PAD_Y_MM = 0.8
/** 제목·메타와 인쇄 여백 오차를 뺀 뒤의 표 높이. */
const CHROME_MM = 14
/** 셀 테두리가 1px로 올라가 행 높이 밖으로 더해져도 다음 장으로 넘치지 않게 남기는 여유. */
const PAGE_SLACK_MM = 8
const TEXT_HEIGHT_RATIO = 0.85
const PHOTO_MIN_MM = 5
const PHOTO_MAX_MM = 14
/** 비고가 이 줄 수를 넘으면 그 행만 비대해져 나머지 행이 다시 좁아진다. */
const NOTE_LINE_CAP = 3
const ORIENTATION_GAIN_PT = 1.5
const MM_PER_PT = 25.4 / 72

const PAGE_SPEC = {
  portrait: {
    pageSize: 'A4 portrait',
    pageMargin: '8mm 7mm',
    contentWidthMm: 196,
    contentHeightMm: 281,
    slotMinMm: 18,
  },
  landscape: {
    pageSize: 'A4 landscape',
    pageMargin: '7mm 8mm',
    contentWidthMm: 281,
    contentHeightMm: 196,
    slotMinMm: 26,
  },
} as const

const TEXT_COLUMN_KEYS = new Set([
  'no',
  'name',
  'styleNo',
  'qty',
  'perBox',
  'boxes',
  'stow',
  'slot',
  'note',
  'shippedAt',
  'latestSlot',
  'latestBoxes',
])

export type CargoLineListPrintOrientation = 'portrait' | 'landscape'

export type CargoLineListPrintColumnInput = {
  key: string
  printLabel: string
}

export type CargoLineListPrintPage = {
  start: number
  end: number
  rowHeightsMm: number[]
}

export type CargoLineListPrintColumnLayout = {
  key: string
  widthMm: number
  widthPercent: number
}

export type CargoLineListPrintLayout = {
  orientation: CargoLineListPrintOrientation
  pageSize: string
  pageMargin: string
  fontPt: number
  headerFontPt: number
  nameLines: number
  tableHeightMm: number
  headerHeightMm: number
  photoMm: number
  padXMm: number
  contentWidthMm: number
  columns: CargoLineListPrintColumnLayout[]
  pages: CargoLineListPrintPage[]
}

type PageSpec = (typeof PAGE_SPEC)[CargoLineListPrintOrientation]

type PageSpan = {
  start: number
  end: number
}

type WidthPlan = {
  columns: CargoLineListPrintColumnLayout[]
  noteInnerMm: number
}

function roundMm(value: number) {
  return Math.round(value * 100) / 100
}

function roundPt(value: number) {
  return Math.round(value * 10) / 10
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function isWidePrintChar(char: string) {
  const code = char.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe1f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

/** 한글 1em, 영숫자 0.62em, 공백 0.35em. 잘림을 피하려고 조금 넓게 잡는다. */
export function measureCargoPrintTextMm(text: string, fontPt: number) {
  let em = 0
  for (const char of text) {
    if (char === ' ') em += 0.35
    else if (isWidePrintChar(char)) em += 1
    else if (/[0-9A-Za-z]/.test(char)) em += 0.62
    else em += 0.55
  }
  if (em === 0) return 0
  return em * fontPt * MM_PER_PT * TEXT_WIDTH_FUDGE + TEXT_WIDTH_SLACK_MM
}

export function formatCargoLineListPrintFontPt(fontPt: number) {
  const rounded = roundPt(fontPt)
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatCargoLineListPrintOptionLabel(
  directionLabel: string,
  layout: CargoLineListPrintLayout,
) {
  const pages = layout.pages.length > 1 ? ` · ${layout.pages.length}장` : ''
  return `${directionLabel} · 글자 ${formatCargoLineListPrintFontPt(layout.fontPt)}pt${pages}`
}

function cellText(row: CargoLineListCells, key: string) {
  if (!TEXT_COLUMN_KEYS.has(key)) return ''
  return row[key as keyof CargoLineListCells]
}

function lineBoxMm(fontPt: number) {
  return fontPt * CARGO_LINE_LIST_PRINT_LINE_HEIGHT * MM_PER_PT
}

function headerHeightMm(fontPt: number) {
  return roundMm(2 * lineBoxMm(fontPt * HEADER_FONT_RATIO) + PAD_Y_MM)
}

function headerTextWidthMm(label: string, bodyFontPt: number) {
  const headerPt = bodyFontPt * HEADER_FONT_RATIO
  const parts = label.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return Math.max(
      ...parts.map((part) => measureCargoPrintTextMm(part, headerPt)),
    )
  }
  return measureCargoPrintTextMm(label, headerPt)
}

function textWidthForLines(text: string, lines: number, fontPt: number) {
  const width = measureCargoPrintTextMm(text, fontPt)
  if (lines <= 1 || width <= 0) return width
  let widest = 0
  for (const char of text) {
    widest = Math.max(widest, measureCargoPrintTextMm(char, fontPt))
  }
  return Math.max(widest, (width / lines) * NAME_WRAP_FUDGE)
}

function countWrappedLines(text: string, innerMm: number, fontPt: number) {
  const trimmed = text.trim()
  if (!trimmed) return 1
  const widthLimit = Math.max(innerMm, 0.1)
  let lines = 0
  for (const part of trimmed.split('\n')) {
    const width = measureCargoPrintTextMm(part, fontPt)
    if (width <= 0) {
      lines += 1
      continue
    }
    lines += Math.max(1, Math.ceil(width / widthLimit - 1e-6))
  }
  return Math.max(1, lines)
}

function evenSpans(count: number, pages: number): PageSpan[] {
  if (count <= 0) return [{ start: 0, end: 0 }]
  const base = Math.floor(count / pages)
  const extra = count % pages
  const spans: PageSpan[] = []
  let cursor = 0
  for (let index = 0; index < pages; index += 1) {
    const size = base + (index < extra ? 1 : 0)
    spans.push({ start: cursor, end: cursor + size })
    cursor += size
  }
  return spans
}

function toPercents(widths: number[], flexibleIndex: number) {
  const total = widths.reduce((sum, width) => sum + width, 0)
  const basis = widths.map((width) => Math.floor((width / total) * 10000))
  const used = basis.reduce((sum, value) => sum + value, 0)
  const index = flexibleIndex >= 0 ? flexibleIndex : 0
  basis[index] = (basis[index] ?? 0) + (10000 - used)
  return basis.map((value) => value / 100)
}

function columnLabel(
  columns: readonly CargoLineListPrintColumnInput[],
  key: string,
) {
  return columns.find((column) => column.key === key)?.printLabel ?? ''
}

function planWidths(
  rows: readonly CargoLineListCells[],
  columns: readonly CargoLineListPrintColumnInput[],
  spec: PageSpec,
  fontPt: number,
  nameLines: number,
  photoMm: number,
): WidthPlan | null {
  const contentWidth = spec.contentWidthMm
  const fixedWidths = new Map<string, number>()
  let fixedSum = 0
  for (const column of columns) {
    if (column.key === 'name' || column.key === 'note') continue
    let textWidth = headerTextWidthMm(column.printLabel, fontPt)
    if (column.key === 'photo') {
      textWidth = Math.max(textWidth, photoMm)
    } else {
      for (const row of rows) {
        textWidth = Math.max(
          textWidth,
          measureCargoPrintTextMm(cellText(row, column.key), fontPt),
        )
      }
    }
    let width = textWidth + PAD_X_MM
    if (column.key === 'slot') width = Math.max(width, spec.slotMinMm)
    fixedWidths.set(column.key, width)
    fixedSum += width
  }

  let nameNeed = headerTextWidthMm(columnLabel(columns, 'name'), fontPt)
  for (const row of rows) {
    nameNeed = Math.max(
      nameNeed,
      textWidthForLines(row.name, nameLines, fontPt),
    )
  }
  let noteNeed = Math.max(
    headerTextWidthMm(columnLabel(columns, 'note'), fontPt),
    8,
  )
  for (const row of rows) {
    const parts = row.note
      .split('\n')
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 0) continue
    const linesForPart = Math.max(1, Math.floor(NOTE_LINE_CAP / parts.length))
    for (const part of parts) {
      noteNeed = Math.max(
        noteNeed,
        textWidthForLines(part, linesForPart, fontPt),
      )
    }
  }
  const nameMin = nameNeed + PAD_X_MM
  const noteMin = noteNeed + PAD_X_MM
  if (fixedSum + nameMin + noteMin > contentWidth + 0.05) return null

  const extra = contentWidth - fixedSum - nameMin - noteMin
  let noteWidth = noteMin + extra * 0.38
  let nameWidth = contentWidth - fixedSum - noteWidth
  if (nameWidth < nameMin - 0.05) return null
  noteWidth = contentWidth - fixedSum - nameWidth

  const ordered = columns.map((column) => {
    if (column.key === 'name') return nameWidth
    if (column.key === 'note') return noteWidth
    return fixedWidths.get(column.key) ?? 0
  })
  const nameIndex = columns.findIndex((column) => column.key === 'name')
  const percents = toPercents(ordered, nameIndex)
  return {
    noteInnerMm: noteWidth - PAD_X_MM,
    columns: columns.map((column, index) => ({
      key: column.key,
      widthMm: roundMm(ordered[index] ?? 0),
      widthPercent: percents[index] ?? 0,
    })),
  }
}

function rowHeightsForPage(
  rows: readonly CargoLineListCells[],
  fontPt: number,
  nameLines: number,
  noteInnerMm: number,
  bodyHeightMm: number,
  tableHeightMm: number,
) {
  if (rows.length === 0) return []
  const line = lineBoxMm(fontPt)
  const average = tableHeightMm / rows.length
  if (line > TEXT_HEIGHT_RATIO * average + 0.02) return null

  const units = rows.map((row) =>
    Math.max(nameLines, countWrappedLines(row.note, noteInnerMm, fontPt)),
  )
  if (units.some((unit) => unit > NOTE_LINE_CAP)) return null
  const minimums = units.map((unit) => unit * line + PAD_Y_MM)
  const minimumSum = minimums.reduce((sum, height) => sum + height, 0)
  if (minimumSum > bodyHeightMm + 0.05) return null

  const share = (bodyHeightMm - minimumSum) / rows.length
  const heights = minimums.map((height) => roundMm(height + share))
  const drift = roundMm(
    bodyHeightMm - heights.reduce((sum, height) => sum + height, 0),
  )
  const last = heights.length - 1
  heights[last] = roundMm((heights[last] ?? 0) + drift)
  const nameBlock = nameLines * line
  if (heights.some((height) => height + 0.05 < nameBlock)) return null
  return heights
}

function tryLayout(
  rows: readonly CargoLineListCells[],
  orientation: CargoLineListPrintOrientation,
  columns: readonly CargoLineListPrintColumnInput[],
  fontPt: number,
  nameLines: number,
  spans: readonly PageSpan[],
): CargoLineListPrintLayout | null {
  const spec = PAGE_SPEC[orientation]
  const tableHeight = roundMm(spec.contentHeightMm - CHROME_MM - PAGE_SLACK_MM)
  const headerHeight = headerHeightMm(fontPt)
  const bodyHeight = roundMm(tableHeight - headerHeight)
  if (bodyHeight <= 0) return null

  const tightest = Math.max(...spans.map((span) => span.end - span.start), 1)
  const evenRow = bodyHeight / tightest
  let photoMm = clamp(evenRow - PAD_Y_MM - 1, PHOTO_MIN_MM, PHOTO_MAX_MM)
  let widths = planWidths(rows, columns, spec, fontPt, nameLines, photoMm)
  if (!widths && photoMm > PHOTO_MIN_MM) {
    photoMm = PHOTO_MIN_MM
    widths = planWidths(rows, columns, spec, fontPt, nameLines, photoMm)
  }
  if (!widths) return null

  const pages: CargoLineListPrintPage[] = []
  for (const span of spans) {
    const heights = rowHeightsForPage(
      rows.slice(span.start, span.end),
      fontPt,
      nameLines,
      widths.noteInnerMm,
      bodyHeight,
      tableHeight,
    )
    if (!heights) return null
    pages.push({ start: span.start, end: span.end, rowHeightsMm: heights })
  }

  const placed = pages.flatMap((page) => page.rowHeightsMm)
  const minRow = placed.length > 0 ? Math.min(...placed) : evenRow
  const photoColumn = widths.columns.find((column) => column.key === 'photo')
  const photoInner = (photoColumn?.widthMm ?? photoMm) - PAD_X_MM
  photoMm = clamp(
    Math.min(minRow - PAD_Y_MM - 0.4, photoInner),
    PHOTO_MIN_MM,
    PHOTO_MAX_MM,
  )

  return {
    orientation,
    pageSize: spec.pageSize,
    pageMargin: spec.pageMargin,
    fontPt: roundPt(fontPt),
    headerFontPt: roundPt(fontPt * HEADER_FONT_RATIO),
    nameLines,
    tableHeightMm: tableHeight,
    headerHeightMm: headerHeight,
    photoMm: roundMm(photoMm),
    padXMm: PAD_X_MM,
    contentWidthMm: spec.contentWidthMm,
    columns: widths.columns,
    pages,
  }
}

function largestLayout(
  rows: readonly CargoLineListCells[],
  orientation: CargoLineListPrintOrientation,
  columns: readonly CargoLineListPrintColumnInput[],
  spans: readonly PageSpan[],
  nameLineOptions: readonly number[],
) {
  let winner: CargoLineListPrintLayout | null = null
  for (const nameLines of nameLineOptions) {
    const steps = Math.round((MAX_FONT_PT - MIN_FONT_PT) / FONT_STEP_PT)
    for (let step = 0; step <= steps; step += 1) {
      const fontPt = roundPt(MAX_FONT_PT - step * FONT_STEP_PT)
      const layout = tryLayout(
        rows,
        orientation,
        columns,
        fontPt,
        nameLines,
        spans,
      )
      if (!layout) continue
      if (
        !winner ||
        layout.fontPt > winner.fontPt ||
        (layout.fontPt === winner.fontPt && nameLines < winner.nameLines)
      ) {
        winner = layout
      }
      break
    }
  }
  return winner
}

export function buildCargoLineListPrintLayout(
  rows: readonly CargoLineListCells[],
  orientation: CargoLineListPrintOrientation,
  columns: readonly CargoLineListPrintColumnInput[],
): CargoLineListPrintLayout {
  const count = rows.length
  const pageLimit = Math.max(count, 1)
  for (let pages = 1; pages <= pageLimit; pages += 1) {
    const layout = largestLayout(
      rows,
      orientation,
      columns,
      evenSpans(count, pages),
      [1, 2],
    )
    if (layout) return layout
  }

  const onePerPage = evenSpans(count, pageLimit)
  for (let nameLines = 3; nameLines <= 8; nameLines += 1) {
    const layout = tryLayout(
      rows,
      orientation,
      columns,
      MIN_FONT_PT,
      nameLines,
      onePerPage,
    )
    if (layout) return layout
  }

  const spec = PAGE_SPEC[orientation]
  const width = spec.contentWidthMm / Math.max(columns.length, 1)
  const percents = toPercents(
    columns.map(() => width),
    Math.max(
      columns.findIndex((column) => column.key === 'name'),
      0,
    ),
  )
  return {
    orientation,
    pageSize: spec.pageSize,
    pageMargin: spec.pageMargin,
    fontPt: MIN_FONT_PT,
    headerFontPt: roundPt(MIN_FONT_PT * HEADER_FONT_RATIO),
    nameLines: 2,
    tableHeightMm: roundMm(spec.contentHeightMm - CHROME_MM - PAGE_SLACK_MM),
    headerHeightMm: headerHeightMm(MIN_FONT_PT),
    photoMm: PHOTO_MIN_MM,
    padXMm: PAD_X_MM,
    contentWidthMm: spec.contentWidthMm,
    columns: columns.map((column, index) => ({
      key: column.key,
      widthMm: roundMm(width),
      widthPercent: percents[index] ?? 0,
    })),
    pages: onePerPage.map((span) => ({
      start: span.start,
      end: span.end,
      rowHeightsMm: Array.from({ length: span.end - span.start }, () => 8),
    })),
  }
}

/**
 * 글자는 0.5pt 단위다. 가로가 1.5pt 이상 클 때만 가로를 고르고,
 * 차이가 그보다 작으면 행이 더 높은 세로를 유지한다.
 */
export function resolveCargoLineListPrintOrientation(
  portrait: CargoLineListPrintLayout,
  landscape: CargoLineListPrintLayout,
): CargoLineListPrintOrientation {
  if (landscape.fontPt >= portrait.fontPt + ORIENTATION_GAIN_PT) return 'landscape'
  return 'portrait'
}
