import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronLeft, ChevronRight, LockKeyhole, MessageCircle, Plus } from 'lucide-react'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { Input, Select } from '@/components/ui/input'
import { StatGrid, StatTile } from '@/components/ui/stat-tile'
import { StatusPill } from '@/components/ui/status-pill'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { loadCompanyLunch } from '@/lib/supabase/company-work-hours'
// 조회 함수만 가져온다. 저장·응답·대화방·파일 작업은 이 미리보기에서 호출하지 않는다.
import { listCompanyMeetings, listMeetingCalendar, listMeetingDirectory, listMeetingRooms } from '@/lib/supabase/meetings'
import { cn, emptyList } from '@/lib/utils'
import { MeetingAttendance } from './MeetingAttendance'
import { MeetingPreviewComposer, type PreviewComposeSeed } from './MeetingPreviewComposer'
import { MeetingPreviewDialog, MeetingPreviewTimeline } from './MeetingPreviewTimeline'
import { profileToMeetingPerson } from './meeting-schedule'
import { quarterFromTime } from './meeting-slots'
import { toDateKey, type MeetingDraft, type MeetingPerson, type MeetingRoom, type MeetingSeries } from './meeting-schedule'
import {
  MEETING_KINDS, existingPreviewMeetings, isPreviewParticipant, previewDateLabel, previewKindLabel, previewTimeLabel,
  shiftPreviewDay, type MeetingKind, type PreviewCandidate, type PreviewMeeting, type PreviewResponse,
} from './meeting-ui-preview'

type MyFilter = 'all' | 'preparing' | 'response' | 'in_progress' | 'done'

