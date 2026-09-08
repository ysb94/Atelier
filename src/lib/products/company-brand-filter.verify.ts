/**
 * 회사 통합 상품 브랜드 필터 검증.
 * 실행: npx tsx src/lib/products/company-brand-filter.verify.ts
 */
import {
  parseBrandsParam,
  resolveBrandSelection,
  serializeBrandSelection,
  toggleBrandSlug,
} from './company-brand-filter'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(parseBrandsParam(null) === 'all', '파라미터 없음은 전체')
assert(parseBrandsParam('') === 'all', '빈 값은 전체')
assert(parseBrandsParam('none') === 'none', 'none은 선택 없음')
assert(
  (parseBrandsParam('masmarulez,atelier,masmarulez') as string[]).join(',') ===
    'masmarulez,atelier',
  '중복 slug 제거',
)

const available = ['atelier', 'masmarulez']

const all = resolveBrandSelection(null, available)
assert(all.isAll, '없음은 전체 선택')
assert(all.slugs.join(',') === 'atelier,masmarulez', '전체는 접근 가능 브랜드')
assert(!all.canEdit, '복수 전체는 조회 전용')

const none = resolveBrandSelection('none', available)
assert(none.isNone && none.slugs.length === 0, 'none은 0개')
assert(!none.canEdit, '0개는 수정 불가')

const single = resolveBrandSelection('masmarulez', available)
assert(single.canEdit, '단일 선택은 수정 가능')
assert(single.slugs.join(',') === 'masmarulez', '단일 slug 유지')

const multi = resolveBrandSelection('atelier,masmarulez', available)
assert(!multi.canEdit && multi.isAll, '접근 가능 전부 선택은 전체와 같음')

const unknown = resolveBrandSelection('ghost,atelier', available)
assert(unknown.slugs.join(',') === 'atelier', '알 수 없는 slug 무시')
assert(unknown.canEdit, '유효 slug가 하나면 수정 가능')

assert(serializeBrandSelection(available, available) == null, '전체는 URL에서 생략')
assert(serializeBrandSelection([], available) === 'none', '0개는 none')
assert(
  serializeBrandSelection(['masmarulez'], available) === 'masmarulez',
  '부분 선택은 slug 나열',
)

const onlyOne = resolveBrandSelection(null, ['atelier'])
assert(onlyOne.canEdit, '브랜드가 하나면 전체 조회도 수정 가능')

assert(
  toggleBrandSlug(['atelier'], 'masmarulez').join(',') === 'atelier,masmarulez',
  '체크 추가',
)
assert(toggleBrandSlug(['atelier', 'masmarulez'], 'atelier').join(',') === 'masmarulez', '체크 해제')

console.log('company-brand-filter.verify ok')
