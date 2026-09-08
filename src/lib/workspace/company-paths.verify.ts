/**
 * 회사 경로·legacy 변환 검증.
 * 실행: npx tsx src/lib/workspace/company-paths.verify.ts
 */
import {
  applySearchPatch,
  buildLegacyRedirectHref,
  chinaWorkOrdersPath,
  designColorSamplesPath,
  dataUploadHref,
  draftDetailPath,
  draftNewPath,
  mapLegacyBrandPath,
  productDetailPath,
  productWorkDetailPath,
  withBrandTarget,
  withBrandsFilter,
} from './company-paths'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  productDetailPath('atelier', 'M 1') === '/products/atelier/M%201',
  '상품 상세는 brandSlug + styleNo',
)
assert(
  productWorkDetailPath('planning', 'atelier', 'A1') ===
    '/product-work/planning/atelier/A1',
  '부서 상세도 브랜드를 넣는다',
)
assert(
  draftDetailPath('d1') === '/drafts/d1',
  '기획안 상세는 회사 경로 id만',
)
assert(
  chinaWorkOrdersPath() === '/china/work-orders',
  '중국팀 작업 지시서는 회사 경로',
)
assert(
  designColorSamplesPath() === '/design/color-samples',
  '디자인 컬러샘플 촬영은 회사 경로',
)
assert(
  draftNewPath('atelier', { season: 'none' }) ===
    '/drafts/new?brand=atelier&season=none',
  '새 기획안은 brand 대상',
)
assert(
  dataUploadHref('atelier', { mode: 'single' }) ===
    '/data/upload?brand=atelier&mode=single',
  '업로드는 brand 대상',
)
assert(
  withBrandTarget('/settings/fields', 'atelier') ===
    '/settings/fields?brand=atelier',
  '설정은 brand 대상',
)
assert(
  withBrandsFilter('/products', ['atelier'], ['atelier', 'bbb']) ===
    '/products?brands=atelier',
  '목록 필터는 brands',
)
assert(
  withBrandsFilter('/products', ['atelier', 'bbb'], ['atelier', 'bbb']) ===
    '/products',
  '전체 선택은 brands 생략',
)

const products = mapLegacyBrandPath('atelier', 'products/M01')
assert(
  products.pathname === '/products/atelier/M01' &&
    products.searchPatch.brands === 'atelier',
  '레거시 상품 상세',
)

const draft = mapLegacyBrandPath('atelier', 'drafts/abc')
assert(draft.pathname === '/drafts/abc', '레거시 기획안 상세는 id만')

const newDraft = mapLegacyBrandPath('atelier', 'drafts/new')
assert(
  newDraft.pathname === '/drafts/new' && newDraft.searchPatch.brand === 'atelier',
  '레거시 새 기획안은 대상 브랜드',
)

const season = mapLegacyBrandPath('atelier', 'drafts/season/26SS')
assert(
  season.pathname === '/drafts' &&
    season.searchPatch.season === '26SS' &&
    season.searchPatch.brands === 'atelier',
  '레거시 시즌 기획안은 필터',
)

const upload = mapLegacyBrandPath('atelier', 'data/upload')
assert(
  upload.pathname === '/data/upload' && upload.searchPatch.brand === 'atelier',
  '레거시 업로드는 대상',
)

const settings = mapLegacyBrandPath('atelier', 'settings/fields')
assert(
  settings.pathname === '/settings/fields' &&
    settings.searchPatch.brand === 'atelier',
  '레거시 설정은 대상',
)

const invoice = mapLegacyBrandPath('atelier', 'logistics/invoices')
assert(
  invoice.pathname === '/logistics/invoices' &&
    invoice.searchPatch.brand === 'atelier',
  '레거시 송장은 작업 세션 브랜드',
)

const profile = mapLegacyBrandPath('atelier', 'settings/profile')
assert(
  profile.pathname === '/settings/profile' && !profile.searchPatch.brand,
  '내 설정은 회사 경로',
)

const href = buildLegacyRedirectHref(
  'atelier',
  'products',
  '?q=bag&brands=old',
)
assert(
  href.includes('/products') && href.includes('brands=atelier') && href.includes('q=bag'),
  '레거시 리다이렉트는 검색을 유지하고 브랜드를 덮어쓴다',
)

const patched = applySearchPatch(new URLSearchParams('q=1&brand=x'), {
  brand: null,
  brands: 'atelier',
})
assert(
  patched.get('q') === '1' &&
    patched.get('brands') === 'atelier' &&
    !patched.has('brand'),
  'search patch는 빈 값을 지운다',
)

console.log('company-paths.verify ok')
