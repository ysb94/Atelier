import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Button } from '@/components/ui/button'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { useRenderWatch } from '@/lib/diagnostics'
import { INVOICE_PRODUCT_LIST_PRINT_ROWS } from '@/lib/invoice/product-list-print'
import { formatNumber } from '@/lib/utils'
import { sumRoomListQuantities } from './room-list-paste'
import {
  measurePickingCodes, type PickingCodeField, type PickingCodeLayout, type PickingPrintColumns,
} from './room-list-picking-code-layout'
import './room-list-picking-print.css'

export type RoomPickingLine = {
  id: number; name: string; quantity: string; location: string; nextLocation?: string; styleNo: string
}
export type RoomPickingRoom = { key: string; name: string; lines: RoomPickingLine[] }

function pickingPages(room: RoomPickingRoom) {
  const rowsPerPage = INVOICE_PRODUCT_LIST_PRINT_ROWS
  const pageCount = Math.ceil(room.lines.length / rowsPerPage)
  return Array.from({ length: pageCount }, (_, index) => ({
    room: room.name,
    key: `${room.key}:${index}`,
    number: index + 1,
    pageCount,
    lines: room.lines.slice(index * rowsPerPage, (index + 1) * rowsPerPage),
  }))
}

function PickingCode({ field, text, codes }: { field: PickingCodeField; text: string; codes?: PickingCodeLayout }) {
  return <span data-picking-code={field} style={{ fontSize: codes?.fontSizes.get(field)?.get(text) }}>{text}</span>
}

