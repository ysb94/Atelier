import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  ACCESSORY_FEATURE_KEY,
  buildAccessorySuggestPrompt,
  buildItemNameSuggestPrompt,
  buildLocalRecommendation,
  buildRecommendPrompt,
  clampTextList,
  evaluateHybridDecision,
  extractJsonObject,
  isAiProvider,
  missingKeyError,
  normalizeUsage,
  parseAccessorySuggestJson,
  parseItemNameSuggestJson,
  parseAnthropicModels,
  parseDecisionConfig,
  parseGeminiModels,
  parseOpenAiModels,
  parseRecommendJson,
  PROVIDER_SECRET,
  type AiProvider,
  type ProductCandidate,
} from '../_shared/ai-core.ts'
import { corsHeaders } from '../_shared/cors.ts'

const TIMEOUT_MS = 20_000
const MAX_LOOKUP_KEYS = 20
const MAX_CANDIDATES = 20

type GatewayRequest =
  | { action: 'list_models'; provider: string }
  | { action: 'test_connection'; provider: string; modelId: string }
  | {
      action: 'recommend_product'
      brandId: string
      featureKey?: string
      lookupKeys: string[]
      candidates: ProductCandidate[]
      productName?: string
      itemName?: string
      mallName?: string
    }
  | {
      action: 'recommend_accessory_rules'
      mode?: 'accessory' | 'item_name'
      brandId: string
      featureKey?: string
      unknownPiece: string
      itemNames?: string[]
      lookupKeys?: string[]
      mainProducts?: string[]
      contexts?: Array<{
        contextId: string
        itemName: string
        productLookupKey: string
        mainProduct: string
        unknownPieces?: string[]
        candidateStyleIds?: string[]
      }>
      dictionary?: Array<{
        ruleType: string
        pattern: string
        accessoryKind?: string
        namePrefix?: string
        colorName?: string
      }>
      candidates: ProductCandidate[]
    }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (req.method !== 'POST') {
      return json({ ok: false, error: 'POST만 지원합니다.' }, 405)
    }

    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    )
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return json({ ok: false, error: '로그인이 필요합니다.' }, 401)
    }

    const body = (await req.json()) as GatewayRequest
    if (body.action === 'list_models') {
      return json(await listModels(requireProvider(body.provider)))
    }
    if (body.action === 'test_connection') {
      return json(
        await testConnection(requireProvider(body.provider), String(body.modelId ?? '').trim()),
      )
    }
    if (body.action === 'recommend_product') {
      return json(
        await recommendProduct(supabase, user.id, body),
      )
    }
    if (body.action === 'recommend_accessory_rules') {
      return json(await recommendAccessoryRules(supabase, user.id, body))
    }
    return json({ ok: false, error: '지원하지 않는 action입니다.' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 게이트웨이 오류'
    const status = /API 키|로그인이|브랜드|설정|action|provider|모델/i.test(message)
      ? 400
      : 500
    return json({ ok: false, error: message }, status)
  }
})

function requireProvider(value: string): AiProvider {
  if (!isAiProvider(value)) {
    throw new Error('지원하지 않는 provider입니다.')
  }
  return value
}

function requireApiKey(provider: AiProvider) {
  const secretName = PROVIDER_SECRET[provider]
  const key = Deno.env.get(secretName)?.trim() ?? ''
  if (!key) throw Object.assign(new Error(missingKeyError(provider).error), { missingSecret: secretName })
  return key
}

async function listModels(provider: AiProvider) {
  const key = requireApiKey(provider)
  if (provider === 'openai') {
    const payload = await providerFetch(
      'https://api.openai.com/v1/models',
      { headers: { Authorization: `Bearer ${key}` } },
    )
    return { ok: true, provider, models: parseOpenAiModels(payload) }
  }
  if (provider === 'anthropic') {
    const payload = await providerFetch('https://api.anthropic.com/v1/models', {
      headers: anthropicHeaders(key),
    })
    return { ok: true, provider, models: parseAnthropicModels(payload) }
  }
  const payload = await providerFetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
  )
  return { ok: true, provider, models: parseGeminiModels(payload) }
}

async function testConnection(provider: AiProvider, modelId: string) {
  if (!modelId) throw new Error('모델 ID가 필요합니다.')
  const started = Date.now()
  const { text } = await completeJson(provider, modelId, {
    system: 'Reply with JSON only.',
    user: '{"ok":true}',
  })
  extractJsonObject(text)
  return {
    ok: true,
    provider,
    modelId,
    latencyMs: Date.now() - started,
  }
}

