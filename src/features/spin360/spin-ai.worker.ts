// Transformers.js (Apache-2.0), ONNX Runtime (MIT), BiRefNet_lite 512 (MIT).
// Model: Copyright (c) 2024 ZhengPeng; Copyright (c) 2026 Studio Ludens V.O.F.
// https://huggingface.co/studioludens/birefnet-lite-512/blob/962e67969ec6acec9c19fab76acee4f5e22e990c/LICENSE
const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm'
const MODEL = 'studioludens/birefnet-lite-512'
const REVISION = '962e67969ec6acec9c19fab76acee4f5e22e990c'
type Tensor = { data: Float32Array; dims: number[] }
type Model = (inputs: Record<string, unknown>) => Promise<Record<string, Tensor>>
type Runtime = {
  env: { allowLocalModels: boolean; backends: { onnx: { wasm: { numThreads: number; proxy: boolean } } } }
  AutoModel: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<Model> }
  AutoProcessor: { from_pretrained: (id: string, options: Record<string, unknown>) => Promise<(input: unknown) => Promise<{ pixel_values: unknown }>> }
  RawImage: { fromBlob: (blob: Blob) => Promise<unknown> }
}
let prepared: Promise<{ model: Model; processor: (input: unknown) => Promise<{ pixel_values: unknown }>; runtime: Runtime }> | null = null
async function prepare() {
  const runtime = await import(/* @vite-ignore */ RUNTIME) as Runtime
  runtime.env.allowLocalModels = false
  runtime.env.backends.onnx.wasm.numThreads = 1
  runtime.env.backends.onnx.wasm.proxy = false
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
self.onmessage = async (event: MessageEvent<{ blob: Blob }>) => {
  try {
    prepared ??= prepare()
    const { model, processor, runtime } = await prepared
    postMessage({ type: 'progress', message: 'AI 상품 영역 분석 중…' })
    const image = await runtime.RawImage.fromBlob(event.data.blob)
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
    const mask = await canvas.convertToBlob({ type: 'image/png' })
    postMessage({ type: 'mask', mask })
  } catch (error) {
    console.warn('[spin360] AI 배경 제거 실패', error)
    prepared = null
    postMessage({ type: 'error', message: error instanceof Error ? error.message : 'AI 모델을 실행하지 못했습니다.' })
  }
}
