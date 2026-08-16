/**
 * 제품군·색상·사이즈 분해 매칭 검증.
 * 실행: npm run verify:style-parts
 */
import { compactProductNameKey } from '@/lib/invoice/lookup-normalization'
import { learnLedgerAliases } from '@/lib/invoice/ledger-aliases'
import {
  catalogFromStyles,
  transformInvoiceProductNames,
} from '@/lib/invoice/product-name-transform'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import {
  buildStylePartsIndex,
  detectSizeInText,
  parseStyleName,
  stylePartsLookupKey,
} from '@/lib/invoice/style-name-parts'
import type { SabangnetOrderRow } from '@/lib/invoice/sabangnet'
import type { InvoiceProductNameMap, StyleRef } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, styleNo: string, name: string): StyleRef {
  return { styleId: id, styleNo, name }
}

function row(input: {
  rowNumber: number
  productName: string
  itemName: string
  mallName?: string
}): SabangnetOrderRow {
  return {
    rowNumber: input.rowNumber,
    productName: input.productName,
    itemName: input.itemName,
    quantity: '1',
    recipientName: '',
    recipientPhone: '',
    recipientOtherPhone: '',
    shippingType: '',
    recipientAddress: '',
    shippingMessage: '',
    customerOrderNo: '',
    mallName: input.mallName ?? '스마트스토어',
    orderedAt: '',
    ownProductCode: '',
  }
}

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

// --- 공식명 분해 ---
const greenCap = parseStyleName('볼 캡 그린')
assert(greenCap?.familyRaw === '볼 캡', '볼 캡 제품군')
assert(greenCap?.colorRaw === '그린', '볼 캡 색상')
assert(greenCap?.size === null, '볼 캡 사이즈 없음')

const bigLogo = parseStyleName('빅로고 블랙 그레이 S')
assert(bigLogo?.size === 'S', '빅로고 사이즈 S')
// 1패스만으로는 마지막 토큰만 색상. 2패스는 인덱스에서.
assert(bigLogo?.colorRaw === '그레이', '1패스 색상은 마지막 토큰')

const styles = [
  style('s1', 'M0196', '볼 캡 그린'),
  style('s2', 'M0192', '볼 캡 블랙'),
  style('s3', 'M0197', '볼 캡 네이비'),
  style('s4', 'M2318', '빅로고 블랙 그레이 S'),
  style('s5', 'M2319', '빅로고 블랙 그레이 M'),
  style('s6', 'M0592', '스파 머메이드 샴페인핑크'),
  style('s7', 'M2302', '포인트 드로잉 콘치 크롭티셔츠 블랙 F'),
  style('s8', 'M2301', '포인트 드로잉 콘치 크롭티셔츠 화이트 F'),
  // 색상 어휘를 풍부하게 — 블랙·그레이가 단독 색상으로도 존재
  style('s9', 'M9001', '테스트 블랙'),
  style('s10', 'M9002', '테스트 그레이'),
  style('s11', 'M9003', '테스트 샴페인핑크'),
  style('s12', 'M9004', '테스트 화이트'),
]
const index = buildStylePartsIndex(styles)
const bigParts = index.byStyleId.get('s4')
assert(bigParts?.familyKey === compactProductNameKey('빅로고'), '2패스 제품군 빅로고')
assert(
  bigParts?.colorKey === compactProductNameKey('블랙 그레이'),
  '2패스 색상 블랙 그레이',
)
assert(bigParts?.size === 'S', '2패스 사이즈 S')

const spaParts = index.byStyleId.get('s6')
assert(spaParts?.familyKey === compactProductNameKey('스파 머메이드'), '머메이드는 제품군')
assert(
  spaParts?.colorKey === compactProductNameKey('샴페인핑크'),
  '샴페인핑크만 색상',
)

const teeParts = index.byStyleId.get('s7')
assert(teeParts?.size === 'F', '티셔츠 F')
assert(teeParts?.colorKey === compactProductNameKey('블랙'), '티셔츠 블랙')

assert(detectSizeInText('COLOR=BLACK, SIZE=ONE SIZE (F)') === 'F', 'ONE SIZE (F)')
assert(detectSizeInText('Melange Gray/Green : S(F)') === 'S', 'S(F)')
assert(detectSizeInText('선택_(2)=Black/Gray_M(F,)') === 'M', '_M(F)')

