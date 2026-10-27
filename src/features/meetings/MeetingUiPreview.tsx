import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LockKeyhole, MessageCircle } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
// 미리보기에서는 조회 함수만 사용한다. 모든 기록·응답·대화 동작은 React 상태에만 반영한다.
import { listCompanyMeetings, listMeetingCalendar, listMeetingDirectory, listMeetingRooms } from '@/lib/supabase/meetings'
import { cn, emptyList } from '@/lib/utils'
import { MeetingAttendance, MeetingResponse } from './MeetingAttendance'
import { MeetingPreviewComposer, type PreviewComposeSeed } from './MeetingPreviewComposer'
import { MeetingPreviewDialog } from './MeetingPreviewTimeline'
import { quarterFromTime } from './meeting-slots'
import {
  chunkMeetingDays, groupMeetingsByRoomDay, listMeetingDays, profileToMeetingPerson, toDateKey,
  type MeetingDay, type MeetingDraft, type MeetingPerson, type MeetingRoom, type MeetingSeries,
} from './meeting-schedule'
import {
  MEETING_KINDS, existingPreviewMeetings, isPreviewParticipant, previewCalendarMeetings, previewDateLabel,
  previewHasRounds, previewKindLabel, previewTimeLabel, shiftPreviewDay, type MeetingKind, type PreviewCandidate, type PreviewMeeting, type PreviewResponse,
} from './meeting-ui-preview'

export type MeetingPreviewCalendarProps = {
  rooms: readonly MeetingRoom[]; roomId: string; weeks: MeetingDay[][]; occupants: Map<string, MeetingDraft[]>
  onSelectRoom: (id: string) => void; onShiftRange: (direction: -1 | 1) => void
}
type PreviewEdit = Partial<Pick<PreviewMeeting, 'content' | 'result' | 'finished' | 'status'>>

function previewRound(item: PreviewMeeting, actorId: string, response?: PreviewResponse) {
  return { id: item.id, round: item.round, roomId: item.roomId, startsAt: item.date && item.clock ? `${item.date}T${item.clock}` : '', durationMinutes: item.duration,
    confirmed: item.status !== 'preparing', quarterId: quarterFromTime(item.clock), content: item.content, result: item.result, prepMaterials: [],
    responses: response ? [...item.responses.filter(row => row.profileId !== actorId), { profileId: actorId, status: response }] : item.responses }
}

function PreviewNotes({ item, editable, onSave }: { item: PreviewMeeting; editable: boolean; onSave: (content: string, result: string, finish: boolean) => void }) {
  const [content, setContent] = useState(item.content), [result, setResult] = useState(item.result)
  return <div className="space-y-3">
    <label className="block space-y-1"><span className="text-xs font-medium">회의 내용·안내</span><Textarea aria-label="상세 회의 내용" rows={4} readOnly={!editable} value={content} onChange={event => setContent(event.target.value)} /></label>
    <label className="block space-y-1"><span className="text-xs font-medium">회의 결과·기록</span><Textarea aria-label="상세 회의 결과" rows={4} readOnly={!editable} value={result} onChange={event => setResult(event.target.value)} /></label>
    {editable && <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onSave(content, result, false)}>기록 미리보기</Button>{item.status !== 'preparing' && <Button type="button" size="sm" onClick={() => onSave(content, result, true)}>{previewHasRounds(item.kind) ? '회차 완료 미리보기' : '회의 완료 미리보기'}</Button>}</div>}
  </div>
}

