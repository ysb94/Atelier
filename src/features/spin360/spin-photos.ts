import { spinPixelStats, timeSpinWork, type SpinFrame } from './spin-core'
import { encodeSpinImage, finishSpinFrames, type SpinProgress } from './spin-processing'

/** 제공된 각도만 정리한다. 중간 각도를 합성하거나 복제한 이미지를 추가하지 않는다. */
export async function prepareSpinPhotos(files: File[], edge: number, brightness: number, contrast: number, signal: AbortSignal, progress: (value: SpinProgress) => void) {
  if (files.length < 4 || files.length > 70) throw new Error('회전 순서대로 4~70장의 이미지를 선택해 주세요.')
  if (files.some(file => file.size > 20 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) || files.reduce((sum, file) => sum + file.size, 0) > 150 * 1024 * 1024) throw new Error('PNG·JPG·WebP, 한 장 20MB·전체 150MB 이하로 선택해 주세요.')
  const frames: SpinFrame[] = [], output = document.createElement('canvas'), sample = document.createElement('canvas')
  output.width = output.height = edge; sample.width = sample.height = 128
  const context = output.getContext('2d')!, small = sample.getContext('2d', { willReadFrequently: true })!
  for (let index = 0; index < files.length; index++) {
    signal.throwIfAborted()
    const file = files[index]
    let image: ImageBitmap
    try { image = await createImageBitmap(file) } catch (error) { console.warn('[spin360] 이미지 읽기 실패', { file: file.name, error }); throw new Error(`${file.name} 이미지를 읽을 수 없습니다.`) }
    try {
      if (image.width * image.height > 40_000_000) throw new Error(`${file.name}: 4천만 화소 이하의 이미지를 사용해 주세요.`)
      small.clearRect(0, 0, 128, 128); small.drawImage(image, 0, 0, 128, 128)
      const pixels = small.getImageData(0, 0, 128, 128).data
      const bounds = timeSpinWork('사진 제품 영역 분석', () => {
        let left = 128, top = 128, right = -1, bottom = -1
        for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (pixels[(y * 128 + x) * 4 + 3] > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y) }
        if (right < 0) throw new Error(`${file.name}: 제품이 없는 투명 이미지입니다.`)
        left = Math.max(0, left - 1); top = Math.max(0, top - 1); right = Math.min(127, right + 1); bottom = Math.min(127, bottom + 1)
        return { x: left / 128 * image.width, y: top / 128 * image.height, width: (right - left + 1) / 128 * image.width, height: (bottom - top + 1) / 128 * image.height }
      })
      const scale = edge * .86 / Math.max(bounds.width, bounds.height), width = bounds.width * scale, height = bounds.height * scale
      context.clearRect(0, 0, edge, edge); context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height, (edge - width) / 2, (edge - height) / 2, width, height)
      small.clearRect(0, 0, 128, 128); small.drawImage(output, 0, 0, 128, 128)
      const stats = spinPixelStats(small.getImageData(0, 0, 128, 128).data, 128, 128)
      frames.push({ blob: await encodeSpinImage(output), time: index * 3.5 / files.length, sourceName: file.name, ...stats })
      progress({ stage: '누끼 이미지 크기·위치 정리', done: index + 1, total: files.length })
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    } finally { image.close() }
  }
  return finishSpinFrames(frames, { start: 0, end: 3.5, anchors: [], edge, ai: false, brightness, contrast, crop: 0 }, signal, progress)
}

/** MP4의 재생 시간만 일정하게 유지한다. 원본 각도 수는 ZIP·HTML에서 그대로 보존한다. */
export function spinMovieViews<T>(frames: readonly T[]): T[] {
  if (!frames.length) return []
  return Array.from({ length: 70 }, (_, index) => frames[Math.floor(index * frames.length / 70)])
}
