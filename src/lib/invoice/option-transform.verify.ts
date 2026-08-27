/**
 * 품목·옵션 변환 검증. 실행: npm run verify:option-maps
 */
import {
  buildInvoiceOutputRows,
  buildInvoiceStepSnapshot,
} from '@/lib/invoice/invoice-output'
import {
  ACCESSORY_RESOLVE_CASES,
  ACCESSORY_STYLE_FIXTURES,
} from '@/lib/invoice/accessory-resolve.cases'
import {
  accessoryStyleNameIndex,
  resolveInvoiceAccessories,
} from '@/lib/invoice/accessory-resolve'
import { accessoryRulesFromSeeds, INVOICE_ACCESSORY_SEED_DRAFTS } from '@/lib/invoice/accessory-rule-seed'
import {
  accessoryReviewExpectedLines,
  decideAccessoryReviewSaves,
  flattenAccessoryPlanRows,
  isAccessoryReviewDirty,
  revalidateAccessoryReviewRow,
  type AccessoryFlattenSource,
} from '@/lib/invoice/accessory-review-table'
import {
  accessoryContextId,
  buildLookupKeyDraftsFromDecisions,
  collectUnknownAccessoryPieces,
  evaluateAccessorySuggestion,
  findExistingLookupRule,
  isUnsafeGlobalToken,
  type AccessoryContextPreview,
} from '@/lib/invoice/accessory-suggest'
import {
  buildOutgoingComponentRowsFromStages,
  formatItemNameFromComponents,
  transformInvoiceItemNames,
} from '@/lib/invoice/item-name-transform'
import { extrasOfItemNameAiRow } from '@/features/logistics/useInvoiceItemNameBulkAiApply'
import { buildInvoiceItemNameLookupKeyRows } from '@/features/logistics/InvoiceItemNameLookupKeyTable'
import {
  findOptionMapsForProductNameMap,
  formatProductCompositionLines,
  productCompositionFromOptionMap,
  productCompositionFromStyle,
  productCompositionVariantsForMap,
} from '@/lib/invoice/product-composition'
import {
  collectInvoiceItemNameRuleStyleNos,
  prepareInvoiceItemNameRuleRows,
} from '@/lib/invoice/item-name-rule-import'
import {
  appendItemNameAiComponent,
  buildItemNameAiReviewRows,
  collectItemNameAiGroups,
  decideItemNameAiSaves,
  dedupeItemNameAiContexts,
  isItemNameAiReviewDirty,
  itemNameAiCandidateTexts,
  applyItemNameAiQuickSlotStyle,
  applyItemNameAiQuickSlotText,
  applyItemNameAiRowAction,
  commitReadyItemNameAiDrafts,
  decideItemNameAiEnterAction,
  decideItemNameAiQuickSlotMatch,
  emptyItemNameAiQuickSlot,
  itemNameAiExpectedLines,
  itemNameAiGroupsForContexts,
  itemNameAiMatchesQueueFilter,
  itemNameAiQuickRowComponents,
  itemNameAiQuickSlotsFromComponents,
  itemNameAiQueueProgress,
  itemNameAiReviewKind,
  markItemNameAiDecisionNeeded,
  nextItemNameAiQuickFocus,
  replaceItemNameAiRowComponents,
  mergeItemNameAiComponents,
  mergeItemNameAiDrafts,
  mirrorItemNameAiDecisions,
  overlayItemNameAiDrafts,
  planItemNameAiBatches,
  reconcileItemNameAiReviewState,
  reopenItemNameAiCommittedRow,
  restoreItemNameAiDrafts,
  validateItemNameAiReviewRow,
  type ItemNameAiReviewRow,
} from '@/lib/invoice/item-name-ai-review'
import {
  formatItemNameRuleResult,
  formatItemNameRuleStyleNos,
  itemNameRuleEditSave,
  itemNameRuleSearchText,
  listLookupKeyItemNameRules,
} from '@/lib/invoice/item-name-rule-manage'
import {
  collectInvoiceOptionLedgerStyleCandidates,
  collectInvoiceProductNameLedgerStyleCandidates,
  prepareInvoiceOptionLedgerRows,
  prepareInvoiceProductNameLedgerRows,
} from '@/lib/invoice/option-ledger-import'
import {
  buildOutgoingComponentRows,
  formatOptionItemName,
  transformInvoiceOptions,
  type InvoiceOutgoingComponentRow,
} from '@/lib/invoice/option-transform'
import {
  ALL_INVOICE_PRODUCT_LIST_CATEGORIES,
  classifyInvoiceProductListRow,
  summarizeInvoiceProductList,
} from '@/lib/invoice/product-list-summary'
import {
  buildInvoiceProductListBackupRows,
  INVOICE_PRODUCT_LIST_BACKUP_HEADERS,
} from '@/lib/invoice/product-list-export'
import {
  buildInvoiceProductListPrintFitProfile,
  buildInvoiceProductListPrintPages,
  chooseInvoiceProductListFitRows,
  estimateInvoiceProductListPrintPageCounts,
  INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS,
  INVOICE_PRODUCT_LIST_MIN_FONT_PT,
  INVOICE_PRODUCT_LIST_PRINT_ROWS,
  maxInvoiceProductListFitRows,
  recommendInvoiceProductListColumnMode,
  resolveInvoiceProductListSelectedRouteGroupId,
  scopeInvoiceProductListPrintPages,
} from '@/lib/invoice/product-list-print'
import {
  addInvoiceProductListRouteGroup,
  applyInvoiceProductListRoutePreset,
  applyInvoiceProductListRouteSplitMode,
  buildDefaultInvoiceProductListPrintLayout,
  buildInvoiceProductListPrintRouteSections,
  INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
  invoiceProductListSelectableRouteGroupIds,
  moveInvoiceProductListZonePrefix,
  parseInvoiceProductListRoutePresetGroups,
  reconcileInvoiceProductListPrintLayout,
  serializeInvoiceProductListRouteGroups,
} from '@/lib/invoice/product-list-route'
import {
  allocateInvoiceProductListWarehouse,
  extractWarehouseLocationZonePrefix,
  UNSPECIFIED_LOCATION_ZONE,
} from '@/lib/invoice/product-list-warehouse'
import type { WarehouseStockPosition, WarehouseZone } from '@/lib/types'
import { PRODUCT_NAME_CASES } from '@/lib/invoice/product-name-cases'
import {
  generateProductNameCandidates,
  generateProductNameRegistrationCandidates,
} from '@/lib/invoice/product-name-patterns'
import {
  matchingItemNameFromTags,
  matchingProductName,
  matchingProductNameFromTags,
} from '@/lib/invoice/product-name-tags'
import {
  catalogFromStyles,
  collectProductNameComboOrders,
  previewProductNameExclusion,
  productNameTransformationToName,
  transformInvoiceProductNames,
} from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceCode } from '@/lib/invoice/name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type {
  InvoiceItemNameRule,
  InvoiceItemNameRuleComponent,
  InvoiceNameRule,
  InvoiceOptionMap,
  InvoiceOptionMapComponent,
  InvoiceProductNameExclusion,
  InvoiceProductNameMap,
  InvoiceProductNameTagRole,
  InvoiceProductNameTagRoleEntry,
  StyleRef,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

function row(
  partial: Partial<SabangnetOrderRow> & { rowNumber: number },
): SabangnetOrderRow {
  return {
    productName: '8 pocket cross bag_black',
    itemName: '',
    quantity: '1',
    recipientName: '받는분',
    recipientPhone: '01000000000',
    recipientOtherPhone: '',
    shippingType: '',
    recipientAddress: '서울',
    shippingMessage: '',
    customerOrderNo: `ORD-${partial.rowNumber}`,
    mallName: '테스트몰',
    orderedAt: '2026-08-13 10:00',
    ownProductCode: '',
    ...partial,
  }
}

function component(
  mapId: string,
  ref: StyleRef,
  role: InvoiceOptionMapComponent['role'],
  quantity = 1,
  sortOrder = 0,
): InvoiceOptionMapComponent {
  return {
    id: `${mapId}-${role}-${ref.styleId}`,
    mapId,
    style: ref,
    role,
    quantity,
    sortOrder,
  }
}

function optionMap(options: {
  id: string
  productName: string
  itemName?: string
  mallName?: string
  displayItemName?: string
  components: InvoiceOptionMapComponent[]
}): InvoiceOptionMap {
  const mallName = options.mallName ?? ''
  const itemName = options.itemName ?? ''
  return {
    id: options.id,
    brandId: 'brand',
    mallName,
    normalizedMallName: normalizeInvoiceText(mallName),
    productName: options.productName,
    normalizedProductName: normalizeInvoiceText(options.productName),
    itemName,
    normalizedItemName: normalizeInvoiceText(itemName),
    ownProductCode: '',
    normalizedOwnProductCode: '',
    displayItemName: options.displayItemName ?? '',
    isActive: true,
    note: '',
    components: options.components,
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }
}

function nameRule(options: {
  code: string
  style: StyleRef
}): InvoiceNameRule {
  return {
    id: `rule-${options.code}`,
    brandId: 'brand',
    matchType: 'own_product_code',
    sourceValue: options.code,
    normalizedSourceValue: normalizeInvoiceCode(options.code),
    action: 'rename',
    targetStyleId: options.style.styleId,
    targetStyleNo: options.style.styleNo,
    targetName: options.style.name,
    isActive: true,
    isTest: false,
    note: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }
}

const bag = style('s-bag', 'M1000', '8포켓 크로스백 블랙')
const strap = style('s-strap', 'M2000', '숄더스트랩 오션블루')
const tassel = style('s-tassel', 'M3000', '태슬 블랙')
const charm = style('s-charm', 'M4000', '참 실버')
const otherBag = style('s-other', 'M5000', '별도 구매 백')

const product = '8 pocket cross bag_black'

const maps: InvoiceOptionMap[] = [
  optionMap({
    id: 'map-main',
  productName: product,
    itemName: '',
    components: [component('map-main', bag, 'main')],
  }),
  optionMap({
    id: 'map-strap',
  productName: product,
    itemName: 'Shoulder strap=Ocean blue',
    components: [
      component('map-strap', bag, 'main'),
      component('map-strap', strap, 'included'),
    ],
  }),
  optionMap({
    id: 'map-tassel',
  productName: product,
    itemName: 'Tassel=Black',
    components: [
      component('map-tassel', bag, 'main'),
      component('map-tassel', tassel, 'required'),
    ],
  }),
  optionMap({
    id: 'map-paid',
  productName: product,
    itemName: 'Charm=Silver',
    components: [
      component('map-paid', bag, 'main'),
      component('map-paid', charm, 'paid_add'),
    ],
  }),
  optionMap({
    id: 'map-other',
    productName: 'other bag',
    itemName: '',
    components: [component('map-other', otherBag, 'main')],
  }),
]

const sourceRows = [
  row({ rowNumber: 1, itemName: '선택안함', quantity: '2' }),
  row({
    rowNumber: 2,
    itemName: 'Shoulder strap=Ocean blue',
    quantity: '2',
  }),
  row({ rowNumber: 3, itemName: 'Tassel=Black' }),
  row({ rowNumber: 4, itemName: 'Charm=Silver' }),
  row({
    rowNumber: 5,
    productName: 'other bag',
    itemName: '',
    recipientName: '같은사람',
  }),
  row({
    rowNumber: 6,
    itemName: 'Unknown option',
    ownProductCode: 'CODE1',
  }),
  row({
    rowNumber: 7,
    productName: 'code only product',
    itemName: 'FREE',
    ownProductCode: 'CODE1',
  }),
]

const rules = [nameRule({ code: 'CODE1', style: bag })]
const result = transformInvoiceOptions(sourceRows, maps, rules)

assert(result.rows[0]?.status === 'mapped', '선택안함은 품목명 맵으로 연결')
assert(result.rows[0]?.transformedName === bag.name, '본품 공식명')
assert(
  result.rows[0]?.transformedItemName === '선택안함',
  '본품만이면 내품명 원문 유지',
)

assert(result.rows[1]?.status === 'mapped', '포함 스트랩 맵')
assert(
  result.rows[1]?.transformedItemName === 'Shoulder strap=Ocean blue',
  `맵만 있으면 내품명 원문: ${result.rows[1]?.transformedItemName}`,
)

assert(result.rows[2]?.status === 'mapped', '필수 태슬 맵')
assert(result.rows[2]?.transformedItemName === 'Tassel=Black', '필수여도 원문')

assert(result.rows[3]?.status === 'mapped', '유료추가 맵')
assert(result.rows[3]?.transformedItemName === 'Charm=Silver', '유료추가여도 원문')

assert(result.rows[4]?.transformedName === otherBag.name, '별도 구매 본품')
assert(
  result.rows[5]?.status === 'unresolved',
  '내품명 있으면 코드로 확정하지 않음',
)
assert(result.rows[6]?.status === 'code_fallback', '빈 옵션은 코드 보조')
assert(result.rows[6]?.transformedName === bag.name, '코드 보조 본품명')

const formatted = formatOptionItemName([
  component('x', strap, 'included'),
  component('x', tassel, 'required', 2),
])
assert(
  formatted === '포함:M2000 숄더스트랩 오션블루 + 필수:M3000 태슬 블랙×2',
  formatted,
)

const gifts = new Map<number, SabangnetOrderRow[]>([
  [
    1,
    [
      row({
        rowNumber: 101,
        productName: '사은품(1) : 파우치',
        itemName: '',
        quantity: '1',
      }),
    ],
  ],
])

const output = buildInvoiceOutputRows({
  transformedRows: result.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: gifts,
  optionTransformation: result,
})

const orderRows = output.filter((item) => item.kind === 'order')
const giftRows = output.filter((item) => item.kind === 'gift')
assert(giftRows.length === 1, '사은품은 별도 행')
assert(giftRows[0]?.finalItemName === '', '사은품 내품명 비움')
assert(
  output[0]?.kind === 'order' && output[1]?.kind === 'gift',
  '사은품은 근거 주문 바로 뒤',
)
const strapOrders = orderRows.filter((item) => item.sourceRowNumber === 2)
assert(strapOrders.length === 2, '스트랩 세트는 본품+구성 2행')
assert(strapOrders[0]?.finalProductName === bag.name, 'CJ 품목명=본품')
assert(
  strapOrders[0]?.finalItemName === 'Shoulder strap=Ocean blue',
  '승인된 표시 내품명이 없으면 원문',
)
assert(
  strapOrders[1]?.finalProductName === strap.name,
  '구성품 행 품목명=스트랩',
)
assert(
  orderRows.find((item) => item.sourceRowNumber === 5)?.finalProductName ===
    otherBag.name,
  '별도 구매는 별도 행',
)

const outgoing = buildOutgoingComponentRows({
  optionRows: result.rows,
  giftRowsBySource: gifts,
  packingMaterials: [{ styleNo: 'M9000', name: 'Gift box L', count: 3 }],
})
const strapOut = outgoing.find(
  (item) => item.role === 'included' && item.styleNo === 'M2000',
)
assert(strapOut?.quantity === 2, '주문수량 × 구성수량')
assert(
  outgoing.filter((item) => item.sourceRowNumber === 5).length >= 1,
  '별도 구매 행 경계 유지',
)
assert(
  outgoing.some((item) => item.role === 'gift'),
  '사은품이 출고구성에 포함',
)
assert(
  outgoing.some((item) => item.role === 'packing' && item.styleNo === 'M9000'),
  '포장재가 출고구성에 포함',
)

const duplicateMaps: InvoiceOptionMap[] = [
  optionMap({
    id: 'c1',
  productName: product,
    itemName: 'dup',
    components: [component('c1', bag, 'main')],
  }),
  optionMap({
    id: 'c2',
  productName: product,
    itemName: 'dup',
    components: [component('c2', otherBag, 'main')],
  }),
]
const conflicted = transformInvoiceOptions(
  [row({ rowNumber: 1, itemName: 'dup' })],
  duplicateMaps,
  [],
)
assert(conflicted.rows[0]?.status === 'conflict', '다른 본품이면 충돌')

const candidates = collectInvoiceOptionLedgerStyleCandidates([
  [
    '원본 품목명',
    '원본 내품명',
    '쇼핑몰명',
    '자체상품코드',
    '본품 M번호',
    '본품 공식명',
    '구성품 M번호',
  ],
  ['조회하면 안 되는 품목명', '옵션 M9999', '쇼핑몰', 'CODE', 'M1000', bag.name, 'M2000'],
  ['다른 품목명', '다른 옵션', '쇼핑몰', 'CODE2', '', otherBag.name, ''],
  ['중복 품목명', '중복 옵션', '', '', 'M1000', bag.name, 'M2000'],
])
assert(
  candidates.styleNos.length === 2 &&
    candidates.styleNos.includes('M1000') &&
    candidates.styleNos.includes('M2000'),
  '상품 대조는 본품·구성품 M번호 열만 수집',
)
assert(
  candidates.names.length === 1 && candidates.names[0] === otherBag.name,
  'M번호 없는 행의 공식명만 수집',
)
assert(
  !candidates.names.includes('조회하면 안 되는 품목명'),
  '원본 품목명을 상품 검색 URL에 넣지 않음',
)

const lookup = {
  byStyleNo: new Map([
    ['m1000', bag],
    ['m2000', strap],
    ['m5000', otherBag],
  ]),
  byName: new Map([
    [bag.name.toLocaleLowerCase('ko-KR'), [bag]],
    [strap.name.toLocaleLowerCase('ko-KR'), [strap]],
    [otherBag.name.toLocaleLowerCase('ko-KR'), [otherBag]],
  ]),
}
const ledger = prepareInvoiceOptionLedgerRows(
  [
    [
      '원본 품목명',
      '원본 내품명',
      '본품 M번호',
      '본품 공식명',
      '구성품 M번호',
      '구성품 역할',
    ],
    [product, 'Shoulder strap=Ocean blue', 'M1000', bag.name, 'M2000', '포함'],
    [product, 'Shoulder strap=Ocean blue', 'M1000', bag.name, '', ''],
    [product, '충돌옵션', 'M1000', '', '', ''],
    [product, '충돌옵션', 'M5000', '', '', ''],
    [product, '없는번호', 'M9999', '', '', ''],
  ],
  lookup,
)
const ready = ledger.filter(
  (item) => item.status === 'duplicate' || item.status === 'ready',
)
const conflict = ledger.filter((item) => item.status === 'conflict')
const unmatched = ledger.filter((item) => item.status === 'unmatched')
assert(ready.length === 1, '같은 조합은 하나로 합침')
assert(conflict.length === 1, '다른 본품은 충돌로 남김')
assert(unmatched.length === 1, '없는 M번호는 미일치')

const officialStyles = PRODUCT_NAME_CASES.map((item, index) =>
  style(`s-case-${index}`, `M9${String(index).padStart(3, '0')}`, item.expectedOfficialName),
)
const uniqueOfficial = new Map<string, StyleRef>()
for (const ref of officialStyles) {
  if (!uniqueOfficial.has(ref.name)) uniqueOfficial.set(ref.name, ref)
}
assert(
  uniqueOfficial.size === new Set(PRODUCT_NAME_CASES.map((item) => item.expectedOfficialName)).size,
  '공식명이 1개 상품에만 연결',
)

const caseRows = PRODUCT_NAME_CASES.map((item, index) =>
  row({
    rowNumber: index + 1,
    productName: item.productName,
    itemName: item.itemName,
    mallName: item.mallName,
    ownProductCode: item.ownProductCode,
  }),
)
const productMaps: InvoiceProductNameMap[] = PRODUCT_NAME_CASES.map(
  (item, index) => {
    const ref = uniqueOfficial.get(item.expectedOfficialName)!
    return {
      id: `pmap-${index}`,
      brandId: 'brand',
      mallName: item.mallName,
      normalizedMallName: normalizeInvoiceText(item.mallName),
      productName: item.productName,
      normalizedProductName: normalizeInvoiceText(item.productName),
      itemNameContext: item.itemName,
      normalizedItemNameContext: normalizeInvoiceText(item.itemName),
      ownProductCode: item.ownProductCode,
      normalizedOwnProductCode: normalizeInvoiceText(item.ownProductCode),
      lookupKey: '',
      normalizedLookupKey: '',
      style: ref,
      isActive: true,
      note: '',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }
  },
)
const catalog = catalogFromStyles([...uniqueOfficial.values()])
const productResult = transformInvoiceProductNames(
  caseRows,
  productMaps,
  catalog,
)
assert(productResult.rows.length === 29, '29개 사례')
for (const [index, item] of PRODUCT_NAME_CASES.entries()) {
  const transformed = productResult.rows[index]
  assert(
    transformed?.transformedProductName === item.expectedOfficialName,
    `${index + 1} 품목명 ${transformed?.transformedProductName} != ${item.expectedOfficialName}`,
  )
  assert(
    transformed?.source.itemName === item.itemName,
    `${index + 1} 내품명 원문이 바뀌면 안 됨`,
  )
}

const itemBefore = transformInvoiceItemNames(caseRows, [], productResult.rows)
for (const [index, item] of PRODUCT_NAME_CASES.entries()) {
  assert(
    itemBefore.rows[index]?.transformedItemName === item.itemName,
    `${index + 1} 내품명 단계 원문 유지`,
  )
}

const displayed = transformInvoiceItemNames(
  caseRows,
  [
    optionMap({
      id: 'display-1',
      productName: PRODUCT_NAME_CASES[16]!.productName,
      itemName: PRODUCT_NAME_CASES[16]!.itemName,
      displayItemName: '추가:M3000 태슬 블랙',
      components: [
        component('display-1', uniqueOfficial.get('스파 와플 블랙')!, 'main'),
        component('display-1', tassel, 'paid_add'),
      ],
    }),
  ],
  productResult.rows,
)
assert(
  displayed.rows[16]?.transformedItemName === '추가:M3000 태슬 블랙',
  '내품명 전용 규칙만 표시명을 바꿈',
)
assert(
  displayed.rows[15]?.transformedItemName === PRODUCT_NAME_CASES[15]!.itemName,
  '미등록 옵션은 원문 유지',
)
const productAfterItem = transformInvoiceProductNames(
  caseRows,
  productMaps,
  catalog,
)
assert(
  productAfterItem.rows[16]?.transformedProductName ===
    PRODUCT_NAME_CASES[16]!.expectedOfficialName,
  '내품명 규칙 저장 뒤에도 품목명 결과는 그대로',
)

const itemAfterProduct = transformInvoiceItemNames(
  caseRows,
  [],
  productAfterItem.rows,
)
assert(
  itemAfterProduct.rows.every(
    (item, index) =>
      item.transformedItemName === PRODUCT_NAME_CASES[index]!.itemName,
  ),
  '품목명 규칙 저장 뒤에도 내품명 결과는 그대로',
)

const output29 = buildInvoiceOutputRows({
  transformedRows: productResult.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: productResult,
  itemTransformation: itemBefore,
})
for (const [index, item] of PRODUCT_NAME_CASES.entries()) {
  assert(
    output29[index]?.finalProductName === item.expectedOfficialName,
    'CJ 품목명=Sheet3',
  )
  assert(output29[index]?.finalItemName === item.itemName, 'CJ 내품명=원문')
}

// 후보는 지정 우선순위다. 괄호를 보지 않고 언제나 첫 구분자에서만 자른다.
const parenCandidates = generateProductNameCandidates({
  productName: 'Strap pouch _ 와플 스트라이프 블랙',
  itemName: 'Tassel 1=Yellow (,3300), Tassel 2=Black (,3300)',
})
assert(
  parenCandidates[0]?.rule === 'product' &&
    parenCandidates[0]?.text === 'Strap pouch _ 와플 스트라이프 블랙',
  '첫 후보는 품목명 단독',
)
assert(
  parenCandidates[1]?.rule === 'product_item' &&
    parenCandidates[1]?.text ===
      'Strap pouch _ 와플 스트라이프 블랙 Tassel 1=Yellow (,3300), Tassel 2=Black (,3300)',
  '두 번째 후보는 품목명 한 칸 띄고 내품명 전체',
)
assert(
  parenCandidates.some(
    (item) =>
      item.rule === 'product_item_comma_prefix' &&
      item.text === 'Strap pouch _ 와플 스트라이프 블랙 Tassel 1=Yellow (',
  ),
  '쉼표 후보는 괄호를 무시하고 첫 쉼표에서 자름',
)

const slashCandidates = generateProductNameCandidates({
  productName: '마스마룰즈 8포켓 크로스백 4컬러',
  itemName: 'Bag: 8pocket _ 블랙 / shoulder strap: Ocean blue',
})
assert(
  slashCandidates[0]?.rule === 'product',
  '슬래시가 있어도 품목명 단독이 먼저',
)
assert(
  slashCandidates.some(
    (item) =>
      item.rule === 'product_item_slash_prefix' &&
      item.text === '마스마룰즈 8포켓 크로스백 4컬러 Bag: 8pocket _ 블랙',
  ),
  '품목명 + 첫 / 앞부분',
)
assert(
  slashCandidates.some(
    (item) =>
      item.rule === 'item_slash_prefix' &&
      item.text === 'Bag: 8pocket _ 블랙',
  ),
  '내품명 / 앞부분 단독 후보를 만든다',
)
assert(
  !slashCandidates.some((item) => item.rule === 'item_slash_suffix'),
  'SSG / 뒷부분 단독 후보는 만들지 않음',
)
const ssgCandidates = generateProductNameCandidates({
  productName: '마스마룰즈 8포켓 크로스백 4컬러',
  itemName: 'Bag: 8pocket _ 블랙 / shoulder strap: Ocean blue',
  mallName: 'SSG.COM',
})
assert(
  ssgCandidates.every((item) => item.rule !== 'item_slash_suffix') &&
    ssgCandidates.length === slashCandidates.length,
  'SSG여도 / 뒷부분 단독 후보를 추가하지 않음',
)
assert(
  slashCandidates.some(
    (item) =>
      item.rule === 'product_item_colon_prefix' &&
      item.text === '마스마룰즈 8포켓 크로스백 4컬러 Bag',
  ),
  '품목명 + 첫 : 앞부분',
)

const allDelimiterCandidates = generateProductNameCandidates({
  productName: '마스마룰즈 파우치',
  itemName: 'Color: 트로피칼, 옵션/기타: 값',
})
assert(
  allDelimiterCandidates[0]?.rule === 'product',
  '구분자가 있어도 품목명 단독 후보를 만든다',
)
assert(
  allDelimiterCandidates.some(
    (item) =>
      item.rule === 'product_item_color_label' &&
      item.text === '마스마룰즈 파우치 Color: 트로피칼, 옵션/기타',
  ),
  'Color: 구간은 다음 콜론 앞까지',
)
const oneDelimiterCandidates = generateProductNameCandidates({
  productName: '마스마룰즈 파우치',
  itemName: '블랙 / 옐로',
})
assert(
  oneDelimiterCandidates[0]?.rule === 'product' &&
    oneDelimiterCandidates[1]?.rule === 'product_item' &&
    oneDelimiterCandidates[2]?.rule === 'product_item_slash_prefix',
  '품목명 단독 다음 결합·슬래시 결합',
)

const colorCandidates = generateProductNameCandidates({
  productName: '[단독] 마스마룰즈 래빗에코백 32타입',
  itemName: 'Color: 트로피칼 : 추가옵션',
})
assert(
  colorCandidates.some(
    (item) =>
      item.rule === 'product_item_color_label' &&
      item.text === '[단독] 마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
  ),
  'Color: 라벨을 키에 남긴 채 자름',
)
const colorItemOnlyCandidates = generateProductNameCandidates({
  productName: '[단독] 마스마룰즈 래빗 에코백_32타입 택1',
  itemName: 'Color: 그랑 레오파드 아이보리_RB',
})
assert(
  colorItemOnlyCandidates.some(
    (item) =>
      item.rule === 'item_full' &&
      item.text === 'Color: 그랑 레오파드 아이보리_RB',
  ),
  'Color: 라벨을 보존한 내품명 전체 단독 후보',
)
assert(
  !colorItemOnlyCandidates.some((item) => item.rule === 'item_value'),
  '옵션값 단독 후보는 만들지 않음',
)

