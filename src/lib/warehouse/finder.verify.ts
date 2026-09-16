/**
 * 창고 파인더 필드 대응·검색·이중 조회·동기화 분리 검증.
 * 실행: npm run verify:warehouse-finder
 */
import { normalizeStyleNo } from '@/lib/import/transform'
import {
  buildWarehouseFinderStyleNoCandidates,
  compareWarehouseFinderParity,
  decideWarehouseFinderSwitch,
  expandWarehouseFinderShortcut,
  finalizeWarehouseFinderResults,
  mapFirestoreSearchDocToParity,
  mapSheetWarehouseRowToParity,
  mapSupabasePositionToParity,
  normalizeWarehouseFinderQuery,
  pushWarehouseFinderHistory,
  removeWarehouseFinderHistory,
  warehouseFinderHistoryForMode,
  shouldSyncAtelierWarehouseSnapshot,
  toWarehouseFinderCard,
  uniqueWarehouseFinderProductNames,
  warehouseFinderComputedQty,
  warehouseFinderProductKindKey,
  warehouseLocationBase,
  type WarehouseFinderCard,
} from './finder'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(warehouseLocationBase('4-4-17//') === '4-4-17', '//는 자리 base에서 뺀다')
assert(expandWarehouseFinderShortcut('211') === '2-1-1', '211은 2-1-1')
assert(expandWarehouseFinderShortcut('4012') === '4-0-12', '4012는 4-0-12')
assert(expandWarehouseFinderShortcut('$12') === '$-1-2', '$12는 $-1-2')
assert(
  expandWarehouseFinderShortcut('2-1-1//') === '2-1-1',
  '이미 자리 표기면 //만 뺀다',
)

const mnumber = normalizeWarehouseFinderQuery('mnumber', '0885')
assert(mnumber.normalized === '0885' || mnumber.normalized === 'M0885', 'M번호 정규화')
assert(
  buildWarehouseFinderStyleNoCandidates('0885').includes('M0885'),
  '숫자만 있으면 M을 붙인 후보도 만든다',
)
assert(
  buildWarehouseFinderStyleNoCandidates('m 0885').includes('M0885'),
  '공백·소문자는 style_no 규칙으로 접는다',
)
assert(
  normalizeStyleNo('m 0885') === 'M0885',
  'M번호 검색은 styles.style_no와 같은 정규화를 쓴다',
)

const warehouseQuery = normalizeWarehouseFinderQuery('warehouse', '211')
assert(warehouseQuery.normalized === '2-1-1', '자리 검색은 단축 입력을 먼저 푼다')
assert(warehouseQuery.limit === 200, '자리 검색 상한은 200')

const productQuery = normalizeWarehouseFinderQuery('product', '하트 백')
assert(productQuery.normalized === '하트 백', '상품명 검색은 prefix 원문')
assert(productQuery.limit === 100, '상품명 검색 상한은 100')

assert(
  warehouseFinderComputedQty({
    quantityStatus: 'unknown',
    unitsPerBox: null,
    remainingBoxes: null,
  }) === null,
  '수량 미확인은 계산 수량을 만들지 않는다',
)
assert(
  warehouseFinderComputedQty({
    quantityStatus: 'known',
    unitsPerBox: 20,
    remainingBoxes: 3,
    openedUnits: 2,
  }) === 62,
  '확인된 수량만 입수×박스+낱개로 계산한다',
)

const sheetParity = mapSheetWarehouseRowToParity({
  externalRowId: 'aa-1',
  sourceStyleNo: 'M0885',
  sourceProductName: '하트 백',
  locationRaw: '4-4-17//',
  receivedOnRaw: '000000',
  unitsPerBoxRaw: '',
  remainingBoxesRaw: '2',
  note: '우선',
})
const firestoreParity = mapFirestoreSearchDocToParity({
  _id: 'aa-1',
  chinaCode: 'M0885',
  productName: '하트 백',
  libraryNumber: '4-4-17//',
  arrivalDate: '000000',
  unitsPerBox: '',
  boxCount: '2',
  note: '우선',
})
const supabaseParity = mapSupabasePositionToParity({
  externalRowId: 'aa-1',
  sourceStyleNo: 'M0885',
  sourceProductName: '하트 백',
  locationCode: '4-4-17',
  isFinalLocation: true,
  receivedOnRaw: '000000',
  unitsPerBoxRaw: '',
  remainingBoxesRaw: '2',
  note: '우선',
})
assert(
  compareWarehouseFinderParity([sheetParity], [firestoreParity]).ok,
  '시트와 Firebase 검색 문서는 AA 기준으로 같아야 한다',
)
assert(
  compareWarehouseFinderParity([firestoreParity], [supabaseParity]).ok,
  'Firebase와 Supabase 스냅샷도 AA 기준으로 같아야 한다',
)

