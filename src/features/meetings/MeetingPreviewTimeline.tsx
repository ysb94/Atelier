import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { availabilityMinutes } from './meeting-availability'
import type { MeetingRoom } from './meeting-schedule'
import { PREVIEW_CLOCKS, previewCalendarMeetings, previewKindLabel, previewOverlaps, previewSlotProblem, previewTimeLabel, type MeetingKind, type PreviewMeeting } from './meeting-ui-preview'

/** native dialog의 포커스 잠금·Escape·배경 차단을 사용하며 실제 업무 팝업과 연결하지 않는다. */
export function MeetingPreviewDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-label={title} onCancel={event => { event.preventDefault(); onClose() }}
    className={cn('fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-2rem)] overflow-auto rounded-xl border border-border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/40', wide ? 'max-w-[1500px]' : 'max-w-2xl')}>
    <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-card px-5 py-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <Button type="button" size="icon" variant="ghost" aria-label="미리보기 창 닫기" onClick={onClose}><X className="size-4" /></Button>
    </div>
    <div className="p-4 sm:p-5">{children}</div>
  </dialog>
}

export function MeetingPreviewTimeline({ rooms, events, date, lunch, ready, compact = false, duration = 30, selected, kindFilter = 'all',
  onPick, onOpen }: {
  rooms: readonly MeetingRoom[]; events: readonly PreviewMeeting[]; date: string
  lunch?: { start: string; end: string }; ready: boolean; compact?: boolean; duration?: number
  selected?: { roomId: string; clock: string }
  kindFilter?: MeetingKind | 'all'
  onPick: (roomId: string, clock: string) => void; onOpen?: (item: PreviewMeeting) => void
}) {
  const slotHeight = compact ? 25 : 34
  const current = previewCalendarMeetings(events).filter(item => item.date === date)
  return <div className="min-w-0 overflow-x-auto rounded-xl border border-border">
    <div className={cn('grid', compact ? 'min-w-[470px]' : 'min-w-[560px]')} style={{ gridTemplateColumns: `3.5rem repeat(${Math.max(1, rooms.length)}, minmax(0, 1fr))` }}>
      <div className="border-b border-border bg-primary px-2 py-3 text-xs text-primary-foreground">시간</div>
      {rooms.map(room => <div key={room.id} className="border-b border-l border-border bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground">{room.name}</div>)}
      <div className="relative bg-muted/40" style={{ height: slotHeight * PREVIEW_CLOCKS.length }}>
        {PREVIEW_CLOCKS.map(clock => <div key={clock} className="px-2 pt-1 text-[10px] tabular-nums text-muted-foreground" style={{ height: slotHeight }}>{clock.endsWith(':00') ? clock : ''}</div>)}
      </div>
      {rooms.map(room => <div key={room.id} className="relative border-l border-border" style={{ height: slotHeight * PREVIEW_CLOCKS.length }}>
        {PREVIEW_CLOCKS.map(clock => {
          const problem = ready ? previewSlotProblem({ date, clock, roomId: room.id, duration, events, lunch }) : '일정 정보를 불러온 뒤 선택할 수 있습니다.'
          const occupied = current.some(item => item.roomId === room.id && previewOverlaps(clock, 30, item.clock, item.duration))
          const atLunch = lunch && previewOverlaps(clock, 30, lunch.start, availabilityMinutes(lunch.end) - availabilityMinutes(lunch.start))
          const chosen = selected?.roomId === room.id && selected.clock && previewOverlaps(clock, 30, selected.clock, duration)
          return <button key={clock} type="button" disabled={Boolean(problem)} aria-label={`${room.name} ${clock} 선택`} aria-pressed={Boolean(chosen)}
            title={problem ?? `${clock}부터 선택`} onClick={() => onPick(room.id, clock)}
            className={cn('block w-full border-b border-border/60 text-xs transition-colors disabled:cursor-not-allowed',
              chosen ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary' : atLunch || !ready ? 'bg-muted text-muted-foreground' : occupied ? 'bg-primary/5' : 'bg-card hover:bg-primary/5',
              problem && !occupied && !atLunch && 'bg-muted/40 text-muted-foreground')}
            style={{ height: slotHeight }}>{atLunch && clock === lunch?.start ? '점심시간' : chosen && clock === selected?.clock ? '선택한 시간' : null}</button>
        })}
        {current.filter(item => item.roomId === room.id).map(item => {
          const start = Math.max(540, availabilityMinutes(item.clock)), end = Math.min(1140, availabilityMinutes(item.clock) + item.duration)
          if (end <= start) return null
          const matches = kindFilter === 'all' || item.kind === kindFilter
          return <button key={item.id} type="button" aria-label={`${matches ? item.title : '다른 성격'} 예약 보기`} onClick={() => onOpen?.(item)} disabled={!onOpen || !matches}
            title={`${previewKindLabel(item.kind)} · ${item.title} · ${previewTimeLabel(item)} · ${item.host.name}`}
            className={cn('absolute inset-x-1 overflow-hidden rounded-md border border-primary/30 bg-card px-2 text-left shadow-sm', onOpen && 'hover:border-primary', item.local && 'border-dashed', !matches && 'border-border bg-muted text-muted-foreground')}
            style={{ top: (start - 540) / 30 * slotHeight + 1, height: (end - start) / 30 * slotHeight - 2 }}>
            <div className="flex items-center gap-1.5 text-xs"><span className="shrink-0 font-medium text-primary">{previewKindLabel(item.kind)}</span><span className="truncate font-semibold">{matches ? item.title : '다른 성격의 예약'}</span></div>
            {end - start >= 60 && <p className="mt-1 truncate text-[10px] text-muted-foreground">{previewTimeLabel(item)}{matches ? ` · ${item.host.name}` : ''}</p>}
          </button>
        })}
      </div>)}
    </div>
  </div>
}