const priorityCandidates = generateProductNameCandidates({
  productName: '품목',
  itemName: 'Color: 빨강 / 기타, 옵션: 값',
})
assert(
  priorityCandidates.map((item) => item.rule).join(',') ===
    [
      'product',
      'product_item',
      'product_item_slash_prefix',
      'product_item_comma_prefix',
      'product_item_color_label',
      'product_item_colon_prefix',
      'item_slash_prefix',
      'item_comma_prefix',
      'item_full',
    ].join(','),
  '품목명부터 내품명 전체까지 9단계 우선순위',
)
assert(
  !priorityCandidates.some((item) => item.rule === 'own_code'),
  '자체상품코드는 조회 키 후보에 넣지 않는다',
)

const kakaoCandidates = generateProductNameCandidates({
  productName: '마스마룰즈 스트랩파우치 모음전',
  itemName: '파우치 선택: 스파 하트 레오파드 머스터드, 태슬: Black',
})
assert(
  kakaoCandidates.some(
    (item) =>
      item.rule === 'item_comma_prefix' &&
      item.text === '파우치 선택: 스파 하트 레오파드 머스터드',
  ),
  '내품명 쉼표 앞부분 단독 후보를 만든다',
)
assert(
  kakaoCandidates.some(
    (item) =>
      item.rule === 'product_item_colon_prefix' &&
      item.text === '마스마룰즈 스트랩파우치 모음전 파우치 선택',
  ),
  '추가·태슬 문구가 있어도 후보를 버리지 않음',
)
assert(
  !generateProductNameCandidates({
    productName: '가방',
    itemName: 'Bag: Black /',
  }).some((item) => item.rule === 'item_slash_prefix'),
  '뒷부분이 없으면 내품명 / 앞부분 단독 후보를 만들지 않음',
)
assert(
  !generateProductNameCandidates({
    productName: '가방',
    itemName: 'Bag: Black,',
  }).some((item) => item.rule === 'item_comma_prefix'),
  '뒷부분이 없으면 내품명 , 앞부분 단독 후보를 만들지 않음',
)

const optionValueCases = [
  {
    productName: '마스마룰즈 180도 하품 파우치 모음전 VER.2',
    itemName: '180 HP_보드리 파스텔그린',
    expected: '180 HP_보드리 파스텔그린',
    expectedRule: 'item_full',
  },
]
for (const item of optionValueCases) {
  const candidates = generateProductNameCandidates(item)
  assert(
    candidates.some(
      (candidate) =>
        candidate.rule === item.expectedRule &&
        candidate.text === item.expected,
    ),
    `내품명 전체 단독 후보: ${item.expected}`,
  )
  assert(
    !candidates.some((candidate) => candidate.rule === 'item_value'),
    '옵션값 단독 후보는 제외',
  )
}

const hapumStyle = style(
  's-hapum',
  'M0777',
  '180도 하품 보드리 파스텔그린',
)
const hapumSource = row({
  rowNumber: 9001,
  productName: optionValueCases[0]!.productName,
  itemName: optionValueCases[0]!.itemName,
  mallName: '스마트스토어',
  ownProductCode: '',
})
const hapumKey = optionValueCases[0]!.expected
const hapumProduct = transformInvoiceProductNames(
  [hapumSource],
  [
    {
      id: 'pmap-hapum',
      brandId: 'brand',
      mallName: '',
      normalizedMallName: '',
      productName: hapumKey,
      normalizedProductName: normalizeInvoiceText(hapumKey),
      itemNameContext: '',
      normalizedItemNameContext: '',
      ownProductCode: '',
      normalizedOwnProductCode: '',
      lookupKey: hapumKey,
      normalizedLookupKey: normalizeInvoiceText(hapumKey),
      style: hapumStyle,
      isActive: true,
      note: '',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
  ],
  catalogFromStyles([]),
)
assert(
  hapumProduct.rows[0]?.status === 'mapped' &&
    hapumProduct.rows[0]?.transformedProductName === hapumStyle.name &&
    hapumProduct.rows[0]?.appliedRule === 'item_full',
  '내품명 전체 단독 원장 매칭으로 본품 확정',
)

const hapumItem = transformInvoiceItemNames(
  [hapumSource],
  [],
  hapumProduct.rows,
)
assert(
  hapumProduct.rows[0]?.itemNameConsumed === true &&
    hapumItem.rows[0]?.status === 'consumed' &&
    hapumItem.rows[0]?.transformedItemName === '' &&
    hapumItem.mappedRowCount === 0 &&
    hapumItem.consumedRowCount === 1 &&
    hapumItem.unresolvedCombos.length === 0,
  '내품명 전체 조회로 본품을 찾으면 내품명을 비우고 검토 목록에서 뺀다',
)

const hapumOutput = buildInvoiceOutputRows({
  transformedRows: [
    {
      source: hapumSource,
      transformedName: hapumStyle.name,
      status: 'renamed',
      matchedRuleId: hapumProduct.rows[0]!.mapId,
    },
  ],
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: hapumProduct,
  itemTransformation: hapumItem,
})
assert(
  hapumOutput[0]?.finalProductName === hapumStyle.name &&
    hapumOutput[0]?.finalItemName === '',
  'CJ 결과는 공식 품목명과 빈 내품명',
)

const hapumProductStage = buildInvoiceStepSnapshot({
  stage: 'product',
  sourceRows: [hapumSource],
  productTransformation: hapumProduct,
  itemTransformation: hapumItem,
})
assert(
  hapumProductStage[0]?.finalItemName === '' &&
    hapumProductStage[0]?.itemName === '',
  '품목명 단계 스냅샷부터 소비된 내품명을 비움',
)

const hapumWithExtras = transformInvoiceItemNames(
  [hapumSource],
  [
    optionMap({
      id: 'hapum-extras',
      productName: hapumSource.productName,
      itemName: hapumSource.itemName,
      components: [
        component('hapum-extras', hapumStyle, 'main'),
        component('hapum-extras', strap, 'included'),
      ],
    }),
  ],
  hapumProduct.rows,
)
assert(
  hapumWithExtras.rows[0]?.status === 'consumed' &&
    hapumWithExtras.rows[0]?.transformedItemName === '' &&
    hapumWithExtras.rows[0]?.extras.length === 1 &&
    hapumWithExtras.unresolvedCombos.length === 0,
  '소비된 행도 저장된 세트 구성은 유지하고 검토 목록에는 안 넣는다',
)
const hapumExtrasOutput = buildInvoiceOutputRows({
  transformedRows: [
    {
      source: hapumSource,
      transformedName: hapumStyle.name,
      status: 'renamed',
      matchedRuleId: hapumProduct.rows[0]!.mapId,
    },
  ],
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: hapumProduct,
  itemTransformation: hapumWithExtras,
})
const hapumExtraOrders = hapumExtrasOutput.filter((item) => item.kind === 'order')
assert(hapumExtraOrders.length === 2, '소비된 세트도 구성행을 펼친다')
assert(
  hapumExtraOrders.every((line) => line.finalItemName === ''),
  '소비된 내품명은 모든 구성행에서 빈 값',
)
assert(
  hapumExtraOrders[0]?.recipientName === hapumSource.recipientName &&
    hapumExtraOrders[1]?.recipientName === hapumSource.recipientName,
  '소비된 세트 구성행도 고객정보를 복제한다',
)

const directOptionValueStyle = style(
  's-hapum-direct',
  'M0778',
  hapumKey,
)
const directOptionValueProduct = transformInvoiceProductNames(
  [hapumSource],
  [],
  catalogFromStyles([directOptionValueStyle]),
)
assert(
  directOptionValueProduct.rows[0]?.status === 'candidate',
  '상품명 직접 후보만 맞으면 후보 1개로 남김',
)
const directOptionValueItem = transformInvoiceItemNames(
  [hapumSource],
  [],
  directOptionValueProduct.rows,
)
assert(
  directOptionValueItem.rows[0]?.transformedItemName === hapumSource.itemName,
  '품목명 원장 exact 매칭이 아니면 내품명 원문 유지',
)

const casebook = prepareInvoiceProductNameLedgerRows(
  [
    ['원본 품목명', '원본 내품명', '본품 공식명'],
    [
      PRODUCT_NAME_CASES[0]!.productName,
      PRODUCT_NAME_CASES[0]!.itemName,
      PRODUCT_NAME_CASES[0]!.expectedOfficialName,
    ],
  ],
  {
    byStyleNo: new Map(),
    byName: new Map([
      [
        PRODUCT_NAME_CASES[0]!.expectedOfficialName.toLocaleLowerCase('ko-KR'),
        [uniqueOfficial.get(PRODUCT_NAME_CASES[0]!.expectedOfficialName)!],
      ],
    ]),
  },
)
assert(casebook[0]?.status === 'ready', '사례집 공식명으로 본품 채움')
assert(
  casebook[0]?.input?.itemNameContext === PRODUCT_NAME_CASES[0]!.itemName,
  '내품명은 조회 키로만 보존',
)
assert(!('components' in (casebook[0]?.input ?? {})), '구성품을 만들지 않음')
assert(!casebook[0]?.lookupKey, '조합 원장은 조회 키를 쓰지 않음')

// 변경전 → 변경후 두 열 원장은 변경전 값을 조회 키로 저장한다.
const slashCase = PRODUCT_NAME_CASES.find((item) => item.itemName.includes('/'))!
const slashKey = `${slashCase.productName} ${slashCase.itemName.slice(0, slashCase.itemName.indexOf('/')).trim()}`
const slashStyle = uniqueOfficial.get(slashCase.expectedOfficialName)!
const keyLedgerCandidates = collectInvoiceProductNameLedgerStyleCandidates([
  ['조회 키', '본품 M번호'],
  [slashKey, slashStyle.styleNo],
])
assert(
  keyLedgerCandidates.styleNos.length === 1 &&
    keyLedgerCandidates.styleNos[0] === slashStyle.styleNo &&
    keyLedgerCandidates.names.length === 0,
  '새 양식은 공식명이 아니라 M번호만 조회',
)
const keyLedger = prepareInvoiceProductNameLedgerRows(
  [
    ['조회 키', '본품 M번호'],
    [slashKey, slashStyle.styleNo],
  ],
  {
    byStyleNo: new Map([[slashStyle.styleNo.toLocaleLowerCase('ko-KR'), slashStyle]]),
    byName: new Map(),
  },
)
assert(keyLedger[0]?.status === 'ready', '조회 키 원장 준비')
assert(keyLedger[0]?.input?.lookupKey === slashKey, '1열 값이 조회 키')
assert(!keyLedger[0]?.input?.itemNameContext, '조회 키 행은 내품명 문맥 없음')
assert(
  keyLedger[0]?.mainStyle?.styleId === slashStyle.styleId &&
    keyLedger[0]?.officialName === slashStyle.name,
  'M번호로 본품과 현재 공식 명칭을 불러옴',
)

// 예전 2열 원장도 헤더 이름만 다르고 같게 읽힌다.
const legacyKeyLedger = prepareInvoiceProductNameLedgerRows(
  [
    ['변경전', '변경후'],
    [slashKey, slashCase.expectedOfficialName],
  ],
  {
    byStyleNo: new Map(),
    byName: new Map([
      [slashCase.expectedOfficialName.toLocaleLowerCase('ko-KR'), [slashStyle]],
    ]),
  },
)
assert(
  legacyKeyLedger[0]?.status === 'ready' &&
    legacyKeyLedger[0]?.input?.lookupKey === slashKey,
  '변경전/변경후 헤더도 조회 키로 읽음',
)

// 한 파일에 두 방식이 섞여도 행마다 갈라 읽는다.
const mixedLedger = prepareInvoiceProductNameLedgerRows(
  [
    ['조회 키', '원본 품목명', '원본 내품명', '쇼핑몰명', '본품 공식명'],
    [slashKey, '', '', '', slashCase.expectedOfficialName],
    ['', slashCase.productName, slashCase.itemName, '스마트스토어', slashCase.expectedOfficialName],
  ],
  {
    byStyleNo: new Map(),
    byName: new Map([
      [slashCase.expectedOfficialName.toLocaleLowerCase('ko-KR'), [slashStyle]],
    ]),
  },
)
assert(
  mixedLedger[0]?.lookupKey === slashKey && !mixedLedger[1]?.lookupKey,
  '조회 키를 채운 행만 조회 키 방식',
)
assert(
  mixedLedger[1]?.input?.itemNameContext === slashCase.itemName &&
    mixedLedger[1]?.input?.mallName === '스마트스토어',
  '비운 행은 쇼핑몰·내품명 조합으로 저장',
)
assert(
  mixedLedger.every((item) => item.status === 'ready'),
  '섞인 두 행 모두 등록 가능',
)

const keyMapResult = transformInvoiceProductNames(
  [
    row({
      rowNumber: 1,
      productName: slashCase.productName,
      itemName: slashCase.itemName,
      mallName: slashCase.mallName,
      ownProductCode: slashCase.ownProductCode,
    }),
  ],
  [
    {
      id: 'key-map-1',
      brandId: 'brand',
      mallName: '',
      normalizedMallName: '',
      productName: slashKey,
      normalizedProductName: normalizeInvoiceText(slashKey),
      itemNameContext: '',
      normalizedItemNameContext: '',
      ownProductCode: '',
      normalizedOwnProductCode: '',
      lookupKey: slashKey,
      normalizedLookupKey: normalizeInvoiceText(slashKey),
      style: slashStyle,
      isActive: true,
      note: '',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
  ],
  catalogFromStyles([]),
)
assert(
  keyMapResult.rows[0]?.status === 'mapped' &&
    keyMapResult.rows[0]?.transformedProductName ===
      slashCase.expectedOfficialName,
  '조회 키가 후보와 맞으면 품목명 변환 완료',
)
assert(
  keyMapResult.rows[0]?.appliedRule === 'product_item_slash_prefix',
  '어느 수식으로 맞았는지 남김',
)
assert(
  keyMapResult.rows[0]?.source.itemName === slashCase.itemName,
  '조회 키로 맞아도 내품명 원문 유지',
)

const comboExactStyle = style('s-combo-exact', 'M9001', '조합 exact 본품')
const comboAnyStyle = style('s-combo-any', 'M9002', '전쇼핑몰 본품')
const comboSource = row({
  rowNumber: 8801,
  productName: '조합 품목명',
  itemName: '조합 내품명',
  mallName: '스마트스토어',
})
function comboMap(
  id: string,
  mallName: string,
  ref: StyleRef,
): InvoiceProductNameMap {
  return {
    id,
    brandId: 'brand',
    mallName,
    normalizedMallName: normalizeInvoiceText(mallName),
    productName: comboSource.productName,
    normalizedProductName: normalizeInvoiceText(comboSource.productName),
    itemNameContext: comboSource.itemName,
    normalizedItemNameContext: normalizeInvoiceText(comboSource.itemName),
    ownProductCode: '',
    normalizedOwnProductCode: '',
    lookupKey: '',
    normalizedLookupKey: '',
    style: ref,
    isActive: true,
    note: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }
}
const noisyLookupMaps: InvoiceProductNameMap[] = Array.from(
  { length: 40 },
  (_, index) => ({
    id: `noise-${index}`,
    brandId: 'brand',
    mallName: '',
    normalizedMallName: '',
    productName: `노이즈 ${index}`,
    normalizedProductName: normalizeInvoiceText(`노이즈 ${index}`),
    itemNameContext: '',
    normalizedItemNameContext: '',
    ownProductCode: '',
    normalizedOwnProductCode: '',
    lookupKey: `노이즈 ${index}`,
    normalizedLookupKey: normalizeInvoiceText(`노이즈 ${index}`),
    style: comboAnyStyle,
    isActive: true,
    note: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }),
)
const comboExactResult = transformInvoiceProductNames(
  [comboSource],
  [
    ...noisyLookupMaps,
    comboMap('combo-any', '', comboAnyStyle),
    comboMap('combo-exact', '스마트스토어', comboExactStyle),
  ],
  catalogFromStyles([]),
)
assert(
  comboExactResult.rows[0]?.status === 'mapped' &&
    comboExactResult.rows[0]?.appliedRule === 'product_item' &&
    comboExactResult.rows[0]?.transformedProductName === comboExactStyle.name,
  '쇼핑몰 지정 조합이 조회 키 원장보다 우선',
)
const comboAnyResult = transformInvoiceProductNames(
  [comboSource],
  [...noisyLookupMaps, comboMap('combo-any-only', '', comboAnyStyle)],
  catalogFromStyles([]),
)
assert(
  comboAnyResult.rows[0]?.status === 'mapped' &&
    comboAnyResult.rows[0]?.appliedRule === 'product_item' &&
    comboAnyResult.rows[0]?.transformedProductName === comboAnyStyle.name,
  '쇼핑몰이 비어 있으면 전쇼핑몰 조합으로 맞음',
)

const outgoingFromStages = buildOutgoingComponentRowsFromStages({
  productRows: productResult.rows,
  itemRows: displayed.rows,
  giftRowsBySource: new Map(),
})
const tasselOut = outgoingFromStages.find(
  (item) => item.role === 'paid_add' && item.styleNo === 'M3000',
)
assert(tasselOut?.quantity === 1, '구성 수량 보존')

function tagRole(
  tagText: string,
  value: InvoiceProductNameTagRole,
): InvoiceProductNameTagRoleEntry {
  return {
    id: tagText,
    brandId: 'brand',
    tagText,
    normalizedTag: normalizeInvoiceText(tagText),
    role: value,
    isActive: true,
    note: '',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  }
}

const soloCandidates = generateProductNameCandidates({
  productName: '[단독] 마스마룰즈 래빗에코백 32타입',
  itemName: 'Color: 트로피칼',
  matchingProductName: matchingProductName(
    '[단독] 마스마룰즈 래빗에코백 32타입',
    [tagRole('[단독]', 'event_marketing')],
  ),
})
assert(
  soloCandidates[0]?.rule === 'product' &&
    soloCandidates[0]?.text === '[단독] 마스마룰즈 래빗에코백 32타입',
  '[단독] 원문 품목명 단독 후보를 유지',
)
assert(
  soloCandidates.some(
    (item) => item.text === '마스마룰즈 래빗에코백 32타입 Color: 트로피칼',
  ),
  '[단독]을 행사로 저장하면 인식 후보를 추가',
)

assert(
  matchingProductName('[태슬1개 포함] 베이직 파우치', [
    tagRole('[태슬1개 포함]', 'product_composition'),
  ]) === '[태슬1개 포함] 베이직 파우치',
  '상품 구성 태그는 인식에 유지',
)
assert(
  matchingProductName('[리퍼브] String flap backpack _ Glittery pink', [
    tagRole('[리퍼브]', 'identity_condition'),
  ]) === 'String flap backpack _ Glittery pink',
  '상품 특징 태그는 비교에서 제외',
)
assert(
  matchingProductName('[비치볼 증정]8 pocket cross bag_4colors', [
    tagRole('[비치볼 증정]', 'composition_gift'),
  ]) === '8 pocket cross bag_4colors',
  '증정 태그는 인식에서만 제외',
)

const taggedSource = row({
  rowNumber: 90,
  productName: '[단독] 마스마룰즈 래빗에코백 32타입',
  itemName: 'Color: 트로피칼',
  mallName: '스마트스토어',
})
const taggedCatalog = catalogFromStyles([
  style('s-rabbit', 'M9010', '마스마룰즈 래빗에코백 32타입'),
])
const taggedProduct = transformInvoiceProductNames(
  [taggedSource],
  [],
  taggedCatalog,
  [tagRole('[단독]', 'event_marketing')],
)
assert(
  taggedProduct.rows[0]?.source.productName === taggedSource.productName,
  '태그 역할 저장 뒤에도 원문 품목명 유지',
)
assert(
  taggedProduct.rows[0]?.status === 'candidate' &&
    taggedProduct.rows[0]?.transformedProductName ===
      '마스마룰즈 래빗에코백 32타입',
  '행사 태그를 빼면 공식명 후보로 인식',
)

const outgoingWithTags = buildOutgoingComponentRowsFromStages({
  productRows: taggedProduct.rows,
  itemRows: transformInvoiceItemNames(
    [taggedSource],
    [],
    taggedProduct.rows,
  ).rows,
  giftRowsBySource: new Map(),
})
const outgoingWithoutTags = buildOutgoingComponentRowsFromStages({
  productRows: transformInvoiceProductNames(
    [taggedSource],
    [],
    taggedCatalog,
  ).rows,
  itemRows: transformInvoiceItemNames(
    [taggedSource],
    [],
    transformInvoiceProductNames([taggedSource], [], taggedCatalog).rows,
  ).rows,
  giftRowsBySource: new Map(),
})
assert(
  outgoingWithTags.length === outgoingWithoutTags.length,
  '태그 역할은 출고구성 행 수를 바꾸지 않음',
)

function lookupMap(
  id: string,
  lookupKey: string,
  ref: StyleRef,
): InvoiceProductNameMap {
  return {
    id,
    brandId: 'brand',
    mallName: '',
    normalizedMallName: '',
    productName: lookupKey,
    normalizedProductName: normalizeInvoiceText(lookupKey),
    itemNameContext: '',
    normalizedItemNameContext: '',
    ownProductCode: '',
    normalizedOwnProductCode: '',
    lookupKey,
    normalizedLookupKey: normalizeInvoiceText(lookupKey),
    style: ref,
    isActive: true,
    note: '',
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  }
}

const compactStyle = style('s-compact', 'M9100', 'MSMRZ Logo Ball cap')
const compactSource = row({
  rowNumber: 9101,
  productName: 'MSMRZ Logo Ball_cap / 12color',
  itemName: '',
  mallName: '스마트스토어',
})
const compactMapped = transformInvoiceProductNames(
  [compactSource],
  [lookupMap('compact-1', 'MSMRZ Logo Ball cap 12color', compactStyle)],
  catalogFromStyles([]),
)
assert(
  compactMapped.rows[0]?.status === 'mapped' &&
    compactMapped.rows[0]?.appliedRule === 'product' &&
    compactMapped.rows[0]?.transformedProductName === compactStyle.name,
  '공백·기호만 다른 원장 조회 키는 압축 매칭',
)

const taggedLedgerStyle = style('s-tag-ledger', 'M9101', '마스마룰즈 래빗에코백')
const taggedLedger = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9102,
      productName: '마스마룰즈 래빗에코백',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [lookupMap('tag-ledger-1', '[단독] 마스마룰즈 래빗에코백', taggedLedgerStyle)],
  catalogFromStyles([]),
  [tagRole('[단독]', 'event_marketing')],
)
assert(
  taggedLedger.rows[0]?.status === 'mapped' &&
    taggedLedger.rows[0]?.transformedProductName === taggedLedgerStyle.name,
  '원장 조회 키의 행사 태그를 빼면 별칭으로 매칭',
)

const optionReserveStyle = style(
  's-opt-reserve',
  'M9201',
  '래빗에코백 트와일라잇 블랙',
)
const optionReserveSource = row({
  rowNumber: 9201,
  productName: '마스마룰즈 래빗에코백',
  itemName: 'Color: [9/1예약배송]트와일라잇 블랙',
  mallName: '스마트스토어',
})
const optionReserveMapped = transformInvoiceProductNames(
  [optionReserveSource],
  [
    lookupMap(
      'opt-reserve-1',
      '마스마룰즈 래빗에코백 Color: [8/14예약배송]트와일라잇 블랙',
      optionReserveStyle,
    ),
  ],
  catalogFromStyles([]),
  [tagRole('[8/14예약배송]', 'event_marketing')],
)
assert(
  optionReserveMapped.rows[0]?.status === 'mapped' &&
    optionReserveMapped.rows[0]?.style?.styleId === optionReserveStyle.styleId &&
    optionReserveMapped.rows[0]?.source.itemName ===
      optionReserveSource.itemName &&
    optionReserveMapped.rows[0]?.effectiveItemName ===
      optionReserveSource.itemName,
  '이전 날짜 원장과 새 날짜 옵션을 연결하고 원문은 보존',
)

const optionExactStyle = style('s-opt-exact', 'M9202', '현재 날짜 원장')
const optionAliasStyle = style('s-opt-alias', 'M9203', '정리 별칭 원장')
const optionExactMapped = transformInvoiceProductNames(
  [optionReserveSource],
  [
    lookupMap(
      'opt-alias-1',
      '마스마룰즈 래빗에코백 Color: 트와일라잇 블랙',
      optionAliasStyle,
    ),
    lookupMap(
      'opt-exact-1',
      '마스마룰즈 래빗에코백 Color: [9/1예약배송]트와일라잇 블랙',
      optionExactStyle,
    ),
  ],
  catalogFromStyles([]),
  [tagRole('[날짜 예약배송]', 'event_marketing')],
)
assert(
  optionExactMapped.rows[0]?.status === 'mapped' &&
    optionExactMapped.rows[0]?.style?.styleId === optionExactStyle.styleId &&
    optionExactMapped.rows[0]?.appliedLookupKey ===
      '마스마룰즈 래빗에코백 Color: [9/1예약배송]트와일라잇 블랙',
  '현재 날짜 원문 exact 조회 키를 정리 별칭보다 우선',
)

const optionUnknown = transformInvoiceProductNames(
  [optionReserveSource],
  [
    lookupMap(
      'opt-clean-1',
      '마스마룰즈 래빗에코백 Color: 트와일라잇 블랙',
      optionReserveStyle,
    ),
  ],
  catalogFromStyles([]),
)
assert(
  optionUnknown.rows[0]?.status !== 'mapped' &&
    optionUnknown.rows[0]?.source.itemName === optionReserveSource.itemName,
  '역할 미저장이면 날짜 제거 별칭으로 맞추지 않고 원문을 유지',
)

const rematchRoles = [tagRole('[8/14예약배송]', 'event_marketing')]
const rematchSource = row({
  rowNumber: 9210,
  productName: '마스마룰즈 래빗에코백',
  itemName: 'Color: [9/1예약배송]트와일라잇 블랙',
  mallName: '스마트스토어',
})
const rematchFirst = transformInvoiceProductNames(
  [rematchSource],
  [],
  catalogFromStyles([]),
  rematchRoles,
)
assert(
  rematchFirst.rows[0]?.status !== 'mapped' &&
    rematchFirst.unresolvedCombos.length === 1,
  '등록 전 조회 키는 미해결 조합으로 남음',
)
const rematchCombo = rematchFirst.unresolvedCombos[0]!
const rematchKey = generateProductNameRegistrationCandidates({
  productName: matchingProductNameFromTags(
    rematchCombo.productName,
    rematchCombo.tags,
  ),
  itemName: matchingItemNameFromTags(rematchCombo.itemName, rematchCombo.itemTags),
}).find((candidate) => candidate.rule === 'product_item')?.text
assert(rematchKey, 'AI 등록 품목명+내품명 조회 키를 만들 수 있음')
const rematchStyle = style('s-rematch', 'M9210', '래빗에코백 트와일라잇 블랙')
const rematchSaved = transformInvoiceProductNames(
  [rematchSource],
  [lookupMap('rematch-1', rematchKey, rematchStyle)],
  catalogFromStyles([]),
  rematchRoles,
)
assert(
  rematchSaved.rows[0]?.status === 'mapped' &&
    rematchSaved.rows[0]?.style?.styleId === rematchStyle.styleId,
  '등록 조회 키를 원장에 넣으면 같은 파일이 자동 완료',
)
assert(
  rematchSaved.unresolvedCombos.length === 0,
  '저장된 조합은 미해결 목록에서 빠짐',
)
const rematchLater = transformInvoiceProductNames(
  [
    {
      ...rematchSource,
      rowNumber: 9211,
      itemName: 'Color: [9/15예약배송]트와일라잇 블랙',
    },
  ],
  [lookupMap('rematch-1', rematchKey, rematchStyle)],
  catalogFromStyles([]),
  rematchRoles,
)
assert(
  rematchLater.rows[0]?.status === 'mapped' &&
    rematchLater.unresolvedCombos.length === 0,
  '같은 등록 키로 후속 파일도 자동 완료',
)

const keepIdentity = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9103,
      productName: 'String flap backpack',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [
    lookupMap(
      'identity-1',
      '[리퍼브] String flap backpack',
      style('s-refurb', 'M9102', '[리퍼브] String flap backpack'),
    ),
  ],
  catalogFromStyles([]),
  [tagRole('[리퍼브]', 'identity_condition')],
)
assert(
  keepIdentity.rows[0]?.status === 'mapped',
  '상품 특징 태그는 비교 별칭에서 제거해 본품명과 맞춘다',
)

