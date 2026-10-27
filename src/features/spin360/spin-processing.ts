import { motionRetimedTimes, spinFrameTimes, spinPixelStats, spinSampleWindow, timeSpinWork, validateSpinSettings, type SpinFrame, type SpinSettings } from './spin-core'
import { solidifyProductAlpha } from './spin-mask'

export type SpinProgress = { stage: string; done: number; total: number }
type Progress = (progress: SpinProgress) => void
type Bounds = { x: number; y: number; width: number; height: number }
const aborted = (signal: AbortSignal) => { signal.throwIfAborted() }
const yieldUI = () => new Promise<void>(resolve => window.setTimeout(resolve, 0))
const canvas = (width: number, height = width) => { const node = document.createElement('canvas'); node.width = width; node.height = height; return node }
export const encodeSpinImage = (node: HTMLCanvasElement, type = 'image/webp', quality = 0.9) => new Promise<Blob>((resolve, reject) => node.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지를 저장하지 못했습니다.')), type, quality))

function videoEvent(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal, action: () => void) {
  return new Promise<void>((resolve, reject) => {
    const clear = () => { window.clearTimeout(timer); video.removeEventListener(event, ready); video.removeEventListener('error', failed); signal.removeEventListener('abort', cancel) }
    const ready = () => { clear(); resolve() }
    const failed = () => { clear(); reject(new Error('영상 프레임을 읽지 못했습니다. 브라우저에서 재생 가능한 MP4 또는 WebM을 선택해 주세요.')) }
    const cancel = () => { clear(); reject(new DOMException('작업을 취소했습니다.', 'AbortError')) }
    const timer = window.setTimeout(failed, 20_000)
    video.addEventListener(event, ready, { once: true }); video.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel(); return }
    try { action() } catch (error) { clear(); reject(error) }
  })
}

export async function seekSpinVideo(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  aborted(signal)
  if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return
  await videoEvent(video, 'seeked', signal, () => { video.currentTime = time })
}

export async function extractSpinFrames(url: string, settings: SpinSettings, signal: AbortSignal, progress: Progress): Promise<SpinFrame[]> {
  const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import('mediabunny')
  const response = await fetch(url, { signal })
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await response.blob()) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !await track.canDecode()) throw new Error('이 영상의 코덱을 읽을 수 없습니다. MP4(H.264)로 변환해 주세요.')
    validateSpinSettings(settings, await input.computeDuration())
    const width = await track.getDisplayWidth(), height = await track.getDisplayHeight()
    const sink = new CanvasSink(track)
    let times = spinFrameTimes(settings)
    const result: SpinFrame[] = []
    const output = canvas(settings.edge), context = output.getContext('2d')!
    const sample = canvas(128), sampleContext = sample.getContext('2d', { willReadFrequently: true })!
    const ratio = 1 - settings.crop / 100 * 2
    const region = settings.region ?? { x: 0, y: 0, width: 1, height: 1 }
    const sw = width * region.width * ratio, sh = height * region.height * ratio
    const sx = width * (region.x + region.width * settings.crop / 100), sy = height * (region.y + region.height * settings.crop / 100)
    const scale = Math.min(output.width / sw, output.height / sh), dw = sw * scale, dh = sh * scale
    if (settings.motionSampling) {
      const samples: { time: number; signature: number[] }[] = []
      for (let at = 0; at <= 210; at++) {
        aborted(signal)
        const time = settings.start + (settings.end - settings.start) * Math.min(at / 210, 0.9999)
        const decoded = await sink.getCanvas(time)
        if (!decoded) throw new Error('회전 변화량을 읽지 못했습니다. 구간을 다시 선택해 주세요.')
        // 손·회전판 영향이 작은 제품 영역 중앙을 비교한다.
        sampleContext.drawImage(decoded.canvas, sx + sw * 0.15, sy + sh * 0.1, sw * 0.7, sh * 0.7, 0, 0, 128, 128)
        const stats = timeSpinWork('회전 변화량 분석', () => spinPixelStats(sampleContext.getImageData(0, 0, 128, 128).data, 128, 128))
        samples.push({ time, signature: stats.signature }); progress({ stage: '정지 구간·회전 변화량 분석', done: at, total: 210 })
        if (at % 10 === 0) await yieldUI()
      }
      times = motionRetimedTimes(settings, samples)
    }
    for (let index = 0; index < times.length; index++) {
      aborted(signal)
      let best: { time: number; sharpness: number; signature: number[] } | undefined
      for (const time of spinSampleWindow(times, index, settings.start, settings.end)) {
        const decoded = await sink.getCanvas(time)
        aborted(signal)
        if (!decoded) throw new Error(`${time.toFixed(2)}초의 영상 프레임을 읽지 못했습니다.`)
        sampleContext.drawImage(decoded.canvas, sx, sy, sw, sh, 0, 0, 128, 128)
        const stats = timeSpinWork('선명도 분석', () => spinPixelStats(sampleContext.getImageData(0, 0, 128, 128).data, 128, 128))
        if (!best || stats.sharpness > best.sharpness) best = { time, ...stats }
      }
      const decoded = await sink.getCanvas(best!.time)
      aborted(signal)
      if (!decoded) throw new Error('선택한 프레임을 다시 읽지 못했습니다.')
      context.fillStyle = 'white'; context.fillRect(0, 0, output.width, output.height)
      context.drawImage(decoded.canvas, sx, sy, sw, sh, (output.width - dw) / 2, (output.height - dh) / 2, dw, dh)
      const blob = await encodeSpinImage(output)
      result.push({ blob, ...best!, content: { x: (output.width - dw) / 2 / output.width, y: (output.height - dh) / 2 / output.height, width: dw / output.width, height: dh / output.height } })
      progress({ stage: '선명한 프레임 선택', done: index + 1, total: times.length })
      await yieldUI()
    }
    return result
  } finally { input.dispose() }
}

