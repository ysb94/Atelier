/**
 * 창고 연습 운영 우선순위·가져오기·이동 검증.
 * 실행: npm run verify:warehouse-stock
 */
import { normalizeStyleNo } from '@/lib/import/transform'
import type { StyleRef } from '@/lib/types'
import {
  assignWarehouseUsageRanks,
  compareWarehouseUsageOrder,
  formatWarehouseLocation,
  formatWarehouseReceivedOn,
  parseWarehouseLocation,
  parseWarehouseReceivedOn,
  parseWarehouseUploadRows,
  planWarehouseBoxMove,
  prepareWarehouseImportRows,
  summarizeWarehouseImport,
  summarizeWarehouseStockByStyle,
  toWarehouseImportRpcRows,
  warehouseInventoryTemplateSheets,
  warehousePositionQty,
} from './stock'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const loc = parseWarehouseLocation('  4-4-17// ')
assert(loc.locationCode === '4-4-17', '위치 끝 //는 코드에서 분리해야 한다')
assert(loc.isFinalLocation, '// 위치는 마지막 위치로 표시해야 한다')
assert(
  parseWarehouseLocation('2-8-3').isFinalLocation === false,
  '일반 위치는 마지막이 아니다',
)
assert(
  formatWarehouseLocation(loc) === '4-4-17//',
  '마지막 위치는 회사 표기 //로 보여준다',
)
assert(
  formatWarehouseLocation({ locationCode: '2-8-3', isFinalLocation: false }) ===
    '2-8-3',
  '일반 위치는 자리번호만 보여준다',
)

const forced = parseWarehouseReceivedOn('000000')
assert(forced.isForcedPriority, '000000은 강제 우선이다')
assert(forced.receivedOn === null, '000000은 입고일이 아니다')
assert(forced.dateValid, '000000은 검수 대상이 아니다')

const dated = parseWarehouseReceivedOn('250817')
assert(dated.receivedOn === '2025-08-17', 'YYMMDD를 입고일로 바꿔야 한다')
assert(dated.isForcedPriority === false, '일반 입고일은 우선이 아니다')

const iso = parseWarehouseReceivedOn('2026-01-03 00:00')
assert(iso.receivedOn === '2026-01-03', '엑셀 날짜 문자열도 받아야 한다')

const invalid = parseWarehouseReceivedOn('265028')
assert(invalid.dateValid === false, '잘못된 날짜는 검수 대상이다')
assert(invalid.receivedOn === null, '잘못된 날짜는 입고일을 비운다')

assert(
  formatWarehouseReceivedOn(forced) === '000000',
  '강제우선 행의 입고일은 엑셀 원본 000000을 그대로 보여준다',
)
assert(
  formatWarehouseReceivedOn({
    receivedOn: '2026-08-27',
    receivedOnRaw: '260827',
  }) === '26.08.27',
  '정상 입고일은 YY.MM.DD로 보여준다',
)
assert(
  formatWarehouseReceivedOn({ receivedOn: null, receivedOnRaw: '' }) === '—',
  '입고일 값이 없으면 —로 보여준다',
)

const styles: StyleRef[] = [
  { styleId: 's-m100', styleNo: 'M100', name: '검정 티셔츠' },
  { styleId: 's-m0487', styleNo: 'M0487', name: '슬림백 블랙' },
]
const parsed = parseWarehouseUploadRows([
  {
    name: '상품업로드',
    rows: [
      [
        'm번호',
        '제품명 [Connected]',
        '창고 관리 번호',
        '입고일',
        '박스당 갯수',
        '박스 수',
        '비고',
      ],
      ['m100', '검정 티셔츠', 'A-01', '000000', '20', '2', ''],
      ['M100', '검정 티셔츠', 'A-02', '250101', '20', '3', ''],
      ['M100', '검정 티셔츠', 'A-03//', '241201', '20', '1', ''],
      ['M0487', '슬림백 블랙', '2-8-3', '250817', '20', '4', ''],
      ['M0487', '슬림백 블랙', '4-3-15//', '250825', '20', '3', ''],
      ['M9999', '없는 상품', 'X', '999999', '10', '1', ''],
      ['M0487', '슬림백 블랙', '2-8-3', '250817', '20', '4', ''],
    ],
  },
])
assert(parsed.length === 7, '데이터 행을 모두 읽어야 한다')
assert(
  parsed[0]?.normalizedStyleNo === 'M100',
  'M번호는 대문자로 정규화해야 한다',
)
assert(parsed[0]?.normalizedStyleNo === normalizeStyleNo('m100'), '정규화 규칙을 공유한다')

