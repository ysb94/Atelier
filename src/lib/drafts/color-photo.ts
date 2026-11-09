import { readFileAsDataUrl, shrinkImageDataUrl } from '@/lib/images'
import type { DraftColorRow, DraftSpecs } from '@/lib/types'

const PHOTO_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}
const ALLOWED_TYPES = new Set(Object.values(PHOTO_MIME_TYPES))
const MAX_FILE_BYTES = 15 * 1024 * 1024
// 기획안 목록과 저장 요청에 함께 실리는 사진의 크기를 제한한다.
const MAX_DATA_LENGTH = 96 * 1024

export const DRAFT_COLOR_PHOTO_ACCEPT = [...ALLOWED_TYPES].join(',')

function isColorPhotoDataUrl(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= MAX_DATA_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
}

export async function prepareDraftColorPhoto(file: File): Promise<string> {
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? ''
  const mime = file.type || PHOTO_MIME_TYPES[extension]
  if (!ALLOWED_TYPES.has(mime)) throw new Error('JPG·PNG·WebP 사진을 선택해 주세요.')
  if (file.size > MAX_FILE_BYTES) throw new Error('15MB 이하 사진을 선택해 주세요.')

  let photo = await readFileAsDataUrl(file.type ? file : new File([file], file.name, { type: mime }))
  for (const [maxSize, quality] of [[720, 0.82], [480, 0.72], [320, 0.64]]) {
    photo = await shrinkImageDataUrl(photo, maxSize, quality, { maxDataLength: MAX_DATA_LENGTH, format: 'image/webp' })
    if (isColorPhotoDataUrl(photo)) return photo
  }
  throw new Error('사진을 줄이지 못했습니다. 크기가 작은 사진을 선택해 주세요.')
}

export function normalizeColorPhotoUrls(
  specs: DraftSpecs | null | undefined,
  colors: readonly DraftColorRow[],
): DraftSpecs['colorPhotoUrls'] {
  if (!specs?.colorPhotoUrls) return undefined
  const urls: Record<string, string> = {}
  for (const { id } of colors) {
    const photo = specs.colorPhotoUrls[id]
    if (specs.colorImageChoices?.[id] === 'Image' && isColorPhotoDataUrl(photo)) urls[id] = photo
  }
  return Object.keys(urls).length ? urls : undefined
}