const sameStyleA = style('s-same-a', 'M9103', '동일 본품 A')
const sameStyleAlias = style('s-same-a', 'M9103', '동일 본품 A')
const sameStyleMaps = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9104,
      productName: '동일본품A',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [
    lookupMap('same-1', '동일 본품 A', sameStyleA),
    lookupMap('same-2', '동일_본품_A', sameStyleAlias),
  ],
  catalogFromStyles([]),
)
assert(
  sameStyleMaps.rows[0]?.status === 'mapped' &&
    sameStyleMaps.rows[0]?.style?.styleId === 's-same-a',
  '같은 M번호의 여러 압축 별칭은 자동 완료',
)

const conflictCompact = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9105,
      productName: '충돌본품',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [
    lookupMap(
      'conflict-1',
      '충돌 본품',
      style('s-conflict-1', 'M9104', '충돌 본품 1'),
    ),
    lookupMap(
      'conflict-2',
      '충돌_본품',
      style('s-conflict-2', 'M9105', '충돌 본품 2'),
    ),
  ],
  catalogFromStyles([]),
)
assert(
  conflictCompact.rows[0]?.status === 'conflict',
  '서로 다른 M번호의 같은 압축 키는 충돌',
)

const strictFirstStyle = style('s-strict-first', 'M9106', '엄격 우선 본품')
const strictFirst = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9106,
      productName: '엄격우선본품',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [
    lookupMap('strict-first', '엄격우선본품', strictFirstStyle),
    lookupMap(
      'compact-other',
      '엄격_우선_본품',
      style('s-compact-other', 'M9107', '압축만 같은 다른 본품'),
    ),
  ],
  catalogFromStyles([]),
)
assert(
  strictFirst.rows[0]?.status === 'conflict',
  '같은 압축 키가 서로 다른 M번호면 충돌',
)

const compactOfficial = transformInvoiceProductNames(
  [
    row({
      rowNumber: 9107,
      productName: '공식_상품명_압축',
      itemName: '',
      mallName: '스마트스토어',
    }),
  ],
  [],
  catalogFromStyles([
    style('s-official-compact', 'M9108', '공식 상품명 압축'),
  ]),
)
assert(
  compactOfficial.rows[0]?.status === 'candidate' &&
    compactOfficial.rows[0]?.appliedRule === 'compact' &&
    compactOfficial.rows[0]?.transformedProductName === '공식 상품명 압축',
  '공식상품명도 압축 키로 후보 1개',
)
assert(
  compactOfficial.rows[0]?.itemNameConsumed !== true,
  'styles.name 직접 후보는 내품명을 소비하지 않는다',
)

const ownCodeStyle = style('s-own-code', 'M9200', '코드 우선 본품')
const ownCodeProductStyle = style('s-own-product', 'M9201', '품목명 본품')
const ownCodeSource = row({
  rowNumber: 9201,
  productName: '품목명 본품',
  itemName: '옵션값',
  ownProductCode: 'CODE-9200',
})
const ownCodeFirst = transformInvoiceProductNames(
  [ownCodeSource],
  [
    lookupMap('own-product', '품목명 본품', ownCodeProductStyle),
    {
      ...lookupMap('own-code', '다른조회키', ownCodeStyle),
      ownProductCode: 'CODE-9200',
      normalizedOwnProductCode: normalizeInvoiceText('CODE-9200'),
    },
  ],
  catalogFromStyles([]),
)
assert(
  ownCodeFirst.rows[0]?.status === 'mapped' &&
    ownCodeFirst.rows[0]?.appliedRule === 'product' &&
    ownCodeFirst.rows[0]?.style?.styleId === 's-own-product' &&
    ownCodeFirst.rows[0]?.itemNameConsumed !== true,
  '자체상품코드 원장 별칭은 쓰지 않고 품목명 후보를 적용한다',
)

const ownCodeOnly = transformInvoiceProductNames(
  [ownCodeSource],
  [
    {
      ...lookupMap('own-code-only', '다른조회키', ownCodeStyle),
      ownProductCode: 'CODE-9200',
      normalizedOwnProductCode: normalizeInvoiceText('CODE-9200'),
    },
  ],
  catalogFromStyles([]),
)
assert(
  ownCodeOnly.rows[0]?.status !== 'mapped' &&
    ownCodeOnly.rows[0]?.appliedRule !== 'own_code' &&
    !ownCodeOnly.rows[0]?.candidates.some((item) => item.rule === 'own_code'),
  '자체품번만 맞는 레거시 원장은 자동 확정하지 않는다',
)

const setEntitySource = row({
  rowNumber: 9202,
  productName: '[SET] Daily backpack_Black &amp; Strap pouch_Leopard',
  itemName: 'FREE',
})
const setEntityProduct = transformInvoiceProductNames(
  [setEntitySource],
  [
    lookupMap(
      'set-entity',
      '[SET] Daily backpack_Black & Strap pouch_Leopard',
      bag,
    ),
  ],
  catalogFromStyles([]),
  [tagRole('[SET]', 'product_composition')],
)
assert(
  setEntityProduct.rows[0]?.status === 'mapped' &&
    setEntityProduct.rows[0]?.appliedRule === 'product' &&
    setEntityProduct.rows[0]?.transformedProductName === bag.name,
  '상품 구성 태그와 HTML 엔티티는 같은 품목명으로 맞춘다',
)

const prefixStyle = style('s-bp-heart', 'M9300', '베파 하트 체크 라벤더')
const prefixProductName =
  '[태슬1개 포함] 마스마룰즈 베이직파우치 모음전 VER.1'
const prefixLookup = '파우치 선택: [단독]BP_하트 체크 라벤더'
const commaPrefixSource = row({
  rowNumber: 9210,
  productName: prefixProductName,
  itemName: '파우치 선택: [단독]BP_하트 체크 라벤더, Tassel: Purple',
  recipientName: '옵션고객',
})
const slashPrefixSource = row({
  rowNumber: 9211,
  productName: prefixProductName,
  itemName: '파우치 선택: [단독]BP_하트 체크 라벤더/ Tassel: Purple',
  recipientName: '옵션고객',
})
const commaPrefixProduct = transformInvoiceProductNames(
  [commaPrefixSource],
  [lookupMap('prefix-comma', prefixLookup, prefixStyle)],
  catalogFromStyles([]),
)
assert(
  commaPrefixProduct.rows[0]?.status === 'mapped' &&
    commaPrefixProduct.rows[0]?.appliedRule === 'item_comma_prefix' &&
    commaPrefixProduct.rows[0]?.itemNameConsumed !== true &&
    commaPrefixProduct.rows[0]?.effectiveItemName === 'Tassel: Purple',
  '내품명 , 앞부분 단독 원장은 본품을 확정하고 남은 옵션을 남긴다',
)
const slashPrefixProduct = transformInvoiceProductNames(
  [slashPrefixSource],
  [lookupMap('prefix-slash', prefixLookup, prefixStyle)],
  catalogFromStyles([]),
)
assert(
  slashPrefixProduct.rows[0]?.status === 'mapped' &&
    slashPrefixProduct.rows[0]?.appliedRule === 'item_slash_prefix' &&
    slashPrefixProduct.rows[0]?.effectiveItemName === 'Tassel: Purple',
  '내품명 / 앞부분 단독 원장도 같은 남은 옵션을 남긴다',
)
const commaPrefixItem = transformInvoiceItemNames(
  [commaPrefixSource],
  [],
  commaPrefixProduct.rows,
)
assert(
  commaPrefixItem.rows[0]?.status === 'passthrough' &&
    commaPrefixItem.rows[0]?.transformedItemName === 'Tassel: Purple' &&
    commaPrefixItem.unresolvedCombos.length === 1 &&
    commaPrefixItem.unresolvedCombos[0]?.itemName === 'Tassel: Purple' &&
    commaPrefixItem.unresolvedCombos[0]?.originalItemName ===
      commaPrefixSource.itemName &&
    commaPrefixItem.unresolvedCombos[0]?.productLookupKey === prefixLookup &&
    commaPrefixItem.unresolvedCombos[0]?.productAppliedRule ===
      'item_comma_prefix',
  '남은 옵션은 내품명 검토 목록의 입력이 된다',
)
const prefixFallbackItem = transformInvoiceItemNames(
  [commaPrefixSource],
  [
    optionMap({
      id: 'prefix-full-fallback',
      productName: prefixProductName,
      itemName: commaPrefixSource.itemName,
      displayItemName: '태슬=퍼플',
      components: [component('prefix-full-fallback', prefixStyle, 'main')],
    }),
  ],
  commaPrefixProduct.rows,
)
assert(
  prefixFallbackItem.rows[0]?.status === 'mapped' &&
    prefixFallbackItem.rows[0]?.transformedItemName === '태슬=퍼플',
  'suffix 기준이 없으면 원문 조합 원장을 본다',
)
const prefixSuffixItem = transformInvoiceItemNames(
  [commaPrefixSource],
  [
    optionMap({
      id: 'prefix-suffix',
      productName: prefixProductName,
      itemName: 'Tassel: Purple',
      displayItemName: 'Tassel=Purple',
      components: [
        component('prefix-suffix', prefixStyle, 'main'),
        component('prefix-suffix', tassel, 'paid_add'),
      ],
    }),
  ],
  commaPrefixProduct.rows,
)
assert(
  prefixSuffixItem.rows[0]?.status === 'mapped' &&
    prefixSuffixItem.rows[0]?.transformedItemName === 'Tassel=Purple' &&
    prefixSuffixItem.rows[0]?.extras.length === 1,
  '남은 옵션 기준으로 내품명 변환과 구성품을 찾는다',
)
const prefixSuffixOutput = buildInvoiceOutputRows({
  transformedRows: [
    {
      source: commaPrefixSource,
      transformedName: prefixStyle.name,
      status: 'renamed',
      matchedRuleId: commaPrefixProduct.rows[0]!.mapId,
    },
  ],
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: commaPrefixProduct,
  itemTransformation: prefixSuffixItem,
})
const prefixSuffixOrders = prefixSuffixOutput.filter(
  (item) => item.kind === 'order',
)
assert(prefixSuffixOrders.length === 2, '남은 옵션 세트도 구성행을 펼친다')
assert(
  prefixSuffixOrders.every((line) => line.finalItemName === 'Tassel=Purple'),
  '변환된 남은 옵션은 모든 구성행에 복사한다',
)
assert(
  prefixSuffixOrders.every((line) => line.recipientName === '옵션고객'),
  '남은 옵션 세트도 고객정보를 복제한다',
)
const prefixProductStage = buildInvoiceStepSnapshot({
  stage: 'product',
  sourceRows: [commaPrefixSource],
  productTransformation: commaPrefixProduct,
  itemTransformation: commaPrefixItem,
})
assert(
  prefixProductStage[0]?.finalItemName === 'Tassel: Purple' &&
    prefixProductStage[0]?.itemName === 'Tassel: Purple',
  '품목명 단계 스냅샷부터 앞부분을 빼고 남은 옵션을 보여 준다',
)
const combinedPrefixProduct = transformInvoiceProductNames(
  [slashPrefixSource],
  [
    lookupMap(
      'prefix-combined',
      `${prefixProductName} ${prefixLookup}`,
      prefixStyle,
    ),
  ],
  catalogFromStyles([]),
)
assert(
  combinedPrefixProduct.rows[0]?.appliedRule === 'product_item_slash_prefix' &&
    combinedPrefixProduct.rows[0]?.effectiveItemName ===
      slashPrefixSource.itemName,
  '품목명+내품명 / 앞 결합은 내품명 원문을 유지한다',
)
const prefixConflict = transformInvoiceProductNames(
  [commaPrefixSource],
  [
    lookupMap('prefix-conflict-1', prefixLookup, prefixStyle),
    lookupMap(
      'prefix-conflict-2',
      prefixLookup,
      style('s-bp-other', 'M9301', '다른 베파'),
    ),
  ],
  catalogFromStyles([]),
)
assert(
  prefixConflict.rows[0]?.status === 'conflict' &&
    prefixConflict.rows[0]?.effectiveItemName === commaPrefixSource.itemName,
  '같은 앞부분 키가 다른 M번호면 충돌하고 내품명을 소비하지 않는다',
)

const setSource = row({
  rowNumber: 9301,
  productName:
    '[SET] Daily backpack_Black &amp; Strap pouch_Leopard &amp; BB KEYRING SET',
  itemName: 'FREE',
  quantity: '2',
  recipientName: '세트고객',
  recipientPhone: '01011112222',
  recipientAddress: '부산',
  customerOrderNo: 'ORD-SET-1',
})
const keyring = style('s-keyring', 'M6000', 'BB 키링 세트')
const setMap = optionMap({
  id: 'map-set',
  productName: setSource.productName,
  itemName: setSource.itemName,
  displayItemName: '변환 세트 옵션',
  components: [
    component('map-set', bag, 'main'),
    component('map-set', strap, 'included'),
    component('map-set', keyring, 'included', 2),
  ],
})
const setProduct = transformInvoiceProductNames(
  [setSource],
  [lookupMap('pmap-set', setSource.productName, bag)],
  catalogFromStyles([bag, strap, keyring]),
)
const setItem = transformInvoiceItemNames([setSource], [setMap], setProduct.rows)
assert(
  setItem.rows[0]?.status === 'mapped' &&
    setItem.mappedRowCount === 1 &&
    setItem.unresolvedCombos.length === 0,
  '명시적인 변환 내품명만 기준 적용',
)
const setGifts = new Map<number, SabangnetOrderRow[]>([
  [
    9301,
    [
      row({
        rowNumber: 9302,
        productName: '사은품(1) : 파우치',
        itemName: '',
        quantity: '1',
      }),
    ],
  ],
])
const setOutput = buildInvoiceOutputRows({
  transformedRows: setProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: setGifts,
  productTransformation: setProduct,
  itemTransformation: setItem,
})
const setOrders = setOutput.filter((item) => item.kind === 'order')
const setGiftRows = setOutput.filter((item) => item.kind === 'gift')
assert(setOrders.length === 3, '본품+구성 2개가 CJ 3행')
assert(setGiftRows.length === 1, '사은품은 구성행 뒤에 한 번만')
assert(setOutput[3]?.kind === 'gift', '사은품은 세트 블록 뒤')
assert(setOrders[0]?.finalProductName === bag.name, '1행 본품')
assert(setOrders[1]?.finalProductName === strap.name, '2행 스트랩')
assert(setOrders[2]?.finalProductName === keyring.name, '3행 키링')
assert(setOrders[0]?.quantity === '2', '본품 수량=주문수량')
assert(setOrders[1]?.quantity === '2', '구성수량 1은 주문수량만 곱함')
assert(setOrders[2]?.quantity === '4', '구성수량 2는 주문수량과 곱함')
for (const line of setOrders) {
  assert(line.recipientName === '세트고객', '수령인 복제')
  assert(line.recipientPhone === '01011112222', '전화 복제')
  assert(line.recipientAddress === '부산', '주소 복제')
  assert(line.customerOrderNo === 'ORD-SET-1', '주문번호 복제')
  assert(
    line.finalItemName === '변환 세트 옵션',
    '세트 내품명은 변환값 그대로 복사',
  )
}

const productStageSetOutput = buildInvoiceStepSnapshot({
  stage: 'product',
  sourceRows: [setSource],
  productTransformation: setProduct,
  itemTransformation: setItem,
})
assert(
  productStageSetOutput.filter((item) => item.kind === 'order').length === 3,
  '품목명 단계 스냅샷도 본품+구성 2개를 3행으로 펼침',
)
assert(
  productStageSetOutput.every(
    (item) =>
      item.kind !== 'order' ||
      (item.itemName === 'FREE' && item.finalItemName === 'FREE'),
  ),
  '품목명 단계 스냅샷은 구성만 펼치고 내품명은 원문 유지',
)

const plainSource = row({
  rowNumber: 9303,
  productName: product,
  itemName: '',
})
const plainProduct = transformInvoiceProductNames(
  [plainSource],
  [lookupMap('pmap-plain', product, bag)],
  catalogFromStyles([bag]),
)
const plainItem = transformInvoiceItemNames([plainSource], [], plainProduct.rows)
const plainOutput = buildInvoiceOutputRows({
  transformedRows: plainProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: plainProduct,
  itemTransformation: plainItem,
})
assert(plainOutput.length === 1, '일반 상품은 1행 유지')
assert(plainOutput[0]?.finalProductName === bag.name, '일반 상품 품목명')
assert(plainOutput[0]?.finalItemName === '', '빈 내품명은 빈 값 유지')
assert(
  plainItem.rows[0]?.status === 'consumed' &&
    plainItem.rows[0]?.transformedItemName === '' &&
    plainItem.consumedRowCount === 1 &&
    plainItem.unresolvedCombos.length === 0,
  '빈 내품명은 빈칸 통과·검토 제외',
)

const compositionOnlyMap = optionMap({
  id: 'map-set-composition',
  productName: setSource.productName,
  itemName: setSource.itemName,
  components: [
    component('map-set-composition', bag, 'main'),
    component('map-set-composition', strap, 'included'),
    component('map-set-composition', keyring, 'included', 2),
  ],
})
const compositionOnlyItem = transformInvoiceItemNames(
  [setSource],
  [compositionOnlyMap],
  setProduct.rows,
)
assert(
  compositionOnlyItem.rows[0]?.status === 'passthrough' &&
    compositionOnlyItem.rows[0]?.transformedItemName === 'FREE' &&
    compositionOnlyItem.rows[0]?.extras.length === 2 &&
    compositionOnlyItem.mappedRowCount === 0 &&
    compositionOnlyItem.unresolvedCombos.length === 1,
  '구성만 저장된 세트는 원문 유지·검토',
)
const compositionOnlyOutput = buildInvoiceOutputRows({
  transformedRows: setProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: setProduct,
  itemTransformation: compositionOnlyItem,
})
const compositionOnlyOrders = compositionOnlyOutput.filter(
  (item) => item.kind === 'order',
)
assert(compositionOnlyOrders.length === 3, '구성만 있어도 세트 3행 확장')
assert(
  compositionOnlyOrders.every((line) => line.finalItemName === 'FREE'),
  '구성만 있으면 모든 구성행 내품명 원문 유지',
)
const compositionProductStage = buildInvoiceStepSnapshot({
  stage: 'product',
  sourceRows: [setSource],
  productTransformation: setProduct,
  itemTransformation: compositionOnlyItem,
})
assert(
  compositionProductStage.filter((item) => item.kind === 'order').length === 3 &&
    compositionProductStage.every(
      (item) =>
        item.kind !== 'order' ||
        (item.itemName === 'FREE' && item.finalItemName === 'FREE'),
    ),
  '품목명 단계 스냅샷도 구성 펼침과 내품명 원문 유지',
)