const prepared = prepareWarehouseImportRows(parsed, styles)
const summary = summarizeWarehouseImport(prepared)
assert(summary.total === 7, '3,459행과 같은 방식으로 전체 건수를 센다')
assert(summary.missingStyle === 1, '미연결 상품을 검수한다')
assert(summary.dateReview === 1, '잘못된 날짜를 검수한다')
assert(summary.duplicateSuspect === 2, '완전 중복은 삭제하지 않고 표시한다')
assert(
  prepared.filter((row) => row.sourceRowNumber === 8).length === 1,
  '원본 행번호를 보존해야 한다',
)
assert(
  toWarehouseImportRpcRows(prepared, 'box_storage').every(
    (row) => row.zone === 'box_storage',
  ),
  '박스창고 업로드 행은 박스 존으로 보낸다',
)
assert(
  toWarehouseImportRpcRows(prepared, 'picking').every(
    (row) => row.zone === 'picking',
  ),
  '출고창고 업로드 행은 피킹 존으로 보낸다',
)

const emptyLocation = prepareWarehouseImportRows(
  parseWarehouseUploadRows([
    {
      name: '상품업로드',
      rows: [
        ['m번호', '제품명', '창고 관리 번호', '입고일', '박스당 갯수', '박스 수'],
        ['M100', '검정 티셔츠', '', '000000', '20', '1'],
      ],
    },
  ]),
  styles,
)
assert(
  emptyLocation[0]?.reviewFlags.includes('special_location'),
  '빈 자리는 특수 위치로 검수한다',
)

const nameFallbackStyles: StyleRef[] = [
  { styleId: 's-m1360', styleNo: 'M1360', name: '기어 업 다크그레이 M' },
  { styleId: 's-dup-1', styleNo: 'M2001', name: '중복 이름' },
  { styleId: 's-dup-2', styleNo: 'M2002', name: '중복 이름' },
]
const nameFallback = prepareWarehouseImportRows(
  parseWarehouseUploadRows([
    {
      name: '상품업로드',
      rows: [
        ['m번호', '제품명', '창고 관리 번호', '입고일', '박스당 갯수', '박스 수'],
        ['', '기어 업 다크그레이 M', '*1-112', '000000', '100', '1'],
        ['', '중복 이름', 'B-01', '000000', '10', '1'],
        ['M9999', '기어 업 다크그레이 M', 'C-01', '000000', '10', '1'],
        ['', '없는 이름', 'D-01', '000000', '10', '1'],
      ],
    },
  ]),
  nameFallbackStyles,
)
assert(nameFallback[0]?.styleId === 's-m1360', '빈 M번호는 공식명 단일 일치로 연결한다')
assert(nameFallback[0]?.normalizedStyleNo === 'M1360', '이름 연결 시 확정 M번호를 채운다')
assert(nameFallback[0]?.sourceStyleNo === '', '원본 빈 M번호는 그대로 둔다')
assert(
  nameFallback[0]?.reviewFlags.includes('missing_style') === false,
  '이름 단일 일치 행은 미연결이 아니다',
)
assert(nameFallback[1]?.styleId === null, '같은 이름이 둘이면 추정하지 않는다')
assert(
  nameFallback[1]?.reviewFlags.includes('missing_style'),
  '중복 이름은 미연결로 남긴다',
)
assert(nameFallback[2]?.styleId === null, '잘못된 M번호는 이름으로 우회하지 않는다')
assert(
  nameFallback[2]?.sourceStyleNo === 'M9999',
  '잘못된 M번호의 원본 값은 유지한다',
)
assert(
  nameFallback[2]?.normalizedStyleNo === 'M9999',
  '잘못된 M번호는 이름 정규화로 바꾸지 않는다',
)
assert(nameFallback[3]?.styleId === null, '일치 없는 이름은 미연결이다')