function getMask(worker: Worker, blob: Blob, signal: AbortSignal, progress: Progress, targetProduct: boolean, content?: SpinFrame['content']): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const clear = () => { clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', failed); signal.removeEventListener('abort', cancel) }
    const cancel = () => { clear(); reject(new DOMException('작업을 취소했습니다.', 'AbortError')) }
    const failed = () => { clear(); reject(new Error('AI 배경 제거를 실행하지 못했습니다. 인터넷 연결과 브라우저 메모리를 확인하거나 AI를 끄고 다시 시도해 주세요.')) }
    const message = (event: MessageEvent<{ type: string; mask?: Blob; message?: string }>) => {
      if (event.data.type === 'progress') { progress({ stage: event.data.message ?? 'AI 준비 중', done: 0, total: 70 }); return }
      clear()
      if (event.data.type === 'mask' && event.data.mask) resolve(event.data.mask)
      else reject(new Error(`AI 배경 제거 실패: ${event.data.message ?? '결과 없음'}`))
    }
    const timer = window.setTimeout(failed, 180_000)
    worker.addEventListener('message', message); worker.addEventListener('error', failed); signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) { cancel(); return }
    worker.postMessage({ blob, targetProduct, content })
  })
}

function alphaBounds(node: HTMLCanvasElement): Bounds {
  const small = canvas(128), context = small.getContext('2d', { willReadFrequently: true })!
  context.drawImage(node, 0, 0, 128, 128)
  const pixels = context.getImageData(0, 0, 128, 128).data
  let left = 128, top = 128, right = -1, bottom = -1, count = 0
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (pixels[(y * 128 + x) * 4 + 3] > 32) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++
  }
  if (count < 128 * 128 * 0.005 || count > 128 * 128 * 0.98) throw new Error('AI가 상품과 배경을 구분하지 못한 프레임이 있습니다. 촬영 배경을 정리하거나 AI를 끄고 다시 시도해 주세요.')
  const scale = node.width / 128
  return { x: left * scale, y: top * scale, width: (right - left + 1) * scale, height: (bottom - top + 1) * scale }
}

