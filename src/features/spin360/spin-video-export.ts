import type { SpinFrame } from './spin-core'

/** 원본 픽셀로 만든 70장의 각도를 일정한 프레임 간격으로 MP4에 기록한다. */
export async function spinVideo(frames: readonly SpinFrame[], edge: number, fps: number, signal: AbortSignal, progress: (percent: number) => void): Promise<Blob> {
  if (!frames.length || ![14, 20, 30].includes(fps)) throw new Error('영상의 프레임 수와 재생 속도를 확인해 주세요.')
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, Quality, canEncodeVideo } = await import('mediabunny')
  if (!await canEncodeVideo('avc', { width: edge, height: edge, frameRate: fps })) throw new Error('이 브라우저에서는 MP4(H.264) 저장을 지원하지 않습니다. 최신 Chrome에서 다시 시도해 주세요. 이미지와 HTML은 계속 받을 수 있습니다.')
  signal.throwIfAborted()
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = edge
  const context = canvas.getContext('2d')!
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() })
  const source = new CanvasSource(canvas, { codec: 'avc', quality: new Quality({ bitrate: 5_000_000 }), keyFrameInterval: 1 })
  output.addVideoTrack(source, { frameRate: fps })
  let finalized = false
  try {
    await output.start()
    for (let index = 0; index < frames.length; index++) {
      signal.throwIfAborted()
      const bitmap = await createImageBitmap(frames[index].blob)
      try { context.fillStyle = 'white'; context.fillRect(0, 0, edge, edge); context.drawImage(bitmap, 0, 0, edge, edge); await source.add(index / fps, 1 / fps) }
      finally { bitmap.close() }
      progress(Math.round((index + 1) / frames.length * 100))
      await new Promise<void>(resolve => window.setTimeout(resolve, 0))
    }
    source.close(); await output.finalize(); finalized = true
    signal.throwIfAborted()
    return new Blob([output.target.buffer!], { type: 'video/mp4' })
  } finally { if (!finalized) await output.cancel() }
}
