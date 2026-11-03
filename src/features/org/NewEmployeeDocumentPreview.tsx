import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { renderEmployeeDocument, type DocumentPreviewData, type SignatureDocument } from './new-employee-document-templates'
import { calculateCompanyWage } from './company-information-values'

export function NewEmployeeDocumentPreview({ kind, data, onClose }: { kind: SignatureDocument; data: DocumentPreviewData; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const container = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const title = useId()
  const [scale, setScale] = useState(1)
  const html = useMemo(() => renderEmployeeDocument(kind, data), [kind, data])
  const wageError = useMemo(() => kind === '근로계약서' && data.company ? calculateCompanyWage(data.company).error : '', [kind, data.company])
  const [loadedHtml, setLoadedHtml] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)
  const [height, setHeight] = useState(kind === '근로계약서' ? 2278 : 1139)
  const contentFrame = useRef(0)
  useEffect(() => {
    dialog.current?.showModal()
    let scaleFrame = 0
    const observer = new ResizeObserver(entries => {
      cancelAnimationFrame(scaleFrame)
      const width = entries[0].contentRect.width
      scaleFrame = requestAnimationFrame(() => setScale(Math.min(1, Math.max(0.1, (width - 16) / 794))))
    })
    if (container.current) observer.observe(container.current)
    return () => { observer.disconnect(); cancelAnimationFrame(scaleFrame); cancelAnimationFrame(contentFrame.current) }
  }, [])
  function printDocument() {
    const documentWindow = frame.current?.contentWindow
    if (!documentWindow || loadedHtml !== html) return
    setPrintError(null)
    try {
      // 현재 서류만 인쇄하므로 바깥 화면과 미리보기 축소 비율은 출력에 포함되지 않는다.
      documentWindow.focus()
      documentWindow.print()
    } catch (error) {
      console.warn('[employee-document] 인쇄창 열기 실패', { kind, error })
      setPrintError('인쇄창을 열지 못했습니다. 인쇄 버튼을 다시 눌러 주세요.')
    }
  }
  return <dialog ref={dialog} aria-labelledby={title} onClose={onClose} className="m-auto max-h-[94dvh] w-[calc(100%_-_1rem)] max-w-5xl overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/35 open:flex open:flex-col">
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border p-4"><div className="min-w-0 flex-1 basis-56"><h3 id={title} className="font-semibold">{kind} 미리보기</h3><p className="mt-1 text-xs text-muted-foreground">{kind === '근로계약서' ? '엑셀 출력용 양식 기준' : '제공 동의서 양식 기준'} · A4 세로 인쇄 · 입력하지 않은 값과 동의·서명란은 공란입니다.</p></div><div className="flex shrink-0 gap-2"><Button type="button" disabled={loadedHtml !== html} onClick={printDocument}><Printer className="size-4" aria-hidden="true"/>인쇄</Button><Button type="button" variant="outline" onClick={onClose}>닫기</Button></div></div>
    {printError ? <p role="alert" className="shrink-0 px-4 py-2 text-sm text-danger">{printError}</p> : null}
    {wageError ? <p role="status" className="shrink-0 px-4 py-2 text-sm text-warning">제8조 임금표 계산 대기: {wageError} 회사 입력정보에서 확인해 주세요. 계산되지 않은 값은 공란으로 출력됩니다.</p> : null}
    <div ref={container} className="min-h-0 flex-1 overflow-y-auto bg-muted p-2"><div style={{ height: height * scale }} className="relative mx-auto" ><iframe ref={frame} title={`${kind} 양식`} sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={event => {
      // 인쇄창만 추가 허용한다. 문서 안의 스크립트·폼 실행은 계속 차단한다.
      cancelAnimationFrame(contentFrame.current)
      const body = event.currentTarget.contentDocument?.body
      if (!body?.querySelector('.sheet')) return
      setLoadedHtml(event.currentTarget.srcdoc)
      setPrintError(null)
      // 내부 문서는 고정 폭이고 입력 변경마다 srcDoc이 다시 로드되므로 한 번만 측정한다.
      contentFrame.current = requestAnimationFrame(() => setHeight(Math.ceil(body.getBoundingClientRect().height)))
    }} className="absolute left-1/2 top-0 border-0 bg-white" style={{ width: 794, height, transform: `translateX(-50%) scale(${scale})`, transformOrigin: 'top center' }} /></div></div>
  </dialog>
}
