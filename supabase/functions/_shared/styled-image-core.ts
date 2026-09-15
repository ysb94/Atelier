import type { StudioImageJob } from './styled-image-job.ts'
// Shared by the browser, Edge Function and contract tests. No credentials here.
export const STYLED_IMAGE_MODELS = [
  { id: 'gpt-image-2', label: 'GPT Image 2', provider: 'openai' },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 · Flare', provider: 'openai' },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 · Sunburst', provider: 'openai' },
  { id: 'gemini-3-pro-image', label: '나노바나나 Pro', provider: 'gemini' },
] as const
export type StyledImageModelId = (typeof STYLED_IMAGE_MODELS)[number]['id']
export type StyledDirectorModelId = string
export const DEFAULT_DIRECTOR_MODEL_ID = 'gpt-5.6-luna'
const DIRECTOR_EXCLUDE = /(embedding|whisper|tts|dall-e|davinci|babbage|ada|moderation|transcribe|realtime|sora|image|audio|search|codex|computer-use|oss|live|cyber|daybreak|rosalind|chatgpt|preview|deep-research)/i
const DIRECTOR_ALLOW = /^(gpt-4\.1([.-]|$)|gpt-4o([.-]|$)|gpt-[5-9](\.\d+)?([.-]|$))/
export function isDirectorModelId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= 80 && !/-\d{4}-\d{2}-\d{2}$/.test(id)
    && DIRECTOR_ALLOW.test(id) && !DIRECTOR_EXCLUDE.test(id)
}
export function directorModelLabel(id: string) {
  return id.replace(/^gpt-/i, 'GPT-').replace(/-([a-z])/g, (_, letter: string) => ` ${letter.toUpperCase()}`)
}
export function preferredDirectorModelId(ids: readonly string[]) {
  const available = ids.filter(isDirectorModelId)
  const preferred = ['gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5-mini', 'gpt-4.1-mini', DEFAULT_DIRECTOR_MODEL_ID]
  return preferred.find((id) => available.includes(id))
    ?? available.find((id) => /-(luna|mini|nano)$/.test(id))
    ?? available[0]
    ?? DEFAULT_DIRECTOR_MODEL_ID
}
export function parseDirectorModels(payload: unknown): StyledDirectorAvailability[] {
  const rows = (payload as { data?: Array<{ id?: string }> } | null)?.data
  if (!Array.isArray(rows)) return []
  return [...new Set(rows.map((item) => item?.id).filter(isDirectorModelId))]
    .sort((a, b) => directorFamily(b) - directorFamily(a) || a.length - b.length || a.localeCompare(b))
    .map((id) => ({ modelId: id, label: directorModelLabel(id), available: true, message: '모델 조회 확인 · 분석 시 API 요금 발생' }))
}
function directorFamily(id: string) {
  const match = /^gpt-(\d+(?:\.\d+)?)/.exec(id)
  return match ? Number(match[1]) : 0
}
export const IMAGE_SIZES = { '1:1': '1024x1024', '4:5': '1024x1280', '3:4': '960x1280', '16:9': '1536x864' } as const
export const HIGH_IMAGE_SIZES = { '1:1': '2048x2048', '4:5': '2048x2560', '3:4': '1920x2560', '16:9': '3072x1728' } as const
export type ImageSettings = { resolution: '1K' | '2K' | '4K'; quality: 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
export const DEFAULT_IMAGE_SETTINGS: ImageSettings = { resolution: '2K', quality: 'high' }
export function imageQualities(modelId: StyledImageModelId): ImageSettings['quality'][] {
  return modelId.startsWith('gpt-image-2.5-') ? ['low', 'medium', 'high', 'xhigh', 'max'] : ['low', 'medium', 'high']
}
export function outputSize(request: Pick<StyledImageRequest, 'ratio' | 'settings'>) {
  return (request.settings?.resolution === '2K' ? HIGH_IMAGE_SIZES : IMAGE_SIZES)[request.ratio]
}
export const MAX_IMAGE_REQUEST_BYTES = 24 * 1024 * 1024
export const MAX_IMAGE_COUNT = 14
export type StyledImageInput = { name: string; role: string; data: string }
export type StyledImageRequest = {
  modelId: StyledImageModelId
  directorModelId?: StyledDirectorModelId
  prompt: string
  ratio: keyof typeof IMAGE_SIZES
  images: StyledImageInput[]
  settings?: ImageSettings
}
export type StyledImageResult = { data: string; modelId: StyledImageModelId; latencyMs: number }
export type StyledImageAvailability = { modelId: StyledImageModelId; available: boolean; message: string }
export type StyledDirectorAvailability = { modelId: string; label: string; available: boolean; message: string }
export type StudioCatalog = { models: StyledImageAvailability[]; directors: StyledDirectorAvailability[] }
export type StudioImageApi = {
  models: () => Promise<StudioCatalog>
  generate: (request: StyledImageRequest, onProgress?: (message: string) => void) => Promise<StyledImageResult>
  resume?: (job: StudioImageJob, onProgress?: (message: string) => void) => Promise<StyledImageResult>
  direct: (request: StyledImageRequest) => Promise<DirectorPlan>
}
export type DirectorPlan = { outputProductIds?: string[]; summary: string; prompt: string; question: string }

export function imageModel(id: unknown) {
  const model = STYLED_IMAGE_MODELS.find((item) => item.id === id)
  if (!model) throw new Error('지원하지 않는 이미지 모델입니다.')
  return model
}

export function directorModel(id: unknown = DEFAULT_DIRECTOR_MODEL_ID) {
  const value = typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_DIRECTOR_MODEL_ID
  if (!isDirectorModelId(value)) throw new Error('지원하지 않는 디렉터 모델입니다.')
  return { id: value, label: directorModelLabel(value) }
}

export function imageData(data: unknown, maxBytes = MAX_IMAGE_REQUEST_BYTES) {
  if (typeof data !== 'string' || data.length > maxBytes) throw new Error('이미지 크기를 확인해 주세요.')
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data)
  if (!match || match[2].length % 4 !== 0) throw new Error('JPG·PNG·WEBP 이미지 데이터가 필요합니다.')
  return { mime: match[1], base64: match[2] }
}