export function MeetingUiPreview() {
  useRenderWatch('MeetingUiPreview')
  const { profile } = useAuth(), preview = usePagePreview(), active = useWorkspaceTabActivity()
  const real = preview?.realProfile ?? profile
  const actor = useMemo(() => profile ? profileToMeetingPerson(profile) : { id: '', name: '나' }, [profile])
  const [section, setSection] = useState<'rooms' | 'mine'>('rooms')
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [range, setRange] = useState(() => ({ from: date, to: date }))
  const [roomId, setRoomId] = useState('all'), [kind, setKind] = useState<MeetingKind | 'all'>('all')
  const [myFilter, setMyFilter] = useState<MyFilter>('all')
  const [local, setLocal] = useState<PreviewMeeting[]>([])
  const [candidates, setCandidates] = useState<Record<string, PreviewCandidate>>({})
  const [responses, setResponses] = useState<Record<string, PreviewResponse>>({})
  const [compose, setCompose] = useState<PreviewComposeSeed | null>(null)
  const [detail, setDetail] = useState<PreviewMeeting | null>(null)
  const [chat, setChat] = useState<{ title: string; people: MeetingPerson[] } | null>(null)
  const [notice, setNotice] = useState('')
  const enabled = active && real?.status === 'active'
  const scope = [real?.id, real?.companyId]
  const seriesQuery = useQuery({ queryKey: ['company-meetings', ...scope], queryFn: listCompanyMeetings, enabled })
  const calendarQuery = useQuery({ queryKey: ['meeting-calendar', ...scope, range.from, range.to], queryFn: () => listMeetingCalendar(range.from, range.to), enabled })
  const roomsQuery = useQuery({ queryKey: ['meeting-rooms', real?.companyId], queryFn: listMeetingRooms, enabled })
  const peopleQuery = useQuery({ queryKey: ['meeting-directory', real?.companyId], queryFn: listMeetingDirectory, enabled })
  const lunchQuery = useQuery({ queryKey: ['meeting-ui-preview', ...scope, 'lunch'], queryFn: loadCompanyLunch, enabled })
  const series = seriesQuery.data ?? emptyList<MeetingSeries>(), bookings = calendarQuery.data ?? emptyList<MeetingDraft>()
  const rooms = roomsQuery.data ?? emptyList<MeetingRoom>()
  const directory = peopleQuery.data ?? emptyList<MeetingPerson>()
  const people = useMemo(() => directory.some(person => person.id === actor.id) ? directory : [actor, ...directory], [directory, actor])
  const events = useMemo(() => [...existingPreviewMeetings(series, bookings), ...local], [series, bookings, local])
  const errors = [seriesQuery.error, calendarQuery.error, roomsQuery.error, peopleQuery.error, lunchQuery.error].filter(Boolean).map(error => error!.message).join(' / ')
  useEffect(() => { if (errors) console.warn('[meetings-preview] 미리보기 일정 조회 실패', { error: errors }) }, [errors])
  const ready = enabled && !errors && !seriesQuery.isPending && !calendarQuery.isPending && !roomsQuery.isPending && !peopleQuery.isPending && !lunchQuery.isPending && rooms.length > 0
  const onRangeChange = useCallback((from: string, to: string) => setRange(current => current.from === from && current.to === to ? current : { from, to }), [])
  function selectDate(next: string) { if (!next) return; setDate(next); setRange({ from: next, to: next }) }
  function closeCompose() { setCompose(null); setRange({ from: date, to: date }) }
  function openCompose(selectedRoom = rooms[0]?.id ?? '', clock = '', project?: PreviewMeeting) { setCompose({ date, roomId: selectedRoom, clock, project }) }
  function receivePreview(rows: PreviewMeeting[], candidate?: PreviewCandidate) {
    setLocal(current => [...current.filter(item => !(compose?.project?.local && compose.project.status === 'preparing' && item.id === compose.project.id)), ...rows])
    if (candidate) setCandidates(current => ({ ...current, ...Object.fromEntries(rows.map(row => [row.id, candidate])) }))
    setNotice(`${rows.length}건을 미리보기에 추가했습니다. 실제 예약과 알림은 발생하지 않았습니다.`)
    closeCompose()
  }
  const mine = events.filter(item => isPreviewParticipant(item, actor.id))
  const needsResponse = (item: PreviewMeeting) => item.status === 'in_progress' && item.members.some(person => person.id === actor.id) && (responses[item.id] ?? item.responses.find(row => row.profileId === actor.id)?.status ?? 'pending') === 'pending'
  const filters: { value: MyFilter; label: string; count: number }[] = [
    { value: 'all', label: '전체', count: mine.length },
    { value: 'preparing', label: '준비 중', count: mine.filter(item => item.status === 'preparing').length },
    { value: 'response', label: '내 응답 필요', count: mine.filter(needsResponse).length },
    { value: 'in_progress', label: '진행 중', count: mine.filter(item => item.status === 'in_progress').length },
    { value: 'done', label: '완료', count: mine.filter(item => item.status === 'done').length },
  ]
  const selectedMine = mine.filter(item => myFilter === 'all' || (myFilter === 'response' ? needsResponse(item) : item.status === myFilter))
  const dayMeetings = events.filter(item => item.date === date && item.status !== 'preparing' && (kind === 'all' || item.kind === kind) && (roomId === 'all' || item.roomId === roomId))
  const currentDetail = detail ? events.find(item => item.id === detail.id) ?? detail : null
  function attendance(item: PreviewMeeting) {
    const ownResponse = responses[item.id]
    const round = { id: item.id, round: item.round, roomId: item.roomId, startsAt: item.date ? `${item.date}T${item.clock}` : '', durationMinutes: item.duration,
      confirmed: item.status !== 'preparing', quarterId: quarterFromTime(item.clock), content: item.content, result: '', prepMaterials: [],
      responses: ownResponse ? [...item.responses.filter(row => row.profileId !== actor.id), { profileId: actor.id, status: ownResponse }] : item.responses }
    const data: MeetingSeries = { id: item.seriesId, title: item.title, host: item.host, members: item.members, phase: item.status === 'preparing' ? 'preparing' : 'published', status: item.status === 'done' ? 'done' : 'in_progress', durationMinutes: item.duration, rounds: [round] }
    return <MeetingAttendance series={data} round={round} actorId={actor.id} simulating={false}
      onChat={person => setChat({ title: `${person.name} · 1:1 대화 미리보기`, people: [actor, person] })}
      onGroup={() => setChat({ title: '전체 멤버 대화 미리보기', people: [item.host, ...item.members] })}
      onRespond={status => { setResponses(current => ({ ...current, [item.id]: status })); setNotice('참석 응답을 화면에서만 변경했습니다. 실제 응답은 저장하지 않았습니다.') }} />
  }
  return <div className="min-w-0 space-y-4" data-meeting-ui-preview>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <p className="text-xs font-medium text-primary">화면 미리보기 · 실제 예약과 알림은 발생하지 않습니다</p><Badge>종료·계정 변경·새로고침 시 초기화</Badge>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FilterTabs value={section} onChange={setSection} ariaLabel="회의 미리보기 보기" tabs={[{ value: 'rooms', label: '회의실 일정' }, { value: 'mine', label: '내 회의' }]} />
      <Button type="button" disabled={!ready} onClick={() => openCompose()}><Plus className="size-4" />회의 생성</Button>
    </div>
    {errors ? <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 p-3 text-sm text-danger"><span>일정을 불러오지 못했습니다. 빈 시간으로 판단하지 않습니다.</span><Button type="button" variant="outline" size="sm" onClick={() => { void Promise.all([seriesQuery.refetch(), calendarQuery.refetch(), roomsQuery.refetch(), peopleQuery.refetch(), lunchQuery.refetch()]) }}>다시 불러오기</Button></div> : !ready ? <p role="status" className="text-sm text-muted-foreground">{roomsQuery.isSuccess && !rooms.length ? '등록된 회의실이 없습니다.' : '회의실과 일정을 불러오는 중입니다.'}</p> : null}
    {notice && <p role="status" className="text-xs text-primary">{notice}</p>}
    {section === 'rooms' ? <>
      <StatGrid className="mb-0 xl:grid-cols-3"><StatTile label="선택 날짜 예약" value={dayMeetings.length} hint="조회 가능한 일정" icon={CalendarDays} accent /><StatTile label="내 응답 필요" value={mine.filter(needsResponse).length} hint="내 회의에서 확인" /><StatTile label="미리보기로 추가" value={local.length} hint="실제 저장 없음" /></StatGrid>
      <Card><CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-semibold">한눈에 보는 회의실</h2><p className="mt-1 text-xs text-muted-foreground">빈 시간을 누르면 해당 날짜·회의실로 예약을 준비합니다.</p></div><StatusPill tone="outline">{lunchQuery.data ? `점심 ${lunchQuery.data.start}–${lunchQuery.data.end}` : '점심시간 확인 중'}</StatusPill></div>
        <FilterBar className="mb-0">
          <div className="flex items-center gap-1"><Button type="button" size="icon" variant="ghost" aria-label="이전 주" onClick={() => selectDate(shiftPreviewDay(date, -7))}><ChevronLeft className="size-4" /></Button><Button type="button" size="sm" variant="outline" onClick={() => selectDate(toDateKey(new Date()))}>오늘</Button><Button type="button" size="icon" variant="ghost" aria-label="다음 주" onClick={() => selectDate(shiftPreviewDay(date, 7))}><ChevronRight className="size-4" /></Button></div>
          <Input type="date" aria-label="회의실 일정 날짜" className="w-auto" value={date} onChange={event => selectDate(event.target.value)} />
          <Select aria-label="회의실 필터" value={roomId} onChange={event => setRoomId(event.target.value)}><option value="all">전체 회의실</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</Select>
          <Select aria-label="회의 성격 필터" value={kind} onChange={event => setKind(event.target.value as MeetingKind | 'all')}><option value="all">모든 회의 성격</option>{MEETING_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
        </FilterBar>
        <div className="grid grid-cols-7 gap-1.5">{Array.from({ length: 7 }, (_, index) => shiftPreviewDay(date, index - 3)).map(day => <button key={day} type="button" aria-pressed={day === date} onClick={() => selectDate(day)} className={cn('rounded-lg border px-1 py-2 text-xs', day === date ? 'border-primary bg-primary/5 font-semibold text-primary' : 'border-border hover:bg-muted')}>{previewDateLabel(day)}</button>)}</div>
        <MeetingPreviewTimeline rooms={rooms.filter(room => roomId === 'all' || room.id === roomId)} events={events} date={date} lunch={lunchQuery.data} ready={Boolean(ready)} kindFilter={kind} onPick={(room, clock) => openCompose(room, clock)} onOpen={setDetail} />
        <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground"><span>흰색 · 빈 시간</span><span className="text-primary">테두리 카드 · 예약</span><span>회색 · 점심·선택 불가</span><span>점선 · 미리보기 예약</span></div>
        <p className="text-[11px] text-muted-foreground">현재 계정에 조회가 허용된 예약만 표시합니다. 전 직원 공개 범위 확대는 실제 연결 단계에서 적용됩니다.</p>
      </CardContent></Card>
    </> : <>
      <FilterBar><FilterTabs value={myFilter} onChange={setMyFilter} tabs={filters} ariaLabel="내 회의 상태" /></FilterBar>
      {selectedMine.length ? <div className="space-y-3">{selectedMine.map(item => <Card key={item.id}><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><Badge>{previewKindLabel(item.kind)}</Badge><StatusPill tone={needsResponse(item) ? 'warning' : item.status === 'done' ? 'success' : 'outline'}>{needsResponse(item) ? '내 응답 필요' : item.status === 'preparing' ? '준비 중' : item.status === 'done' ? '완료' : '진행 중'}</StatusPill>{item.local && <Badge>미리보기</Badge>}</div><button type="button" className="break-words text-left font-semibold hover:text-primary" onClick={() => setDetail(item)}>{item.title}</button><p className="mt-1 text-xs text-muted-foreground">{item.kind === 'project' ? `${item.round}차 · ` : ''}{item.date ? `${previewDateLabel(item.date)} · ${previewTimeLabel(item)} · ${rooms.find(room => room.id === item.roomId)?.name ?? '회의실'}` : '일정 미확정'} · 호스트 {item.host.name}</p></div><Button type="button" size="sm" variant="outline" onClick={() => setDetail(item)}>상세 보기</Button></div>
        {attendance(item)}
      </CardContent></Card>)}</div> : <Card><CardContent className="py-14 text-center text-sm text-muted-foreground">{myFilter === 'response' ? '응답이 필요한 회의가 없습니다.' : '해당하는 내 회의가 없습니다.'}</CardContent></Card>}
    </>}
    {compose && <MeetingPreviewComposer seed={compose} actor={actor} people={people} rooms={rooms} events={events} lunch={lunchQuery.data} ready={Boolean(ready)} onRangeChange={onRangeChange} onClose={closeCompose} onPreview={receivePreview} />}
    {currentDetail && <MeetingPreviewDialog title="회의 상세 미리보기" onClose={() => setDetail(null)}>
      <div className="space-y-4"><div className="flex gap-2"><Badge>{previewKindLabel(currentDetail.kind)}</Badge>{currentDetail.local && <Badge>미리보기 예약</Badge>}</div><h3 className="break-words text-lg font-semibold">{currentDetail.title}</h3>
        <p className="text-sm text-muted-foreground">{currentDetail.date ? `${previewDateLabel(currentDetail.date)} · ${previewTimeLabel(currentDetail)} · ${rooms.find(room => room.id === currentDetail.roomId)?.name ?? '회의실'}` : '준비 중 · 일정 미정'}</p><p className="text-sm">호스트 · {currentDetail.host.name}</p>
        {isPreviewParticipant(currentDetail, actor.id) ? <>
          {currentDetail.content && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{currentDetail.content}</p>}
          {attendance(currentDetail)}
          {currentDetail.kind === 'project' && currentDetail.host.id === actor.id && <Button type="button" variant="outline" onClick={() => { const project = currentDetail; setDetail(null); openCompose(rooms[0]?.id, '', project) }}>{currentDetail.status === 'preparing' ? '일정 미리보기' : '다음 회차 미리보기'}</Button>}
          {currentDetail.kind === 'interview' && candidates[currentDetail.id] && <section className="space-y-2 rounded-xl border border-border bg-muted/40 p-4"><h4 className="flex items-center gap-2 text-sm font-semibold"><LockKeyhole className="size-4" />지원자 정보 · 내부 면접관 전용</h4><p className="text-sm">{candidates[currentDetail.id].name || '이름 미입력'}</p><p className="text-sm">{candidates[currentDetail.id].contact}</p><p className="whitespace-pre-wrap text-sm">{candidates[currentDetail.id].notes}</p></section>}
        </> : <p className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">회의 내용·자료·대화는 호스트와 참석자에게만 표시됩니다.</p>}
        <p className="text-xs text-muted-foreground">현재 화면에서만 동작하는 미리보기입니다.</p>
      </div>
    </MeetingPreviewDialog>}
    {chat && <MeetingPreviewDialog title={chat.title} onClose={() => setChat(null)}><div className="space-y-4"><div className="flex flex-wrap gap-1.5">{chat.people.map(person => <Badge key={person.id}>{person.name}</Badge>)}</div><div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-xl bg-muted/40 p-4 text-center"><MessageCircle className="size-8 text-muted-foreground" /><p className="text-sm">이 위치에서 기존 대화방을 열게 됩니다.</p><p className="text-xs text-muted-foreground">미리보기에서는 대화방 생성과 메시지 발송을 하지 않습니다.</p></div><Input disabled placeholder="메시지 입력 · 실제 연결 후 사용" /></div></MeetingPreviewDialog>}
  </div>
}
