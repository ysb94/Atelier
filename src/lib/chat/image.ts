import { chatFileExtension } from '@/lib/chat/file-rules'
import { timeChatWork } from '@/lib/chat/chat-work-perf'

const THUMB_EDGE = 480
const RASTER = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif'])

export type PreparedChatImage = {
  file: File
  thumb: Blob | null
}

function isHeicName(file: File) {
  const ext = chatFileExtension(file.name)
  const mime = file.type.toLowerCase()
  return ext === 'heic' || ext === 'heif' || mime === 'image/heic' || mime === 'image/heif'
}

function isRaster(file: File) {
  const ext = chatFileExtension(file.name)
  return RASTER.has(ext) || file.type.startsWith('image/')
}

async function convertHeicToJpeg(file: File): Promise<File> {
  const { heicTo } = await import('heic-to')
  const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.82 })
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
}

async function makeThumb(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height, 1))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('썸네일을 만들지 못했습니다.')
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8)
    })
    if (!blob) throw new Error('썸네일을 만들지 못했습니다.')
    return blob
  } finally {
    bitmap.close()
  }
}

/** HEIC는 JPG로 바꾸고, 그림이면 480px 썸네일을 만든다. 썸네일 실패는 원본 전송을 막지 않는다. */
export async function prepareChatImage(file: File): Promise<PreparedChatImage> {
  return timeChatWork('prepare-image', async () => {
    let next = file
    if (isHeicName(file)) {
      try {
        next = await convertHeicToJpeg(file)
      } catch (error) {
        console.warn('[chat] HEIC 변환 실패', {
          name: file.name,
          message: error instanceof Error ? error.message : String(error),
        })
        throw new Error('이 사진은 JPG로 바꾸지 못했습니다.')
      }
    }
    if (!isRaster(next) || chatFileExtension(next.name) === 'svg') {
      return { file: next, thumb: null }
    }
    try {
      const thumb = await makeThumb(next)
      return { file: next, thumb }
    } catch (error) {
      console.warn('[chat] 썸네일 실패', {
        name: next.name,
        message: error instanceof Error ? error.message : String(error),
      })
      return { file: next, thumb: null }
    }
  })
}
