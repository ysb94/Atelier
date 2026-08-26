import { isAiProvider, parseDecisionConfig } from '@/lib/ai/gateway-core'
import {
  isSoftBudgetWarning,
  parseLearningMode,
  summarizeFeatureAccuracy,
} from '@/lib/ai/learning-core'
import type {
  AiFeatureRoute,
  AiProvider,
  AiRecommendationPolicy,
  AiUsageFeatureSummary,
  AiUsageSummary,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, feature_key, provider, model_id, is_active, recommendation_policy, learning_mode, monthly_budget_usd, decision_config, created_at, updated_at'

const FEATURE_KEYS = [
  'invoice_product_recommendation',
  'invoice_item_name_recommendation',
  'invoice_accessory_recommendation',
] as const

const METRIC_PAGE_SIZE = 1000

type StoreQueryError = { message: string }

async function fetchAllMetricPages<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: T[]; error: StoreQueryError | null }>,
) {
  const data: T[] = []
  for (let from = 0; ; from += METRIC_PAGE_SIZE) {
    const page = await fetchPage(from, from + METRIC_PAGE_SIZE - 1)
    if (page.error) return { data, error: page.error }
    data.push(...page.data)
    if (page.data.length < METRIC_PAGE_SIZE) {
      return { data, error: null }
    }
  }
}

type RouteRow = {
  id: string
  brand_id: string
  feature_key: string
  provider: string
  model_id: string
  is_active: boolean
  recommendation_policy?: string
  learning_mode?: string
  monthly_budget_usd?: number | string | null
  decision_config?: unknown
  created_at: string
  updated_at: string
}

export class AiSettingsStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiSettingsStoreError'
  }
}

function toPolicy(value: string | undefined): AiRecommendationPolicy {
  if (value === 'always_ai' || value === 'local_only' || value === 'hybrid_auto') {
    return value
  }
  return 'hybrid_auto'
}

