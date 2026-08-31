export const AI_PROVIDERS = ['openai', 'anthropic', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDERS)[number]

export const AI_FEATURE_KEYS = [
  'invoice_product_recommendation',
  'invoice_accessory_recommendation',
  'invoice_item_name_recommendation',
] as const

export const ACCESSORY_FEATURE_KEY = 'invoice_accessory_recommendation' as const
export const ITEM_NAME_FEATURE_KEY = 'invoice_item_name_recommendation' as const
export const ACCESSORY_RULE_TYPES = [
  'label',
  'color',
  'token',
  'ignore',
  'default',
] as const

export type AccessoryRuleType = (typeof ACCESSORY_RULE_TYPES)[number]

export type AccessorySuggestRule = {
  ruleType: AccessoryRuleType
  pattern: string
  accessoryKind: string
  namePrefix: string
  colorName: string
  styleId: string
  styleNo: string
  name: string
  reason: string
  confidence: number
}

export type AccessoryContextDecision = {
  contextId: string
  action: 'components' | 'delete' | 'hold'
  components: Array<{
    styleId: string
    styleNo: string
    name: string
    quantity: number
  }>
  reason: string
  confidence: number
}

export type AccessorySuggestResult = {
  reason: string
  rules: AccessorySuggestRule[]
  contexts: AccessoryContextDecision[]
}

export type ItemNameSuggestResult = {
  reason: string
  contexts: AccessoryContextDecision[]
}
export type AiFeatureKey = (typeof AI_FEATURE_KEYS)[number]

export const PROVIDER_SECRET: Record<AiProvider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
}

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
}

export type AiModel = {
  id: string
  displayName: string
  provider: AiProvider
}

export type NormalizedUsage = {
  inputTokens: number | null
  outputTokens: number | null
}

export type ProductCandidate = {
  source: string
  lookupKey: string
  styleId: string
  styleNo: string
  name: string
  score: number
}

export type RecommendProduct = {
  styleId: string
  styleNo: string
  name: string
  reason: string
  confidence: number
}

export type RecommendResult = {
  lookupKey: string
  reason: string
  products: RecommendProduct[]
}

export type HybridAction = 'local' | 'manual' | 'ai'

export type HybridDecisionConfig = {
  high: number
  margin: number
  low: number
  aiTopN: number
}

export const DEFAULT_DECISION_CONFIG: HybridDecisionConfig = {
  high: 0.72,
  margin: 0.1,
  low: 0.4,
  aiTopN: 16,
}

export type HybridDecision = {
  action: HybridAction
  ranked: ProductCandidate[]
  aiCandidates: ProductCandidate[]
  topScore: number
  margin: number
  reason: string
}

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value)
}

export function missingKeyError(provider: AiProvider) {
  return {
    ok: false as const,
    error: `${PROVIDER_LABEL[provider]} API 키가 없습니다. Edge Function Secret에 ${PROVIDER_SECRET[provider]}를 등록하세요.`,
    missingSecret: PROVIDER_SECRET[provider],
  }
}

const OPENAI_EXCLUDE =
  /(embedding|whisper|tts|dall-e|davinci|babbage|ada|moderation|transcribe|realtime|sora|image|audio|search)/i

export function parseOpenAiModels(payload: unknown): AiModel[] {
  const data = asRecord(payload)?.data
  if (!Array.isArray(data)) return []
  const models: AiModel[] = []
  for (const item of data) {
    const row = asRecord(item)
    const id = asString(row?.id)
    if (!id || OPENAI_EXCLUDE.test(id)) continue
    models.push({ id, displayName: id, provider: 'openai' })
  }
  return sortModels(models)
}

export function parseAnthropicModels(payload: unknown): AiModel[] {
  const data = asRecord(payload)?.data
  if (!Array.isArray(data)) return []
  const models: AiModel[] = []
  for (const item of data) {
    const row = asRecord(item)
    const id = asString(row?.id)
    if (!id) continue
    models.push({
      id,
      displayName: asString(row?.display_name) || id,
      provider: 'anthropic',
    })
  }
  return sortModels(models)
}