export function MeetingUiPreview({ renderCalendar }: { renderCalendar: (props: MeetingPreviewCalendarProps) => ReactNode }) {
  useRenderWatch('MeetingUiPreview')
  const { profile } = useAuth(), preview = usePagePreview(), active = useWorkspaceTabActivity()
  const real = preview?.realProfile ?? profile
  const actor = useMemo(() => profile ? profileToMeetingPerson(profile) : { id: '', name: '나' }, [profile])
  const today = toDateKey(new Date())
  const [date, setDate] = useState(today)
  const days = useMemo(() => listMeetingDays(date, 10, today), [date, today])
  const weeks = useMemo(() => chunkMeetingDays(days), [days])
  const [range, setRange] = useState(() => ({ from: days[0]?.key ?? date, to: days[days.length - 1]?.key ?? date }))
  const [roomId, setRoomId] = useState(''), [kind, setKind] = useState<MeetingKind | 'all'>('all')
  const [boardTab, setBoardTab] = useState<'in_progress' | 'done'>('in_progress'), [mineOnly, setMineOnly] = useState(false)
  const [local, setLocal] = useState<PreviewMeeting[]>([]), [replaced, setReplaced] = useState<string[]>([])
  const [edits, setEdits] = useState<Record<string, PreviewEdit>>({})
  const [candidates, setCandidates] = useState<Record<string, PreviewCandidate>>({})
  const [responses, setResponses] = useState<Record<string, PreviewResponse>>({})
  const [compose, setCompose] = useState<PreviewComposeSeed | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [chat, setChat] = useState<{ title: string; people: MeetingPerson[] } | null>(null)
  const [notice, setNotice] = useState('')
  const enabled = active && real?.status === 'active', scope = [real?.id, real?.companyId]
  const seriesQuery = useQuery({ queryKey: ['company-meetings', ...scope], queryFn: listCompanyMeetings, enabled })
  const calendarQuery = useQuery({ queryKey: ['meeting-calendar', ...scope, range.from, range.to], queryFn: () => listMeetingCalendar(range.from, range.to), enabled })
  const roomsQuery = useQuery({ queryKey: ['meeting-rooms', real?.companyId], queryFn: listMeetingRooms, enabled })
  const peopleQuery = useQuery({ queryKey: ['meeting-directory', real?.companyId], queryFn: listMeetingDirectory, enabled })
  const lunchQuery = useQuery({ queryKey: ['meeting-ui-preview', ...scope, 'lunch'], queryFn: loadCompanyLunch, enabled })
  const series = seriesQuery.data ?? emptyList<MeetingSeries>(), bookings = calendarQuery.data ?? emptyList<MeetingDraft>()
  const rooms = roomsQuery.data ?? emptyList<MeetingRoom>(), directory = peopleQuery.data ?? emptyList<MeetingPerson>()
  const people = useMemo(() => directory.some(person => person.id === actor.id) ? directory : [actor, ...directory], [directory, actor])
  const events = useMemo(() => [...existingPreviewMeetings(series, bookings), ...local].filter(item => !replaced.includes(item.id)).map(item => edits[item.id] ? { ...item, ...edits[item.id] } : item), [series, bookings, local, replaced, edits])
  const occupants = useMemo(() => groupMeetingsByRoomDay(previewCalendarMeetings(events).map(item => ({ id: item.id, seriesId: item.seriesId, title: `${previewKindLabel(item.kind)} · ${item.title}`, host: item.host, members: item.members, startsAt: `${item.date}T${item.clock}`, roomId: item.roomId, round: item.round, durationMinutes: item.duration, quarterId: quarterFromTime(item.clock) }))), [events])
  const errors = [seriesQuery.error, calendarQuery.error, roomsQuery.error, peopleQuery.error, lunchQuery.error].filter(Boolean).map(error => error!.message).join(' / ')
  useEffect(() => { if (errors) console.warn('[meetings-preview] 미리보기 일정 조회 실패', { error: errors }) }, [errors])
  const ready = enabled && !errors && !seriesQuery.isPending && !calendarQuery.isPending && !roomsQuery.isPending && !peopleQuery.isPending && !lunchQuery.isPending && rooms.length > 0
  const onRangeChange = useCallback((from: string, to: string) => setRange(current => current.from === from && current.to === to ? current : { from, to }), [])
  function selectDate(next: string) {
    if (!next) return
    setDate(next)
    const nextDays = listMeetingDays(next, 10, today)
    setRange({ from: nextDays[0]?.key ?? next, to: nextDays[nextDays.length - 1]?.key ?? next })
  }
  function closeCompose() { setCompose(null); setRange({ from: days[0]?.key ?? date, to: days[days.length - 1]?.key ?? date }) }
  function openCompose(project?: PreviewMeeting) {
    const latest = project && previewHasRounds(project.kind) ? [...events.filter(item => item.seriesId === project.seriesId)].sort((a, b) => b.round - a.round)[0] : project
    setCompose({ date, roomId: roomId || rooms[0]?.id || '', clock: '', project: latest })
  }
  function receivePreview(rows: PreviewMeeting[], candidate?: PreviewCandidate) {
    if (compose?.project?.status === 'preparing') setReplaced(ids => [...ids, compose.project!.id])
    setLocal(current => [...current, ...rows])
    if (candidate) setCandidates(current => ({ ...current, ...Object.fromEntries(rows.map(row => [row.id, candidate])) }))
    setNotice(rows[0].kind === 'meeting' ? '미팅 진행 기록을 미리보기에 추가했습니다.' : '회의를 미리보기에 추가했습니다. 실제 저장·알림은 발생하지 않았습니다.')
    setBoardTab(rows[0].status === 'done' ? 'done' : 'in_progress')
    setKind('all'); closeCompose()
  }
  const groups = useMemo(() => {
    const map = new Map<string, PreviewMeeting[]>()
    for (const item of events) if ((kind === 'all' || item.kind === kind) && (!mineOnly || isPreviewParticipant(item, actor.id))) map.set(item.seriesId, [...(map.get(item.seriesId) ?? []), item])
    return [...map.values()].map(rows => rows.sort((a, b) => a.round - b.round))
  }, [events, kind, mineOnly, actor.id])
  const done = (rows: PreviewMeeting[]) => rows.every(item => item.status === 'done')
  const board = groups.filter(rows => done(rows) === (boardTab === 'done'))
  const detail = events.find(item => item.id === detailId)
  function respond(item: PreviewMeeting, status: PreviewResponse) { setResponses(current => ({ ...current, [item.id]: status })); setNotice('참석 응답을 화면에서만 변경했습니다.') }
  function attendance(item: PreviewMeeting, compact = true) {
    const round = previewRound(item, actor.id, responses[item.id])
    const data: MeetingSeries = { id: item.seriesId, title: item.title, host: item.host, members: item.members, phase: item.status === 'preparing' ? 'preparing' : 'published', status: item.status === 'done' ? 'done' : 'in_progress', durationMinutes: item.duration, rounds: [round] }
    return <MeetingAttendance compact={compact} series={data} round={round} actorId={actor.id} simulating={false}
      onChat={person => setChat({ title: `${person.name} · 1:1 대화 미리보기`, people: [actor, person] })}
      onGroup={() => setChat({ title: '전체 멤버 대화 미리보기', people: [item.host, ...item.members] })} onRespond={status => respond(item, status)} />
  }
  return <div className="min-w-0 space-y-4" data-meeting-ui-preview>
    <p className="text-xs text-muted-foreground">화면 미리보기 · 실제 저장·예약·알림은 발생하지 않습니다. 종료·계정 변경·새로고침 시 초기화됩니다.</p>
    {errors ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 p-3 text-sm text-danger"><span>일정을 불러오지 못했습니다. 빈 시간으로 판단하지 않습니다.</span><Button type="button" variant="outline" size="sm" onClick={() => { void Promise.all([seriesQuery.refetch(), calendarQuery.refetch(), roomsQuery.refetch(), peopleQuery.refetch(), lunchQuery.refetch()]) }}>다시 불러오기</Button></div> : !ready && <p role="status" className="text-sm text-muted-foreground">{roomsQuery.isSuccess && !rooms.length ? '등록된 회의실이 없습니다.' : '회의실과 일정을 불러오는 중입니다.'}</p>}
    {notice && <p role="status" className="text-xs text-primary">{notice}</p>}
    <Card><CardContent className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">진행 회의</p><Button type="button" size="sm" disabled={!ready} onClick={() => openCompose()}>회의 생성</Button></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div role="tablist" aria-label="미리보기 회의 진행 상태" className="flex items-stretch gap-0.5">{([['in_progress', '진행중'], ['done', '완료']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={boardTab === value} onClick={() => setBoardTab(value)} className={cn('-mb-px border-b-2 px-3 py-1.5 text-sm', boardTab === value ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground')}>{label} {groups.filter(rows => done(rows) === (value === 'done')).length}</button>)}</div>
        <div className="mb-1 flex flex-wrap items-center gap-3"><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={mineOnly} onChange={event => setMineOnly(event.target.checked)} />내 회의만</label><Select aria-label="회의 성격 필터" className="h-8 text-xs" value={kind} onChange={event => setKind(event.target.value as MeetingKind | 'all')}><option value="all">모든 성격</option>{MEETING_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></div>
      </div>
      {!board.length ? <p className="py-6 text-center text-sm text-muted-foreground">{boardTab === 'done' ? '완료한 회의·미팅 기록이 없습니다.' : '진행 중인 회의가 없습니다. 회의 생성에서 주제·호스트·멤버를 정해 준비를 시작하세요.'}</p> : <ul className="space-y-2">{board.map(rows => {
        const item = rows[rows.length - 1]
        const pending = rows.filter(row => row.kind !== 'meeting' && row.status === 'in_progress' && row.members.some(person => person.id === actor.id) && (responses[row.id] ?? row.responses.find(response => response.profileId === actor.id)?.status ?? 'pending') === 'pending')
        return <li key={item.seriesId} className="space-y-2 rounded-lg border border-border px-3 py-2.5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2"><div className="min-w-0 space-y-1"><div className="flex flex-wrap items-center gap-1.5"><Badge>{previewKindLabel(item.kind)}</Badge><button type="button" className="break-words text-left text-sm font-medium hover:text-primary" onClick={() => setDetailId(item.id)}>{item.title}</button>{item.kind === 'routine' && <span className="text-[10px] text-muted-foreground">상시 운영</span>}</div>{item.kind === 'meeting' ? <p className="text-xs text-muted-foreground">{previewDateLabel(item.date)} · 진행 완료 · {[item.host, ...item.members].map(person => person.name).join(', ')}</p> : attendance(item)}<div className="flex flex-wrap gap-1">{rows.map(row => <button key={row.id} type="button" className="rounded px-1 py-0.5 text-xs font-medium hover:bg-muted" onClick={() => setDetailId(row.id)}>{previewHasRounds(row.kind) ? `${row.round}차 회의` : row.kind === 'meeting' ? '미팅 기록' : '회의 기록'}{row.status === 'preparing' ? ' · 준비 중' : row.finished ? ' · 기록 완료' : row.clock ? ` · ${previewDateLabel(row.date)} ${row.clock}` : ''}</button>)}</div></div></div><Button type="button" size="sm" variant="ghost" onClick={() => setDetailId(item.id)}>상세</Button></div>
          {pending.map(row => <MeetingResponse key={row.id} round={previewRound(row, actor.id, responses[row.id])} actorId={actor.id} scheduleLabel={`${previewHasRounds(row.kind) ? `${row.round}차 · ` : ''}${previewDateLabel(row.date)} · ${previewTimeLabel(row)}`} onRespond={status => respond(row, status)} />)}
        </li>
      })}</ul>}
    </CardContent></Card>
    <Card><CardContent className="space-y-4 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">회의실 일정</p><Input type="date" aria-label="회의실 일정 날짜" className="w-auto text-xs" value={date} onChange={event => selectDate(event.target.value)} /></div>
      {rooms.length > 0 && renderCalendar({ rooms, roomId: roomId || rooms[0].id, weeks, occupants, onSelectRoom: setRoomId, onShiftRange: direction => selectDate(shiftPreviewDay(date, direction * 14)) })}
      <p className="text-[11px] text-muted-foreground">현재 계정에 조회가 허용된 예약만 표시합니다. 미팅 진행 기록과 준비 중 회의는 회의실 시간을 차지하지 않습니다.</p>
    </CardContent></Card>
    {compose && <MeetingPreviewComposer seed={compose} actor={actor} people={people} rooms={rooms} events={events} lunch={lunchQuery.data} ready={Boolean(ready)} onRangeChange={onRangeChange} onClose={closeCompose} onPreview={receivePreview} />}
    {detail && <MeetingPreviewDialog title={detail.kind === 'meeting' ? '미팅 기록 미리보기' : '회의 상세 미리보기'} onClose={() => setDetailId(null)}><div className="space-y-4"><div className="flex flex-wrap gap-2"><Badge>{previewKindLabel(detail.kind)}</Badge>{detail.kind === 'routine' && <Badge>상시 운영 · 종료일 없음</Badge>}{detail.local && <Badge>미리보기</Badge>}</div><h3 className="break-words text-base font-semibold">{detail.title}</h3><p className="text-xs text-muted-foreground">호스트 {detail.host.name} · {detail.date ? `${previewDateLabel(detail.date)}${detail.clock ? ` · ${previewTimeLabel(detail)}` : ''}` : '준비 중 · 일정 미정'}</p>
      {detail.kind === 'meeting' ? <div className="space-y-2 rounded-lg border border-border p-3"><p className="text-sm">미팅 진행 완료</p><p className="text-xs">참석자 · {[detail.host, ...detail.members].map(person => person.name).join(', ')}</p><p className="text-xs text-muted-foreground">내용·회의록 없이 진행 사실만 남기는 기록입니다.</p></div> : isPreviewParticipant(detail, actor.id) ? <>
        {attendance(detail, false)}
        <PreviewNotes key={detail.id} item={detail} editable={detail.host.id === actor.id} onSave={(content, result, finish) => { setEdits(current => ({ ...current, [detail.id]: { ...current[detail.id], content, result, finished: finish || detail.finished, status: finish && !previewHasRounds(detail.kind) ? 'done' : detail.status } })); setNotice('회의 내용을 미리보기에서만 변경했습니다.'); if (finish && !previewHasRounds(detail.kind)) setBoardTab('done') }} />
        {detail.host.id === actor.id && (detail.status === 'preparing' || previewHasRounds(detail.kind) && detail.status !== 'done') && <Button type="button" size="sm" variant="outline" onClick={() => { const item = detail; setDetailId(null); openCompose(item) }}>{detail.status === 'preparing' ? '일정 정하기 미리보기' : '다음 회차 미리보기'}</Button>}
        {detail.kind === 'interview' && candidates[detail.id] && <section className="space-y-2 rounded-lg border border-border bg-muted/30 p-3"><p className="flex items-center gap-1 text-xs font-medium"><LockKeyhole className="size-3" />지원자 정보 · 내부 면접관 전용</p><p className="text-sm">{candidates[detail.id].name || '이름 미입력'}</p><p className="text-sm">{candidates[detail.id].contact}</p><p className="whitespace-pre-wrap text-sm">{candidates[detail.id].notes}</p></section>}
      </> : <p className="text-xs text-muted-foreground">회의 내용·자료·대화는 호스트와 참석자에게만 표시됩니다.</p>}
      <p className="text-xs text-muted-foreground">미리보기에서 변경한 내용은 실제 저장하지 않습니다.</p></div></MeetingPreviewDialog>}
    {chat && <MeetingPreviewDialog title={chat.title} onClose={() => setChat(null)}><div className="space-y-4"><div className="flex flex-wrap gap-1.5">{chat.people.map(person => <Badge key={person.id}>{person.name}</Badge>)}</div><div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg bg-muted/30 p-4 text-center"><MessageCircle className="size-7 text-muted-foreground" /><p className="text-xs">기존 대화방 연결 위치입니다. 미리보기에서는 방을 만들거나 메시지를 보내지 않습니다.</p></div><Input disabled placeholder="메시지 입력 · 실제 연결 후 사용" /></div></MeetingPreviewDialog>}
  </div>
}