export async function finishSpinFrames(frames: SpinFrame[], settings: SpinSettings, signal: AbortSignal, progress: Progress): Promise<{ frames: SpinFrame[]; thumbnails: Blob[] }> {
  const worker = settings.ai ? new Worker(new URL('./spin-ai.worker.ts', import.meta.url), { type: 'module' }) : null
  const prepared: { frame: SpinFrame; bounds?: Bounds }[] = []
  const output = canvas(settings.edge), context = output.getContext('2d')!
  const alphaCanvas = canvas(512), alphaContext = alphaCanvas.getContext('2d', { willReadFrequently: true })!
  try {
    for (let index = 0; index < frames.length; index++) {
      aborted(signal)
      const frame = frames[index]
      if (!worker) { prepared.push({ frame }); continue }
      progress({ stage: 'AI 배경 제거', done: index, total: frames.length })
      const mask = await getMask(worker, frame.blob, signal, value => progress({ stage: value.stage, done: index, total: frames.length }), Boolean(settings.region), frame.content)
      const [image, alpha] = await Promise.all([createImageBitmap(frame.blob), createImageBitmap(mask)])
      try {
        let matte: CanvasImageSource = alpha
        if (settings.opaque !== false) {
          alphaCanvas.width = alpha.width; alphaCanvas.height = alpha.height
          alphaContext.drawImage(alpha, 0, 0)
          const pixels = alphaContext.getImageData(0, 0, alpha.width, alpha.height)
          timeSpinWork('불투명 제품 내부 보호', () => solidifyProductAlpha(pixels.data, alpha.width, alpha.height))
          alphaContext.putImageData(pixels, 0, 0); matte = alphaCanvas
        }
        context.clearRect(0, 0, output.width, output.height); context.drawImage(image, 0, 0)
        context.globalCompositeOperation = 'destination-in'; context.drawImage(matte, 0, 0, output.width, output.height); context.globalCompositeOperation = 'source-over'
        const bounds = timeSpinWork('상품 위치 분석', () => alphaBounds(output))
        prepared.push({ frame: { ...frame, blob: await encodeSpinImage(output) }, bounds })
      } finally { image.close(); alpha.close() }
      await yieldUI()
    }
  } finally { worker?.terminate() }
  // 모든 각도에 같은 배율을 적용한다. 얇은 옆면도 정면과 같은 폭으로 부풀리지 않는다.
  const extent = Math.max(1, ...prepared.map(item => item.bounds ? Math.max(item.bounds.width, item.bounds.height) : settings.edge))
  const fixedScale = settings.ai ? settings.edge * 0.86 / extent : 1
  const result: SpinFrame[] = [], thumbnails: Blob[] = []
  const thumb = canvas(96), thumbContext = thumb.getContext('2d')!
  for (let index = 0; index < prepared.length; index++) {
    aborted(signal)
    const { frame, bounds } = prepared[index], image = await createImageBitmap(frame.blob)
    try {
      context.filter = 'none'; context.fillStyle = 'white'; context.fillRect(0, 0, output.width, output.height)
      context.filter = `brightness(${settings.brightness}%) contrast(${settings.contrast}%)`
      const centerX = bounds ? bounds.x + bounds.width / 2 : settings.edge / 2, centerY = bounds ? bounds.y + bounds.height / 2 : settings.edge / 2
      context.drawImage(image, settings.edge / 2 - centerX * fixedScale, settings.edge / 2 - centerY * fixedScale, settings.edge * fixedScale, settings.edge * fixedScale)
      context.filter = 'none'
      const blob = await encodeSpinImage(output)
      thumbContext.drawImage(output, 0, 0, 96, 96)
      thumbnails.push(await encodeSpinImage(thumb, 'image/jpeg', 0.7))
      result.push({ ...frame, blob })
      progress({ stage: settings.ai ? '위치·크기·톤 정리' : '크기·톤 정리', done: index + 1, total: prepared.length })
      await yieldUI()
    } finally { image.close() }
  }
  return { frames: result, thumbnails }
}