async function recommendProduct(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Extract<GatewayRequest, { action: 'recommend_product' }>,
) {
  const brandId = String(body.brandId ?? '').trim()
  const featureKey = String(body.featureKey ?? 'invoice_product_recommendation').trim()
  if (!brandId) throw new Error('brandId가 필요합니다.')

  const lookupKeys = clampTextList(body.lookupKeys ?? [], MAX_LOOKUP_KEYS, 200)
  const candidates = (body.candidates ?? []).slice(0, MAX_CANDIDATES)
  if (lookupKeys.length === 0) throw new Error('조회 키가 없습니다.')

  const { data: route, error: routeError } = await supabase
    .from('ai_feature_routes')
    .select('provider, model_id, is_active, recommendation_policy, decision_config')
    .eq('brand_id', brandId)
    .eq('feature_key', featureKey)
    .maybeSingle()
  if (routeError) throw new Error(routeError.message)
  if (!route || !route.is_active) {
    throw new Error('이 브랜드의 AI 모델이 아직 설정되지 않았습니다.')
  }
  if (!isAiProvider(route.provider)) {
    throw new Error('지원하지 않는 provider입니다.')
  }

  const started = Date.now()
  const policy = String(route.recommendation_policy ?? 'hybrid_auto')
  const config = parseDecisionConfig(route.decision_config)
  const decision = evaluateHybridDecision(candidates, config)
  const action =
    policy === 'always_ai' && decision.ranked.length >= 2
      ? 'ai'
      : policy === 'local_only' && decision.action === 'ai'
        ? 'local'
        : decision.action

  if (action === 'manual') {
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      status: 'ok',
      usage: normalizeUsage(null, null),
      errorCode: '',
      resolutionSource: 'manual',
      skippedAi: true,
      cacheHit: false,
      candidateCount: decision.ranked.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'manual',
      cacheId: null,
      skippedAi: true,
      cacheHit: false,
      recommendation: {
        lookupKey: lookupKeys[0] ?? '',
        reason: decision.reason,
        products: [],
      },
    }
  }

  if (action === 'local') {
    const recommendation = buildLocalRecommendation(lookupKeys, decision.ranked)
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      status: 'ok',
      usage: normalizeUsage(null, null),
      errorCode: '',
      resolutionSource: 'local',
      skippedAi: true,
      cacheHit: false,
      candidateCount: decision.ranked.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'local',
      cacheId: null,
      skippedAi: true,
      cacheHit: false,
      recommendation,
    }
  }

  const cacheKey = await recommendationCacheKey({
    brandId,
    featureKey,
    provider: route.provider,
    modelId: route.model_id,
    policy,
    config,
    mallName: String(body.mallName ?? ''),
    productName: String(body.productName ?? ''),
    itemName: String(body.itemName ?? ''),
    lookupKeys,
    candidates: decision.aiCandidates,
  })
  const cached = await readRecommendationCache(supabase, brandId, featureKey, cacheKey)
  if (cached) {
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      status: 'ok',
      usage: normalizeUsage(null, null),
      errorCode: '',
      resolutionSource: 'cache',
      skippedAi: true,
      cacheHit: true,
      candidateCount: decision.aiCandidates.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'cache',
      cacheId: cached.id,
      skippedAi: true,
      cacheHit: true,
      recommendation: cached.recommendation,
    }
  }

  const prompt = buildRecommendPrompt({
    mallName: String(body.mallName ?? ''),
    productName: String(body.productName ?? ''),
    itemName: String(body.itemName ?? ''),
    lookupKeys,
    candidates: decision.aiCandidates,
  })

  let usage = normalizeUsage(null, null)
  try {
    const completed = await completeJson(route.provider, route.model_id, prompt)
    usage = completed.usage
    const recommendation = parseRecommendJson(
      extractJsonObject(completed.text),
      lookupKeys,
      decision.aiCandidates,
    )
    const cacheId = await writeRecommendationCache(supabase, {
      brandId,
      featureKey,
      cacheKey,
      provider: route.provider,
      modelId: route.model_id,
      policy,
      lookupKeys,
      candidates: decision.aiCandidates,
      recommendation,
      usage,
    })
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      status: 'ok',
      usage,
      errorCode: '',
      resolutionSource: 'ai',
      skippedAi: false,
      cacheHit: false,
      candidateCount: decision.aiCandidates.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'ai',
      cacheId,
      skippedAi: false,
      cacheHit: false,
      recommendation,
      usage,
    }
  } catch (error) {
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      status: 'error',
      usage,
      errorCode: error instanceof Error ? error.message.slice(0, 180) : 'unknown',
      resolutionSource: 'ai',
      skippedAi: false,
      cacheHit: false,
      candidateCount: decision.aiCandidates.length,
      latencyMs: Date.now() - started,
    })
    throw error
  }
}