const ranked = assignWarehouseUsageRanks(
  prepared.map((row, index) => ({
    id: String(index),
    styleNo: row.normalizedStyleNo,
    isFinalLocation: row.isFinalLocation,
    isForcedPriority: row.isForcedPriority,
    receivedOn: row.receivedOn,
    sourceRowNumber: row.sourceRowNumber,
    remainingBoxes: row.remainingBoxes,
    openedUnits: 0,
  })),
)
const m100 = ranked
  .filter((row) => row.styleNo === 'M100')
  .sort((left, right) => (left.usageRank ?? 99) - (right.usageRank ?? 99))
assert(m100[0]?.isForcedPriority, '000000 일반 위치가 먼저다')
assert(
  m100[1]?.receivedOn === '2025-01-01',
  '다음으로 일반 위치 입고일 오름차순이다',
)
assert(m100[2]?.isFinalLocation, '// 위치는 항상 마지막이다')

assert(
  compareWarehouseUsageOrder(
    {
      isFinalLocation: true,
      isForcedPriority: false,
      receivedOn: '2024-01-01',
      sourceRowNumber: 1,
    },
    {
      isFinalLocation: false,
      isForcedPriority: false,
      receivedOn: '2026-08-01',
      sourceRowNumber: 2,
    },
  ) > 0,
  '오래된 // 위치도 일반 위치보다 뒤다',
)

const split = planWarehouseBoxMove({ remainingBoxes: 5, moveBoxes: 2 })
assert(split.splitsRow, '일부 박스 이동은 행을 나눈다')
assert(split.sourceRemaining === 3, '출발 자리 잔여를 유지한다')
assert(split.movedBoxes === 2, '옮긴 박스 수를 기록한다')

let blocked = false
try {
  planWarehouseBoxMove({ remainingBoxes: 1, moveBoxes: 2 })
} catch {
  blocked = true
}
assert(blocked, '남은 박스보다 많이 옮기면 막는다')

assert(
  warehousePositionQty({
    remainingBoxes: 2,
    unitsPerBox: 20,
    openedUnits: 3,
  }) === 43,
  '총수량은 박스 잔여와 개봉 낱개를 합친다',
)

const templateParsed = parseWarehouseUploadRows(
  warehouseInventoryTemplateSheets(),
)
assert(templateParsed.length === 3, '양식 예시 3행을 읽어야 한다')
assert(templateParsed[0]?.isForcedPriority, '양식 첫 예시는 강제우선')
assert(
  templateParsed[1]?.receivedOn === '2025-01-01',
  '양식 둘째 예시는 YYMMDD 입고일',
)
assert(templateParsed[2]?.isFinalLocation, '양식 셋째 예시는 마지막 위치')

