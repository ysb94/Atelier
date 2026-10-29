import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { useAuth } from '@/lib/supabase/auth'
import { studioImageApi } from '@/lib/supabase/styled-image'
import { PendingStudioImageError } from '@/lib/design/studio-job-polling'
import { fitStudioRequestImages } from '@/lib/design/studio-image-processing'
import { STYLED_IMAGE_MODELS, type StyledImageModelId } from '../../../supabase/functions/_shared/styled-image-core'
import type { StudioImageJob } from '../../../supabase/functions/_shared/styled-image-job'
import { SpinViewer } from './SpinViewer'
import { spinViewerHtml } from './spin-export'
import { spinVideo } from './spin-video-export'
import { spinMovieViews } from './spin-photos'
import type { SpinResultFrame } from './spin-core'

const LABELS = ['앞', '앞/오른쪽', '오른쪽', '뒤/오른쪽', '뒤', '뒤/왼쪽', '왼쪽', '앞/왼쪽']
type Photo = { data: string; name: string; model?: string }
type Slot = { photo?: Photo; job?: StudioImageJob; error?: string }
const read = (file: Blob) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error('사진을 읽지 못했습니다.')); r.readAsDataURL(file) })
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000) }

export function SpinEightPanel({ active }: { active: boolean }) {
  const { profile } = useAuth()
  return <SpinEightWorkspace key={profile?.id ?? 'signed-out'} active={active} />
}

