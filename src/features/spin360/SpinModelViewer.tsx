import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import type { createModelViewer } from './model-viewer-engine'

/** Loads the saved GLB directly. Viewing never contacts Tripo or the local generation service. */
export function SpinModelViewer({ src, title }: { src: string; title: string }) {
  const active = useWorkspaceTabActivity()
  const activeRef = useRef(active)
  const host = useRef<HTMLDivElement>(null)
  const slider = useRef<HTMLInputElement>(null)
  const output = useRef<HTMLOutputElement>(null)
  const viewer = useRef<ReturnType<typeof createModelViewer> | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    setReady(false); setError(''); setPlaying(false)
    void import('./model-viewer-engine').then(({ createModelViewer }) => {
      if (cancelled || !host.current) return
      viewer.current = createModelViewer(host.current, src, {
        ready: () => { if (!cancelled) setReady(true) },
        error: message => { if (!cancelled) { setError(message); setReady(false); setPlaying(false) } },
        angle: degrees => {
          if (slider.current) slider.current.value = degrees.toFixed(1)
          if (output.current) output.current.value = `${Math.round(degrees)}°`
        },
      })
      viewer.current.setActive(activeRef.current)
    }).catch(reason => {
      if (cancelled) return
      console.warn('[spin360] 3D 뷰어 시작 실패', reason)
      setError('이 브라우저에서 3D 화면을 시작하지 못했습니다. 다시 불러오거나 다른 브라우저를 이용해 주세요.')
    })
    return () => { cancelled = true; viewer.current?.dispose(); viewer.current = null }
  }, [src, retry])
  useEffect(() => { activeRef.current = active; viewer.current?.setActive(active) }, [active])
  return <div className="w-full min-w-0 space-y-3" role="group" aria-label={`${title} 3D 보기`}>
    <div className="relative mx-auto w-full max-w-[700px] overflow-hidden rounded-lg border border-border">
      <div ref={host} className="aspect-square w-full" />
      {!ready && <div className="absolute inset-0 flex items-center justify-center bg-card/90 p-5 text-center text-sm">
        {error ? <div role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => setRetry(n => n + 1)}>다시 불러오기</Button></div>
          : <p role="status">3D 모델 불러오는 중…<br />처음에는 파일 크기에 따라 시간이 걸릴 수 있습니다.</p>}
      </div>}
    </div>
    <div className="mx-auto max-w-[700px] space-y-2">
      <div className="flex items-center gap-2"><input ref={slider} className="min-w-0 flex-1 accent-primary" aria-label="3D 회전 각도" type="range" min="0" max="360" step="0.1" defaultValue="0" disabled={!ready} onChange={event => { setPlaying(false); viewer.current?.play(false); viewer.current?.rotate(Number(event.target.value)) }} /><output ref={output} className="w-12 text-right text-xs tabular-nums">0°</output></div>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={!ready} onClick={() => { viewer.current?.play(!playing); setPlaying(!playing) }}>{playing ? '회전 멈춤' : '자동 회전'}</Button><Button size="sm" variant="outline" disabled={!ready} onClick={() => { setPlaying(false); viewer.current?.play(false); viewer.current?.rotate(0) }}>처음 각도</Button></div>
      <p className="text-xs text-muted-foreground">좌우로 밀면 제품 회전 · 위아래로 밀면 페이지 이동 · 보기는 AI 비용이 발생하지 않습니다.</p>
    </div>
  </div>
}
