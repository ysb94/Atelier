/**
 * 내품명 AI 검수 사례·저장 피드백 검증.
 * 실행: npm run verify:item-name-ai-review
 */
import {
  buildItemNameAiReviewRows,
  decideItemNameAiSaves,
  dedupeItemNameAiContexts,
  itemNameAiDecisionKey,
  itemNameAiSaveFeedback,
  paginateItemNameAiReviewKeys,
  selectItemNameSafeCandidateIds,
  type ItemNameAiContext,
} from '@/lib/invoice/item-name-ai-review'
import { normalizeInvoiceText } from '@/lib/invoice/prefix-transform'
import type { InvoiceItemNameRule, StyleRef } from '@/lib/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function style(id: string, no: string, name: string): StyleRef {
  return { styleId: id, styleNo: no, name }
}

assert(
  normalizeInvoiceText('마스마룰즈\u00A0\uFF3BSET\uFF3D 로고\u2014패치') ===
    '마스마룰즈 [set]로고-패치',
  '전각·NBSP·대시를 앱 검색 키로 맞춘다',
)
assert(
  normalizeInvoiceText('로고\u200B패치 볼캡') === '로고패치 볼캡',
  '제로폭 문자를 검색 키에서 뺀다',
)
assert(
  normalizeInvoiceText('크림\u2013레몬 / 네이비') === '크림-레몬 / 네이비',
  '대시 변형을 하이픈으로 맞춘다',
)
assert(
  normalizeInvoiceText('  Color:  Cream   lemon  ') === 'color: cream lemon',
  '공백 축약과 소문자화를 맞춘다',
)
assert(normalizeInvoiceText('') === '', '빈 문자열은 빈 키')

const main = style('main', 'M0001', '가방')
const charm = style('charm', 'M2001', '키링')

const context: ItemNameAiContext = {
  contextId: 'ctx-1',
  groupKey: '키링',
  itemName: '키링',
  productLookupKey: '가방 블랙',
  mainStyle: main,
  productComponents: [],
  sourceProductName: '가방',
  productConnectionExcluded: false,
  rowCount: 1,
}

const rows = buildItemNameAiReviewRows({
  groups: [
    {
      key: '키링',
      itemName: '키링',
      rowCount: 1,
      contexts: [context],
    },
  ],
  decisions: [
    {
      contextId: 'ctx-1',
      action: 'components',
      components: [
        {
          styleId: charm.styleId,
          styleNo: charm.styleNo,
          name: charm.name,
          quantity: 1,
        },
      ],
      confidence: 0.93,
      reason: '확정 사례',
    },
  ],
  styles: [main, charm],
  itemNameRules: [] as InvoiceItemNameRule[],
  minConfidence: 0.72,
  recommendationMeta: {
    source: 'local',
    cacheId: 'cache-1',
    provider: 'openai',
    modelId: 'gpt',
  },
})
const row = rows[0]!
assert(row.source === 'local', '로컬 초안 출처를 남긴다')
assert(row.suggestedAction === 'components', '최초 제안을 보존한다')
assert(row.suggestedComponents[0]?.style.styleId === charm.styleId, '제안 구성품')

const edited = {
  ...row,
  action: 'delete' as const,
  components: [],
}
const feedback = itemNameAiSaveFeedback(edited)
assert(feedback.outcome === 'corrected', '구성품을 비우면 corrected')
assert(feedback.suggestedAction === 'components', '제안 action은 유지')

const plan = decideItemNameAiSaves([row], [row.key])
assert(plan.lookups[0]?.feedback.outcome === 'confirmed', '그대로 저장하면 confirmed')
assert(plan.lookups[0]?.feedback.source === 'local', '저장 피드백에 출처를 넣는다')

const rankedIds = Array.from({ length: 20 }, (_, index) => `s${index}`)
const safe = selectItemNameSafeCandidateIds(rankedIds, rankedIds, ['s0'])
assert(safe.usedSafeLimit, '상위 안전 후보를 쓴다')
assert(safe.ids[0] === 's0', '필수 후보를 앞에 둔다')
assert(safe.ids.length === 16, '안전 후보 상한')

const fallback = selectItemNameSafeCandidateIds(
  rankedIds,
  ['s0'],
  rankedIds,
)
assert(!fallback.usedSafeLimit, '필수 후보를 못 지키면 전체 범위로 되돌린다')
assert(fallback.ids.length === 20, '전체 후보를 유지한다')

const sameLookup = { ...context, contextId: 'ctx-same' }
const otherLookup = {
  ...context,
  contextId: 'ctx-other',
  productLookupKey: '가방 화이트',
}
assert(
  itemNameAiDecisionKey(context) === itemNameAiDecisionKey(sameLookup),
  '같은 조회 키는 같은 결정 키',
)
assert(
  itemNameAiDecisionKey(context) !== itemNameAiDecisionKey(otherLookup),
  '조회 키가 다르면 따로 판정한다',
)
const independent = dedupeItemNameAiContexts([context, otherLookup])
assert(
  independent.requests.length === 2 && independent.mirrors.size === 0,
  '다른 조회 키는 각각 AI에 묻는다',
)
const merged = dedupeItemNameAiContexts([context, sameLookup])
assert(
  merged.requests.length === 1 &&
    (merged.mirrors.get(context.contextId)?.includes(sameLookup.contextId) ??
      false),
  '같은 문맥만 결정을 복사한다',
)

assert(
  paginateItemNameAiReviewKeys(['a', 'b', 'c'], 2, 2).keys.join(',') === 'c',
  '내품명 검수표 2페이지',
)
assert(
  paginateItemNameAiReviewKeys(['a', 'b', 'c'], 4, 2).page === 2,
  '내품명 검수표 페이지를 마지막까지 당긴다',
)
assert(
  paginateItemNameAiReviewKeys(
    Array.from({ length: 80 }, (_, index) => String(index)),
    1,
    20,
  ).keys.length === 20,
  '내품명 검수표는 페이지 크기만큼만 자른다',
)

console.log('item-name-ai-review verify: ok')
