import { imageModel, type StyledImageRequest } from '../../../supabase/functions/_shared/styled-image-core.ts'

export const STUDIO_LIBRARY_MAX_EDGE = 4096
export const STUDIO_LIBRARY_SAFE_DATA_BYTES = 6 * 1024 * 1024
export const STUDIO_ENCODE_QUALITY_STEPS = [0.92, 0.86, 0.8, 0.74, 0.68] as const
export const STUDIO_ENCODE_EDGE_STEPS = [4096, 3072, 2560, 2048, 1600, 1280] as const
export const STUDIO_REQUEST_BUDGET_BYTES = { openai: 22 * 1024 * 1024, gemini: 18 * 1024 * 1024 } as const

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type StudioEncodePlan = { quality: number; maxEdge: number }
export type StudioEncodeFn = (dataUrl: string, plan: StudioEncodePlan) => Promise<string>

export function studioRequestBudgetBytes(provider: 'openai' | 'gemini') {
  return STUDIO_REQUEST_BUDGET_BYTES[provider]
}

export function studioRequestPayloadBytes(request: Pick<StyledImageRequest, 'prompt' | 'images'>) {
  return request.prompt.length + request.images.reduce((sum, item) => sum + item.data.length + item.name.length + item.role.length, 0)
}

export function needsLibraryNormalize(input: { mime: string; width: number; height: number; dataBytes: number }) {
  if (!ALLOWED_TYPES.includes(input.mime as (typeof ALLOWED_TYPES)[number])) return true
  if (Math.max(input.width, input.height) > STUDIO_LIBRARY_MAX_EDGE) return true
  return input.dataBytes > STUDIO_LIBRARY_SAFE_DATA_BYTES
}