async function recommendAccessoryRules(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  body: Extract<GatewayRequest, { action: 'recommend_accessory_rules' }>,
) {
  const brandId = String(body.brandId ?? '').trim()
  const featureKey = String(body.featureKey ?? ACCESSORY_FEATURE_KEY).trim()
  const mode = body.mode === 'item_name' ? 'item_name' : 'accessory'
  if (!brandId) throw new Error('brandId가 필요합니다.')
  const unknownPiece = String(body.unknownPiece ?? '').trim()
  if (mode === 'accessory' && !unknownPiece) {
    throw new Error('unknownPiece가 필요합니다.')
  }

  const itemNames = clampTextList(body.itemNames ?? [], 8, 200)
  const lookupKeys = clampTextList(body.lookupKeys ?? [], 8, 200)
  const mainProducts = clampTextList(body.mainProducts ?? [], 8, 120)
  const candidateLimit = mode === 'item_name' ? 60 : MAX_CANDIDATES
  const candidates = (body.candidates ?? []).slice(0, candidateLimit)
  const dictionary = (body.dictionary ?? []).slice(0, 40)
  const contexts = (body.contexts ?? []).slice(0, 8).map((item) => ({
    contextId: String(item.contextId ?? '').trim(),
    itemName: String(item.itemName ?? '').trim().slice(0, 200),
    productLookupKey: String(item.productLookupKey ?? '').trim().slice(0, 200),
    mainProduct: String(item.mainProduct ?? '').trim().slice(0, 120),
    unknownPieces: clampTextList(item.unknownPieces ?? [], 6, 120),
    candidateStyleIds: (item.candidateStyleIds ?? [])
      .map((value) => String(value).trim())
      .filter(Boolean)
      .slice(0, candidateLimit),
  })).filter((item) => item.contextId)

  const { data: route, error: routeError } = await supabase
    .from('ai_feature_routes')
    .select('provider, model_id, is_active, recommendation_policy, decision_config')
    .eq('brand_id', brandId)
    .eq('feature_key', featureKey)
    .maybeSingle()
  if (routeError) throw new Error(routeError.message)
  if (!route || !route.is_active) {
    throw new Error('이 브랜드의 내품명 AI 모델이 아직 설정되지 않았습니다.')
  }
  if (!isAiProvider(route.provider)) {
    throw new Error('지원하지 않는 provider입니다.')
  }

  const started = Date.now()
  const cacheKey = await recommendationCacheKey({
    brandId,
    featureKey,
    provider: route.provider,
    modelId: route.model_id,
    policy: String(route.recommendation_policy ?? 'always_ai'),
    config: parseDecisionConfig(route.decision_config),
    mallName: dictionary
      .map((item) => `${item.ruleType}:${item.pattern}`)
      .join('|'),
    productName: `${mode}:${unknownPiece}`,
    itemName: [
      itemNames.join('|'),
      contexts
        .map(
          (item) =>
            `${item.contextId}:${item.itemName}:${item.productLookupKey}:${item.candidateStyleIds.join(',')}`,
        )
        .join('|'),
    ].join('||'),
    lookupKeys,
    candidates,
  })
  const cached = await readRecommendationCache(supabase, brandId, featureKey, cacheKey)
  if (cached) {
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      action:
        mode === 'item_name'
          ? 'recommend_item_name_rules'
          : 'recommend_accessory_rules',
      status: 'ok',
      usage: normalizeUsage(null, null),
      errorCode: '',
      resolutionSource: 'cache',
      skippedAi: true,
      cacheHit: true,
      candidateCount: candidates.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'cache',
      cacheId: cached.id,
      skippedAi: true,
      cacheHit: true,
      recommendation: cached.recommendation,
    }
  }

  const prompt =
    mode === 'item_name'
      ? buildItemNameSuggestPrompt({ contexts, candidates })
      : buildAccessorySuggestPrompt({
          unknownPiece,
          itemNames,
          lookupKeys,
          mainProducts,
          contexts,
          dictionary,
          candidates,
        })

  let usage = normalizeUsage(null, null)
  try {
    const completed = await completeJson(route.provider, route.model_id, prompt, {
      maxTokens: mode === 'item_name' ? 1800 : 1200,
    })
    usage = completed.usage
    const rawRecommendation = extractJsonObject(completed.text)
    const recommendation =
      mode === 'item_name'
        ? parseItemNameSuggestJson(rawRecommendation, candidates, contexts)
        : parseAccessorySuggestJson(rawRecommendation, candidates, contexts)
    const cacheId = await writeRecommendationCache(supabase, {
      brandId,
      featureKey,
      cacheKey,
      provider: route.provider,
      modelId: route.model_id,
      policy: String(route.recommendation_policy ?? 'always_ai'),
      lookupKeys,
      candidates,
      recommendation,
      usage,
    })
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      action:
        mode === 'item_name'
          ? 'recommend_item_name_rules'
          : 'recommend_accessory_rules',
      status: 'ok',
      usage,
      errorCode: '',
      resolutionSource: 'ai',
      skippedAi: false,
      cacheHit: false,
      candidateCount: candidates.length,
      latencyMs: Date.now() - started,
    })
    return {
      ok: true,
      provider: route.provider,
      modelId: route.model_id,
      source: 'ai',
      cacheId,
      skippedAi: false,
      cacheHit: false,
      recommendation,
      usage,
    }
  } catch (error) {
    await insertUsageLog(supabase, {
      brandId,
      userId,
      featureKey,
      provider: route.provider,
      modelId: route.model_id,
      action:
        mode === 'item_name'
          ? 'recommend_item_name_rules'
          : 'recommend_accessory_rules',
      status: 'error',
      usage,
      errorCode: error instanceof Error ? error.message.slice(0, 180) : 'unknown',
      resolutionSource: 'ai',
      skippedAi: false,
      cacheHit: false,
      candidateCount: candidates.length,
      latencyMs: Date.now() - started,
    })
    throw error
  }
}

