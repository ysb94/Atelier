import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
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
  const width = columns.reduce((total, { id }) => total + DRAFT_SHEET_COLUMNS[id].width, 0)

  useEffect(() => () => {
    cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = 0
    drag.current = null
  }, [])

  useEffect(() => {
    const section = header.current
    const table = section?.closest('table')
    const scroller = table?.closest<HTMLElement>('.draft-board-scroll')
    if (!section || !table || !scroller) return
    const viewport = table.closest<HTMLElement>('[data-brand-page-scroll]')
    const visualViewport = window.visualViewport
    let frame = 0
    let inset = 0

    // The cells stick inside the horizontal scroller. Feed them the vertical workspace position
    // while the unshifted section remains the reference for the table's natural header position.
    const update = () => {
      frame = 0
      const bounds = section.getBoundingClientRect()
      const windowTop = visualViewport?.offsetTop ?? 0
      const viewportTop = viewport ? Math.max(windowTop, viewport.getBoundingClientRect().top + viewport.clientTop) : windowTop
      const pinnedTop = Math.min(viewportTop, table.getBoundingClientRect().bottom - bounds.height)
      const nextInset = pinnedTop > bounds.top ? pinnedTop - scroller.getBoundingClientRect().top - scroller.clientTop : 0
      if (nextInset === inset) return
      inset = nextInset
      section.style.setProperty('--draft-sheet-header-top', `${inset}px`)
    }

    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const observer = new ResizeObserver(scheduleUpdate)
    observer.observe(table)
    observer.observe(section)
    observer.observe(scroller)
    if (viewport) observer.observe(viewport)
    const boardContent = scroller.parentElement
    if (boardContent && boardContent !== viewport) observer.observe(boardContent)
    viewport?.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    visualViewport?.addEventListener('scroll', scheduleUpdate, { passive: true })
    visualViewport?.addEventListener('resize', scheduleUpdate)
    update()
    return () => {
      viewport?.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      visualViewport?.removeEventListener('scroll', scheduleUpdate)
      visualViewport?.removeEventListener('resize', scheduleUpdate)
      observer.disconnect()
      cancelAnimationFrame(frame)
      section.style.removeProperty('--draft-sheet-header-top')
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
    const cell = section?.rows[0]?.cells[0]
    if (!current?.active || !cell || !scroll) return
    const { left, right } = scroll.getBoundingClientRect()
    const { top, bottom } = cell.getBoundingClientRect()
    const { x, y } = current
    if (x < left || x > right || y < top || y > bottom) return

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

  return <table className="draft-board-table" style={{ width, '--draft-sheet-width': `${width}px` } as CSSProperties}>
    {caption && <caption className="sr-only">{caption}</caption>}
    <colgroup>{columns.map(({ id }) => <col key={id} className={`draft-column-${id}`}
      style={{ width: DRAFT_SHEET_COLUMNS[id].width }} />)}</colgroup>
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
      </th>)}</tr>
    </thead>
    {children}
  </table>
}