const unresolvedOutput = buildInvoiceOutputRows({
  transformedRows: result.rows
    .filter((item) => item.source.rowNumber === 6)
    .map((item) => ({
      source: item.source,
      transformedName: item.transformedName,
      status: 'unmapped_code' as const,
      matchedRuleId: null,
    })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  optionTransformation: {
    ...result,
    rows: result.rows.filter((item) => item.source.rowNumber === 6),
  },
})
assert(unresolvedOutput.length === 1, '미확정은 임의 확장하지 않음')
assert(
  unresolvedOutput[0]?.finalProductName === product,
  '미확정은 원문 품목명',
)

function itemNameRule(options: {
  id: string
  itemName: string
  scope?: InvoiceItemNameRule['scope']
  mainStyle?: StyleRef | null
  productLookupKey?: string
  action: InvoiceItemNameRule['action']
  components?: InvoiceItemNameRuleComponent[]
}): InvoiceItemNameRule {
  const mainStyle = options.mainStyle ?? null
  const productLookupKey = options.productLookupKey ?? ''
  return {
    id: options.id,
    brandId: 'brand',
    scope: options.scope ?? 'global',
    mainStyle,
    itemName: options.itemName,
    normalizedItemName: normalizeInvoiceText(options.itemName),
    productLookupKey,
    normalizedProductLookupKey: normalizeInvoiceText(productLookupKey),
    action: options.action,
    isActive: true,
    note: '',
    components: options.components ?? [],
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
  }
}

function ruleComponent(
  ruleId: string,
  ref: StyleRef,
  role: InvoiceItemNameRuleComponent['role'],
  quantity = 1,
  sortOrder = 0,
): InvoiceItemNameRuleComponent {
  return {
    id: `${ruleId}-${ref.styleId}`,
    ruleId,
    style: ref,
    role,
    quantity,
    sortOrder,
  }
}

const keyringSkipSource = row({
  rowNumber: 9401,
  productName: '다른 품목명',
  itemName: 'KEYRING 추가=선택안함',
  mallName: '스마트스토어',
})
const keyringSkipOther = row({
  rowNumber: 9402,
  productName: '또 다른 품목',
  itemName: 'KEYRING 추가=선택안함',
  mallName: '카카오톡스토어',
})
const keyringSkipProduct = transformInvoiceProductNames(
  [keyringSkipSource, keyringSkipOther],
  [
    lookupMap('pmap-keyring-1', keyringSkipSource.productName, bag),
    lookupMap('pmap-keyring-2', keyringSkipOther.productName, otherBag),
  ],
  catalogFromStyles([bag, otherBag]),
)
const keyringSkipItem = transformInvoiceItemNames(
  [keyringSkipSource, keyringSkipOther],
  [],
  keyringSkipProduct.rows,
  [
    itemNameRule({
      id: 'rule-global-delete',
      itemName: 'KEYRING 추가=선택안함',
      action: 'delete',
    }),
  ],
)
assert(
  keyringSkipItem.rows.every((item) => item.status === 'deleted') &&
    keyringSkipItem.rows.every((item) => item.transformedItemName === '') &&
    keyringSkipItem.deletedRowCount === 2 &&
    keyringSkipItem.unresolvedCombos.length === 0,
  '공통 삭제 규칙은 쇼핑몰·품목명을 보지 않는다',
)

const suffixSource = row({
  rowNumber: 9403,
  productName: '마스마룰즈 베이직파우치 모음전',
  itemName: '파우치 선택: 스파 하트 레오파드 머스터드, 태슬: Black',
})
const suffixProduct = transformInvoiceProductNames(
  [suffixSource],
  [
    lookupMap(
      'pmap-suffix',
      '파우치 선택: 스파 하트 레오파드 머스터드',
      bag,
    ),
  ],
  catalogFromStyles([bag, tassel]),
)
const suffixItem = transformInvoiceItemNames(
  [suffixSource],
  [],
  suffixProduct.rows,
  [
    itemNameRule({
      id: 'rule-suffix-components',
      itemName: '태슬: Black',
      action: 'components',
      components: [ruleComponent('rule-suffix-components', tassel, 'paid_add')],
    }),
  ],
)
assert(
  suffixProduct.rows[0]?.effectiveItemName === '태슬: Black',
  '앞부분 소비 후 suffix가 유효 내품명',
)
assert(
  suffixItem.rows[0]?.status === 'mapped' &&
    suffixItem.rows[0]?.transformedItemName === tassel.name &&
    suffixItem.rows[0]?.extras[0]?.style.styleId === tassel.styleId &&
    suffixItem.rows[0]?.expandableExtras.length === 0,
  '규칙은 남은 suffix를 기준으로 맞추고 CJ 행은 늘리지 않는다',
)

const mainOverrideSource = row({
  rowNumber: 9404,
  productName: '본품별 가방',
  itemName: '추가옵션',
})
const mainOverrideOther = row({
  rowNumber: 9405,
  productName: '다른 본품 가방',
  itemName: '추가옵션',
})
const unconfirmedSource = row({
  rowNumber: 9406,
  productName: '미확정 가방',
  itemName: '추가옵션',
})
const mainOverrideProduct = transformInvoiceProductNames(
  [mainOverrideSource, mainOverrideOther, unconfirmedSource],
  [
    lookupMap('pmap-main-1', mainOverrideSource.productName, bag),
    lookupMap('pmap-main-2', mainOverrideOther.productName, otherBag),
  ],
  catalogFromStyles([bag, otherBag, strap, tassel]),
)
const mainOverrideItem = transformInvoiceItemNames(
  [mainOverrideSource, mainOverrideOther, unconfirmedSource],
  [],
  mainOverrideProduct.rows,
  [
    itemNameRule({
      id: 'rule-global-comp',
      itemName: '추가옵션',
      action: 'components',
      components: [ruleComponent('rule-global-comp', strap, 'included')],
    }),
    itemNameRule({
      id: 'rule-main-comp',
      itemName: '추가옵션',
      scope: 'main_style',
      mainStyle: bag,
      action: 'components',
      components: [
        ruleComponent('rule-main-comp', tassel, 'required', 2, 0),
        ruleComponent('rule-main-comp', strap, 'included', 1, 1),
      ],
    }),
  ],
)
assert(
  mainOverrideItem.rows[0]?.status === 'mapped' &&
    mainOverrideItem.rows[0]?.ruleId === 'rule-main-comp' &&
    mainOverrideItem.rows[0]?.transformedItemName ===
      `${tassel.name}, ${tassel.name}, ${strap.name}`,
  '본품별 규칙이 공통 규칙보다 우선하고 수량만큼 공식명을 나열한다',
)
assert(
  mainOverrideItem.rows[1]?.ruleId === 'rule-global-comp' &&
    mainOverrideItem.rows[1]?.transformedItemName === strap.name,
  '다른 본품은 공통 규칙을 쓴다',
)
assert(
  mainOverrideItem.rows[2]?.status === 'mapped' &&
    mainOverrideItem.rows[2]?.ruleId === 'rule-global-comp' &&
    mainOverrideItem.rows[2]?.productStyle === null,
  '본품 미확정 행에는 본품별 규칙을 쓰지 않고 공통 규칙을 쓴다',
)

const compatSource = row({
  rowNumber: 9407,
  productName: product,
  itemName: '호환옵션',
})
const compatProduct = transformInvoiceProductNames(
  [compatSource],
  [lookupMap('pmap-compat', product, bag)],
  catalogFromStyles([bag, charm]),
)
const compatMap = optionMap({
  id: 'map-compat',
  productName: product,
  itemName: '호환옵션',
  displayItemName: '예전 변환명',
  components: [
    component('map-compat', bag, 'main'),
    component('map-compat', charm, 'paid_add'),
  ],
})
const compatItem = transformInvoiceItemNames(
  [compatSource],
  [compatMap],
  compatProduct.rows,
  [],
)
assert(
  compatItem.rows[0]?.status === 'mapped' &&
    compatItem.rows[0]?.transformedItemName === '예전 변환명' &&
    compatItem.rows[0]?.extras[0]?.style.styleId === charm.styleId,
  '신규 규칙이 없으면 기존 조합 원장을 그대로 쓴다',
)

const mergeSource = row({
  rowNumber: 9408,
  productName: product,
  itemName: '병합옵션',
  quantity: '2',
})
const mergeProduct = transformInvoiceProductNames(
  [mergeSource],
  [lookupMap('pmap-merge', product, bag)],
  catalogFromStyles([bag, strap, tassel, charm]),
)
const mergeMap = optionMap({
  id: 'map-merge',
  productName: product,
  itemName: '병합옵션',
  components: [
    component('map-merge', bag, 'main'),
    component('map-merge', tassel, 'included', 3),
    component('map-merge', charm, 'paid_add'),
  ],
})
const mergeItem = transformInvoiceItemNames(
  [mergeSource],
  [mergeMap],
  mergeProduct.rows,
  [
    itemNameRule({
      id: 'rule-merge',
      itemName: '병합옵션',
      action: 'components',
      components: [ruleComponent('rule-merge', tassel, 'required', 2)],
    }),
  ],
)
assert(
  mergeItem.rows[0]?.transformedItemName ===
      `${tassel.name}, ${tassel.name}` &&
    mergeItem.rows[0]?.extras.map((item) => item.style.styleId).join(',') ===
      `${tassel.styleId},${charm.styleId}` &&
    mergeItem.rows[0]?.extras[0]?.quantity === 2 &&
    mergeItem.rows[0]?.expandableExtras.map((item) => item.style.styleId).join(
      ',',
    ) === `${tassel.styleId},${charm.styleId}` &&
    mergeItem.rows[0]?.expandableExtras[0]?.quantity === 2,
  '같은 M번호 구성품은 한 번만 유지하고 규칙 수량을 쓴다',
)
const mergeOutput = buildInvoiceOutputRows({
  transformedRows: mergeProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: mergeProduct,
  itemTransformation: mergeItem,
})
const mergeOrders = mergeOutput.filter((item) => item.kind === 'order')
assert(mergeOrders.length === 3, '실제 세트에 있는 구성만 CJ 행을 펼친다')
assert(
  mergeOrders.every(
    (line) => line.finalItemName === `${tassel.name}, ${tassel.name}`,
  ),
  '모든 구성행에 같은 최종 내품명을 복사한다',
)
assert(mergeOrders[0]?.finalProductName === bag.name, '1행 본품')
assert(mergeOrders[1]?.finalProductName === tassel.name, '2행 세트 구성품')
assert(mergeOrders[2]?.finalProductName === charm.name, '3행 기존 세트 구성품')
assert(mergeOrders[1]?.quantity === '4', '세트에 겹친 규칙 수량 2 × 주문 2')

const blankStill = transformInvoiceItemNames(
  [row({ rowNumber: 9409, productName: product, itemName: '' })],
  [],
  transformInvoiceProductNames(
    [row({ rowNumber: 9409, productName: product, itemName: '' })],
    [lookupMap('pmap-blank-rule', product, bag)],
    catalogFromStyles([bag]),
  ).rows,
  [
    itemNameRule({
      id: 'rule-blank',
      itemName: '',
      action: 'delete',
    }),
  ],
)
assert(
  blankStill.rows[0]?.status === 'consumed' &&
    blankStill.unresolvedCombos.length === 0 &&
    blankStill.deletedRowCount === 0,
  '처음부터 빈 내품명은 규칙을 보지 않고 검토에서 뺀다',
)

const lookupExactSourceA = row({
  rowNumber: 9410,
  productName: '조회키 A 품목',
  itemName: 'Color: 하트 RB',
})
const lookupExactSourceB = row({
  rowNumber: 9411,
  productName: '조회키 B 품목',
  itemName: 'Color: 하트 RB',
})
const lookupRemapSource = row({
  rowNumber: 9412,
  productName: '조회키 A 품목',
  itemName: 'Color: 하트 RB',
  mallName: '다른몰',
})
const lookupExactProduct = transformInvoiceProductNames(
  [lookupExactSourceA, lookupExactSourceB],
  [
    lookupMap('pmap-lookup-a', '조회키 A 품목', bag),
    lookupMap('pmap-lookup-b', '조회키 B 품목', bag),
  ],
  catalogFromStyles([bag, strap, tassel]),
)
const lookupExactOnly = transformInvoiceItemNames(
  [lookupExactSourceA, lookupExactSourceB],
  [],
  lookupExactProduct.rows,
  [
    itemNameRule({
      id: 'rule-lookup-a-delete',
      itemName: 'Color: 하트 RB',
      scope: 'lookup_key',
      mainStyle: bag,
      productLookupKey: '조회키 A 품목',
      action: 'delete',
    }),
    itemNameRule({
      id: 'rule-lookup-b-comp',
      itemName: 'Color: 하트 RB',
      scope: 'lookup_key',
      mainStyle: bag,
      productLookupKey: '조회키 B 품목',
      action: 'components',
      components: [ruleComponent('rule-lookup-b-comp', strap, 'included')],
    }),
  ],
)
assert(
  lookupExactOnly.rows[0]?.status === 'deleted' &&
    lookupExactOnly.rows[0]?.ruleId === 'rule-lookup-a-delete' &&
    lookupExactOnly.rows[0]?.transformedItemName === '',
  '체크한 조회 키에만 지우기를 적용한다',
)
assert(
  lookupExactOnly.rows[1]?.status === 'mapped' &&
    lookupExactOnly.rows[1]?.ruleId === 'rule-lookup-b-comp' &&
    lookupExactOnly.rows[1]?.transformedItemName === strap.name,
  '다른 조회 키는 따로 구성품 규칙을 적용한다',
)

const lookupKeepOther = transformInvoiceItemNames(
  [lookupExactSourceA, lookupExactSourceB],
  [],
  lookupExactProduct.rows,
  [
    itemNameRule({
      id: 'rule-lookup-a-only',
      itemName: 'Color: 하트 RB',
      scope: 'lookup_key',
      mainStyle: bag,
      productLookupKey: '조회키 A 품목',
      action: 'delete',
    }),
  ],
)
assert(
  lookupKeepOther.rows[1]?.status === 'passthrough' &&
    lookupKeepOther.rows[1]?.transformedItemName === 'Color: 하트 RB' &&
    lookupKeepOther.rows[1]?.ruleId === null,
  '체크하지 않은 조회 키는 원문을 유지한다',
)

const lookupPriority = transformInvoiceItemNames(
  [lookupExactSourceA, lookupExactSourceB],
  [],
  lookupExactProduct.rows,
  [
    itemNameRule({
      id: 'rule-lookup-priority',
      itemName: 'Color: 하트 RB',
      scope: 'lookup_key',
      mainStyle: bag,
      productLookupKey: '조회키 A 품목',
      action: 'delete',
    }),
    itemNameRule({
      id: 'rule-main-priority',
      itemName: 'Color: 하트 RB',
      scope: 'main_style',
      mainStyle: bag,
      action: 'components',
      components: [ruleComponent('rule-main-priority', strap, 'included')],
    }),
    itemNameRule({
      id: 'rule-global-priority',
      itemName: 'Color: 하트 RB',
      action: 'components',
      components: [ruleComponent('rule-global-priority', tassel, 'paid_add')],
    }),
  ],
)
assert(
  lookupPriority.rows[0]?.ruleId === 'rule-lookup-priority',
  '조회 키 exact가 기존 본품 전체·공통보다 우선한다',
)
assert(
  lookupPriority.rows[1]?.ruleId === 'rule-main-priority' &&
    lookupPriority.rows[1]?.transformedItemName === strap.name,
  '다른 조회 키는 기존 본품 전체 규칙으로 넘어간다',
)

const lookupRemapProduct = transformInvoiceProductNames(
  [lookupRemapSource],
  [lookupMap('pmap-lookup-remap', '조회키 A 품목', otherBag)],
  catalogFromStyles([bag, otherBag]),
)
const lookupRemapItem = transformInvoiceItemNames(
  [lookupRemapSource],
  [],
  lookupRemapProduct.rows,
  [
    itemNameRule({
      id: 'rule-lookup-old-main',
      itemName: 'Color: 하트 RB',
      scope: 'lookup_key',
      mainStyle: bag,
      productLookupKey: '조회키 A 품목',
      action: 'delete',
    }),
  ],
)
assert(
  lookupRemapItem.rows[0]?.status === 'passthrough' &&
    lookupRemapItem.rows[0]?.ruleId === null &&
    lookupRemapItem.rows[0]?.transformedItemName === 'Color: 하트 RB',
  '같은 조회 키가 다른 본품으로 재연결되면 규칙을 적용하지 않는다',
)

function productExclusion(options: {
  id?: string
  mallName?: string
  productName: string
  itemName: string
  isActive?: boolean
}): InvoiceProductNameExclusion {
  const mallName = options.mallName ?? '테스트몰'
  return {
    id: options.id ?? 'ex-1',
    brandId: 'brand',
    mallName,
    normalizedMallName: normalizeInvoiceText(mallName),
    productName: options.productName,
    normalizedProductName: normalizeInvoiceText(options.productName),
    itemName: options.itemName,
    normalizedItemName: normalizeInvoiceText(options.itemName),
    isActive: options.isActive ?? true,
    note: '',
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
  }
}

const dummyName = '선택안함'
const dummyItem = '선택안함'
const dummyExclusion = productExclusion({
  productName: dummyName,
  itemName: dummyItem,
})
const dummyMainMap = lookupMap('pmap-dummy-main', product, bag)
const dummySiblingMain = row({
  rowNumber: 9601,
  productName: product,
  itemName: '',
  customerOrderNo: 'ORD-DUMMY-1',
})
const dummySiblingRow = row({
  rowNumber: 9602,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: 'ORD-DUMMY-1',
  ownProductCode: 'SB-DUMMY-1',
})
const dummySiblingProduct = transformInvoiceProductNames(
  [dummySiblingMain, dummySiblingRow],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  dummySiblingProduct.rows[0]?.status === 'mapped' &&
    dummySiblingProduct.rows[1]?.status === 'excluded' &&
    dummySiblingProduct.excludedRowCount === 1 &&
    dummySiblingProduct.unresolvedCombos.every(
      (combo) => combo.productName !== dummyName,
    ),
  '정확 조합과 정상 형제 행이 있으면 더미 행만 상품 연결 예외',
)
const dummyUnruledItemNames = transformInvoiceItemNames(
  [dummySiblingMain, dummySiblingRow],
  [],
  dummySiblingProduct.rows,
  [],
)
assert(
  dummyUnruledItemNames.unresolvedCombos[0]?.productConnectionExcluded ===
    true &&
    collectItemNameAiGroups(dummyUnruledItemNames.unresolvedCombos)
      .flatMap((group) => group.contexts)
      .some((context) => context.productConnectionExcluded),
  '상품 연결 예외의 미설정 내품명은 공통 규칙 저장 가능 문맥을 유지한다',
)
const dummyDeleteRule = itemNameRule({
  id: 'rule-dummy-delete',
  itemName: dummyItem,
  action: 'delete',
})
const dummyItemNames = transformInvoiceItemNames(
  [dummySiblingMain, dummySiblingRow],
  [],
  dummySiblingProduct.rows,
  [dummyDeleteRule],
)
const dummyDeletedItem = dummyItemNames.rows.find(
  (item) => item.source.rowNumber === 9602,
)
assert(
  dummyDeletedItem?.status === 'deleted' &&
    dummyDeletedItem.ruleId === dummyDeleteRule.id &&
    dummyDeletedItem.productStyle === null &&
    dummyDeletedItem.transformedItemName === '',
  '상품 연결 예외 행도 일반 내품명 비움 규칙을 적용한다',
)

const dummyGiftMain = row({
  rowNumber: 9603,
  productName: '사은품',
  customerOrderNo: 'ORD-DUMMY-1',
})
const dummyGiftExcluded = row({
  rowNumber: 9604,
  productName: '더미 사은품',
  customerOrderNo: 'ORD-DUMMY-1',
})
const dummySiblingOutput = buildInvoiceOutputRows({
  transformedRows: productNameTransformationToName(dummySiblingProduct).rows,
  workMatches: new Map(),
  giftRowsBySource: new Map([
    [9601, [dummyGiftMain]],
    [9602, [dummyGiftExcluded]],
  ]),
  productTransformation: dummySiblingProduct,
  itemTransformation: dummyItemNames,
})
assert(
  dummySiblingOutput.length === 3 &&
    dummySiblingOutput[0]?.sourceRowNumber === 9601 &&
    dummySiblingOutput[0]?.rowNumber === 1 &&
    dummySiblingOutput[0]?.kind === 'order' &&
    dummySiblingOutput[1]?.kind === 'gift' &&
    dummySiblingOutput[1]?.finalProductName === '사은품(1) : 사은품' &&
    dummySiblingOutput[2]?.sourceRowNumber === 9602 &&
    dummySiblingOutput[2]?.kind === 'order' &&
    dummySiblingOutput[2]?.finalProductName === dummyName &&
    dummySiblingOutput[2]?.finalItemName === '' &&
    dummySiblingOutput[2]?.ownProductCode === 'SB-DUMMY-1' &&
    dummySiblingOutput[2]?.quantity === '1' &&
    dummySiblingOutput.every(
      (item) =>
        item.kind !== 'gift' ||
        item.finalProductName === '사은품(1) : 사은품',
    ),
  '상품 연결 예외 행은 CJ 원문 품목명·자체품번코드를 남기고 내품명 비움만 적용한다',
)

const dummySolo = row({
  rowNumber: 9610,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: 'ORD-SOLO',
})
const dummySoloProduct = transformInvoiceProductNames(
  [dummySolo],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  dummySoloProduct.rows[0]?.status === 'exclusion_guarded' &&
    dummySoloProduct.rows[0]?.transformedProductName === dummyName &&
    dummySoloProduct.exclusionGuardedRowCount === 1 &&
    dummySoloProduct.unresolvedCombos.some(
      (combo) => combo.status === 'exclusion_guarded',
    ),
  '단독 더미 행은 제외 보류로 원문을 유지하고 검토에 남긴다',
)
const dummySoloOutput = buildInvoiceOutputRows({
  transformedRows: productNameTransformationToName(dummySoloProduct).rows,
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: dummySoloProduct,
})
assert(
  dummySoloOutput.length === 1 &&
    dummySoloOutput[0]?.finalProductName === dummyName &&
    dummySoloOutput[0]?.finalItemName === dummyItem,
  '제외 보류 행은 최종 송장에서 빼지 않는다',
)

const dummyOtherMall = row({
  rowNumber: 9620,
  productName: dummyName,
  itemName: dummyItem,
  mallName: '다른몰',
  customerOrderNo: 'ORD-OTHER',
})
const dummyOtherMain = row({
  rowNumber: 9621,
  productName: product,
  itemName: '',
  mallName: '다른몰',
  customerOrderNo: 'ORD-OTHER',
})
const dummyOtherProduct = transformInvoiceProductNames(
  [dummyOtherMain, dummyOtherMall],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  dummyOtherProduct.rows[1]?.status !== 'excluded' &&
    dummyOtherProduct.rows[1]?.status !== 'exclusion_guarded',
  '다른 쇼핑몰의 같은 품목명·내품명은 제외하지 않는다',
)

const dummyRealItem = row({
  rowNumber: 9630,
  productName: dummyName,
  itemName: product,
  customerOrderNo: 'ORD-REAL',
})
const dummyRealSibling = row({
  rowNumber: 9631,
  productName: product,
  itemName: '',
  customerOrderNo: 'ORD-REAL',
})
const dummyRealProduct = transformInvoiceProductNames(
  [dummyRealSibling, dummyRealItem],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  dummyRealProduct.rows[1]?.status === 'mapped' &&
    dummyRealProduct.rows[1]?.transformedProductName === bag.name,
  '내품명이 실제 상품명이면 제외 조합이 달라이므로 본품 탐색을 유지한다',
)

const dummyNoOrder = row({
  rowNumber: 9640,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: '',
})
const dummyNoOrderSibling = row({
  rowNumber: 9641,
  productName: product,
  itemName: '',
  customerOrderNo: '',
})
const dummyNoOrderProduct = transformInvoiceProductNames(
  [dummyNoOrderSibling, dummyNoOrder],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  dummyNoOrderProduct.rows[1]?.status === 'excluded',
  '고객주문번호가 없어도 같은 배송정보·주문시각의 본품이 있으면 제외한다',
)

const splitMain = row({
  rowNumber: 9801,
  productName: product,
  itemName: '',
  customerOrderNo: '2145655974',
  recipientName: '김별(정현아)',
  recipientPhone: '0502-2880-5815',
  recipientAddress: '서울특별시 노원구',
  orderedAt: '2026-08-16 18:52',
})
const splitDummy = row({
  rowNumber: 9802,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: '2145655975',
  recipientName: '김별(정현아)',
  recipientPhone: '0502-2880-5815',
  recipientAddress: '서울특별시 노원구',
  orderedAt: '2026-08-16 18:52',
  ownProductCode: 'SB-SPLIT-DUMMY',
})
const splitProduct = transformInvoiceProductNames(
  [splitMain, splitDummy],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
const splitPreview = previewProductNameExclusion(splitProduct.rows, {
  mallName: '테스트몰',
  productName: dummyName,
  itemName: dummyItem,
})
const splitScan = collectProductNameComboOrders(splitProduct.rows, {
  productName: dummyName,
})
const splitOutput = buildInvoiceOutputRows({
  transformedRows: productNameTransformationToName(splitProduct).rows,
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: splitProduct,
})
assert(
  splitProduct.rows[0]?.status === 'mapped' &&
    splitProduct.rows[1]?.status === 'excluded' &&
    splitPreview.excludedCount === 1 &&
    splitPreview.guardedCount === 0 &&
    splitScan.soloCount === 0 &&
    splitOutput.length === 2 &&
    splitOutput[0]?.sourceRowNumber === 9801 &&
    splitOutput[1]?.sourceRowNumber === 9802 &&
    splitOutput[1]?.finalProductName === dummyName &&
    splitOutput[1]?.ownProductCode === 'SB-SPLIT-DUMMY',
  '고객주문번호가 달라도 배송정보·주문시각이 같은 본품이 있으면 상품 연결 예외로 두고 CJ 원문은 남긴다',
)

const mismatchDummy = row({
  rowNumber: 9812,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: '2145655999',
  recipientName: '김별(정현아)',
  recipientPhone: '0502-2880-5815',
  recipientAddress: '다른 주소',
  orderedAt: '2026-08-16 18:52',
})
const mismatchProduct = transformInvoiceProductNames(
  [splitMain, mismatchDummy],
  [dummyMainMap],
  catalogFromStyles([bag]),
  [],
  [dummyExclusion],
)
assert(
  mismatchProduct.rows[1]?.status === 'exclusion_guarded',
  '주소가 다르면 다른 주문번호 더미를 제외 보류로 남긴다',
)

const noRuleDummy = row({
  rowNumber: 9822,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: '2145655888',
  recipientName: '김별(정현아)',
  recipientPhone: '0502-2880-5815',
  recipientAddress: '서울특별시 노원구',
  orderedAt: '2026-08-16 18:52',
})
const noRuleProduct = transformInvoiceProductNames(
  [splitMain, noRuleDummy],
  [dummyMainMap],
  catalogFromStyles([bag]),
)
assert(
  noRuleProduct.rows[1]?.status !== 'excluded' &&
    noRuleProduct.rows[1]?.status !== 'exclusion_guarded',
  '송장 제외 규칙이 없으면 배송정보가 같아도 자동 제외하지 않는다',
)

const soloSafeMain = row({
  rowNumber: 9701,
  productName: product,
  itemName: '',
  customerOrderNo: 'ORD-SAFE',
})
const soloSafeDummy = row({
  rowNumber: 9702,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: 'ORD-SAFE',
})
const soloNoOrderDummy = row({
  rowNumber: 9703,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: '',
  recipientName: '주문번호없음',
  recipientPhone: '01011111111',
  recipientAddress: '부산',
})
const soloOrphanDummy = row({
  rowNumber: 9704,
  productName: dummyName,
  itemName: dummyItem,
  customerOrderNo: 'ORD-ORPHAN',
  recipientName: '단독수신',
  recipientPhone: '01022222222',
  recipientAddress: '대전',
})
const soloScanProduct = transformInvoiceProductNames(
  [soloSafeMain, soloSafeDummy, soloNoOrderDummy, soloOrphanDummy],
  [dummyMainMap],
  catalogFromStyles([bag]),
)
const soloScan = collectProductNameComboOrders(soloScanProduct.rows, {
  productName: dummyName,
})
assert(
  soloScan.orders.length === 3 &&
    soloScan.soloCount === 2 &&
    soloScan.orders[0]?.source.rowNumber === 9703 &&
    soloScan.orders[0]?.soloReason === 'no_order_no' &&
    soloScan.orders[1]?.source.rowNumber === 9704 &&
    soloScan.orders[1]?.soloReason === 'no_confirmed_sibling' &&
    soloScan.orders[2]?.source.rowNumber === 9702 &&
    soloScan.orders[2]?.soloReason === null,
  '형제 본품이 있는 더미는 안전하고 주문번호 없음·단독 주문은 따로 표시한다',
)

const dummyOutgoing = buildOutgoingComponentRowsFromStages({
  productRows: dummySiblingProduct.rows,
  itemRows: dummyItemNames.rows,
  giftRowsBySource: new Map(),
})
assert(
  dummyOutgoing.every((item) => item.sourceRowNumber !== 9602),
  '출고구성도 상품 연결 예외 행을 빼 둔다',
)
const dummyReconnectMap = optionMap({
  id: 'map-dummy-reconnect',
  productName: dummyName,
  itemName: dummyItem,
  mallName: '테스트몰',
  components: [
    component('map-dummy-reconnect', bag, 'main'),
    component('map-dummy-reconnect', tassel, 'included'),
  ],
})
const dummyNoReconnectItem = transformInvoiceItemNames(
  [dummySiblingMain, dummySiblingRow],
  [dummyReconnectMap],
  dummySiblingProduct.rows,
  [dummyDeleteRule],
)
const dummyNoReconnectRow = dummyNoReconnectItem.rows.find(
  (item) => item.source.rowNumber === 9602,
)
assert(
  dummyNoReconnectRow?.status === 'deleted' &&
    dummyNoReconnectRow.mapId === null &&
    dummyNoReconnectRow.productStyle === null &&
    dummyNoReconnectRow.extras.length === 0,
  '상품 연결 예외 행은 내품명 규칙을 적용해도 세트 기준으로 본품을 다시 연결하지 않는다',
)
const dummySetOutput = buildInvoiceOutputRows({
  transformedRows: productNameTransformationToName(dummySiblingProduct).rows,
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: dummySiblingProduct,
  optionTransformation: {
    rows: [
      {
        source: dummySiblingRow,
        status: 'mapped',
        mapId: 'map-dummy-set',
        main: bag,
        extras: [component('map-dummy-set', tassel, 'included')],
        transformedName: bag.name,
        transformedItemName: dummyItem,
        codeHintName: null,
      },
    ],
    mappedRowCount: 1,
    codeFallbackRowCount: 0,
    exceptionRowCount: 0,
    conflictRowCount: 0,
    unresolvedRowCount: 0,
    unresolvedCombos: [],
  },
})
const dummySetPassthrough = dummySetOutput.find(
  (item) => item.sourceRowNumber === 9602,
)
assert(
  dummySetPassthrough?.finalProductName === dummyName &&
    dummySetOutput.filter((item) => item.sourceRowNumber === 9602).length === 1,
  '상품 연결 예외 행은 세트 구성이 있어도 CJ에서 펼치지 않는다',
)

const importMain = style('s-imp-main', 'M0885', '래빗에코백 하트')
const importExtraA = style('s-imp-a', 'M1999', '스파 트리플 블루테슬')
const importExtraB = style('s-imp-b', 'M2000', '래빗 스트랩')
const importLookup = {
  byStyleNo: new Map<string, StyleRef>([
    ['m0885', importMain],
    ['m1999', importExtraA],
    ['m2000', importExtraB],
  ]),
}
const IMPORT_HEADERS = [
  '확정 본품 M번호',
  '조회 키',
  '옵션명',
  '조회 키 선택',
  '지우기',
  '구성품 M번호',
  '메모',
  '대상 행',
]

const importStyleNos = collectInvoiceItemNameRuleStyleNos([
  IMPORT_HEADERS,
  ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999,M2000', '', '3'],
])
assert(
  importStyleNos.includes('M0885') &&
    importStyleNos.includes('M1999') &&
    importStyleNos.includes('M2000'),
  '내품명 원장 엑셀은 본품·구성품 M번호를 모두 대조 후보로 모은다',
)

const importQuantity = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    [
      'M0885',
      '단독 래빗 모브블루',
      'Color: 모브블루',
      'Y',
      '',
      'M1999,M1999,M2000',
      '메모',
      '104',
    ],
  ],
  importLookup,
)
assert(importQuantity.length === 1, '한 행은 규칙 한 건이 된다')
assert(importQuantity[0]?.status === 'new', '기존 규칙이 없으면 신규다')
assert(
  importQuantity[0]?.components.find(
    (item) => item.style.styleNo === 'M1999',
  )?.quantity === 2,
  '같은 M번호를 두 번 쓰면 수량 2가 된다',
)
assert(
  importQuantity[0]?.components.find(
    (item) => item.style.styleNo === 'M2000',
  )?.quantity === 1,
  '한 번만 쓴 M번호는 수량 1이다',
)
assert(
  importQuantity[0]?.input?.components?.every(
    (item) => item.role === 'included',
  ) === true,
  '엑셀로 올린 구성품은 모두 기본포함으로 저장한다',
)

const importMerged = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999', '', ''],
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999,M2000', '', ''],
  ],
  importLookup,
)
assert(importMerged.length === 1, '같은 규칙 키의 여러 행은 한 규칙으로 합친다')
assert(
  importMerged[0]?.components.find((item) => item.style.styleNo === 'M1999')
    ?.quantity === 2,
  '행을 나눠 쓴 같은 M번호도 수량으로 합친다',
)

const importConflict = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999', '', ''],
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', 'Y', '', '', ''],
  ],
  importLookup,
)
assert(
  importConflict.some((item) => item.status === 'error'),
  '같은 규칙에 지우기와 구성품이 섞이면 오류로 막는다',
)

const importSkipped = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', '', '', '104'],
  ],
  importLookup,
)
assert(
  importSkipped[0]?.status === 'skip' && importSkipped[0]?.input === null,
  '지우기와 구성품을 모두 비운 행은 오류가 아니라 안 정한 행으로 건너뛴다',
)

const importMissing = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M9999', '', ''],
    ['', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999', '', ''],
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', 'Y', 'M1999', '', ''],
  ],
  importLookup,
)
assert(
  importMissing.length === 3 &&
    importMissing.every((item) => item.status === 'error'),
  '미등록 M번호·조회 키 선택인데 본품 누락·지우기와 구성품 동시 기입은 모두 오류다',
)

const importGlobalDelete = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'KEYRING=선택안함', '', 'Y', '', '', '12'],
  ],
  importLookup,
)
assert(
  importGlobalDelete[0]?.status === 'new' &&
    importGlobalDelete[0]?.input?.scope === 'global' &&
    importGlobalDelete[0]?.input?.action === 'delete' &&
    importGlobalDelete[0]?.input?.mainStyleId === null &&
    importGlobalDelete[0]?.input?.productLookupKey === null,
  '조회 키 선택을 비우면 남아 있는 본품·조회 키를 무시하고 공통 규칙으로 저장한다',
)

const importExistingRule = itemNameRule({
  id: 'rule-import',
  scope: 'lookup_key',
  mainStyle: importMain,
  productLookupKey: '단독 래빗 모브블루',
  itemName: 'Color: 모브블루',
  action: 'components',
})
importExistingRule.components = [
  ruleComponent('rule-import', importExtraA, 'included', 2),
]
const importUnchanged = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독  래빗 모브블루', 'color: 모브블루', 'y', '', 'M1999,M1999', '', ''],
  ],
  importLookup,
  [importExistingRule],
)
assert(
  importUnchanged[0]?.status === 'unchanged' && importUnchanged[0]?.input === null,
  '같은 내용이면 변화없음으로 두고 저장하지 않는다',
)