async function insertUsageLog(
  supabase: ReturnType<typeof createClient>,
  input: {
    brandId: string
    userId: string
    featureKey: string
    provider: AiProvider
    modelId: string
    action?: string
    status: 'ok' | 'error'
    usage: ReturnType<typeof normalizeUsage>
    errorCode: string
    resolutionSource?: 'local' | 'manual' | 'ai' | 'cache'
    skippedAi?: boolean
    cacheHit?: boolean
    candidateCount?: number
    latencyMs?: number
  },
) {
  await supabase.from('ai_usage_logs').insert({
    brand_id: input.brandId,
    user_id: input.userId,
    feature_key: input.featureKey,
    provider: input.provider,
    model_id: input.modelId,
    action: input.action ?? 'recommend_product',
    status: input.status,
    input_tokens: input.usage.inputTokens,
    output_tokens: input.usage.outputTokens,
    error_code: input.errorCode,
    resolution_source: input.resolutionSource ?? 'ai',
    skipped_ai: input.skippedAi ?? false,
    cache_hit: input.cacheHit ?? false,
    candidate_count: input.candidateCount ?? null,
    latency_ms: input.latencyMs ?? null,
  })
}

async function recommendationCacheKey(input: {
  brandId: string
  featureKey: string
  provider: string
  modelId: string
  policy: string
  config: ReturnType<typeof parseDecisionConfig>
  mallName: string
  productName: string
  itemName: string
  lookupKeys: string[]
  candidates: ProductCandidate[]
}) {
  const raw = JSON.stringify({
    brandId: input.brandId,
    featureKey: input.featureKey,
    provider: input.provider,
    modelId: input.modelId,
    policy: input.policy,
    config: input.config,
    mallName: input.mallName.trim().toLocaleLowerCase('ko-KR'),
    productName: input.productName.trim().toLocaleLowerCase('ko-KR'),
    itemName: input.itemName.trim().toLocaleLowerCase('ko-KR'),
    lookupKeys: [...input.lookupKeys].sort(),
    candidates: input.candidates.map((item) => `${item.styleId}:${item.score.toFixed(3)}`),
  })
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

async function readRecommendationCache(
  supabase: ReturnType<typeof createClient>,
  brandId: string,
  featureKey: string,
  cacheKey: string,
) {
  const { data } = await supabase
    .from('ai_recommendation_cache')
    .select('id, recommendation, expires_at')
    .eq('brand_id', brandId)
    .eq('feature_key', featureKey)
    .eq('cache_key', cacheKey)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!data) return null
  return {
    id: String(data.id),
    recommendation: data.recommendation as {
      lookupKey: string
      reason: string
      products: Array<{
        styleId: string
        styleNo: string
        name: string
        reason: string
        confidence: number
      }>
    },
  }
}

