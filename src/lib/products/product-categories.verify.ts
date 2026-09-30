/**
 * 상품 카테고리 트리·M번호 연결·자사몰 문자열 해석·사방넷 카테고리 가져오기 검증.
 * 실행: npm run verify:product-categories
 */
import {
  buildSabangnetCategoryExportRows,
  prepareSabangnetCategoryImport,
  summarizeSabangnetCategories,
} from '@/lib/codes/sabangnet-category-import'
import {
  buildStyleCategoryIndex,
  categoryListLabel,
  collectCategoryIds,
  countStylesByCategory,
  createStyleCategoryFilter,
  groupStyleCategoryLinks,
  listLeafCategories,
  parseMallCategoryCell,
  resolveCategoryPath,
  UNCATEGORIZED_FILTER,
} from '@/lib/products/product-categories'
import type {
  ProductCategory,
  SabangnetProduct,
  StyleCategoryLink,
} from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function same(actual: unknown, expected: unknown, message: string) {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`${message}\n  실제: ${left}\n  기대: ${right}`)
}

const BRAND = 'brand-1'
let order = 0
function node(
  id: string,
  name: string,
  parentId: string | null,
  isActive = true,
): ProductCategory {
  order += 1
  return {
    id,
    brandId: BRAND,
    parentId,
    name,
    depth: 1,
    sortOrder: order,
    isActive,
    createdAt: '',
    updatedAt: '',
  }
}

const categories: ProductCategory[] = [
  node('bag', 'BAG', null),
  node('bag-tote', 'TOTE', 'bag'),
  node('bag-tote-string', 'String', 'bag-tote'),
  node('bag-tote-etc', 'Etc', 'bag-tote'),
  node('bag-cross', 'CROSS', 'bag'),
  node('bag-cross-halfmoon', 'Halfmoon', 'bag-cross'),
  node('bag-shoulder', 'SHOULDER', 'bag'),
  node('bag-shoulder-etc', 'Etc', 'bag-shoulder'),
  node('pouch', 'POUCH', null),
  node('pouch-strap', 'STRAP', 'pouch'),
  node('apparel', 'APPAREL', null),
  node('apparel-top', 'TOP', 'apparel'),
  node('apparel-top-sweat', 'Sweatshirt', 'apparel-top'),
  node('acc', 'ACCESSORIES', null),
  node('acc-cap', 'CAP', 'acc', false),
]

// 1. 자사몰 문자열 해석
const labels = (raw: string) => parseMallCategoryCell(raw).map((path) => path.label)

same(
  labels(
    'ALL | 홈 메뉴 ALL | BAG | BAG > ALL | BAG > TOTE | BAG > TOTE > All | BAG > TOTE > String',
  ),
  ['BAG > TOTE > String'],
  'ALL·홈 메뉴 ALL·상위 경로·All 칸을 버리고 최하위만 남긴다',
)
same(
  labels(
    'ALL | BAG | BAG > ALL | BAG > SHOULDER | BAG > SHOULDER > All | BAG > SHOULDER > Etc | BAG > TOTE | BAG > TOTE > All | BAG > TOTE > Etc',
  ),
  ['BAG > SHOULDER > Etc', 'BAG > TOTE > Etc'],
  '여러 최하위는 칸에 적힌 순서를 지킨다(첫 번째가 대표)',
)
same(
  labels(
    'ALL | 홈 메뉴 ALL | APPAREL | APPAREL > ALL | APPAREL > TOP | APPAREL > TOP > All | APPAREL > TOP > Sweatshirt | NEW ARRIVAL',
  ),
  ['APPAREL > TOP > Sweatshirt'],
  'NEW ARRIVAL은 진열용이라 버린다',
)
same(labels('ALL | 홈 메뉴 ALL'), [], '진열용 칸만 있으면 빈 목록')
same(labels(''), [], '빈 칸은 빈 목록')
same(
  labels('ALL | 홈 메뉴 ALL | BAG | BAG > ALL | BAG > SHOULDER'),
  ['BAG > SHOULDER'],
  '중간 분류에서 멈춘 경로는 그대로 남겨 판정에 넘긴다',
)
same(
  labels('BAG > TOTE > String | bag >  tote > STRING'),
  ['BAG > TOTE > String'],
  '대소문자·공백만 다른 반복 경로는 하나로 본다',
)

// 2. 트리 판정
const index0 = buildStyleCategoryIndex(categories, [])
const tree = index0.tree
const resolve = (raw: string) =>
  parseMallCategoryCell(raw).map((path) => resolveCategoryPath(tree, path))

