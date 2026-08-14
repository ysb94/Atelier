import { isAiProvider, parseDecisionConfig } from '@/lib/ai/gateway-core'
import type {
  AiFeatureRoute,
  AiProvider,
  AiRecommendationPolicy,
  AiUsageSummary,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'
import { errorMessage } from '@/lib/supabase/map-error'

const COLUMNS =
  'id, brand_id, feature_key, provider, model_id, is_active, recommendation_policy, decision_config, created_at, updated_at'

type RouteRow = {
  id: string
  brand_id: string
  feature_key: string
  provider: string
  model_id: string
  is_active: boolean
  recommendation_policy?: string
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
  },
): Promise<AiFeatureRoute> {
  const modelId = input.modelId.trim()
  if (!modelId) {
    throw new AiSettingsStoreError('모델을 선택하세요.')
  }
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
  return toRoute(data)
}

export async function getAiUsageSummary(
  brandId: string,
): Promise<AiUsageSummary> {
  const supabase = getSupabase()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: logs, error: logError } = await supabase
    .from('ai_usage_logs')
    .select('resolution_source, skipped_ai, cache_hit, input_tokens, output_tokens')
    .eq('brand_id', brandId)
    .eq('feature_key', 'invoice_product_recommendation')
    .gte('created_at', since)
  if (logError) {
    throw new AiSettingsStoreError(
      errorMessage(logError, 'AI 사용량을 불러오지 못했습니다.'),
    )
  }
  const rows = logs ?? []
  const { data: feedback, error: feedbackError } = await supabase
    .from('ai_recommendation_feedback')
    .select('source, shown_rank')
    .eq('brand_id', brandId)
    .gte('created_at', since)
  if (feedbackError) {
    throw new AiSettingsStoreError(
      errorMessage(feedbackError, 'AI 정확도 지표를 불러오지 못했습니다.'),
    )
  }
  const confirmed = feedback ?? []
  const recommended = confirmed.filter((row) => row.source === 'local' || row.source === 'ai')
  const top1 = recommended.filter((row) => row.shown_rank === 1).length
  const top3 = recommended.filter(
    (row) => typeof row.shown_rank === 'number' && row.shown_rank <= 3,
  ).length
  return {
    total: rows.length,
    localCount: rows.filter((row) => row.resolution_source === 'local').length,
    aiCount: rows.filter((row) => row.resolution_source === 'ai').length,
    cacheCount: rows.filter((row) => row.cache_hit || row.resolution_source === 'cache').length,
    skippedAiCount: rows.filter((row) => row.skipped_ai).length,
    inputTokens: rows.reduce((sum, row) => sum + (row.input_tokens ?? 0), 0),
    outputTokens: rows.reduce((sum, row) => sum + (row.output_tokens ?? 0), 0),
    top1Rate: recommended.length ? top1 / recommended.length : null,
    top3Rate: recommended.length ? top3 / recommended.length : null,
    editRate: confirmed.length
      ? confirmed.filter((row) => row.source === 'manual').length / confirmed.length
      : null,
  }
}
