import {
  ACCESSORY_FEATURE_KEY,
  ITEM_NAME_FEATURE_KEY,
  type AiProvider,
} from '@/lib/ai/gateway-core'
import type {
  AiAccessoryRecommendation,
  AiItemNameRecommendation,
  AiProductCandidate,
  AiProductRecommendation,
  AiRecommendationSource,
} from '@/lib/types'
import { getSupabase } from '@/lib/supabase/client'

export type AiProviderFailure = 'billing' | 'auth' | 'quota'

const FAILURE_MESSAGE: Record<AiProviderFailure, string> = {
  billing:
    'AI 크레딧이 떨어졌습니다. 결제를 확인하거나 AI 설정에서 다른 제공자로 바꾸세요.',
  auth: 'AI API 키가 유효하지 않습니다. AI 설정을 확인하세요.',
  quota:
    'AI 사용량 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 다른 제공자로 바꾸세요.',
}

export class AiGatewayError extends Error {
  readonly missingSecret?: string
  /** 다시 물어도 같은 실패라 남은 요청을 멈춰야 하는 오류. */
  readonly fatal: boolean
  readonly failureKind?: AiProviderFailure

  constructor(
    message: string,
    options: {
      missingSecret?: string
      failureKind?: AiProviderFailure
      fatal?: boolean
    } = {},
  ) {
    super(message)
    this.name = 'AiGatewayError'
    this.missingSecret = options.missingSecret
    this.failureKind = options.failureKind
    this.fatal = options.fatal ?? Boolean(options.failureKind)
  }

  /** 사용자에게 보여줄 조치 문구. 분류되지 않으면 원문을 쓴다. */
  get actionMessage() {
    return this.failureKind ? FAILURE_MESSAGE[this.failureKind] : this.message
  }
}

export function isFatalAiError(error: unknown): error is AiGatewayError {
  return error instanceof AiGatewayError && error.fatal
}

type GatewayOk<T> = { ok: true } & T
type GatewayErr = {
  ok: false
  error: string
  missingSecret?: string
  failureKind?: AiProviderFailure
  fatal?: boolean
}

async function invokeGateway<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke('ai-gateway', {
    body,
  })
  if (error) {
    let message = error.message
    let missingSecret: string | undefined
    let failureKind: AiProviderFailure | undefined
    let fatal: boolean | undefined
    try {
      const parsed = (await error.context.json()) as GatewayErr
      if (parsed?.error) message = parsed.error
      missingSecret = parsed?.missingSecret
      failureKind = parsed?.failureKind
      fatal = parsed?.fatal
    } catch {
      // keep the invoke error
    }
    throw new AiGatewayError(message, { missingSecret, failureKind, fatal })
  }
  const payload = data as GatewayOk<T> | GatewayErr
  if (!payload || typeof payload !== 'object') {
    throw new AiGatewayError('AI 게이트웨이 응답이 비어 있습니다.')
  }
  if ('ok' in payload && payload.ok === false) {
    throw new AiGatewayError(payload.error, {
      missingSecret: payload.missingSecret,
      failureKind: payload.failureKind,
      fatal: payload.fatal,
    })
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

export async function recommendInvoiceItemNameRules(input: {
  brandId: string
  featureKey?: string
  contexts: Array<{
    contextId: string
    itemName: string
    productLookupKey: string
    mainProduct: string
    candidateStyleIds?: string[]
    priorExamples?: Array<{
      itemName: string
      productLookupKey: string
      action: 'delete' | 'components'
      components: Array<{ styleId: string; quantity: number }>
    }>
  }>
  candidates: AiProductCandidate[]
}): Promise<AiItemNameRecommendation> {
  const itemNames = [...new Set(input.contexts.map((item) => item.itemName))]
  const lookupKeys = [
    ...new Set(input.contexts.map((item) => item.productLookupKey).filter(Boolean)),
  ]
  const mainProducts = [
    ...new Set(input.contexts.map((item) => item.mainProduct).filter(Boolean)),
  ]
  const result = await invokeGateway<{
    provider: AiProvider
    modelId: string
    source?: AiRecommendationSource
    cacheId?: string | null
    skippedAi?: boolean
    cacheHit?: boolean
    recommendation: Omit<
      AiItemNameRecommendation,
      'provider' | 'modelId' | 'source' | 'cacheId' | 'skippedAi' | 'cacheHit'
    >
  }>({
    action: 'recommend_accessory_rules',
    mode: 'item_name',
    brandId: input.brandId,
    featureKey: input.featureKey ?? ITEM_NAME_FEATURE_KEY,
    unknownPiece: '내품명 일괄 검토',
    itemNames,
    lookupKeys,
    mainProducts,
    contexts: input.contexts.map((item) => ({
      ...item,
      unknownPieces: [],
    })),
    dictionary: [],
    candidates: input.candidates,
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
