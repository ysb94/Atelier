import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { INVOICE_PRODUCT_LIST_PRINT_ROWS } from '@/lib/invoice/product-list-print'
import { formatNumber } from '@/lib/utils'
import { sumRoomListQuantities } from './room-list-paste'
import './room-list-picking-print.css'

export type RoomPickingLine = { id: number; name: string; quantity: string; location: string; styleNo: string }
export type RoomPickingRoom = { key: string; name: string; lines: RoomPickingLine[] }

function pickingPages(room: RoomPickingRoom) {
  const pageCount = Math.ceil(room.lines.length / INVOICE_PRODUCT_LIST_PRINT_ROWS)
  return Array.from({ length: pageCount }, (_, index) => ({
    room: room.name,
    key: `${room.key}:${index}`,
    number: index + 1,
    pageCount,
    lines: room.lines.slice(index * INVOICE_PRODUCT_LIST_PRINT_ROWS, (index + 1) * INVOICE_PRODUCT_LIST_PRINT_ROWS),
  }))
}

function PickingTable({ lines }: { lines: RoomPickingLine[] }) {
  return (
    <table className="room-list-picking-table w-full min-w-[580px] border-collapse text-xs">
      <caption className="sr-only">방별 피킹 품목</caption>
      <colgroup><col className="w-24" /><col className="w-32" /><col /><col className="w-24" /></colgroup>
      <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
        <tr className="text-left">
          <th scope="col" className="px-3 py-2">M번호</th>
          <th scope="col" className="px-3 py-2">자리번호</th>
          <th scope="col" className="px-3 py-2">상품명</th>
          <th scope="col" className="px-3 py-2 text-right">수량</th>
        </tr>
      </thead>
      <tbody>
        {lines.map(line => (
          <tr key={line.id} className="border-b border-border/70">
            <td className="px-3 py-1.5 tabular-nums">{line.styleNo || '—'}</td>
            <td className="break-all px-3 py-1.5">{line.location || '위치 없음'}</td>
            <td className="break-words px-3 py-1.5">{line.name}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{line.quantity || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RoomListPickingPanel({ room }: { room: RoomPickingRoom }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
      {pickingPages(room).map(page => (
        <div key={page.key} className="border-b border-border last:border-b-0">
          <p className="bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
            {page.room} · {page.number}/{page.pageCount}쪽
          </p>
          <PickingTable lines={page.lines} />
        </div>
      ))}
    </div>
  )
}

function PickingSheet({ page }: { page: ReturnType<typeof pickingPages>[number] }) {
  const total = sumRoomListQuantities(page.lines.map(line => line.quantity))
  return (
    <section className="room-list-picking-sheet">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold">방별 피킹표 · {page.room}</h3>
        <p className="text-xs">{page.number}/{page.pageCount}쪽 · {formatNumber(page.lines.length)}종{total !== null ? ` · ${total}개` : ''}</p>
      </header>
      <PickingTable lines={page.lines} />
    </section>
  )
}

export function RoomListPickingPrintPreview({ rooms, onClose }: { rooms: RoomPickingRoom[]; onClose: () => void }) {
  const active = useWorkspaceTabActivity()
  const pages = useMemo(() => rooms.flatMap(pickingPages), [rooms])
  const [index, setIndex] = useState(0)
  const [printError, setPrintError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const currentIndex = Math.min(index, Math.max(0, pages.length - 1))
  const page = pages[currentIndex]

  useEffect(() => {
    if (!active) return
    dialog.current?.showModal()
    const clear = () => document.documentElement.classList.remove('printing-room-list-picking')
    window.addEventListener('afterprint', clear)
    return () => {
      window.removeEventListener('afterprint', clear)
      clear()
    }
  }, [active])

  if (!page) return null
  return (
    <WorkspaceTabOverlay>
      <dialog ref={dialog} aria-labelledby="room-picking-preview-title"
        className="fixed inset-0 m-auto max-h-[90dvh] w-[min(94vw,880px)] overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/40"
        onCancel={event => { event.preventDefault(); onClose() }}>
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
          <div>
            <h2 id="room-picking-preview-title" className="font-semibold">피킹표 미리보기 및 출력</h2>
            <p className="text-xs text-muted-foreground">A4 세로 · {formatNumber(pages.length)}장</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => {
              setPrintError(false)
              document.documentElement.classList.add('printing-room-list-picking')
              try {
                window.print()
              } catch (error) {
                document.documentElement.classList.remove('printing-room-list-picking')
                setPrintError(true)
                console.warn('[room-list] 피킹표 인쇄 실패', { errorType: error instanceof Error ? error.name : 'unknown' })
              }
            }}><Printer className="size-4" aria-hidden="true" /> 인쇄</Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>닫기</Button>
          </div>
        </header>
        {printError && <p role="alert" className="px-4 py-2 text-sm text-danger">인쇄 창을 열지 못했습니다. 다시 시도해 주세요.</p>}
        <div className="flex items-center justify-center gap-2 border-b border-border p-2">
          <Button type="button" size="sm" variant="outline" aria-label="이전 페이지" disabled={currentIndex === 0}
            onClick={() => setIndex(currentIndex - 1)}><ChevronLeft className="size-4" /></Button>
          <span className="text-xs tabular-nums">{currentIndex + 1} / {pages.length}</span>
          <Button type="button" size="sm" variant="outline" aria-label="다음 페이지" disabled={currentIndex === pages.length - 1}
            onClick={() => setIndex(currentIndex + 1)}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="overflow-auto p-4"><PickingSheet page={page} /></div>
      </dialog>
      {createPortal(
        <div className="room-list-picking-print" aria-hidden="true">
          {pages.map(item => <PickingSheet key={item.key} page={item} />)}
        </div>,
        document.body,
      )}
    </WorkspaceTabOverlay>
  )
}
