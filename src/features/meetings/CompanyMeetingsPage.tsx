import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { openDirectChat } from '@/lib/supabase/chat'
import { openConversation } from '@/lib/chat/open-conversation'
import { chatKeys } from '@/features/chat/use-chat'
import { MeetingAttendance, MeetingResponse } from './MeetingAttendance'
import { MeetingSchedulePicker, type MeetingScheduleChoice } from './MeetingSchedulePicker'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { previewMeetingActor } from '@/lib/company/relationship-preview'
import {
  listDepartments,
  type Department,
} from '@/lib/supabase/profiles'
import { listMeetingDirectory, uploadMeetingFile, removeMeetingFile, downloadMeetingFile, respondToMeeting, openMeetingGroup } from '@/lib/supabase/meetings'
import { useCompanyMeetings } from './useCompanyMeetings'
import { hasPermission } from '@/lib/company/permissions'
import { cn, emptyList } from '@/lib/utils'
import {
  DEFAULT_MEETING_DURATION_MINUTES,
  DEFAULT_MEETING_VISIBLE_DAYS,
  MEETING_DURATION_MINUTES,
  MEETING_ROOMS,
  MEETING_WEEKDAY_LABELS,
  chunkMeetingDays,
  groupMeetingMembersByDepartment,
  groupMeetingsByRoomDay,
  combineDateTime,
  canDeleteMeetingSeries,
  canRemoveBookedMeeting,
  canRemovePrepFile,
  emptyRoundNotes,
  filterSeriesByStatus,
  filterSeriesForViewer,
  findPendingRound,
  appendPendingRound,
  formatMeetingComposeGaps,
  isMeetingComposeReady,
  isPendingRound,
  formatMeetingDuration,
  formatRoundGapHint,
  formatRoundGapLabel,
  formatRoundListLabel,
  roundListCaption,
  roundGapDays,
  groupPrepMaterialsByUploader,
  meetingComposeGaps,
  meetingDeleteConfirmPhrase,
  meetingSeriesDeleteImpact,
  formatMeetingRangeLabel,
  formatSeriesDateSpan,
  formatMeetingTime,
  formatRoundLabel,
  listMeetingDays,
  meetingPersonLabel,
  assignMeetingChipClasses,
  meetingRoomName,
  meetingRoomTone,
  nextRoundNumber,
  preferredDetailRound,
  revokeMeetingSeriesFiles,
  profileToMeetingPerson,
  roomDayKey,
  shiftMeetingFromKey,
  timeFromDateTime,
  toDateKey,
  visibleDaysToCover,
  type MeetingDay,
  type MeetingDraft,
  type MeetingPrepFile,
  type MeetingPerson,
  type MeetingRound,
  type MeetingRoom,
  type MeetingSeries,
  type MeetingSeriesStatus,
} from './meeting-schedule'
import {
  formatDayBlockLabel,
  formatMeetingClockRange,
  WORK_DAY_CLOCKS,
  quarterFromTime,
  resolveDayState,
  resolveStartTimeState,
  type AttendanceEntry,
} from './meeting-slots'

const EMPTY_PEOPLE = emptyList<MeetingPerson>()
const EMPTY_DEPARTMENTS = emptyList<Department>()
const EMPTY_ATTENDANCE = emptyList<AttendanceEntry>()
const EMPTY_DRAFTS = emptyList<MeetingDraft>()
const LOCAL_HOST: MeetingPerson = { id: 'local-self', name: '나' }
const TIME_PICKER_SLOT_PX = 28
const TIME_PICKER_AXIS = new Set(['09:00', '13:00', '19:00'])
const TIME_PICKER_HOUR_CLOCKS = new Set(
  WORK_DAY_CLOCKS.filter((clock) => clock.endsWith(':00')),
)
const TIME_PICKER_START_CLOCKS = WORK_DAY_CLOCKS.filter(
  (clock) => clock !== '19:00',
)
const CALENDAR_SLOT_PX = 16

function timePickerSlotIndex(clock: string): number {
  const index = WORK_DAY_CLOCKS.indexOf(clock)
  return index < 0 ? 0 : index
}

function timePickerMarkLabel(clock: string): string {
  const [hour, minute] = clock.split(':')
  const hourLabel = String(Number(hour))
  return minute === '00' ? hourLabel : `${hourLabel}:${minute}`
}

function workDayLaneTop(clock: string, slotPx: number): number {
  return timePickerSlotIndex(clock) * slotPx
}

function workDayLaneHeight(durationMinutes: number, slotPx: number): number {
  return Math.max(1, Math.round(durationMinutes / 30)) * slotPx
}

function formatBookedTimeRange(
  startsAt: string,
  durationMinutes: number,
): string {
  const start = timeFromDateTime(startsAt)
  if (!start) return formatMeetingTime(startsAt)
  return formatMeetingClockRange(start, durationMinutes)
}

function newMeetingId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  throw new Error('회의를 저장하려면 보안 연결을 지원하는 브라우저가 필요합니다.')
}