export function validateImageRequest(value: unknown): StyledImageRequest {
  if (!value || typeof value !== 'object') throw new Error('이미지 요청이 필요합니다.')
  const body = value as StyledImageRequest
  imageModel(body.modelId)
  if (body.directorModelId !== undefined) directorModel(body.directorModelId)
  if (body.settings !== undefined) {
    if (!body.settings || typeof body.settings !== 'object') throw new Error('출력 설정을 확인해 주세요.')
    const { resolution, quality } = body.settings
    const gemini = imageModel(body.modelId).provider === 'gemini'
    if (!(gemini ? ['1K', '2K', '4K'] : ['1K', '2K']).includes(resolution)) throw new Error('이 모델에서 지원하지 않는 해상도입니다.')
    if (!imageQualities(body.modelId).includes(quality)) throw new Error('이 모델에서 지원하지 않는 품질입니다.')
  }
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 24_000) throw new Error('요청은 1~24,000자로 입력해 주세요.')
  if (!Object.hasOwn(IMAGE_SIZES, body.ratio)) throw new Error('지원하지 않는 비율입니다.')
  if (!Array.isArray(body.images) || !body.images.length || body.images.length > MAX_IMAGE_COUNT) throw new Error(`참고자료는 1~${MAX_IMAGE_COUNT}장까지 사용할 수 있습니다.`)
  let total = body.prompt.length
  for (const item of body.images) {
    if (!item || typeof item.name !== 'string' || item.name.length > 250 || typeof item.role !== 'string' || item.role.length > 100) throw new Error('사진 이름과 역할을 확인해 주세요.')
    imageData(item.data)
    total += item.data.length + item.name.length + item.role.length
  }
  if (total > MAX_IMAGE_REQUEST_BYTES - 64_000) throw new Error('참고자료 용량이 큽니다. 전체 원본 합계를 약 17MB 이하로 줄여 주세요.')
  return body
}

export function openAiImageBody(request: StyledImageRequest) {
  const body = new FormData()
  body.set('model', request.modelId)
  body.set('prompt', request.prompt)
  body.set('size', outputSize(request))
  body.set('quality', request.settings?.quality ?? 'medium')
  body.set('output_format', 'png')
  body.set('n', '1')
  request.images.forEach((item, index) => {
    const { mime, base64 } = imageData(item.data)
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    body.append('image[]', new Blob([bytes], { type: mime }), `${index + 1}.${mime.split('/')[1]}`)
  })
  return body
}

export function geminiImageBody(request: StyledImageRequest) {
  return {
    model: request.modelId,
    input: [
      { type: 'text', text: request.prompt },
      ...request.images.flatMap((item) => {
        const { mime, base64 } = imageData(item.data)
        return [
          { type: 'text', text: `${item.name}: ${item.role}` },
          { type: 'image', mime_type: mime, data: base64 },
        ]
      }),
    ],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: request.ratio, image_size: request.settings?.resolution ?? '1K' },
    store: false,
  }
}

export function parseGeneratedImage(provider: 'openai' | 'gemini', payload: unknown): string {
  const body = payload as {
    data?: Array<{ b64_json?: string }>
    steps?: Array<{ type?: string; content?: Array<{ type?: string; mime_type?: string; data?: string }> }>
  }
  if (provider === 'openai') {
    const base64 = body?.data?.[0]?.b64_json
    if (base64) { const data = `data:image/png;base64,${base64}`; imageData(data, 64 * 1024 * 1024); return data }
  } else {
    for (const step of body?.steps ?? []) {
      if (step.type !== 'model_output') continue
      for (const item of step.content ?? []) {
        if (item.type === 'image' && item.data && item.mime_type) {
          const data = `data:${item.mime_type};base64,${item.data}`
          imageData(data, 64 * 1024 * 1024)
          return data
        }
      }
    }
  }
  throw new Error('모델이 이미지를 반환하지 않았습니다. 요청과 참고자료를 확인해 주세요.')
}