same(
  resolve('bag >  tote > STRING').map((path) => [path.status, path.categoryId]),
  [['ok', 'bag-tote-string']],
  '대소문자·공백을 무시하고 트리 경로를 찾는다',
)
same(
  resolve('BAG > SHOULDER').map((path) => path.status),
  ['mid'],
  '하위가 있는 분류는 중간 분류',
)
same(
  resolve('BAG > WALLET > Long').map((path) => path.status),
  ['missing'],
  '트리에 없는 경로',
)
same(
  resolve('ACCESSORIES > CAP').map((path) => path.status),
  ['inactive'],
  '사용 안 함 최하위',
)
same(
  listLeafCategories(tree).map((category) => category.id),
  [
    'bag-tote-string',
    'bag-tote-etc',
    'bag-cross-halfmoon',
    'bag-shoulder-etc',
    'pouch-strap',
    'apparel-top-sweat',
    'acc-cap',
  ],
  '최하위 목록은 트리 순서',
)
same(
  [...collectCategoryIds(tree, 'bag-tote')].sort(),
  ['bag-tote', 'bag-tote-etc', 'bag-tote-string'],
  '하위 포함 id',
)

// 3. M번호 연결 요약·필터·집계
const links: StyleCategoryLink[] = [
  { styleId: 's1', categoryId: 'bag-tote-etc', isPrimary: false, sortOrder: 1 },
  { styleId: 's1', categoryId: 'bag-shoulder-etc', isPrimary: true, sortOrder: 0 },
  { styleId: 's2', categoryId: 'bag-tote-string', isPrimary: true, sortOrder: 0 },
  { styleId: 's3', categoryId: 'pouch-strap', isPrimary: true, sortOrder: 0 },
]
same(
  groupStyleCategoryLinks(links).get('s1'),
  ['bag-shoulder-etc', 'bag-tote-etc'],
  '대표가 먼저 오고 나머지는 순서대로',
)
const index = buildStyleCategoryIndex(categories, links)
same(
  categoryListLabel(tree, index.byStyle.get('s1') ?? []),
  'BAG > SHOULDER > Etc | BAG > TOTE > Etc',
  '여러 카테고리는 가져오기와 같은 표기로 잇는다',
)
const toteFilter = createStyleCategoryFilter(index, 'bag-tote')
assert(toteFilter, 'TOTE 필터 생성')
same(
  ['s1', 's2', 's3', 's4'].filter(toteFilter),
  ['s1', 's2'],
  '추가 분류도 필터에 걸린다',
)
const bagFilter = createStyleCategoryFilter(index, 'bag')
assert(bagFilter, 'BAG 필터 생성')
same(['s1', 's2', 's3', 's4'].filter(bagFilter), ['s1', 's2'], '상위 필터는 하위 포함')
const noneFilter = createStyleCategoryFilter(index, UNCATEGORIZED_FILTER)
assert(noneFilter, '미분류 필터 생성')
same(['s1', 's2', 's3', 's4'].filter(noneFilter), ['s4'], '미분류는 연결 0개')
assert(createStyleCategoryFilter(index, '아우터') === null, '트리에 없는 옛 필터 값은 무시')
assert(createStyleCategoryFilter(index, 'all') === null, '전체는 필터 없음')
const counts = countStylesByCategory(index)
assert(counts.get('bag') === 2, 'BAG은 s1·s2 두 M번호(s1은 한 번만)')
assert(counts.get('bag-tote') === 2, 'TOTE는 s1(추가)·s2')
assert(counts.get('bag-shoulder') === 1, 'SHOULDER는 s1')
assert(counts.get('pouch') === 1 && !counts.has('apparel'), 'POUCH 1, APPAREL 없음')

// 4. 사방넷 카테고리 가져오기
function product(code: string, styleIds: string[]): SabangnetProduct {
  return {
    id: `p-${code}`,
    brandId: BRAND,
    code,
    name: `상품 ${code}`,
    createdAt: '',
    updatedAt: '',
    values: {},
    styles: styleIds.map((styleId) => ({
      styleId,
      styleNo: styleId.toUpperCase(),
      name: styleId,
    })),
  }
}

const products = [
  product('100001', ['a1', 'a2']),
  product('100002', ['b1']),
  product('100003', ['c1']),
  product('100004', ['d1']),
  product('100005', ['e1']),
  product('100006', ['f1']),
  product('100007', ['g1']),
  product('100008', ['h1']),
  product('100009', []),
  product('100011', ['k1']),
  product('100012', ['l1']),
  product('100013', ['m1']),
]
const current = new Map<string, readonly string[]>([
  ['k1', ['bag-tote-string']],
  ['m1', ['pouch-strap']],
])
const TOTE_STRING =
  'ALL | 홈 메뉴 ALL | BAG | BAG > ALL | BAG > TOTE | BAG > TOTE > All | BAG > TOTE > String'
