/**
 * 품목명·내품명 누적학습 판정 검증.
 * 실행: npm run verify:ai-learning
 */
import {
  decideItemNameLocalDraft,
  decideProductNameFeedbackOutcome,
  estimateAiUsageCost,
  isSoftBudgetWarning,
  itemNameCaseSignature,
  summarizeLearningReplay,
  matchModelPricing,
  pickItemNamePriorExamples,
  summarizeFeatureAccuracy,
  type ItemNameLearningCase,
} from '@/lib/ai/learning-core'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(
  decideProductNameFeedbackOutcome({
    suggestedStyleId: 'a',
    finalStyleId: 'a',
  }) === 'confirmed',
  '같은 본품은 confirmed',
)
assert(
  decideProductNameFeedbackOutcome({
    suggestedStyleId: 'a',
    finalStyleId: 'b',
  }) === 'corrected',
  '다른 본품은 corrected',
)

const agreed: ItemNameLearningCase[] = [
  {
    contextId: '1',
    source: 'rule',
    scope: 'lookup_key',
    itemName: '키링',
    productLookupKey: '가방',
    mainStyleId: 'main',
    action: 'components',
    score: 1,
    components: [{ styleId: 's-1', quantity: 1 }],
  },
  {
    contextId: '1',
    source: 'history',
    scope: 'lookup_key',
    itemName: '키링세트',
    productLookupKey: '가방',
    mainStyleId: 'main',
    action: 'components',
    score: 0.88,
    components: [{ styleId: 's-1', quantity: 1 }],
  },
]
const local = decideItemNameLocalDraft(agreed)
assert(local?.action === 'components', 'exact 사례가 같으면 로컬 초안')
assert(
  itemNameCaseSignature({
    action: 'components',
    components: [{ styleId: 's-2', quantity: 1 }, { styleId: 's-1', quantity: 2 }],
  }) === 'components:s-1:2,s-2:1',
  '구성품 서명은 정렬한다',
)

const conflicted: ItemNameLearningCase[] = [
  { ...agreed[0]!, score: 0.9 },
  {
    ...agreed[1]!,
    action: 'delete',
    components: [],
    score: 0.89,
  },
]
assert(
  decideItemNameLocalDraft(conflicted) === null,
  '가까운 사례가 다르면 AI에 맡긴다',
)
assert(
  pickItemNamePriorExamples(agreed, 1).length === 1,
  'few-shot은 상위 사례만 고른다',
)

const price = matchModelPricing(
  [
    {
      provider: 'openai',
      modelIdPrefix: 'gpt-4o',
      inputUsdPer1m: 2.5,
      outputUsdPer1m: 10,
      pricingVersion: '2026-08-26',
    },
    {
      provider: 'openai',
      modelIdPrefix: 'gpt-4o-mini',
      inputUsdPer1m: 0.15,
      outputUsdPer1m: 0.6,
      pricingVersion: '2026-08-26',
    },
  ],
  'openai',
  'gpt-4o-mini-2024-07-18',
)
assert(price?.modelIdPrefix === 'gpt-4o-mini', '더 긴 접두어를 고른다')
assert(
  estimateAiUsageCost({
    price,
    inputTokens: 1_000_000,
    outputTokens: 0,
  }).estimatedCostUsd === 0.15,
  '입력 100만 토큰 비용을 계산한다',
)
assert(
  estimateAiUsageCost({
    price: null,
    inputTokens: 10,
    outputTokens: 10,
  }).estimatedCostUsd === null,
  '가격을 모르면 호출을 막지 않고 비용은 비운다',
)

const accuracy = summarizeFeatureAccuracy({
  confirmed: 8,
  corrected: 2,
})
assert(accuracy.confirmedRate === 0.8 && accuracy.correctionRate === 0.2, '확정·수정률')
assert(isSoftBudgetWarning(12, 10), '소프트 예산 초과는 경고만')
assert(!isSoftBudgetWarning(null, 10), '추정 없으면 경고하지 않는다')

const replay = summarizeLearningReplay({
  contexts: 100,
  candidateHits: 90,
  top1Confirmed: 70,
  corrected: 10,
  itemActionHits: 85,
  itemComponentHits: 80,
  aiCalls: 40,
  estimatedCostUsd: 2,
})
assert(replay.candidateRecall === 0.9, 'candidate recall@K')
assert(replay.top1ConfirmRate === 0.7, 'top1 확정률')
assert(replay.correctionRate === 0.1, '수정률')
assert(replay.itemActionAccuracy === 0.85, '내품명 action 정확도')
assert(replay.itemComponentAccuracy === 0.8, '구성품 집합 정확도')
assert(replay.aiCallRate === 0.4, 'AI 호출률')
assert(replay.costPer100Contexts === 2, '비용/100문맥')

console.log('ai-learning verify: ok')
