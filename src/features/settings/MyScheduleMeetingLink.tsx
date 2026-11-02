import { Link } from 'react-router-dom'
import { MEETING_KIND_TONES, meetingKindLabel } from '@/features/meetings/meeting-kinds'
import { cn } from '@/lib/utils'
import type { MyScheduleMeeting } from './my-schedule-meetings'

export function MyScheduleMeetingLink({ meeting, compact = false }: { meeting: MyScheduleMeeting; compact?: boolean }) {
  const round = meeting.kind === 'project' || meeting.kind === 'routine' ? ` · ${meeting.round}차` : ''
  const caption = `${meeting.start}–${meeting.end} · ${meeting.title}${round}`
  return <Link to={meeting.href} title={`${caption} · ${meetingKindLabel(meeting.kind)} · 호스트 ${meeting.hostName}`} aria-label={`${caption} 회의 보기`}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
    className={cn(compact ? 'block w-full truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-semibold leading-snug' : 'flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm',
      MEETING_KIND_TONES[meeting.kind])}>
    {compact ? `${meeting.start} ${meeting.title}${round}` : <><span className="min-w-0 break-words">{caption}</span><span className="shrink-0 text-xs">{meetingKindLabel(meeting.kind)} · {meeting.isHost ? '호스트' : meeting.kind === 'meeting' ? '참석자' : '참석 가능'}</span></>}
  </Link>
}
