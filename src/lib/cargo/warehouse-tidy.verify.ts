/**
 * 창고정리용 선적일·목록 칸 검증.
 * 실행: npx tsx --tsconfig tsconfig.app.json src/lib/cargo/warehouse-tidy.verify.ts
 */
import {
  formatCargoLineListCells,
  storedRowToCargoLineListValues,
  type CargoLineListCells,
  type CargoLineListValues,
} from './line-list'
import { resolveWarehouseTidyShippedOn } from './warehouse-tidy'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 13,
    partIndex: 0,
    partCount: 1,
  }) === '260910',
  '합 13 단독 행은 선적일 그대로',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '260909',
  '합 16 단독 행은 하루 앞',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 14,
    partIndex: 2,
    partCount: 3,
  }) === '260911',
  '갈라진 마지막 행은 하루 뒤',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 16,
    partIndex: 1,
    partCount: 2,
  }) === '260911',
  '합 16이면서 마지막 행이면 하루 뒤가 우선',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-10',
    boxSum: 15,
    partIndex: 0,
    partCount: 1,
  }) === '260910',
  '최신자리 NEW인 단독 행은 선적일 그대로',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-09-01',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '260831',
  '하루 앞이 월을 넘긴다',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '2026-12-31',
    boxSum: 14,
    partIndex: 1,
    partCount: 2,
  }) === '270101',
  '하루 뒤가 연을 넘긴다',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '',
  '빈 선적일은 빈 문자열',
)

assert(
  resolveWarehouseTidyShippedOn({
    shippedAt: '미정',
    boxSum: 16,
    partIndex: 0,
    partCount: 1,
  }) === '',
  '형식이 아니면 빈 문자열',
)

const sampleValues: CargoLineListValues = {
  lineId: 'line-1',
  partIndex: 1,
  no: '1',
  name: '플랩백팩 글리터리 [실버]',
  styleNo: 'M0054',
  quantity: 1200,
  unitsPerBox: 40,
  boxCount: 1000,
  stow: 'A1',
  note: '등록 비고\n요청 사항',
  shippedAt: '260922',
  latestSlot: '#-5-13',
  latestBoxCount: 13,
  warehouseSlot: 'A-3',
}

const sampleCells = formatCargoLineListCells(sampleValues)
const restoredCells = formatCargoLineListCells(
  storedRowToCargoLineListValues({
    lineId: sampleValues.lineId,
    partIndex: sampleValues.partIndex,
    no: sampleValues.no,
    name: sampleValues.name,
    styleNo: sampleValues.styleNo,
    quantity: sampleValues.quantity,
    unitsPerBox: sampleValues.unitsPerBox,
    boxCount: sampleValues.boxCount,
    stow: sampleValues.stow,
    note: sampleValues.note,
    shippedAt: sampleValues.shippedAt,
    latestSlot: sampleValues.latestSlot,
    latestBoxCount: sampleValues.latestBoxCount,
    warehouseSlot: sampleValues.warehouseSlot,
  }),
)

assert(
  sameCells(sampleCells, restoredCells),
  '저장 행을 다시 칸으로 바꿔도 같은 목록이 된다',
)
assert(sampleCells.qty === '1200', '총수량은 콤마 없이 그대로')
assert(sampleCells.perBox === '40', '박스당은 콤마 없이 그대로')
assert(sampleCells.boxes === '1,000', '박스수는 천 단위로 끊는다')
assert(sampleCells.latestBoxes === '13', '최신박스수를 표시한다')
assert(sampleCells.slot === 'A-3', '창고자리를 표시한다')
assert(sampleCells.note === '등록 비고\n요청 사항', '비고의 줄바꿈을 유지한다')

const emptyCells = formatCargoLineListCells({
  ...sampleValues,
  quantity: null,
  unitsPerBox: null,
  boxCount: null,
  latestBoxCount: 0,
  warehouseSlot: '  ',
})
assert(emptyCells.qty === '', '총수량이 없으면 빈칸')
assert(emptyCells.boxes === '', '박스수가 없으면 빈칸')
assert(emptyCells.latestBoxes === '', '최신박스수 0은 빈칸')
assert(emptyCells.slot === '', '창고자리 공백은 빈칸')

function sameCells(left: CargoLineListCells, right: CargoLineListCells) {
  const keys = Object.keys(left) as Array<keyof CargoLineListCells>
  return keys.every((key) => left[key] === right[key])
}

console.log('warehouse-tidy.verify ok')
