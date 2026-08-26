export const PRODUCT_FEATURE_KEY = 'invoice_product_recommendation' as const
export const ACCESSORY_FEATURE_KEY = 'invoice_accessory_recommendation' as const
export const ITEM_NAME_FEATURE_KEY = 'invoice_item_name_recommendation' as const

export const AI_LEARNING_MODES = ['observe', 'assist'] as const
export type AiLearningMode = (typeof AI_LEARNING_MODES)[number]

export const AI_FEEDBACK_OUTCOMES = ['confirmed', 'corrected', 'reverted'] as const
export type AiFeedbackOutcome = (typeof AI_FEEDBACK_OUTCOMES)[number]

export type ItemNameCaseComponent = {
  styleId: string
  styleNo?: string
  name?: string
  quantity: number
}

export type ItemNameLearningCase = {
  contextId: string
  source: string
  scope: string
  itemName: string
  productLookupKey: string
  mainStyleId: string | null
  action: 'delete' | 'components'
  score: number
  components: ItemNameCaseComponent[]
  ruleId?: string | null
  feedbackId?: string | null
}

export type ItemNameLocalDraft = {
  action: 'delete' | 'components'
  components: ItemNameCaseComponent[]
  reason: string
  confidence: number
}

export type AiModelPrice = {
  provider: string
  modelIdPrefix: string
  inputUsdPer1m: number
  outputUsdPer1m: number
  pricingVersion: string
}

export function parseLearningMode(value: unknown): AiLearningMode {
  return value === 'assist' ? 'assist' : 'observe'
}

export function decideProductNameFeedbackOutcome(input: {
  suggestedStyleId?: string | null
  finalStyleId: string
  outcome?: string | null
}): Exclude<AiFeedbackOutcome, 'reverted'> {
  if (input.outcome === 'corrected' || input.outcome === 'confirmed') {
    return input.outcome
  }
  const suggested = input.suggestedStyleId?.trim() ?? ''
  if (suggested && suggested !== input.finalStyleId) return 'corrected'
  return 'confirmed'
}

export function preserveProductNameSuggestion<T extends { suggestedStyleId?: string | null }>(
  current: T,
  next: T,
): T {
  return {
    ...next,
    suggestedStyleId: current.suggestedStyleId ?? next.suggestedStyleId ?? null,
  }
}

export function itemNameCaseSignature(input: {
  action: 'delete' | 'components'
  components: Array<{ styleId: string; quantity: number }>
}) {
  if (input.action === 'delete') return 'delete'
  return `components:${[...input.components]
    .map((item) => `${item.styleId}:${item.quantity}`)
    .sort()
    .join(',')}`
}

export function decideItemNameLocalDraft(
  cases: ItemNameLearningCase[],
): ItemNameLocalDraft | null {
  const exact = cases.filter((item) => item.score >= 0.95)
  if (exact.length > 0) {
    const signature = itemNameCaseSignature(exact[0]!)
    if (exact.every((item) => itemNameCaseSignature(item) === signature)) {
      return {
        action: exact[0]!.action,
        components: exact[0]!.components,
        reason: '같은 문맥의 확정 사례와 맞습니다.',
        confidence: 0.96,
      }
    }
    return null
  }

  const strong = cases.filter((item) => item.score >= 0.85)
  if (strong.length < 2) return null
  const groups = new Map<string, ItemNameLearningCase[]>()
  for (const item of strong) {
    const key = itemNameCaseSignature(item)
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  const agreed = [...groups.values()].find((group) => group.length === strong.length)
  if (!agreed?.[0]) return null
  return {
    action: agreed[0].action,
    components: agreed[0].components,
    reason: '가까운 확정 사례가 같은 결과입니다.',
    confidence: 0.9,
  }
}

export function pickItemNamePriorExamples(
  cases: ItemNameLearningCase[],
  limit = 5,
): ItemNameLearningCase[] {
  const seen = new Set<string>()
  const picked: ItemNameLearningCase[] = []
  for (const item of [...cases].sort((left, right) => right.score - left.score)) {
    const key = `${itemNameCaseSignature(item)}\u0000${item.itemName}\u0000${item.productLookupKey}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(item)
    if (picked.length >= limit) break
  }
  return picked
}

export function matchModelPricing(
  prices: AiModelPrice[],
  provider: string,
  modelId: string,
): AiModelPrice | null {
  const model = modelId.trim().toLowerCase()
  const matches = prices
    .filter(
      (item) =>
        item.provider === provider &&
        (item.modelIdPrefix === '' ||
          model.startsWith(item.modelIdPrefix.toLowerCase())),
    )
    .sort((left, right) => right.modelIdPrefix.length - left.modelIdPrefix.length)
  return matches[0] ?? null
}

export function estimateAiUsageCost(input: {
  price: AiModelPrice | null
  inputTokens: number
  outputTokens: number
}): { estimatedCostUsd: number | null; pricingVersion: string | null } {
  if (!input.price) {
    return { estimatedCostUsd: null, pricingVersion: null }
  }
  const estimatedCostUsd =
    (Math.max(0, input.inputTokens) * input.price.inputUsdPer1m +
      Math.max(0, input.outputTokens) * input.price.outputUsdPer1m) /
    1_000_000
  return {
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(8)),
    pricingVersion: input.price.pricingVersion,
  }
}

export function summarizeFeatureAccuracy(input: {
  confirmed: number
  corrected: number
  reverted?: number
}) {
  const usable = input.confirmed + input.corrected
  return {
    caseCount: usable,
    confirmedRate: usable ? input.confirmed / usable : null,
    correctionRate: usable ? input.corrected / usable : null,
    revertedCount: input.reverted ?? 0,
  }
}

export function isSoftBudgetWarning(
  spendUsd: number | null,
  monthlyBudgetUsd: number | null,
) {
  if (spendUsd == null || monthlyBudgetUsd == null || monthlyBudgetUsd <= 0) {
    return false
  }
  return spendUsd >= monthlyBudgetUsd
}

export function summarizeLearningReplay(input: {
  contexts: number
  candidateHits: number
  top1Confirmed: number
  corrected: number
  itemActionHits: number
  itemComponentHits: number
  aiCalls: number
  estimatedCostUsd: number | null
}) {
  const contexts = Math.max(0, input.contexts)
  return {
    candidateRecall: contexts ? input.candidateHits / contexts : null,
    top1ConfirmRate: contexts ? input.top1Confirmed / contexts : null,
    correctionRate: contexts ? input.corrected / contexts : null,
    itemActionAccuracy: contexts ? input.itemActionHits / contexts : null,
    itemComponentAccuracy: contexts ? input.itemComponentHits / contexts : null,
    aiCallRate: contexts ? input.aiCalls / contexts : null,
    costPer100Contexts:
      input.estimatedCostUsd == null || !contexts
        ? null
        : (input.estimatedCostUsd / contexts) * 100,
  }
}
