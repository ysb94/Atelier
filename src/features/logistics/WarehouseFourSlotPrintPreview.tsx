import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Printer, X } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import { outboundRackLabelPages } from '@/lib/warehouse/outbound-qr'
import './outbound-rack-print.css'

const PRINT_STYLE_ID = 'outbound-rack-page-style'

function clearPrintMode() {
  document.documentElement.classList.remove('printing-outbound-racks', 'printing-outbound-slots')
  document.getElementById(PRINT_STYLE_ID)?.remove()
}

function enablePrintMode(landscape: boolean) {
  document.documentElement.classList.add('printing-outbound-racks')
  document.documentElement.classList.toggle('printing-outbound-slots', landscape)
  let style = document.getElementById(PRINT_STYLE_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = PRINT_STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = '@page { size: A4 ' + (landscape ? 'landscape' : 'portrait') + '; margin: 0; }'
}

type PreviewProps<T> = {
  labels: readonly T[]
  landscape: boolean
  title: string
  unit: string
  printLabel: string
  closeLabel: string
  note: string
  renderSheet: (labels: (T | null)[]) => ReactNode
  onClose: () => void
}

export function WarehouseFourSlotPrintPreview<T>({
  labels, landscape, title, unit, printLabel, closeLabel, note, renderSheet, onClose,
}: PreviewProps<T>) {
  const active = useWorkspaceTabActivity()
  const titleId = useId()
  const pages = outboundRackLabelPages(labels)
  const [pageIndex, setPageIndex] = useState(0)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLElement>(null)
  const printRoot = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement
    dialog.current?.querySelector<HTMLButtonElement>('[data-print-preview-close]')?.focus()
    const before = () => enablePrintMode(landscape)
    const after = () => { clearPrintMode(); setPrinting(false) }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
      clearPrintMode()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [active, landscape])

  async function printLabels() {
    const root = printRoot.current
    if (!active || printing || !root) return
    setPrinting(true)
    setError('')
    try {
      await Promise.all(Array.from(root.querySelectorAll('img'), image => image.decode()))
      await document.fonts.ready
      if (!root.isConnected) return
      enablePrintMode(landscape)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      if (root.isConnected) window.print()
    } catch {
      console.warn('[warehouse-qr] A4 라벨 인쇄 준비 실패', { path: location.pathname })
      setError('인쇄를 준비하지 못했습니다. 미리보기를 닫고 다시 시도해 주세요.')
      clearPrintMode()
    } finally {
      setPrinting(false)
    }
  }

  function trapFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !printing) { event.stopPropagation(); onClose() }
    if (event.key !== 'Tab') return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const first = buttons[0], last = buttons.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return (
    <WorkspaceTabOverlay>
      <div className="fixed inset-0 z-[3500] flex flex-col bg-foreground/40 p-3 sm:p-6">
        <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl" onKeyDown={trapFocus}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 id={titleId} className="text-base font-semibold">{title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">2열 × 2행 균등 분할 · {unit} {labels.length}개 · 총 {pages.length}장</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={printing} onClick={() => void printLabels()}>
                <Printer className="size-3.5" />{printing ? '인쇄 준비 중…' : printLabel}
              </Button>
              <Button variant="outline" size="sm" disabled={printing} data-print-preview-close aria-label={closeLabel} onClick={onClose}><X className="size-4" /></Button>
            </div>
          </header>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <p className="text-xs text-muted-foreground">A4 {landscape ? '가로' : '세로'} · 배율 100% · 여백 없음 · 머리글/바닥글 끄기</p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" aria-label="이전 라벨 페이지" disabled={pageIndex === 0} onClick={() => setPageIndex(index => index - 1)}><ChevronLeft className="size-4" /></Button>
              <span className="min-w-14 text-center text-xs tabular-nums">{pageIndex + 1} / {pages.length}장</span>
              <Button size="sm" variant="outline" aria-label="다음 라벨 페이지" disabled={pageIndex === pages.length - 1} onClick={() => setPageIndex(index => index + 1)}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
            <div className={'outbound-rack-screen-preview' + (landscape ? ' outbound-slot-preview' : '')}>{renderSheet(pages[pageIndex])}</div>
          </div>
          <footer className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {note}
            {error && <p role="alert" className="mt-1 text-danger">{error}</p>}
          </footer>
        </section>
      </div>
      {active && createPortal(
        <div className="outbound-rack-print-root" ref={printRoot} aria-hidden="true">
          {pages.map((page, index) => <Fragment key={index}>{renderSheet(page)}</Fragment>)}
        </div>,
        document.body,
      )}
    </WorkspaceTabOverlay>
  )
}
