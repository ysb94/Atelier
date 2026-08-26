/**
 * 창고 연습 운영 우선순위·가져오기·이동 검증.
 * 실행: npm run verify:warehouse-stock
 */
import { normalizeStyleNo } from '@/lib/import/transform'
import type { StyleRef } from '@/lib/types'
import {
  assignWarehouseUsageRanks,
  compareWarehouseUsageOrder,
  parseWarehouseLocation,
  parseWarehouseReceivedOn,
  parseWarehouseUploadRows,
  planWarehouseBoxMove,
  prepareWarehouseImportRows,
  summarizeWarehouseImport,
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

console.log('warehouse-stock verify: ok')