async function writeRecommendationCache(
  supabase: ReturnType<typeof createClient>,
  input: {
    brandId: string
    featureKey: string
    cacheKey: string
    provider: AiProvider
    modelId: string
    policy: string
    lookupKeys: string[]
    candidates: ProductCandidate[]
    recommendation: unknown
    usage: ReturnType<typeof normalizeUsage>
  },
) {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from('ai_recommendation_cache')
    .upsert(
      {
        brand_id: input.brandId,
        feature_key: input.featureKey,
        cache_key: input.cacheKey,
        provider: input.provider,
        model_id: input.modelId,
        policy: input.policy,
        lookup_keys: input.lookupKeys,
        candidates: input.candidates,
        recommendation: input.recommendation,
        source: 'ai',
        input_tokens: input.usage.inputTokens,
        output_tokens: input.usage.outputTokens,
        expires_at: expires,
      },
      { onConflict: 'brand_id,feature_key,cache_key' },
    )
    .select('id')
    .maybeSingle()
  return data?.id ? String(data.id) : null
}

async function completeJson(
  provider: AiProvider,
  modelId: string,
  prompt: { system: string; user: string },
  options: { maxTokens?: number } = {},
) {
  const key = requireApiKey(provider)
  if (provider === 'openai') {
    return completeOpenAi(key, modelId, prompt)
  }
  if (provider === 'anthropic') {
    return completeAnthropic(key, modelId, prompt, options.maxTokens ?? 500)
  }
  return completeGemini(key, modelId, prompt)
}

async function completeOpenAi(
  key: string,
  modelId: string,
  prompt: { system: string; user: string },
) {
  const payload = await providerFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    }),
  })
  const row = asRecord(payload)
  const choice = Array.isArray(row?.choices) ? asRecord(row.choices[0]) : null
  const message = asRecord(choice?.message)
  const text = typeof message?.content === 'string' ? message.content : ''
  const usage = asRecord(row?.usage)
  return {
    text,
    usage: normalizeUsage(usage?.prompt_tokens, usage?.completion_tokens),
  }
}

async function completeAnthropic(
  key: string,
  modelId: string,
  prompt: { system: string; user: string },
  maxTokens = 500,
) {
  const payload = await providerFetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      ...anthropicHeaders(key),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
    }),
  })
  const row = asRecord(payload)
  const content = Array.isArray(row?.content) ? row.content : []
  const text = content
    .map((item) => asRecord(item))
    .filter((item) => item?.type === 'text')
    .map((item) => String(item?.text ?? ''))
    .join('\n')
  const usage = asRecord(row?.usage)
  return {
    text,
    usage: normalizeUsage(usage?.input_tokens, usage?.output_tokens),
  }
}

async function completeGemini(
  key: string,
  modelId: string,
  prompt: { system: string; user: string },
) {
  const id = modelId.replace(/^models\//, '')
  const payload = await providerFetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(id)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
        },
      }),
    },
  )
  const row = asRecord(payload)
  const candidate = Array.isArray(row?.candidates) ? asRecord(row.candidates[0]) : null
  const content = asRecord(candidate?.content)
  const parts = Array.isArray(content?.parts) ? content.parts : []
  const text = parts
    .map((item) => asRecord(item))
    .map((item) => String(item?.text ?? ''))
    .join('\n')
  const usage = asRecord(row?.usageMetadata)
  return {
    text,
    usage: normalizeUsage(usage?.promptTokenCount, usage?.candidatesTokenCount),
  }
}

async function providerFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = { error: text }
    }
    if (!response.ok) {
      throw new Error(providerErrorMessage(payload, response.status))
    }
    return payload
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('AI 요청이 시간 초과되었습니다.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function providerErrorMessage(payload: unknown, status: number) {
  const row = asRecord(payload)
  const error = asRecord(row?.error)
  const message =
    (typeof error?.message === 'string' && error.message) ||
    (typeof row?.message === 'string' && row.message) ||
    `제공자 오류 (${status})`
  return message
}

function anthropicHeaders(key: string) {
  return {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
