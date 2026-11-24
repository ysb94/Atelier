import { useEffect, useState } from 'react'
import type { PersonalWorkCard, PersonalWorkEvent } from '@/lib/supabase/personal-work'

const eventLabels: Record<PersonalWorkEvent['kind'], string> = {
  started: '시작', resumed: '재개', paused: '일시정지', submitted: '피드백 요청',
  approved: '승인', revision_requested: '수정 요청', completed: '완료',
}
const dateFormat = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const dayFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short' })

function duration(milliseconds: number) {
  const minutes = Math.floor(milliseconds / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours) return `${hours}시간 ${minutes % 60}분`
  if (minutes) return `${minutes}분`
  return milliseconds > 0 ? '1분 미만' : '0분'
}

function summarize(events: PersonalWorkEvent[], now: number) {
  let work = 0, wait = 0
  let workStart: number | undefined, waitStart: number | undefined
  for (const event of events) {
    const at = Date.parse(event.at)
    switch (event.kind) {
      case 'started':
      case 'resumed':
        workStart = at
        break
      case 'paused':
      case 'submitted':
      case 'completed':
        if (workStart !== undefined) work += Math.max(0, at - workStart)
        workStart = undefined
        if (event.kind === 'submitted') waitStart = at
        break
      case 'approved':
      case 'revision_requested':
        if (waitStart !== undefined) wait += Math.max(0, at - waitStart)
        waitStart = undefined
        break
    }
  }
  if (workStart !== undefined) work += Math.max(0, now - workStart)
  if (waitStart !== undefined) wait += Math.max(0, now - waitStart)
  return { work, wait }
}

export function MyWorkCardHistory({ card }: { card: PersonalWorkCard }) {
  const [now, setNow] = useState(() => Date.now())
  const timing = card.status === 'doing' || card.status === 'feedback'
  useEffect(() => {
    if (!timing) return
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [timing])

  const rounds = new Map<number, PersonalWorkEvent[]>()
  for (const event of card.events) {
    const events = rounds.get(event.round) ?? []
    events.push(event)
    rounds.set(event.round, events)
  }
  if (!rounds.has(card.round)) rounds.set(card.round, [])
  const history = [...rounds].reverse().map(([round, events]) => ({ round, events, ...summarize(events, now) }))
  const total = history.reduce((sum, entry) => ({ work: sum.work + entry.work, wait: sum.wait + entry.wait }), { work: 0, wait: 0 })
  const latest = card.events.at(-1)
  const carriedOver = card.status === 'doing' && latest && dayFormat.format(Date.parse(latest.at)) !== dayFormat.format(now)

  return <section aria-label="차수별 업무 기록" className="space-y-3 border-t border-border pt-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold">차수별 기록</h3>
      <div className="text-xs tabular-nums text-muted-foreground">총 진행 {duration(total.work)} · 총 피드백 대기 {duration(total.wait)}</div>
    </div>
    {carriedOver && <p className="text-xs text-warning">이전 날짜에 시작한 업무가 아직 진행 중입니다. 작업을 멈췄다면 일시정지해 주세요.</p>}
    {history.map(({ round, events, work, wait }) => <div key={round} className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <h4 className="font-medium">{round}차</h4>
        <div className="text-xs tabular-nums text-muted-foreground">진행 {duration(work)} · 피드백 대기 {duration(wait)}</div>
      </div>
      {events.length ? <ol className="mt-3 space-y-2">
        {events.map((event, index) => <li key={`${event.kind}-${index}`} className="text-sm">
          <span>{eventLabels[event.kind]}</span>
          <time dateTime={event.at} className="ml-2 text-xs tabular-nums text-muted-foreground">{dateFormat.format(new Date(event.at))}</time>
          {event.note && <p className="mt-1 wrap-anywhere whitespace-pre-wrap text-muted-foreground">{event.note}</p>}
        </li>)}
      </ol> : <p className="mt-2 text-xs text-muted-foreground">시작 전</p>}
    </div>)}
  </section>
}
