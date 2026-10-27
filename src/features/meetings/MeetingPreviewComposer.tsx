import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, LockKeyhole } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { MEETING_DURATION_MINUTES, parseDateKey, toDateKey, type MeetingPerson, type MeetingRoom } from './meeting-schedule'
import { MeetingPreviewDialog, MeetingPreviewTimeline } from './MeetingPreviewTimeline'
import {
  MEETING_KINDS, PREVIEW_CLOCKS, PREVIEW_WEEKDAYS, previewDateLabel, previewPeopleConflicts, previewRecurringDates,
  previewOverlaps, previewSlotProblem, previewTimeLabel, shiftPreviewDay, validPreviewDate, type MeetingKind, type PreviewCandidate, type PreviewMeeting, type PreviewOccurrence,
} from './meeting-ui-preview'

export type PreviewComposeSeed = { date: string; roomId: string; clock: string; project?: PreviewMeeting }

function PreviewDatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7))
  const [year, number] = month.split('-').map(Number)
  const start = new Date(year, number - 1, 1), length = new Date(year, number, 0).getDate()
  const today = toDateKey(new Date())
  function move(offset: number) { setMonth(toDateKey(new Date(year, number - 1 + offset, 1)).slice(0, 7)) }
  return <div className="rounded-xl border border-border p-3">
    <div className="mb-2 flex items-center justify-between">
      <Button type="button" variant="ghost" size="icon" aria-label="이전 달" onClick={() => move(-1)}><ChevronLeft className="size-4" /></Button>
      <span className="text-sm font-semibold">{year}년 {number}월</span>
      <Button type="button" variant="ghost" size="icon" aria-label="다음 달" onClick={() => move(1)}><ChevronRight className="size-4" /></Button>
    </div>
    <div className="grid grid-cols-7 gap-1 text-center">
      {PREVIEW_WEEKDAYS.map(day => <span key={day} className="py-1 text-[10px] text-muted-foreground">{day}</span>)}
      {Array.from({ length: start.getDay() }, (_, index) => <span key={`empty-${index}`} />)}
      {Array.from({ length }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`, weekday = parseDateKey(date).getDay()
        return <button key={date} type="button" disabled={date < today || weekday === 0 || weekday === 6} aria-label={`${date} 선택`} aria-pressed={date === value}
          className={cn('h-8 rounded-md text-xs disabled:text-muted-foreground/40', date === value ? 'bg-primary font-semibold text-primary-foreground' : 'hover:bg-muted')}
          onClick={() => onChange(date)}>{index + 1}</button>
      })}
    </div>
  </div>
}

export function MeetingPreviewComposer({ seed, actor, people, rooms, events, lunch, ready, onRangeChange, onClose, onPreview }: {
  seed: PreviewComposeSeed; actor: MeetingPerson; people: readonly MeetingPerson[]; rooms: readonly MeetingRoom[]
  events: readonly PreviewMeeting[]; lunch?: { start: string; end: string }; ready: boolean
  onRangeChange: (from: string, to: string) => void; onClose: () => void
  onPreview: (rows: PreviewMeeting[], candidate?: PreviewCandidate) => void
}) {
  useRenderWatch('MeetingPreviewComposer')
  const [kind, setKind] = useState<MeetingKind | null>(seed.project ? 'project' : null)
  const [title, setTitle] = useState(seed.project?.title ?? '')
  const [hostId, setHostId] = useState(seed.project?.host.id ?? actor.id)
  const [memberIds, setMemberIds] = useState<string[]>(seed.project?.members.map(person => person.id) ?? [])
  const [memberSearch, setMemberSearch] = useState('')
  const [date, setDate] = useState(seed.date), [clock, setClock] = useState(seed.clock), [roomId, setRoomId] = useState(seed.roomId)
  const [duration, setDuration] = useState(seed.project?.duration ?? 60), [content, setContent] = useState(seed.project?.status === 'preparing' ? seed.project.content : '')
  const [interval, setInterval] = useState(1), [weekday, setWeekday] = useState(Math.min(5, Math.max(1, parseDateKey(seed.date).getDay())))
  const [until, setUntil] = useState(shiftPreviewDay(seed.date, 28))
  const [overrides, setOverrides] = useState<Record<string, Partial<PreviewOccurrence>>>({})
  const [candidate, setCandidate] = useState<PreviewCandidate>({ name: '', contact: '', notes: '' })
  const [acknowledged, setAcknowledged] = useState(''), [error, setError] = useState('')
  const chosenHost = people.find(person => person.id === hostId) ?? actor
  const members = people.filter(person => memberIds.includes(person.id) && person.id !== hostId)
  const attendees = [chosenHost, ...members]
  const occurrences = useMemo<PreviewOccurrence[]>(() => {
    const dates = kind === 'recurring' ? previewRecurringDates(date, until, weekday, interval) : [date]
    return dates.map(day => ({ id: day, date: day, clock, roomId, excluded: false, ...(kind === 'recurring' ? overrides[day] : {}) }))
  }, [kind, date, until, weekday, interval, clock, roomId, overrides])
  const included = occurrences.filter(row => !row.excluded)
  const rangeDays = included.map(row => row.date).concat(date).filter(day => validPreviewDate(day) && validPreviewDate(date) && day >= date && day <= shiftPreviewDay(date, 180)).sort()
  const from = rangeDays[0] ?? seed.date, to = rangeDays[rangeDays.length - 1] ?? seed.date
  useEffect(() => { onRangeChange(from, to) }, [from, to, onRangeChange])
  const conflicts = included.flatMap(row => previewPeopleConflicts(row.date, row.clock, duration, attendees, events).map(conflict => ({ ...conflict, date: row.date })))
  const acknowledgmentKey = JSON.stringify([kind, title, attendees.map(person => person.id), duration, included, conflicts.map(row => [row.key, row.date])])
  function occurrenceProblem(row: PreviewOccurrence) {
    if (kind === 'recurring' && (row.date < date || row.date > until)) return '반복 기간 안에서 날짜를 선택하세요.'
    if (!rooms.some(room => room.id === row.roomId)) return '회의실을 선택하세요.'
    if (included.some(other => other.id !== row.id && other.date === row.date && other.roomId === row.roomId && row.clock && other.clock && previewOverlaps(row.clock, duration, other.clock, duration))) return '다른 회차와 회의실 예약이 겹칩니다.'
    return previewSlotProblem({ ...row, duration, events, lunch })
  }
  const problems = included.map(row => ({ ...row, reason: occurrenceProblem(row) })).filter(row => row.reason)
  const visiblePeople = people.filter(person => person.id !== hostId && `${person.name} ${person.departmentName ?? ''}`.includes(memberSearch.trim()))
  const departments = [...new Set(visiblePeople.map(person => person.departmentName ?? '기타'))]
  const round = seed.project ? seed.project.round + (seed.project.status === 'preparing' ? 0 : 1) : 1
  function updateOccurrence(id: string, patch: Partial<PreviewOccurrence>) { setOverrides(rows => ({ ...rows, [id]: { ...rows[id], ...patch } })) }
  function preview(preparing = false) {
    setError('')
    if (!kind || !title.trim()) { setError('회의 성격과 공개 제목을 입력해 주세요.'); return }
    if (kind === 'project' && !members.length) { setError('프로젝트 회의에 참여할 멤버를 선택해 주세요.'); return }
    if (!preparing && (!ready || !included.length || problems.length)) { setError('예약 날짜·시간을 확인하고 회의실이 겹치는 회차를 변경하거나 제외해 주세요.'); return }
    if (!preparing && conflicts.length && acknowledged !== acknowledgmentKey) { setError('참석자의 겹치는 일정을 확인해 주세요.'); return }
    const seriesId = seed.project?.seriesId ?? `preview-${crypto.randomUUID()}`
    onPreview((preparing ? [{ id: date, date: '', clock: '', roomId: '' }] : included).map((row, index) => ({
      id: `preview-${crypto.randomUUID()}`, seriesId, kind, title: title.trim(), host: chosenHost, members,
      date: row.date, clock: row.clock, duration, roomId: row.roomId, round: round + index, content,
      status: preparing ? 'preparing' : 'in_progress', local: true, responses: members.map(person => ({ profileId: person.id, status: 'pending' })),
    })), kind === 'interview' ? candidate : undefined)
  }
  return <MeetingPreviewDialog title={seed.project ? seed.project.status === 'preparing' ? '일정 확정 미리보기' : '다음 회차 미리보기' : '회의 생성 미리보기'} onClose={onClose} wide>
    <div className="mb-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {MEETING_KINDS.map((item, index) => <button key={item.value} type="button" aria-pressed={kind === item.value} disabled={Boolean(seed.project) && item.value !== 'project'}
        className={cn('rounded-xl border p-3 text-left transition-colors disabled:opacity-40', kind === item.value ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:border-primary/40')}
        onClick={() => { setKind(item.value); setError('') }}>
        <span className="text-[10px] font-semibold text-primary">0{index + 1}</span>
        <p className="mt-1 text-sm font-semibold">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
      </button>)}
    </div>
    {!kind ? <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">어떤 성격의 회의인가요? 위에서 선택해 주세요.</div> : <>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.5fr)]">
        <div className="min-w-0 space-y-4">
          <div><Badge>1. 회의 내용</Badge><p className="mt-2 text-xs text-muted-foreground">{kind === 'project' ? `${round}차 회의 · 준비한 내용을 회차별로 이어갑니다.` : '공개 일정과 참석자에게 공유할 내용을 정합니다.'}</p></div>
          <label className="block space-y-1.5"><span className="text-xs font-medium">공개 제목</span>
            <Input aria-label="공개 제목" value={title} placeholder={kind === 'interview' ? '예: 기획팀 면접' : kind === 'recurring' ? '예: 주간 부서 회의' : '회의 제목을 입력하세요'} onChange={event => setTitle(event.target.value)} />
            <span className="block text-[11px] text-muted-foreground">전 직원에게 표시되는 제목입니다.{kind === 'interview' ? ' 지원자 이름은 넣지 마세요.' : ''}</span>
          </label>
          <label className="block space-y-1.5"><span className="text-xs font-medium">호스트</span><Select aria-label="미리보기 호스트" className="w-full" value={hostId} onChange={event => { setHostId(event.target.value); setMemberIds(ids => ids.filter(id => id !== event.target.value)) }}>
            {people.map(person => <option key={person.id} value={person.id}>{person.name}{person.id === actor.id ? ' · 나' : ''} · {person.departmentName ?? '부서 미지정'}</option>)}
          </Select></label>
          <div className="space-y-2"><div className="flex justify-between text-xs"><span className="font-medium">{kind === 'interview' ? '내부 면접관' : '참석자'}</span><span className="text-muted-foreground">호스트 포함 {attendees.length}명</span></div>
            <Input aria-label="참석자 검색" placeholder="이름 또는 부서 검색" value={memberSearch} onChange={event => setMemberSearch(event.target.value)} />
            <div className="max-h-40 space-y-3 overflow-auto rounded-lg border border-border p-3">
              {departments.map(department => <div key={department}><p className="mb-1 text-[10px] font-semibold text-muted-foreground">{department}</p><div className="flex flex-wrap gap-1.5">{visiblePeople.filter(person => (person.departmentName ?? '기타') === department).map(person => <button key={person.id} type="button" aria-pressed={memberIds.includes(person.id)} aria-label={`${person.name} 참석자 선택`}
                className={cn('rounded-full border px-2.5 py-1 text-xs', memberIds.includes(person.id) ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:bg-muted')}
                onClick={() => setMemberIds(ids => ids.includes(person.id) ? ids.filter(id => id !== person.id) : [...ids, person.id])}>{person.name}</button>)}</div></div>)}
              {!visiblePeople.length && <p className="text-xs text-muted-foreground">검색한 직원이 없습니다.</p>}
            </div>
          </div>
          <label className="block space-y-1.5"><span className="text-xs font-medium">{kind === 'project' ? '이번 회차 준비 내용' : '회의 목적·안내'}</span><Textarea aria-label="회의 목적·안내" rows={3} value={content} onChange={event => setContent(event.target.value)} placeholder="참석자에게 공유할 내용을 적어 주세요." /><span className="text-[11px] text-muted-foreground">회의 내용은 호스트와 참석자에게만 표시됩니다.</span></label>
          <Button type="button" variant="outline" size="sm" disabled>자료 첨부 · 연결 예정</Button>
          {kind === 'interview' && <section aria-label="비공개 지원자 정보" className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><LockKeyhole className="size-4" />지원자 정보 <Badge>비공개</Badge></h3>
            <p className="text-xs text-muted-foreground">호스트·내부 면접관용 영역입니다. 회의실 일정에는 표시하지 않습니다.</p>
            <Input aria-label="지원자 이름" placeholder="지원자 이름" value={candidate.name} onChange={event => setCandidate(row => ({ ...row, name: event.target.value }))} />
            <Input aria-label="지원자 연락처" placeholder="연락처" value={candidate.contact} onChange={event => setCandidate(row => ({ ...row, contact: event.target.value }))} />
            <Textarea aria-label="면접 메모" placeholder="면접 메모" rows={2} value={candidate.notes} onChange={event => setCandidate(row => ({ ...row, notes: event.target.value }))} />
            <p className="text-[11px] text-muted-foreground">화면 검수용으로 실제 개인정보 대신 예시를 입력해 주세요. 미리보기를 종료하면 초기화됩니다.</p>
          </section>}
        </div>
        <div className="min-w-0 space-y-4">
          <div><Badge>2. 일정 선택</Badge><p className="mt-2 text-xs text-muted-foreground">달력에서 날짜를 고른 뒤 회의실의 빈 시간을 누르세요.</p></div>
          <div className="grid gap-4 sm:grid-cols-[minmax(200px,1fr)_1fr]">
            <PreviewDatePicker value={date} onChange={value => { setDate(value); setClock('') }} />
            <div className="space-y-3">
              <label className="block space-y-1.5"><span className="text-xs font-medium">회의 시간</span><Select aria-label="미리보기 회의 시간" className="w-full" value={duration} onChange={event => setDuration(Number(event.target.value))}>{MEETING_DURATION_MINUTES.map(value => <option key={value} value={value}>{value}분</option>)}</Select></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium">회의실</span><Select aria-label="미리보기 회의실" className="w-full" value={roomId} onChange={event => setRoomId(event.target.value)}>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></label>
              <p className="flex items-center gap-1 text-sm font-semibold"><CalendarDays className="size-4 text-primary" />{previewDateLabel(date)}</p>
              <p className="text-sm tabular-nums text-primary">{clock ? previewTimeLabel({ clock, duration }) : '아래 시간표에서 선택'}</p>
              <p className="text-[11px] text-muted-foreground">{lunch ? `점심 ${lunch.start}–${lunch.end} · 중복 예약 선택 불가` : '점심시간을 불러오는 중입니다.'}</p>
            </div>
          </div>
          <MeetingPreviewTimeline compact rooms={rooms} events={events} date={date} lunch={lunch} ready={ready} duration={duration} selected={{ roomId, clock }} onPick={(room, time) => { setRoomId(room); setClock(time) }} />
          {kind === 'recurring' && <section className="space-y-3 rounded-xl border border-border p-4" aria-label="반복 일정 설정">
            <h3 className="text-sm font-semibold">반복 일정</h3>
            <div className="grid grid-cols-3 gap-2">
              <label className="space-y-1 text-xs">반복<Select aria-label="반복 주기" className="w-full" value={interval} onChange={event => setInterval(Number(event.target.value))}><option value={1}>매주</option><option value={2}>격주</option></Select></label>
              <label className="space-y-1 text-xs">요일<Select aria-label="반복 요일" className="w-full" value={weekday} onChange={event => setWeekday(Number(event.target.value))}>{PREVIEW_WEEKDAYS.map((day, index) => index > 0 && index < 6 ? <option key={day} value={index}>{day}요일</option> : null)}</Select></label>
              <label className="min-w-0 space-y-1 text-xs">종료일<Input aria-label="반복 종료일" type="date" className="w-full" min={date} max={shiftPreviewDay(date, 180)} value={until} onChange={event => setUntil(event.target.value)} /></label>
            </div>
            <p className="text-xs text-muted-foreground">최대 6개월 · 각 회차의 날짜·시간·회의실을 바꾸거나 제외할 수 있습니다. {included.length}회 선택</p>
            {!occurrences.length ? <p className="text-xs text-danger">시작일 이후, 6개월 이내의 종료일을 선택해 주세요.</p> : <div className="max-h-64 space-y-2 overflow-auto">{occurrences.map((row, index) => {
              const reason = occurrenceProblem(row)
              return <div key={row.id} className={cn('space-y-2 rounded-lg border border-border p-2', row.excluded && 'opacity-50')}>
                <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" checked={!row.excluded} onChange={event => updateOccurrence(row.id, { excluded: !event.target.checked })} />{index + 1}회 · {previewDateLabel(row.date)}{row.excluded ? ' · 제외' : ''}</label>
                <div className="grid grid-cols-3 gap-2">
                  <Input type="date" aria-label={`${index + 1}회 날짜`} min={date} max={until} disabled={row.excluded} value={row.date} onChange={event => updateOccurrence(row.id, { date: event.target.value })} />
                  <Select aria-label={`${index + 1}회 시간`} disabled={row.excluded} value={row.clock} onChange={event => updateOccurrence(row.id, { clock: event.target.value })}><option value="">시간 선택</option>{PREVIEW_CLOCKS.map(time => <option key={time} value={time}>{time}</option>)}</Select>
                  <Select aria-label={`${index + 1}회 회의실`} disabled={row.excluded} value={row.roomId} onChange={event => updateOccurrence(row.id, { roomId: event.target.value })}>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</Select>
                </div>
                {!row.excluded && reason && <p className="text-xs text-danger">{reason}</p>}
              </div>
            })}</div>}
          </section>}
          <section className="space-y-2 rounded-xl border border-border bg-muted/30 p-3" aria-label="참석자 일정 확인">
            <h3 className="text-xs font-semibold">참석자 일정 확인</h3>
            <p className="text-[11px] text-muted-foreground">현재 조회 가능한 회의와 미리보기 일정을 비교합니다. 휴가·외근 등 전체 일정 확인은 실제 예약 연결 시 적용됩니다.</p>
            {!clock ? <p className="text-xs text-muted-foreground">시간을 선택하면 겹치는 일정을 표시합니다.</p> : !conflicts.length ? <p className="text-xs">조회된 회의 중 겹치는 일정이 없습니다.</p> : <>
              <ul className="max-h-32 space-y-1 overflow-auto text-xs text-danger">{conflicts.map(row => <li key={`${row.date}:${row.key}`}>{row.person.name} · {previewDateLabel(row.date)} · {previewTimeLabel(row.meeting)} · 다른 회의</li>)}</ul>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={acknowledged === acknowledgmentKey} onChange={event => setAcknowledged(event.target.checked ? acknowledgmentKey : '')} />겹치는 일정을 확인했습니다.</label>
            </>}
          </section>
        </div>
      </div>
      <div className="mt-5 space-y-3 border-t border-border pt-4">
        {clock && problems.length > 0 && <p className="text-xs text-danger">{validPreviewDate(problems[0].date) ? previewDateLabel(problems[0].date) : '날짜 확인'} · {problems[0].reason}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">{title || '회의 제목'} {kind === 'recurring' ? `· ${included.length}회` : ''}</p><p className="mt-1 text-xs text-muted-foreground">미리보기 목록·시간표에만 추가됩니다. 실제 참석 요청은 발송하지 않습니다.</p></div>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button>{kind === 'project' && <Button type="button" variant="outline" onClick={() => preview(true)}>준비 중 미리보기</Button>}<Button type="button" onClick={() => preview()}>예약 미리보기</Button></div>
        </div>
      </div>
    </>}
  </MeetingPreviewDialog>
}