export function parseGeminiModels(payload: unknown): AiModel[] {
  const data = asRecord(payload)?.models
  if (!Array.isArray(data)) return []
  const models: AiModel[] = []
  for (const item of data) {
    const row = asRecord(item)
    const rawName = asString(row?.name)
    if (!rawName) continue
    const methods = Array.isArray(row?.supportedGenerationMethods)
      ? row.supportedGenerationMethods.map((value) => String(value))
      : []
    if (methods.length > 0 && !methods.includes('generateContent')) continue
    if (/embedding|imagen|aqa|robotics|veo/i.test(rawName)) continue
    const id = rawName.replace(/^models\//, '')
    models.push({
      id,
      displayName: asString(row?.displayName) || id,
      provider: 'gemini',
    })
  }
  return sortModels(models)
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('AI 응답이 비어 있습니다.')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) {
      throw new Error('AI 응답에서 JSON을 찾지 못했습니다.')
    }
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

export function parseRecommendJson(
  payload: unknown,
  lookupKeys: string[],
  candidates: ProductCandidate[],
): RecommendResult {
  const row = asRecord(payload)
  if (!row) throw new Error('AI 추천 JSON 형식이 아닙니다.')

  const lookupKey = pickLookupKey(
    asString(row.lookupKey) || asString(row.lookup_key),
    lookupKeys,
  )
  const reason = asString(row.reason)
  const rawProducts = Array.isArray(row.products) ? row.products : []
  const products = filterHallucinatedProducts(
    rawProducts.map((item) => {
      const product = asRecord(item)
      return {
        styleId: asString(product?.styleId) || asString(product?.style_id),
        styleNo: asString(product?.styleNo) || asString(product?.style_no),
        name: asString(product?.name),
        reason: asString(product?.reason),
        confidence: clampConfidence(product?.confidence),
      }
    }),
    candidates,
  ).slice(0, 3)

  return { lookupKey, reason, products }
}

export function pickLookupKey(value: string, lookupKeys: string[]) {
  const normalized = value.trim().toLocaleLowerCase('ko-KR')
  const exact = lookupKeys.find(
    (key) => key.trim().toLocaleLowerCase('ko-KR') === normalized,
  )
  return exact ?? lookupKeys[0] ?? value.trim()
}

export function filterHallucinatedProducts(
  products: RecommendProduct[],
  candidates: ProductCandidate[],
): RecommendProduct[] {
  const byId = new Map(candidates.map((item) => [item.styleId, item]))
  const seen = new Set<string>()
  const next: RecommendProduct[] = []
  for (const product of products) {
    const match = byId.get(product.styleId)
    if (!match || seen.has(match.styleId)) continue
    seen.add(match.styleId)
    next.push({
      styleId: match.styleId,
      styleNo: match.styleNo,
      name: match.name,
      reason: product.reason,
      confidence: product.confidence,
    })
  }
  return next
}

export function normalizeUsage(input: unknown, output: unknown): NormalizedUsage {
  return {
    inputTokens: asPositiveInt(input),
    outputTokens: asPositiveInt(output),
  }
}

export function buildRecommendPrompt(input: {
  mallName: string
  productName: string
  itemName: string
  lookupKeys: string[]
  candidates: ProductCandidate[]
}) {
  const system = [
    '당신은 쇼핑몰 송장 품목명을 브랜드 공식 상품에 연결하는 어시스턴트입니다.',
    '반드시 JSON만 반환하세요.',
    'lookupKey는 제공된 조회 키 목록에서만 고르세요.',
    'products는 제공된 후보의 styleId만 사용하고 최대 3개입니다.',
    '주문자 개인정보나 주소는 다루지 않습니다.',
    '형식: {"lookupKey":"","reason":"","products":[{"styleId":"","styleNo":"","name":"","reason":"","confidence":0.0}]}',
  ].join(' ')

  const user = JSON.stringify({
    mallName: input.mallName,
    productName: input.productName,
    itemName: input.itemName,
    lookupKeys: input.lookupKeys,
    candidates: input.candidates.map((item) => ({
      styleId: item.styleId,
      styleNo: item.styleNo,
      name: item.name,
      lookupKey: item.lookupKey,
      source: item.source,
      score: item.score,
    })),
  })

  return { system, user }
}

export function parseDecisionConfig(value: unknown): HybridDecisionConfig {
  const row = asRecord(value)
  return {
    high: clampUnit(row?.high, DEFAULT_DECISION_CONFIG.high),
    margin: clampUnit(row?.margin, DEFAULT_DECISION_CONFIG.margin),
    low: clampUnit(row?.low, DEFAULT_DECISION_CONFIG.low),
    aiTopN: Math.max(2, Math.min(16, Math.round(Number(row?.aiTopN) || DEFAULT_DECISION_CONFIG.aiTopN))),
  }
}

export function rankCandidates(candidates: ProductCandidate[]): ProductCandidate[] {
  const best = new Map<string, ProductCandidate>()
  for (const item of candidates) {
    if (!item.styleId) continue
    const current = best.get(item.styleId)
    if (!current || item.score > current.score) best.set(item.styleId, item)
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.styleNo.localeCompare(b.styleNo))
}

export function evaluateHybridDecision(
  candidates: ProductCandidate[],
  config: HybridDecisionConfig = DEFAULT_DECISION_CONFIG,
): HybridDecision {
  const ranked = rankCandidates(candidates)
  const top = ranked[0]
  const second = ranked[1]
  const topScore = top?.score ?? 0
  const margin = top ? topScore - (second?.score ?? 0) : 0
  const aiCandidates = ranked.slice(0, config.aiTopN)

  if (!top) {
    return {
      action: 'manual',
      ranked,
      aiCandidates,
      topScore,
      margin,
      reason: '비교할 후보가 없습니다.',
    }
  }

  const exactAlone =
    (top.source === 'ledger_exact' || top.source === 'history') &&
    topScore >= 0.95 &&
    ranked.filter((item) => item.score >= 0.95).length === 1
  if (exactAlone) {
    return {
      action: 'local',
      ranked,
      aiCandidates: ranked.slice(0, 3),
      topScore,
      margin,
      reason: '확정 원장 또는 등록 이력과 맞습니다.',
    }
  }

  if (ranked.length === 1 && topScore < config.low) {
    return {
      action: 'manual',
      ranked,
      aiCandidates,
      topScore,
      margin,
      reason: '후보가 하나뿐이고 점수가 낮습니다.',
    }
  }

  if (topScore >= config.high && margin >= config.margin) {
    return {
      action: 'local',
      ranked,
      aiCandidates: ranked.slice(0, 3),
      topScore,
      margin,
      reason: '원장 유사도 1위가 충분합니다.',
    }
  }

  if (ranked.length === 1) {
    return {
      action: 'local',
      ranked,
      aiCandidates: ranked.slice(0, 3),
      topScore,
      margin,
      reason: '후보가 하나라 원장 추천을 씁니다.',
    }
  }

  return {
    action: 'ai',
    ranked,
    aiCandidates,
    topScore,
    margin,
    reason: '상위 후보가 비슷해 AI가 다시 고릅니다.',
  }
}

export function buildLocalRecommendation(
  lookupKeys: string[],
  ranked: ProductCandidate[],
): RecommendResult {
  const top = ranked[0]
  return {
    lookupKey: pickLookupKey(top?.lookupKey ?? '', lookupKeys),
    reason: '원장·유사도 점수가 충분합니다.',
    products: ranked.slice(0, 3).map((item) => ({
      styleId: item.styleId,
      styleNo: item.styleNo,
      name: item.name,
      reason: item.source,
      confidence: clampConfidence(item.score),
    })),
  }
}

export function tuneDecisionConfig(
  samples: Array<{
    candidates: ProductCandidate[]
    styleId: string
  }>,
): HybridDecisionConfig {
  let best = DEFAULT_DECISION_CONFIG
  let bestScore = -1
  for (const high of [0.6, 0.66, 0.72, 0.78, 0.85]) {
    for (const margin of [0.06, 0.1, 0.14]) {
      for (const low of [0.3, 0.4, 0.5]) {
        const config = { high, margin, low, aiTopN: 16 }
        let local = 0
        let localCorrect = 0
        let aiCalls = 0
        for (const sample of samples) {
          const decision = evaluateHybridDecision(sample.candidates, config)
          if (decision.action === 'ai') {
            aiCalls += 1
            continue
          }
          if (decision.action !== 'local') continue
          local += 1
          if (decision.ranked[0]?.styleId === sample.styleId) localCorrect += 1
        }
        const precision = local === 0 ? 0 : localCorrect / local
        if (precision < 0.95) continue
        const score = precision * 1000 - aiCalls
        if (score > bestScore) {
          bestScore = score
          best = config
        }
      }
    }
  }
  return best
}

export function summarizeHybridReplay(
  samples: Array<{
    candidates: ProductCandidate[]
    styleId: string
  }>,
  config: HybridDecisionConfig = DEFAULT_DECISION_CONFIG,
) {
  let local = 0
  let localCorrect = 0
  let aiCalls = 0
  let manual = 0
  for (const sample of samples) {
    const decision = evaluateHybridDecision(sample.candidates, config)
    if (decision.action === 'ai') {
      aiCalls += 1
      continue
    }
    if (decision.action === 'manual') {
      manual += 1
      continue
    }
    local += 1
    if (decision.ranked[0]?.styleId === sample.styleId) localCorrect += 1
  }
  return {
    total: samples.length,
    local,
    localCorrect,
    localPrecision: local === 0 ? 0 : localCorrect / local,
    aiCalls,
    aiCallRate: samples.length === 0 ? 0 : aiCalls / samples.length,
    manual,
  }
}

export function isAccessoryRuleType(value: string): value is AccessoryRuleType {
  return (ACCESSORY_RULE_TYPES as readonly string[]).includes(value)
}

export function parseAccessorySuggestJson(
  payload: unknown,
  candidates: ProductCandidate[],
  contexts: Array<{ contextId: string; candidateStyleIds?: string[] }> = [],
): AccessorySuggestResult {
  const row = asRecord(payload)
  if (!row) throw new Error('AI 부속품 추천 JSON 형식이 아닙니다.')
  const reason = asString(row.reason)
  const rawRules = Array.isArray(row.rules) ? row.rules : []
  const rules = filterHallucinatedAccessoryRules(
    rawRules.flatMap((item) => {
      const rule = asRecord(item)
      const ruleType = asString(rule?.ruleType || rule?.rule_type).toLocaleLowerCase(
        'en-US',
      )
      if (!isAccessoryRuleType(ruleType) || !asString(rule?.pattern)) return []
      return [
        {
          ruleType,
          pattern: asString(rule?.pattern),
          accessoryKind: asString(rule?.accessoryKind || rule?.accessory_kind),
          namePrefix: asString(rule?.namePrefix || rule?.name_prefix),
          colorName: asString(rule?.colorName || rule?.color_name),
          styleId: asString(rule?.styleId || rule?.style_id),
          styleNo: asString(rule?.styleNo || rule?.style_no),
          name: asString(rule?.name),
          reason: asString(rule?.reason),
          confidence: clampConfidence(rule?.confidence),
        },
      ]
    }),
    candidates,
  ).slice(0, 2)
  return {
    reason,
    rules,
    contexts: filterAccessoryContextDecisions(
      Array.isArray(row.contexts) ? row.contexts : [],
      candidates,
      contexts,
    ),
  }
}

const CONTEXT_ACTIONS = ['components', 'delete', 'hold'] as const

export function itemNameCandidateRefMap(
  candidates: ProductCandidate[],
  usedStyleIds?: Iterable<string>,
) {
  const used = usedStyleIds ? new Set(usedStyleIds) : null
  const compact = used
    ? candidates.filter((candidate) => used.has(candidate.styleId))
    : candidates
  const styleIdByRef = new Map<string, string>()
  compact.forEach((candidate, index) => {
    const ref = `c${index + 1}`
    styleIdByRef.set(ref, candidate.styleId)
    styleIdByRef.set(candidate.styleId, candidate.styleId)
  })
  return { compact, styleIdByRef }
}

export function filterAccessoryContextDecisions(
  raw: unknown[],
  candidates: ProductCandidate[],
  contexts: Array<{ contextId: string; candidateStyleIds?: string[] }> = [],
  fallbackToAllCandidates = true,
): AccessoryContextDecision[] {
  const allowedIds = new Set(contexts.map((item) => item.contextId).filter(Boolean))
  const byContextCandidates = new Map(
    contexts.map((item) => [item.contextId, new Set(item.candidateStyleIds ?? [])]),
  )
  const globalById = new Map(candidates.map((item) => [item.styleId, item]))
  const { styleIdByRef } = itemNameCandidateRefMap(
    candidates,
    contexts.flatMap((item) => item.candidateStyleIds ?? []),
  )
  const next: AccessoryContextDecision[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const row = asRecord(item)
    const contextId = asString(row?.contextId || row?.context_id)
    const action = asString(row?.action).toLocaleLowerCase('en-US')
    if (!contextId || seen.has(contextId)) continue
    if (allowedIds.size > 0 && !allowedIds.has(contextId)) continue
    if (!CONTEXT_ACTIONS.includes(action as (typeof CONTEXT_ACTIONS)[number])) {
      continue
    }
    seen.add(contextId)
    if (action === 'hold' || action === 'delete') {
      next.push({
        contextId,
        action,
        components: [],
        reason: asString(row?.reason),
        confidence: clampConfidence(row?.confidence),
      })
      continue
    }
    const scoped = byContextCandidates.get(contextId)
    const allowed =
      scoped && (scoped.size > 0 || !fallbackToAllCandidates)
        ? scoped
        : new Set(candidates.map((entry) => entry.styleId))
    const used = new Set<string>()
    const components = (Array.isArray(row?.components) ? row.components : []).flatMap(
      (entry) => {
        const component = asRecord(entry)
        const rawId = asString(
          component?.styleId || component?.style_id || component?.ref,
        )
        const styleId = styleIdByRef.get(rawId) ?? rawId
        if (!styleId || used.has(styleId) || !allowed.has(styleId)) return []
        const match = globalById.get(styleId)
        if (!match) return []
        used.add(styleId)
        return [
          {
            styleId: match.styleId,
            styleNo: match.styleNo,
            name: match.name,
            quantity: Math.max(1, Math.min(9, asPositiveInt(component?.quantity) ?? 1)),
          },
        ]
      },
    )
    if (components.length === 0) continue
    next.push({
      contextId,
      action: 'components',
      components,
      reason: asString(row?.reason),
      confidence: clampConfidence(row?.confidence),
    })
  }
  return next.slice(0, 8)
}

export function filterHallucinatedAccessoryRules(
  rules: AccessorySuggestRule[],
  candidates: ProductCandidate[],
): AccessorySuggestRule[] {
  const byId = new Map(candidates.map((item) => [item.styleId, item]))
  const next: AccessorySuggestRule[] = []
  for (const rule of rules) {
    if (!isAccessoryRuleType(rule.ruleType) || !rule.pattern.trim()) continue
    if (rule.ruleType === 'token') {
      const match = byId.get(rule.styleId)
      if (!match) continue
      next.push({
        ...rule,
        styleId: match.styleId,
        styleNo: match.styleNo,
        name: match.name,
      })
      continue
    }
    next.push({
      ...rule,
      styleId: '',
      styleNo: '',
      name: '',
    })
  }
  return next
}

export function buildAccessorySuggestPrompt(input: {
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
  candidates: ProductCandidate[]
}) {
  const system = [
    '당신은 송장 내품명에서 부속품 사전 규칙과 조회 키 exact 초안을 제안하는 어시스턴트입니다.',
    '반드시 JSON만 반환하세요.',
    'ruleType은 label, color, token, ignore, default 중 하나입니다.',
    'token의 styleId와 contexts.components.styleId는 그 문맥에 제공된 후보에만 있어야 합니다.',
    'Pink, Red 같은 단색 단어는 token으로 쓰지 마세요. 모든 문맥에 같은 색상 별칭이면 color를 쓰세요.',
    '같은 조각이 본품·조회 키마다 다른 구성품이면 rules를 비우고 contexts에만 넣으세요.',
    'label/default는 accessoryKind와 namePrefix가 필요합니다. 예: 태슬 / "태슬 - ".',
    'color는 colorName(한글 색상)이 필요합니다.',
    '본품 되풀이이거나 품목명에 이미 있는 색상은 ignore로 제안하세요.',
    '전역 규칙은 최대 2개입니다. 주문자 개인정보는 다루지 않습니다.',
    '형식: {"reason":"","rules":[{"ruleType":"color","pattern":"","accessoryKind":"","namePrefix":"","colorName":"","styleId":"","confidence":0.0,"reason":""}],"contexts":[{"contextId":"","action":"components","components":[{"styleId":"","quantity":1}],"confidence":0.0,"reason":""}]}',
  ].join(' ')

  const user = JSON.stringify({
    unknownPiece: input.unknownPiece,
    itemNames: input.itemNames,
    lookupKeys: input.lookupKeys,
    mainProducts: input.mainProducts,
    contexts: input.contexts ?? [],
    dictionary: input.dictionary,
    candidates: input.candidates.map((item) => ({
      styleId: item.styleId,
      styleNo: item.styleNo,
      name: item.name,
      lookupKey: item.lookupKey,
      source: item.source,
      score: item.score,
    })),
  })

  return { system, user }
}

export function parseItemNameSuggestJson(
  payload: unknown,
  candidates: ProductCandidate[],
  contexts: Array<{ contextId: string; candidateStyleIds?: string[] }>,
): ItemNameSuggestResult {
  const row = asRecord(payload)
  if (!row) throw new Error('AI 내품명 추천 JSON 형식이 아닙니다.')
  return {
    reason: asString(row.reason),
    contexts: filterAccessoryContextDecisions(
      Array.isArray(row.contexts) ? row.contexts : [],
      candidates,
      contexts,
      false,
    ),
  }
}

export function buildItemNameSuggestPrompt(input: {
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
  candidates: ProductCandidate[]
}) {
  const usedIds = input.contexts.flatMap(
    (context) => context.candidateStyleIds ?? [],
  )
  const { compact, styleIdByRef } = itemNameCandidateRefMap(
    input.candidates,
    usedIds,
  )
  const refByStyleId = new Map<string, string>()
  for (const [ref, styleId] of styleIdByRef) {
    if (ref.startsWith('c')) refByStyleId.set(styleId, ref)
  }
  const candidates = compact.map((candidate) => ({
    ref: refByStyleId.get(candidate.styleId) ?? candidate.styleId,
    styleNo: candidate.styleNo,
    name: candidate.name,
    lookupKey: candidate.lookupKey,
    source: candidate.source,
    score: candidate.score,
  }))
  const contexts = input.contexts.map((context) => ({
    contextId: context.contextId,
    itemName: context.itemName,
    productLookupKey: context.productLookupKey,
    mainProduct: context.mainProduct,
    candidateRefs: (context.candidateStyleIds ?? [])
      .map((styleId) => refByStyleId.get(styleId))
      .filter((ref): ref is string => Boolean(ref)),
    priorExamples: (context.priorExamples ?? []).map((example) => ({
      itemName: example.itemName,
      productLookupKey: example.productLookupKey,
      action: example.action,
      components: example.components.map((item) => ({
        ref: refByStyleId.get(item.styleId) ?? item.styleId,
        quantity: item.quantity,
      })),
    })),
  }))
  const system = [
    '당신은 송장 내품명을 확정 본품과 조회 키 문맥에 맞게 변환하는 어시스턴트입니다.',
    '반드시 JSON만 반환하고 제공된 모든 contextId에 정확히 한 개의 결정을 반환하세요.',
    'action은 components, delete, hold 중 하나입니다.',
    'components는 본품 외에 실제로 함께 출고할 상품이 있을 때만 사용하세요.',
    'delete는 색상, 사이즈, 배송 표시, 선택값처럼 본품의 속성만 있고 추가 출고 상품이 없을 때 사용하세요.',
    '확신할 수 없거나 후보가 없으면 추측하지 말고 hold를 사용하세요.',
    'components.styleId에는 해당 문맥의 candidateRefs 값만 넣고 확정 본품 자체는 구성품에 넣지 마세요.',
    '같은 구성품은 한 번만 쓰고 quantity로 수량을 나타내세요.',
    'priorExamples는 사람이 확정한 과거 사례입니다. 참고만 하고 후보 밖 참조는 쓰지 마세요.',
    'confidence는 0부터 1 사이입니다. 주문자 개인정보는 다루지 않습니다.',
    '형식: {"reason":"","contexts":[{"contextId":"","action":"components","components":[{"styleId":"c1","quantity":1}],"confidence":0.0,"reason":""}]}',
  ].join(' ')
  const user = JSON.stringify({
    contexts,
    candidates,
  })
  return { system, user, refByStyleId }
}

export function clampTextList(values: string[], maxItems: number, maxChars: number) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((value) => value.slice(0, maxChars))
}

function sortModels(models: AiModel[]) {
  return [...models].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function asPositiveInt(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number < 0) return null
  return Math.round(number)
}

function clampConfidence(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(1, number))
}

function clampUnit(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(1, number))
}
