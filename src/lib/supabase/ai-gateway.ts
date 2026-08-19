import { ACCESSORY_FEATURE_KEY, type AiProvider } from '@/lib/ai/gateway-core'
import type {
  AiAccessoryRecommendation,
  AiProductCandidate,
  AiProductRecommendation,
  AiRecommendationSource,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'

export class AiGatewayError extends Error {
  readonly missingSecret?: string

  constructor(message: string, missingSecret?: string) {
    super(message)
    this.name = 'AiGatewayError'
    this.missingSecret = missingSecret
  }
}

type GatewayOk<T> = { ok: true } & T
type GatewayErr = { ok: false; error: string; missingSecret?: string }

async function invokeGateway<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('ai-gateway', {
    body,
  })
  if (error) {
    let message = error.message
    let missingSecret: string | undefined
    try {
      const parsed = (await error.context.json()) as GatewayErr
      if (parsed?.error) message = parsed.error
      missingSecret = parsed?.missingSecret
    } catch {
      // keep the invoke error
    }
    throw new AiGatewayError(message, missingSecret)
  }
  const payload = data as GatewayOk<T> | GatewayErr
  if (!payload || typeof payload !== 'object') {
    throw new AiGatewayError('AI 게이트웨이 응답이 비어 있습니다.')
  }
  if ('ok' in payload && payload.ok === false) {
    throw new AiGatewayError(payload.error, payload.missingSecret)
  }
  return payload as T
}

export async function listAiModels(provider: AiProvider) {
  return invokeGateway<{
    provider: AiProvider
    models: { id: string; displayName: string; provider: AiProvider }[]
  }>({
    action: 'list_models',
    provider,
  })
}

export async function testAiConnection(provider: AiProvider, modelId: string) {
  return invokeGateway<{
    provider: AiProvider
    modelId: string
    latencyMs: number
  }>({
    action: 'test_connection',
    provider,
    modelId,
  })
}

export async function recommendInvoiceProduct(input: {
  brandId: string
  featureKey?: string
  lookupKeys: string[]
  candidates: AiProductCandidate[]
  productName: string
  itemName: string
  mallName: string
}): Promise<AiProductRecommendation> {
  const result = await invokeGateway<{
    provider: AiProvider
    modelId: string
    source?: AiRecommendationSource
    cacheId?: string | null
    skippedAi?: boolean
    cacheHit?: boolean
    recommendation: Omit<
      AiProductRecommendation,
      'provider' | 'modelId' | 'source' | 'cacheId' | 'skippedAi' | 'cacheHit'
    >
  }>({
    action: 'recommend_product',
    ...input,
    featureKey: input.featureKey ?? 'invoice_product_recommendation',
  })
  return {
    ...result.recommendation,
    provider: result.provider,
    modelId: result.modelId,
    source: result.source ?? 'ai',
    cacheId: result.cacheId ?? null,
    skippedAi: result.skippedAi ?? false,
    cacheHit: result.cacheHit ?? false,
  }
}

export async function recommendInvoiceAccessoryRules(input: {
  brandId: string
  featureKey?: string
  unknownPiece: string
  itemNames: string[]
  lookupKeys: string[]
  mainProducts: string[]
  contexts?: Array<{
    contextId: string
    itemName: string
    productLookupKey: string
    mainProduct: string
    unknownPieces: string[]
    candidateStyleIds?: string[]
  }>
  dictionary: Array<{
    ruleType: string
    pattern: string
    accessoryKind?: string
    namePrefix?: string
    colorName?: string
  }>
  candidates: AiProductCandidate[]
}): Promise<AiAccessoryRecommendation> {
  const result = await invokeGateway<{
    provider: AiProvider
    modelId: string
    source?: AiRecommendationSource
    cacheId?: string | null
    skippedAi?: boolean
    cacheHit?: boolean
    recommendation: Omit<
      AiAccessoryRecommendation,
      'provider' | 'modelId' | 'source' | 'cacheId' | 'skippedAi' | 'cacheHit'
    >
  }>({
    action: 'recommend_accessory_rules',
    ...input,
    featureKey: input.featureKey ?? ACCESSORY_FEATURE_KEY,
  })
  return {
    ...result.recommendation,
    contexts: result.recommendation.contexts ?? [],
    provider: result.provider,
    modelId: result.modelId,
    source: result.source ?? 'ai',
    cacheId: result.cacheId ?? null,
    skippedAi: result.skippedAi ?? false,
    cacheHit: result.cacheHit ?? false,
  }
}
