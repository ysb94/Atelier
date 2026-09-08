/**
 * 회사 기획안 브랜드 미정·변경·PL번호 검증.
 * 실행: npx tsx src/lib/drafts/company-draft.verify.ts
 */
import {
  UNASSIGNED_DRAFT_BRAND,
  UNASSIGNED_DRAFT_OWNER,
  applyDraftBrandChange,
  collectDraftOwnerNames,
  canChangeDraftBrand,
  draftBrandChangeMessage,
  formatDraftNo,
  hasSampleWorkOrder,
  matchesDraftBrandScope,
  matchesDraftOwnerScope,
  nextCompanyDraftNo,
  normalizeDraftBrandId,
  parseDraftNo,
  requiresDraftBrand,
} from './company-draft'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(parseDraftNo('PL-0002') === 2, 'PL-0002 파싱')
assert(parseDraftNo('pl-10') === 10, '대소문자 무시')
assert(formatDraftNo(3) === 'PL-0003', '다음 번호 포맷')
assert(nextCompanyDraftNo(['PL-0002']) === 'PL-0003', '회사 번호는 기존 최댓값에서 이어 간다')
assert(nextCompanyDraftNo([]) === 'PL-0001', '없으면 0001')
assert(canChangeDraftBrand('open'), '검토중만 브랜드 변경')
assert(!canChangeDraftBrand('confirmed'), '확정 후 브랜드 변경 불가')
assert(requiresDraftBrand('confirmed'), '확정은 브랜드 필수')
assert(!requiresDraftBrand('open'), '검토중은 브랜드 미정 가능')
assert(normalizeDraftBrandId('') === null, '빈 브랜드는 미정')
assert(hasSampleWorkOrder('data:application/pdf;base64,AAA'), '지시서가 있으면 목록에 넣는다')
assert(!hasSampleWorkOrder(''), '빈 지시서는 목록에서 뺀다')
assert(!hasSampleWorkOrder(null), '없는 지시서는 목록에서 뺀다')

const brandIdBySlug = new Map([['atelier', 'brand-a'], ['other', 'brand-b']])
assert(
  matchesDraftBrandScope(null, 'all', brandIdBySlug),
  '전체는 미정 포함',
)
assert(
  matchesDraftBrandScope(null, UNASSIGNED_DRAFT_BRAND, brandIdBySlug),
  '미정 필터',
)
assert(
  !matchesDraftBrandScope('brand-a', UNASSIGNED_DRAFT_BRAND, brandIdBySlug),
  '지정 행은 미정 필터에서 제외',
)
assert(
  matchesDraftBrandScope('brand-a', 'atelier', brandIdBySlug),
  '브랜드 필터',
)
assert(matchesDraftOwnerScope('김기획', 'all'), '전체는 담당 포함')
assert(
  matchesDraftOwnerScope('', UNASSIGNED_DRAFT_OWNER),
  '빈 담당은 미정 필터',
)
assert(
  !matchesDraftOwnerScope('김기획', UNASSIGNED_DRAFT_OWNER),
  '지정 담당은 미정 필터에서 제외',
)
assert(matchesDraftOwnerScope('김기획', '김기획'), '담당 이름 필터')
assert(
  collectDraftOwnerNames([{ owner: '박MD' }, { owner: '' }], ['김기획', '박MD']).join(
    ',',
  ) === '김기획,박MD',
  '직원 이름은 멤버와 기획안을 합친다',
)

const sameBrand = applyDraftBrandChange({
  nextBrandId: 'brand-a',
  seasonId: 'season-a',
  seasonBrandId: 'brand-a',
  options: [{ id: 'opt-1', styleId: 'style-a', name: '스트랩', price: 1000 }],
  styleBrandById: new Map([['style-a', 'brand-a']]),
})
assert(!sameBrand.needsConfirm, '같은 브랜드는 참조 유지')
assert(sameBrand.seasonId === 'season-a', '같은 브랜드 시즌 유지')
assert(sameBrand.options[0]?.styleId === 'style-a', '같은 브랜드 상품 유지')

const unassigned = applyDraftBrandChange({
  nextBrandId: null,
  seasonId: 'season-a',
  seasonBrandId: 'brand-a',
  options: [{ id: 'opt-1', styleId: 'style-a', name: '스트랩', price: 1000 }],
  styleBrandById: new Map([['style-a', 'brand-a']]),
})
assert(unassigned.needsConfirm, '미정으로 바꾸면 확인')
assert(unassigned.seasonId === null, '미정이면 시즌 해제')
assert(unassigned.options[0]?.styleId === '', '미정이면 상품 연결 해제')
assert(unassigned.options[0]?.name === '스트랩', '옵션명은 보존')
assert(unassigned.options[0]?.price === 1000, '옵션 가격은 보존')

const switched = applyDraftBrandChange({
  nextBrandId: 'brand-b',
  seasonId: 'season-a',
  seasonBrandId: 'brand-a',
  options: [{ id: 'opt-1', styleId: 'style-a', name: '스트랩', price: 1000 }],
  styleBrandById: new Map([['style-a', 'brand-a']]),
})
assert(switched.clearedSeason, '다른 브랜드 시즌 해제')
assert(switched.clearedStyleIds.join(',') === 'style-a', '다른 브랜드 상품 해제')
assert(
  draftBrandChangeMessage(switched).includes('출시 기획'),
  '확인 문구에 시즌',
)
assert(
  draftBrandChangeMessage(switched).includes('연결 상품 1개'),
  '확인 문구에 상품 수',
)

console.log('company-draft.verify ok')
