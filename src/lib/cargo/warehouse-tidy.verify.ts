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
import { refreshWarehouseTidyRequestNotes, resolveWarehouseTidyShippedOn } from './warehouse-tidy'
import { buildWarehouseTidyPreviewRows } from './warehouse-tidy-preview'

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

const requestRows = [
  { ...sampleValues, id: 'saved-1', rowNo: 1, note: '등록 비고\n이전 요청' },
  { ...sampleValues, id: 'saved-2', rowNo: 2, partIndex: 2, stow: 'B1', note: '등록 비고\n이전 요청' },
  { ...sampleValues, id: 'saved-3', rowNo: 3, lineId: 'other-line', note: '다른 등록 비고\n다른 요청' },
  { ...sampleValues, id: 'saved-4', rowNo: 4, lineId: null, note: '연결 없는 비고' },
]
const currentNotes = [
  { id: 'line-1', note: '등록 비고', requestNote: '새 요청\n둘째 줄' },
  { id: 'other-line', note: '다른 등록 비고', requestNote: '다른 요청' },
  { id: 'new-line', note: '', requestNote: '새 행은 목록에 추가하지 않음' },
]
const refreshedNotes = refreshWarehouseTidyRequestNotes(requestRows, currentNotes)
assert(refreshedNotes.length === requestRows.length, '새 원본 행이 있어도 저장 목록 행 수를 유지한다')
for (let index = 0; index < requestRows.length; index += 1) {
  const { note: beforeNote, ...before } = requestRows[index]!
  const { note: afterNote, ...after } = refreshedNotes[index]!
  assert(JSON.stringify(before) === JSON.stringify(after), '비고 외 ID·순서·분할·모든 열을 유지한다')
  assert(index < 2 ? afterNote === '등록 비고\n새 요청\n둘째 줄' : afterNote === beforeNote, '같은 원본의 분할 행만 요청 사항을 반영한다')
}
assert(refreshedNotes[2] === requestRows[2], '같은 M번호의 다른 원본 행은 그대로 유지한다')
assert(refreshedNotes[3] === requestRows[3], '연결이 없는 행은 그대로 유지한다')
const repeatNotes = refreshWarehouseTidyRequestNotes(refreshedNotes, currentNotes)
assert(repeatNotes.every((row, index) => row === refreshedNotes[index]), '반복 불러오기는 중복 추가나 재변경을 하지 않는다')
const clearedNotes = refreshWarehouseTidyRequestNotes(refreshedNotes, [
  { id: 'line-1', note: '등록 비고', requestNote: '' },
])
assert(clearedNotes[0]?.note === '등록 비고' && clearedNotes[1]?.note === '등록 비고', '요청 삭제는 등록 비고를 유지하며 분할 행에도 반영한다')

const previewLines = [20, 35, 16, 8, 4].map((boxes, index) => ({
  id: `preview-${index}`, no: String(index + 1), name: '같은 품명', photo: '',
  styleNo: `M000${index + 1}`, qty: String(boxes * 8), perBox: '8', boxes: String(boxes),
  note: '원본 비고', requestNote: '요청',
}))
const previewStock = [
  { styleNo: 'm0001', remainingBoxes: 0, openedUnits: 0, quantityStatus: 'known' as const },
  { styleNo: 'M0001', remainingBoxes: 8, openedUnits: 0, quantityStatus: 'known' as const },
  { styleNo: 'M0002', remainingBoxes: 0, openedUnits: 0, quantityStatus: 'known' as const },
  { styleNo: 'M0004', remainingBoxes: 0, openedUnits: 3, quantityStatus: 'known' as const },
  { styleNo: 'M0005', remainingBoxes: null, openedUnits: 0, quantityStatus: 'unknown' as const },
]
const previewBefore = JSON.stringify({ previewLines, previewStock })
const previewRows = buildWarehouseTidyPreviewRows(previewLines, previewStock, '2026-11-12', true)
const previewFor = (sku: string) => previewRows.filter(row => row.values.styleNo === sku).map(row => row.values)
assert(JSON.stringify(previewFor('M0001').map(row => row.boxCount)) === '[16,4]', '다른 자리에 기존 8박스가 있어도 이번 입고 20박스만 16+4로 나눈다')
assert(previewFor('M0001').every(row => row.latestSlot === '기존'), '0 재고 자리 외에 남은 재고가 있는 SKU는 모든 분할 행에 기존 표시')
assert(JSON.stringify(previewFor('M0002').map(row => row.boxCount)) === '[16,16,3]', '35박스는 원본 옆에 16+16+3으로 붙인다')
assert(previewFor('M0002').every(row => row.latestSlot === 'NEW'), '모든 기존 재고가 0이면 모든 분할 행에 NEW 표시')
assert(previewFor('M0003')[0]?.latestSlot === 'NEW' && previewFor('M0003').length === 1, '재고에 없는 다른 SKU는 NEW이고 정확히 16박스면 한 행이다')
assert(previewFor('M0004')[0]?.latestSlot === '기존', '박스 없이 낱개만 남아 있어도 기존 재고다')
assert(previewFor('M0005')[0]?.latestSlot === '확인 필요', '수량 미확인 재고를 0으로 간주하지 않는다')
assert(previewRows.every(row => row.values.shippedAt === '261112'), '미리보기는 분할 여부와 관계없이 원본 선적일을 표시한다')
assert(previewRows.every(row => row.values.latestBoxCount === null && row.values.warehouseSlot === ''), '기존 재고 합산이나 창고자리 자동 배정을 하지 않는다')
assert(JSON.stringify({ previewLines, previewStock }) === previewBefore, '미리보기 계산이 입고·재고 원본을 바꾸지 않는다')
assert(buildWarehouseTidyPreviewRows(previewLines, [], '2026-11-12', false).every(row => row.values.latestSlot === '확인 필요'), '재고 조회 실패 시 NEW로 오인하지 않는다')
assert(buildWarehouseTidyPreviewRows([{ ...previewLines[0], styleNo: '' }], [], '2026-11-12', true)[0]?.values.latestSlot === '확인 필요', 'M번호가 없으면 품명만으로 신규 여부를 추측하지 않는다')

console.log('warehouse-tidy.verify ok: legacy records and incoming-only preview')
