import { useEffect, useRef, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SpinRegion } from './spin-core'

export function ProductRegionSelector({ video, sourceUrl, region, disabled, onChange }: {
  video: RefObject<HTMLVideoElement | null>; sourceUrl: string; region?: SpinRegion; disabled: boolean; onChange: (region: SpinRegion | undefined) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null), pointer = useRef<{ x: number; y: number; draft?: SpinRegion } | null>(null)
  const [draft, setDraft] = useState<SpinRegion>()
  const [ready, setReady] = useState(false)
  const visibleRegion = draft ?? region
  const stop = (commit: boolean) => {
    if (commit && pointer.current?.draft) onChange(pointer.current.draft)
    pointer.current = null; setDraft(undefined)
  }
  useEffect(() => {
    const node = video.current
    if (!node) return
    let disposed = false, revision = 0, disposeInput: (() => void) | undefined
    let draw = () => {}
    setReady(false)
    const start = async () => {
      const { Input, ALL_FORMATS, BlobSource, CanvasSink } = await import('mediabunny')
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(await (await fetch(sourceUrl)).blob()) })
      disposeInput = () => input.dispose()
      if (disposed) { input.dispose(); return }
      const track = await input.getPrimaryVideoTrack()
      if (!track || !await track.canDecode()) throw new Error('제품 영역 미리보기에서 영상을 읽지 못했습니다.')
      const sink = new CanvasSink(track)
      let tail = Promise.resolve()
      draw = () => {
        const current = ++revision, time = node.currentTime
        tail = tail.then(async () => {
          if (disposed || current !== revision) return
          const frame = await sink.getCanvas(time)
          if (disposed || current !== revision || !frame || !canvas.current) return
          const target = canvas.current; target.width = frame.canvas.width; target.height = frame.canvas.height
          target.getContext('2d')!.drawImage(frame.canvas, 0, 0); setReady(true)
        }).catch(error => { if (!disposed) console.warn('[spin360] 제품 영역 사진 읽기 실패', { error }) })
      }
      draw()
    }
    const receive = () => draw()
    node.addEventListener('loadeddata', receive); node.addEventListener('seeked', receive)
    void start().catch(error => { if (!disposed) console.warn('[spin360] 제품 영역 미리보기 준비 실패', { error }) })
    return () => { disposed = true; node.removeEventListener('loadeddata', receive); node.removeEventListener('seeked', receive); disposeInput?.() }
  }, [video, sourceUrl])
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) }
  }
  return <section className="space-y-2 rounded-lg border border-border p-3" aria-label="제품 영역 선택">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">제품만 감싸는 영역을 지정하세요</h3><Button size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(undefined)}>영역 초기화</Button></div>
    <p className="text-xs text-muted-foreground">아래 사진에서 드래그하거나 숫자로 지정하세요. 손과 회전판은 빼고, 모든 각도에서 제품 전체가 안에 들어오게 잡습니다. 원본 영상에서 다른 시각으로 이동하면 사진도 바뀝니다.</p>
    <div className="relative mx-auto w-fit max-w-full select-none" style={{ touchAction: 'none', cursor: disabled ? 'default' : 'crosshair' }} aria-label="제품 영역 드래그"
      onPointerDown={event => { if (disabled || !ready) return; pointer.current = point(event); event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (!pointer.current || disabled) return; const end = point(event), start = pointer.current; const next = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }; start.draft = next; setDraft(next) }}
      onPointerUp={() => stop(true)} onPointerCancel={() => stop(false)} onLostPointerCapture={() => stop(false)}>
      <canvas ref={canvas} className="block max-h-80 max-w-full rounded-md" style={{ width: 'auto', height: 'auto' }} />
      {visibleRegion && <span className="pointer-events-none absolute border-2 border-primary bg-primary/10" style={{ left: `${visibleRegion.x * 100}%`, top: `${visibleRegion.y * 100}%`, width: `${visibleRegion.width * 100}%`, height: `${visibleRegion.height * 100}%` }} />}
    </div>
    <div className="grid grid-cols-4 gap-2">{(['x', 'y', 'width', 'height'] as const).map((field, index) => <label key={field} className="space-y-1 text-xs">{['왼쪽', '위쪽', '너비', '높이'][index]} (%)<Input aria-label={`제품 영역 ${field}`} type="number" min={0} max={100} step={0.1} disabled={disabled} value={region ? Number((region[field] * 100).toFixed(2)) : ''} onChange={event => onChange({ ...(region ?? { x: 0, y: 0, width: 1, height: 1 }), [field]: Number(event.target.value) / 100 })} /></label>)}</div>
  </section>
}
