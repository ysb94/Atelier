// Transformers.js (Apache-2.0), ONNX Runtime (MIT), BiRefNet_lite 512 (MIT).
// Model: Copyright (c) 2024 ZhengPeng; Copyright (c) 2026 Studio Ludens V.O.F.
// https://huggingface.co/studioludens/birefnet-lite-512/blob/962e67969ec6acec9c19fab76acee4f5e22e990c/LICENSE
import { SPIN_AI_MODEL } from './spin-model'
import { selectionHull } from './spin-mask'
import type { SpinRegion } from './spin-core'
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
const MODEL = SPIN_AI_MODEL.id
const REVISION = SPIN_AI_MODEL.revision
type Tensor = { data: Float32Array; dims: number[] }
type Model = (inputs: Record<string, unknown>) => Promise<Record<string, Tensor>>
type Runtime = {
  env: { allowLocalModels: boolean; backends: { onnx: { wasm: { numThreads: number; proxy: boolean } } } }
  AutoModel: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<Model> }
  AutoProcessor: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<(input: unknown) => Promise<{ pixel_values: unknown }>> }
  RawImage: { fromBlob: (blob: Blob) => Promise<{ width: number; height: number }> }
  SamModel: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<(inputs: unknown) => Promise<{ pred_masks: unknown; iou_scores: Tensor }>> }
}
type SamProcessor = { (image: unknown, options: Record<string, unknown>): Promise<{ original_sizes: unknown; reshaped_input_sizes: unknown }>; post_process_masks: (masks: unknown, original: unknown, reshaped: unknown) => Promise<Tensor[]> }
let targetPrepared: Promise<{ model: (inputs: unknown) => Promise<{ pred_masks: unknown; iou_scores: Tensor }>; processor: SamProcessor }> | null = null
async function prepareTarget(runtime: Runtime) {
  postMessage({ type: 'progress', message: '제품 선택 AI(SlimSAM) 준비 중…' })
  const model = await runtime.SamModel.from_pretrained(SPIN_AI_MODEL.target.id, { revision: SPIN_AI_MODEL.target.revision, dtype: 'q8', device: 'wasm' })
  const processor = await runtime.AutoProcessor.from_pretrained(SPIN_AI_MODEL.target.id, { revision: SPIN_AI_MODEL.target.revision }) as unknown as SamProcessor
  return { model, processor }
}
let prepared: Promise<{ model: Model; processor: (input: unknown) => Promise<{ pixel_values: unknown }>; runtime: Runtime }> | null = null
async function prepare() {
  const runtime = await import(/* @vite-ignore */ RUNTIME) as Runtime
  runtime.env.allowLocalModels = false
  runtime.env.backends.onnx.wasm.numThreads = 1
  runtime.env.backends.onnx.wasm.proxy = false
  // WebGPU 비교 검수에서 측면 제품의 alpha가 손상되어 검증된 WASM 경로를 고정한다.
  postMessage({ type: 'progress', message: 'CPU(WASM) AI 준비 중…' })
  let lastMessage = '', lastSent = 0
  const progress_callback = (progress: { progress?: number }) => {
    const message = Number.isFinite(progress.progress) ? `AI 모델 준비 ${Math.round(progress.progress!)}%` : 'AI 모델 준비 중… 첫 사용 시 다운로드가 필요합니다.'
    const now = performance.now()
    if (message !== lastMessage && (now - lastSent >= 200 || progress.progress === 100)) {
      lastMessage = message; lastSent = now; postMessage({ type: 'progress', message })
    }
  }
  const model = await runtime.AutoModel.from_pretrained(MODEL, { revision: REVISION, dtype: 'fp32', device: 'wasm', progress_callback })
  const processor = await runtime.AutoProcessor.from_pretrained(MODEL, { revision: REVISION })
  return { model, processor, runtime }
}
async function processInput(data: { blob: Blob; targetProduct?: boolean; content?: SpinRegion }) {
  try {
    prepared ??= prepare()
    const { model, processor, runtime } = await prepared
    postMessage({ type: 'progress', message: 'AI 상품 영역 분석 중…' })
    const image = await runtime.RawImage.fromBlob(data.blob)
    const { pixel_values } = await processor(image)
    const output = await model({ input_image: pixel_values })
    const logits = output.logits ?? Object.values(output).find(value => value?.dims?.length === 4 && value.dims[1] === 1)
    if (!logits || !logits.data?.length) throw new Error(`AI 마스크 결과 형식을 확인할 수 없습니다: ${Object.keys(output).join(', ')}`)
    const height = logits.dims.at(-2)!, width = logits.dims.at(-1)!
    const canvas = new OffscreenCanvas(width, height), context = canvas.getContext('2d')!
    const pixels = context.createImageData(width, height)
    const isLogits = logits.data.some(value => value < -1e-5 || value > 1 + 1e-5)
    for (let i = 0; i < width * height; i++) {
      const alpha = Math.round(255 * (isLogits ? 1 / (1 + Math.exp(-logits.data[i])) : logits.data[i]))
      pixels.data[i * 4] = 255; pixels.data[i * 4 + 1] = 255; pixels.data[i * 4 + 2] = 255; pixels.data[i * 4 + 3] = alpha
    }
    context.putImageData(pixels, 0, 0)
    if (data.targetProduct) {
      targetPrepared ??= prepareTarget(runtime)
      const target = await targetPrepared
      postMessage({ type: 'progress', message: '제품과 손·회전판 구분 중…' })
      const w = image.width, h = image.height
      const foregroundPoint = (targetY: number) => {
        let distance = Infinity, found: number[] | null = null
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels.data[(y * width + x) * 4 + 3] >= 192) {
          const candidate = (x / width - 0.5) ** 2 + (y / height - targetY) ** 2
          if (candidate < distance) { distance = candidate; found = [x * w / width, y * h / height] }
        }
        return found ?? [w * 0.5, h * targetY]
      }
      const content = data.content ?? { x: 0, y: 0, width: 1, height: 1 }
      const center = foregroundPoint(0.65)
      // 흰 뚜껑 같은 하단 부품은 매팅 모델에서 사라져도 독립적으로 보호한다.
      // 배경 제외 지점은 레터박스가 아닌 원본 선택 영역 안에 둔다.
      const local = (x: number, y: number) => [w * (content.x + content.width * x), h * (content.y + content.height * y)]
      const inputs = await target.processor(image, { input_points: [[[foregroundPoint(0.35), center, [center[0], h * (content.y + content.height * 0.94)], local(0.5, 0.995), local(0.08, 0.94), local(0.92, 0.94)]]], input_labels: [[[1, 1, 1, 0, 0, 0]]] })
      const predicted = await target.model(inputs)
      const masks = await target.processor.post_process_masks(predicted.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes)
      const scores = predicted.iou_scores.data
      let selected = 0
      for (let i = 1; i < scores.length; i++) if (scores[i] > scores[selected]) selected = i
      const hull = selectionHull(masks[0].data, w, h, selected * w * h)
      const selection = new OffscreenCanvas(w, h), selectionContext = selection.getContext('2d')!
      const selectionPixels = selectionContext.createImageData(w, h)
      for (let i = 0; i < w * h; i++) {
        selectionPixels.data[i * 4] = 255; selectionPixels.data[i * 4 + 1] = 255; selectionPixels.data[i * 4 + 2] = 255
        selectionPixels.data[i * 4 + 3] = masks[0].data[selected * w * h + i] ? 255 : 0
      }
      selectionContext.putImageData(selectionPixels, 0, 0)
      const smallSelection = new OffscreenCanvas(width, height), smallContext = smallSelection.getContext('2d')!
      smallContext.drawImage(selection, 0, 0, width, height)
      const selectedPixels = smallContext.getImageData(0, 0, width, height).data
      let selectedCount = 0, overlap = 0
      for (let i = 3; i < selectedPixels.length; i += 4) if (selectedPixels[i] >= 192) { selectedCount++; overlap += pixels.data[i] / 255 }
      if (selectedCount > width * height * 0.005 && overlap / selectedCount < 0.55) {
        // 얇은 측면에서 매팅 모델이 제품 전체를 지우면 독립적인 제품 선택 결과를 사용한다.
        console.warn('[spin360] 매팅 신뢰도 부족, 제품 선택 마스크 사용', { coverage: overlap / selectedCount })
        context.clearRect(0, 0, width, height); context.drawImage(smallSelection, 0, 0)
      }
      // 제품 선택이 확실한 내부는 보존한다. 매팅의 부분적인 투명화로 글씨·뚜껑이 사라지지 않게 한다.
      context.drawImage(smallSelection, 0, 0)
      const gate = new OffscreenCanvas(width, height), gateContext = gate.getContext('2d')!
      gateContext.fillStyle = 'white'; gateContext.strokeStyle = 'white'; gateContext.lineWidth = 4; gateContext.lineJoin = 'round'
      gateContext.beginPath()
      hull.forEach((point, index) => { const x = point.x * width / w, y = point.y * height / h; if (index === 0) gateContext.moveTo(x, y); else gateContext.lineTo(x, y) })
      gateContext.closePath(); gateContext.fill(); gateContext.stroke()
      context.globalCompositeOperation = 'destination-in'; context.drawImage(gate, 0, 0); context.globalCompositeOperation = 'source-over'
    }
    const mask = await canvas.convertToBlob({ type: 'image/png' })
    postMessage({ type: 'mask', mask, backend: 'wasm' })
  } catch (error) {
    console.warn('[spin360] AI 배경 제거 실패', error)
    prepared = null
    targetPrepared = null
    postMessage({ type: 'error', message: error instanceof Error ? error.message : 'AI 모델을 실행하지 못했습니다.' })
  }
}
self.onmessage = (event: MessageEvent<{ blob: Blob; targetProduct?: boolean; content?: SpinRegion }>) => { void processInput(event.data) }
