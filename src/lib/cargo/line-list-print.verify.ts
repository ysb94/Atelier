/**
 * 하차용·창고정리용 인쇄가 A4 한 장을 글자 잘림 없이 채우는지 검증.
 * 실행: npx tsx --tsconfig tsconfig.app.json src/lib/cargo/line-list-print.verify.ts
 */
import { CARGO_LINE_LIST_COLUMNS } from '../../features/logistics/cargo-line-list-columns'
import type { CargoLineListCells } from './line-list'
import {
  buildCargoLineListPrintLayout,
  formatCargoLineListPrintFontPt,
  formatCargoLineListPrintOptionLabel,
  measureCargoPrintTextMm,
  resolveCargoLineListPrintOrientation,
  type CargoLineListPrintLayout,
} from './line-list-print'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const LONG_NAME = '리리 미니 토트백 [코듀 도트블랙네이비]'
const LONG_NOTE = '2박스 전체 (SD-29번 1박스, SD-30번에 두가지 섞여있음)'

function makeRows(count: number, longNote = false): CargoLineListCells[] {
  return Array.from({ length: count }, (_, index) => ({
    no: String(index + 1),
    name: index === 0 ? LONG_NAME : '미니 리본포켓백팩 [블랙]',
    styleNo: 'M2342',
    qty: index === 1 ? '1280' : '120',
    perBox: '40',
    boxes: index === 1 ? '32' : '6',
    stow: index % 4 === 0 ? '1B2' : 'C1',
    slot: '',
    note: longNote && index === 2 ? LONG_NOTE : '',
    shippedAt: '260922',
    latestSlot: index % 3 === 0 ? 'SD-30' : 'NEW',
    latestBoxes: index % 3 === 0 ? '16' : '',
  }))
}

function minRowHeight(layout: CargoLineListPrintLayout) {
  const heights = layout.pages.flatMap((page) => page.rowHeightsMm)
  assert(heights.length > 0, '행 높이가 있다')
  return Math.min(...heights)
}

function assertPercents(layout: CargoLineListPrintLayout) {
  const sum = layout.columns.reduce((total, column) => total + column.widthPercent, 0)
  assert(Math.abs(sum - 100) < 0.001, `열 너비 합이 100이 아니다 (${sum})`)
  const millimeters = layout.columns.reduce((total, column) => total + column.widthMm, 0)
  assert(
    Math.abs(millimeters - layout.contentWidthMm) < 0.2,
    `열 너비 합이 본문 폭과 다르다 (${millimeters} / ${layout.contentWidthMm})`,
  )
}

function assertTextFits(layout: CargoLineListPrintLayout, rows: CargoLineListCells[]) {
  for (const column of CARGO_LINE_LIST_COLUMNS) {
    const sized = layout.columns.find((item) => item.key === column.key)
    assert(sized, `${column.key} 열 너비가 없다`)
    const inner = sized.widthMm - layout.padXMm
    if (column.key === 'photo') continue
    if (column.key === 'name') {
      const width = measureCargoPrintTextMm(LONG_NAME, layout.fontPt)
      assert(
        width <= inner * layout.nameLines + 0.05,
        `22자 품명이 ${layout.nameLines}줄에 안 들어간다 (${width.toFixed(1)}mm, 칸 ${inner.toFixed(1)}mm)`,
      )
      continue
    }
    if (column.key === 'note') continue
    for (const row of rows) {
      const width = measureCargoPrintTextMm(row[column.key], layout.fontPt)
      assert(
        width <= inner + 0.05,
        `${column.printLabel} 값이 잘린다 (${row[column.key]}, ${width.toFixed(1)} > ${inner.toFixed(1)})`,
      )
    }
    const headerLines = column.printLabel.includes(' ')
      ? column.printLabel.split(/\s+/)
      : [column.printLabel]
    for (const line of headerLines) {
      const width = measureCargoPrintTextMm(line, layout.headerFontPt)
      assert(
        width <= inner + 0.05,
        `${column.printLabel} 머리글이 잘린다 (${width.toFixed(1)} > ${inner.toFixed(1)})`,
      )
    }
  }
}

function assertOnePageFilled(layout: CargoLineListPrintLayout, rows: number) {
  assert(layout.pages.length === 1, `${rows}행이 ${layout.pages.length}장이다`)
  assert(layout.pages[0]?.start === 0 && layout.pages[0]?.end === rows, '한 장에 모든 행이 없다')
  assert(layout.fontPt > 7.1, `${rows}행 글자가 ${layout.fontPt}pt다`)
  assert(minRowHeight(layout) > 5.8, `${rows}행 높이가 ${minRowHeight(layout)}mm다`)
  assert(layout.tableHeightMm > 250, `세로 표 높이가 ${layout.tableHeightMm}mm다`)
  assert(layout.nameLines === 1 || layout.nameLines === 2, '품명 줄 수가 1 또는 2가 아니다')
}

