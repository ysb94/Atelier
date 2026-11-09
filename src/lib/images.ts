/**
 * 이미지를 data URL로 읽는다.
 * IndexedDB에 문자열로 그대로 저장하기 때문에, 상품 사진은 미리 줄여서 담는다.
 */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('이미지를 읽지 못했습니다.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('이미지 읽기 실패'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'))
    image.src = src
  })
}

/**
 * 긴 변을 maxSize에 맞춰 줄이고 JPEG로 다시 인코딩한다.
 * 원본이 더 작으면 그대로 둔다.
 */
export async function shrinkImageDataUrl(
  dataUrl: string,
  maxSize = 1200,
  quality = 0.82,
  { maxDataLength = Infinity, format = 'image/jpeg' }: {
    maxDataLength?: number
    format?: 'image/jpeg' | 'image/webp'
  } = {},
): Promise<string> {
  const image = await loadImage(dataUrl)
  const longest = Math.max(image.width, image.height)
  if (longest <= maxSize && dataUrl.length <= maxDataLength) return dataUrl

  const scale = Math.min(1, maxSize / longest)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))

  const context = canvas.getContext('2d')
  if (!context) return dataUrl

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const encoded = canvas.toDataURL(format, quality)
  if (format === 'image/webp' && encoded.startsWith('data:image/png;') && encoded.length > maxDataLength) {
    return canvas.toDataURL('image/jpeg', quality)
  }
  return encoded
}

/** 파일 하나를 화면에 쓸 수 있는 작은 data URL로 바꾼다. */
export async function readImageFile(file: File): Promise<string> {
  const raw = await readFileAsDataUrl(file)
  if (file.type === 'image/svg+xml') return raw
  return shrinkImageDataUrl(raw)
}