assert(
  index.byFamilyColorSize.get(
    stylePartsLookupKey(
      compactProductNameKey('볼 캡'),
      compactProductNameKey('그린'),
      null,
    ),
  )?.[0]?.styleId === 's1',
  '볼 캡 그린 인덱스',
)

// --- 별칭 학습 ---
const green = styles[0]!
const black = styles[1]!
const navy = styles[2]!
const maps = [
  lookupMap('m1', 'MSMRZ Logo Ball cap_12color Color=Green', green),
  lookupMap('m2', 'MSMRZ Logo Ball cap_12color Color=Black', black),
  // 다른 제품군에서도 green→그린 학습되도록
  lookupMap(
    'm3',
    'Other Cap_12color Color=Green',
    style('sx', 'M9991', '다른 캡 그린'),
  ),
  lookupMap(
    'm4',
    'Other Cap_12color Color=Black',
    style('sy', 'M9992', '다른 캡 블랙'),
  ),
]
// 다른 캡도 인덱스에 있어야 학습 시 family가 잡힘
const learnStyles = [
  ...styles,
  style('sx', 'M9991', '다른 캡 그린'),
  style('sy', 'M9992', '다른 캡 블랙'),
]
const learnIndex = buildStylePartsIndex(learnStyles)
const aliases = learnLedgerAliases(maps, learnIndex, { minFamilies: 2 })

assert(
  aliases.colorAliases.get(compactProductNameKey('Green')) ===
    compactProductNameKey('그린'),
  'Green→그린 학습',
)
assert(
  aliases.colorAliases.get(compactProductNameKey('Black')) ===
    compactProductNameKey('블랙'),
  'Black→블랙 학습',
)
assert(
  aliases.bodyToFamily.get(compactProductNameKey('MSMRZ Logo Ball cap_12color')) ===
    compactProductNameKey('볼 캡'),
  '몸통 별칭 MSMRZ→볼 캡',
)

// 선택안함처럼 여러 색에 걸리면 버린다
const noisyMaps = [
  lookupMap('n1', '상품A_선택안함', style('na', 'M8001', '상품A 블랙')),
  lookupMap('n2', '상품B_선택안함', style('nb', 'M8002', '상품B 화이트')),
  lookupMap('n3', '상품C_선택안함', style('nc', 'M8003', '상품C 그레이')),
]
const noisyIndex = buildStylePartsIndex([
  style('na', 'M8001', '상품A 블랙'),
  style('nb', 'M8002', '상품B 화이트'),
  style('nc', 'M8003', '상품C 그레이'),
])
const noisyAliases = learnLedgerAliases(noisyMaps, noisyIndex, {
  minFamilies: 2,
})
assert(
  !noisyAliases.colorAliases.has(compactProductNameKey('선택안함')),
  '선택안함 다의어 별칭 제외',
)

// --- 변환 통합: 학습에 없던 Navy가 붙는지 ---
const catalog = catalogFromStyles(learnStyles, {
  aliases: learnLedgerAliases(
    [
      ...maps,
      // navy 학습용 — 다른 제품군에도 Navy→네이비
      lookupMap(
        'm5',
        'Patch Cap_13 Colors Color=Navy',
        style('sz', 'M9993', '패치 캡 네이비'),
      ),
      lookupMap(
        'm6',
        'Logo Cap Color=Navy',
        navy,
      ),
    ],
    buildStylePartsIndex([
      ...learnStyles,
      style('sz', 'M9993', '패치 캡 네이비'),
    ]),
    { minFamilies: 2 },
  ),
})

const navyRow = transformInvoiceProductNames(
  [
    row({
      rowNumber: 1,
      productName: 'MSMRZ Logo Ball cap_12color',
      itemName: 'Color=Navy',
    }),
  ],
  [], // 원장에 Navy 조회 키 없음
  catalog,
)
assert(
  navyRow.rows[0]?.status === 'candidate' &&
    navyRow.rows[0]?.appliedRule === 'style_parts' &&
    navyRow.rows[0]?.style?.styleId === 's3',
  '학습 없는 Color=Navy도 볼 캡 네이비로 분해 매칭',
)

const greenDirect = transformInvoiceProductNames(
  [
    row({
      rowNumber: 2,
      productName: 'MSMRZ Logo Ball cap_12color',
      itemName: 'Color=Green',
    }),
  ],
  [],
  catalog,
)
assert(
  greenDirect.rows[0]?.status === 'candidate' &&
    greenDirect.rows[0]?.style?.styleId === 's1',
  'Color=Green → 볼 캡 그린',
)

console.log('style-parts verify: ok')
