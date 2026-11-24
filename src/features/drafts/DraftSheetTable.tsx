import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import { DEFAULT_DRAFT_SHEET_LAYOUT, DRAFT_SHEET_COLUMNS, type DraftSheetColumnId, type DraftSheetLayout } from './draft-sheet-layout'

type DropTarget = { id: DraftSheetColumnId; after: boolean }
type HeaderDrag = {
  pointerId: number
  id: DraftSheetColumnId
  startX: number
  x: number
  y: number
  active: boolean
}

const DRAG_DISTANCE = 5
const SCROLL_EDGE = 42
const ACTION_COLUMN_WIDTH = 100

export function DraftSheetTable({ layout = DEFAULT_DRAFT_SHEET_LAYOUT, caption, onMoveColumn, children }: {
  layout?: DraftSheetLayout
  caption?: string
  onMoveColumn?: (from: DraftSheetColumnId, target: DraftSheetColumnId, after: boolean) => void
  children: ReactNode
}) {
  const header = useRef<HTMLTableSectionElement>(null)
  const drag = useRef<HeaderDrag | null>(null)
  const scrollFrame = useRef(0)
  const [dragging, setDragging] = useState<DraftSheetColumnId | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const columns = layout.filter(column => column.visible)
  const canMove = Boolean(onMoveColumn && columns.length > 1)
  const width = columns.reduce((total, { id }) => total + DRAFT_SHEET_COLUMNS[id].width, ACTION_COLUMN_WIDTH)

  useEffect(() => () => {
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = 0
    drag.current = null
  }, [])

  useEffect(() => {
    const section = header.current
    const table = section?.closest('table')
    if (!section || !table) return
    const viewport = table.closest<HTMLElement>('[data-brand-page-scroll]')
    const scrollRoot = viewport ?? window
    let frame = 0
    let offset = 0

    // The horizontal overflow wrapper also captures CSS sticky on the vertical axis.
    // Move the actual header within the table so column widths and drag targets stay shared.
    const update = () => {
      frame = 0
      const bounds = section.getBoundingClientRect()
      const naturalTop = bounds.top - offset
      const viewportTop = viewport ? Math.max(0, viewport.getBoundingClientRect().top + viewport.clientTop) : 0
      const nextOffset = Math.max(0, Math.min(viewportTop, table.getBoundingClientRect().bottom - bounds.height) - naturalTop)
      if (nextOffset === offset) return
      offset = nextOffset
      section.style.transform = offset ? `translateY(${offset}px)` : ''
    }

    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(table)
    observer.observe(section)
    if (viewport) observer.observe(viewport)
    const boardContent = table.closest('.draft-board-scroll')?.parentElement
    if (boardContent && boardContent !== viewport) observer.observe(boardContent)
    scrollRoot.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    update()
    return () => {
      scrollRoot.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      observer.disconnect()
      cancelAnimationFrame(frame)
      section.style.transform = ''
    }
  }, [])

  function targetAtPointer({ id, x, y }: HeaderDrag): DropTarget | null {
    const target = document.elementFromPoint(x, y)?.closest<HTMLTableCellElement>('th[data-column]')
    if (!target || !header.current?.contains(target)) return null
    const targetId = target.dataset.column as DraftSheetColumnId
    if (targetId === id) return null
    const rect = target.getBoundingClientRect()
    return { id: targetId, after: x >= rect.left + rect.width / 2 }
  }

  function showDropTarget(current: HeaderDrag) {
    const next = targetAtPointer(current)
    setDrop(previous => previous?.id === next?.id && previous?.after === next?.after ? previous : next)
  }

  function scrollDuringDrag() {
    scrollFrame.current = 0
    const current = drag.current
    const section = header.current
    const scroll = section?.closest<HTMLElement>('.draft-board-scroll')
    if (!current?.active || !section || !scroll) return
    const bounds = scroll.getBoundingClientRect()
    const { left } = bounds
    const right = bounds.right - ACTION_COLUMN_WIDTH
    const { top, bottom } = section.getBoundingClientRect()
    const { x, y } = current
    if (x < left || x > bounds.right || y < top || y > bottom) return

    const edge = Math.min(SCROLL_EDGE, (right - left) / 3)
    const distance = x < left + edge ? x - left - edge : Math.max(0, x - right + edge)
    if (distance === 0) return
    const before = scroll.scrollLeft
    scroll.scrollLeft += Math.sign(distance) * Math.max(4, Math.round(Math.abs(distance) / 2))
    if (scroll.scrollLeft === before) return
    showDropTarget(current)
    scrollFrame.current = requestAnimationFrame(scrollDuringDrag)
  }

  function startDrag(event: PointerEvent<HTMLTableCellElement>, id: DraftSheetColumnId) {
    if (!canMove || !event.isPrimary || event.button !== 0) return
    const { pointerId, clientX, clientY } = event
    drag.current = { pointerId, id, startX: clientX, x: clientX, y: clientY, active: false }
    event.currentTarget.setPointerCapture(pointerId)
  }

  function moveDrag(event: PointerEvent<HTMLTableCellElement>) {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    if (!current.active) {
      if (Math.abs(current.x - current.startX) < DRAG_DISTANCE) return
      current.active = true
      setDragging(current.id)
    }
    showDropTarget(current)
    if (!scrollFrame.current) scrollFrame.current = requestAnimationFrame(scrollDuringDrag)
  }

  function finishDrag(event: PointerEvent<HTMLTableCellElement>, apply: boolean) {
    const current = drag.current
    if (current?.pointerId !== event.pointerId) return
    drag.current = null
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = 0
    setDragging(null)
    setDrop(null)
    if (!apply || !current.active) return
    const target = targetAtPointer({ ...current, x: event.clientX, y: event.clientY })
    if (target) onMoveColumn?.(current.id, target.id, target.after)
  }

  return <table className="draft-board-table" style={{ width }}>
    {caption && <caption className="sr-only">{caption}</caption>}
    <colgroup>{columns.map(({ id }) => <col key={id} className={`draft-column-${id}`}
      style={{ width: DRAFT_SHEET_COLUMNS[id].width }} />)}<col style={{ width: ACTION_COLUMN_WIDTH }} /></colgroup>
    <thead ref={header}>
      <tr>{columns.map(({ id }, index) => <th key={id} scope="col" className={`draft-column-${id}`}
        data-column={id} data-dragging={dragging === id || undefined}
        data-drop={drop?.id === id ? (drop.after ? 'after' : 'before') : undefined}
        data-reorderable={canMove || undefined} tabIndex={canMove ? 0 : undefined}
        title={canMove ? '끌어서 열 순서 변경' : undefined}
        aria-keyshortcuts={canMove ? 'Shift+ArrowLeft Shift+ArrowRight' : undefined}
        onPointerDown={event => startDrag(event, id)} onPointerMove={moveDrag}
        onPointerUp={event => finishDrag(event, true)} onPointerCancel={event => finishDrag(event, false)}
        onLostPointerCapture={event => finishDrag(event, false)}
        onKeyDown={event => {
          if (!canMove || !event.shiftKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
          event.preventDefault()
          const after = event.key === 'ArrowRight'
          const target = columns[index + (after ? 1 : -1)]
          if (target) onMoveColumn?.(id, target.id, after)
        }}>
        {DRAFT_SHEET_COLUMNS[id].label}
        {canMove && <GripVertical className="draft-header-grip" aria-hidden="true" />}
      </th>)}<th scope="col" className="draft-sheet-action-column">기획안</th></tr>
    </thead>
    {children}
  </table>
}