const mismatch = compareWarehouseFinderParity(
  [firestoreParity],
  [
    mapSupabasePositionToParity({
      ...supabaseParity,
      externalRowId: 'aa-1',
      sourceStyleNo: 'M0885',
      sourceProductName: '하트 백',
      locationCode: '4-4-18',
      isFinalLocation: true,
      receivedOnRaw: '000000',
      unitsPerBoxRaw: '',
      remainingBoxesRaw: '2',
      note: '우선',
    }),
  ],
)
assert(mismatch.ok === false, '자리 불일치는 전환을 막는다')
assert(
  decideWarehouseFinderSwitch(mismatch).reasons.some((reason) =>
    reason.includes('필드 불일치'),
  ),
  '전환 결정은 필드 불일치를 이유로 남긴다',
)

const missing = compareWarehouseFinderParity(
  [firestoreParity],
  [mapSupabasePositionToParity({ ...supabaseParity, externalRowId: 'aa-2' })],
)
assert(missing.missingInRight.includes('aa-1'), 'Supabase에 없는 AA를 찾는다')
assert(missing.missingInLeft.includes('aa-2'), 'Firebase에 없는 AA를 찾는다')
assert(decideWarehouseFinderSwitch(missing).ready === false, '행 키 불일치는 전환 불가')

function card(partial: Partial<WarehouseFinderCard> & Pick<WarehouseFinderCard, 'positionId'>): WarehouseFinderCard {
  return toWarehouseFinderCard({
    positionId: partial.positionId,
    setId: partial.setId ?? 'set-1',
    externalRowId: partial.externalRowId ?? partial.positionId,
    productName: partial.productName ?? '하트 백',
    officialStyleName: partial.officialStyleName ?? '하트 백',
    styleId: partial.styleId ?? 'style-1',
    styleNo: partial.styleNo ?? 'M0885',
    sourceStyleNo: partial.sourceStyleNo ?? 'M0885',
    locationCode: partial.locationCode ?? '2-1-1',
    isFinalLocation: partial.isFinalLocation ?? false,
    zone: partial.zone ?? 'box_storage',
    receivedOn: partial.receivedOn ?? '2026-08-17',
    receivedOnRaw: partial.receivedOnRaw ?? '250817',
    usagePriority: partial.usagePriority ?? 'fifo',
    quantityStatus: partial.quantityStatus ?? 'known',
    unitsPerBox: partial.unitsPerBox ?? 20,
    remainingBoxes: partial.remainingBoxes ?? 1,
    openedUnits: partial.openedUnits ?? 0,
    reviewFlags: partial.reviewFlags ?? [],
    note: partial.note ?? '',
    inboundCount: partial.inboundCount ?? 1,
  })
}

const exactPreferred = finalizeWarehouseFinderResults(productQuery, [
  card({ positionId: '1', productName: '하트 백 미니', receivedOn: '2026-08-01' }),
  card({ positionId: '2', productName: '하트 백', receivedOn: '2026-08-02' }),
])
assert(exactPreferred.length === 1, '상품명 exact가 있으면 prefix만 남기지 않는다')
assert(exactPreferred[0]?.productName === '하트 백', '상품명 exact를 우선한다')

