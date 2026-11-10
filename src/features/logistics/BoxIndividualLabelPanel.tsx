import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Printer } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { MAX_INDIVIDUAL_BOX_CODES } from '@/lib/warehouse/individual-box-codes'
import { BOX_LABEL_HISTORY_PAGE_SIZE } from '@/lib/api/warehouse-box-labels'
import { useBoxLabelRegistry } from './useBoxLabelRegistry'
import labelCss from './box-individual-label.css?inline'
import './box-individual-label.css'

const MAX_LABELS = MAX_INDIVIDUAL_BOX_CODES
const RECENT_CODES_KEY = 'atelier:individual-box-labels:recent:v1'
type PreparedLabels = { key: string; images: Map<string, string> }

// Size a single line for both monospace ASCII codes and full-width characters.
function codeTextUnits(code: string) {
  return Math.max(1, Array.from(code).reduce((units, char) => units + (/^[\x20-\x7e]$/.test(char) ? .62 : 1.05), 0))
}

function readRecentCodes() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(RECENT_CODES_KEY) ?? 'null')
    if (Array.isArray(saved) && saved.length <= MAX_LABELS && saved.every(code => typeof code === 'string' && /^ENJ-\d{6}-(?:\d{10}|[A-HJ-NP-Z2-9]{8})$/.test(code))) return saved.join('\n')
  } catch (cause) { console.warn('[warehouse-qr] 최근 박스 번호 불러오기 실패', { cause }) }
  return ''
}