function toBudget(value: number | string | null | undefined) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toRoute(row: RouteRow): AiFeatureRoute {
  if (!isAiProvider(row.provider)) {
    throw new AiSettingsStoreError('지원하지 않는 AI 제공자입니다.')
  }
  return {
    id: row.id,
    brandId: row.brand_id,
    featureKey: row.feature_key,
    provider: row.provider,
    modelId: row.model_id,
    isActive: row.is_active,
    recommendationPolicy: toPolicy(row.recommendation_policy),
    learningMode: parseLearningMode(row.learning_mode),
    monthlyBudgetUsd: toBudget(row.monthly_budget_usd),
    decisionConfig: parseDecisionConfig(row.decision_config),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listAiFeatureRoutes(
  brandId: string,
): Promise<AiFeatureRoute[]> {
  const { data, error } = await getSupabase()
    .from('ai_feature_routes')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .order('feature_key')
  if (error) {
    throw new AiSettingsStoreError(
      errorMessage(error, 'AI 설정을 불러오지 못했습니다.'),
    )
  }
  return (data ?? []).map(toRoute)
}

export async function getAiFeatureRoute(
  brandId: string,
  featureKey: string,
): Promise<AiFeatureRoute | null> {
  const { data, error } = await getSupabase()
    .from('ai_feature_routes')
    .select(COLUMNS)
    .eq('brand_id', brandId)
    .eq('feature_key', featureKey)
    .maybeSingle()
  if (error) {
    throw new AiSettingsStoreError(
      errorMessage(error, 'AI 설정을 불러오지 못했습니다.'),
    )
  }
  return data ? toRoute(data) : null
}

export async function saveAiFeatureRoute(
  brandId: string,
  input: {
    featureKey: string
    provider: AiProvider
    modelId: string
    isActive?: boolean
    recommendationPolicy?: AiRecommendationPolicy
    monthlyBudgetUsd?: number | null
  },
): Promise<AiFeatureRoute> {
  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new AiSettingsStoreError('모델을 선택하세요.')
  }
  const previous = await getAiFeatureRoute(brandId, input.featureKey)
  const modelChanged =
    previous != null &&
    (previous.provider !== input.provider || previous.modelId !== modelId)
  const learningMode = previous?.learningMode ?? 'assist'
  const requestedBudget =
    input.monthlyBudgetUsd === undefined
      ? previous?.monthlyBudgetUsd ?? null
      : input.monthlyBudgetUsd
  const monthlyBudgetUsd =
    requestedBudget == null ||
    !Number.isFinite(requestedBudget) ||
    requestedBudget < 0
      ? null
      : requestedBudget
  const { data, error } = await getSupabase()
    .from('ai_feature_routes')
    .upsert(
      {
        brand_id: brandId,
        feature_key: input.featureKey,
        provider: input.provider,
        model_id: modelId,
        is_active: input.isActive ?? true,
        recommendation_policy: input.recommendationPolicy ?? 'hybrid_auto',
        learning_mode: learningMode,
        monthly_budget_usd: monthlyBudgetUsd,
      },
      { onConflict: 'brand_id,feature_key' },
    )
    .select(COLUMNS)
    .single()
  if (error || !data) {
    throw new AiSettingsStoreError(
      errorMessage(error, 'AI 설정을 저장하지 못했습니다.'),
    )
  }
  if (modelChanged) {
    const { error: invalidateError } = await getSupabase().rpc(
      'invalidate_ai_recommendation_cache_for_feature',
      {
        p_brand_id: brandId,
        p_feature_key: input.featureKey,
      },
    )
    if (invalidateError) {
      throw new AiSettingsStoreError(
        errorMessage(invalidateError, '모델 변경 후 캐시를 비우지 못했습니다.'),
      )
    }
  }
  return toRoute(data)
}

function emptyFeature(featureKey: string): AiUsageFeatureSummary {
  return {
    featureKey,
    total: 0,
    localCount: 0,
    aiCount: 0,
    cacheCount: 0,
    skippedAiCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: null,
    monthlyBudgetUsd: null,
    budgetWarning: false,
    caseCount: 0,
    confirmedRate: null,
    correctionRate: null,
    top1Rate: null,
    top3Rate: null,
    models: [],
  }
}

function addCost(current: number | null, next: number | null) {
  if (current == null && next == null) return null
  return (current ?? 0) + (next ?? 0)
}

export async function getAiUsageSummary(
  brandId: string,
): Promise<AiUsageSummary> {
  const supabase = getSupabase()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [logsResult, productFeedbackResult, itemFeedbackResult, routes] =
    await Promise.all([
      fetchAllMetricPages(async (from, to) => {
        const { data, error } = await supabase
          .from('ai_usage_logs')
          .select(
            'feature_key, action, provider, model_id, resolution_source, skipped_ai, cache_hit, input_tokens, output_tokens, estimated_cost_usd, created_at',
          )
          .eq('brand_id', brandId)
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(from, to)
        return { data: data ?? [], error }
      }),
      fetchAllMetricPages(async (from, to) => {
        const { data, error } = await supabase
          .from('ai_recommendation_feedback')
          .select('source, shown_rank, outcome, invalidated_at')
          .eq('brand_id', brandId)
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(from, to)
        return { data: data ?? [], error }
      }),
      fetchAllMetricPages(async (from, to) => {
        const { data, error } = await supabase
          .from('ai_item_name_recommendation_feedback')
          .select('source, outcome, invalidated_at')
          .eq('brand_id', brandId)
          .gte('created_at', since)
          .order('created_at', { ascending: true })
          .range(from, to)
        return { data: data ?? [], error }
      }),
      listAiFeatureRoutes(brandId),
    ])

  if (logsResult.error) {
    throw new AiSettingsStoreError(
      errorMessage(logsResult.error, 'AI 사용량을 불러오지 못했습니다.'),
    )
  }
  if (productFeedbackResult.error) {
    throw new AiSettingsStoreError(
      errorMessage(productFeedbackResult.error, 'AI 정확도 지표를 불러오지 못했습니다.'),
    )
  }
  if (itemFeedbackResult.error) {
    throw new AiSettingsStoreError(
      errorMessage(itemFeedbackResult.error, '내품명 사례 지표를 불러오지 못했습니다.'),
    )
  }

  const features = new Map<string, AiUsageFeatureSummary>(
    FEATURE_KEYS.map((key) => [key, emptyFeature(key)]),
  )
  const monthSpend = new Map<string, number | null>()

  for (const row of logsResult.data ?? []) {
    const feature = features.get(row.feature_key) ?? emptyFeature(row.feature_key)
    feature.total += 1
    if (row.resolution_source === 'local') feature.localCount += 1
    if (row.resolution_source === 'ai') feature.aiCount += 1
    if (row.cache_hit || row.resolution_source === 'cache') feature.cacheCount += 1
    if (row.skipped_ai) feature.skippedAiCount += 1
    feature.inputTokens += row.input_tokens ?? 0
    feature.outputTokens += row.output_tokens ?? 0
    feature.estimatedCostUsd = addCost(
      feature.estimatedCostUsd,
      row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    )
    const provider = row.provider ?? ''
    const modelId = row.model_id ?? ''
    if (provider || modelId) {
      let model = feature.models.find(
        (item) => item.provider === provider && item.modelId === modelId,
      )
      if (!model) {
        model = {
          provider,
          modelId,
          total: 0,
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostUsd: null,
        }
        feature.models.push(model)
      }
      model.total += 1
      model.inputTokens += row.input_tokens ?? 0
      model.outputTokens += row.output_tokens ?? 0
      model.estimatedCostUsd = addCost(
        model.estimatedCostUsd,
        row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
      )
    }
    features.set(row.feature_key, feature)
    if (new Date(row.created_at) >= monthStart) {
      monthSpend.set(
        row.feature_key,
        addCost(
          monthSpend.get(row.feature_key) ?? null,
          row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
        ),
      )
    }
  }

  const productFeedback = (productFeedbackResult.data ?? []).filter(
    (row) => !row.invalidated_at,
  )
  const productAccuracy = summarizeFeatureAccuracy({
    confirmed: productFeedback.filter((row) => row.outcome === 'confirmed').length,
    corrected: productFeedback.filter((row) => row.outcome === 'corrected').length,
    reverted: (productFeedbackResult.data ?? []).filter(
      (row) => row.outcome === 'reverted',
    ).length,
  })
  const recommended = productFeedback.filter(
    (row) => row.source === 'local' || row.source === 'ai',
  )
  const top1 = recommended.filter((row) => row.shown_rank === 1).length
  const top3 = recommended.filter(
    (row) => typeof row.shown_rank === 'number' && row.shown_rank <= 3,
  ).length
  const product = features.get('invoice_product_recommendation')!
  product.caseCount = productAccuracy.caseCount
  product.confirmedRate = productAccuracy.confirmedRate
  product.correctionRate = productAccuracy.correctionRate
  product.top1Rate = recommended.length ? top1 / recommended.length : null
  product.top3Rate = recommended.length ? top3 / recommended.length : null

  const itemFeedback = (itemFeedbackResult.data ?? []).filter(
    (row) => !row.invalidated_at,
  )
  const itemAccuracy = summarizeFeatureAccuracy({
    confirmed: itemFeedback.filter((row) => row.outcome === 'confirmed').length,
    corrected: itemFeedback.filter((row) => row.outcome === 'corrected').length,
  })
  const item = features.get('invoice_item_name_recommendation')!
  item.caseCount = itemAccuracy.caseCount
  item.confirmedRate = itemAccuracy.confirmedRate
  item.correctionRate = itemAccuracy.correctionRate

  for (const route of routes) {
    const feature = features.get(route.featureKey) ?? emptyFeature(route.featureKey)
    feature.monthlyBudgetUsd = route.monthlyBudgetUsd
    feature.budgetWarning = isSoftBudgetWarning(
      monthSpend.get(route.featureKey) ?? feature.estimatedCostUsd,
      route.monthlyBudgetUsd,
    )
    features.set(route.featureKey, feature)
  }

  for (const feature of features.values()) {
    feature.models.sort((a, b) => b.total - a.total)
  }

  const all = [...features.values()]
  const totals = all.reduce(
    (sum, feature) => ({
      total: sum.total + feature.total,
      localCount: sum.localCount + feature.localCount,
      aiCount: sum.aiCount + feature.aiCount,
      cacheCount: sum.cacheCount + feature.cacheCount,
      skippedAiCount: sum.skippedAiCount + feature.skippedAiCount,
      inputTokens: sum.inputTokens + feature.inputTokens,
      outputTokens: sum.outputTokens + feature.outputTokens,
      estimatedCostUsd: addCost(sum.estimatedCostUsd, feature.estimatedCostUsd),
    }),
    {
      total: 0,
      localCount: 0,
      aiCount: 0,
      cacheCount: 0,
      skippedAiCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: null as number | null,
    },
  )

  return {
    ...totals,
    top1Rate: product.top1Rate,
    top3Rate: product.top3Rate,
    editRate: product.correctionRate,
    features: FEATURE_KEYS.map((key) => features.get(key)!),
  }
}
