import { cn } from '@/lib/utils'

/** One continuous outline across adjacent cells, without intercepting selection. */
export function MeetingRangeMarker({ start, end, blocked }: { start: boolean; end: boolean; blocked: boolean }) {
  return <span aria-hidden="true" className={cn('pointer-events-none absolute inset-0 z-10 border-y-2',
    blocked ? 'border-danger' : 'border-success', start && 'rounded-l-md border-l-2', end && 'rounded-r-md border-r-2')}/>
}
