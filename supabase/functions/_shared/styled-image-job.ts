import { DEFAULT_DIRECTOR_MODEL_ID, imageModel, outputSize, parseGeneratedImage, type StyledImageModelId, type StyledImageRequest, type StyledImageResult } from './styled-image-core.ts'

export type StudioImageJob = { token: string; modelId: StyledImageModelId; startedAt: number }
export type StudioImageJobStatus = { status: 'queued' | 'in_progress'; job: StudioImageJob } | { status: 'completed'; result: StyledImageResult } | { status: 'failed'; error: string }
type JobClaims = { id: string; userId: string; modelId: StyledImageModelId; startedAt: number; expiresAt: number }
const encoder = new TextEncoder()
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0))
async function signingKey(secret: string) {
  if (!secret) throw new Error('이미지 작업 서명 키가 없습니다.')
  return crypto.subtle.importKey('raw', encoder.encode(`atelier-styled-image-job-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
export async function createImageJob(id: string, userId: string, modelId: StyledImageModelId, secret: string, startedAt = Date.now()): Promise<StudioImageJob> {
  if (!/^resp_[A-Za-z0-9_-]{1,200}$/.test(id)) throw new Error('이미지 작업 번호를 확인하지 못했습니다.')
  const claims: JobClaims = { id, userId, modelId, startedAt, expiresAt: startedAt + 30 * 60_000 }
  const payload = encode(encoder.encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload))
  return { token: `${payload}.${encode(new Uint8Array(signature))}`, modelId, startedAt }
}
export async function readImageJob(token: unknown, userId: string, secret: string, now = Date.now()): Promise<JobClaims> {
  if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('이미지 작업 번호가 올바르지 않습니다.')
  const [payload, signature] = token.split('.')
  if (!await crypto.subtle.verify('HMAC', await signingKey(secret), decode(signature), encoder.encode(payload))) throw new Error('이미지 작업 서명을 확인하지 못했습니다.')
  const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as JobClaims
  if (claims.userId !== userId || !/^resp_[A-Za-z0-9_-]{1,200}$/.test(claims.id) || imageModel(claims.modelId).provider !== 'openai') throw new Error('본인이 요청한 이미지 작업만 확인할 수 있습니다.')
  if (!Number.isFinite(claims.expiresAt) || now > claims.expiresAt) throw new Error('이미지 작업 조회 기한이 지났습니다.')
  return claims
}
export function openAiBackgroundImageBody(request: StyledImageRequest) {
  if (imageModel(request.modelId).provider !== 'openai') throw new Error('이 모델은 OpenAI 작업으로 요청할 수 없습니다.')
  return {
    model: DEFAULT_DIRECTOR_MODEL_ID,
    background: true, store: false, reasoning: { effort: 'none' },
    instructions: 'Execute the supplied image brief using the image_generation tool exactly once. Preserve the supplied photo labels and explicit edits. The brief has already been planned; do not ask questions or produce another plan. Return the completed image.',
    input: [{ role: 'user', content: [
      { type: 'input_text', text: request.prompt },
      ...request.images.flatMap(image => [{ type: 'input_text', text: `${image.name}: ${image.role}` }, { type: 'input_image', image_url: image.data }]),
    ] }],
    tools: [{ type: 'image_generation', model: request.modelId, size: outputSize(request), quality: request.settings?.quality ?? 'medium', output_format: 'png', action: 'edit' }],
    tool_choice: { type: 'image_generation' }, parallel_tool_calls: false,
  }
}
export function readBackgroundImage(payload: unknown, job: StudioImageJob, now = Date.now()): StudioImageJobStatus {
  const response = payload as { status?: string; output?: Array<{ type?: string; status?: string; result?: string }> }
  if (response.status === 'queued' || response.status === 'in_progress') return { status: response.status, job }
  if (response.status !== 'completed') return { status: 'failed', error: `이미지 제공자가 작업을 완료하지 못했습니다 (${response.status ?? '알 수 없는 상태'}).` }
  const image = response.output?.find(item => item.type === 'image_generation_call' && item.status === 'completed' && item.result)
  if (!image) return { status: 'failed', error: '이미지 작업이 끝났지만 완성 이미지를 반환하지 않았습니다. 요청과 제공자 상태를 확인해 주세요.' }
  return { status: 'completed', result: { data: parseGeneratedImage('openai', { data: [{ b64_json: image.result }] }), modelId: job.modelId, latencyMs: now - job.startedAt } }
}
