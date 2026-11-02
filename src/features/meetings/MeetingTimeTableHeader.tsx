import { availabilityMinutes } from './meeting-availability'
import './meeting-time-axis.css'

/** Each label marks a boundary; the half-hour slot begins to its right. */
export function MeetingTimeTableHeader({ label, clocks, onPreview }: { label: string; clocks: readonly string[]; onPreview?: (clock: string) => void }) {
  const last = clocks.at(-1)
  const endMinutes = last ? availabilityMinutes(last) + 30 : null
  const endClock = endMinutes === null ? '' : `${String(Math.floor(endMinutes / 60)).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`
  return <thead><tr>
    <th scope="col" className="w-24 bg-muted p-2 text-left">{label}</th>
    {clocks.map((clock, index) => <th key={clock} scope="col" aria-label={`${clock}–${clocks[index + 1] ?? endClock}`} onPointerEnter={event=>{if(event.pointerType!=='touch')onPreview?.(clock)}} className="meeting-time-axis-cell bg-muted font-normal tabular-nums">
      <span className="meeting-time-axis-label bg-muted">{clock}</span>
      <span aria-hidden="true" className="meeting-time-axis-tick border-primary/60"/>
      {index === clocks.length - 1 && <>
        <span aria-hidden="true" className="meeting-time-axis-label is-end bg-muted">{endClock}</span>
        <span aria-hidden="true" className="meeting-time-axis-tick is-end border-primary/60"/>
      </>}
    </th>)}
  </tr></thead>
}