const importOverwrite = prepareInvoiceItemNameRuleRows(
  [
    IMPORT_HEADERS,
    ['M0885', '단독 래빗 모브블루', 'Color: 모브블루', 'Y', '', 'M1999,M2000', '', ''],
  ],
  importLookup,
  [importExistingRule],
)
assert(
  importOverwrite[0]?.status === 'overwrite' &&
    importOverwrite[0]?.existingRuleId === 'rule-import',
  '내용이 다르면 기존 규칙 id로 덮어쓴다',
)

const accessoryDict = accessoryRulesFromSeeds(
  INVOICE_ACCESSORY_SEED_DRAFTS,
  ACCESSORY_STYLE_FIXTURES,
)
const accessoryByName = accessoryStyleNameIndex(ACCESSORY_STYLE_FIXTURES)
const accessoryByNo = new Map(
  ACCESSORY_STYLE_FIXTURES.map((item) => [item.styleNo, item]),
)
for (const item of ACCESSORY_RESOLVE_CASES) {
  const resolved = resolveInvoiceAccessories({
    itemName: item.itemName,
    productLookupKey: item.productLookupKey,
    mainStyle: item.mainStyleNo
      ? (accessoryByNo.get(item.mainStyleNo) ?? null)
      : null,
    dictionary: accessoryDict,
    styleByName: accessoryByName,
  })
  const got = resolved.components.flatMap((component) =>
    Array.from({ length: component.quantity }, () => component.style.styleNo),
  )
  const want = [...item.expectStyleNos].sort()
  const have = [...got].sort()
  assert(
    want.length === have.length && want.every((value, index) => value === have[index]),
    `${item.id} 구성품 ${want.join(',') || '(없음)'} 이어야 하는데 ${have.join(',') || '(없음)'}`,
  )
  assert(
    item.expectUnknown ? resolved.unknown.length > 0 : resolved.unknown.length === 0,
    `${item.id} unknown ${item.expectUnknown ? '있어야' : '없어야'} 함: ${resolved.unknown.join(' / ')}`,
  )
}

const emptyAccessoryDictionary = transformInvoiceItemNames(
  [
    row({
      rowNumber: 9700,
      productName: '드롭 숄더백',
      itemName: '스텔라 글러브 홀더 키링',
    }),
  ],
  [],
  [],
  [],
  [],
  ACCESSORY_STYLE_FIXTURES,
)
assert(
  emptyAccessoryDictionary.rows[0]?.status === 'passthrough' &&
    emptyAccessoryDictionary.unresolvedCombos[0]?.unknownPieces.includes(
      '스텔라 글러브 홀더 키링',
    ),
  '사전이 비어 있어도 첫 AI 추천용 미인식 조각을 수집한다',
)

const accessoryMapped = transformInvoiceItemNames(
  [row({ rowNumber: 9701, productName: 'Strap pouch 하트', itemName: '태슬: Red' })],
  [],
  [],
  [],
  accessoryDict,
  ACCESSORY_STYLE_FIXTURES,
)
assert(
  accessoryMapped.rows[0]?.status === 'mapped' &&
    accessoryMapped.autoComponentsRowCount === 1 &&
    accessoryMapped.rows[0]?.resolvedBy === 'dictionary' &&
    accessoryMapped.rows[0]?.extras[0]?.style.styleNo === 'M0983' &&
    accessoryMapped.rows[0]?.expandableExtras.length === 0,
  '사전이 태슬 라벨을 구성품으로 바꾸고 CJ 행은 늘리지 않는다',
)

const accessoryDeleted = transformInvoiceItemNames(
  [
    row({
      rowNumber: 9702,
      productName: 'T-Shirt_Black',
      itemName: '[COLOR]BLACK [SIZE]ONE SIZE (F)',
    }),
  ],
  [],
  [],
  [],
  accessoryDict,
  ACCESSORY_STYLE_FIXTURES,
)
assert(
  accessoryDeleted.rows[0]?.status === 'deleted' &&
    accessoryDeleted.autoDeletedRowCount === 1,
  '색상·사이즈만 있으면 사전으로 내품명을 비운다',
)

const accessoryUnknown = transformInvoiceItemNames(
  [
    row({
      rowNumber: 9703,
      productName: '드롭 숄더백',
      itemName: '스텔라 글러브 홀더 키링',
    }),
  ],
  [],
  [],
  [],
  accessoryDict,
  ACCESSORY_STYLE_FIXTURES,
)
assert(
  accessoryUnknown.rows[0]?.status === 'passthrough' &&
    accessoryUnknown.unresolvedCombos[0]?.unknownPieces.length,
  '사전에 없는 조각은 검토로 남긴다',
)

const accessoryManualFirst = transformInvoiceItemNames(
  [row({ rowNumber: 9704, productName: 'Strap pouch 하트', itemName: '태슬: Red' })],
  [],
  [],
  [
    itemNameRule({
      id: 'rule-manual-first',
      itemName: '태슬: Red',
      action: 'delete',
    }),
  ],
  accessoryDict,
  ACCESSORY_STYLE_FIXTURES,
)
assert(
  accessoryManualFirst.rows[0]?.status === 'deleted' &&
    accessoryManualFirst.rows[0]?.resolvedBy === 'rule' &&
    accessoryManualFirst.autoDeletedRowCount === 0,
  '사람이 박은 규칙이 사전보다 우선한다',
)

const stella = accessoryByNo.get('M0998')!
const stellaDraft = evaluateAccessorySuggestion(
  {
    ruleType: 'token',
    pattern: '스텔라 글러브 홀더 키링',
    accessoryKind: '',
    namePrefix: '',
    colorName: '',
    targetStyle: stella,
    confidence: 0.9,
    reason: '키링',
  },
  accessoryDict,
  [
    {
      itemName: '스텔라 글러브 홀더 키링',
      productLookupKey: '드롭 숄더백',
      mainStyle: accessoryByNo.get('M0048') ?? null,
      unknownPieces: ['스텔라 글러브 홀더 키링'],
      rowCount: 2,
    },
  ],
  ACCESSORY_STYLE_FIXTURES,
  new Set([stella.styleId]),
)
assert(
  stellaDraft.ok && stellaDraft.unknownAfter < stellaDraft.unknownBefore,
  'AI 후보를 넣으면 모르는 조각이 줄어야 한다',
)

const hallucinatedDraft = evaluateAccessorySuggestion(
  {
    ruleType: 'token',
    pattern: '없는 키링',
    accessoryKind: '',
    namePrefix: '',
    colorName: '',
    targetStyle: { styleId: 'invented', styleNo: 'M9999', name: '없는 상품' },
    confidence: 0.99,
    reason: '환각',
  },
  accessoryDict,
  [
    {
      itemName: '없는 키링',
      productLookupKey: '드롭 숄더백',
      mainStyle: accessoryByNo.get('M0048') ?? null,
      unknownPieces: ['없는 키링'],
      rowCount: 1,
    },
  ],
  ACCESSORY_STYLE_FIXTURES,
  new Set([stella.styleId]),
)
assert(
  !hallucinatedDraft.ok && hallucinatedDraft.holdReason === 'invalid_style',
  '허용 후보 밖 M번호는 보류한다',
)

assert(isUnsafeGlobalToken('Pink'), '단색 단어 Pink는 전역 토큰으로 위험하다')
assert(isUnsafeGlobalToken('핑크'), '단색 단어 핑크는 전역 토큰으로 위험하다')
assert(
  !isUnsafeGlobalToken('스텔라 글러브 홀더 키링'),
  '긴 고유 문구는 전역 토큰으로 쓸 수 있다',
)

const pinkContexts = [
  {
    itemName: 'Tassel 1=Pink',
    productLookupKey: 'Strap pouch 하트',
    mainStyle: accessoryByNo.get('M2276') ?? null,
    unknownPieces: ['Tassel 1=Pink'],
    rowCount: 3,
  },
  {
    itemName: 'Pink',
    productLookupKey: '8 pocket cross bag black',
    mainStyle: accessoryByNo.get('M0088') ?? null,
    unknownPieces: ['Pink (종류를 모름)'],
    rowCount: 2,
  },
]
const pinkToken = evaluateAccessorySuggestion(
  {
    ruleType: 'token',
    pattern: 'Pink',
    accessoryKind: '',
    namePrefix: '',
    colorName: '',
    targetStyle: accessoryByNo.get('M0992') ?? null,
    confidence: 0.92,
    reason: '태슬 핑크',
  },
  accessoryDict,
  pinkContexts,
  ACCESSORY_STYLE_FIXTURES,
  new Set(['s-m0992', 's-m0350']),
)
assert(
  !pinkToken.ok && pinkToken.holdReason === 'unsafe_global',
  '같은 Pink를 전역 토큰으로 두면 보류한다',
)

const pinkColor = evaluateAccessorySuggestion(
  {
    ruleType: 'color',
    pattern: 'Pink',
    accessoryKind: '',
    namePrefix: '',
    colorName: '핑크',
    targetStyle: null,
    confidence: 0.88,
    reason: '색상 별칭',
  },
  accessoryDict.filter(
    (rule) =>
      !(rule.ruleType === 'color' && rule.normalizedPattern === 'pink'),
  ),
  [
    {
      itemName: '태슬: Pink',
      productLookupKey: 'Strap pouch 하트',
      mainStyle: accessoryByNo.get('M2276') ?? null,
      unknownPieces: ['태슬: Pink'],
      rowCount: 1,
    },
    {
      itemName: '태슬: Pink',
      productLookupKey: 'Strap pouch 다른색',
      mainStyle: accessoryByNo.get('M2276') ?? null,
      unknownPieces: ['태슬: Pink'],
      rowCount: 1,
    },
  ],
  ACCESSORY_STYLE_FIXTURES,
  new Set(['s-m0992']),
)
assert(
  pinkColor.ok && !pinkColor.safety.unsafeGlobal,
  '모든 문맥에서 같은 색상 별칭은 전역으로 허용한다',
)

const cleanRegression = evaluateAccessorySuggestion(
  {
    ruleType: 'token',
    pattern: 'PEARL RIBBON KEYRING',
    accessoryKind: '',
    namePrefix: '',
    colorName: '',
    targetStyle: accessoryByNo.get('M0998') ?? null,
    confidence: 0.9,
    reason: '키링',
  },
  accessoryDict,
  [
    {
      itemName: 'KEYRING 추가: PEARL RIBBON KEYRING',
      productLookupKey: 'PEARL RIBBON KEYRING',
      mainStyle: accessoryByNo.get('M0998') ?? null,
      unknownPieces: [],
      rowCount: 1,
    },
  ],
  ACCESSORY_STYLE_FIXTURES,
  new Set(['s-m0998']),
)
assert(
  !cleanRegression.ok,
  '이미 깨끗한 문맥에 구성품을 더하면 보류한다',
)

const pinkLookupDrafts = buildLookupKeyDraftsFromDecisions({
  contexts: pinkContexts,
  dictionary: accessoryDict,
  styles: ACCESSORY_STYLE_FIXTURES,
  itemNameRules: [],
  decisions: [
    {
      contextId: accessoryContextId(pinkContexts[0]!),
      action: 'components',
      components: [
        {
          styleId: 's-m0992',
          styleNo: 'M0992',
          name: '태슬 - 핑크',
          quantity: 1,
        },
      ],
      reason: '파우치 태슬',
    },
    {
      contextId: accessoryContextId(pinkContexts[1]!),
      action: 'components',
      components: [
        {
          styleId: 's-m0350',
          styleNo: 'M0350',
          name: '숄더스트랩 - 그린',
          quantity: 1,
        },
      ],
      reason: '크로스백 스트랩',
    },
  ],
  fallbackAllowed: new Set(['s-m0992', 's-m0350']),
  reason: '문맥 분리',
  confidence: 0.9,
})
assert(pinkLookupDrafts.length === 2, '문맥이 다르면 조회 키 초안을 나눈다')
assert(
  pinkLookupDrafts[0]?.components[0]?.style.styleNo !==
    pinkLookupDrafts[1]?.components[0]?.style.styleNo,
  '같은 Pink라도 조회 키마다 다른 M번호를 초안으로 둔다',
)

const existingLookup = itemNameRule({
  id: 'rule-pink-existing',
  itemName: 'Tassel 1=Pink',
  scope: 'lookup_key',
  mainStyle: accessoryByNo.get('M2276') ?? null,
  productLookupKey: 'Strap pouch 하트',
  action: 'components',
  components: [
    ruleComponent('rule-pink-existing', accessoryByNo.get('M0992')!, 'included'),
  ],
})
const overwriteDrafts = buildLookupKeyDraftsFromDecisions({
  contexts: [pinkContexts[0]!],
  dictionary: accessoryDict,
  styles: ACCESSORY_STYLE_FIXTURES,
  itemNameRules: [existingLookup],
  decisions: [
    {
      contextId: accessoryContextId(pinkContexts[0]!),
      action: 'components',
      components: [
        {
          styleId: 's-m0992',
          styleNo: 'M0992',
          name: '태슬 - 핑크',
          quantity: 1,
        },
      ],
      reason: '덮어쓰기',
    },
  ],
  fallbackAllowed: new Set(['s-m0992']),
  reason: '덮어쓰기',
  confidence: 0.8,
})
assert(
  overwriteDrafts[0]?.existingRuleId === 'rule-pink-existing',
  '같은 조회 키 규칙이 있으면 덮어쓰기 대상으로 연결한다',
)
assert(
  findExistingLookupRule(
    [existingLookup],
    'Tassel 1=Pink',
    's-m2276',
    'Strap pouch 하트',
  )?.id === 'rule-pink-existing',
  '기존 조회 키 규칙을 본품·조회 키로 찾는다',
)

const collectedPink = collectUnknownAccessoryPieces([
  {
    key: 'a',
    mallName: '몰',
    productName: '파우치',
    itemName: 'Pink',
    originalItemName: 'Pink',
    ownProductCode: '',
    productStyle: accessoryByNo.get('M2276') ?? null,
    productLookupKey: 'Strap pouch 하트',
    productAppliedRule: null,
    productConnectionExcluded: false,
    mapId: null,
    rowCount: 1,
    status: 'passthrough',
    unknownPieces: ['Pink (종류를 모름)'],
    evidence: [],
  },
  {
    key: 'b',
    mallName: '몰',
    productName: '크로스백',
    itemName: 'Pink',
    originalItemName: 'Pink',
    ownProductCode: '',
    productStyle: accessoryByNo.get('M0088') ?? null,
    productLookupKey: '8 pocket cross bag black',
    productAppliedRule: null,
    productConnectionExcluded: false,
    mapId: null,
    rowCount: 1,
    status: 'passthrough',
    unknownPieces: ['Pink (종류를 모름)'],
    evidence: [],
  },
])
assert(
  collectedPink[0]?.contexts.length === 2,
  '같은 Pink 조각도 본품·조회 키 문맥을 따로 둔다',
)

const reviewMain = style('s-m0834', 'M0834', '아치로고 링거티 네이비')
const reviewShorts = style('s-m0864', 'M0864', '미니심볼 돌핀쇼츠')
const reviewStrap = style('s-m0350', 'M0350', '숄더스트랩 - 그린')
const reviewPurple = style('s-m0351', 'M0351', '숄더스트랩 - 퍼플')
const reviewStyles = [reviewMain, reviewShorts, reviewStrap, reviewPurple]

function reviewPreview(input: {
  itemName: string
  productLookupKey: string
  mainStyle: StyleRef
  styleIdsAfter: string[]
  rowCount?: number
}): AccessoryContextPreview {
  return {
    contextId: accessoryContextId(input),
    itemName: input.itemName,
    productLookupKey: input.productLookupKey,
    mainStyle: input.mainStyle,
    rowCount: input.rowCount ?? 1,
    unknownBefore: 1,
    unknownAfter: 0,
    componentsBefore: '',
    componentsAfter: '',
    styleIdsBefore: [],
    styleIdsAfter: input.styleIdsAfter,
    improved: true,
    sameAsMainSuppressed: false,
    regressing: false,
  }
}

function reviewSource(
  partial: Partial<AccessoryFlattenSource> &
    Pick<AccessoryFlattenSource, 'key' | 'kind'>,
): AccessoryFlattenSource {
  return {
    groupKey: 'set-black',
    pattern: 'BLACK : M (F+)',
    ruleType: 'token',
    accessoryKind: '',
    namePrefix: '',
    colorName: '',
    targetStyle: reviewShorts,
    itemName: '',
    productLookupKey: '',
    mainStyle: null,
    action: 'components',
    components: [],
    existingRuleId: null,
    reason: '세트 구성품',
    confidence: 0.9,
    rowCount: 2,
    passesGate: true,
    contexts: [],
    revalidationError: null,
    allowedStyleIds: [reviewShorts.styleId, reviewStrap.styleId],
    ...partial,
  }
}

const setItemName =
  '[SET] Arch Logo Ringer T-Shirt + Mini Symbol Dolphin Shorts'
const setLookupA =
  '[SET] Arch Logo Ringer T-Shirt + Mini Symbol Dolphin Shorts_BLACK : M (F+)'
const setLookupB =
  '[SET] Arch Logo Ringer T-Shirt + Mini Symbol Dolphin Shorts_WHITE : M (F+)'
const dictContexts = [
  reviewPreview({
    itemName: setItemName,
    productLookupKey: setLookupA,
    mainStyle: reviewMain,
    styleIdsAfter: [reviewShorts.styleId],
    rowCount: 3,
  }),
  reviewPreview({
    itemName: setItemName,
    productLookupKey: setLookupB,
    mainStyle: reviewMain,
    styleIdsAfter: [reviewShorts.styleId],
    rowCount: 2,
  }),
]
const flattenedReview = flattenAccessoryPlanRows(
  [
    reviewSource({
      key: 'dict-1',
      kind: 'dictionary',
      contexts: dictContexts,
    }),
  ],
  reviewStyles,
  [],
)
assert(flattenedReview.length === 2, '전역 후보도 조회 키 조합마다 한 행으로 펼친다')
assert(
  flattenedReview.every(
    (row) =>
      row.itemName === setItemName &&
      row.mainStyle?.styleNo === 'M0834' &&
      row.components[0]?.style.styleNo === 'M0864',
  ),
  '펼친 행은 옵션명·본품·예상 구성품만 가진다',
)
assert(
  accessoryReviewExpectedLines('components', [
    { style: reviewShorts, quantity: 1 },
    { style: reviewStrap, quantity: 2 },
  ]).join('|') ===
    'M0864 · 미니심볼 돌핀쇼츠|M0350 · 숄더스트랩 - 그린 × 2',
  '복수 구성품은 M번호 · 상품명 × 수량으로 표시한다',
)
assert(
  accessoryReviewExpectedLines('delete', []).join('|') === '내품명을 비움',
  '내품명 비움은 그 문구로 표시한다',
)

const overlappingLookup = flattenAccessoryPlanRows(
  [
    reviewSource({
      key: 'lookup-1',
      kind: 'lookup_key',
      itemName: setItemName,
      productLookupKey: setLookupA,
      mainStyle: reviewMain,
      components: [{ style: reviewStrap, quantity: 1 }],
      confidence: 0.95,
      rowCount: 3,
    }),
    reviewSource({
      key: 'dict-1',
      kind: 'dictionary',
      confidence: 0.7,
      contexts: dictContexts,
    }),
  ],
  reviewStyles,
  [],
)
assert(overlappingLookup.length === 2, '같은 조회 키는 한 행만 남긴다')
assert(
  overlappingLookup.find((row) => row.productLookupKey === setLookupA)
    ?.components[0]?.style.styleNo === 'M0350',
  '같은 조회 키면 확실도 높은 행만 남긴다',
)

const existingExact = itemNameRule({
  id: 'rule-set-existing',
  itemName: setItemName,
  scope: 'lookup_key',
  mainStyle: reviewMain,
  productLookupKey: setLookupA,
  action: 'components',
  components: [ruleComponent('rule-set-existing', reviewShorts, 'included')],
})
const flattenedWithExisting = flattenAccessoryPlanRows(
  [
    reviewSource({
      key: 'lookup-exist',
      kind: 'lookup_key',
      itemName: setItemName,
      productLookupKey: setLookupA,
      mainStyle: reviewMain,
      components: [{ style: reviewShorts, quantity: 1 }],
    }),
  ],
  reviewStyles,
  [existingExact],
)
assert(
  flattenedWithExisting[0]?.existingRuleId === 'rule-set-existing',
  '같은 문맥의 기존 exact는 덮어쓰기 대상으로 연결한다',
)

const allKeys = flattenedReview.map((row) => row.key)
const globalSave = decideAccessoryReviewSaves(flattenedReview, allKeys)
assert(globalSave.dictionaries.length === 1, '전역 후보를 모두 고르고 수정하지 않으면 한 번만 저장한다')
assert(globalSave.lookups.length === 0, '전역으로 저장한 문맥은 exact를 겹쳐 쓰지 않는다')
assert(
  globalSave.dictionaries[0]?.input.pattern === 'BLACK : M (F+)',
  '전역 저장은 사전 패턴을 그대로 쓴다',
)

const partialSave = decideAccessoryReviewSaves(flattenedReview, [flattenedReview[0]!.key])
assert(partialSave.dictionaries.length === 0, '일부만 고르면 전역 규칙을 쓰지 않는다')
assert(partialSave.lookups.length === 1, '일부 선택은 고른 행만 exact로 저장한다')
assert(
  partialSave.lookups[0]?.input.productLookupKey === setLookupA &&
    partialSave.lookups[0]?.input.scope === 'lookup_key' &&
    partialSave.lookups[0]?.input.components?.[0]?.styleId === reviewShorts.styleId,
  '부분 선택의 exact는 그 조회 키 조합만 가리킨다',
)

const dirtyRow = {
  ...flattenedReview[0]!,
  action: 'delete' as const,
  components: [],
}
assert(isAccessoryReviewDirty(dirtyRow), '예상값을 바꾸면 수정된 행으로 본다')
const splitSave = decideAccessoryReviewSaves(
  [dirtyRow, flattenedReview[1]!],
  [dirtyRow.key, flattenedReview[1]!.key],
)
assert(splitSave.dictionaries.length === 0, '한 행을 수정하면 전역 저장을 하지 않는다')
assert(splitSave.lookups.length === 2, '수정 후 선택된 행은 모두 exact로 나눈다')
assert(
  splitSave.lookups.find((item) => item.reviewKey === dirtyRow.key)?.input.action ===
    'delete',
  '수정한 행만 내품명 비움 exact로 저장한다',
)

const blockedEmpty = revalidateAccessoryReviewRow({
  ...flattenedReview[0]!,
  action: 'components',
  components: [],
})
assert(
  blockedEmpty.revalidationError === '구성품 M번호를 하나 이상 고르세요.',
  '빈 구성품은 해당 행의 저장을 막는다',
)
const blockedUnknown = revalidateAccessoryReviewRow({
  ...flattenedReview[0]!,
  components: [{ style: style('s-unknown', 'M0000', '없는 상품'), quantity: 1 }],
})
assert(
  blockedUnknown.revalidationError === '후보에 없는 구성품입니다.',
  '후보 밖 M번호는 해당 행의 저장을 막는다',
)
const blockedDirtySave = decideAccessoryReviewSaves(
  [blockedEmpty, flattenedReview[1]!],
  [blockedEmpty.key, flattenedReview[1]!.key],
)
assert(
  blockedDirtySave.dictionaries.length === 0 &&
    blockedDirtySave.lookups.length === 1 &&
    blockedDirtySave.lookups[0]?.reviewKey === flattenedReview[1]!.key,
  '검증 오류 행은 빼고 나머지 선택만 exact로 저장한다',
)

