import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, LockKeyhole, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { cn } from '@/lib/utils'
import { MEETING_DURATION_MINUTES, parseDateKey, toDateKey, type MeetingPerson, type MeetingRoom } from './meeting-schedule'
import { MeetingPreviewDialog, MeetingPreviewTimeline } from './MeetingPreviewTimeline'
import {
  MEETING_KINDS, PREVIEW_WEEKDAYS, previewDateLabel, previewHasRounds, previewPeopleConflicts,
  previewSlotProblem, previewTimeLabel, validPreviewDate, type MeetingKind, type PreviewCandidate, type PreviewMeeting,
} from './meeting-ui-preview'

export type PreviewComposeSeed = { date: string; roomId: string; clock: string; project?: PreviewMeeting }

function PreviewDatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [month, setMonth] = useState(value.slice(0, 7))
  const [year, number] = month.split('-').map(Number)
  const start = new Date(year, number - 1, 1), length = new Date(year, number, 0).getDate()
  const today = toDateKey(new Date())
  function move(offset: number) { setMonth(toDateKey(new Date(year, number - 1 + offset, 1)).slice(0, 7)) }
  return <div className="rounded-lg border border-border p-3">
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
  const [kind, setKind] = useState<MeetingKind>(seed.project?.kind ?? 'project')
  const [title, setTitle] = useState(seed.project?.title ?? '')
  const [hostId, setHostId] = useState(seed.project?.host.id ?? actor.id)
  const [memberIds, setMemberIds] = useState<string[]>(seed.project?.members.map(person => person.id) ?? [])
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  const [scheduleNow, setScheduleNow] = useState(Boolean(seed.project || seed.clock))
  const [date, setDate] = useState(seed.date), [clock, setClock] = useState(seed.clock), [roomId, setRoomId] = useState(seed.roomId)
  const [recordDate, setRecordDate] = useState(toDateKey(new Date()))
  const [duration, setDuration] = useState(seed.project?.duration ?? 60)
  const [content, setContent] = useState(seed.project?.status === 'preparing' ? seed.project.content : '')
  const [result, setResult] = useState(seed.project?.status === 'preparing' ? seed.project.result : '')
  const [candidate, setCandidate] = useState<PreviewCandidate>({ name: '', contact: '', notes: '' })
  const [acknowledged, setAcknowledged] = useState(''), [error, setError] = useState('')
  const recordOnly = kind === 'meeting', hasRounds = previewHasRounds(kind)
  const chosenHost = people.find(person => person.id === hostId) ?? actor
  const members = people.filter(person => memberIds.includes(person.id) && person.id !== hostId)
  const attendees = [chosenHost, ...members]
  const round = seed.project ? seed.project.round + (seed.project.status === 'preparing' ? 0 : 1) : 1
  const conflicts = !recordOnly && scheduleNow ? previewPeopleConflicts(date, clock, duration, attendees, events) : []
  const acknowledgmentKey = JSON.stringify([kind, attendees.map(person => person.id), date, clock, roomId, duration, conflicts.map(row => row.key)])
  const problem = !recordOnly && scheduleNow ? previewSlotProblem({ date, clock, roomId, duration, events, lunch }) : null
  const departments = [...new Set(people.filter(person => person.id !== hostId).map(person => person.departmentName ?? '기타'))]
  useEffect(() => { if (!recordOnly && scheduleNow && validPreviewDate(date)) onRangeChange(date, date) }, [date, recordOnly, scheduleNow, onRangeChange])
  function toggleMember(id: string) { setMemberIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]) }
  function submit() {
    setError('')
    if (!title.trim()) { setError(recordOnly ? '미팅명을 입력해 주세요.' : '회의 주제를 입력해 주세요.'); return }
    if (hasRounds && !members.length) { setError('함께할 멤버를 선택해 주세요.'); return }
    if (recordOnly && (!validPreviewDate(recordDate) || recordDate > toDateKey(new Date()))) { setError('미팅을 진행한 날짜를 확인해 주세요.'); return }
    if (!recordOnly && scheduleNow && (!ready || problem || !rooms.some(room => room.id === roomId))) { setError(problem ?? '일정 정보를 확인한 뒤 다시 선택해 주세요.'); return }
    if (conflicts.length && acknowledged !== acknowledgmentKey) { setError('멤버의 겹치는 일정을 확인해 주세요.'); return }
    const item: PreviewMeeting = {
      id: `preview-${crypto.randomUUID()}`, seriesId: seed.project?.seriesId ?? `preview-${crypto.randomUUID()}`, kind,
      title: title.trim(), host: chosenHost, members, date: recordOnly ? recordDate : scheduleNow ? date : '',
      clock: !recordOnly && scheduleNow ? clock : '', duration, roomId: !recordOnly && scheduleNow ? roomId : '',
      round, content: recordOnly ? '' : content, result: recordOnly ? '' : result, local: true,
      status: recordOnly ? 'done' : scheduleNow ? 'in_progress' : 'preparing',
      responses: members.map(person => ({ profileId: person.id, status: 'pending' })),
    }
    onPreview([item], kind === 'interview' ? candidate : undefined)
  }
  return <MeetingPreviewDialog title={seed.project ? seed.project.status === 'preparing' ? '회의 일정 확정 미리보기' : '다음 회차 미리보기' : '회의 생성 미리보기'} onClose={onClose} wide={scheduleNow && !recordOnly}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="w-40 space-y-1"><span className="text-xs font-medium">회의 성격</span><Select aria-label="회의 성격" className="w-full" value={kind} disabled={Boolean(seed.project)} onChange={event => { setKind(event.target.value as MeetingKind); setError('') }}>{MEETING_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>
        <label className="min-w-0 flex-[2] basis-60 space-y-1"><span className="text-xs font-medium">{recordOnly ? '미팅명' : kind === 'interview' ? '공개 예약 제목' : '회의 주제'}</span><Input aria-label="회의 주제" value={title} placeholder={kind === 'interview' ? '예: 기획팀 면접' : kind === 'routine' ? '예: 운영 회의' : '주제를 입력하세요'} onChange={event => setTitle(event.target.value)} /></label>
        <label className="w-56 space-y-1"><span className="text-xs font-medium">호스트</span><Select aria-label="미리보기 호스트" className="w-full" value={hostId} onChange={event => { setHostId(event.target.value); setMemberIds(ids => ids.filter(id => id !== event.target.value)) }}>{people.map(person => <option key={person.id} value={person.id}>{person.name}{person.id === actor.id ? ' · 나' : ''}</option>)}</Select></label>
      </div>
      <p className="text-xs text-muted-foreground">{MEETING_KINDS.find(item => item.value === kind)!.hint}{kind === 'routine' ? ' 반복 요일·종료일은 정하지 않습니다.' : ''}</p>
      <div className="space-y-1.5"><p className="text-xs font-medium">{kind === 'interview' ? '내부 면접관' : '멤버'}</p>
        <div className="flex min-h-9 items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{members.length ? members.map(person => <span key={person.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">{person.name}<button type="button" aria-label={`${person.name} 빼기`} onClick={() => toggleMember(person.id)}><X className="size-3" /></button></span>) : <span className="text-sm text-muted-foreground">부서에서 멤버 추가</span>}</div>
          <button type="button" aria-label="미리보기 멤버 목록 열기" aria-expanded={memberPickerOpen} onClick={() => setMemberPickerOpen(open => !open)}><ChevronDown className={cn('size-4', memberPickerOpen && 'rotate-180')} /></button>
        </div>
        {memberPickerOpen && <div className="max-h-56 overflow-auto rounded-md border border-border p-2"><div className="flex min-w-full">{departments.map((department, index) => {
          const rows = people.filter(person => person.id !== hostId && (person.departmentName ?? '기타') === department)
          return <div key={department} className={cn('min-w-[8.5rem] flex-1 px-3', index > 0 && 'border-l border-border')}>
            <button type="button" className="mb-1 text-xs font-medium" onClick={() => setMemberIds(ids => rows.every(person => ids.includes(person.id)) ? ids.filter(id => !rows.some(person => person.id === id)) : [...new Set([...ids, ...rows.map(person => person.id)])])}>{department}</button>
            {rows.map(person => <label key={person.id} className="flex items-center gap-2 py-1 text-xs"><input type="checkbox" aria-label={`${person.name} 참석자 선택`} checked={memberIds.includes(person.id)} onChange={() => toggleMember(person.id)} />{person.name}</label>)}
          </div>
        })}</div></div>}
      </div>
      {recordOnly ? <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3"><label className="block max-w-56 space-y-1"><span className="text-xs font-medium">미팅 날짜</span><Input type="date" aria-label="미팅 날짜" max={toDateKey(new Date())} value={recordDate} onChange={event => setRecordDate(event.target.value)} /></label><p className="text-xs text-muted-foreground">미팅을 했다는 기록만 남깁니다. 회의록·결과 입력과 회의실 예약은 하지 않습니다.</p></div> : <>
        <label className="block space-y-1"><span className="text-xs font-medium">{hasRounds ? `${round}차 준비 내용` : '회의 내용·안내'}</span><Textarea aria-label="회의 내용·안내" rows={3} value={content} onChange={event => setContent(event.target.value)} placeholder="멤버와 공유할 내용을 적어 주세요." /></label>
        {kind === 'one_off' && <label className="block space-y-1"><span className="text-xs font-medium">회의 결과·기록</span><Textarea aria-label="회의 결과·기록" rows={3} value={result} onChange={event => setResult(event.target.value)} placeholder="회의 후 결정 사항과 기록을 남기는 공간입니다." /></label>}
        {kind === 'interview' && <section aria-label="비공개 지원자 정보" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"><p className="flex items-center gap-1 text-xs font-medium"><LockKeyhole className="size-3" />지원자 정보 · 호스트·면접관용</p><p className="text-[11px] text-muted-foreground">공개 제목에는 지원자 이름을 넣지 마세요. 아래 정보는 회의실 일정에 표시하지 않습니다.</p><div className="grid gap-2 sm:grid-cols-2"><Input aria-label="지원자 이름" placeholder="지원자 이름 · 예시만 입력" value={candidate.name} onChange={event => setCandidate(row => ({ ...row, name: event.target.value }))} /><Input aria-label="지원자 연락처" placeholder="연락처" value={candidate.contact} onChange={event => setCandidate(row => ({ ...row, contact: event.target.value }))} /></div><Textarea aria-label="면접 메모" placeholder="면접 메모" value={candidate.notes} onChange={event => setCandidate(row => ({ ...row, notes: event.target.value }))} /></section>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="지금 일정 정하기" checked={scheduleNow} onChange={event => setScheduleNow(event.target.checked)} />지금 일정 정하기<span className="text-xs text-muted-foreground">선택하지 않으면 준비 중으로 추가</span></label>
        {scheduleNow && <section className="space-y-3 border-t border-border pt-3">
          <div className="grid items-start gap-4 md:grid-cols-[16rem_minmax(0,1fr)]"><PreviewDatePicker value={date} onChange={value => { setDate(value); setClock('') }} /><div className="space-y-3"><div className="flex flex-wrap items-end gap-3"><label className="space-y-1"><span className="text-xs font-medium">회의 시간</span><Select aria-label="미리보기 회의 시간" value={duration} onChange={event => setDuration(Number(event.target.value))}>{MEETING_DURATION_MINUTES.map(value => <option key={value} value={value}>{value}분</option>)}</Select></label><label className="space-y-1"><span className="text-xs font-medium">회의실</span><Select aria-label="미리보기 회의실" value={roomId} onChange={event => setRoomId(event.target.value)}>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</Select></label></div><p className="text-sm">{previewDateLabel(date)} · {clock ? previewTimeLabel({ clock, duration }) : '아래 시간표에서 빈 시간을 선택하세요.'}</p><p className="text-xs text-muted-foreground">{lunch ? `점심 ${lunch.start}–${lunch.end} · 회의실 중복 예약 불가` : '점심시간 확인 중'}</p><p className="text-xs text-muted-foreground">현재 계정이 조회할 수 있는 예약 기준의 미리보기입니다.</p></div></div>
          <MeetingPreviewTimeline compact rooms={rooms} events={events} date={date} lunch={lunch} ready={ready} duration={duration} selected={{ roomId, clock }} onPick={(room, time) => { setRoomId(room); setClock(time) }} />
          <p className="text-[11px] text-muted-foreground">멤버 일정은 조회된 회의만 비교합니다. 휴가·외근 등 전체 일정 확인은 실제 연결 시 적용됩니다.</p>
          {conflicts.length > 0 && <div className="space-y-2 rounded-lg border border-warning/30 p-3"><ul className="space-y-1 text-xs text-danger">{conflicts.map(row => <li key={row.key}>{row.person.name} · {previewTimeLabel(row.meeting)} · 다른 회의</li>)}</ul><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={acknowledged === acknowledgmentKey} onChange={event => setAcknowledged(event.target.checked ? acknowledgmentKey : '')} />겹치는 일정을 확인했습니다.</label></div>}
          {clock && problem && <p className="text-xs text-danger">{problem}</p>}
        </section>}
      </>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3"><p className="text-xs text-muted-foreground">화면에서만 추가됩니다. 실제 저장·알림은 발생하지 않습니다.</p><div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>취소</Button><Button type="button" onClick={submit}>{recordOnly ? '미팅 기록 미리보기' : scheduleNow ? '일정 확정 미리보기' : '준비 회의 생성 미리보기'}</Button></div></div>
    </div>
  </MeetingPreviewDialog>
}
