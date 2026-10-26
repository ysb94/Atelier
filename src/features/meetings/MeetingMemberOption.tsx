import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import type { MeetingPerson } from './meeting-schedule'
import type { MeetingParticipation } from './meeting-participation'

const EMPTY_PARTICIPATION: MeetingParticipation = { count: 0, visibleMeetings: [], hiddenCount: 0 }

type Props = {
  person: MeetingPerson
  selected: boolean
  onToggle: () => void
  participation?: MeetingParticipation
  loading: boolean
  hasError: boolean
}

export function MeetingMemberOption({ person, selected, onToggle, participation, loading, hasError }: Props) {
  const summary = participation ?? EMPTY_PARTICIPATION
  const tooltipId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const hovered = useRef(false)
  const focused = useRef(false)
  const overPopup = useRef(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const reveal = () => { cancelClose(); setOpen(true) }
  const closeSoon = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      if (!hovered.current && !focused.current && !overPopup.current) setOpen(false)
    }, 150)
  }
  useEffect(() => cancelClose, [cancelClose])

  const updatePosition = useCallback(() => {
    const button = buttonRef.current, popup = popupRef.current
    if (!button || !popup) return
    const anchor = button.getBoundingClientRect(), box = popup.getBoundingClientRect()
    const gap = 8
    const roomOnRight = anchor.right + gap + box.width <= window.innerWidth - 8
    const left = roomOnRight
      ? anchor.right + gap
      : Math.max(8, anchor.left - gap - box.width)
    const top = Math.max(8, Math.min(anchor.top, window.innerHeight - box.height - 8))
    setPosition((previous) => previous.ready && previous.left === left && previous.top === top
      ? previous : { left, top, ready: true })
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
    else setPosition((previous) => previous.ready ? { ...previous, ready: false } : previous)
  }, [open, summary, loading, hasError, updatePosition])

  useEffect(() => {
    if (!open) return
    let frame: number | null = null
    const reposition = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updatePosition)
    }
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      cancelClose()
      hovered.current = focused.current = overPopup.current = false
      setOpen(false)
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    document.addEventListener('keydown', dismiss, true)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      document.removeEventListener('keydown', dismiss, true)
    }
  }, [open, updatePosition, cancelClose])

  const countLabel = loading ? '진행 중 …' : hasError ? '진행 중 확인 불가' : `진행 중 ${summary.count}`
  const detailLabel = loading ? '진행 회의 불러오는 중' : hasError ? '진행 회의 확인 불가' : `진행 중 ${summary.count}건`
  const secondary = selected ? 'text-background/70' : 'text-muted-foreground'
  return <>
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={selected}
      aria-label={`${person.name}${person.position ? ` ${person.position}` : ''} ${detailLabel}`}
      aria-describedby={open ? tooltipId : undefined}
      aria-busy={loading || undefined}
      className={cn('flex w-full flex-col rounded px-1.5 py-1 text-left text-xs transition-colors',
        selected ? 'bg-foreground text-background' : 'hover:bg-muted')}
      onClick={onToggle}
      onFocus={() => { focused.current = true; reveal() }}
      onBlur={() => { focused.current = false; closeSoon() }}
    >
      <span className="font-medium">{person.name}</span>
      {person.position ? <span className={cn('text-[10px]', secondary)}>{person.position}</span> : null}
      <span
        className={cn('text-[10px]', secondary)}
        onPointerEnter={() => { hovered.current = true; reveal() }}
        onPointerLeave={() => { hovered.current = false; closeSoon() }}
      >{countLabel}</span>
    </button>
    {open && typeof document !== 'undefined' ? createPortal(
      <div
        ref={popupRef}
        id={tooltipId}
        role="tooltip"
        className="fixed z-[70] w-72 overflow-y-auto rounded-md border border-border bg-card p-3 text-xs text-foreground shadow-md"
        style={{ left: position.left, top: position.top, maxWidth: 'calc(100vw - 16px)',
          maxHeight: 'min(15rem, calc(100vh - 16px))', visibility: position.ready ? 'visible' : 'hidden' }}
        onPointerEnter={() => { overPopup.current = true; reveal() }}
        onPointerLeave={() => { overPopup.current = false; closeSoon() }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-2 font-medium">{person.name}님의 진행 회의</p>
        {loading ? <p className="text-muted-foreground">회의 정보를 불러오는 중…</p>
          : hasError ? <p className="text-muted-foreground">회의 정보를 불러오지 못했습니다.</p>
            : <>
              <p className="mb-2 text-muted-foreground">진행 중 {summary.count}건</p>
              {summary.visibleMeetings.length > 0 ? <ul className="list-disc space-y-1 pl-4">
                {summary.visibleMeetings.map((meeting) => <li key={meeting.id} className="whitespace-normal [overflow-wrap:anywhere]">{meeting.title}</li>)}
              </ul> : null}
              {summary.count === 0 ? <p className="text-muted-foreground">진행 중인 회의가 없습니다.</p> : null}
              {summary.hiddenCount > 0 ? <p className="mt-2 text-muted-foreground">열람 권한이 없는 회의 {summary.hiddenCount}건</p> : null}
            </>}
      </div>, document.body,
    ) : null}
  </>
}