const aiItemCombos = [
  {
    key: 'ai-item-a',
    mallName: '몰',
    productName: '드롭 숄더백 블랙',
    itemName: 'Color: Black',
    originalItemName: 'Color: Black',
    ownProductCode: '',
    productStyle: reviewMain,
    productLookupKey: 'drop bag black',
    productAppliedRule: null,
    productConnectionExcluded: false,
    mapId: null,
    rowCount: 2,
    status: 'passthrough' as const,
    unknownPieces: [],
    evidence: [],
  },
  {
    key: 'ai-item-b',
    mallName: '몰',
    productName: '드롭 숄더백 네이비',
    itemName: 'Color: Black',
    originalItemName: 'Color: Black',
    ownProductCode: '',
    productStyle: reviewStrap,
    productLookupKey: 'drop bag navy',
    productAppliedRule: null,
    productConnectionExcluded: false,
    mapId: null,
    rowCount: 3,
    status: 'passthrough' as const,
    unknownPieces: [],
    evidence: [],
  },
]
const aiItemGroups = collectItemNameAiGroups(aiItemCombos)
assert(
  aiItemGroups.length === 1 &&
    aiItemGroups[0]?.contexts.length === 2 &&
    aiItemGroups[0]?.rowCount === 5,
  '같은 옵션명은 실제 조회 키 조합별 행으로 묶는다',
)
const aiDeleteRows = buildItemNameAiReviewRows({
  groups: aiItemGroups,
  decisions: aiItemGroups[0]!.contexts.map((context) => ({
    contextId: context.contextId,
    action: 'delete' as const,
    components: [],
    reason: '본품 색상',
    confidence: 0.92,
  })),
  styles: reviewStyles,
  itemNameRules: [],
  minConfidence: 0.72,
})
const aiGlobalPlan = decideItemNameAiSaves(
  aiDeleteRows,
  aiDeleteRows.map((row) => row.key),
)
assert(
  aiGlobalPlan.globals.length === 1 &&
    aiGlobalPlan.lookups.length === 0 &&
    aiGlobalPlan.globals[0]?.input.action === 'delete',
  '같은 옵션명의 모든 조합이 같은 고신뢰 결과면 공통 규칙 한 번만 저장한다',
)
const aiPartialPlan = decideItemNameAiSaves(aiDeleteRows, [
  aiDeleteRows[0]!.key,
])
assert(
  aiPartialPlan.globals.length === 0 &&
    aiPartialPlan.lookups.length === 1 &&
    aiPartialPlan.lookups[0]?.input.scope === 'lookup_key',
  '일부 조합만 고르면 선택한 조회 키 exact만 저장한다',
)
const aiEditedRow = validateItemNameAiReviewRow({
  ...aiDeleteRows[0]!,
  action: 'components',
  components: [{ style: reviewShorts, quantity: 2 }],
})
assert(isItemNameAiReviewDirty(aiEditedRow), 'AI 예상값 수정 여부를 감지한다')
const aiEditedPlan = decideItemNameAiSaves(
  [aiEditedRow, aiDeleteRows[1]!],
  [aiEditedRow.key, aiDeleteRows[1]!.key],
)
assert(
  aiEditedPlan.globals.length === 0 &&
    aiEditedPlan.lookups.length === 2 &&
    aiEditedPlan.lookups.find((item) => item.reviewKey === aiEditedRow.key)
      ?.input.components?.[0]?.quantity === 2,
  '한 행을 수정하면 선택된 조합을 각각 exact로 저장한다',
)
const aiHoldRows = buildItemNameAiReviewRows({
  groups: aiItemGroups,
  decisions: [],
  styles: reviewStyles,
  itemNameRules: [],
  minConfidence: 0.72,
})
const aiHoldPlan = decideItemNameAiSaves(aiHoldRows, [
  aiHoldRows[0]!.key,
])
assert(
  aiHoldRows[0]?.validationError === '구성품 또는 비움을 정하세요.' &&
    aiHoldPlan.blocked.length === 1,
  '추천 보류 행은 사람이 값을 정하기 전까지 저장하지 않는다',
)
assert(
  itemNameAiReviewKind(aiDeleteRows[0]!) === 'delete' &&
    itemNameAiReviewKind(aiEditedRow) === 'bundle' &&
    itemNameAiReviewKind({
      ...aiEditedRow,
      components: [
        { style: reviewShorts, quantity: 1 },
        { style: reviewStrap, quantity: 1 },
      ],
    }) === 'bundle' &&
    itemNameAiReviewKind(aiHoldRows[0]!) === 'hold',
  '검수 행을 비움·옵션 1개·구성 2개 이상·결정 필요로 나눈다',
)
const appendGreen = appendItemNameAiComponent(
  aiHoldRows,
  [aiHoldRows[0]!.key, aiHoldRows[1]!.key],
  { style: reviewStrap, quantity: 1 },
)
assert(
  appendGreen.addedKeys.length === 2 &&
    appendGreen.skippedKeys.length === 0 &&
    itemNameAiReviewKind(appendGreen.rows[0]!) === 'single' &&
    itemNameAiReviewKind(appendGreen.rows[1]!) === 'single' &&
    appendGreen.rows.every(
      (row) => row.components[0]?.style.styleId === reviewStrap.styleId,
    ),
  '그린을 두 행에 추가하면 둘 다 단일 구성이 된다',
)
const appendPurple = appendItemNameAiComponent(
  appendGreen.rows,
  [appendGreen.rows[0]!.key],
  { style: reviewPurple, quantity: 1 },
)
assert(
  appendPurple.addedKeys.length === 1 &&
    itemNameAiReviewKind(appendPurple.rows[0]!) === 'bundle' &&
    itemNameAiReviewKind(appendPurple.rows[1]!) === 'single' &&
    appendPurple.rows[0]!.components.length === 2 &&
    appendPurple.rows[1]!.components.length === 1,
  '퍼플을 한 행에 추가하면 그 행만 2개 구성이 된다',
)
const appendDup = appendItemNameAiComponent(
  appendPurple.rows,
  [appendPurple.rows[0]!.key],
  { style: reviewStrap, quantity: 3 },
)
assert(
  appendDup.addedKeys.length === 0 &&
    appendDup.skippedKeys.length === 1 &&
    appendDup.rows[0]!.components.find(
      (item) => item.style.styleId === reviewStrap.styleId,
    )?.quantity === 1,
  '이미 있는 M번호는 수량을 늘리지 않고 건너뛴다',
)
assert(
  appendPurple.rows[1]!.components.length === 1 &&
    appendPurple.rows[0]!.originalSignature ===
      aiHoldRows[0]!.originalSignature &&
    appendPurple.rows[1]!.originalSignature ===
      aiHoldRows[1]!.originalSignature,
  '대상이 아닌 행과 원래 AI 서명은 유지한다',
)
const appendSavePlan = decideItemNameAiSaves(
  appendPurple.rows,
  appendPurple.rows.map((row) => row.key),
)
assert(
  appendSavePlan.globals.length === 0 &&
    appendSavePlan.lookups.length === 2 &&
    appendSavePlan.lookups.every(
      (item) => item.input.scope === 'lookup_key',
    ),
  '일괄 추가로 바뀐 행은 exact 규칙으로 저장한다',
)
const firstDrafts = mergeItemNameAiDrafts(new Map(), appendGreen)
const draftView = overlayItemNameAiDrafts(aiHoldRows, firstDrafts)
assert(
  itemNameAiReviewKind(aiHoldRows[0]!) === 'hold' &&
    itemNameAiReviewKind(aiHoldRows[1]!) === 'hold' &&
    itemNameAiReviewKind(draftView[0]!) === 'single' &&
    itemNameAiReviewKind(draftView[1]!) === 'single',
  '초안은 원본 분류를 유지한 채 표시만 덮는다',
)
const secondDraftResult = appendItemNameAiComponent(
  draftView,
  [aiHoldRows[0]!.key],
  { style: reviewPurple, quantity: 1 },
)
const secondDrafts = mergeItemNameAiDrafts(firstDrafts, secondDraftResult)
const undoneDrafts = restoreItemNameAiDrafts(
  secondDrafts,
  secondDraftResult.previous,
  aiHoldRows,
)
assert(
  undoneDrafts.get(aiHoldRows[0]!.key)?.components.length === 1 &&
    undoneDrafts.get(aiHoldRows[1]!.key)?.components.length === 1 &&
    restoreItemNameAiDrafts(firstDrafts, appendGreen.previous, aiHoldRows)
      .size === 0,
  '마지막 넣기만 취소하면 이전 초안은 남고 첫 추가는 비워진다',
)
const committed = overlayItemNameAiDrafts(aiHoldRows, secondDrafts)
assert(
  itemNameAiReviewKind(committed[0]!) === 'bundle' &&
    itemNameAiReviewKind(committed[1]!) === 'single',
  '초안을 반영하면 행이 최종 분류로 바뀐다',
)
const heldSingle = markItemNameAiDecisionNeeded(aiEditedRow)
const heldBundle = markItemNameAiDecisionNeeded({
  ...aiEditedRow,
  components: [
    { style: reviewShorts, quantity: 2 },
    { style: reviewStrap, quantity: 1 },
  ],
})
assert(
  itemNameAiReviewKind(heldSingle) === 'hold' &&
    heldSingle.components.length === 1 &&
    heldSingle.components[0]?.style.styleId === reviewShorts.styleId &&
    heldSingle.components[0]?.quantity === 2 &&
    heldSingle.originalSignature === aiEditedRow.originalSignature &&
    itemNameAiExpectedLines(heldSingle)[0] === '결정 필요' &&
    itemNameAiExpectedLines(heldSingle).length > 1,
  '단일 구성 행을 결정 필요로 보내도 구성·수량·서명은 유지한다',
)
assert(
  itemNameAiReviewKind(heldBundle) === 'hold' &&
    heldBundle.components.length === 2 &&
    heldBundle.components[1]?.style.styleId === reviewStrap.styleId &&
    heldBundle.originalSignature === aiEditedRow.originalSignature,
  '복수 구성 행을 결정 필요로 보내도 구성을 비우지 않는다',
)
const heldThenAppend = appendItemNameAiComponent(
  [heldSingle],
  [heldSingle.key],
  { style: reviewPurple, quantity: 1 },
)
assert(
  heldThenAppend.addedKeys.length === 1 &&
    heldThenAppend.rows[0]!.action === 'components' &&
    heldThenAppend.rows[0]!.components.length === 2 &&
    heldThenAppend.rows[0]!.components[0]?.style.styleId ===
      reviewShorts.styleId &&
    heldThenAppend.rows[0]!.components[1]?.style.styleId ===
      reviewPurple.styleId,
  '결정 필요에서 구성품을 추가하면 기존 구성 뒤에 누적한다',
)
const unitRows = extrasOfItemNameAiRow({
  ...aiEditedRow,
  action: 'components',
  components: [{ style: reviewStrap, quantity: 2 }],
})
const mergedUnits = mergeItemNameAiComponents(
  unitRows.map((item) => ({
    style: item.style!,
    quantity: item.quantity,
  })),
)
const unitQtyRow = validateItemNameAiReviewRow({
  ...aiEditedRow,
  action: 'components',
  components: mergedUnits,
})
assert(
  unitRows.length === 2 &&
    unitRows.every((item) => item.quantity === 1) &&
    unitRows.every((item) => item.style?.styleId === reviewStrap.styleId) &&
    mergedUnits.length === 1 &&
    mergedUnits[0]?.quantity === 2 &&
    itemNameAiReviewKind(unitQtyRow) === 'bundle' &&
    itemNameAiExpectedLines(unitQtyRow).join('|') ===
      `${reviewStrap.styleNo} · ${reviewStrap.name}|${reviewStrap.styleNo} · ${reviewStrap.name}` &&
    formatItemNameFromComponents(unitQtyRow.components) ===
      `${reviewStrap.name}, ${reviewStrap.name}` &&
    mergeOrders[1]?.quantity === '4',
  '같은 M번호 단위 행 2개는 내부 수량 2·검수표 두 줄·bundle·송장 두 번 표기·출고 총수량을 유지한다',
)
function stubItemNameAiReviewRow(
  key: string,
  itemName: string,
  extra?: Partial<ItemNameAiReviewRow>,
): ItemNameAiReviewRow {
  return validateItemNameAiReviewRow({
    contextId: key,
    groupKey: key,
    itemName,
    productLookupKey: extra?.productLookupKey ?? key,
    mainStyle: extra?.mainStyle === undefined ? reviewMain : extra.mainStyle,
    productComponents: [],
    sourceProductName: '본품',
    productConnectionExcluded: extra?.productConnectionExcluded ?? false,
    rowCount: 1,
    key,
    action: extra?.action ?? 'hold',
    components: extra?.components ?? [],
    originalSignature: extra?.originalSignature ?? extra?.action ?? 'hold',
    reason: '',
    confidence: extra?.confidence ?? 0,
    passesGate: extra?.passesGate ?? false,
    validationError: null,
    existingRuleId: null,
    existingGlobalRuleId: null,
    source: extra?.source ?? null,
    cacheId: extra?.cacheId ?? null,
    provider: extra?.provider ?? null,
    modelId: extra?.modelId ?? null,
    suggestedAction: extra?.suggestedAction ?? extra?.action ?? null,
    suggestedComponents: extra?.suggestedComponents ?? extra?.components ?? [],
    ...extra,
  })
}
const liveReviewRows = Array.from({ length: 6 }, (_, index) =>
  stubItemNameAiReviewRow(`live-${index}`, `옵션 ${index}`),
)
const staleDummyRows = Array.from({ length: 4 }, (_, index) =>
  stubItemNameAiReviewRow(`stale-${index}`, '선택안함', {
    action: 'delete',
    originalSignature: 'delete',
    mainStyle: null,
    productLookupKey: '',
  }),
)
const liveDraftRow = validateItemNameAiReviewRow({
  ...liveReviewRows[0]!,
  action: 'components',
  components: [{ style: reviewStrap, quantity: 1 }],
})
const reconciledReview = reconcileItemNameAiReviewState({
  liveContextIds: liveReviewRows.map((row) => row.contextId),
  rows: [...liveReviewRows, ...staleDummyRows],
  drafts: new Map([
    [liveReviewRows[0]!.key, liveDraftRow],
    [staleDummyRows[0]!.key, staleDummyRows[0]!],
  ]),
  selected: [liveReviewRows[1]!.key, staleDummyRows[1]!.key],
  confirmedKeys: [liveReviewRows[0]!.key, staleDummyRows[0]!.key],
  pendingAiKeys: [staleDummyRows[2]!.key],
  committedKeys: [staleDummyRows[3]!.key],
  lastAppend: {
    addedKeys: [staleDummyRows[0]!.key],
    skippedKeys: [],
    previous: [staleDummyRows[0]!],
  },
})
assert(
  reconciledReview.rows.length === 6 &&
    reconciledReview.removedKeys.length === 4 &&
    reconciledReview.removedKeys.every((key) => key.startsWith('stale-')) &&
    reconciledReview.drafts.size === 1 &&
    reconciledReview.drafts.get(liveReviewRows[0]!.key)?.action ===
      'components' &&
    reconciledReview.selected.size === 1 &&
    reconciledReview.selected.has(liveReviewRows[1]!.key) &&
    reconciledReview.confirmedKeys.has(liveReviewRows[0]!.key) &&
    reconciledReview.pendingAiKeys.size === 0 &&
    reconciledReview.committedKeys.size === 0 &&
    reconciledReview.lastAppend === null &&
    reconciledReview.changed &&
    reconciledReview.phase === 'review',
  '현재 context 6개에 없는 선택안함 검수 행 4개는 제거하고 유효 초안은 보존한다',
)
const soloDummyDelete = stubItemNameAiReviewRow('solo-dummy', '선택안함', {
  action: 'delete',
  originalSignature: 'delete',
  mainStyle: null,
  productLookupKey: '',
  productConnectionExcluded: true,
  passesGate: true,
  confidence: 0.95,
})
const soloDummyPlan = decideItemNameAiSaves([soloDummyDelete], [
  soloDummyDelete.key,
])
assert(
  soloDummyPlan.globals.length === 1 &&
    soloDummyPlan.globals[0]?.input.scope === 'global' &&
    soloDummyPlan.globals[0]?.input.action === 'delete' &&
    soloDummyPlan.lookups.length === 0 &&
    soloDummyPlan.blocked.length === 0,
  '상품 연결 예외의 본품 없는 단일 내품명은 공통 exact 규칙으로 저장한다',
)
const soloUnknownDelete = stubItemNameAiReviewRow(
  'solo-unknown',
  '일반 미확정 옵션',
  {
    action: 'delete',
    originalSignature: 'delete',
    mainStyle: null,
    productLookupKey: '',
    productConnectionExcluded: false,
    passesGate: true,
  },
)
const soloUnknownPlan = decideItemNameAiSaves([soloUnknownDelete], [
  soloUnknownDelete.key,
])
assert(
  soloUnknownPlan.globals.length === 0 &&
    soloUnknownPlan.lookups.length === 0 &&
    soloUnknownPlan.blocked[0]?.message ===
      '개별 저장에는 확정 본품과 조회 키가 필요합니다.',
  '일반 본품 미확정 행은 공통 규칙으로 넓히지 않는다',
)
const emptyReconcile = reconcileItemNameAiReviewState({
  liveContextIds: [],
  rows: staleDummyRows,
  drafts: new Map([[staleDummyRows[0]!.key, staleDummyRows[0]!]]),
})
assert(
  emptyReconcile.rows.length === 0 &&
    emptyReconcile.drafts.size === 0 &&
    emptyReconcile.phase === 'idle',
  '남은 context가 없으면 검수 상태를 비우고 idle로 돌린다',
)
const emptySlots = itemNameAiQuickSlotsFromComponents([])
assert(
  emptySlots.length === 1 && emptySlots[0]?.status === 'empty',
  '구성이 없으면 빈칸 하나만 보여 준다',
)
const prefilledSlots = itemNameAiQuickSlotsFromComponents([
  { style: reviewShorts, quantity: 2 },
  { style: reviewStrap, quantity: 1 },
])
assert(
  prefilledSlots.length === 2 &&
    prefilledSlots[0]?.status === 'matched' &&
    prefilledSlots[0]?.quantity === 2 &&
    prefilledSlots[1]?.style?.styleId === reviewStrap.styleId,
  '빠른 입력칸은 기존 구성과 수량을 미리 채운다',
)
const renamedSlot = applyItemNameAiQuickSlotText(
  prefilledSlots[0]!,
  '퍼플 스트랩',
)
assert(
  renamedSlot.status === 'draft' &&
    renamedSlot.style === null &&
    renamedSlot.quantity === 1,
  '공식명을 바꾸면 미확정 초안이 되고 수량은 1이 된다',
)
const incompleteSlots = [renamedSlot, prefilledSlots[1]!]
assert(
  itemNameAiQuickRowComponents(incompleteSlots).ok === false,
  '일부 슬롯이 미확정이면 기존 구성을 덮지 않는다',
)
const replaced = replaceItemNameAiRowComponents(aiEditedRow, [
  { style: reviewStrap, quantity: 2 },
  { style: reviewPurple, quantity: 1 },
])
assert(
  replaced.ok &&
    replaced.row.originalSignature === aiEditedRow.originalSignature &&
    replaced.row.components[0]?.style.styleId === reviewStrap.styleId &&
    replaced.row.components[1]?.style.styleId === reviewPurple.styleId &&
    replaced.row.components[0]?.quantity === 2,
  '확정 슬롯은 순서를 유지한 채 행 전체 구성을 교체한다',
)
const unknownReplace = replaceItemNameAiRowComponents(
  aiEditedRow,
  [{ style: style('s-unknown', 'M9999', '없는상품'), quantity: 1 }],
  new Set([
    reviewShorts.styleId,
    reviewStrap.styleId,
    reviewPurple.styleId,
  ]),
)
assert(
  unknownReplace.ok === false &&
    unknownReplace.row.components[0]?.style.styleId ===
      aiEditedRow.components[0]?.style.styleId,
  '미등록 M번호는 기존 구성을 덮지 않는다',
)
const duplicated = itemNameAiQuickRowComponents([
  {
    text: '쇼츠',
    quantity: 1,
    style: reviewShorts,
    status: 'matched',
    candidates: [],
    error: null,
  },
  {
    text: '쇼츠 다시',
    quantity: 1,
    style: reviewShorts,
    status: 'matched',
    candidates: [],
    error: null,
  },
])
assert(duplicated.ok === false, '같은 M번호를 두 칸에 넣으면 반영하지 않는다')
const exactMatch = decideItemNameAiQuickSlotMatch(
  [
    {
      styleId: reviewStrap.styleId,
      styleNo: reviewStrap.styleNo,
      name: reviewStrap.name,
      reason: 'exact',
      confidence: 0.96,
    },
  ],
  'local',
  0.72,
)
assert(
  exactMatch.status === 'matched' &&
    exactMatch.style?.styleId === reviewStrap.styleId,
  '고신뢰 1순위는 공식 StyleRef로 확정한다',
)
const ambiguousMatch = decideItemNameAiQuickSlotMatch(
  [
    {
      styleId: reviewStrap.styleId,
      styleNo: reviewStrap.styleNo,
      name: reviewStrap.name,
      reason: '비슷',
      confidence: 0.61,
    },
    {
      styleId: reviewPurple.styleId,
      styleNo: reviewPurple.styleNo,
      name: reviewPurple.name,
      reason: '비슷',
      confidence: 0.58,
    },
  ],
  'ai',
  0.72,
)
assert(
  ambiguousMatch.status === 'ambiguous' &&
    ambiguousMatch.candidates.length === 2,
  '애매한 추천은 후보만 남기고 확정하지 않는다',
)
const visibleKeys = ['row-a', 'row-b', 'row-c']
assert(
  nextItemNameAiQuickFocus(visibleKeys, 'row-a', 0, 'down')?.rowKey ===
    'row-b' &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 1, 'down', {
      'row-b': 2,
    })?.slotIndex === 1 &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 1, 'down', {
      'row-b': 1,
    })?.slotIndex === 0 &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 1, 'down', {
      'row-b': 1,
    })?.ensureCount === 1 &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-c', 0, 'down') === null,
  'Enter는 다음 행의 있는 칸으로만 이동하고 새 칸을 만들지 않는다',
)
assert(
  nextItemNameAiQuickFocus(visibleKeys, 'row-a', 0, 'right')?.slotIndex ===
    1 &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 1, 'right')
      ?.ensureCount === 3 &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 2, 'right')?.rowKey ===
      'row-b' &&
    nextItemNameAiQuickFocus(visibleKeys, 'row-a', 2, 'right')?.slotIndex ===
      0,
  'Tab은 같은 행에 칸을 만들고 세 번째에서는 다음 행 첫 칸으로 간다',
)
assert(
  decideItemNameAiEnterAction([emptyItemNameAiQuickSlot()]).status ===
    'delete',
  '행 전체가 빈칸이면 Enter는 내품명 비움이다',
)
assert(
  decideItemNameAiEnterAction([
    prefilledSlots[0]!,
    emptyItemNameAiQuickSlot(),
  ]).status === 'components' &&
    decideItemNameAiEnterAction([
      prefilledSlots[0]!,
      emptyItemNameAiQuickSlot(),
    ]).status === 'components',
  '일부 칸만 비고 나머지가 공식이면 그 구성만 확정한다',
)
assert(
  decideItemNameAiEnterAction(incompleteSlots).status === 'needs_ai',
  '미확정 문자열이 있으면 AI 정리 대기로 남긴다',
)
const approvedSame = applyItemNameAiRowAction(aiEditedRow, {
  action: 'components',
  components: aiEditedRow.components,
})
assert(
  approvedSame.ok &&
    approvedSame.row.originalSignature === aiEditedRow.originalSignature &&
    approvedSame.row.action === 'components',
  '기존 공식 구성을 Enter로 승인해도 서명은 유지한다',
)
const deletedDraft = applyItemNameAiRowAction(aiEditedRow, {
  action: 'delete',
})
const heldDraft = applyItemNameAiRowAction(heldSingle, { action: 'hold' })
assert(
  deletedDraft.ok && deletedDraft.row.action === 'delete',
  '빈 행 Enter는 삭제 초안을 만든다',
)
assert(heldDraft.ok, '결정 필요는 초안으로 올린다')
const heldOther = { ...heldDraft.row, key: 'held-other' }
const readyCommit = commitReadyItemNameAiDrafts({
  rows: [aiEditedRow, heldOther],
  drafts: new Map([
    [aiEditedRow.key, deletedDraft.row],
    [heldOther.key, heldOther],
  ]),
  confirmedKeys: new Set([aiEditedRow.key, heldOther.key, 'needs-ai']),
  pendingAiKeys: new Set(['needs-ai']),
  committedKeys: new Set(),
})
assert(
  readyCommit.rows[0]!.action === 'delete' &&
    readyCommit.rows[1]!.action === 'hold' &&
    readyCommit.committedKeys.has(aiEditedRow.key) &&
    readyCommit.committedKeys.has(heldOther.key) &&
    !readyCommit.committedKeys.has('needs-ai') &&
    readyCommit.selectedKeys.includes(aiEditedRow.key) &&
    !readyCommit.selectedKeys.includes(heldOther.key) &&
    readyCommit.drafts.size === 0,
  '준비된 행만 부분 저장하고 미확정 행은 입력 대기에 남긴다',
)
assert(
  itemNameAiMatchesQueueFilter(readyCommit.rows[0]!, 'queue', new Set()) &&
    !itemNameAiMatchesQueueFilter(
      readyCommit.rows[0]!,
      'queue',
      readyCommit.committedKeys,
    ) &&
    itemNameAiMatchesQueueFilter(
      readyCommit.rows[0]!,
      'delete',
      readyCommit.committedKeys,
    ) &&
    itemNameAiMatchesQueueFilter(
      readyCommit.rows[1]!,
      'hold',
      readyCommit.committedKeys,
    ),
  '저장 완료 행만 결과 탭에 들어가고 입력 대기에서는 빠진다',
)
const approvedOriginal = commitReadyItemNameAiDrafts({
  rows: [aiEditedRow],
  drafts: new Map(),
  confirmedKeys: new Set([aiEditedRow.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  approvedOriginal.committedKeys.has(aiEditedRow.key) &&
    approvedOriginal.rows[0]!.action === 'components' &&
    itemNameAiMatchesQueueFilter(
      approvedOriginal.rows[0]!,
      'bundle',
      approvedOriginal.committedKeys,
    ) &&
    !itemNameAiMatchesQueueFilter(
      approvedOriginal.rows[0]!,
      'queue',
      approvedOriginal.committedKeys,
    ),
  '기존 공식 구성을 Enter로 확인한 행은 초안이 없어도 결과 탭으로 간다',
)
const heldOriginal = commitReadyItemNameAiDrafts({
  rows: [heldSingle],
  drafts: new Map(),
  confirmedKeys: new Set([heldSingle.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  !heldOriginal.committedKeys.has(heldSingle.key),
  '결정 필요 원본은 초안 없이 저장하지 않는다',
)
const unmatchedSlot = {
  text: '태슬 핑크',
  quantity: 1,
  style: null,
  status: 'unmatched' as const,
  candidates: [reviewStrap],
  error: '공식 상품을 찾지 못했습니다.',
}
const pickedSlot = applyItemNameAiQuickSlotStyle(unmatchedSlot, reviewStrap)
const pickedDecision = decideItemNameAiEnterAction([pickedSlot])
assert(
  pickedSlot.status === 'matched' &&
    pickedSlot.style?.styleId === reviewStrap.styleId &&
    pickedDecision.status === 'components' &&
    pickedDecision.components[0]?.style.styleId === reviewStrap.styleId,
  'AI 미매칭 뒤 후보를 고르면 공식 구성품 1개로 확정한다',
)
const emptyStillDelete = decideItemNameAiEnterAction([
  emptyItemNameAiQuickSlot(),
])
assert(
  emptyStillDelete.status === 'delete',
  '빈 슬롯은 계속 내품명 비움이다',
)
const pickedDraft = applyItemNameAiRowAction(deletedDraft.row, {
  action: 'components',
  components:
    pickedDecision.status === 'components' ? pickedDecision.components : [],
})
assert(pickedDraft.ok, '후보로 고른 구성은 비움 초안을 덮는다')
const pickedCommit = commitReadyItemNameAiDrafts({
  rows: [deletedDraft.row],
  drafts: new Map([[deletedDraft.row.key, pickedDraft.row]]),
  confirmedKeys: new Set([deletedDraft.row.key]),
  pendingAiKeys: new Set(),
  committedKeys: new Set(),
})
assert(
  pickedCommit.rows[0]!.action === 'components' &&
    itemNameAiReviewKind(pickedCommit.rows[0]!) === 'single' &&
    itemNameAiMatchesQueueFilter(
      pickedCommit.rows[0]!,
      'single',
      pickedCommit.committedKeys,
    ) &&
    !itemNameAiMatchesQueueFilter(
      pickedCommit.rows[0]!,
      'delete',
      pickedCommit.committedKeys,
    ),
  '후보를 고른 행은 변경 저장 후 옵션 상품 1개 탭으로 간다',
)
const reopened = reopenItemNameAiCommittedRow({
  committedKeys: pickedCommit.committedKeys,
  selectedKeys: new Set(pickedCommit.selectedKeys),
  confirmedKeys: new Set([deletedDraft.row.key]),
  pendingAiKeys: new Set(),
  key: deletedDraft.row.key,
})
assert(
  !reopened.committedKeys.has(deletedDraft.row.key) &&
    !reopened.selectedKeys.has(deletedDraft.row.key) &&
    !reopened.confirmedKeys.has(deletedDraft.row.key) &&
    pickedCommit.committedKeys.has(deletedDraft.row.key),
  '저장 완료 행만 검수 대기로 되돌리고 다른 상태는 유지한다',
)
assert(
  itemNameAiQueueProgress({
    confirmed: true,
    committed: false,
    pendingAi: true,
  }) === 'needs_ai' &&
    itemNameAiQueueProgress({
      confirmed: true,
      committed: false,
      pendingAi: false,
      draft: { action: 'components' },
    }) === 'ready_components' &&
    itemNameAiQueueProgress({
      confirmed: true,
      committed: false,
      pendingAi: false,
      draft: null,
      row: { action: 'hold' },
    }) === 'pending',
  '입력 완료와 AI 정리 필요 상태를 구분한다',
)
const holdToStrap = applyItemNameAiRowAction(
  heldSingle,
  {
    action: 'components',
    components: [{ style: reviewStrap, quantity: 1 }],
  },
  new Set([reviewStrap.styleId]),
)
assert(
  holdToStrap.ok &&
    holdToStrap.row.action === 'components' &&
    holdToStrap.row.components[0]?.style.styleId === reviewStrap.styleId,
  '결정 필요 행에 스트랩 후보를 고르면 구성품 초안이 된다',
)

function aiCombo(input: {
  key: string
  itemName: string
  productName: string
  productLookupKey: string
  productStyle: StyleRef
  rowCount: number
}) {
  return {
    key: input.key,
    mallName: '몰',
    productName: input.productName,
    itemName: input.itemName,
    originalItemName: input.itemName,
    ownProductCode: '',
    productStyle: input.productStyle,
    productLookupKey: input.productLookupKey,
    productAppliedRule: null,
    productConnectionExcluded: false,
    mapId: null,
    rowCount: input.rowCount,
    status: 'passthrough' as const,
    unknownPieces: [],
    evidence: [],
  }
}

const aiSpeedGroups = collectItemNameAiGroups([
  aiCombo({
    key: 'speed-a1',
    itemName: 'Color: Black',
    productName: '드롭 숄더백 블랙',
    productLookupKey: 'drop bag black',
    productStyle: reviewMain,
    rowCount: 4,
  }),
  aiCombo({
    key: 'speed-a2',
    itemName: 'Color: Black',
    productName: '드롭 숄더백 블랙 단독',
    productLookupKey: 'drop bag black solo',
    productStyle: reviewMain,
    rowCount: 3,
  }),
  aiCombo({
    key: 'speed-a3',
    itemName: 'Color: Black',
    productName: '드롭 숄더백 네이비',
    productLookupKey: 'drop bag navy',
    productStyle: reviewStrap,
    rowCount: 2,
  }),
  aiCombo({
    key: 'speed-b1',
    itemName: 'Size: FREE',
    productName: '드롭 숄더백 블랙',
    productLookupKey: 'drop bag black',
    productStyle: reviewMain,
    rowCount: 1,
  }),
])
const aiSpeedContexts = aiSpeedGroups.flatMap((group) => group.contexts)
const aiSpeedDedupe = dedupeItemNameAiContexts(aiSpeedContexts)
assert(
  aiSpeedContexts.length === 4 &&
    aiSpeedDedupe.requests.length === 3 &&
    aiSpeedDedupe.mirrors.size === 1,
  '옵션명과 확정 본품이 같고 조회 키만 다른 조합은 한 번만 AI에 묻는다',
)
const aiSpeedRepresentative = aiSpeedDedupe.requests.find(
  (context) => aiSpeedDedupe.mirrors.has(context.contextId),
)
const aiSpeedMirrored = mirrorItemNameAiDecisions(
  [
    {
      contextId: aiSpeedRepresentative!.contextId,
      action: 'delete' as const,
      components: [],
      reason: '본품 색상',
      confidence: 0.9,
    },
  ],
  aiSpeedDedupe.mirrors,
)
const aiSpeedMirroredIds = new Set(
  aiSpeedMirrored.map((decision) => decision.contextId),
)
const aiSpeedMirrorRows = buildItemNameAiReviewRows({
  groups: itemNameAiGroupsForContexts(aiSpeedGroups, aiSpeedMirroredIds),
  decisions: aiSpeedMirrored,
  styles: reviewStyles,
  itemNameRules: [],
  minConfidence: 0.72,
})
assert(
  aiSpeedMirrored.length === 2 &&
    aiSpeedMirrorRows.length === 2 &&
    aiSpeedMirrorRows.every((row) => row.action === 'delete' && row.passesGate),
  '대표 조합의 결정은 같은 옵션명·본품의 다른 조회 키에도 그대로 쓴다',
)
const aiSpeedBatches = planItemNameAiBatches(aiSpeedContexts, 2)
assert(
  aiSpeedBatches.length === 2 &&
    aiSpeedBatches[0]?.length === 2 &&
    new Set(aiSpeedBatches[0]!.map((context) => context.groupKey)).size === 1 &&
    aiSpeedBatches[1]?.length === 2,
  '한 옵션명은 같은 요청에 담고 남는 자리는 다음 옵션명으로 채운다',
)
const aiSpeedTexts = itemNameAiCandidateTexts(aiSpeedContexts, 5)
assert(
  aiSpeedTexts.length === 5 &&
    aiSpeedTexts[0] === 'Color: Black' &&
    aiSpeedTexts[1] === 'Size: FREE' &&
    new Set(aiSpeedTexts).size === 5,
  '후보 검색 문구는 옵션명부터 채우고 같은 문구를 다시 넣지 않는다',
)

const kitMain = style('s-m0026', 'M0026', '하프문 블랙')
const kitEco = style('s-m0005', 'M0005', '래빗에코백 블랙 플라워')
const kitKeyring = style('s-m0997', 'M0997', 'BB키링')
const kitName =
  '[SET] Halfmoon cross bag_black & Rabbit eco bag_Black flower & BB KEYRING SET'
const kitSource = row({
  rowNumber: 9901,
  productName: kitName,
  itemName: 'FREE',
  mallName: '무신사',
})
const kitProductMap = lookupMap('pmap-kit', kitName, kitMain)
const kitOption = optionMap({
  id: 'omap-kit',
  productName: kitName,
  itemName: 'FREE',
  mallName: '무신사',
  components: [
    component('omap-kit', kitMain, 'main', 1, 0),
    component('omap-kit', kitEco, 'included', 1, 1),
    component('omap-kit', kitKeyring, 'included', 1, 2),
  ],
})
const kitProduct = transformInvoiceProductNames(
  [kitSource],
  [kitProductMap],
  catalogFromStyles([kitMain]),
)
const kitItem = transformInvoiceItemNames(
  [kitSource],
  [kitOption],
  kitProduct.rows,
)
const kitCombo = kitItem.unresolvedCombos[0]
assert(
  kitCombo?.productComponents?.length === 3 &&
    formatProductCompositionLines(kitCombo.productComponents).join('|') ===
      'M0026 · 하프문 블랙|M0005 · 래빗에코백 블랙 플라워|M0997 · BB키링',
  '품목명 단계의 세트 구성 3개는 내품명 검수 조합에 모두 유지된다',
)
assert(
  collectItemNameAiGroups(kitItem.unresolvedCombos)[0]?.contexts[0]
    ?.productComponents.length === 3,
  'AI 검수 행도 세트 구성 3개를 유지한다',
)
assert(
  buildInvoiceItemNameLookupKeyRows(
    kitItem.unresolvedCombos,
    kitCombo!.itemName,
    [],
  )[0]?.productComponents.length === 3,
  '수동 조회 키 행도 세트 구성 3개를 유지한다',
)
assert(
  findOptionMapsForProductNameMap([kitOption], kitProductMap).length === 1 &&
    productCompositionFromOptionMap(kitOption).length === 3,
  '기준정보 품목명 행은 조회 키·본품이 맞는 옵션 기준의 전체 구성을 쓴다',
)
assert(
  productCompositionFromStyle(kitMain).length === 1,
  '옵션 기준이 없으면 대표 본품 1개만 둔다',
)

const kitOptionVariant = optionMap({
  id: 'omap-kit-b',
  productName: kitName,
  itemName: 'BLACK',
  mallName: '29CM',
  components: [
    component('omap-kit-b', kitMain, 'main', 1, 0),
    component('omap-kit-b', kitEco, 'included', 1, 1),
  ],
})
const kitVariants = productCompositionVariantsForMap(
  [kitOption, kitOptionVariant],
  kitProductMap,
)
assert(
  kitVariants.length === 2 &&
    kitVariants[0]?.items.length === 2 &&
    kitVariants[1]?.items.length === 3,
  '같은 조회 키의 옵션 변형은 구성별로 나눈다',
)
assert(
  productCompositionVariantsForMap(
    [
      kitOption,
      optionMap({
        id: 'omap-kit-html',
        productName: kitName.replace(' & ', ' &amp; '),
        itemName: 'FREE',
        mallName: '무신사',
        components: kitOption.components,
      }),
    ],
    kitProductMap,
  ).length === 1,
  '같은 구성의 HTML 엔티티 변형은 한 번만 표시한다',
)

const lookupRuleLive = itemNameRule({
  id: 'rule-lookup-live',
  itemName: 'Tassel 1: Green',
  scope: 'lookup_key',
  mainStyle: reviewMain,
  productLookupKey: '[컬러스트랩세트] 빅 트래블백 _ 크림',
  action: 'components',
  components: [ruleComponent('rule-lookup-live', reviewStrap, 'included', 2)],
})
const lookupRulePaused = {
  ...itemNameRule({
    id: 'rule-lookup-paused',
    itemName: '선택안함',
    scope: 'lookup_key',
    mainStyle: reviewMain,
    productLookupKey: 'drop bag black',
    action: 'delete',
  }),
  isActive: false,
  updatedAt: '2026-08-17T00:00:00.000Z',
}
const globalRuleHidden = itemNameRule({
  id: 'rule-global-hidden',
  itemName: 'Tassel 1: Green',
  action: 'delete',
})
const listedLookupRules = listLookupKeyItemNameRules([
  globalRuleHidden,
  lookupRulePaused,
  lookupRuleLive,
])
assert(
  listedLookupRules.length === 2 &&
    listedLookupRules.every((rule) => rule.scope === 'lookup_key') &&
    listedLookupRules[0]?.id === lookupRuleLive.id,
  '조회 키 규칙만 모아 최근 수정순으로 보여 준다',
)
assert(
  formatItemNameRuleResult(lookupRuleLive) ===
    `${reviewStrap.name}, ${reviewStrap.name}` &&
    formatItemNameRuleStyleNos(lookupRuleLive) === `${reviewStrap.styleNo}×2` &&
    formatItemNameRuleResult(lookupRulePaused) === '(빈 값)' &&
    formatItemNameRuleStyleNos(lookupRulePaused) === '-' &&
    itemNameRuleSearchText(lookupRuleLive).includes(reviewStrap.styleNo),
  '조회 키 규칙은 수량만큼 공식명을 나열하고 비움은 빈 값으로 표시한다',
)
const pausedEdit = itemNameRuleEditSave(lookupRulePaused, {
  action: 'components',
  components: [{ style: reviewStrap, quantity: 1 }],
})
assert(
  pausedEdit.ruleId === lookupRulePaused.id &&
    pausedEdit.input.isActive === false &&
    pausedEdit.input.scope === 'lookup_key' &&
    pausedEdit.input.productLookupKey === lookupRulePaused.productLookupKey &&
    pausedEdit.input.mainStyleId === reviewMain.styleId &&
    pausedEdit.input.itemName === lookupRulePaused.itemName &&
    pausedEdit.input.action === 'components' &&
    pausedEdit.input.components?.[0]?.styleId === reviewStrap.styleId,
  '중지된 조회 키 규칙을 고쳐도 식별값과 중지 상태를 유지한다',
)

const stitchBlack = style('s-m0622', 'M0622', '스파 리본 퀼트 블랙')
const tasselOfficial = style('s-m0982-official', 'M0982', '태슬 - 블랙')
const reproSource = row({
  rowNumber: 9501,
  productName: 'Strap pouch_Stitched ribbon quilt Black',
  itemName: 'Tassel 1=Black, Tassel 2=선택안함',
})
const reproProduct = transformInvoiceProductNames(
  [reproSource],
  [lookupMap('pmap-repro-stitch', reproSource.productName, stitchBlack)],
  catalogFromStyles([stitchBlack, tasselOfficial]),
)
const reproItem = transformInvoiceItemNames(
  [reproSource],
  [],
  reproProduct.rows,
  [
    itemNameRule({
      id: 'rule-repro-tassel-black',
      itemName: reproSource.itemName,
      scope: 'lookup_key',
      mainStyle: stitchBlack,
      productLookupKey: reproSource.productName,
      action: 'components',
      components: [
        ruleComponent('rule-repro-tassel-black', tasselOfficial, 'included'),
      ],
    }),
  ],
)
assert(
  reproItem.rows[0]?.status === 'mapped' &&
    reproItem.rows[0]?.ruleId === 'rule-repro-tassel-black' &&
    reproItem.rows[0]?.transformedItemName === tasselOfficial.name &&
    reproItem.rows[0]?.extras[0]?.style.styleNo === 'M0982' &&
    reproItem.rows[0]?.expandableExtras.length === 0,
  '재현 규칙은 공식 내품명과 출고구성만 만들고 CJ 확장 구성은 비운다',
)
const reproOutput = buildInvoiceOutputRows({
  transformedRows: reproProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: reproProduct,
  itemTransformation: reproItem,
})
const reproOrders = reproOutput.filter((item) => item.kind === 'order')
assert(reproOrders.length === 1, '재현 케이스는 본품 CJ 1행만 남긴다')
assert(
  reproOrders[0]?.finalProductName === stitchBlack.name &&
    reproOrders[0]?.finalItemName === tasselOfficial.name &&
    reproOrders[0]?.quantity === '1',
  '재현 CJ는 본품 공식명과 태슬 내품명만 쓴다',
)
const reproOutgoing = buildOutgoingComponentRowsFromStages({
  productRows: reproProduct.rows,
  itemRows: reproItem.rows,
  giftRowsBySource: new Map(),
})
assert(
  reproOutgoing.some(
    (item) => item.role === 'main' && item.styleNo === 'M0622' && item.quantity === 1,
  ) &&
    reproOutgoing.some(
      (item) =>
        item.role === 'included' &&
        item.styleNo === 'M0982' &&
        item.quantity === 1,
    ) &&
    reproOutgoing.length === 2,
  '재현 출고구성은 본품과 태슬을 각각 1개로 남긴다',
)
const reproProductStage = buildInvoiceStepSnapshot({
  stage: 'product',
  sourceRows: [reproSource],
  productTransformation: reproProduct,
  itemTransformation: reproItem,
})
assert(
  reproProductStage.filter((item) => item.kind === 'order').length === 1 &&
    reproProductStage[0]?.finalItemName === reproSource.itemName,
  '품목명 단계 스냅샷은 규칙 구성품을 펼치지 않고 원문 내품명을 유지한다',
)
const reproItemStage = buildInvoiceStepSnapshot({
  stage: 'item',
  sourceRows: [reproSource],
  productTransformation: reproProduct,
  itemTransformation: reproItem,
})
assert(
  reproItemStage.filter((item) => item.kind === 'order').length === 1 &&
    reproItemStage[0]?.finalItemName === tasselOfficial.name,
  '내품명 단계 스냅샷도 본품 1행에 공식 내품명만 넣는다',
)

const qtyTwoSource = row({
  rowNumber: 9502,
  productName: reproSource.productName,
  itemName: reproSource.itemName,
  quantity: '2',
})
const qtyTwoProduct = transformInvoiceProductNames(
  [qtyTwoSource],
  [lookupMap('pmap-repro-qty2', qtyTwoSource.productName, stitchBlack)],
  catalogFromStyles([stitchBlack, tasselOfficial]),
)
const qtyTwoItem = transformInvoiceItemNames(
  [qtyTwoSource],
  [],
  qtyTwoProduct.rows,
  [
    itemNameRule({
      id: 'rule-repro-tassel-qty2',
      itemName: qtyTwoSource.itemName,
      action: 'components',
      components: [
        ruleComponent('rule-repro-tassel-qty2', tasselOfficial, 'included', 2),
      ],
    }),
  ],
)
const qtyTwoOutput = buildInvoiceOutputRows({
  transformedRows: qtyTwoProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: qtyTwoProduct,
  itemTransformation: qtyTwoItem,
}).filter((item) => item.kind === 'order')
assert(
  qtyTwoOutput.length === 1 &&
    qtyTwoOutput[0]?.quantity === '2' &&
    qtyTwoOutput[0]?.finalItemName ===
      `${tasselOfficial.name}, ${tasselOfficial.name}`,
  '규칙 수량 2도 CJ 행을 늘리지 않고 주문 수량만 남긴다',
)
const qtyTwoOutgoing = buildOutgoingComponentRowsFromStages({
  productRows: qtyTwoProduct.rows,
  itemRows: qtyTwoItem.rows,
  giftRowsBySource: new Map(),
})
assert(
  qtyTwoOutgoing.find((item) => item.styleNo === 'M0622')?.quantity === 2 &&
    qtyTwoOutgoing.find((item) => item.styleNo === 'M0982')?.quantity === 4,
  '규칙 수량 2는 출고구성에서만 주문 수량과 곱한다',
)

const deleteSetSource = row({
  rowNumber: 9503,
  productName: product,
  itemName: '지우기세트',
})
const deleteSetProduct = transformInvoiceProductNames(
  [deleteSetSource],
  [lookupMap('pmap-delete-set', product, bag)],
  catalogFromStyles([bag, charm]),
)
const deleteSetMap = optionMap({
  id: 'map-delete-set',
  productName: product,
  itemName: '지우기세트',
  components: [
    component('map-delete-set', bag, 'main'),
    component('map-delete-set', charm, 'included'),
  ],
})
const deleteSetItem = transformInvoiceItemNames(
  [deleteSetSource],
  [deleteSetMap],
  deleteSetProduct.rows,
  [
    itemNameRule({
      id: 'rule-delete-set',
      itemName: '지우기세트',
      action: 'delete',
    }),
  ],
)
assert(
  deleteSetItem.rows[0]?.status === 'deleted' &&
    deleteSetItem.rows[0]?.transformedItemName === '' &&
    deleteSetItem.rows[0]?.extras[0]?.style.styleId === charm.styleId &&
    deleteSetItem.rows[0]?.expandableExtras[0]?.style.styleId === charm.styleId,
  '지우기 규칙은 내품명만 비우고 실제 세트 구성은 유지한다',
)
const deleteSetOutput = buildInvoiceOutputRows({
  transformedRows: deleteSetProduct.rows.map((item) => ({
    source: item.source,
    transformedName: item.transformedProductName,
    status: 'renamed',
    matchedRuleId: item.mapId,
  })),
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  productTransformation: deleteSetProduct,
  itemTransformation: deleteSetItem,
}).filter((item) => item.kind === 'order')
assert(
  deleteSetOutput.length === 2 &&
    deleteSetOutput.every((line) => line.finalItemName === '') &&
    deleteSetOutput[0]?.finalProductName === bag.name &&
    deleteSetOutput[1]?.finalProductName === charm.name,
  '지우기+실제 세트는 내품명을 비운 채 세트 행만 펼친다',
)

const accessoryMappedOutput = buildInvoiceOutputRows({
  transformedRows: [
    {
      source: accessoryMapped.rows[0]!.source,
      transformedName: accessoryMapped.rows[0]!.source.productName,
      status: 'renamed',
      matchedRuleId: null,
    },
  ],
  workMatches: new Map(),
  giftRowsBySource: new Map(),
  itemTransformation: accessoryMapped,
}).filter((item) => item.kind === 'order')
assert(
  accessoryMappedOutput.length === 1 &&
    accessoryMappedOutput[0]?.finalItemName ===
      accessoryMapped.rows[0]?.transformedItemName,
  '부속품 사전 구성품도 CJ 행을 늘리지 않는다',
)
const accessoryPouch = ACCESSORY_STYLE_FIXTURES.find(
  (item) => item.styleNo === 'M2276',
)!
const accessoryMappedProduct = transformInvoiceProductNames(
  [accessoryMapped.rows[0]!.source],
  [
    lookupMap(
      'pmap-acc-mapped',
      accessoryMapped.rows[0]!.source.productName,
      accessoryPouch,
    ),
  ],
  catalogFromStyles(ACCESSORY_STYLE_FIXTURES),
)
const accessoryMappedOutgoing = buildOutgoingComponentRowsFromStages({
  productRows: accessoryMappedProduct.rows,
  itemRows: accessoryMapped.rows,
  giftRowsBySource: new Map(),
})
assert(
  accessoryMappedOutgoing.some((item) => item.styleNo === 'M0983'),
  '부속품 사전 구성품은 출고구성에 남긴다',
)

function productListRow(
  row: Pick<InvoiceOutgoingComponentRow, 'role' | 'styleNo' | 'quantity'> &
    Partial<InvoiceOutgoingComponentRow>,
): InvoiceOutgoingComponentRow {
  return {
    sourceRowNumber: 1,
    customerOrderNo: '',
    mallName: '',
    productName: '',
    itemName: '',
    styleName: row.styleName ?? row.styleNo,
    source: 'map',
    ...row,
  }
}

const mergedList = summarizeInvoiceProductList(
  [
    productListRow({ role: 'main', styleNo: 'M1000', quantity: 2 }),
    productListRow({ role: 'main', styleNo: 'm1000', quantity: 1 }),
    productListRow({
      role: 'included',
      styleNo: 'M1000',
      styleName: '미니백',
      quantity: 1,
    }),
    productListRow({ role: 'gift', styleNo: 'M1000', quantity: 2 }),
    productListRow({ role: 'packing', styleNo: 'M1000', quantity: 1 }),
    productListRow({ role: 'main', styleNo: 'M2000', quantity: 4 }),
  ],
  ALL_INVOICE_PRODUCT_LIST_CATEGORIES,
)
assert(mergedList.entries.length === 2, 'M번호는 전역으로 한 줄로 합친다')
assert(
  mergedList.entries[0]?.styleNo === 'M1000' &&
    mergedList.entries[0]?.quantity === 7 &&
    mergedList.entries[0]?.styleName === '미니백',
  '같은 M번호의 품목·내품·사은품·포장재를 7개로 합친다',
)
assert(
  mergedList.entries[1]?.styleNo === 'M2000' &&
    mergedList.entries[1]?.quantity === 4,
  '다른 M번호는 따로 두고 M번호순으로 정렬한다',
)
assert(mergedList.selectedStyleCount === 2, '선택 결과 상품 종류 수는 2다')
assert(mergedList.selectedQuantity === 11, '선택 결과 총수량은 11이다')
const backupRows = buildInvoiceProductListBackupRows(mergedList.entries)
assert(
  INVOICE_PRODUCT_LIST_BACKUP_HEADERS.join(',') ===
    'M번호,공식 상품명,수량' &&
    backupRows.length === 2 &&
    backupRows[0]?.join(',') === 'M1000,미니백,7' &&
    backupRows.every((row) => row.length === 3),
  '선택 상품 백업은 M번호·공식 상품명·수량 세 열만 만든다',
)

const withoutGift = summarizeInvoiceProductList(
  [
    productListRow({ role: 'main', styleNo: 'M1000', quantity: 3 }),
    productListRow({ role: 'included', styleNo: 'M1000', quantity: 1 }),
    productListRow({ role: 'gift', styleNo: 'M1000', quantity: 2 }),
    productListRow({ role: 'packing', styleNo: 'M1000', quantity: 1 }),
  ],
  ['product', 'component', 'packing'],
)
assert(
  withoutGift.entries.length === 1 && withoutGift.entries[0]?.quantity === 5,
  '사은품 체크를 끄면 같은 행의 총수량에서 뺀다',
)
assert(
  withoutGift.categoryTotals.gift.quantity === 2 &&
    withoutGift.categoryTotals.gift.styleCount === 1,
  '체크를 꺼도 종류별 가능 수량은 유지한다',
)

const unresolvedList = summarizeInvoiceProductList(
  [
    productListRow({ role: 'main', styleNo: '', quantity: 2 }),
    productListRow({
      role: 'unknown',
      styleNo: 'M9999',
      quantity: 3,
    }),
    productListRow({ role: 'gift', styleNo: '  ', quantity: 1 }),
    productListRow({ role: 'main', styleNo: 'M0100', quantity: 4 }),
    productListRow({ role: 'main', styleNo: 'M0020', quantity: 1 }),
  ],
  ALL_INVOICE_PRODUCT_LIST_CATEGORIES,
)
assert(
  classifyInvoiceProductListRow(
    productListRow({ role: 'unknown', styleNo: 'M9999', quantity: 1 }),
  ) === 'unresolved',
  'unknown 역할은 미확정이다',
)
assert(
  unresolvedList.unresolved.rowCount === 3 &&
    unresolvedList.unresolved.quantity === 6,
  '빈 M번호와 미확정 행은 목록 합계에서 뺀다',
)
assert(
  unresolvedList.entries.map((item) => item.styleNo).join(',') === 'M0020,M0100',
  '확정 M번호만 남기고 번호순으로 정렬한다',
)

function stockPosition(
  row: Pick<WarehouseStockPosition, 'styleNo' | 'locationCode' | 'zone'> &
    Partial<WarehouseStockPosition>,
): WarehouseStockPosition {
  return {
    id: `${row.styleNo}-${row.locationCode}-${row.sourceRowNumber ?? 1}`,
    brandId: 'brand',
    setId: 'set',
    warehouseId: 'wh',
    locationId: 'loc',
    styleId: null,
    styleName: row.styleName ?? row.styleNo,
    sourceStyleNo: row.styleNo,
    sourceProductName: row.styleName ?? row.styleNo,
    receivedOn: row.receivedOn ?? '2026-01-01',
    receivedOnRaw: '260101',
    isForcedPriority: false,
    isFinalLocation: false,
    unitsPerBox: 1,
    remainingBoxes: row.remainingBoxes ?? 0,
    openedUnits: row.openedUnits ?? 0,
    reviewFlags: [],
    sourceRowNumber: 1,
    note: '',
    usageRank: null,
    createdAt: '',
    updatedAt: '',
    ...row,
  }
}

assert(
  extractWarehouseLocationZonePrefix('2-1-6') === '2',
  '2-1-6의 구역은 2다',
)
assert(extractWarehouseLocationZonePrefix('A1') === 'A', 'A1의 구역은 A다')
assert(
  extractWarehouseLocationZonePrefix('') === UNSPECIFIED_LOCATION_ZONE,
  '빈 자리 구역은 미지정이다',
)

const fifoLines = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M1000', styleName: '미니백', quantity: 50 }],
  zone: 'box_storage',
  positions: [
    stockPosition({
      styleNo: 'M1000',
      zone: 'box_storage',
      locationCode: '2-9-9',
      isFinalLocation: true,
      receivedOn: '2024-01-01',
      remainingBoxes: 100,
      sourceRowNumber: 3,
    }),
    stockPosition({
      styleNo: 'M1000',
      zone: 'box_storage',
      locationCode: '2-1-6',
      receivedOn: '2025-01-01',
      remainingBoxes: 60,
      sourceRowNumber: 2,
    }),
    stockPosition({
      styleNo: 'M1000',
      zone: 'box_storage',
      locationCode: '2-8-3',
      isForcedPriority: true,
      receivedOn: null,
      remainingBoxes: 40,
      sourceRowNumber: 1,
    }),
  ],
})
assert(
  fifoLines.lines.map((item) => `${item.locationLabel}:${item.quantity}`).join(',') ===
    '2-1-6:10,2-8-3:40',
  '강제우선 자리를 먼저 채운 뒤 표시는 자리번호순이다',
)
assert(
  fifoLines.totalAllocated === 50 && fifoLines.totalShortage === 0,
  'FIFO로 50개를 모두 채운다',
)

const splitLines = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M0048', styleName: '미니 데일리백팩 블랙', quantity: 120 }],
  zone: 'box_storage',
  positions: [
    stockPosition({
      styleNo: 'M0048',
      zone: 'box_storage',
      locationCode: '3-8-3',
      receivedOn: '2026-01-15',
      remainingBoxes: 100,
    }),
    stockPosition({
      styleNo: 'M0048',
      zone: 'box_storage',
      locationCode: '5-1-11',
      receivedOn: '2026-01-16',
      remainingBoxes: 80,
    }),
  ],
})
assert(
  splitLines.lines.map((item) => `${item.locationLabel}:${item.quantity}`).join(',') ===
    '3-8-3:100,5-1-11:20',
  '한 자리 재고가 부족하면 다음 자리로 나눈다',
)

const mergedLocation = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M0100', styleName: '스트랩', quantity: 50 }],
  zone: 'box_storage',
  positions: [
    stockPosition({
      styleNo: 'M0100',
      zone: 'box_storage',
      locationCode: '2-1-6',
      receivedOn: '2026-01-01',
      remainingBoxes: 30,
      sourceRowNumber: 1,
    }),
    stockPosition({
      styleNo: 'M0100',
      zone: 'box_storage',
      locationCode: '2-1-6',
      receivedOn: '2026-01-02',
      remainingBoxes: 40,
      sourceRowNumber: 2,
    }),
  ],
})
assert(
  mergedLocation.lines.length === 1 &&
    mergedLocation.lines[0]?.locationLabel === '2-1-6' &&
    mergedLocation.lines[0]?.quantity === 50,
  '같은 자리의 여러 입고 배치는 한 행으로 합친다',
)