export function CompanyMeetingsPage({ showHeading = true }: { showHeading?: boolean } = {}) {
  useRenderWatch('CompanyMeetingsPage')

  const { profile } = useAuth()
  const preview = usePagePreview()
  const cache=useQueryClient(),active=useWorkspaceTabActivity()
  const [searchParams,setSearchParams]=useSearchParams()
  const [selectedHostId,setSelectedHostId]=useState<string|null>(null)
  const [schedulingRoundId,setSchedulingRoundId]=useState<string|null>(null)
  const topicRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLSelectElement>(null)
  const composeSectionRef = useRef<HTMLDivElement>(null)
  const [boardTab, setBoardTab] = useState<MeetingSeriesStatus>('in_progress')
  const [schedulingSeriesId, setSchedulingSeriesId] = useState<string | null>(
    null,
  )
  const [title, setTitle] = useState('')
  const [durationMinutes, setDurationMinutes] = useState<number | null>(null)
  const [members, setMembers] = useState<MeetingPerson[]>([])
  const [memberPickerOpen, setMemberPickerOpen] = useState(false)
  const [visibleDays, setVisibleDays] = useState(DEFAULT_MEETING_VISIBLE_DAYS)
  const [rangeFromKey, setRangeFromKey] = useState<string | null>(null)
  const [picker, setPicker] = useState<{
    roomId: string
    dateKey: string
  } | null>(null)
  const [detail, setDetail] = useState<{
    seriesId: string
    roundId: string
  } | null>(null)
  const [composePrompt, setComposePrompt] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [deleteSeriesId, setDeleteSeriesId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState(MEETING_ROOMS[0].id)
  const [scheduleChoice,setScheduleChoice]=useState<MeetingScheduleChoice>(()=>({roomId:MEETING_ROOMS[0].id,dateKey:toDateKey(new Date()),clock:''}))
  const todayKey = toDateKey(new Date())
  const fromKey = rangeFromKey ?? todayKey
  const days = useMemo(() => listMeetingDays(fromKey, visibleDays, todayKey),[fromKey,todayKey,visibleDays])
  const meetings=useCompanyMeetings(days[0]?.key ?? todayKey,days[days.length-1]?.key ?? todayKey)
  const {series,setSeries,rooms,saving,simulating}=meetings

  const host = useMemo<MeetingPerson>(() => {
    if (!profile) return LOCAL_HOST
    return previewMeetingActor(profileToMeetingPerson(profile), series, preview?.facts?.meetingRole)
  }, [profile, series, preview?.facts?.meetingRole])
  const isAdmin = hasPermission(profile, 'meeting.manage')

  const membersQuery = useQuery({
    queryKey: ['meeting-directory', preview?.realProfile?.companyId ?? profile?.companyId],
    queryFn: listMeetingDirectory,
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const people = membersQuery.data ?? EMPTY_PEOPLE
  const departments = departmentsQuery.data ?? EMPTY_DEPARTMENTS

  useEffect(() => {
    if (!membersQuery.isError) return
    console.warn('[meetings] 멤버 목록을 불러오지 못함', {
      error: membersQuery.error,
    })
  }, [membersQuery.error, membersQuery.isError])

  const directory = useMemo(() => {
    if (people.some((person) => person.id === host.id)) return people
    return [host, ...people]
  }, [host, people])
  const chosenHost=directory.find(person=>person.id===(selectedHostId ?? host.id)) ?? host

  const selectedMemberIds = useMemo(
    () => members.map((person) => person.id),
    [members],
  )
  const departmentGroups = useMemo(
    () => groupMeetingMembersByDepartment(directory, selectedHostId ?? host.id, departments),
    [departments, directory, host.id, selectedHostId],
  )

  const weeks = useMemo(() => chunkMeetingDays(days), [days])
  const items = meetings.bookings
  const occupants = useMemo(() => groupMeetingsByRoomDay(items), [items])
  const pickerDay = useMemo(
    () => (picker ? days.find((day) => day.key === picker.dateKey) : undefined),
    [days, picker],
  )
  const pickerOccupants = picker
    ? (occupants.get(roomDayKey(picker.roomId, picker.dateKey)) ?? EMPTY_DRAFTS).filter(item=>item.id!==schedulingRoundId)
    : EMPTY_DRAFTS
  const now = new Date()

  const visibleSeries = useMemo(
    () => filterSeriesForViewer(series, host, isAdmin),
    [host, isAdmin, series],
  )
  const openSeries = useMemo(
    () => filterSeriesByStatus(visibleSeries, 'in_progress'),
    [visibleSeries],
  )
  const ongoingMeetingCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of series) {
      if (item.status !== 'in_progress') continue
      for (const id of new Set([item.host.id, ...item.members.map((person) => person.id)])) {
        counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return counts
  }, [series])
  const doneSeries = useMemo(
    () => filterSeriesByStatus(visibleSeries, 'done'),
    [visibleSeries],
  )
  const boardSeries = boardTab === 'in_progress' ? openSeries : doneSeries
  const schedulingSeries = schedulingSeriesId
    ? series.find((item) => item.id === schedulingSeriesId)
    : undefined
  const detailSeries = detail
    ? series.find((item) => item.id === detail.seriesId)
    : undefined
  const detailRound = detailSeries
    ? (detailSeries.rounds.find((round) => round.id === detail?.roundId) ??
      detailSeries.rounds[detailSeries.rounds.length - 1])
    : undefined
  const deleteSeries = deleteSeriesId
    ? series.find((item) => item.id === deleteSeriesId)
    : undefined
  const submitRound = schedulingSeries
    ? (schedulingSeries.rounds.find(row=>row.id===schedulingRoundId)?.round ?? findPendingRound(schedulingSeries)?.round ??
      nextRoundNumber(schedulingSeries))
    : 1
  const composeTitle = (schedulingSeries?.title ?? title).trim()
  const composeDuration = durationMinutes
  const composeHost = schedulingSeries?.host ?? chosenHost
  const composeMembers = members
  const composeGaps = meetingComposeGaps({
    title: composeTitle,
    durationMinutes: schedulingSeries ? composeDuration : DEFAULT_MEETING_DURATION_MINUTES,
    memberCount: composeMembers.length,
    requireMembers: !schedulingSeries,
  })
  const composeReady = isMeetingComposeReady(composeGaps)
  const composeGapMessage = formatMeetingComposeGaps(composeGaps)
  const slotDurationMinutes =
    composeDuration ?? DEFAULT_MEETING_DURATION_MINUTES
  const attendees = useMemo(
    () => [composeHost, ...composeMembers],
    [composeHost, composeMembers],
  )
  useEffect(()=>{
    if(!active || !searchParams.get('meeting') || !searchParams.get('round')) return
    const item=visibleSeries.find(row=>row.id===searchParams.get('meeting'))
    const round=item?.rounds.find(row=>row.id===searchParams.get('round'))
    if(item&&round) setDetail(current=>current?.seriesId===item.id&&current.roundId===round.id?current:{seriesId:item.id,roundId:round.id})
  },[active,searchParams,visibleSeries])
  function closeDetail(){
    setDetail(null)
    if(active&&searchParams.has('meeting')){const next=new URLSearchParams(searchParams);next.delete('meeting');next.delete('round');setSearchParams(next,{replace:true})}
  }
  function chatWith(person:MeetingPerson){
    void meetings.perform(async()=>{const id=await openDirectChat(person.id);await cache.invalidateQueries({queryKey:chatKeys.rooms});openConversation(id,person.name)})
  }
  function groupChat(item:MeetingSeries){
    void meetings.perform(async()=>{const id=await openMeetingGroup(item.id);await cache.invalidateQueries({queryKey:chatKeys.rooms});openConversation(id,'회의 · '+item.title)})
  }
  function respond(item:MeetingSeries,round:MeetingRound,status:'available'|'unavailable'){
    if(simulating){void setSeries(rows=>rows.map(row=>row.id===item.id?{...row,rounds:row.rounds.map(r=>r.id===round.id?{...r,responses:[...(r.responses??[]).filter(response=>response.profileId!==host.id),{profileId:host.id,status}]}:r)}:row));return}
    void meetings.perform(()=>respondToMeeting(round.id,round.scheduleVersion ?? 1,status))
  }
  useEffect(() => {
    if (!picker) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPicker(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [picker])

  useEffect(() => {
    if (composeReady) setComposePrompt(null)
  }, [composeReady])

  function toggleMember(person: MeetingPerson) {
    setMembers((prev) =>
      prev.some((row) => row.id === person.id)
        ? prev.filter((row) => row.id !== person.id)
        : [...prev, person],
    )
  }

  function toggleDepartment(people: readonly MeetingPerson[]) {
    setMembers((prev) => {
      const selected = new Set(prev.map((person) => person.id))
      const allSelected = people.every((person) => selected.has(person.id))
      if (allSelected) return prev.filter((person) => !people.some((item) => item.id === person.id))
      return [...prev, ...people.filter((person) => !selected.has(person.id))]
    })
  }

  function resetCompose() {
    setTitle('')
    setDurationMinutes(null)
    setMembers([])
    setMemberPickerOpen(false)
    setSchedulingSeriesId(null)
    setSchedulingRoundId(null)
    setSelectedHostId(null)
    setComposePrompt(null)
    setPicker(null)
    setScheduleChoice({roomId:selectedRoomId,dateKey:todayKey,clock:''})
    setComposeOpen(false)
  }

  function openCreate() {
    if (schedulingSeries) resetCompose()
    setComposeOpen(true)
  }
  async function createDraft(){
    if(!composeReady){showComposeGaps();return}
    const id=newMeetingId(),roundId=newMeetingId()
    const saved=await setSeries(rows=>[{id,title:composeTitle,host:composeHost,members:composeMembers,createdBy:host.id,phase:'preparing',status:'in_progress',durationMinutes:DEFAULT_MEETING_DURATION_MINUTES,
      rounds:[{id:roundId,round:1,startsAt:'',roomId:'',quarterId:'q1',confirmed:false,...emptyRoundNotes()}]},...rows])
    if(saved){resetCompose();setBoardTab('in_progress');setDetail({seriesId:id,roundId})}
  }

  function showComposeGaps() {
    setComposePrompt(composeGapMessage)
    setComposeOpen(true)
    window.setTimeout(() => {
      if (composeGaps.title) {
        topicRef.current?.focus()
        return
      }
      if (composeGaps.duration) {
        durationRef.current?.focus()
        return
      }
      if (composeGaps.members) setMemberPickerOpen(true)
    }, 0)
  }

  async function bookSlot(nextRoomId: string, dateKey: string, startClock: string) {
    if (!composeReady || !schedulingSeries) return
    const startsAt = combineDateTime(dateKey, startClock)
    setVisibleDays((current) =>
      visibleDaysToCover(todayKey, dateKey, current),
    )
    const round = {
      id: newMeetingId(),
      round: submitRound,
      startsAt,
      roomId: nextRoomId,
      quarterId: quarterFromTime(startClock),
      durationMinutes: slotDurationMinutes,
      ...emptyRoundNotes(),
    }
    const target=schedulingSeries.rounds.find(row=>row.id===schedulingRoundId) ?? findPendingRound(schedulingSeries)
    const confirmed={...(target ?? round),startsAt,roomId:nextRoomId,quarterId:round.quarterId,durationMinutes:slotDurationMinutes,confirmed:true,
      scheduleVersion:(target?.scheduleVersion ?? 0)+1,responses:composeMembers.map(person=>({profileId:person.id,status:'pending' as const}))}
    const saved=await setSeries(rows=>rows.map(item=>item.id===schedulingSeries.id?{
      ...item,phase:'published',members:composeMembers,durationMinutes:slotDurationMinutes,
      rounds:target?item.rounds.map(row=>row.id===target.id?confirmed:row):[...item.rounds,confirmed],
    }:item),{id:schedulingSeries.id,revision:schedulingSeries.revision ?? 0,confirmRound:confirmed.id})
    if(saved) resetCompose()
  }

  function scheduleNextRound(item: MeetingSeries,roundId?:string) {
    const target=item.rounds.find(round=>round.id===roundId) ?? findPendingRound(item)
    setBoardTab('in_progress')
    setSchedulingSeriesId(item.id)
    setSchedulingRoundId(roundId ?? null)
    setTitle(item.title)
    setDurationMinutes(target?.startsAt ? target.durationMinutes ?? item.durationMinutes : null)
    setScheduleChoice({roomId:target?.roomId || selectedRoomId,dateKey:target?.startsAt.slice(0,10) || todayKey,clock:target?.startsAt.slice(11,16) || ''})
    setMembers(item.members)
    setComposePrompt(null)
    setMemberPickerOpen(false)
    setComposeOpen(true)
    window.setTimeout(() => {
      durationRef.current?.focus()
    }, 0)
  }

  async function planNextRound(item: MeetingSeries): Promise<boolean> {
    const existing = findPendingRound(item)
    if (existing) return true
    const nextId = newMeetingId()
    return setSeries((prev) =>
      prev.map((row) =>
        row.id === item.id ? appendPendingRound(row, nextId) : row,
      ),
    )
  }

  async function markDone(seriesId: string) {
    const saved=await setSeries((prev) =>
      prev.map((item) =>
        item.id === seriesId ? { ...item, status: 'done' } : item,
      ),
    )
    if(saved){if (schedulingSeriesId === seriesId) resetCompose();setBoardTab('done')}
    return saved
  }

  async function markInProgress(seriesId: string) {
    const saved=await setSeries((prev) =>
      prev.map((item) =>
        item.id === seriesId ? { ...item, status: 'in_progress' } : item,
      ),
    )
    if(saved) setBoardTab('in_progress')
    return saved
  }

  async function deleteSeriesForever(item: MeetingSeries) {
    if (!canDeleteMeetingSeries(item, host, isAdmin)) return
    const saved=await setSeries((prev) => prev.filter((row) => row.id !== item.id))
    if(!saved) return
    if(simulating) revokeMeetingSeriesFiles(item)
    if (schedulingSeriesId === item.id) resetCompose()
    if (detail?.seriesId === item.id) setDetail(null)
    setDeleteSeriesId(null)
  }

  if(meetings.loading) return <p role="status" className="p-4 text-sm text-muted-foreground">회의를 불러오는 중입니다.</p>
  if(!rooms.length) return <div role="alert" className="space-y-2 p-4 text-sm"><p>{meetings.error ?? '등록된 회의실이 없습니다.'}</p><Button onClick={()=>void meetings.refresh()}>다시 불러오기</Button></div>
  return (
    <fieldset disabled={saving} className="min-w-0 space-y-4" aria-busy={saving}>
      {showHeading ? <PageHeader title="회의" /> : null}
      {simulating ? <p role="status" className="text-xs text-amber-800">화면 테스트 중입니다. 변경 내용은 실제 회의에 저장되지 않습니다.</p> : <p role="status" className="text-xs text-muted-foreground">{saving?'회의를 저장하는 중입니다.':'준비 회의는 비공개입니다. 일정을 확정하면 멤버에게 참석 요청과 내용을 공유합니다.'}</p>}
      {meetings.error ? <p role="alert" className="rounded-lg border border-danger/30 p-3 text-sm text-danger">{meetings.error}</p> : null}
      {membersQuery.error ? <p role="alert" className="text-sm text-danger">참석자 목록을 불러오지 못했습니다. {membersQuery.error.message}</p> : null}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">진행 회의</p>
            <Button type="button" size="sm" onClick={openCreate}>
              회의 생성
            </Button>
          </div>
          <div
            role="tablist"
            aria-label="회의 진행 상태"
            className="flex items-stretch gap-0.5 border-b border-border"
          >
            {(
              [
                ['in_progress', '진행중', openSeries.length],
                ['done', '완료', doneSeries.length],
              ] as const
            ).map(([value, label, count]) => {
              const selected = boardTab === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
                    selected
                      ? 'border-foreground font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setBoardTab(value)}
                >
                  {label} {count}
                </button>
              )
            })}
          </div>

          {boardSeries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {boardTab === 'in_progress'
                ? '진행 중인 회의가 없습니다. 회의 생성에서 주제·호스트·멤버를 정해 준비를 시작하세요.'
                : '완료한 회의가 없습니다.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {boardSeries.map((item) => {
                const rounds = [...item.rounds].sort(
                  (left, right) => left.round - right.round,
                )
                const responseRounds = item.status === 'in_progress' && item.phase !== 'preparing' && item.members.some(person => person.id === host.id)
                  ? rounds.filter(round => Boolean(round.confirmed ?? round.startsAt)) : []
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-[1_1_26rem] flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="max-w-full break-words text-sm font-medium">
                        {item.title}
                      </p>
                      {item.phase==='preparing'?<Badge variant="outline">준비 중 · 멤버 비공개</Badge>:null}
                      {item.status === 'done' ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatSeriesDateSpan(item) || '일정 없음'}
                        </span>
                      ) : null}
                      <span
                        aria-hidden
                        className="hidden h-4 w-px bg-border sm:block"
                      />
                      <MeetingAttendance series={item} round={[...item.rounds].reverse().find(row=>row.confirmed ?? row.startsAt)} actorId={host.id} simulating={simulating} compact onChat={chatWith} onGroup={()=>groupChat(item)}/>
                      <span
                        aria-hidden
                        className="hidden h-4 w-px bg-border sm:block"
                      />
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {rounds.map((round, index) => {
                          const gapDays = roundGapDays(rounds, round)
                          const caption = roundListCaption(round, item.members.map((person) => person.id))
                          return (
                          <span
                            key={round.id}
                            className="flex items-center gap-1"
                          >
                            {index > 0 ? (
                              <span
                                aria-hidden
                                className="text-muted-foreground"
                              >
                                |
                              </span>
                            ) : null}
                            <button
                              type="button"
                              title={
                                gapDays == null
                                  ? caption ?? undefined
                                  : formatRoundGapHint(gapDays)
                              }
                              className={cn(
                                'shrink-0 whitespace-nowrap rounded px-1 py-0.5 text-center font-medium hover:bg-muted',
                                caption &&
                                  'border border-dashed border-foreground/25 text-muted-foreground',
                                caption === '참석 불가' && 'border-danger/40 text-danger',
                                caption === '참석 응답 대기' && 'border-amber-400/70 text-amber-800',
                              )}
                              onClick={() =>
                                setDetail({
                                  seriesId: item.id,
                                  roundId: round.id,
                                })
                              }
                            >
                              {gapDays == null ? null : (
                                <span
                                  className={cn(
                                    'mr-1 text-[10px] font-normal text-emerald-700',
                                  )}
                                >
                                  {formatRoundGapLabel(gapDays)}
                                </span>
                              )}
                              <span className="block">{formatRoundLabel(round.round)} 회의</span>
                              {caption ? <span className="block text-[10px] font-normal">{caption}</span> : null}
                            </button>
                          </span>
                          )
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          const target = preferredDetailRound(item)
                          if (!target) return
                          setDetail({
                            seriesId: item.id,
                            roundId: target.id,
                          })
                        }}
                      >
                        상세
                      </Button>
                      {canDeleteMeetingSeries(item, host, isAdmin) ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger/10"
                          onClick={() => setDeleteSeriesId(item.id)}
                        >
                          <Trash2 className="size-3.5" />
                          삭제
                        </Button>
                      ) : null}
                    </div>
                    {responseRounds.length > 0 ? <div className="w-full space-y-2">
                      {responseRounds.map(round => <MeetingResponse key={round.id} round={round} actorId={host.id}
                        scheduleLabel={`${formatRoundLabel(round.round)} · ${round.startsAt.slice(0,10)} · ${formatBookedTimeRange(round.startsAt,round.durationMinutes ?? item.durationMinutes)} · ${meetingRoomName(round.roomId)}`}
                        onRespond={status => respond(item,round,status)}/>
                      )}
                    </div> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="회의 생성 닫기"
            onClick={() => setComposeOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-create-title"
            className={cn('relative z-10 max-h-[92vh] w-full overflow-auto rounded-xl border border-border bg-card p-5 shadow-lg',schedulingSeries?'max-w-6xl':'max-w-3xl')}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 id="meeting-create-title" className="text-base font-semibold">
                {schedulingSeries ? '회의 일정 확정' : '회의 생성'}
              </h2>
              <Button type="button" size="sm" variant="outline" onClick={() => setComposeOpen(false)}>
                닫기
              </Button>
            </div>
            <div ref={composeSectionRef} className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-[16rem] flex-1 space-y-1">
                <span className="text-xs font-medium">회의 주제</span>
                <Input
                  ref={topicRef}
                  value={schedulingSeries?.title ?? title}
                  placeholder="주제를 입력하세요"
                  aria-label="회의 주제"
                  disabled={Boolean(schedulingSeries)}
                  className={cn(
                    composePrompt &&
                      composeGaps.title &&
                      'ring-2 ring-amber-500',
                  )}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              {schedulingSeries ? <label className="w-36 space-y-1">
                <span className="text-xs font-medium">회의 시간</span>
                <Select
                  ref={durationRef}
                  className={cn(
                    'w-full',
                    composePrompt &&
                      composeGaps.duration &&
                      'ring-2 ring-amber-500',
                  )}
                  value={composeDuration == null ? '' : String(composeDuration)}
                  aria-label="회의 시간"
                  onChange={(event) => {
                    const value = event.target.value
                    setDurationMinutes(value ? Number(value) : null)
                  }}
                >
                  <option value="">선택</option>
                  {MEETING_DURATION_MINUTES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatMeetingDuration(minutes)}
                    </option>
                  ))}
                </Select>
              </label> : null}
              {schedulingSeries ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={resetCompose}
                >
                  취소
                </Button>
              ) : null}
            </div>
            {composePrompt ? (
              <p role="alert" className="text-[11px] font-medium text-amber-800">
                {composePrompt}
              </p>
            ) : null}

            <div className="grid items-start gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
              <div className="space-y-1">
                <p className="text-xs font-medium">호스트</p>
                <Select aria-label="호스트" value={composeHost.id} disabled={Boolean(schedulingSeries)} onChange={event=>{setSelectedHostId(event.target.value);setMembers(rows=>rows.filter(person=>person.id!==event.target.value))}}>
                  {directory.map(person=><option key={person.id} value={person.id}>{meetingPersonLabel(person)}{person.id===host.id?' · 나':''}</option>)}
                </Select>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium">멤버</p>
                {membersQuery.isLoading || departmentsQuery.isLoading ? (
                  <p className="text-[11px] text-muted-foreground">
                    멤버를 불러오는 중...
                  </p>
                ) : membersQuery.isError ? (
                  <p className="text-[11px] text-muted-foreground">
                    멤버 목록을 불러오지 못했습니다. 화면만 먼저 씁니다.
                  </p>
                ) : departmentGroups.length === 0 && members.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    추가할 멤버가 없습니다.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={memberPickerOpen}
                      aria-label="멤버 목록 열기"
                      className={cn(
                        'flex min-h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm',
                        composePrompt &&
                          composeGaps.members &&
                          'ring-2 ring-amber-500',
                      )}
                      onClick={() =>
                        setMemberPickerOpen((open) => !open)
                      }
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        setMemberPickerOpen((open) => !open)
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                        {members.length === 0 ? (
                          <span className="text-muted-foreground">
                            부서에서 멤버 추가
                          </span>
                        ) : (
                          members.map((person) => (
                            <span
                              key={person.id}
                              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium"
                            >
                              {meetingPersonLabel(person)}
                              <button
                                type="button"
                                className="rounded-full hover:bg-muted"
                                aria-label={`${person.name} 빼기`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleMember(person)
                                }}
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <span className="shrink-0 rounded-full p-0.5 text-muted-foreground">
                        <ChevronDown
                          className={cn(
                            'size-3.5 transition-transform',
                            memberPickerOpen && 'rotate-180',
                          )}
                        />
                      </span>
                    </div>
                    {memberPickerOpen ? (
                      <div className="rounded-md border border-border bg-card p-2">
                        <div className="flex overflow-x-auto pb-1">
                          {departmentGroups.map((group, index) => (
                            <div
                              key={group.id}
                              className={cn(
                                'min-w-[8.5rem] shrink-0 px-3',
                                index > 0 && 'border-l border-border',
                              )}
                            >
                              <button
                                type="button"
                                className="mb-1 w-full rounded px-1 py-0.5 text-left text-xs font-medium hover:bg-muted"
                                aria-pressed={group.members.every((person) => selectedMemberIds.includes(person.id))}
                                aria-label={`${group.name} 전체 선택`}
                                onClick={() => toggleDepartment(group.members)}
                              >
                                {group.name}
                              </button>
                              <ul className="space-y-0.5">
                                {group.members.map((person) => {
                                  const selected = selectedMemberIds.includes(
                                    person.id,
                                  )
                                  return (
                                    <li key={person.id}>
                                      <button
                                        type="button"
                                        aria-pressed={selected}
                                        aria-label={`${person.name}${person.position ? ` ${person.position}` : ''} 진행 중 ${ongoingMeetingCounts.get(person.id) ?? 0}건`}
                                        className={cn(
                                          'flex w-full flex-col rounded px-1.5 py-1 text-left text-xs transition-colors',
                                          selected
                                            ? 'bg-foreground text-background'
                                            : 'hover:bg-muted',
                                        )}
                                        onClick={() => toggleMember(person)}
                                      >
                                        <span className="font-medium">
                                          {person.name}
                                        </span>
                                        {person.position ? (
                                          <span
                                            className={cn(
                                              'text-[10px]',
                                              selected
                                                ? 'text-background/70'
                                                : 'text-muted-foreground',
                                            )}
                                          >
                                            {person.position}
                                          </span>
                                        ) : null}
                                        <span
                                          className={cn(
                                            'text-[10px]',
                                            selected
                                              ? 'text-background/70'
                                              : 'text-muted-foreground',
                                          )}
                                        >
                                          진행 중 {ongoingMeetingCounts.get(person.id) ?? 0}
                                        </span>
                                      </button>
                                    </li>
                                  )
                                })}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            {schedulingSeries ? <MeetingSchedulePicker rooms={rooms} value={scheduleChoice} onChange={setScheduleChoice} durationMinutes={composeDuration} attendees={attendees} seriesId={schedulingSeries.id}
              roundId={schedulingRoundId ?? findPendingRound(schedulingSeries)?.id} error={meetings.error}
              onConfirm={()=>bookSlot(scheduleChoice.roomId,scheduleChoice.dateKey,scheduleChoice.clock)}/> : null}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">{schedulingSeries?'일정을 확정하면 멤버에게 참석 요청이 전달됩니다. 일정 변경 시 응답이 초기화됩니다.':'준비 중에는 호스트와 생성자만 볼 수 있습니다. 안내·자료를 준비한 뒤 일정을 확정하세요.'}</p>
              {!schedulingSeries?<Button type="button" onClick={()=>void createDraft()}>준비 회의 생성</Button>:null}
            </div>
          </div>
        </div>
      </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4 p-4">
          <p className="text-sm font-medium">회의실 일정</p>

          <RoomScheduleBlock
            rooms={rooms}
            roomId={selectedRoomId}
            weeks={weeks}
            occupants={occupants}
            composeReady={false}
            durationMinutes={slotDurationMinutes}
            attendees={attendees}
            attendance={EMPTY_ATTENDANCE}
            now={now}
            readOnly
            onSelectRoom={setSelectedRoomId}
            onNeedCompose={() => undefined}
            onPickDay={() => undefined}
            onShiftRange={(direction) =>
              setRangeFromKey((current) =>
                shiftMeetingFromKey(current ?? todayKey, direction),
              )
            }
            currentUserId={host.id}
            onRemoveRound={() => undefined}
          />
        </CardContent>
      </Card>

      {detailSeries && detailRound ? (
        <MeetingDetailDrawer
          key={`${detailSeries.id}:${detailRound.id}`}
          series={detailSeries}
          round={detailRound}
          uploader={host}
          simulating={simulating}
          onRefresh={meetings.refresh}
          attendance={<MeetingAttendance series={detailSeries} round={detailRound} actorId={host.id} simulating={simulating} onChat={chatWith} onGroup={()=>groupChat(detailSeries)} onRespond={status=>respond(detailSeries,detailRound,status)}/> }
          saveError={meetings.error}
          onClose={closeDetail}
          onSave={async (notes,revision) => {
            const roundId = detailRound.id
            const saved=await setSeries((prev) =>
              prev.map((item) =>
                item.id === detailSeries.id
                  ? {
                      ...item,
                      rounds: item.rounds.map((row) =>
                        row.id === roundId ? { ...row, ...notes } : row,
                      ),
                    }
                  : item,
              ),
            {id:detailSeries.id,revision})
            return saved ? meetings.currentRevision(detailSeries.id) : null
          }}
          onScheduleNext={async () => {
            if(await planNextRound(detailSeries)) closeDetail()
          }}
          onBookTime={() => {
            scheduleNextRound(detailSeries,detailRound.id)
            closeDetail()
          }}
          onMarkDone={async () => {
            if(await markDone(detailSeries.id)) closeDetail()
          }}
          onReopen={async () => {
            if(await markInProgress(detailSeries.id)) closeDetail()
          }}
        />
      ) : null}

      {picker && pickerDay ? (
        <MeetingTimePickerDialog
          roomId={picker.roomId}
          day={pickerDay}
          composeReady={composeReady}
          durationMinutes={slotDurationMinutes}
          attendees={attendees}
          occupants={pickerOccupants}
          now={now}
          onClose={() => setPicker(null)}
          onBook={(clock) => {
            setScheduleChoice({roomId:picker.roomId,dateKey:picker.dateKey,clock})
            setPicker(null);setComposeOpen(true)
          }}
        />
      ) : null}

      {deleteSeries ? (
        <MeetingSeriesDeleteDialog
          series={deleteSeries}
          onClose={() => setDeleteSeriesId(null)}
          onConfirm={() => deleteSeriesForever(deleteSeries)}
        />
      ) : null}
    </fieldset>
  )
}

function WorkDayLane({
  slotPx,
  showAllLabels = false,
  quietMarks = false,
  className,
  onMouseLeave,
  children,
}: {
  slotPx: number
  showAllLabels?: boolean
  quietMarks?: boolean
  className?: string
  onMouseLeave?: () => void
  children?: ReactNode
}) {
  const height = TIME_PICKER_START_CLOCKS.length * slotPx
  const labelClocks = showAllLabels
    ? WORK_DAY_CLOCKS
    : WORK_DAY_CLOCKS.filter((clock) => TIME_PICKER_HOUR_CLOCKS.has(clock))
  return (
    <div
      className={cn('flex', className)}
      style={{ height }}
      onMouseLeave={onMouseLeave}
    >
      <div
        className={cn('relative shrink-0', showAllLabels ? 'w-11' : 'w-6')}
      >
        {labelClocks.map((clock) => {
          const axis = TIME_PICKER_AXIS.has(clock)
          return (
            <span
              key={clock}
              className={cn(
                'absolute left-0 -translate-y-1/2 tabular-nums',
                showAllLabels
                  ? axis
                    ? 'text-xs font-semibold text-foreground'
                    : 'text-[10px] text-muted-foreground'
                  : quietMarks
                    ? 'text-[9px] text-muted-foreground/45'
                    : axis
                      ? 'text-[9px] font-semibold text-foreground'
                      : 'text-[9px] text-muted-foreground',
              )}
              style={{
                top:
                  clock === '19:00' ? height : workDayLaneTop(clock, slotPx),
              }}
            >
              {timePickerMarkLabel(clock)}
            </span>
          )
        })}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="pointer-events-none absolute inset-0 z-[1]">
          {WORK_DAY_CLOCKS.map((clock) => {
            const hour = TIME_PICKER_HOUR_CLOCKS.has(clock)
            return (
              <div
                key={clock}
                className="absolute inset-x-0"
                style={{
                  top:
                    clock === '19:00'
                      ? undefined
                      : workDayLaneTop(clock, slotPx),
                  bottom: clock === '19:00' ? 0 : undefined,
                }}
              >
                <div
                  className={
                    hour
                      ? quietMarks
                        ? 'border-t border-foreground/15'
                        : 'border-t border-foreground/35'
                      : quietMarks
                        ? 'border-t border-dashed border-foreground/8'
                        : 'border-t border-dashed border-foreground/20'
                  }
                />
              </div>
            )
          })}
        </div>
        {children}
      </div>
    </div>
  )
}

function BookedMeetingBlock({
  item,
  slotPx,
  toneClass,
  trailing,
}: {
  item: MeetingDraft
  slotPx: number
  toneClass: string
  trailing?: ReactNode
}) {
  const start = timeFromDateTime(item.startsAt) || '09:00'
  const range = formatBookedTimeRange(item.startsAt, item.durationMinutes)
  const compact = slotPx < 24
  return (
    <div
      title={`${range} ${item.title}`}
      className={cn(
        'absolute inset-x-0 z-[3] flex overflow-hidden px-1 font-medium',
        compact
          ? 'items-center text-[9px] leading-none'
          : 'items-start pt-0.5 text-[10px] leading-tight',
        toneClass,
      )}
      style={{
        top: workDayLaneTop(start, slotPx),
        height: workDayLaneHeight(item.durationMinutes, slotPx),
      }}
    >
      <span className="min-w-0 flex-1 truncate">
        {range} {formatRoundLabel(item.round)} {item.title}
      </span>
      {trailing}
    </div>
  )
}

function RoomScheduleBlock({
  rooms,
  roomId,
  weeks,
  occupants,
  composeReady,
  durationMinutes,
  attendees,
  attendance,
  now,
  onSelectRoom,
  onPickDay,
  onNeedCompose,
  onShiftRange,
  onRemoveRound,
  currentUserId,
  readOnly = false,
}: {
  rooms: readonly MeetingRoom[]
  roomId: string
  weeks: MeetingDay[][]
  occupants: Map<string, MeetingDraft[]>
  composeReady: boolean
  durationMinutes: number
  attendees: MeetingPerson[]
  attendance: AttendanceEntry[]
  now: Date
  onSelectRoom: (roomId: string) => void
  onPickDay: (roomId: string, dateKey: string) => void
  onNeedCompose: () => void
  onShiftRange: (direction: -1 | 1) => void
  onRemoveRound: (roundId: string) => void
  currentUserId: string
  readOnly?: boolean
}) {
  const room = rooms.find((item) => item.id === roomId) ?? rooms[0]
  const tone = meetingRoomTone(room.id)
  const rangeDays = weeks.flat()

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div
        role="tablist"
        aria-label="회의실"
        className="flex items-end gap-0.5 bg-muted/40 px-2 pt-2"
      >
        {rooms.map((item) => {
          const selected = item.id === room.id
          const itemTone = meetingRoomTone(item.id)
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                'rounded-t-md border border-b-0 px-2.5 py-1.5 text-sm transition-colors',
                itemTone.chip,
                selected
                  ? 'relative z-10 -mb-px border-border font-semibold'
                  : 'border-transparent opacity-70 hover:opacity-100',
              )}
              onClick={() => onSelectRoom(item.id)}
            >
              {item.name}
            </button>
          )
        })}
      </div>
      <div
        className={cn(
          'flex items-center justify-center px-3 py-2',
          tone.label,
        )}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 2주"
            className="rounded p-0.5 hover:bg-black/10"
            onClick={() => onShiftRange(-1)}
          >
            <ChevronLeft className="size-4" />
          </button>
          <p className="min-w-[10.5rem] text-center text-sm font-medium opacity-90">
            {formatMeetingRangeLabel(rangeDays)}
          </p>
          <button
            type="button"
            aria-label="다음 2주"
            className="rounded p-0.5 hover:bg-black/10"
            onClick={() => onShiftRange(1)}
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr>
            <th className="w-[4.25rem] border border-foreground/30 bg-card px-2 py-2 text-left text-xs font-medium text-muted-foreground">
              주
            </th>
            {MEETING_WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                className="border border-foreground/30 px-1 py-2 text-center text-xs font-medium text-muted-foreground"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={week[0]?.key ?? weekIndex}>
              <th
                className={cn(
                  'border border-foreground/30 px-2 py-2 text-left text-xs font-semibold',
                  tone.label,
                )}
              >
                {weekIndex + 1}주
              </th>
              {week.map((day) => {
                const booked =
                  occupants.get(roomDayKey(room.id, day.key)) ?? EMPTY_DRAFTS
                const chipClasses = assignMeetingChipClasses(booked)
                const dayState = resolveDayState({
                  composeReady,
                  day,
                  durationMinutes,
                  attendees,
                  attendance,
                  occupants: booked,
                  now,
                })
                const isPast = dayState.blocks.some(
                  (block) => block.type === 'past',
                )
                const canOpen = !readOnly && (dayState.available || isPast)
                const needsCompose = !readOnly && !composeReady && !isPast
                const reason = formatDayBlockLabel(dayState.blocks)
                return (
                  <td
                    key={`${room.id}:${day.key}`}
                    className={cn(
                      'border border-foreground/30 p-1 align-top',
                      isPast ? 'bg-muted/70' : tone.cell,
                      canOpen || needsCompose
                        ? 'cursor-pointer'
                        : readOnly
                          ? 'cursor-default'
                          : 'cursor-not-allowed',
                      day.isToday && 'shadow-[inset_0_0_0_2px] shadow-emerald-500',
                    )}
                    onClick={() => {
                      if (canOpen) {
                        onPickDay(room.id, day.key)
                        return
                      }
                      if (needsCompose) onNeedCompose()
                    }}
                  >
                    <button
                      type="button"
                      disabled={!readOnly && !canOpen && !needsCompose}
                      title={
                        readOnly
                          ? `${room.name} ${day.month}/${day.day}`
                          : isPast
                          ? `${room.name} ${day.month}/${day.day} 지난 회의 보기`
                          : dayState.available
                            ? `${room.name} ${day.month}/${day.day} 9–19시 보기`
                            : needsCompose
                              ? '빠진 항목을 먼저 정하세요'
                              : reason || '이 날은 고를 수 없습니다'
                      }
                      aria-label={`${room.name} ${day.month}/${day.day}${
                        readOnly ? '' : isPast ? ' 지난 회의 보기' : ' 9–19시 보기'
                      }`}
                      className={cn(
                        'flex w-full flex-col items-center justify-center rounded px-1 py-1 text-center',
                        readOnly && 'cursor-default',
                        dayState.available && 'hover:bg-emerald-100/70',
                        needsCompose && 'hover:bg-amber-100/70',
                        isPast && 'hover:bg-muted',
                      )}
                      onClick={(event) => {
                        if (needsCompose) {
                          event.stopPropagation()
                          onNeedCompose()
                          return
                        }
                        if (!canOpen) return
                        onPickDay(room.id, day.key)
                      }}
                    >
                      <span
                        className={cn(
                          'rounded px-1 text-xs font-semibold',
                          day.isToday
                            ? 'border border-emerald-500 text-emerald-700'
                            : isPast
                              ? 'text-muted-foreground/80'
                              : 'text-muted-foreground',
                        )}
                      >
                        {day.month}/{day.day}
                      </span>
                    </button>
                    <WorkDayLane
                      className="mt-0.5"
                      slotPx={CALENDAR_SLOT_PX}
                      quietMarks
                    >
                      {booked.map((item) => (
                        <BookedMeetingBlock
                          key={item.id}
                          item={item}
                          slotPx={CALENDAR_SLOT_PX}
                          toneClass={
                            chipClasses.get(item.id) ?? 'bg-sky-200 text-sky-950'
                          }
                          trailing={
                            !readOnly && canRemoveBookedMeeting(item, { id: currentUserId }) ? (
                              <button
                                type="button"
                                className="shrink-0 rounded p-0.5 hover:bg-black/10"
                                aria-label={`${item.title} 삭제`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onRemoveRound(item.id)
                                }}
                              >
                                <Trash2 className="size-2.5" />
                              </button>
                            ) : null
                          }
                        />
                      ))}
                    </WorkDayLane>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MeetingTimePickerDialog({
  roomId,
  day,
  composeReady,
  durationMinutes,
  attendees,
  occupants,
  now,
  onClose,
  onBook,
}: {
  roomId: string
  day: MeetingDay
  composeReady: boolean
  durationMinutes: number
  attendees: MeetingPerson[]
  occupants: MeetingDraft[]
  now: Date
  onClose: () => void
  onBook: (clock: string) => void
}) {
  const [hoverStart, setHoverStart] = useState<string | null>(null)
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null)
  const blockedNoticeTimer = useRef<number | null>(null)
  const slotByClock = useMemo(
    () =>
      new Map(
        TIME_PICKER_START_CLOCKS.map((clock) => [
          clock,
          resolveStartTimeState({
            composeReady,
            weekend: day.isWeekend,
            dateKey: day.key,
            clock,
            durationMinutes,
            attendees,
            attendance: EMPTY_ATTENDANCE,
            occupants,
            now,
          }),
        ]),
      ),
    [
      attendees,
      composeReady,
      day.isWeekend,
      day.key,
      durationMinutes,
      now,
      occupants,
    ],
  )
  const hoverSlot = hoverStart ? slotByClock.get(hoverStart) : undefined
  const occupantClasses = useMemo(
    () => assignMeetingChipClasses(occupants),
    [occupants],
  )

  function showBlockedNotice() {
    setBlockedNotice('이 시각은 누를 수 없습니다.')
    if (blockedNoticeTimer.current !== null) {
      window.clearTimeout(blockedNoticeTimer.current)
    }
    blockedNoticeTimer.current = window.setTimeout(() => {
      setBlockedNotice(null)
      blockedNoticeTimer.current = null
    }, 2000)
  }

  useEffect(() => {
    return () => {
      if (blockedNoticeTimer.current !== null) {
        window.clearTimeout(blockedNoticeTimer.current)
      }
    }
  }, [])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-time-picker-title"
        className="relative z-10 flex max-h-[min(40rem,calc(100vh-2rem))] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2
              id="meeting-time-picker-title"
              className="text-base font-semibold tracking-tight"
            >
              {meetingRoomName(roomId)} · {day.month}/{day.day}{' '}
              <span className={day.isWeekend ? 'text-red-600' : undefined}>
                ({day.weekday})
              </span>
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              가능한 구간은 초록, 불가한 구간은 빨강으로 표시됩니다.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline">
                {formatMeetingDuration(durationMinutes)}
              </Badge>
              {composeReady ? null : (
                <Badge variant="muted">주제를 정하면 잡을 수 있습니다</Badge>
              )}
            </div>
            {blockedNotice ? (
              <p
                role="status"
                aria-live="polite"
                className="mt-2 text-sm text-muted-foreground"
              >
                {blockedNotice}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="overflow-hidden rounded-lg border border-border px-1 pb-1 pt-2.5">
            <WorkDayLane
              slotPx={TIME_PICKER_SLOT_PX}
              showAllLabels
              onMouseLeave={() => setHoverStart(null)}
            >
              {TIME_PICKER_START_CLOCKS.map((clock) => {
                const slot = slotByClock.get(clock)
                if (!slot || slot.available) return null
                return (
                  <div
                    key={`blocked-${clock}`}
                    className="pointer-events-none absolute inset-x-0 z-0 bg-red-300/35"
                    style={{
                      top: workDayLaneTop(clock, TIME_PICKER_SLOT_PX),
                      height: TIME_PICKER_SLOT_PX,
                    }}
                  />
                )
              })}
              {occupants.map((item) => (
                <BookedMeetingBlock
                  key={item.id}
                  item={item}
                  slotPx={TIME_PICKER_SLOT_PX}
                  toneClass={
                    occupantClasses.get(item.id) ?? 'bg-sky-200 text-sky-950'
                  }
                />
              ))}
              {hoverStart && hoverSlot ? (
                <div
                  className={cn(
                    'pointer-events-none absolute inset-x-0 z-[4] overflow-hidden px-1 text-[10px] font-medium leading-tight',
                    hoverSlot.available
                      ? 'bg-emerald-400/40 text-emerald-950'
                      : 'bg-red-400/40 text-red-950',
                  )}
                  style={{
                    top: workDayLaneTop(hoverStart, TIME_PICKER_SLOT_PX),
                    height: workDayLaneHeight(
                      durationMinutes,
                      TIME_PICKER_SLOT_PX,
                    ),
                  }}
                >
                  {formatMeetingClockRange(hoverStart, durationMinutes)}
                  {hoverSlot.available ? null : ` · ${hoverSlot.reason}`}
                </div>
              ) : null}
              {TIME_PICKER_START_CLOCKS.map((clock) => {
                const slot = slotByClock.get(clock)
                if (!slot) return null
                const rangeLabel = formatMeetingClockRange(
                  clock,
                  durationMinutes,
                )
                return (
                  <button
                    key={clock}
                    type="button"
                    aria-disabled={!slot.available}
                    aria-label={
                      slot.available
                        ? `${clock} ${rangeLabel} 예약`
                        : `${clock} ${slot.reason || rangeLabel}`
                    }
                    className={cn(
                      'absolute inset-x-0 z-[3] bg-transparent',
                      slot.available ? 'cursor-pointer' : 'cursor-not-allowed',
                    )}
                    style={{
                      top: workDayLaneTop(clock, TIME_PICKER_SLOT_PX),
                      height: TIME_PICKER_SLOT_PX,
                    }}
                    onMouseEnter={() => setHoverStart(clock)}
                    onFocus={() => setHoverStart(clock)}
                    onClick={() => {
                      if (!slot.available) {
                        showBlockedNotice()
                        return
                      }
                      onBook(clock)
                    }}
                  />
                )
              })}
            </WorkDayLane>
          </div>
        </div>

        <div className="flex shrink-0 justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
        </div>
      </div>
    </div>
  )
}

function formatPrepFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function MeetingDetailDrawer({
  series,
  round,
  uploader,
  simulating,
  onRefresh,
  attendance,
  saveError,
  onClose,
  onSave,
  onScheduleNext,
  onBookTime,
  onMarkDone,
  onReopen,
}: {
  series: MeetingSeries
  round: MeetingRound
  uploader: MeetingPerson
  simulating: boolean
  attendance: ReactNode
  onRefresh: () => Promise<void>
  saveError?: string | null
  onClose: () => void
  onSave: (notes: {
    prepMaterials: MeetingPrepFile[]
    content: string
    result: string
  },revision:number) => Promise<number|null>
  onScheduleNext: () => Promise<void>
  onBookTime: () => void
  onMarkDone: () => Promise<void>
  onReopen: () => Promise<void>
}) {
  const pending = isPendingRound(round)
  const isHost=series.host.id===uploader.id
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [prepMaterials, setPrepMaterials] = useState(round.prepMaterials)
  const [content, setContent] = useState(round.content)
  const [result, setResult] = useState(round.result)
  const [busy,setBusy]=useState(false),[operationError,setOperationError]=useState<string|null>(null)
  const editRevision=useRef(series.revision ?? 0)
  useEffect(()=>setPrepMaterials(round.prepMaterials),[round.prepMaterials])
  const previousRounds = useMemo(
    () =>
      [...series.rounds]
        .filter((item) => item.round < round.round)
        .sort((left, right) => left.round - right.round),
    [round.round, series.rounds],
  )
  const prepGroups = useMemo(
    () => groupPrepMaterialsByUploader(prepMaterials),
    [prepMaterials],
  )

  async function persistNotes(
    notes?: {
      prepMaterials: MeetingPrepFile[]
      content: string
      result: string
    },
  ) {
    const revision=await onSave(notes ?? { prepMaterials, content, result },editRevision.current)
    if(revision===null) {setOperationError('회의를 저장하지 못했습니다. 입력 내용은 유지됩니다.');return false}
    editRevision.current=revision
    return true
  }

  async function run(action:()=>Promise<void>) {
    if(busy) return
    setBusy(true);setOperationError(null)
    try{await action()}catch(error){
      console.warn('[meetings] 회의 상세 작업 실패',{error})
      setOperationError(error instanceof Error?error.message:'회의 작업에 실패했습니다.')
    }finally{setBusy(false)}
  }
  function closeDrawer() {
    void run(async()=>{if(await persistNotes()) onClose()})
  }

  async function addPrepFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files=Array.from(fileList)
    await run(async()=>{
      const next:MeetingPrepFile[]=[]
      try {
        for(const file of files) next.push(simulating
          ? {id:newMeetingId(),name:file.name,size:file.size,type:file.type,url:URL.createObjectURL(file),uploadedBy:uploader}
          : await uploadMeetingFile(round.id,file,uploader))
      }finally{
        // 여러 파일 중 일부만 성공해도 성공한 자료는 재조회해 보여 준다.
        if(!simulating) await onRefresh()
        const updated=[...prepMaterials,...next]
        setPrepMaterials(updated)
        if(simulating) await persistNotes({prepMaterials:updated,content,result})
      }
    })
  }

  function removePrepFile(fileId: string) {
    const found = prepMaterials.find((file) => file.id === fileId)
    if (!found || !canRemovePrepFile(found, uploader)) return
    void run(async()=>{
      if(!simulating) await removeMeetingFile(fileId)
      if (found.url.startsWith('blob:')) URL.revokeObjectURL(found.url)
      const updated=prepMaterials.filter(file=>file.id!==fileId)
      setPrepMaterials(updated)
      if(simulating) await persistNotes({prepMaterials:updated,content,result})
      else await onRefresh()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        disabled={busy}
        className="absolute inset-0 bg-black/40"
        onClick={closeDrawer}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-detail-title"
        aria-busy={busy}
        className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-border bg-card shadow-xl"
      >
        <fieldset disabled={busy} className="contents">
        {operationError || saveError ? <div className="shrink-0 space-y-2 p-3"><p role="alert" className="text-sm text-danger">{saveError ?? operationError}</p><Button variant="outline" onClick={onClose}>저장하지 않고 닫기</Button></div> : null}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {formatMeetingDuration(round.durationMinutes ?? series.durationMinutes)}
              </Badge>
              <Badge variant={series.status === 'done' ? 'muted' : 'default'}>
                {series.status === 'done'
                  ? '완료'
                  : pending
                    ? '다음 차 예정'
                    : formatRoundLabel(round.round)}
              </Badge>
            </div>
            <h2
              id="meeting-detail-title"
              className="truncate text-lg font-semibold tracking-tight"
            >
              {series.title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {series.host.name}
              {series.members.length > 0
                ? ` | ${series.members.map((person) => person.name).join(', ')}`
                : ''}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            onClick={closeDrawer}
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {series.phase==='preparing'?<p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">준비 중 · 호스트와 생성자만 볼 수 있습니다. 안내와 자료를 준비한 뒤 호스트가 일정을 확정하면 멤버에게 공개됩니다.</p>:null}
          {!pending?<p className="rounded-lg bg-muted px-3 py-2 text-sm font-medium">{round.startsAt.slice(0,10)} · {formatBookedTimeRange(round.startsAt,round.durationMinutes ?? series.durationMinutes)} · {meetingRoomName(round.roomId)}</p>:null}
          {attendance}
          {previousRounds.length > 0 ? (
            <section className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                지난 회의 결과
              </h3>
              <div className="space-y-2">
                {previousRounds.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                  >
                    <p className="text-xs font-medium text-muted-foreground">
                      {formatRoundListLabel(item)}
                    </p>
                    {item.content.trim() ? (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                        {item.content}
                      </p>
                    ) : null}
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {item.result.trim() || '적힌 결과가 없습니다.'}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">
                {pending ? '회의 안내' : '회의 내용'}
              </h3>
              {series.status === 'in_progress' ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void run(async () => { await persistNotes() })}>저장</Button>
              ) : null}
            </div>
            <Textarea
              value={content}
              rows={10}
              placeholder="회의에서 나온 내용을 빠짐없이 적습니다."
              aria-label={pending?'회의 안내':'회의 내용'}
              onChange={(event) => setContent(event.target.value)}
            />
          </section>
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-medium text-muted-foreground">
                  사전 준비 자료
                </h3>
                <p className="text-[11px] text-muted-foreground">
                  올리면 바로 저장됩니다. 삭제는 올린 사람만 할 수 있습니다.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                올리기
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  void addPrepFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
            {prepGroups.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                올린 파일이 없습니다.
              </p>
            ) : (
              <div className="space-y-3">
                {prepGroups.map((group) => (
                  <div
                    key={group.person.id}
                    className="overflow-hidden rounded-lg border border-border"
                  >
                    <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-xs font-medium">
                      {meetingPersonLabel(group.person)}
                    </p>
                    <ul>
                      {group.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {file.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              {formatPrepFileSize(file.size)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={()=>void run(async()=>{
                              if(file.storagePath) await downloadMeetingFile(file)
                              else {const link=document.createElement('a');link.href=file.url;link.download=file.name;link.click()}
                            })}
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={`${file.name} 받기`}
                          >
                            <Download className="size-3.5" />
                          </button>
                          {canRemovePrepFile(file, uploader) ? (
                            <button
                              type="button"
                              className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                              aria-label={`${file.name} 삭제`}
                              onClick={() => removePrepFile(file.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
          {!pending ? <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              회의 결과
            </h3>
            <Textarea
              value={result}
              rows={5}
              placeholder="결정 사항, 담당, 기한을 적습니다."
              aria-label="회의 결과"
              onChange={(event) => setResult(event.target.value)}
            />
          </section> : null}
        </div>

        {series.status === 'in_progress' ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={closeDrawer}>닫기</Button>
            {isHost && !pending ? <Button type="button" variant="outline" onClick={()=>void run(async()=>{if(await persistNotes()) onBookTime()})}>일정 변경</Button>:null}
            {isHost ? pending ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void run(async()=>{if(await persistNotes()) onBookTime()})}
              >
                일정 확정하기
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void run(async()=>{if(await persistNotes()) await onScheduleNext()})}
              >
                저장하고 다음 회의 진행
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void run(async()=>{if(await persistNotes()) await onMarkDone()})}
            >
              <Check className="size-3.5" />
              회의건 종료
            </Button>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void run(async()=>{if(await persistNotes()) await onReopen()})}
            >
              다시 진행중으로
            </Button>
          </div>
        )}
        </fieldset>
      </div>
    </div>
  )
}

const DELETE_UNLOCK_MS = 4000

function MeetingSeriesDeleteDialog({
  series,
  onClose,
  onConfirm,
}: {
  series: MeetingSeries
  onClose: () => void
  onConfirm: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [acknowledged, setAcknowledged] = useState(false)
  const [typed, setTyped] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const phrase = meetingDeleteConfirmPhrase(series.title)
  const impact = meetingSeriesDeleteImpact(series)
  const typedOk = typed.trim() === phrase

  useEffect(() => {
    if (step !== 2 || !typedOk) {
      setUnlocked(false)
      return
    }
    const timer = window.setTimeout(() => setUnlocked(true), DELETE_UNLOCK_MS)
    return () => window.clearTimeout(timer)
  }, [step, typedOk])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="닫기"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-delete-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <h2
          id="meeting-delete-title"
          className="text-base font-semibold text-danger"
        >
          회의건 영구 삭제
        </h2>
        <p className="mt-2 text-sm">
          <span className="font-medium">「{series.title}」</span> 건과 연결된
          것을 모두 지웁니다. 되돌릴 수 없습니다.
        </p>
        <ul className="mt-3 space-y-1 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <li>차수 {impact.rounds}개</li>
          <li>달력 일정 {impact.scheduled}칸</li>
          <li>사전 준비 자료 {impact.files}개</li>
          <li>적어 둔 내용·결과 {impact.notes}차</li>
        </ul>
        {step === 1 ? (
          <>
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                자료, 일정, 회의 내용이 모두 사라지고 복구할 수 없음을
                확인했습니다.
              </span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={!acknowledged}
                onClick={() => setStep(2)}
              >
                다음
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="mt-4 block space-y-1 text-sm">
              <span className="text-muted-foreground">
                삭제하려면 회의 주제를 그대로 입력하세요.
              </span>
              <Input
                value={typed}
                autoComplete="off"
                autoFocus
                placeholder={phrase}
                aria-label="삭제 확인 주제"
                onChange={(event) => setTyped(event.target.value)}
              />
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              {typedOk
                ? unlocked
                  ? '이제 영구 삭제를 누를 수 있습니다.'
                  : '입력은 맞습니다. 실수가 아니도록 잠시 기다립니다.'
                : '주제가 일치해야 다음으로 갑니다.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onClose}>
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                variant="danger"
                disabled={!typedOk || !unlocked}
                onClick={onConfirm}
              >
                영구 삭제
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
