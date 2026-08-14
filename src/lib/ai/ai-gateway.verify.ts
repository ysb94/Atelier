/**
 * 멀티프로바이더 게이트웨이 정규화 검증. 실행: npm run verify:ai-gateway
 */
import {
  buildLocalRecommendation,
  evaluateHybridDecision,
  extractJsonObject,
  filterHallucinatedProducts,
  missingKeyError,
  parseAnthropicModels,
  parseGeminiModels,
  parseOpenAiModels,
  parseRecommendJson,
  pickLookupKey,
  rankCandidates,
  tuneDecisionConfig,
} from '@/lib/ai/gateway-core'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const openaiModels = parseOpenAiModels({
  data: [
    { id: 'gpt-4.1-mini' },
    { id: 'text-embedding-3-large' },
    { id: 'whisper-1' },
    { id: 'dall-e-3' },
    { id: 'gpt-4o' },
  ],
})
assert(
  openaiModels.map((model) => model.id).join(',') === 'gpt-4.1-mini,gpt-4o',
  'OpenAI 목록은 생성 모델만 남긴다',
)

const anthropicModels = parseAnthropicModels({
  data: [
    { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
    { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
  ],
})
assert(anthropicModels.length === 2, 'Anthropic 모델 목록을 읽는다')
assert(
  anthropicModels[0]?.displayName.includes('Claude'),
  'Anthropic 표시 이름을 유지한다',
)

const geminiModels = parseGeminiModels({
  models: [
    {
      name: 'models/gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      supportedGenerationMethods: ['generateContent'],
    },
    {
      name: 'models/text-embedding-004',
      displayName: 'Embeddings',
      supportedGenerationMethods: ['embedContent'],
    },
  ],
})
assert(
  geminiModels.length === 1 && geminiModels[0]?.id === 'gemini-2.5-flash',
  'Gemini는 generateContent 모델만 남긴다',
)

const wrapped = extractJsonObject('설명\n{"lookupKey":"A","products":[]}\n끝')
assert(
  (wrapped as { lookupKey: string }).lookupKey === 'A',
  '주변 텍스트 안의 JSON을 꺼낸다',
)

try {
  extractJsonObject('json 없음')
  throw new Error('JSON 없는 응답을 통과시키면 안 된다')
} catch (error) {
  assert(
    error instanceof Error && error.message.includes('JSON'),
    'JSON 오류를 구분한다',
  )
}

const lookupKeys = ['Logo cap Color=Blue', 'Logo cap']
const candidates = [
  {
    source: 'lookup_key',
    lookupKey: 'Logo cap Color=Blue',
    styleId: 's-1',
    styleNo: 'M1001',
    name: '로고 캡 블루',
    score: 0.8,
  },
  {
    source: 'style_name',
    lookupKey: '로고 캡 레드',
    styleId: 's-2',
    styleNo: 'M1002',
    name: '로고 캡 레드',
    score: 0.4,
  },
]

const parsed = parseRecommendJson(
  {
    lookupKey: 'logo cap color=blue',
    reason: '색이 같다',
    products: [
      {
        styleId: 's-1',
        styleNo: 'M1001',
        name: '로고 캡 블루',
        reason: '색 일치',
        confidence: 0.9,
      },
      {
        styleId: 'invented',
        styleNo: 'M9999',
        name: '없는 상품',
        reason: '환각',
        confidence: 0.99,
      },
      {
        styleId: 's-2',
        styleNo: 'M1002',
        name: '로고 캡 레드',
        reason: '같은 시리즈',
        confidence: 0.5,
      },
    ],
  },
  lookupKeys,
  candidates,
)
assert(parsed.lookupKey === 'Logo cap Color=Blue', '조회 키는 제공 목록에서만')
assert(parsed.products.length === 2, '없는 styleId는 버린다')
assert(parsed.products[0]?.styleId === 's-1', '후보 순서를 유지한다')

const filtered = filterHallucinatedProducts(
  [
    {
      styleId: 's-2',
      styleNo: 'x',
      name: 'x',
      reason: '',
      confidence: 1,
    },
    {
      styleId: 's-2',
      styleNo: 'x',
      name: 'x',
      reason: '',
      confidence: 1,
    },
  ],
  candidates,
)
assert(filtered.length === 1, '같은 본품은 한 번만')

assert(pickLookupKey('없는 키', lookupKeys) === lookupKeys[0], '없는 조회 키는 첫 후보')

const missing = missingKeyError('openai')
assert(missing.missingSecret === 'OPENAI_API_KEY', '키 누락은 Secret 이름만')
assert(!missing.error.includes('sk-'), '키 값은 오류에 넣지 않는다')

const exactLocal = evaluateHybridDecision([
  {
    source: 'ledger_exact',
    lookupKey: 'Logo cap Color=Blue',
    styleId: 's-1',
    styleNo: 'M1001',
    name: '로고 캡 블루',
    score: 1,
  },
  {
    source: 'style_name',
    lookupKey: '로고 캡 레드',
    styleId: 's-2',
    styleNo: 'M1002',
    name: '로고 캡 레드',
    score: 0.4,
  },
])
assert(exactLocal.action === 'local', '확정 원장은 AI를 건너뛴다')

const ambiguous = evaluateHybridDecision([
  {
    source: 'lookup_key',
    lookupKey: 'cap blue',
    styleId: 's-1',
    styleNo: 'M1001',
    name: '로고 캡 블루',
    score: 0.51,
  },
  {
    source: 'lookup_key',
    lookupKey: 'cap red',
    styleId: 's-2',
    styleNo: 'M1002',
    name: '로고 캡 레드',
    score: 0.49,
  },
  {
    source: 'style_name',
    lookupKey: '캡',
    styleId: 's-3',
    styleNo: 'M1003',
    name: '캡',
    score: 0.42,
  },
])
assert(ambiguous.action === 'ai', '애매한 후보는 AI를 부른다')
assert(ambiguous.aiCandidates.length <= 6, 'AI에는 상위 6개만 보낸다')

const empty = evaluateHybridDecision([])
assert(empty.action === 'manual', '후보가 없으면 AI를 부르지 않는다')

const weakOne = evaluateHybridDecision([
  {
    source: 'style_name',
    lookupKey: 'x',
    styleId: 's-9',
    styleNo: 'M9',
    name: '약한 후보',
    score: 0.2,
  },
])
assert(weakOne.action === 'manual', '저신뢰 단일 후보는 수동 확인')

const localBuilt = buildLocalRecommendation(lookupKeys, exactLocal.ranked)
assert(localBuilt.products.length === 2, '로컬 추천은 상위 3개까지')
assert(localBuilt.products[0]?.styleId === 's-1', '로컬 1위는 원장 정답')

const ranked = rankCandidates([
  { ...candidates[0]!, score: 0.4 },
  { ...candidates[0]!, score: 0.8 },
  candidates[1]!,
])
assert(ranked.length === 2, '같은 본품은 최고 점수만 남긴다')

const tuned = tuneDecisionConfig([
  { candidates, styleId: 's-1' },
  {
    candidates: [
      {
        source: 'ledger_exact',
        lookupKey: 'A',
        styleId: 's-ok',
        styleNo: 'M1',
        name: '정답',
        score: 1,
      },
    ],
    styleId: 's-ok',
  },
])
assert(tuned.aiTopN === 6, '검증으로 맞춘 설정은 상위 6개')
assert(tuned.high >= 0.6, '로컬 정밀도를 지키는 임계값을 고른다')

console.log('ai-gateway verify: ok')