const pickingOnly = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M2000', styleName: '파우치', quantity: 10 }],
  zone: 'picking',
  positions: [
    stockPosition({
      styleNo: 'M2000',
      zone: 'picking',
      locationCode: 'A1',
      remainingBoxes: 10,
    }),
    stockPosition({
      styleNo: 'M2000',
      zone: 'box_storage',
      locationCode: '4-1-1',
      remainingBoxes: 10,
    }),
  ],
})
assert(
  pickingOnly.lines.length === 1 && pickingOnly.lines[0]?.locationLabel === 'A1',
  '출고창고용은 picking 자리만 쓴다',
)
const boxOnly = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M2000', styleName: '파우치', quantity: 10 }],
  zone: 'box_storage',
  positions: [
    stockPosition({
      styleNo: 'M2000',
      zone: 'picking',
      locationCode: 'A1',
      remainingBoxes: 10,
    }),
    stockPosition({
      styleNo: 'M2000',
      zone: 'box_storage',
      locationCode: '4-1-1',
      remainingBoxes: 10,
    }),
  ],
})
assert(
  boxOnly.lines.length === 1 && boxOnly.lines[0]?.locationLabel === '4-1-1',
  '박스창고용은 box_storage 자리만 쓴다',
)

const shortage = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M3000', styleName: '키링', quantity: 100 }],
  zone: 'picking',
  positions: [
    stockPosition({
      styleNo: 'M3000',
      zone: 'picking',
      locationCode: 'B2',
      remainingBoxes: 30,
    }),
  ],
})
assert(
  shortage.totalAllocated === 30 &&
    shortage.totalShortage === 70 &&
    shortage.stylesWithShortage === 1,
  '창고 재고가 부족하면 남은 수량을 미지정으로 둔다',
)
assert(
  shortage.lines.some(
    (item) =>
      item.isShortage &&
      item.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE &&
      item.quantity === 70,
  ),
  '부족 수량은 미지정 행이다',
)
assert(
  shortage.groups.map((item) => item.locationZonePrefix).join(',') ===
    `B,${UNSPECIFIED_LOCATION_ZONE}`,
  '미지정 구역은 마지막이다',
)