function PickingTable({ lines, codes }: { lines: RoomPickingLine[]; codes?: PickingCodeLayout }) {
  return (
    <table className="room-list-picking-table w-full min-w-[640px] border-collapse text-xs">
      <caption className="sr-only">방별 피킹 품목</caption>
      <colgroup><col className="w-24" /><col className="w-28" /><col /><col className="w-20" /><col className="w-28" /></colgroup>
      <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
        <tr className="text-left">
          <th scope="col" className="px-3 py-2">M번호</th>
          <th scope="col" className="px-3 py-2">자리번호</th>
          <th scope="col" className="px-3 py-2">상품명</th>
          <th scope="col" className="px-3 py-2 text-right">수량</th>
          <th scope="col" className="px-3 py-2">다음 자리</th>
        </tr>
      </thead>
      <tbody>
        {lines.map(line => (
          <tr key={line.id} className="border-b border-border/70">
            <td className="px-3 py-1.5 tabular-nums"><PickingCode field="styleNo" text={line.styleNo || '—'} codes={codes} /></td>
            <td className="break-all px-3 py-1.5"><PickingCode field="location" text={line.location || '위치 없음'} codes={codes} /></td>
            <td className="break-words px-3 py-1.5">{line.name}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{line.quantity || '—'}</td>
            <td className="break-all px-3 py-1.5">{line.nextLocation && <PickingCode field="nextLocation" text={line.nextLocation} codes={codes} />}</td>
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

type PrintSection = { room: RoomPickingRoom; start: number; split: number; end: number }

function fitPickingSection(rowHeights: number[], start: number, available: number, columns: PickingPrintColumns) {
  let end = start
  let leftHeight = 0
  while (end < rowHeights.length && leftHeight + rowHeights[end] <= available) {
    leftHeight += rowHeights[end++]
  }
  if (columns === '1') return { split: end, end, height: leftHeight }
  let split = end
  let rightHeight = 0
  while (end < rowHeights.length && rightHeight + rowHeights[end] <= available) {
    rightHeight += rowHeights[end++]
  }

  // Keep the original row order and move the split toward equal column heights.
  while (split > start + 1) {
    const height = rowHeights[split - 1]
    if (rightHeight + height >= leftHeight) break
    leftHeight -= height
    rightHeight += height
    split--
  }
  return { split, end, height: Math.max(leftHeight, rightHeight) }
}

function measurePickingPages(sheet: HTMLDivElement, rooms: RoomPickingRoom[], columns: PickingPrintColumns) {
  const pageHeight = sheet.getBoundingClientRect().height
  const sectionGap = parseFloat(getComputedStyle(sheet).rowGap)
  const pages: PrintSection[][] = [[]]
  let page = pages[0]
  let usedHeight = 0

  rooms.forEach((room, index) => {
    if (!room.lines.length) return
    const section = sheet.children[index]
    const table = section.querySelector('table')!
    const heading = section.querySelector('header')!
    const tableArea = section.querySelector('.room-list-picking-columns')!
    const rowHeights = Array.from(table.tBodies[0].rows, row => row.getBoundingClientRect().height)
    // Allow for the extra edge of the collapsed table border when rows are split.
    const sectionOverhead = tableArea.getBoundingClientRect().top - heading.getBoundingClientRect().top
      + (table.tHead?.getBoundingClientRect().height ?? 0) + 1

    for (let start = 0; start < rowHeights.length;) {
      const gap = page.length ? sectionGap : 0
      const fit = fitPickingSection(rowHeights, start, pageHeight - usedHeight - gap - sectionOverhead, columns)
      if (page.length && fit.end < rowHeights.length) {
        page = []
        pages.push(page)
        usedHeight = 0
        continue
      }
      // An unusually tall single row still needs to be included.
      const end = Math.max(fit.end, start + 1)
      page.push({ room, start, split: Math.max(fit.split, start + 1), end })
      usedHeight += gap + sectionOverhead + (fit.end === start ? rowHeights[start] : fit.height)
      start = end
    }
  })
  return pages.filter(sections => sections.length > 0)
}

function PickingPrintSection({ section, codes }: { section: PrintSection; codes?: PickingCodeLayout }) {
  const { room, start, split, end } = section
  const left = room.lines.slice(start, split)
  const right = room.lines.slice(split, end)
  const total = sumRoomListQuantities(room.lines.slice(start, end).map(line => line.quantity))
  return (
    <section className="room-list-picking-section">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold">{room.name}</h3>
        <p className="shrink-0 text-xs">
          {start > 0 && '계속 · '}{formatNumber(end - start)}종{total !== null ? ` · ${total}개` : ''}
        </p>
      </header>
      <div className="room-list-picking-columns">
        <PickingTable lines={left} codes={codes} />
        {right.length > 0 && <PickingTable lines={right} codes={codes} />}
      </div>
    </section>
  )
}

function PickingSheet({ sections, columns, codes }: {
  sections: PrintSection[]; columns: PickingPrintColumns; codes: PickingCodeLayout
}) {
  return (
    <div className="room-list-picking-sheet" data-columns={columns} style={codes.columnWidths}>
      {sections.map(section => <PickingPrintSection key={section.room.key} section={section} codes={codes} />)}
    </div>
  )
}

export function RoomListPickingPrintPreview({ rooms, onClose }: { rooms: RoomPickingRoom[]; onClose: () => void }) {
  useRenderWatch('RoomListPickingPrintPreview')
  const active = useWorkspaceTabActivity()
  const [columns, setColumns] = useState<PickingPrintColumns>('2')
  const [layout, setLayout] = useState<{
    rooms: RoomPickingRoom[]; columns: PickingPrintColumns; pages: PrintSection[][]; codes: PickingCodeLayout
  }>()
  const [index, setIndex] = useState(0)
  const [printError, setPrintError] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const measurement = useRef<HTMLDivElement>(null)
  const currentLayout = layout?.rooms === rooms && layout.columns === columns ? layout : undefined
  const pages = currentLayout?.pages
  const pageCount = pages?.length ?? 0
  const currentIndex = Math.min(index, Math.max(0, pageCount - 1))
  const page = pages?.[currentIndex]

  useLayoutEffect(() => {
    const sheet = measurement.current
    if (!active || !sheet) return
    let cancelled = false
    const update = () => {
      if (cancelled) return
      const startedAt = performance.now()
      const codes = measurePickingCodes(sheet, columns)
      const pages = measurePickingPages(sheet, rooms, columns)
      const elapsedMs = Math.round(performance.now() - startedAt)
      if (elapsedMs >= 200) {
        const log = elapsedMs >= 1000 ? console.warn : console.info
        log('[room-list] 피킹표 인쇄 페이지 계산', { elapsedMs, roomCount: rooms.length, columns })
      }
      setLayout({ rooms, columns, pages, codes })
    }
    if (document.fonts.status === 'loading') void document.fonts.ready.then(update)
    else update()
    return () => { cancelled = true }
  }, [active, rooms, columns])

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

  return (
    <WorkspaceTabOverlay>
      <dialog ref={dialog} aria-labelledby="room-picking-preview-title"
        className="fixed inset-0 m-auto max-h-[90dvh] w-[min(94vw,880px)] overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-foreground/40"
        onCancel={event => { event.preventDefault(); onClose() }}>
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
          <div>
            <h2 id="room-picking-preview-title" className="font-semibold">피킹표 미리보기 및 출력</h2>
            <p className="text-xs text-muted-foreground">
              {pages ? `A4 세로 · ${formatNumber(pageCount)}장` : '인쇄 페이지를 정리하고 있습니다…'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!page} onClick={() => {
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
        <div className="flex justify-center border-b border-border p-2">
          <FilterTabs<PickingPrintColumns>
            ariaLabel="인쇄 형식"
            value={columns}
            onChange={value => {
              setColumns(value)
              setIndex(0)
            }}
            tabs={[{ value: '1', label: '1열 · 큰 글씨' }, { value: '2', label: '2열' }]}
          />
        </div>
        {page && <div className="flex items-center justify-center gap-2 border-b border-border p-2">
          <Button type="button" size="sm" variant="outline" aria-label="이전 페이지" disabled={currentIndex === 0}
            onClick={() => setIndex(currentIndex - 1)}><ChevronLeft className="size-4" /></Button>
          <span className="text-xs tabular-nums">{currentIndex + 1} / {pageCount}</span>
          <Button type="button" size="sm" variant="outline" aria-label="다음 페이지" disabled={currentIndex === pageCount - 1}
            onClick={() => setIndex(currentIndex + 1)}><ChevronRight className="size-4" /></Button>
        </div>}
        {page && currentLayout && (
          <div className="overflow-auto p-4"><PickingSheet sections={page} columns={columns} codes={currentLayout.codes} /></div>
        )}
      </dialog>
      {createPortal(
        <div className="room-list-picking-print" aria-hidden="true">
          {currentLayout?.pages.map(sections => (
            <PickingSheet key={`${sections[0].room.key}:${sections[0].start}`} sections={sections} columns={columns} codes={currentLayout.codes} />
          ))}
        </div>,
        document.body,
      )}
      {!pages && createPortal(
        <div key={columns} ref={measurement} className="room-list-picking-sheet room-list-picking-measure" data-columns={columns} aria-hidden="true">
          {rooms.map(room => (
            <PickingPrintSection key={room.key} section={{ room, start: 0, split: room.lines.length, end: room.lines.length }} />
          ))}
        </div>,
        document.body,
      )}
    </WorkspaceTabOverlay>
  )
}