const fileRows = [
  ['사방넷 코드', '카테고리', ''],
  ['100001', 'ALL | BAG | BAG > SHOULDER | BAG > SHOULDER > Etc | BAG > TOTE > Etc'],
  ['100002', TOTE_STRING],
  ['100002', TOTE_STRING],
  ['100003', TOTE_STRING],
  ['100003', 'POUCH > STRAP'],
  ['100004', 'ALL | 홈 메뉴 ALL'],
  ['100005', ''],
  ['100006', 'ALL | 홈 메뉴 ALL | BAG | BAG > ALL | BAG > SHOULDER'],
  ['100007', 'BAG > WALLET > Long'],
  ['100008', 'ACCESSORIES > CAP'],
  ['100009', TOTE_STRING],
  ['100010', TOTE_STRING],
  ['100011', TOTE_STRING],
  ['100012', ''],
  ['100012', 'POUCH > STRAP | NEW ARRIVAL'],
  ['', ''],
  ['', 'POUCH > STRAP'],
]
const prepared = prepareSabangnetCategoryImport({
  rows: fileRows,
  tree,
  products,
  categoriesByStyle: current,
})
assert(prepared.ok, '헤더를 찾는다')
const byCode = new Map(prepared.rows.map((row) => [row.code, row]))
const statusOf = (code: string) => byCode.get(code)?.status

same(
  [
    '100001', '100002', '100003', '100004', '100005', '100006',
    '100007', '100008', '100009', '100010', '100011', '100012',
  ].map(statusOf),
  [
    'ready', 'ready', 'conflict', 'empty', 'empty', 'mid',
    'missing', 'inactive', 'noStyles', 'unknownCode', 'unchanged', 'ready',
  ],
  '코드별 판정',
)
same(
  byCode.get('100001')?.categoryIds,
  ['bag-shoulder-etc', 'bag-tote-etc'],
  '여러 최하위는 파일 순서, 첫 번째가 대표',
)
assert(byCode.get('100001')?.styleCount === 2, '연결 M번호 수')
same(byCode.get('100002')?.lineNos, [3, 4], '같은 내용 중복은 한 줄로 합친다')
same(byCode.get('100012')?.categoryIds, ['pouch-strap'], '빈 칸 중복은 무시하고 채운 줄을 쓴다')
assert(prepared.mergedLines === 2, '합친 줄 수: 100002 1줄 + 100012 1줄')
assert(prepared.counts.ready === 3, '적용 가능 3코드')
assert(prepared.readyStyleCount === 4, '적용 대상 M번호: 2 + 1 + 1')
assert(prepared.counts.unknownCode === 2, '없는 코드 1 + 코드 빈 줄 1')
assert(
  !prepared.rows.some((row) => row.code === '' && row.categoryIds.length > 0),
  '코드 없는 줄은 적용 목록에 들어가지 않는다',
)

const missingHeader = prepareSabangnetCategoryImport({
  rows: [['코드만'], ['100001']],
  tree,
  products,
  categoriesByStyle: current,
})
assert(!missingHeader.ok, '카테고리 헤더가 없으면 오류')

// 5. 사방넷 요약·내려받기 왕복
const summaryIndex = new Map<string, readonly string[]>([
  ['a1', ['bag-tote-string']],
  ['a2', ['bag-tote-string']],
  ['b1', ['bag-tote-string']],
  ['c1', ['pouch-strap']],
])
same(
  summarizeSabangnetCategories(products[0]!, summaryIndex),
  { kind: 'same', categoryIds: ['bag-tote-string'] },
  '연결 M번호가 모두 같으면 same',
)
same(
  summarizeSabangnetCategories(product('x', ['a1', 'c1', 'z1']), summaryIndex),
  { kind: 'mixed', categoryIds: ['bag-tote-string', 'pouch-strap'] },
  'M번호마다 다르면 mixed(합친 목록)',
)
same(summarizeSabangnetCategories(products[3]!, summaryIndex), { kind: 'none' }, '연결 없음은 none')
same(summarizeSabangnetCategories(products[8]!, summaryIndex), { kind: 'noStyles' }, 'M번호 없음')

const exportProducts = [
  products[0]!,
  product('200001', ['a1', 'c1']),
  products[3]!,
  products[8]!,
]
const exported = buildSabangnetCategoryExportRows({
  products: exportProducts,
  tree,
  categoriesByStyle: summaryIndex,
})
same(exported[0]?.slice(0, 2), ['사방넷 코드', '카테고리'], '내려받기 헤더는 가져오기와 같다')
const exportedByCode = new Map(exported.slice(1).map((row) => [row[0], row]))
assert(exportedByCode.get('100001')?.[1] === 'BAG > TOTE > String', '같은 카테고리는 경로 그대로')
assert(exportedByCode.get('200001')?.[1] === '', '혼합은 카테고리 칸을 비운다')
assert(
  exportedByCode.get('200001')?.[3]?.startsWith('M번호마다 다름'),
  '혼합은 확인 칸에 M번호별 값을 적는다',
)
const roundTrip = prepareSabangnetCategoryImport({
  rows: exported,
  tree,
  products: exportProducts,
  categoriesByStyle: summaryIndex,
})
assert(roundTrip.ok, '내려받은 파일을 다시 읽는다')
same(
  roundTrip.rows.map((row) => [row.code, row.status]),
  [
    ['100001', 'unchanged'],
    ['100004', 'empty'],
    ['100009', 'empty'],
    ['200001', 'empty'],
  ],
  '내려받은 파일을 그대로 올리면 아무것도 바꾸지 않는다',
)

console.log('product-categories.verify ok')
