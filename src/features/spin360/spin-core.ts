export const SPIN_FRAME_COUNT = 70
export type SpinAnchor = { angle: number; time: number }
export type SpinRegion = { x: number; y: number; width: number; height: number }
export type SpinSettings = { start: number; end: number; anchors: SpinAnchor[]; edge: number; ai: boolean; brightness: number; contrast: number; crop: number; region?: SpinRegion; motionSampling?: boolean; opaque?: boolean }
export type SpinFrame = { blob: Blob; time: number; sharpness: number; signature: number[]; content?: SpinRegion; sourceName?: string }
export type SpinResultFrame = SpinFrame & { url: string; thumbnail: string }

export function validateSpinSettings(settings: SpinSettings, duration: number): void {
  const { start, end, edge, brightness, contrast, crop } = settings
  if (![start, end, duration].every(Number.isFinite) || start < 0 || end > duration || end - start < 2.4) throw new Error('영상 안에서 2.4초 이상의 한 바퀴 구간을 선택해 주세요.')
  if (![640, 800, 960].includes(edge)) throw new Error('출력 크기를 다시 선택해 주세요.')
  if (!Number.isFinite(brightness) || brightness < 60 || brightness > 140 || !Number.isFinite(contrast) || contrast < 60 || contrast > 140 || !Number.isFinite(crop) || crop < 0 || crop > 30) throw new Error('이미지 보정값을 확인해 주세요.')
  const region = settings.region
  if (region && (!Object.values(region).every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width < 0.02 || region.height < 0.02 || region.x + region.width > 1.00001 || region.y + region.height > 1.00001)) throw new Error('제품 영역은 영상 안에서 가로·세로 2% 이상으로 지정해 주세요.')
  let previous = { angle: 0, time: start }
  for (const anchor of settings.anchors) {
    if (![90, 180, 270].includes(anchor.angle) || anchor.angle <= previous.angle || !Number.isFinite(anchor.time) || anchor.time <= previous.time || anchor.time >= end) throw new Error('90°·180°·270° 기준 시각은 시작과 끝 사이에서 순서대로 입력해 주세요.')
    previous = anchor
  }
}

/** 각도 기준점을 보간한다. 360° 끝 프레임은 0°와 겹치므로 제외한다. */
export function spinFrameTimes(settings: SpinSettings): number[] {
  const anchors = [{ angle: 0, time: settings.start }, ...settings.anchors, { angle: 360, time: settings.end }]
  return Array.from({ length: SPIN_FRAME_COUNT }, (_, index) => {
    const angle = index * 360 / SPIN_FRAME_COUNT
    const nextIndex = anchors.findIndex(point => point.angle > angle)
    const before = anchors[nextIndex - 1], after = anchors[nextIndex]
    return before.time + (after.time - before.time) * (angle - before.angle) / (after.angle - before.angle)
  })
}

/** 장면 변화량으로 정체 구간을 줄인다. 실제 3D 각도를 추정하는 값은 아니다. */
export function motionRetimedTimes(settings: SpinSettings, samples: { time: number; signature: number[] }[]): number[] {
  const anchors = [{ angle: 0, time: settings.start }, ...settings.anchors, { angle: 360, time: settings.end }]
  return spinFrameTimes(settings).map((fallback, index) => {
    const angle = index * 360 / SPIN_FRAME_COUNT, next = anchors.findIndex(anchor => anchor.angle > angle)
    const before = anchors[next - 1], after = anchors[next], fraction = (angle - before.angle) / (after.angle - before.angle)
    if (fraction === 0) return before.time
    const segment = samples.filter(sample => sample.time >= before.time && sample.time <= after.time)
    if (segment.length < 3) return fallback
    let total = 0
    const cumulative = segment.map((sample, at) => {
      if (at) total += Math.max(0, sample.signature.reduce((sum, value, pixel) => sum + Math.abs(value - segment[at - 1].signature[pixel]), 0) / sample.signature.length - 1.25)
      return total
    })
    if (total < 1) return fallback
    const target = fraction * total, at = cumulative.findIndex(value => value >= target)
    if (at <= 0) return segment[0].time
    const span = cumulative[at] - cumulative[at - 1]
    return segment[at - 1].time + (segment[at].time - segment[at - 1].time) * (span ? (target - cumulative[at - 1]) / span : 0)
  })
}

export function spinSampleWindow(times: number[], index: number, start: number, end: number): number[] {
  const target = times[index]
  const left = index === 0 ? start : (times[index - 1] + target) / 2
  const right = index === times.length - 1 ? Math.min(end - Math.min(0.001, (end - target) / 2), target + (target - times[index - 1]) / 2) : (target + times[index + 1]) / 2
  const span = Math.max(0, Math.min(0.06, (right - left) / 4))
  return [...new Set([Math.max(left, target - span), target, Math.min(right, target + span)])].sort((a, b) => a - b)
}

export function spinPixelStats(rgba: Uint8ClampedArray, width: number, height: number) {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114
  let sum = 0, squares = 0, count = 0
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x, value = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i]
    sum += value; squares += value * value; count++
  }
  const signature: number[] = []
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) signature.push(gray[Math.min(height - 1, Math.floor((y + 0.5) * height / 8)) * width + Math.min(width - 1, Math.floor((x + 0.5) * width / 8))])
  return { sharpness: count ? Math.max(0, squares / count - (sum / count) ** 2) : 0, signature }
}

export function spinQuality(frames: readonly SpinFrame[]) {
  const sorted = frames.map(frame => frame.sharpness).sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const blurry = frames.flatMap((frame, index) => frame.sharpness < Math.max(4, median * 0.35) ? [index + 1] : [])
  const similar = frames.flatMap((frame, index) => {
    if (!index) return []
    const before = frames[index - 1].signature
    const difference = frame.signature.reduce((sum, value, at) => sum + Math.abs(value - before[at]), 0) / frame.signature.length
    return difference < 1.5 ? [index + 1] : []
  })
  return { blurry, similar }
}

export function spinWrap(index: number, count: number) { return count > 0 ? ((index % count) + count) % count : 0 }
export function spinFileName(title: string) { return (Array.from(title.trim(), char => char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '-' : char).join('').replace(/[. ]+$/g, '').slice(0, 60) || '360-product') + '-360' }

export function timeSpinWork<T>(name: string, work: () => T): T {
  const started = performance.now()
  try { return work() } finally {
    const elapsedMs = Math.round(performance.now() - started)
    if (elapsedMs >= 200) {
      const context = { name, elapsedMs, path: typeof location === 'undefined' ? 'test' : location.pathname, lastInput: '360 상세이미지 생성' }
      if (elapsedMs >= 1000) console.warn('[spin360] 느린 계산', context)
      else console.info('[spin360] 계산 완료', context)
    }
  }
}