const productSuggestions = uniqueWarehouseFinderProductNames([
  card({ positionId: 'suggestion-1', productName: '셔링 아이보리' }),
  card({ positionId: 'suggestion-2', productName: ' 셔링 아이보리 ' }),
  card({ positionId: 'suggestion-3', productName: '셔링 블랙' }),
])
assert(
  warehouseFinderProductKindKey({
    styleNo: 'M0001',
    sourceStyleNo: 'M0001',
    productName: '셔링 아이보리',
  }) ===
    warehouseFinderProductKindKey({
      styleNo: 'M0001',
      sourceStyleNo: 'M0001',
      productName: '셔링 아이보리',
    }),
  '같은 M번호는 자리 종류를 하나로 본다',
)
assert(
  warehouseFinderProductKindKey({
    styleNo: '',
    sourceStyleNo: '',
    productName: ' 셔링 아이보리 ',
  }) ===
    warehouseFinderProductKindKey({
      styleNo: '',
      sourceStyleNo: '',
      productName: '셔링 아이보리',
    }),
  'M번호가 없으면 상품명으로 자리 종류를 접는다',
)
assert(
  warehouseFinderProductKindKey({ styleNo: 'M0001', productName: '셔링 아이보리' }) !==
    warehouseFinderProductKindKey({ styleNo: 'M0002', productName: '셔링 핑크' }),
  '다른 M번호는 다른 종류다',
)

assert(productSuggestions.length === 2, '연관 검색어 상품명은 중복 제거한다')
assert(
  productSuggestions[0] === '셔링 아이보리' &&
    productSuggestions[1] === '셔링 블랙',
  '연관 검색어는 재고 조회 순서와 첫 표기를 유지한다',
)

const sorted = finalizeWarehouseFinderResults(
  normalizeWarehouseFinderQuery('warehouse', '2-1-1'),
  [
    card({
      positionId: 'last',
      locationCode: '2-1-1',
      isFinalLocation: true,
      receivedOn: '2026-08-17',
      receivedOnRaw: '250817',
      usagePriority: 'fifo',
    }),
    card({
      positionId: 'first',
      locationCode: '2-1-1',
      isFinalLocation: false,
      receivedOn: null,
      receivedOnRaw: '000000',
      usagePriority: 'first',
    }),
    card({
      positionId: 'fifo',
      locationCode: '2-1-1',
      isFinalLocation: false,
      receivedOn: '2026-08-17',
      receivedOnRaw: '250817',
      usagePriority: 'fifo',
    }),
  ],
)
assert(sorted[0]?.positionId === 'first', '000000이 자리 결과 맨 앞')
assert(sorted[sorted.length - 1]?.positionId === 'last', '// 마지막 위치는 맨 뒤')

assert(
  shouldSyncAtelierWarehouseSnapshot({
    finishedAll: true,
    firebaseFailures: 2,
    independent: false,
  }) === false,
  '기본은 Firebase가 끝나야 사이트 DB를 갱신한다',
)
assert(
  shouldSyncAtelierWarehouseSnapshot({
    finishedAll: true,
    firebaseFailures: 2,
    independent: true,
  }) === true,
  '안정화 후 단독 동기화는 Firebase 실패와 무관하다',
)
assert(
  shouldSyncAtelierWarehouseSnapshot({
    finishedAll: false,
    firebaseFailures: 0,
    independent: true,
  }) === false,
  '시트 전 행을 읽기 전에는 사이트 스냅샷을 갈아끼우지 않는다',
)

const history = pushWarehouseFinderHistory(
  [{ mode: 'product', query: '하트 백' }],
  { mode: 'product', query: '하트 백' },
)
assert(history.length === 1, '같은 검색은 맨 위로만 올린다')
assert(
  pushWarehouseFinderHistory(history, { mode: 'mnumber', query: 'M0885' })[0]
    ?.query === 'M0885',
  '새 검색이 최근 기록 맨 앞',
)
const mixedHistory = pushWarehouseFinderHistory(history, {
  mode: 'mnumber',
  query: 'M0885',
})
assert(
  warehouseFinderHistoryForMode(mixedHistory, 'product').every(
    (item) => item.mode === 'product',
  ),
  '최근 검색은 현재 모드만 보여 준다',
)
assert(
  removeWarehouseFinderHistory(mixedHistory, {
    mode: 'product',
    query: '하트 백',
  }).every((item) => item.query !== '하트 백'),
  '최근 검색은 항목만 지운다',
)

console.log('warehouse-finder.verify ok')