const stockByStyle = summarizeWarehouseStockByStyle([
  {
    styleNo: 'm100',
    locationCode: 'A-01',
    isFinalLocation: false,
    isForcedPriority: true,
    receivedOn: null,
    sourceRowNumber: 1,
    remainingBoxes: 2,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M100',
    locationCode: 'A-02',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2025-01-01',
    sourceRowNumber: 2,
    remainingBoxes: 3,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M100',
    locationCode: 'A-03',
    isFinalLocation: true,
    isForcedPriority: false,
    receivedOn: '2024-12-01',
    sourceRowNumber: 3,
    remainingBoxes: 1,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M200',
    locationCode: 'B-01',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2024-01-01',
    sourceRowNumber: 4,
    remainingBoxes: 0,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M300',
    locationCode: '2-8-3',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2025-08-17',
    sourceRowNumber: 5,
    remainingBoxes: 4,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M300',
    locationCode: '2-8-3',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2025-08-17',
    sourceRowNumber: 6,
    remainingBoxes: 4,
    openedUnits: 0,
    unitsPerBox: 20,
    zone: 'box_storage',
  },
  {
    styleNo: 'M300',
    locationCode: '4-3-15',
    isFinalLocation: true,
    isForcedPriority: false,
    receivedOn: '2025-08-25',
    sourceRowNumber: 7,
    remainingBoxes: 0,
    openedUnits: 3,
    unitsPerBox: 20,
    zone: 'picking',
  },
  {
    styleNo: 'M400',
    locationCode: '4-3-9',
    isFinalLocation: true,
    isForcedPriority: false,
    receivedOn: '2023-01-01',
    sourceRowNumber: 8,
    remainingBoxes: 1,
    openedUnits: 0,
    unitsPerBox: 10,
    zone: 'box_storage',
  },
  {
    styleNo: 'M400',
    locationCode: '1-1-1',
    isFinalLocation: false,
    isForcedPriority: false,
    receivedOn: '2026-08-01',
    sourceRowNumber: 9,
    remainingBoxes: 1,
    openedUnits: 0,
    unitsPerBox: 10,
    zone: 'picking',
  },
])
const m100Stock = stockByStyle.get('M100')
assert(m100Stock?.boxLocation === 'A-01', '강제우선 자리가 박스창고 칸이다')
assert(m100Stock?.pickingLocation === null, '출고지 재고가 없으면 자리를 비운다')
assert(m100Stock?.boxQty === 120, '박스 자리 수량을 모두 합친다')
assert(m100Stock?.pickingQty === 0, '출고지 행이 없으면 0이다')
assert(m100Stock?.totalQty === 120, '총재고는 존 합계다')
const m200Stock = stockByStyle.get('M200')
assert(m200Stock?.boxLocation === null, '0재고 상품은 박스 자리를 비운다')
assert(m200Stock?.pickingLocation === null, '0재고 상품은 출고지 자리를 비운다')
assert(m200Stock?.totalQty === 0, '0재고 상품의 합은 0이다')
const m300Stock = stockByStyle.get('M300')
assert(m300Stock?.boxLocation === '2-8-3', '박스창고 출고 순서 1번을 고른다')
assert(
  m300Stock?.pickingLocation === '4-3-15//',
  '출고지 개봉 낱개가 있으면 픽업 자리를 표시한다',
)
assert(m300Stock?.boxQty === 160, '중복 박스 행을 각각 합친다')
assert(m300Stock?.pickingQty === 3, '출고지 개봉 낱개를 따로 센다')
assert(m300Stock?.totalQty === 163, '총재고는 박스+출고지다')
const m400Stock = stockByStyle.get('M400')
assert(m400Stock?.boxLocation === '4-3-9//', '박스창고 마지막 위치를 //로 표시한다')
assert(
  m400Stock?.pickingLocation === '1-1-1',
  '출고지 자리는 박스창고와 따로 고른다',
)
assert(m400Stock?.boxQty === 10, '박스재고만 박스 존을 센다')
assert(m400Stock?.pickingQty === 10, '출고지재고만 피킹 존을 센다')
assert(m400Stock?.totalQty === 20, '혼합 존 총재고를 맞춘다')
assert(
  stockByStyle.has('M999') === false,
  '자리 없는 상품은 집계 맵에 넣지 않는다',
)

console.log('warehouse-stock verify: ok')