export function BoxIndividualLabelPanel({ brandId }: { brandId: string }) {
  useRenderWatch('BoxIndividualLabelPanel')
  const [text, setText] = useState(readRecentCodes)
  const [generationCount, setGenerationCount] = useState('100')
  const [searchCode, setSearchCode] = useState('')
  const [copies, setCopies] = useState('1')
  const registry = useBoxLabelRegistry(brandId, loaded => {
    setText(loaded.join('\n')); setCopies('1')
    // Retire legacy browser-only data only after the same codes are confirmed on the server.
    if (loaded.join('\n') === readRecentCodes()) {
      try { localStorage.removeItem(RECENT_CODES_KEY) }
      catch (cause) { console.warn('[warehouse-qr] 이전 브라우저 번호 정리 실패', { cause }) }
    }
  })
  const [prepared, setPrepared] = useState<PreparedLabels | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [printing, setPrinting] = useState(false)
  const printFrame = useRef<HTMLIFrameElement | null>(null)
  const mounted = useRef(true)
  const codes = useMemo(() => [...new Set(text.split(/\r?\n/).map(code => code.trim()).filter(Boolean))], [text])
  const count = Number(copies)
  const total = codes.length * count
  const validation = !codes.length ? '박스 번호를 한 줄에 하나씩 입력해 주세요.'
    : codes.some(code => code.length > 32) ? '박스 번호는 한 줄에 32자까지 입력해 주세요.'
    : !/^\d+$/.test(copies) || !Number.isSafeInteger(count) || count < 1 ? '번호별 출력 매수는 1 이상의 정수로 입력해 주세요.'
    : total > MAX_LABELS ? `한 번에 총 ${MAX_LABELS}장까지 출력할 수 있습니다. 번호나 매수를 줄여 주세요.` : ''
  const key = JSON.stringify(codes)
  const registered = registry.savedKey === key
  const ready = registered && !registry.busy && !validation && prepared?.key === key
  const requestedCount = Number(generationCount)
  const invalidCount = !/^\d+$/.test(generationCount) || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_LABELS

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; printFrame.current?.remove() }
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(''); setStatus('')
    if (validation) return
    const started = performance.now()
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default
        const images = new Map<string, string>()
        for (const [index, code] of codes.entries()) {
          const svg = await QRCode.toString(code, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 })
          if (cancelled) return
          images.set(code, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
          if (index % 8 === 7) await new Promise<void>(resolve => setTimeout(resolve, 0))
        }
        if (!cancelled) setPrepared({ key, images })
      } catch (cause) {
        console.warn('[warehouse-qr] 롤 라벨 QR 준비 실패', { path: location.pathname, cause })
        if (!cancelled) { setPrepared(null); setError('QR을 준비하지 못했습니다. 번호를 다시 입력해 주세요.') }
      } finally {
        const elapsed = performance.now() - started
        if (elapsed >= 200) console.info('[warehouse-qr] 롤 라벨 준비', { path: location.pathname, count: codes.length, elapsed })
      }
    })()
    return () => { cancelled = true }
  }, [codes, key, validation])

  async function printLabels(testOnly: boolean) {
    if (!ready || !prepared || printing) return
    setPrinting(true); setError(''); setStatus('')
    try {
      printFrame.current?.remove()
      const frame = document.createElement('iframe')
      frame.title = '60×40mm 롤 라벨 인쇄'
      frame.className = 'box-roll-print-frame'
      frame.setAttribute('aria-hidden', 'true')
      document.body.appendChild(frame)
      printFrame.current = frame
      const doc = frame.contentDocument
      const win = frame.contentWindow
      if (!doc || !win) throw new Error('인쇄 창을 열 수 없습니다.')
      doc.title = '박스 개별 라벨 60x40mm'
      doc.documentElement.lang = 'ko'
      const style = doc.createElement('style')
      style.textContent = labelCss + '\n@page { size: 60mm 40mm; margin: 0; } html, body { margin: 0; padding: 0; width: 60mm; background: white; }'
      doc.head.appendChild(style)
      const labels = testOnly ? [codes[0]] : codes.flatMap(code => Array.from({ length: count }, () => code))
      for (const code of labels) {
        const label = doc.createElement('div')
        label.className = 'box-roll-label'
        const img = doc.createElement('img')
        img.src = prepared.images.get(code)!
        img.alt = code + ' QR'
        const number = doc.createElement('strong')
        number.className = 'box-roll-code'
        number.style.setProperty('--roll-code-units', String(codeTextUnits(code)))
        number.textContent = code
        label.append(img, number)
        doc.body.appendChild(label)
      }
      await Promise.all(Array.from(doc.images).map(img => img.decode()))
      await doc.fonts.ready
      if (!mounted.current || printFrame.current !== frame) return
      win.focus()
      win.print()
      if (mounted.current) setStatus('인쇄창을 열었습니다. XP-D4601B와 60×40mm 용지를 선택해 주세요. 출력 여부는 프린터에서 확인해 주세요.')
      // Keep the isolated document until the next print or unmount; some browsers print asynchronously.
    } catch (cause) {
      console.warn('[warehouse-qr] 롤 라벨 인쇄 실패', { path: location.pathname, cause })
      if (mounted.current) setError('인쇄를 준비하지 못했습니다. 다시 시도해 주세요.')
    } finally { if (mounted.current) setPrinting(false) }
  }

  return <div className="grid gap-4 lg:grid-cols-[19rem_minmax(0,1fr)]">
    <Card><CardContent className="space-y-4 p-4">
      <div><h3 className="text-sm font-semibold">박스 번호 발급 · 공용 저장</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">여러 컴퓨터에서 나눠 발급해도 서버에서 중복을 막고 번호를 저장합니다.<br />예: ENJ-261110-4827051936<br />날짜는 생성하는 날의 한국 날짜이며, 뒤쪽은 무작위 숫자 10자리입니다.</p></div>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">생성할 박스 개수</span><Input aria-label="생성할 박스 개수" inputMode="numeric" value={generationCount} disabled={printing || registry.busy} onChange={event => setGenerationCount(event.target.value)} /></label>
      <Button className="w-full" disabled={invalidCount || printing || registry.busy} onClick={() => void registry.issue(requestedCount)}>{registry.busy ? '처리 중…' : '새 번호 발급·저장'}</Button>
      {invalidCount && <p role="alert" className="text-xs text-danger">생성 개수는 1~{MAX_LABELS} 사이의 정수로 입력해 주세요.</p>}
      {registry.error && <p role="alert" className="text-xs text-danger">{registry.error}</p>}
      {registry.notice && <p role="status" className="text-xs text-muted-foreground">{registry.notice}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">발급 내역은 같은 브랜드를 사용하는 다른 컴퓨터에서도 확인할 수 있습니다. 저장된 번호만 출력하며, 재출력은 기존 번호를 그대로 사용합니다.</p>
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">박스 번호 · 한 줄에 하나</span><Textarea aria-label="개별 라벨 박스 번호" rows={8} value={text} disabled={printing || registry.busy} onChange={event => setText(event.target.value)} placeholder={'BOX-001\nBOX-002\nBOX-003'} /><span className="text-xs text-muted-foreground">중복 번호는 한 번만 사용합니다. 번호당 최대 32자입니다.</span></label>
      {!registered && codes.length > 0 && <div className="space-y-2"><p className="text-xs text-muted-foreground">이 목록은 아직 공용 저장을 확인하지 않았습니다. 이전에 출력했거나 직접 입력한 번호는 아래 버튼으로 등록하세요. 이미 등록했다면 발급 내역에서 불러오세요.</p><Button variant="outline" className="w-full" disabled={printing || registry.busy || codes.length > MAX_LABELS || codes.some(code => code.length > 32 || Array.from(code).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))} onClick={() => void registry.issue(codes.length, codes)}>기존 번호 등록·저장</Button></div>}
      <label className="block space-y-1"><span className="text-xs text-muted-foreground">번호별 출력 매수</span><Input aria-label="번호별 출력 매수" inputMode="numeric" value={copies} disabled={printing || registry.busy} onChange={event => setCopies(event.target.value)} /></label>
      {validation && <p role={text || copies !== '1' ? 'alert' : undefined} className="text-xs text-muted-foreground">{validation}</p>}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-7"><p>박스 번호 <strong>{codes.length}개</strong></p><p>출력할 라벨 <strong>{validation ? 0 : total}장</strong></p><p>한 장 크기 <strong>가로 60 × 세로 40mm</strong></p></div>
      <p className="text-xs text-muted-foreground">총 {MAX_LABELS}장까지 출력합니다. 이 화면에서는 라벨만 만들며 창고 재고에 등록하지 않습니다.</p>
    </CardContent></Card>
    <Card><CardContent className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold">박스 개별 라벨링</h3><p className="mt-1 text-xs text-muted-foreground">Xprinter XP-D4601B · 60×40mm 롤 라벨</p></div><Badge variant="outline">QR + 박스 번호</Badge></div>
      <div className="flex flex-wrap gap-2"><Button disabled={!ready || printing} onClick={() => void printLabels(false)}><Printer className="size-4" />{printing ? '인쇄 준비 중…' : '롤 라벨 인쇄'}</Button><Button variant="outline" disabled={!ready || printing} onClick={() => void printLabels(true)}>첫 번호 1장 시험 출력</Button></div>
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">프린터: XP-D4601B · 용지: 60×40mm · 배율: 100% · 여백: 없음 · 머리글/바닥글: 끄기.<br />라벨 사이에 틈이 있는 롤은 프린터 설정에서 간격 용지로 설정하고 용지 보정을 해 주세요. 인쇄창의 매수는 1로 두세요.</div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
      <div aria-label="개별 롤 라벨 미리보기" className="flex max-h-[36rem] min-h-64 flex-wrap items-start justify-center gap-4 overflow-auto rounded-lg border border-dashed border-border bg-muted/20 p-3">
        {ready ? codes.map(code => <div key={code} className="space-y-1"><div className="box-roll-label shadow-sm"><img src={prepared.images.get(code)} alt={code + ' QR'} /><strong className="box-roll-code" style={{ '--roll-code-units': codeTextUnits(code) } as CSSProperties}>{code}</strong></div><p className="text-center text-xs text-muted-foreground">{count}장</p></div>) : <p className="self-center text-sm text-muted-foreground">{!registered ? '번호를 발급·저장하거나 발급 내역에서 불러오세요.' : validation || (error ? 'QR 준비 실패' : 'QR 준비 중…')}</p>}
      </div>
      <section aria-label="박스 번호 발급 내역" className="space-y-3 border-t border-border pt-4">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">발급 내역 · 재출력</h3><Button variant="outline" size="sm" disabled={registry.historyLoading || registry.busy} onClick={registry.refresh}>내역 새로고침</Button></div>
        <div className="flex gap-2"><Input className="min-w-0 flex-1" aria-label="재출력할 전체 박스 번호" value={searchCode} onChange={event => setSearchCode(event.target.value)} placeholder="ENJ-261110-4827051936" /><Button className="shrink-0 whitespace-nowrap" variant="outline" disabled={!searchCode.trim() || registry.busy || printing} onClick={() => void registry.find(searchCode)}>번호 검색</Button></div>
        <p className="text-xs text-muted-foreground">전체 발급 묶음은 아래에서 불러오고, 한 장만 다시 뽑으려면 전체 박스 번호를 검색하세요. 날짜·시각은 한국 기준입니다.</p>
        {registry.historyError && <p role="alert" className="text-xs text-danger">{registry.historyError}</p>}
        {registry.historyLoading ? <p className="text-xs text-muted-foreground">발급 내역 불러오는 중…</p> : !registry.history.length && !registry.historyError ? <p className="text-xs text-muted-foreground">아직 저장된 발급 내역이 없습니다.</p> : registry.history.slice(0, BOX_LABEL_HISTORY_PAGE_SIZE).map(batch => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"><div><p className="text-sm">{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(batch.created_at))}</p><p className="text-xs text-muted-foreground">{batch.source === 'generated' ? '신규 발급' : '기존 번호 등록'} · {batch.label_count}개</p></div><Button variant="outline" size="sm" disabled={registry.busy || printing || registry.historyLoading} onClick={() => void registry.load(batch.id)}>번호 불러오기</Button></div>)}
        <div className="flex items-center justify-end gap-2"><Button variant="outline" size="sm" disabled={registry.page === 0 || registry.historyLoading} onClick={() => registry.setPage(page => page - 1)}>이전 내역</Button><span className="text-xs">{registry.page + 1}페이지</span><Button variant="outline" size="sm" disabled={registry.history.length <= BOX_LABEL_HISTORY_PAGE_SIZE || registry.historyLoading} onClick={() => registry.setPage(page => page + 1)}>다음 내역</Button></div>
      </section>
    </CardContent></Card>
  </div>
}
