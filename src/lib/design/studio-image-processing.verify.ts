/**
 * 스튜디오 업로드 정규화·요청 예산 검증.
 * 실행: npx tsx src/lib/design/studio-image-processing.verify.ts
 */
import { MAX_IMAGE_REQUEST_BYTES, validateImageRequest } from '../../../supabase/functions/_shared/styled-image-core.ts'
import {
  fitStudioRequestImages,
  initialStudioEncodePlan,
  needsLibraryNormalize,
  nextStudioEncodePlan,
  scaledStudioSize,
  studioRequestBudgetBytes,
  studioRequestPayloadBytes,
  STUDIO_ENCODE_EDGE_STEPS,
  STUDIO_LIBRARY_MAX_EDGE,
  STUDIO_LIBRARY_SAFE_DATA_BYTES,
} from './studio-image-processing.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function fakeDataUrl(bytes: number) {
  const prefix = 'data:image/jpeg;base64,'
  let body = Math.max(4, bytes - prefix.length)
  body -= body % 4
  return prefix + 'A'.repeat(body)
}

assert(!needsLibraryNormalize({ mime: 'image/jpeg', width: 2000, height: 1500, dataBytes: 800_000 }), '작은 JPEG는 재인코딩하지 않는다')
assert(needsLibraryNormalize({ mime: 'image/jpeg', width: 5000, height: 3000, dataBytes: 800_000 }), '긴 변이 4096을 넘으면 정규화')
assert(needsLibraryNormalize({ mime: 'image/png', width: 2000, height: 1500, dataBytes: STUDIO_LIBRARY_SAFE_DATA_BYTES + 1 }), '용량이 크면 정규화')
assert(needsLibraryNormalize({ mime: 'image/gif', width: 200, height: 200, dataBytes: 100 }), '허용 형식이 아니면 정규화')

const scaled = scaledStudioSize(8000, 4000, STUDIO_LIBRARY_MAX_EDGE)
assert(scaled.width === STUDIO_LIBRARY_MAX_EDGE, '긴 변을 4096으로 맞춘다')
assert(scaled.height === 2048, '짧은 변은 비율을 유지한다')
assert(scaledStudioSize(1024, 768, STUDIO_LIBRARY_MAX_EDGE).width === 1024, '이미 작으면 그대로')

assert(studioRequestBudgetBytes('gemini') < studioRequestBudgetBytes('openai'), 'Gemini 예산이 더 보수적')
assert(studioRequestBudgetBytes('openai') < MAX_IMAGE_REQUEST_BYTES - 64_000, 'OpenAI 예산은 서버 하드 제한보다 작다')
assert(studioRequestBudgetBytes('gemini') < MAX_IMAGE_REQUEST_BYTES - 64_000, 'Gemini 예산은 서버 하드 제한보다 작다')

const plans = [initialStudioEncodePlan()]
for (let current = nextStudioEncodePlan(plans[0]); current; current = nextStudioEncodePlan(current)) {
  plans.push(current)
  if (plans.length > 20) throw new Error('인코딩 계획이 순환한다')
}
assert(plans[1].quality < plans[0].quality, '품질을 먼저 낮춘다')
assert(plans[1].maxEdge === plans[0].maxEdge, '품질 단계에서는 해상도를 유지한다')
assert(plans.some((plan) => plan.maxEdge < plans[0].maxEdge), '품질 다음 해상도를 줄인다')
assert(plans.at(-1)?.maxEdge === STUDIO_ENCODE_EDGE_STEPS.at(-1), '마지막은 가장 작은 긴 변')

const huge = fakeDataUrl(12 * 1024 * 1024)
const oversized = {
  modelId: 'gemini-3-pro-image' as const,
  prompt: 'x'.repeat(1200),
  ratio: '4:5' as const,
  images: [
    { name: '사진 1', role: '이번 요청에서 용도 해석', data: huge },
    { name: '사진 2', role: '이번 요청에서 용도 해석', data: huge },
  ],
}
assert(studioRequestPayloadBytes(oversized) > studioRequestBudgetBytes('gemini'), '큰 두 장은 Gemini 예산을 넘는다')

const fitted = await fitStudioRequestImages(oversized, 'gemini', async (data, plan) => {
  const scale = (plan.maxEdge / 4096) * (plan.quality / 0.92)
  return fakeDataUrl(Math.max(800, Math.floor(data.length * scale)))
})
assert(studioRequestPayloadBytes(fitted) <= studioRequestBudgetBytes('gemini'), '최적화 후 Gemini 예산 안')
assert(validateImageRequest(fitted) === fitted, '최적화된 요청은 서버 검증을 통과한다')

let encodeCalls = 0
const small = {
  modelId: 'gpt-image-2' as const,
  prompt: '제품 사진 보존',
  ratio: '1:1' as const,
  images: [{ name: '사진 1', role: '이번 요청에서 용도 해석', data: fakeDataUrl(1200) }],
}
const untouched = await fitStudioRequestImages(small, 'openai', async (data) => {
  encodeCalls += 1
  return data
})
assert(encodeCalls === 0, '예산 안이면 재인코딩하지 않는다')
assert(untouched === small, '예산 안이면 원본 요청을 그대로 쓴다')

let failed = false
try {
  await fitStudioRequestImages(oversized, 'gemini', async (data) => data)
} catch (error) {
  failed = error instanceof Error && error.message.includes('첨부 장수')
}
assert(failed, '줄이지 못하면 첨부 장수를 줄이라고 안내한다')

console.log('studio-image-processing.verify ok')