export function scaledStudioSize(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (!width || !height || longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function initialStudioEncodePlan(): StudioEncodePlan {
  return { quality: STUDIO_ENCODE_QUALITY_STEPS[0], maxEdge: STUDIO_ENCODE_EDGE_STEPS[0] }
}

export function nextStudioEncodePlan(plan: StudioEncodePlan): StudioEncodePlan | null {
  const qualityIndex = STUDIO_ENCODE_QUALITY_STEPS.indexOf(plan.quality as (typeof STUDIO_ENCODE_QUALITY_STEPS)[number])
  if (qualityIndex >= 0 && qualityIndex < STUDIO_ENCODE_QUALITY_STEPS.length - 1) {
    return { quality: STUDIO_ENCODE_QUALITY_STEPS[qualityIndex + 1], maxEdge: plan.maxEdge }
  }
  const edgeIndex = STUDIO_ENCODE_EDGE_STEPS.indexOf(plan.maxEdge as (typeof STUDIO_ENCODE_EDGE_STEPS)[number])
  if (edgeIndex >= 0 && edgeIndex < STUDIO_ENCODE_EDGE_STEPS.length - 1) {
    return { quality: plan.quality, maxEdge: STUDIO_ENCODE_EDGE_STEPS[edgeIndex + 1] }
  }
  return null
}

export async function fitStudioRequestImages(
  request: StyledImageRequest,
  provider: 'openai' | 'gemini' = imageModel(request.modelId).provider,
  encode: StudioEncodeFn = encodeStudioImage,
): Promise<StyledImageRequest> {
  const budget = studioRequestBudgetBytes(provider)
  if (studioRequestPayloadBytes(request) <= budget) return request
  let plan: StudioEncodePlan | null = initialStudioEncodePlan()
  let images = request.images
  while (plan && studioRequestPayloadBytes({ prompt: request.prompt, images }) > budget) {
    const encoded = []
    for (const item of request.images) encoded.push({ ...item, data: await encode(item.data, plan) })
    images = encoded
    if (studioRequestPayloadBytes({ prompt: request.prompt, images }) <= budget) break
    plan = nextStudioEncodePlan(plan)
  }
  if (studioRequestPayloadBytes({ prompt: request.prompt, images }) > budget) {
    throw new Error('참고자료가 커서 요청 한도에 맞추지 못했습니다. 첨부 장수를 줄여 주세요.')
  }
  return { ...request, images }
}

export async function normalizeStudioUpload(file: File): Promise<{ data: string; type: string }> {
  if (file.type && !ALLOWED_TYPES.includes(file.type as (typeof ALLOWED_TYPES)[number])) {
    throw new Error('JPG·PNG·WEBP 사진을 선택해 주세요.')
  }
  const bitmap = await readStudioBitmap(file)
  if (bitmap) {
    try {
      const keepOriginal = !!file.type && !needsLibraryNormalize({
        mime: file.type,
        width: bitmap.width,
        height: bitmap.height,
        dataBytes: Math.ceil(file.size * 4 / 3) + 32,
      })
      if (keepOriginal) {
        const data = await readStudioFileDataUrl(file)
        return { data, type: studioDataMime(data) ?? file.type }
      }
      const encoded = drawStudioImage(bitmap, initialStudioEncodePlan())
      return { data: encoded, type: studioDataMime(encoded) ?? 'image/webp' }
    } finally {
      bitmap.close()
    }
  }
  const data = await readStudioFileDataUrl(file)
  const image = await decodeStudioImage(data)
  const mime = studioDataMime(data) ?? file.type
  if (!needsLibraryNormalize({ mime, width: image.width, height: image.height, dataBytes: data.length })) {
    return { data, type: mime || 'image/jpeg' }
  }
  const encoded = await encodeStudioImage(data, initialStudioEncodePlan())
  return { data: encoded, type: studioDataMime(encoded) ?? 'image/webp' }
}

export async function encodeStudioImage(dataUrl: string, plan: StudioEncodePlan): Promise<string> {
  const image = await decodeStudioImage(dataUrl)
  const encoded = drawStudioImage(image, plan)
  const size = scaledStudioSize(image.width, image.height, plan.maxEdge)
  if (encoded.length >= dataUrl.length && size.width === image.width && size.height === image.height) return dataUrl
  return encoded
}

function studioDataMime(dataUrl: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(dataUrl)
  return match?.[1]
}

function readStudioFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('사진을 읽지 못했습니다.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('사진을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

async function readStudioBitmap(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null
  try { return await createImageBitmap(file) }
  catch (error) {
    console.warn('[styled-studio] 비트맵 디코딩 실패', { path: typeof location === 'undefined' ? 'verification' : location.pathname, name: file.name, error })
    return null
  }
}

async function decodeStudioImage(src: string): Promise<HTMLImageElement> {
  if (typeof Image === 'undefined') throw new Error('브라우저에서 이미지를 처리할 수 있습니다.')
  const image = new Image()
  image.src = src
  try {
    if (typeof image.decode === 'function') await image.decode()
    else await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('사진을 열 수 없습니다. JPG·PNG·WEBP인지 확인해 주세요.'))
    })
  } catch {
    throw new Error('사진을 열 수 없습니다. JPG·PNG·WEBP인지 확인해 주세요.')
  }
  if (!image.width || !image.height) throw new Error('사진 크기를 확인하지 못했습니다.')
  return image
}

function drawStudioImage(source: CanvasImageSource & { width: number; height: number }, plan: StudioEncodePlan) {
  if (typeof document === 'undefined') throw new Error('브라우저에서 이미지를 처리할 수 있습니다.')
  const size = scaledStudioSize(source.width, source.height, plan.maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('브라우저에서 이미지를 처리하지 못했습니다.')
  try {
    context.drawImage(source, 0, 0, size.width, size.height)
    let encoded = canvas.toDataURL('image/webp', plan.quality)
    if (!encoded.startsWith('data:image/webp')) encoded = canvas.toDataURL('image/jpeg', plan.quality)
    if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(encoded)) throw new Error('이미지를 고화질로 변환하지 못했습니다.')
    return encoded
  } catch (error) {
    console.warn('[styled-studio] 이미지 재인코딩 실패', { path: typeof location === 'undefined' ? 'verification' : location.pathname, error })
    if (error instanceof Error && /고화질로 변환/.test(error.message)) throw error
    throw new Error('이미지가 너무 커서 이 브라우저에서 처리하지 못했습니다.')
  }
}
