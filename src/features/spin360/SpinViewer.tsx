import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { spinWrap, type SpinResultFrame } from './spin-core'

export function SpinViewer({ frames, index, onIndex, active }: { frames: SpinResultFrame[]; index: number; onIndex: (index: number) => void; active: boolean }) {
  const drag = useRef<{ id: number; x: number; y: number; index: number; locked: boolean } | null>(null)
  const [playing, setPlaying] = useState(false)
  const select = (value: number) => onIndex(spinWrap(value, frames.length))
  useEffect(() => {
    if (!playing || !active || !frames.length) return
    const timer = window.setTimeout(() => onIndex(spinWrap(index + 1, frames.length)), Math.max(50, 3500 / frames.length))
    return () => window.clearTimeout(timer)
  }, [playing, active, frames.length, index, onIndex])
  const frame = frames[index]
  return <div className="space-y-3">
    <div className="relative aspect-square overflow-hidden rounded-lg border border-border bg-background" role="slider" tabIndex={0} aria-label="360도 회전 미리보기" aria-valuemin={1} aria-valuemax={Math.max(1, frames.length)} aria-valuenow={index + 1}
      style={{ touchAction: 'pan-y pinch-zoom', cursor: 'grab' }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); select(event.key === 'Home' ? 0 : event.key === 'End' ? frames.length - 1 : index + (event.key === 'ArrowLeft' ? -1 : 1)) } }}
      onPointerDown={event => { if (event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0)) drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, index, locked: false } }}
      onPointerMove={event => {
        const gesture = drag.current
        if (!gesture || gesture.id !== event.pointerId || !frames.length) return
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y
        if (!gesture.locked && Math.max(Math.abs(dx), Math.abs(dy)) > 7) {
          if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return }
          gesture.locked = true; event.currentTarget.setPointerCapture(event.pointerId)
        }
        if (gesture.locked) { event.preventDefault(); setPlaying(false); select(gesture.index + Math.round(dx / event.currentTarget.clientWidth * frames.length)) }
      }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
      {frame ? <img src={frame.url} alt={`상품 회전 ${index + 1}번째 프레임`} draggable={false} className="pointer-events-none h-full w-full select-none object-contain" /> : <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">촬영 영상이나 여러 각도의 사진으로 생성하면 여기서 좌우로 돌려볼 수 있습니다.</div>}
      <span className="pointer-events-none absolute bottom-3 left-0 right-0 text-center text-xs text-muted-foreground">좌우 드래그 · 방향키로 회전</span>
    </div>
    <div className="flex items-center gap-2"><Button size="sm" variant="outline" aria-label="이전 프레임" disabled={!frame} onClick={() => select(index - 1)}>←</Button><input className="min-w-0 flex-1 accent-primary" aria-label="회전 프레임" type="range" min={0} max={Math.max(0, frames.length - 1)} value={index} disabled={!frame} onChange={event => { setPlaying(false); select(Number(event.target.value)) }} /><Button size="sm" variant="outline" aria-label="다음 프레임" disabled={!frame} onClick={() => select(index + 1)}>→</Button><output className="text-xs tabular-nums">{frame ? String(index + 1).padStart(2, '0') : '00'} / {frames.length}</output></div>
    <Button size="sm" variant="outline" disabled={!frame} onClick={() => setPlaying(value => !value)}>{playing ? '자동 회전 멈춤' : '자동 회전'}</Button>
  </div>
}