const grouped = allocateInvoiceProductListWarehouse({
  entries: [
    { styleNo: 'M0001', styleName: 'A', quantity: 1 },
    { styleNo: 'M0002', styleName: 'B', quantity: 1 },
    { styleNo: 'M0003', styleName: 'C', quantity: 1 },
    { styleNo: 'M0004', styleName: 'D', quantity: 1 },
  ],
  zone: 'picking' satisfies WarehouseZone,
  positions: [
    stockPosition({
      styleNo: 'M0001',
      zone: 'picking',
      locationCode: '10-1-1',
      remainingBoxes: 1,
    }),
    stockPosition({
      styleNo: 'M0002',
      zone: 'picking',
      locationCode: '2-8-3',
      remainingBoxes: 1,
    }),
    stockPosition({
      styleNo: 'M0003',
      zone: 'picking',
      locationCode: 'A1',
      remainingBoxes: 1,
    }),
    stockPosition({
      styleNo: 'M0004',
      zone: 'picking',
      locationCode: '4-3-9',
      remainingBoxes: 1,
    }),
  ],
})
assert(
  grouped.groups.map((item) => item.locationZonePrefix).join(',') === '2,4,10,A',
  '위치 구역은 자연 오름차순이고 미지정이 아니면 숫자 다음 문자다',
)
assert(
  grouped.lines.map((item) => item.locationLabel).join(',') ===
    '2-8-3,4-3-9,10-1-1,A1',
  '자리번호는 자연 오름차순이다',
)

const longZone = Array.from({ length: 27 }, (_, index) => ({
  styleNo: `M${String(index + 1).padStart(4, '0')}`,
  styleName: `상품${index + 1}`,
  quantity: 1,
}))
const longAllocation = allocateInvoiceProductListWarehouse({
  entries: longZone,
  zone: 'picking',
  positions: longZone.map((item, index) =>
    stockPosition({
      styleNo: item.styleNo,
      zone: 'picking',
      locationCode: `2-1-${index + 1}`,
      remainingBoxes: 1,
    }),
  ),
})
const extraZone = allocateInvoiceProductListWarehouse({
  entries: [{ styleNo: 'M9000', styleName: '다른구역', quantity: 1 }],
  zone: 'picking',
  positions: [
    stockPosition({
      styleNo: 'M9000',
      zone: 'picking',
      locationCode: '3-1-1',
      remainingBoxes: 1,
    }),
  ],
})
const mixedGroups = [...longAllocation.groups, ...extraZone.groups]
const defaultLayout = buildDefaultInvoiceProductListPrintLayout(
  mixedGroups,
  'picking',
)
assert(
  defaultLayout.routeGroups.length === 1 &&
    defaultLayout.routeGroups[0]?.zonePrefixes.join(',') === '2,3',
  '기본 동선은 구역을 한 묶음으로 자연순 배치한다',
)
const printPages = buildInvoiceProductListPrintPages({
  groups: mixedGroups,
  warehouseLabel: '출고창고용',
  layout: defaultLayout,
  printedAt: new Date(2026, 7, 27),
})
assert(printPages.length === 2, '같은 묶음의 큰 구역 분할과 작은 구역은 2장이다')
assert(
  printPages[0]?.printedOn === '26.08.27' &&
    printPages[0]?.locationZonePrefix === '2' &&
    printPages[0]?.slots.length === INVOICE_PRODUCT_LIST_PRINT_ROWS &&
    printPages[0]?.slots.filter((slot) => slot.kind === 'item').length === 25 &&
    printPages[0]?.slots[0]?.kind === 'header',
  '첫 페이지는 날짜와 구역 제목 뒤 25행을 채운다',
)
assert(
  printPages[1]?.segments.map((item) => item.locationZonePrefix).join(',') ===
    '2,3' &&
    printPages[1]?.segments[0]?.continued === true &&
    printPages[1]?.slots.filter((slot) => slot.kind === 'item').length === 3,
  '큰 구역의 남은 행은 계속으로 이어지고 작은 구역을 같은 장에 붙인다',
)

const splitLayout = {
  zone: 'picking' as const,
  routeGroups: [
    { id: 'a', zonePrefixes: ['2'] },
    { id: 'b', zonePrefixes: ['3'] },
  ],
}
const splitPages = buildInvoiceProductListPrintPages({
  groups: mixedGroups,
  warehouseLabel: '출고창고용',
  layout: splitLayout,
  printedAt: new Date(2026, 7, 27),
})
assert(splitPages.length === 3, '다른 동선 묶음은 새 페이지에서 시작한다')
assert(
  splitPages[2]?.locationZonePrefix === '3' &&
    splitPages[2]?.routeGroupLabel === '3' &&
    splitPages[2]?.globalPageIndex === 3,
  '묶음이 바뀌면 잔여 칸이 있어도 새 장이다',
)

const tinyGroups = allocateInvoiceProductListWarehouse({
  entries: [
    { styleNo: 'M8001', styleName: '작은1', quantity: 2 },
    { styleNo: 'M8002', styleName: '작은2', quantity: 2 },
  ],
  zone: 'picking',
  positions: [
    stockPosition({
      styleNo: 'M8001',
      zone: 'picking',
      locationCode: '2-1-1',
      remainingBoxes: 2,
    }),
    stockPosition({
      styleNo: 'M8002',
      zone: 'picking',
      locationCode: '3-1-1',
      remainingBoxes: 2,
    }),
  ],
})
const packedTiny = buildInvoiceProductListPrintPages({
  groups: tinyGroups.groups,
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'walk', zonePrefixes: ['2', '3'] }],
  },
})
assert(
  packedTiny.length === 1 &&
    packedTiny[0]?.segments.length === 2 &&
    packedTiny[0]?.slots.filter((slot) => slot.kind === 'header').length === 2,
  '작은 구역 두 개는 한 장에 묶인다',
)

const keepTogether = buildInvoiceProductListPrintPages({
  groups: [
    {
      locationZonePrefix: '2',
      quantity: 20,
      styleCount: 20,
      lines: Array.from({ length: 20 }, (_, index) => ({
        styleNo: `M8${String(index).padStart(3, '0')}`,
        styleName: `상품${index}`,
        locationCode: `2-1-${index + 1}`,
        locationLabel: `2-1-${index + 1}`,
        locationZonePrefix: '2',
        quantity: 1,
        isShortage: false,
      })),
    },
    {
      locationZonePrefix: '3',
      quantity: 10,
      styleCount: 10,
      lines: Array.from({ length: 10 }, (_, index) => ({
        styleNo: `M9${String(index).padStart(3, '0')}`,
        styleName: `다음${index}`,
        locationCode: `3-1-${index + 1}`,
        locationLabel: `3-1-${index + 1}`,
        locationZonePrefix: '3',
        quantity: 1,
        isShortage: false,
      })),
    },
  ],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'keep', zonePrefixes: ['2', '3'] }],
  },
})
assert(
  keepTogether.length === 2 &&
    keepTogether[0]?.segments.map((item) => item.locationZonePrefix).join(',') ===
      '2' &&
    keepTogether[1]?.segments.map((item) => item.locationZonePrefix).join(',') ===
      '3',
  '작은 구역 전체가 남은 칸에 안 들어가면 다음 장으로 통째 넘긴다',
)

const routeOrder = buildDefaultInvoiceProductListPrintLayout(
  grouped.groups,
  'picking',
)
assert(
  routeOrder.routeGroups[0]?.zonePrefixes.join(',') === '2,4,10,A',
  '기본 동선 순서는 위치 구역 자연순이다',
)
const moved = moveInvoiceProductListZonePrefix(
  routeOrder,
  'A',
  routeOrder.routeGroups[0]!.id,
  0,
)
assert(
  moved.routeGroups[0]?.zonePrefixes.join(',') === 'A,2,4,10',
  '같은 묶음 안에서 구역 순서를 바꿀 수 있다',
)
const reconciled = reconcileInvoiceProductListPrintLayout(
  grouped.groups.filter((group) => group.locationZonePrefix !== '10'),
  {
    zone: 'picking',
    routeGroups: [{ id: 'keep', zonePrefixes: ['2', 'X', '4'] }],
  },
)
assert(
  reconciled.routeGroups.map((item) => item.zonePrefixes.join('·')).join('|') ===
    '2·4|A',
  '사라진 구역은 빼고 새 구역은 뒤에 붙인다',
)
const reconciledEmpty = reconcileInvoiceProductListPrintLayout(
  grouped.groups,
  {
    zone: 'picking',
    routeGroups: [
      { id: 'keep', zonePrefixes: ['2', '4'] },
      { id: 'empty', zonePrefixes: [] },
    ],
  },
)
assert(
  reconciledEmpty.routeGroups.some(
    (group) => group.id === 'empty' && group.zonePrefixes.length === 0,
  ) &&
    reconciledEmpty.routeGroups.map((item) => item.zonePrefixes.join('·')).join('|') ===
      '2·4||10|A',
  '사용자가 만든 빈 카드는 유지하고 새 구역은 뒤에 붙인다',
)
const splitCards = addInvoiceProductListRouteGroup(routeOrder)
const movedToCard = moveInvoiceProductListZonePrefix(
  splitCards,
  'A',
  splitCards.routeGroups[1]!.id,
)
assert(
  movedToCard.routeGroups[0]?.zonePrefixes.join(',') === '2,4,10' &&
    movedToCard.routeGroups[1]?.zonePrefixes.join(',') === 'A',
  '칩을 다른 카드로 옮기면 그 카드에만 남는다',
)
const splitSections = buildInvoiceProductListPrintRouteSections(
  grouped.groups,
  movedToCard,
)
assert(
  splitSections.map((item) => item.label).join('|') === '2·4·10|A',
  '카드에 있는 구역만 한 섹션으로 이어진다',
)
const perZoneLayout = applyInvoiceProductListRouteSplitMode(
  grouped.groups,
  routeOrder,
  'per_zone',
)
assert(
  perZoneLayout.splitMode === 'per_zone' &&
    perZoneLayout.routeGroups.map((item) => item.zonePrefixes.join(',')).join('|') ===
      '2|4|10|A',
  '구역별 분해는 창고용 기본값으로 구역마다 카드를 만든다',
)
const groupedAgain = applyInvoiceProductListRouteSplitMode(
  grouped.groups,
  perZoneLayout,
  'grouped',
)
assert(
  groupedAgain.splitMode === 'grouped' &&
    groupedAgain.routeGroups.length === 1 &&
    groupedAgain.routeGroups[0]?.zonePrefixes.join(',') === '2,4,10,A',
  '한 카드로 되돌리면 그 창고 구역을 다시 한 묶음으로 둔다',
)
const reconciledPerZone = reconcileInvoiceProductListPrintLayout(
  grouped.groups,
  { zone: 'picking', splitMode: 'per_zone', routeGroups: [] },
)
assert(
  reconciledPerZone.splitMode === 'per_zone' &&
    reconciledPerZone.routeGroups.length === 4,
  '빈 레이아웃을 맞출 때도 창고용 구역별 설정을 유지한다',
)
const shortageLast = buildInvoiceProductListPrintPages({
  groups: shortage.groups,
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'front', zonePrefixes: [UNSPECIFIED_LOCATION_ZONE, 'B'] }],
  },
})
assert(
  shortageLast.at(-1)?.locationZonePrefix === UNSPECIFIED_LOCATION_ZONE &&
    shortageLast.at(-1)?.segments.every((item) => item.isShortage),
  '미지정은 동선 편집과 관계없이 마지막이다',
)

function printGroup(prefix: string, count: number) {
  return {
    locationZonePrefix: prefix,
    quantity: count,
    styleCount: count,
    lines: Array.from({ length: count }, (_, index) => ({
      styleNo: `M${prefix}${String(index).padStart(3, '0')}`,
      styleName: `${prefix}-${index}`,
      locationCode: `${prefix}-1-${index + 1}`,
      locationLabel: `${prefix}-1-${index + 1}`,
      locationZonePrefix: prefix,
      quantity: 1,
      isShortage: false,
    })),
  }
}

assert(
  printPages[0]?.columnMode === 'vertical_1' &&
    printPages[0]?.columns.length === 1 &&
    printPages[0]?.columns[0]?.slots.length === INVOICE_PRODUCT_LIST_PRINT_ROWS,
  '세로 1단은 칸 하나짜리 물리 용지로 유지한다',
)

const twoColumnKeep = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 20), printGroup('3', 10)],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'keep', zonePrefixes: ['2', '3'] }],
  },
  columnMode: 'vertical_2',
})
assert(
  twoColumnKeep.length === 1 &&
    twoColumnKeep[0]?.orientation === 'portrait' &&
    twoColumnKeep[0]?.columns.length === 2 &&
    twoColumnKeep[0]?.columns[0]?.segments
      .map((item) => item.locationZonePrefix)
      .join(',') === '2' &&
    twoColumnKeep[0]?.columns[1]?.segments
      .map((item) => item.locationZonePrefix)
      .join(',') === '3',
  '세로 2단은 왼쪽 칸을 채운 뒤 오른쪽 칸으로 간다',
)

const threeColumnPack = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 23), printGroup('3', 23), printGroup('4', 2)],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'walk', zonePrefixes: ['2', '3', '4'] }],
  },
  columnMode: 'horizontal_3',
})
assert(
  threeColumnPack.length === 1 &&
    threeColumnPack[0]?.orientation === 'landscape' &&
    threeColumnPack[0]?.columns.length === 3 &&
    threeColumnPack[0]?.columns[0]?.segments[0]?.locationZonePrefix === '2' &&
    threeColumnPack[0]?.columns[1]?.segments[0]?.locationZonePrefix === '3' &&
    threeColumnPack[0]?.columns[2]?.segments[0]?.locationZonePrefix === '4' &&
    threeColumnPack[0]?.columns[0]?.slots.length ===
      INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS,
  '가로 3단은 왼쪽부터 칸을 채우고 가로 용지 행 수를 채운다',
)

const longName72 = printGroup('2', 72)
longName72.lines[0]!.styleName = '미니 글로시 벨티드 플랩백팩 다크그레이'
assert(
  chooseInvoiceProductListFitRows([longName72], 'horizontal_3') === 25 &&
    maxInvoiceProductListFitRows('horizontal_3') >= 25,
  '가로 3단은 7pt 한도 안에서 72종을 칸당 25행으로 맞출 수 있다',
)
const fitted72 = buildInvoiceProductListPrintPages({
  groups: [longName72],
  warehouseLabel: '박스창고용',
  layout: {
    zone: 'box_storage',
    routeGroups: [{ id: 'zone-2', zonePrefixes: ['2'] }],
  },
  columnMode: 'horizontal_3',
  autoFit: true,
})
assert(
  fitted72.length === 1 &&
    fitted72[0]?.fit.rowsPerColumn === 25 &&
    fitted72[0]?.columns[0]?.slots.filter((slot) => slot.kind === 'item')
      .length === 24 &&
    fitted72[0]?.fit.fontPt >= INVOICE_PRODUCT_LIST_MIN_FONT_PT &&
    fitted72[0]?.fit.columnWidthPercents[3] > 48,
  '72종 구역은 가로 3단에서 상품명을 유지한 채 1장으로 맞춘다',
)
assert(
  buildInvoiceProductListPrintPages({
    groups: [longName72],
    warehouseLabel: '박스창고용',
    columnMode: 'horizontal_3',
  }).length === 2,
  '자동 맞춤을 끄면 72종 가로 3단은 기본 행 수로 2장이다',
)
const hugeZone = printGroup('2', 200)
const fittedHuge = buildInvoiceProductListPrintPages({
  groups: [hugeZone],
  warehouseLabel: '박스창고용',
  columnMode: 'horizontal_3',
  autoFit: true,
})
assert(
  fittedHuge.length > 1 &&
    fittedHuge[0]?.fit.rowsPerColumn === INVOICE_PRODUCT_LIST_LANDSCAPE_ROWS &&
    fittedHuge.every(
      (page) => page.fit.fontPt >= INVOICE_PRODUCT_LIST_MIN_FONT_PT,
    ),
  '한 장에 못 넣는 큰 구역은 최소 글자 크기를 지키고 다음 장으로 이어간다',
)
const fittedSplitCards = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 72), printGroup('3', 3)],
  warehouseLabel: '박스창고용',
  layout: {
    zone: 'box_storage',
    routeGroups: [
      { id: 'a', zonePrefixes: ['2'] },
      { id: 'b', zonePrefixes: ['3'] },
    ],
  },
  columnMode: 'horizontal_3',
  autoFit: true,
})
assert(
  scopeInvoiceProductListPrintPages(fittedSplitCards, 'a').length === 1 &&
    scopeInvoiceProductListPrintPages(fittedSplitCards, 'b').length === 1 &&
    fittedSplitCards[1]?.routeGroupIndex === 2 &&
    fittedSplitCards[1]?.routeGroupId === 'b',
  '카드별 자동 맞춤 후에도 묶음 순번과 카드 장수가 맞는다',
)
const wideNameFit = buildInvoiceProductListPrintFitProfile(
  [longName72],
  'horizontal_3',
  25,
)
assert(
  wideNameFit.fontPt >= INVOICE_PRODUCT_LIST_MIN_FONT_PT &&
    wideNameFit.columnWidthPercents[3] > wideNameFit.columnWidthPercents[2],
  '상품명 열은 다른 열의 최소 폭을 남기고 넓힌다',
)

const consecutiveShort = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 2), printGroup('3', 2)],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'walk', zonePrefixes: ['2', '3'] }],
  },
  columnMode: 'vertical_2',
})
assert(
  consecutiveShort.length === 1 &&
    consecutiveShort[0]?.columns[0]?.segments.length === 2 &&
    consecutiveShort[0]?.columns[1]?.segments.length === 0,
  '짧은 구역은 같은 칸에 제목행을 넣고 이어 붙인다',
)

const continuedLarge = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 40)],
  warehouseLabel: '출고창고용',
  columnMode: 'vertical_2',
})
assert(
  continuedLarge.length === 1 &&
    continuedLarge[0]?.columns[0]?.segments[0]?.continued === false &&
    continuedLarge[0]?.columns[1]?.segments[0]?.continued === true &&
    continuedLarge[0]?.columns[1]?.slots.filter((slot) => slot.kind === 'item')
      .length === 15,
  '큰 구역만 다음 칸에서 계속으로 이어간다',
)

const twoColumnSplit = buildInvoiceProductListPrintPages({
  groups: [printGroup('2', 3), printGroup('3', 3)],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [
      { id: 'a', zonePrefixes: ['2'] },
      { id: 'b', zonePrefixes: ['3'] },
    ],
  },
  columnMode: 'vertical_2',
})
assert(
  twoColumnSplit.length === 2 &&
    twoColumnSplit[0]?.locationZonePrefix === '2' &&
    twoColumnSplit[0]?.columns[1]?.segments.length === 0 &&
    twoColumnSplit[1]?.locationZonePrefix === '3',
  '다단에서도 동선 묶음이 바뀌면 새 물리 용지에서 시작한다',
)
assert(
  twoColumnSplit[0]?.routeGroupId === 'a' &&
    twoColumnSplit[1]?.routeGroupId === 'b' &&
    twoColumnSplit[1]?.routeGroupIndex === 2 &&
    twoColumnSplit[1]?.globalPageIndex === 2,
  '각 출력 장은 동선 카드 ID와 묶음 순번을 유지한다',
)
const scopedSecondCard = scopeInvoiceProductListPrintPages(twoColumnSplit, 'b')
assert(
  scopedSecondCard.length === 1 &&
    scopedSecondCard[0]?.routeGroupId === 'b' &&
    scopedSecondCard[0]?.routeGroupIndex === 2 &&
    scopedSecondCard[0]?.globalPageIndex === 1 &&
    scopedSecondCard[0]?.globalPageCount === 1 &&
    scopedSecondCard[0]?.locationZonePrefix === '3',
  '선택한 카드만 추려 1/N으로 다시 번호를 매기고 묶음 순번은 유지한다',
)
const scopedFirstSplit = scopeInvoiceProductListPrintPages(splitPages, 'a')
assert(
  scopedFirstSplit.length === 2 &&
    scopedFirstSplit[0]?.globalPageIndex === 1 &&
    scopedFirstSplit[1]?.globalPageIndex === 2 &&
    scopedFirstSplit[1]?.globalPageCount === 2 &&
    scopedFirstSplit[0]?.routeGroupIndex === 1 &&
    scopeInvoiceProductListPrintPages(splitPages, 'missing').length === 0,
  '여러 장인 카드는 로컬 페이지 번호를 다시 매긴다',
)
assert(
  resolveInvoiceProductListSelectedRouteGroupId({
    preferredId: 'b',
    availableIds: ['a', 'b'],
    pages: twoColumnSplit,
  }) === 'b' &&
    resolveInvoiceProductListSelectedRouteGroupId({
      preferredId: 'gone',
      availableIds: ['a', 'b'],
      pages: twoColumnSplit,
    }) === 'a' &&
    invoiceProductListSelectableRouteGroupIds(splitLayout, mixedGroups).join(
      ',',
    ) === 'a,b',
  '없는 카드 선택은 첫 출력 가능 카드로 돌아간다',
)

const shortageLastTwoColumn = buildInvoiceProductListPrintPages({
  groups: shortage.groups,
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [
      { id: 'front', zonePrefixes: [UNSPECIFIED_LOCATION_ZONE, 'B'] },
    ],
  },
  columnMode: 'vertical_2',
})
assert(
  shortageLastTwoColumn.at(-1)?.locationZonePrefix ===
    UNSPECIFIED_LOCATION_ZONE &&
    shortageLastTwoColumn
      .at(-1)
      ?.segments.every((item) => item.isShortage),
  '다단에서도 미지정은 항상 마지막이다',
)

const pageCounts = estimateInvoiceProductListPrintPageCounts({
  groups: [printGroup('2', 20), printGroup('3', 10)],
  warehouseLabel: '출고창고용',
  layout: {
    zone: 'picking',
    routeGroups: [{ id: 'keep', zonePrefixes: ['2', '3'] }],
  },
})
assert(
  pageCounts.vertical_1 === 2 &&
    pageCounts.vertical_2 === 1 &&
    pageCounts.horizontal_3 === 1,
  '세 형식의 예상 장수를 계산한다',
)
assert(
  recommendInvoiceProductListColumnMode(pageCounts) === 'vertical_2',
  '가장 적은 장수 형식을 추천한다',
)
assert(
  recommendInvoiceProductListColumnMode({
    vertical_1: 2,
    vertical_2: 2,
    horizontal_3: 2,
  }) === 'vertical_1',
  '장수가 같으면 세로 1단을 추천한다',
)

const parsedPreset = parseInvoiceProductListRoutePresetGroups([
  { zonePrefixes: ['2', UNSPECIFIED_LOCATION_ZONE, '4', '2', ''] },
  { zonePrefixes: ['X'] },
  { zonePrefixes: [] },
  { notGroups: true },
  'skip',
])
assert(
  parsedPreset.map((item) => item.zonePrefixes.join(',')).join('|') ===
    '2,4|X',
  '동선 JSON은 빈 값·미지정·중복을 빼고 카드 순서를 유지한다',
)
assert(
  parseInvoiceProductListRoutePresetGroups({ zonePrefixes: ['2'] }).length ===
    0,
  '배열이 아닌 동선 JSON은 빈 목록이다',
)

const serializedPreset = serializeInvoiceProductListRouteGroups({
  zone: 'picking',
  splitMode: 'grouped',
  routeGroups: [
    { id: 'a', zonePrefixes: ['2', UNSPECIFIED_LOCATION_ZONE, '4'] },
    { id: 'empty', zonePrefixes: [] },
    { id: 'b', zonePrefixes: ['10'] },
  ],
})
assert(
  serializedPreset.map((item) => item.zonePrefixes.join(',')).join('|') ===
    '2,4|10',
  '현재 카드에서 미지정과 빈 카드를 빼고 동선으로 저장한다',
)

const appliedPreset = applyInvoiceProductListRoutePreset(
  grouped.groups,
  'picking',
  [
    { zonePrefixes: ['4', 'X', UNSPECIFIED_LOCATION_ZONE] },
    { zonePrefixes: ['10'] },
  ],
)
assert(
  appliedPreset.splitMode === 'grouped' &&
    appliedPreset.routeGroups
      .map((item) => item.zonePrefixes.join(','))
      .join('|') === '4|10|2|A',
  '동선에 있는 현재 구역만 카드 순서를 유지하고 나머지는 뒤에 붙인다',
)

const appliedShortage = applyInvoiceProductListRoutePreset(
  shortage.groups,
  'picking',
  [{ zonePrefixes: [UNSPECIFIED_LOCATION_ZONE, 'B'] }],
)
assert(
  appliedShortage.routeGroups.every(
    (item) => !item.zonePrefixes.includes(UNSPECIFIED_LOCATION_ZONE),
  ) &&
    appliedShortage.routeGroups.map((item) => item.zonePrefixes.join(',')).join(
      '|',
    ) === 'B',
  '미지정은 동선 카드에 넣지 않는다',
)
const appliedShortagePages = buildInvoiceProductListPrintPages({
  groups: shortage.groups,
  warehouseLabel: '출고창고용',
  layout: appliedShortage,
})
assert(
  appliedShortagePages.at(-1)?.locationZonePrefix ===
    UNSPECIFIED_LOCATION_ZONE &&
    appliedShortagePages.at(-1)?.routeGroupId ===
      INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
  '동선을 적용해도 미지정은 항상 마지막이다',
)
const scopedShortage = scopeInvoiceProductListPrintPages(
  appliedShortagePages,
  INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
)
assert(
  scopedShortage.length > 0 &&
    scopedShortage[0]?.globalPageIndex === 1 &&
    scopedShortage.every(
      (page) => page.routeGroupId === INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
    ) &&
    invoiceProductListSelectableRouteGroupIds(
      appliedShortage,
      shortage.groups,
    ).at(-1) === INVOICE_PRODUCT_LIST_UNSPECIFIED_ROUTE_ID,
  '미지정 카드도 선택해 그 페이지만 미리보고 출력한다',
)

console.log('option-maps verify ok')