assert([...LONG_NAME].length === 22, '표본 품명은 22자다')

const rows25 = makeRows(25)
const portrait25 = buildCargoLineListPrintLayout(rows25, 'portrait', CARGO_LINE_LIST_COLUMNS)
assertOnePageFilled(portrait25, 25)
assertPercents(portrait25)
assertTextFits(portrait25, rows25)

const rows32 = makeRows(32)
const portrait32 = buildCargoLineListPrintLayout(rows32, 'portrait', CARGO_LINE_LIST_COLUMNS)
const landscape32 = buildCargoLineListPrintLayout(rows32, 'landscape', CARGO_LINE_LIST_COLUMNS)
assertOnePageFilled(portrait32, 32)
assertPercents(portrait32)
assertPercents(landscape32)
assertTextFits(portrait32, rows32)
assertTextFits(landscape32, rows32)
assert(
  resolveCargoLineListPrintOrientation(portrait32, landscape32) === 'portrait',
  `32행 자동이 세로가 아니다 (세로 ${portrait32.fontPt}pt, 가로 ${landscape32.fontPt}pt)`,
)

const rows12 = makeRows(12)
const portrait12 = buildCargoLineListPrintLayout(rows12, 'portrait', CARGO_LINE_LIST_COLUMNS)
const landscape12 = buildCargoLineListPrintLayout(rows12, 'landscape', CARGO_LINE_LIST_COLUMNS)
assert(landscape12.pages.length === 1, '12행 가로가 한 장이 아니다')
assert(portrait12.pages.length === 1, '12행 세로가 한 장이 아니다')
assert(
  landscape12.fontPt > portrait12.fontPt,
  `12행 가로 글자가 더 크지 않다 (세로 ${portrait12.fontPt}pt, 가로 ${landscape12.fontPt}pt)`,
)
assert(
  resolveCargoLineListPrintOrientation(portrait12, landscape12) === 'landscape',
  `12행 자동이 가로가 아니다 (세로 ${portrait12.fontPt}pt, 가로 ${landscape12.fontPt}pt)`,
)
assertPercents(portrait12)
assertTextFits(portrait12, rows12)
assertTextFits(landscape12, rows12)

const rows90 = makeRows(90)
const portrait90 = buildCargoLineListPrintLayout(rows90, 'portrait', CARGO_LINE_LIST_COLUMNS)
assert(portrait90.pages.length === 2, `90행이 ${portrait90.pages.length}장이다`)
assert(portrait90.pages[0]?.end === 45, `첫 장이 ${portrait90.pages[0]?.end}행이다`)
assert(portrait90.pages[1]?.start === 45 && portrait90.pages[1]?.end === 90, '둘째 장이 45행이 아니다')
assert(portrait90.fontPt >= 7, `90행 글자가 ${portrait90.fontPt}pt다`)
assertPercents(portrait90)
assertTextFits(portrait90, rows90)
assert(
  formatCargoLineListPrintOptionLabel('세로', portrait90) ===
    `세로 · 글자 ${formatCargoLineListPrintFontPt(portrait90.fontPt)}pt · 2장`,
  '두 장 선택지 문구가 다르다',
)
assert(
  formatCargoLineListPrintOptionLabel('세로', portrait32) ===
    `세로 · 글자 ${formatCargoLineListPrintFontPt(portrait32.fontPt)}pt`,
  '한 장 선택지 문구가 다르다',
)

const rows32Noted = makeRows(32, true)
const portrait32Noted = buildCargoLineListPrintLayout(
  rows32Noted,
  'portrait',
  CARGO_LINE_LIST_COLUMNS,
)
assert(portrait32Noted.pages.length === 1, '긴 비고 32행이 한 장이 아니다')
assert(portrait32Noted.fontPt > 7.1, `긴 비고 글자가 ${portrait32Noted.fontPt}pt다`)
assertTextFits(portrait32Noted, rows32Noted)
const noteColumn = portrait32Noted.columns.find((column) => column.key === 'note')
assert(noteColumn, '비고 열이 없다')
const noteWidth = measureCargoPrintTextMm(LONG_NOTE, portrait32Noted.fontPt)
assert(
  noteWidth <= (noteColumn.widthMm - portrait32Noted.padXMm) * 3 + 0.05,
  `긴 비고가 3줄에 안 들어간다 (${noteWidth.toFixed(1)}mm, 칸 ${(noteColumn.widthMm - portrait32Noted.padXMm).toFixed(1)}mm)`,
)

console.log(
  `line-list-print.verify ok · 12행 세로 ${portrait12.fontPt}pt 가로 ${landscape12.fontPt}pt · 32행 세로 ${portrait32.fontPt}pt(${portrait32.nameLines}줄) 가로 ${landscape32.fontPt}pt(${landscape32.nameLines}줄) · 90행 ${portrait90.fontPt}pt`,
)
