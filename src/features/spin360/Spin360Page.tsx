import { useEffect, useMemo, useRef, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { useRenderWatch } from '@/lib/diagnostics'
import { SPIN_FRAME_COUNT, spinFileName, spinQuality, validateSpinSettings, type SpinResultFrame, type SpinSettings } from './spin-core'
import { extractSpinFrames, finishSpinFrames, type SpinProgress } from './spin-processing'
import { spinEmbedCode, spinZip, standaloneSpinHtml } from './spin-export'
import { SpinViewer } from './SpinViewer'
import { ProductRegionSelector } from './ProductRegionSelector'
import { spinVideo } from './spin-video-export'
import { SPIN_AI_MODEL } from './spin-model'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { SpinPhotoInput } from './SpinPhotoInput'
import { prepareSpinPhotos, spinMovieViews } from './spin-photos'

const INITIAL: SpinSettings = { start: 0, end: 0, anchors: [], edge: 800, ai: true, brightness: 100, contrast: 100, crop: 0, motionSampling: true, opaque: true }
type Source = { url: string; name: string; duration: number }
type Result = { frames: SpinResultFrame[]; settings: SpinSettings; video: Blob | null; videoUrl: string | null; kind: 'video' | 'photos' }
const numberValue = (value: string) => value.trim() ? Number(value) : NaN

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function Spin360Page() {
  useRenderWatch('Spin360Page')
  const active = useWorkspaceTabActivity()
  const video = useRef<HTMLVideoElement>(null), controller = useRef<AbortController | null>(null), mounted = useRef(true)
  const [source, setSource] = useState<Source | null>(null), [settings, setSettings] = useState<SpinSettings>(INITIAL)
  const [title, setTitle] = useState(''), [result, setResult] = useState<Result | null>(null), [index, setIndex] = useState(0)
  const [progress, setProgress] = useState<SpinProgress | null>(null), [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [viewerUrl, setViewerUrl] = useState(''), [anchorValues, setAnchorValues] = useState(['', '', ''])
  const [mode, setMode] = useState<'video' | 'photos'>('video'), [photoCount, setPhotoCount] = useState(0)
  const sourceUrl = source?.url
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  useEffect(() => () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl) }, [sourceUrl])
  useEffect(() => () => { for (const frame of result?.frames ?? []) { URL.revokeObjectURL(frame.url); URL.revokeObjectURL(frame.thumbnail) } if (result?.videoUrl) URL.revokeObjectURL(result.videoUrl) }, [result])
  useEffect(() => { if (!active) video.current?.pause() }, [active])
  const selected = useMemo(() => ({ ...settings, anchors: anchorValues.flatMap((value, at) => value.trim() ? [{ angle: (at + 1) * 90, time: numberValue(value) }] : []) }), [settings, anchorValues])
  const quality = useMemo(() => result ? spinQuality(result.frames) : null, [result])
  const stale = Boolean(result && (result.kind === 'photos' ? (['edge', 'brightness', 'contrast'] as const).some(key => result.settings[key] !== selected[key]) : JSON.stringify(result.settings) !== JSON.stringify(selected)))
  const embed = useMemo(() => { try { return { code: spinEmbedCode(viewerUrl, title), error: '' } } catch { return { code: '', error: '뷰어를 올려둔 HTTPS 주소를 입력해 주세요.' } } }, [viewerUrl, title])
  const locked = busy || exporting
  function chooseFile(file?: File) {
    if (!file || locked) return
    setError(''); setMessage(''); setResult(null); setIndex(0); setAnchorValues(['', '', '']); setSettings(INITIAL)
    if (file.size > 300 * 1024 * 1024 || !file.type.startsWith('video/')) { setSource(null); setError('300MB 이하의 MP4·WebM 등 동영상을 선택해 주세요.'); return }
    setSource({ url: URL.createObjectURL(file), name: file.name, duration: 0 })
    setTitle(file.name.replace(/\.[^.]+$/, ''))
  }
  function loaded() {
    const node = video.current
    if (!node || !source) return
    if (!Number.isFinite(node.duration) || node.duration < 2.4 || node.duration > 180) { setError('2.4초 이상 3분 이하로 재생 길이를 읽을 수 있는 영상을 선택해 주세요.'); return }
    setSource(previous => previous ? { ...previous, duration: node.duration } : previous)
    setSettings(previous => ({ ...previous, end: Math.floor(node.duration * 1000) / 1000 }))
  }
  function currentAs(field: 'start' | 'end') {
    const time = Number((video.current?.currentTime ?? 0).toFixed(3))
    setSettings(previous => ({ ...previous, [field]: time }))
  }
  async function generate() {
    if (!source?.duration || locked) return
    setError(''); setMessage('')
    if (selected.ai && !selected.region) { setError('손·회전판이 아닌 제품만 남도록 제품 영역을 먼저 지정해 주세요.'); return }
    try { validateSpinSettings(selected, source.duration) } catch (cause) { setError(cause instanceof Error ? cause.message : '구간을 확인해 주세요.'); return }
    const task = new AbortController(); controller.current = task
    const snapshot = structuredClone(selected), started = performance.now()
    setBusy(true); setResult(null); setIndex(0); setProgress({ stage: '영상 분석 준비', done: 0, total: SPIN_FRAME_COUNT })
    let lastProgress = 0
    const report = (value: SpinProgress) => {
      if (!mounted.current || task.signal.aborted) return
      const now = performance.now()
      if (now - lastProgress > 100 || value.done === value.total) { lastProgress = now; setProgress(value) }
    }
    try {
      const frames = await extractSpinFrames(source.url, snapshot, task.signal, report)
      const finished = await finishSpinFrames(frames, snapshot, task.signal, report)
      let movie: Blob | null = null
      try { movie = await spinVideo(finished.frames, snapshot.edge, 20, task.signal, percent => report({ stage: 'MP4 영상 만들기', done: percent, total: 100 })) }
      catch (cause) {
        task.signal.throwIfAborted()
        console.warn('[spin360] MP4 생성 실패, 이미지 결과는 유지', { error: cause })
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'MP4를 만들지 못했습니다. 70장과 HTML은 다운로드할 수 있습니다.')
      }
      task.signal.throwIfAborted()
      if (!mounted.current) return
      const urls: string[] = []
      try {
        const outputs = finished.frames.map((frame, at) => {
          const url = URL.createObjectURL(frame.blob), thumbnail = URL.createObjectURL(finished.thumbnails[at]); urls.push(url, thumbnail)
          return { ...frame, url, thumbnail }
        })
        const videoUrl = movie ? URL.createObjectURL(movie) : null
        if (videoUrl) urls.push(videoUrl)
        setResult({ frames: outputs, settings: snapshot, video: movie, videoUrl, kind: 'video' }); setMessage(`${movie ? 'MP4 영상과 ' : ''}70프레임 생성 완료. 전체 회전에서 제품 모양과 글씨, 흰 배경을 확인해 주세요.`)
      } catch (cause) { urls.forEach(url => URL.revokeObjectURL(url)); throw cause }
      console.info('[spin360] 생성 완료', { elapsedMs: Math.round(performance.now() - started), count: finished.frames.length, ai: snapshot.ai, path: location.pathname, lastInput: '70프레임 생성' })
    } catch (cause) {
      if (task.signal.aborted) { if (mounted.current) setMessage('작업을 취소했습니다. 구간과 옵션을 바꿔 다시 시작할 수 있습니다.') }
      else { console.warn('[spin360] 영상 처리 실패', { error: cause, path: location.pathname, lastInput: '70프레임 생성' }); if (mounted.current) setError(cause instanceof Error ? cause.message : '영상을 처리하지 못했습니다.') }
    } finally { if (controller.current === task) controller.current = null; if (mounted.current) { setBusy(false); setProgress(null) } }
  }
  async function generatePhotos(files: File[]) {
    if (locked) return
    const snapshot: SpinSettings = { start: 0, end: 3.5, anchors: [], edge: settings.edge, ai: false, brightness: settings.brightness, contrast: settings.contrast, crop: 0 }
    try { validateSpinSettings(snapshot, 3.5) } catch (cause) { setError(cause instanceof Error ? cause.message : '보정값을 확인해 주세요.'); return }
    const task = new AbortController(); controller.current = task
    setBusy(true); setError(''); setMessage(''); setResult(null); setIndex(0)
    let lastProgress = 0
    const report = (value: SpinProgress) => { const now = performance.now(); if (mounted.current && !task.signal.aborted && (now - lastProgress >= 100 || value.done === value.total)) { lastProgress = now; setProgress(value) } }
    try {
      const finished = await prepareSpinPhotos(files, snapshot.edge, snapshot.brightness, snapshot.contrast, task.signal, report)
      let movie: Blob | null = null
      try { movie = await spinVideo(spinMovieViews(finished.frames), snapshot.edge, 20, task.signal, percent => report({ stage: 'MP4 영상 만들기', done: percent, total: 100 })) }
      catch (cause) { task.signal.throwIfAborted(); console.warn('[spin360] 사진 MP4 생성 실패', { error: cause }); if (mounted.current) setError(cause instanceof Error ? cause.message : 'MP4를 만들지 못했습니다. 이미지와 HTML은 받을 수 있습니다.') }
      task.signal.throwIfAborted()
      if (!mounted.current) return
      const urls: string[] = []
      try {
        const outputs = finished.frames.map((frame, at) => { const url = URL.createObjectURL(frame.blob), thumbnail = URL.createObjectURL(finished.thumbnails[at]); urls.push(url, thumbnail); return { ...frame, url, thumbnail } })
        const videoUrl = movie ? URL.createObjectURL(movie) : null
        if (videoUrl) urls.push(videoUrl)
        setResult({ frames: outputs, settings: snapshot, video: movie, videoUrl, kind: 'photos' }); setMessage(`${files.length}개 원본 각도로 생성했습니다. 중간 각도를 AI로 생성하지 않았으며 AI 호출 요금은 없습니다.`)
      } catch (cause) { urls.forEach(url => URL.revokeObjectURL(url)); throw cause }
    } catch (cause) {
      if (task.signal.aborted) { if (mounted.current) setMessage('작업을 취소했습니다.') }
      else { console.warn('[spin360] 사진 처리 실패', { error: cause }); if (mounted.current) setError(cause instanceof Error ? cause.message : '이미지를 처리하지 못했습니다.') }
    } finally { if (controller.current === task) controller.current = null; if (mounted.current) { setBusy(false); setProgress(null) } }
  }
  async function exportFiles(kind: 'zip' | 'html' | 'mp4') {
    if (!result || locked || stale) return
    setExporting(true); setError(''); setMessage('파일을 준비하고 있습니다…')
    let lastProgress = 0
    try {
      const blob = kind === 'mp4' ? result.video : kind === 'zip' ? await spinZip(title, result.frames, result.settings, percent => {
        const now = performance.now()
        if (mounted.current && (now - lastProgress >= 200 || percent === 100)) { lastProgress = now; setMessage(`ZIP 준비 ${percent}%`) }
      }, result.video ?? undefined) : await standaloneSpinHtml(title, result.frames)
      if (blob && mounted.current) { download(blob, spinFileName(title) + '.' + kind); setMessage('다운로드했습니다. 쇼핑몰 등록 전에 회전 상태를 확인해 주세요.') }
    } catch (cause) { console.warn('[spin360] 내보내기 실패', cause); if (mounted.current) setError('파일을 만들지 못했습니다. 다시 시도해 주세요.') }
    finally { if (mounted.current) setExporting(false) }
  }
  return <div className="space-y-5">
    <PageHeader title="360 상세이미지 생성" description="촬영 영상 또는 여러 각도의 누끼 사진으로 흰 배경 회전 영상과 드래그 HTML을 만듭니다." actions={<Badge>테스트</Badge>} />
    <FilterTabs ariaLabel="360 입력 방식" tabs={[{ value: 'video', label: '촬영 영상' }, { value: 'photos', label: '누끼 이미지 · AI 요금 없음' }]} value={mode} onChange={value => { if (!locked && value !== mode) { setMode(value); setPhotoCount(0); setResult(null); setError(''); setMessage('') } }} />
    <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{mode === 'photos' ? '누끼 이미지는 AI 모델 다운로드나 API 호출 없이 이 브라우저에서 크기·위치·흰 배경을 정리합니다. 중간 각도는 생성하지 않습니다.' : '영상과 이미지는 이 브라우저에서 처리합니다. 첫 사용 시 AI 모델을 다운로드합니다. CPU로 70장을 순서대로 처리하므로 PC에 따라 수십 분이 걸릴 수 있습니다.'} 새로고침하거나 탭을 닫으면 작업은 사라집니다.</p>
    <StatGrid><StatTile label={mode === 'photos' ? '원본 이미지' : '원본 영상'} value={mode === 'photos' ? `${photoCount}장` : source?.duration ? `${source.duration.toFixed(1)}초` : '선택 전'} /><StatTile label="출력" value={`${mode === 'photos' ? photoCount : 70}프레임`} hint={`${selected.edge} × ${selected.edge}`} /><StatTile label="배경 정리" value={mode === 'photos' ? 'AI 호출 없음' : selected.ai ? 'AI 사용' : '원본 유지'} /><StatTile label="검수 필요" value={quality ? `${new Set([...quality.blurry, ...quality.similar]).size}장` : '—'} hint="선명도·유사 프레임 참고" /></StatGrid>
    {error && <p role="alert" className="rounded-lg border border-danger p-3 text-sm text-danger">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,1fr)]">
      <Card className="min-w-0 space-y-4 p-4 sm:p-5">
        {mode === 'photos' ? <SpinPhotoInput locked={locked} edge={settings.edge} brightness={settings.brightness} contrast={settings.contrast} onSettings={values => setSettings(previous => ({ ...previous, ...values }))} onChange={count => { setPhotoCount(count); setResult(null); setIndex(0) }} onGenerate={files => { void generatePhotos(files) }} /> : <>
        <h2 className="font-semibold">1. 영상과 한 바퀴 구간</h2>
        <Input type="file" aria-label="360 촬영 영상" accept="video/*" disabled={locked} onChange={event => { chooseFile(event.target.files?.[0]); event.target.value = '' }} />
        <p className="text-xs text-muted-foreground">300MB·3분 이하. 상품 전체가 보이고 형태와 조명이 일정한 영상이 좋습니다.</p>
        {source && <><p className="break-all text-xs text-muted-foreground">{source.name}</p><video key={source.url} ref={video} src={source.url} controls playsInline preload="auto" className="max-h-80 w-full rounded-lg bg-muted" onLoadedMetadata={loaded} onError={() => setError('이 영상은 브라우저에서 재생할 수 없습니다. MP4(H.264) 또는 WebM으로 변환해 주세요.')} /></>}
        {source && <ProductRegionSelector key={source.url} video={video} sourceUrl={source.url} region={settings.region} disabled={locked} onChange={region => setSettings(previous => ({ ...previous, region }))} />}
        <fieldset disabled={locked || !source?.duration} className="space-y-4 disabled:opacity-60">
          <div className="grid grid-cols-2 gap-3">{(['start', 'end'] as const).map(field => <label key={field} className="space-y-1 text-xs"><span>{field === 'start' ? '시작 시각(초)' : '끝 시각(초)'}</span><Input type="number" step="0.001" min={0} max={source?.duration ?? 0} aria-label={field === 'start' ? '시작 시각' : '끝 시각'} value={Number.isFinite(settings[field]) ? settings[field] : ''} onChange={event => setSettings(previous => ({ ...previous, [field]: numberValue(event.target.value) }))} /><Button type="button" size="sm" variant="outline" onClick={() => currentAs(field)}>현재 시각으로</Button></label>)}</div>
          <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">회전 속도가 일정하지 않나요? 기준 각도 지정</summary><p className="my-2 text-xs text-muted-foreground">시작 장면을 0°로 보고, 영상에서 90°·180°·270°가 되는 시각을 지정하세요. 입력하지 않은 구간은 일정한 속도를 가정합니다. 정확한 3D 각도 자동 측정은 하지 않습니다.</p><div className="grid grid-cols-3 gap-2">{anchorValues.map((value, at) => <label key={at} className="text-xs">{(at + 1) * 90}°(초)<Input type="number" step="0.001" aria-label={`${(at + 1) * 90}도 기준 시각`} value={value} onChange={event => setAnchorValues(previous => previous.map((item, i) => i === at ? event.target.value : item))} /><Button size="sm" variant="ghost" onClick={() => setAnchorValues(previous => previous.map((item, i) => i === at ? (video.current?.currentTime ?? 0).toFixed(3) : item))}>현재 시각</Button></label>)}</div></details>
          <h2 className="font-semibold">2. 이미지 정리</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={settings.motionSampling ?? false} onChange={event => setSettings(previous => ({ ...previous, motionSampling: event.target.checked }))} />회전 중 멈춤 구간 줄이기</label>
          <p className="text-xs text-muted-foreground">제품 영역의 장면 변화량을 비교해 정지 구간을 덜 선택합니다. 정확한 3D 각도 측정은 아니며, 각도별 속도는 기준 시각으로 보정할 수 있습니다.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={settings.ai} onChange={event => setSettings(previous => ({ ...previous, ai: event.target.checked }))} />AI 배경 제거·상품 중심 정렬</label>
          <p className="text-xs text-muted-foreground">AI는 원본에서 상품 영역을 찾고 흰 배경에 정렬합니다. 얇은 끈·로고가 지워지지 않았는지 검수하세요.</p>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" disabled={!settings.ai} checked={settings.opaque ?? true} onChange={event => setSettings(previous => ({ ...previous, opaque: event.target.checked }))} />불투명 제품 내부 보호</label>
          <p className="text-xs text-muted-foreground">인쇄면·뚜껑이 비치거나 내부에 구멍이 생기는 것을 줄입니다. 투명 소재나 손잡이처럼 실제 구멍이 있는 제품은 해제하세요.</p>
          <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs">출력 크기<Select className="w-full" aria-label="출력 크기" value={settings.edge} onChange={event => setSettings(previous => ({ ...previous, edge: Number(event.target.value) }))}>{[640, 800, 960].map(edge => <option key={edge} value={edge}>{edge} × {edge}</option>)}</Select></label><label className="space-y-1 text-xs">가장자리 자르기(각 면 %)<Input type="number" aria-label="가장자리 자르기" min={0} max={30} value={settings.crop} onChange={event => setSettings(previous => ({ ...previous, crop: numberValue(event.target.value) }))} /></label>{(['brightness', 'contrast'] as const).map(field => <label key={field} className="space-y-1 text-xs">{field === 'brightness' ? '밝기' : '대비'} (%)<Input aria-label={field === 'brightness' ? '밝기' : '대비'} type="number" min={60} max={140} value={Number.isFinite(settings[field]) ? settings[field] : ''} onChange={event => setSettings(previous => ({ ...previous, [field]: numberValue(event.target.value) }))} /></label>)}</div>
        </fieldset>
        <Button disabled={locked || !source?.duration} onClick={() => void generate()}>영상·70프레임 생성</Button></>}
        {busy && <Button variant="outline" onClick={() => controller.current?.abort()}>작업 취소</Button>}
        {progress && <div role="status" className="space-y-2 text-sm"><p>{progress.stage} · {progress.done}/{progress.total}</p><progress aria-label="360 이미지 생성 진행률" value={progress.done} max={progress.total} className="h-2 w-full accent-primary" /></div>}
      </Card>
      <Card className="min-w-0 space-y-4 p-4 sm:p-5">
        <h2 className="font-semibold">3. 회전 확인과 내보내기</h2>
        {result?.videoUrl && <div className="space-y-2"><video aria-label="완성된 360도 영상" src={result.videoUrl} controls loop muted playsInline className="max-h-96 w-full rounded-lg border border-border" /><p className="text-xs text-muted-foreground">완성 영상 · MP4(H.264) · 3.5초 · 20fps · 무음. {result.frames.length}개의 원본 각도를 순서대로 표시합니다.{result.kind === 'photos' && result.frames.length < 70 ? ' 각도 사이를 새로 생성하지 않으므로 사진이 적으면 장면이 단계적으로 전환됩니다.' : ''}</p></div>}
        <SpinViewer frames={result?.frames ?? []} index={index} onIndex={setIndex} active={active} />
        {stale && <p role="status" className="text-sm text-warning">설정이 바뀌었습니다. 다시 생성하면 다운로드할 수 있습니다.</p>}
        {quality && <div className="space-y-1 text-xs text-muted-foreground"><p>선명도 낮음: {quality.blurry.length ? quality.blurry.join(', ') + '번' : '감지 없음'} · 비슷한 장면: {quality.similar.length ? quality.similar.join(', ') + '번' : '감지 없음'}</p><p>자동 검사는 참고용입니다. 실제 상품 모양, 한 바퀴 연결과 회전 속도는 직접 확인해 주세요.</p></div>}
        <label className="block space-y-1 text-xs">제품 이름<Input aria-label="제품 이름" maxLength={100} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2"><Button disabled={!result?.video || locked || stale} onClick={() => void exportFiles('mp4')}>360 영상 MP4</Button><Button disabled={!result || locked || stale} onClick={() => void exportFiles('zip')}>{mode === 'photos' ? result?.frames.length ?? photoCount : 70}장 + 뷰어 ZIP</Button><Button variant="outline" disabled={!result || locked || stale} onClick={() => void exportFiles('html')}>단일 HTML 다운로드</Button></div>
        <p className="text-xs text-muted-foreground">ZIP에는 이미지·viewer.html·검수 기록과 생성된 MP4가 들어갑니다. 단일 HTML은 이미지를 포함해 바로 열어볼 수 있습니다. 쇼핑몰 iframe 허용 여부는 등록 후 확인하세요.</p>
        <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm">상세페이지 삽입 코드</summary><label className="my-2 block space-y-1 text-xs">호스팅한 뷰어 주소<Input type="url" aria-label="호스팅한 뷰어 주소" placeholder="https://이미지호스팅/상품/viewer.html" value={viewerUrl} onChange={event => setViewerUrl(event.target.value)} /></label><Textarea aria-label="상세페이지 삽입 코드" rows={4} value={embed.code} readOnly />{embed.error && <p className="my-2 text-xs text-danger">{embed.error}</p>}<Button className="mt-2" size="sm" variant="outline" disabled={!embed.code} onClick={() => { void navigator.clipboard.writeText(embed.code).then(() => setMessage('삽입 코드를 복사했습니다.')).catch(cause => { console.warn('[spin360] 삽입 코드 복사 실패', cause); setError('자동 복사가 안 됩니다. 삽입 코드를 선택해서 직접 복사해 주세요.') }) }}>삽입 코드 복사</Button><p className="mt-2 text-xs text-muted-foreground">다운로드한 파일을 별도 호스팅에 올린 실제 주소를 입력하세요. 이 테스트 탭은 파일을 자동 업로드하지 않습니다.</p></details>
      </Card>
    </div>
    {result && <Card className="space-y-3 p-4"><h2 className="font-semibold">{result.frames.length}프레임 검수</h2><div className="grid grid-cols-5 gap-2 sm:grid-cols-7 lg:grid-cols-10">{result.frames.map((frame, at) => <button key={at} aria-label={`${at + 1}번 프레임 보기`} aria-pressed={at === index} className={`overflow-hidden rounded-md border ${at === index ? 'border-primary ring-1 ring-primary' : 'border-border'}`} onClick={() => setIndex(at)}><img src={frame.thumbnail} loading="lazy" alt="" className="aspect-square w-full object-contain" /><span className="block text-xs tabular-nums">{String(at + 1).padStart(2, '0')} · {frame.sourceName ? '사진' : frame.time.toFixed(2) + '초'}</span></button>)}</div></Card>}
    <p className="text-xs text-muted-foreground">영상 배경 정리 AI: <a className="underline" href={`https://huggingface.co/${SPIN_AI_MODEL.target.id}`} target="_blank" rel="noreferrer">{SPIN_AI_MODEL.target.name} · {SPIN_AI_MODEL.target.precision}</a> + <a className="underline" href={`https://huggingface.co/${SPIN_AI_MODEL.id}`} target="_blank" rel="noreferrer">{SPIN_AI_MODEL.name} · FP32</a> · {SPIN_AI_MODEL.device} · {SPIN_AI_MODEL.runtime}. 원본 픽셀에서 제품을 분리하며 숨은 면을 새로 생성하지 않습니다.</p>
  </div>
}
