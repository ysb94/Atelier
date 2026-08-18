/**
 * 품목·옵션 변환 검증. 실행: npm run verify:option-maps
 */
import {
  buildInvoiceOutputRows,
  buildInvoiceStepSnapshot,
} from '@/lib/invoice/invoice-output'
import { transformInvoiceItemNames, buildOutgoingComponentRowsFromStages } from '@/lib/invoice/item-name-transform'
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
} from '@/lib/invoice/option-transform'
import { PRODUCT_NAME_CASES } from '@/lib/invoice/product-name-cases'
import { generateProductNameCandidates } from '@/lib/invoice/product-name-patterns'
import { matchingProductName } from '@/lib/invoice/product-name-tags'
import {
  catalogFromStyles,
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
  ownProductCode: 'CODE-1',
})
assert(
  priorityCandidates.map((item) => item.rule).join(',') ===
    [
      'own_code',
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
  '자체상품코드부터 내품명 전체까지 10단계 우선순위',
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
    ownCodeFirst.rows[0]?.appliedRule === 'own_code' &&
    ownCodeFirst.rows[0]?.style?.styleId === 's-own-code' &&
    ownCodeFirst.rows[0]?.itemNameConsumed !== true,
  '자체상품코드가 품목명보다 먼저 맞는다',
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
      commaPrefixSource.itemName,
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
  action: InvoiceItemNameRule['action']
  components?: InvoiceItemNameRuleComponent[]
}): InvoiceItemNameRule {
  const mainStyle = options.mainStyle ?? null
  return {
    id: options.id,
    brandId: 'brand',
    scope: options.scope ?? 'global',
    mainStyle,
    itemName: options.itemName,
    normalizedItemName: normalizeInvoiceText(options.itemName),
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
    suffixItem.rows[0]?.extras[0]?.style.styleId === tassel.styleId,
  '규칙은 남은 suffix를 기준으로 맞춘다',
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
      `${tassel.name}×2 + ${strap.name}`,
  '본품별 규칙이 공통 규칙보다 우선하고 수량 공식명을 만든다',
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
  mergeItem.rows[0]?.transformedItemName === `${tassel.name}×2` &&
    mergeItem.rows[0]?.extras.map((item) => item.style.styleId).join(',') ===
      `${tassel.styleId},${charm.styleId}` &&
    mergeItem.rows[0]?.extras[0]?.quantity === 2,
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
assert(mergeOrders.length === 3, '규칙 구성품과 기존 세트를 합쳐 CJ 행을 펼친다')
assert(
  mergeOrders.every((line) => line.finalItemName === `${tassel.name}×2`),
  '모든 구성행에 같은 최종 내품명을 복사한다',
)
assert(mergeOrders[0]?.finalProductName === bag.name, '1행 본품')
assert(mergeOrders[1]?.finalProductName === tassel.name, '2행 규칙 구성품')
assert(mergeOrders[2]?.finalProductName === charm.name, '3행 기존 세트 구성품')
assert(mergeOrders[1]?.quantity === '4', '규칙 수량 2 × 주문 2')

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

console.log('option-maps verify ok')
