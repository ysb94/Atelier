import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { outboundRackLabelPages } from '@/lib/warehouse/outbound-qr'
import './outbound-rack-print.css'

const PRINT_STYLE_ID = 'outbound-rack-page-style'

function clearPrintMode() {
  document.documentElement.classList.remove('printing-outbound-racks')
  document.documentElement.classList.remove('printing-outbound-slots')
  document.getElementById(PRINT_STYLE_ID)?.remove()
}
function enablePrintMode(slotMode: boolean) {
  document.documentElement.classList.add('printing-outbound-racks')
  document.documentElement.classList.toggle('printing-outbound-slots', slotMode)
  let style = document.getElementById(PRINT_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = '@page { size: A4 ' + (slotMode ? 'landscape' : 'portrait') + '; margin: 0; }'
}
function LabelSheet({ labels, slotImages }: { labels: (string | null)[]; slotImages?: ReadonlyMap<string, string> }) {
  return <div className={'outbound-rack-sheet' + (slotImages ? ' outbound-slot-sheet' : '')}>{labels.map((label, index) => {
    if (slotImages) {
      const [rack, slot] = label?.split('_') ?? []
      return <div className="outbound-rack-label outbound-slot-label" key={label ?? 'blank-' + index}>{label && <>
        <img className="outbound-slot-qr" src={slotImages.get(label)} alt={label + ' 자리 QR'} />
        <div className="outbound-slot-text" style={{ '--slot-rack-length': rack.length } as CSSProperties}>
          <span className="outbound-slot-rack">{rack}</span>
          <strong className="outbound-slot-position">{slot}</strong>
        </div>
      </>}</div>
    }
    const parts = label?.split('-') ?? []
    return <div className="outbound-rack-label" key={label ?? 'blank-' + index}>{label &&
      <div className="outbound-rack-label-content">
        <strong className="outbound-rack-label-code" aria-label={label} style={{ '--rack-part-length': Math.max(...parts.map((part) => part.length)) } as CSSProperties}>
          {parts.map((part, partIndex) => <span className="outbound-rack-label-part" key={partIndex}>
            {partIndex > 0 && <span className="outbound-rack-label-separator" aria-hidden="true">/</span>}
            <span className="outbound-rack-label-number">{part}</span>
          </span>)}
        </strong>
      </div>
    }</div>
  })}</div>
}

export function OutboundRackPrintPreview({ labels, slotImages, onClose }: { labels: string[]; slotImages?: ReadonlyMap<string, string>; onClose: () => void }) {
  useRenderWatch('OutboundRackPrintPreview')
  const active = useWorkspaceTabActivity()
  const slotMode = slotImages !== undefined
  const title = slotMode ? '고정 자리 · A4 4칸 QR 라벨' : '렉 번호 · A4 4칸 라벨'
  const pages = outboundRackLabelPages(labels)
  const [pageIndex, setPageIndex] = useState(0)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  const printRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('[aria-label="렉 라벨 미리보기 닫기"]')?.focus()
    return () => {
      clearPrintMode()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (!active) return
    const before = () => enablePrintMode(slotMode)
    const after = () => { clearPrintMode(); setPrinting(false) }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); clearPrintMode() }
  }, [active, slotMode])

  async function printLabels() {
    if (!active || printing) return
    setPrinting(true); setError('')
    try {
      await Promise.all(Array.from(printRoot.current?.querySelectorAll('img') ?? []).map((img) => img.decode()))
      await document.fonts.ready
      enablePrintMode(slotMode)
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      window.print()
    } catch (cause) {
      console.warn('[warehouse-qr] 렉 라벨 인쇄 실패', { path: location.pathname, cause })
      setError('인쇄를 준비하지 못했습니다. 미리보기를 닫고 다시 시도해 주세요.')
      clearPrintMode()
    } finally { setPrinting(false) }
  }
  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !printing) { event.stopPropagation(); onClose() }
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }
  return <WorkspaceTabOverlay>
    <div className="fixed inset-0 z-[3500] flex flex-col bg-foreground/40 p-3 sm:p-6">
      <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="outbound-rack-print-title" className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" onKeyDown={trapFocus}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div><h2 id="outbound-rack-print-title" className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-muted-foreground">2열 × 2행 균등 분할 · {slotMode ? '자리' : '렉'} {labels.length}개 · 총 {pages.length}장</p></div>
          <div className="flex gap-2"><Button size="sm" disabled={printing} onClick={() => void printLabels()}><Printer className="size-3.5" />{printing ? '인쇄 준비 중…' : slotMode ? '전체 고정 자리 라벨 인쇄' : '전체 렉 라벨 인쇄'}</Button><Button variant="outline" size="sm" disabled={printing} aria-label="렉 라벨 미리보기 닫기" onClick={onClose}><X className="size-4" /></Button></div>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
          <p className="text-xs text-muted-foreground">A4 {slotMode ? '가로' : '세로'} · 배율 100% · 여백 없음 · 머리글/바닥글 끄기</p>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" aria-label="이전 라벨 페이지" disabled={pageIndex === 0} onClick={() => setPageIndex((index) => index - 1)}><ChevronLeft className="size-4" /></Button><span className="min-w-14 text-center text-xs tabular-nums">{pageIndex + 1} / {pages.length}장</span><Button size="sm" variant="outline" aria-label="다음 라벨 페이지" disabled={pageIndex === pages.length - 1} onClick={() => setPageIndex((index) => index + 1)}><ChevronRight className="size-4" /></Button></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4"><div className={'outbound-rack-screen-preview' + (slotMode ? ' outbound-slot-preview' : '')}><LabelSheet labels={pages[pageIndex]} slotImages={slotImages} /></div></div>
        <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{slotMode ? '한 칸은 가로 148.5mm × 세로 105mm입니다. 같은 4칸 용지를 가로로 사용합니다. 위쪽 약 55%에 QR과 자리번호를 모으고 아래쪽 약 45%는 비워 둡니다.' : '한 칸은 가로 105mm × 세로 148.5mm입니다. 왼쪽 ¼은 비우고 오른쪽 ¾의 중앙에 세로로 표시합니다.'} 마지막 장의 남는 칸은 인쇄하지 않습니다.{error && <p role="alert" className="mt-1 text-danger">{error}</p>}</footer>
      </section>
    </div>
    {active && createPortal(<div className={'outbound-rack-print-root' + (slotMode ? ' outbound-slot-mode' : '')} ref={printRoot} aria-hidden="true">{pages.map((page, index) => <LabelSheet key={index} labels={page} slotImages={slotImages} />)}</div>, document.body)}
  </WorkspaceTabOverlay>
}