function SpinEightWorkspace({ active }: { active: boolean }) {
  const [originals, setOriginals] = useState<(Photo | undefined)[]>(Array(4).fill(undefined))
  const [slots, setSlots] = useState<Slot[]>(Array.from({ length: 4 }, () => ({})))
  const [model, setModel] = useState<StyledImageModelId>('gpt-image-2')
  const [available, setAvailable] = useState<string[]>([]), [catalogError, setCatalogError] = useState('연결 확인 중…')
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [index, setIndex] = useState(0)
  const [reading, setReading] = useState(0)
  const reads = useRef([0, 0, 0, 0])
  const lock = useRef(false), stop = useRef(false), alive = useRef(true), version = useRef(0)
  useEffect(() => { alive.current = true; void studioImageApi.models().then(c => { if (alive.current) { setAvailable(c.models.filter(m => m.available).map(m => m.modelId)); setCatalogError('') } }).catch(e => { console.warn('[spin360] 모델 조회 실패', e); if (alive.current) setCatalogError('AI 연결을 확인하지 못했습니다. 화면을 다시 열어 주세요.') }); return () => { alive.current = false; stop.current = true; version.current++ } }, [])
  const ready = reading === 0 && originals.every(Boolean)
  const photos = originals.flatMap((photo, i) => [photo, slots[i].photo])
  const complete = ready && slots.every(s => s.photo)
  const frames: SpinResultFrame[] = complete ? photos.map((p, i) => ({ blob: new Blob(), url: p!.data, thumbnail: p!.data, time: i * 3.5 / 8, sharpness: 0, signature: [], sourceName: p!.name })) : []
  async function choose(i: number, file?: File) {
    if (!file || lock.current) return
    const ticket = ++reads.current[i]
    version.current++; setReading(count => count + 1)
    setError('')
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('20MB 이하의 JPG·PNG·WebP를 선택해 주세요.')
      const bitmap = await createImageBitmap(file)
      try { if (bitmap.width * bitmap.height > 40_000_000) throw new Error('4천만 화소 이하 사진을 선택해 주세요.') } finally { bitmap.close() }
      const data = await read(file)
      if (!alive.current || ticket !== reads.current[i]) return
      setOriginals(previous => previous.map((p, at) => at === i ? { data, name: file.name } : p)); setSlots(Array.from({ length: 4 }, () => ({}))); setIndex(0)
    } catch (e) { console.warn('[spin360] 원본 읽기 실패', e); if (alive.current) setError(e instanceof Error ? e.message : '사진 읽기 실패') }
    finally { if (alive.current) setReading(count => count - 1) }
  }
  async function generate(only?: number, resume = false) {
    if (lock.current || !ready || (!resume && !available.includes(model))) return
    lock.current = true; stop.current = false; setBusy(true); setError('')
    const generation = version.current
    try {
      for (const i of only === undefined ? [0, 1, 2, 3] : [only]) {
        if (stop.current || generation !== version.current) break
        if (only === undefined && slots[i].photo) continue
        if (slots[i].job && !resume) throw new Error('접수된 작업은 새로 생성하지 말고 기존 결과 조회를 눌러 주세요.')
        setStatus(`${i + 1}/4 · ${LABELS[i * 2 + 1]} 생성 중`)
        try {
          const request = await fitStudioRequestImages({ modelId: model, ratio: '1:1', settings: { resolution: '2K', quality: 'high' },
            images: originals.map((p, at) => ({ name: `원본 ${at + 1}: ${LABELS[at * 2]} (${at * 90}도)`, role: '동일 상품의 실제 기준 사진', data: p!.data })),
            prompt: `첨부는 동일한 상품의 앞(0도), 오른쪽(90도), 뒤(180도), 왼쪽(270도) 실제 사진이다. 원본 순서와 방향을 따른다. 목표는 ${i * 90 + 45}도, ${LABELS[i * 2 + 1]}에서 본 단일 제품 사진 한 장이다. 두 인접 원본 각도의 정확한 중간 시점으로 제품을 회전한다. 카메라 높이와 조명은 고정한다. 상품 구조, 체크무늬, 로고 글자, 지퍼, 끈, 색상과 소재를 가능한 한 동일하게 유지한다. 흰 배경, 제품 전체, 중앙 정렬과 일정한 여백. 콜라주, 여러 제품, 추가 글자나 각도 표시는 금지. 보이지 않는 구조를 장식하거나 재디자인하지 않는다.` })
          if (stop.current || generation !== version.current) break
          const result = resume && slots[i].job ? await studioImageApi.resume!(slots[i].job!, setStatus) : await studioImageApi.generate(request, message => { if (alive.current) setStatus(`${i + 1}/4 · ${message}`) })
          if (!alive.current || generation !== version.current) return
          setSlots(previous => previous.map((s, at) => at === i ? { photo: { data: result.data, name: `ai-${i * 90 + 45}.png`, model: result.modelId } } : s))
        } catch (e) {
          console.warn('[spin360] 중간 각도 생성 실패', { angle: i * 90 + 45, error: e })
          if (alive.current && generation === version.current) { setSlots(previous => previous.map((s, at) => at === i ? { ...s, job: e instanceof PendingStudioImageError ? e.job : undefined, error: e instanceof Error ? e.message : '생성 실패' } : s)); setError('작업을 멈췄습니다. 완료된 사진은 유지됩니다. 아래 각도의 상태를 확인해 주세요.') }
          break
        }
      }
    } catch (e) { console.warn('[spin360] 요청 준비 실패', e); if (alive.current) setError(e instanceof Error ? e.message : '요청 실패') }
    finally { lock.current = false; if (alive.current) { setBusy(false); setStatus(stop.current ? '중지했습니다. 접수된 작업은 처리·과금될 수 있습니다.' : '') } }
  }
  async function exportResult(kind: 'html' | 'zip' | 'mp4') {
    if (!complete || lock.current) return
    lock.current = true; setBusy(true); setError('')
    try {
      const metadata = photos.map((p, i) => ({ angle: i * 45, direction: LABELS[i], source: i % 2 ? 'AI' : '원본', model: p?.model ?? null, name: p!.name }))
      if (kind === 'html') download(new Blob([spinViewerHtml('8방향 제품 보기', photos.map(p => p!.data)) + `<script type="application/json" id="frame-metadata">${JSON.stringify(metadata).replaceAll('<', '\\u003c')}</script>`], { type: 'text/html' }), 'spin-eight.html')
      else if (kind === 'zip') {
        const { default: JSZip } = await import('jszip'), zip = new JSZip()
        const names: string[] = []
        for (let i = 0; i < photos.length; i++) { const blob = await (await fetch(photos[i]!.data)).blob(), name = `frames/${i * 45}.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`; names.push(name); zip.file(name, blob) }
        zip.file('viewer.html', spinViewerHtml('8방향 제품 보기', names)); zip.file('manifest.json', JSON.stringify(metadata, null, 2)); zip.file('README.txt', '원본 4장과 AI 생성 4장. 각도는 생성 목표이며 실제 상품과 일치하는지 검수하세요. 원본 파일은 재인코딩하지 않았습니다.')
        download(await zip.generateAsync({ type: 'blob' }), 'spin-eight.zip')
      } else {
        const movieFrames = []
        for (const photo of photos) { const bitmap = await createImageBitmap(await (await fetch(photo!.data)).blob()), canvas = document.createElement('canvas'); canvas.width = canvas.height = 960; const c = canvas.getContext('2d')!; c.fillStyle = 'white'; c.fillRect(0, 0, 960, 960); const scale = 960 / Math.max(bitmap.width, bitmap.height); c.drawImage(bitmap, (960 - bitmap.width * scale) / 2, (960 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale); bitmap.close(); const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('영상 프레임 변환 실패')), 'image/png')); movieFrames.push({ blob, time: 0, sharpness: 0, signature: [] }) }
        download(await spinVideo(spinMovieViews(movieFrames), 960, 20, new AbortController().signal, percent => setStatus(`영상 저장 ${percent}%`)), 'spin-eight.mp4')
      }
    } catch (e) { console.warn('[spin360] 8방향 내보내기 실패', e); if (alive.current) setError(e instanceof Error ? e.message : '내보내기 실패') }
    finally { lock.current = false; if (alive.current) { setBusy(false); setStatus('') } }
  }
  return <Card className="min-w-0 space-y-4 p-4">
    <h2 className="font-semibold">AI 8방향 · 로컬 검수</h2>
    <p className="text-sm text-muted-foreground">원본 4장은 유지하고 대각선 4장만 생성합니다. 2K · high. 새로고침 전에 결과를 다운로드하세요. 사진은 기존 이미지 생성 서버와 선택한 AI 제공자에게 전송됩니다.</p>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{originals.map((photo, i) => <label key={i} className="min-w-0 space-y-2 rounded-lg border border-border p-2"><span>{LABELS[i * 2]} · {i * 90}° · 원본</span>{photo && <img src={photo.data} alt={LABELS[i * 2]} className="aspect-square w-full object-contain" />}<Input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} aria-label={`${LABELS[i * 2]} 원본`} onChange={e => { void choose(i, e.target.files?.[0]); e.target.value = '' }} /></label>)}</div>
    <Select aria-label="중간 각도 생성 AI" value={model} disabled={busy} onChange={e => setModel(e.target.value as StyledImageModelId)}>{STYLED_IMAGE_MODELS.map(m => <option key={m.id} value={m.id} disabled={!available.includes(m.id)}>{m.label}{available.includes(m.id) ? '' : ' · 연결 불가'}</option>)}</Select>
    {catalogError && <p role="status">{catalogError}</p>}
    <Button className="h-auto max-w-full whitespace-normal py-2" disabled={busy || !ready || !available.includes(model) || slots.some(s => s.job) || complete} onClick={() => void generate()}>중간 각도 4장 생성 · API 요금 발생</Button>
    {busy && <Button variant="outline" onClick={() => { stop.current = true; setStatus('현재 접수된 작업 이후 중지합니다. 처리·과금될 수 있습니다.') }}>이후 생성 중지</Button>}
    {status && <p role="status">{status}</p>}{error && <p role="alert" className="text-danger">{error}</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{slots.map((slot, i) => <div key={i} className="min-w-0 space-y-2 rounded-lg border border-border p-2"><p>{LABELS[i * 2 + 1]} · {i * 90 + 45}° · AI</p>{slot.photo && <img src={slot.photo.data} alt={LABELS[i * 2 + 1]} className="aspect-square w-full object-contain" />}<small>{slot.photo?.model}</small>{slot.error && <p className="break-words text-sm text-danger">{slot.error}</p>}<Button size="sm" className="h-auto max-w-full whitespace-normal py-2" variant="outline" disabled={busy || !ready || (!slot.job && !available.includes(model))} onClick={() => void generate(i, !!slot.job)}>{slot.job ? '기존 결과 조회' : slot.photo ? '이 각도 다시 생성 · 유료' : '이 각도 생성 · 유료'}</Button></div>)}</div>
    <div className="mx-auto w-full max-w-2xl"><SpinViewer frames={frames} index={index} onIndex={setIndex} active={active} /></div>
    {complete && <p>{LABELS[index]} · {index * 45}° · {index % 2 ? `AI · ${photos[index]?.model}` : '원본'}</p>}
    <div className="flex flex-wrap gap-2">{(['zip', 'html', 'mp4'] as const).map(kind => <Button key={kind} disabled={!complete || busy} onClick={() => void exportResult(kind)}>{kind.toUpperCase()} 다운로드</Button>)}</div>
    <p className="text-xs text-muted-foreground">8개 각도가 단계적으로 전환됩니다. 로고·무늬·끈과 마지막→처음 연결을 검수하세요. 실제 3D 복원·정확한 각도 측정 결과는 아닙니다.</p>
  </Card>
}
