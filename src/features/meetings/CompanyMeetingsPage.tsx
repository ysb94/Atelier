import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import {
  listDepartments,
  listManageableProfiles,
  type Department,
  type Profile,
} from '@/lib/supabase/profiles'
import { isCompanyAdmin } from '@/lib/company/capabilities'
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
  seriesToDrafts,
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

const EMPTY_PROFILES = emptyList<Profile>()
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
  return `meeting-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const DEMO_MEMBERS: MeetingPerson[] = [
  { id: 'demo-member-1', name: '김민지', position: '대리' },
  { id: 'demo-member-2', name: '이준호', position: '사원' },
]

function createDemoMeetingSeries(
  host: MeetingPerson,
  todayKey: string,
): MeetingSeries[] {
  const days = listMeetingDays(todayKey, 10, todayKey)
  const first = days[0]?.key ?? todayKey
  const second = days[2]?.key ?? first
  const third = days[4]?.key ?? second
  return [
    {
      id: 'demo-series-ops',
      title: '주간 운영 점검',
      host,
      members: DEMO_MEMBERS,
      status: 'in_progress',
      durationMinutes: 90,
      rounds: [
        {
          id: 'demo-r1',
          round: 1,
          startsAt: combineDateTime(first, '16:30'),
          roomId: 'room-1',
          quarterId: quarterFromTime('16:30'),
          prepMaterials: [],
          content: '재고 마감 요일과 샘플 일정을 다시 맞출지 논의했다.',
          result: '재고 기준을 금요일로 맞춘다. 샘플은 기획이 목록을 올린다.',
        },
        {
          id: 'demo-r2',
          round: 2,
          startsAt: combineDateTime(second, '10:00'),
          roomId: 'room-2',
          quarterId: quarterFromTime('10:00'),
          prepMaterials: [],
          content: '샘플 목록을 보고 촬영 일정을 잡았다.',
          result: '샘플 촬영은 다음 주 화요일. 담당은 디자인.',
        },
        {
          id: 'demo-r3',
          round: 3,
          startsAt: combineDateTime(third, '14:30'),
          roomId: 'room-1',
          quarterId: quarterFromTime('14:30'),
          ...emptyRoundNotes(),
        },
      ],
    },
    {
      id: 'demo-series-done',
      title: '시즌 킥오프',
      host,
      members: DEMO_MEMBERS.slice(0, 1),
      status: 'done',
      durationMinutes: 60,
      rounds: [
        {
          id: 'demo-d1',
          round: 1,
          startsAt: combineDateTime(first, '09:00'),
          roomId: 'room-2',
          quarterId: quarterFromTime('09:00'),
          prepMaterials: [],
          content: '시즌 콘셉트와 일정 초안을 공유했다.',
          result: '콘셉트는 A안. 런칭 주는 10월 둘째 주.',
        },
        {
          id: 'demo-d2',
          round: 2,
          startsAt: combineDateTime(second, '13:00'),
          roomId: 'room-1',
          quarterId: quarterFromTime('13:00'),
          ...emptyRoundNotes(),
        },
      ],
    },
  ]
}

export function CompanyMeetingsPage() {
  useRenderWatch('CompanyMeetingsPage')

  const { profile } = useAuth()
  const topicRef = useRef<HTMLInputElement>(null)
  const durationRef = useRef<HTMLSelectElement>(null)
  const composeSectionRef = useRef<HTMLDivElement>(null)
  const [series, setSeries] = useState<MeetingSeries[]>([])
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
  const [deleteSeriesId, setDeleteSeriesId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState(MEETING_ROOMS[0].id)
  const demoSeeded = useRef(false)

  const host = useMemo<MeetingPerson>(() => {
    if (!profile) return LOCAL_HOST
    return profileToMeetingPerson(profile)
  }, [profile])
  const isAdmin = isCompanyAdmin(profile)

  const membersQuery = useQuery({
    queryKey: ['profiles', 'manageable'],
    queryFn: listManageableProfiles,
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const profiles = membersQuery.data ?? EMPTY_PROFILES
  const departments = departmentsQuery.data ?? EMPTY_DEPARTMENTS

  useEffect(() => {
    if (!membersQuery.isError) return
    console.warn('[meetings] 멤버 목록을 불러오지 못함', {
      error: membersQuery.error,
    })
  }, [membersQuery.error, membersQuery.isError])

  const directory = useMemo(() => {
    const people = profiles
      .filter((row) => row.status === 'active')
      .map(profileToMeetingPerson)
    if (people.some((person) => person.id === host.id)) return people
    return [host, ...people]
  }, [host, profiles])

  const selectedMemberIds = useMemo(
    () => members.map((person) => person.id),
    [members],
  )
  const departmentGroups = useMemo(
    () => groupMeetingMembersByDepartment(directory, host.id, departments),
    [departments, directory, host.id],
  )

  const todayKey = toDateKey(new Date())

  useEffect(() => {
    if (demoSeeded.current) return
    demoSeeded.current = true
    setSeries(createDemoMeetingSeries(host, todayKey))
  }, [host, todayKey])

  const fromKey = rangeFromKey ?? todayKey
  const days = useMemo(
    () => listMeetingDays(fromKey, visibleDays, todayKey),
    [fromKey, todayKey, visibleDays],
  )
  const weeks = useMemo(() => chunkMeetingDays(days), [days])
  const items = useMemo(() => seriesToDrafts(series), [series])
  const occupants = useMemo(() => groupMeetingsByRoomDay(items), [items])
  const pickerDay = useMemo(
    () => (picker ? days.find((day) => day.key === picker.dateKey) : undefined),
    [days, picker],
  )
  const pickerOccupants = picker
    ? (occupants.get(roomDayKey(picker.roomId, picker.dateKey)) ?? EMPTY_DRAFTS)
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
    ? (findPendingRound(schedulingSeries)?.round ??
      nextRoundNumber(schedulingSeries))
    : 1
  const composeTitle = (schedulingSeries?.title ?? title).trim()
  const composeDuration = durationMinutes
  const composeHost = schedulingSeries?.host ?? host
  const composeMembers = members
  const composeGaps = meetingComposeGaps({
    title: composeTitle,
    durationMinutes: composeDuration,
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

  function resetCompose() {
    setTitle('')
    setDurationMinutes(null)
    setMembers([])
    setMemberPickerOpen(false)
    setSchedulingSeriesId(null)
    setComposePrompt(null)
    setPicker(null)
  }

  function showComposeGaps() {
    setComposePrompt(composeGapMessage)
    composeSectionRef.current?.scrollIntoView({
      block: 'start',
      behavior: 'smooth',
    })
    if (composeGaps.title) {
      topicRef.current?.focus()
      return
    }
    if (composeGaps.duration) {
      durationRef.current?.focus()
      return
    }
    if (composeGaps.members) setMemberPickerOpen(true)
  }

  function bookSlot(nextRoomId: string, dateKey: string, startClock: string) {
    if (!composeReady) return
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
      ...emptyRoundNotes(),
    }
    if (schedulingSeries) {
      const pending = findPendingRound(schedulingSeries)
      setSeries((prev) =>
        prev.map((item) => {
          if (item.id !== schedulingSeries.id) return item
          if (!pending) {
            return {
              ...item,
              members: composeMembers,
              durationMinutes: slotDurationMinutes,
              rounds: [...item.rounds, round],
            }
          }
          return {
            ...item,
            members: composeMembers,
            durationMinutes: slotDurationMinutes,
            rounds: item.rounds.map((row) =>
              row.id === pending.id
                ? {
                    ...row,
                    startsAt: round.startsAt,
                    roomId: round.roomId,
                    quarterId: round.quarterId,
                  }
                : row,
            ),
          }
        }),
      )
    } else {
      setSeries((prev) => [
        {
          id: newMeetingId(),
          title: composeTitle,
          host: composeHost,
          members: composeMembers,
          status: 'in_progress',
          durationMinutes: slotDurationMinutes,
          rounds: [round],
        },
        ...prev,
      ])
    }
    resetCompose()
  }

  function removeRound(roundId: string) {
    setSeries((prev) =>
      prev
        .map((item) => {
          if (item.host.id !== host.id) return item
          if (!item.rounds.some((round) => round.id === roundId)) return item
          return {
            ...item,
            rounds: item.rounds.filter((round) => round.id !== roundId),
          }
        })
        .filter((item) => item.rounds.length > 0),
    )
  }

  function scheduleNextRound(item: MeetingSeries) {
    setBoardTab('in_progress')
    setSchedulingSeriesId(item.id)
    setTitle(item.title)
    setDurationMinutes(null)
    setMembers(item.members)
    setComposePrompt(null)
    setMemberPickerOpen(false)
    window.setTimeout(() => {
      composeSectionRef.current?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
      durationRef.current?.focus()
    }, 0)
  }

  function planNextRound(item: MeetingSeries): string {
    const existing = findPendingRound(item)
    if (existing) return existing.id
    const nextId = newMeetingId()
    setSeries((prev) =>
      prev.map((row) =>
        row.id === item.id ? appendPendingRound(row, nextId) : row,
      ),
    )
    return nextId
  }

  function markDone(seriesId: string) {
    setSeries((prev) =>
      prev.map((item) =>
        item.id === seriesId ? { ...item, status: 'done' } : item,
      ),
    )
    if (schedulingSeriesId === seriesId) resetCompose()
    setBoardTab('done')
  }

  function markInProgress(seriesId: string) {
    setSeries((prev) =>
      prev.map((item) =>
        item.id === seriesId ? { ...item, status: 'in_progress' } : item,
      ),
    )
    setBoardTab('in_progress')
  }

  function deleteSeriesForever(item: MeetingSeries) {
    if (!canDeleteMeetingSeries(item, host, isAdmin)) return
    revokeMeetingSeriesFiles(item)
    setSeries((prev) => prev.filter((row) => row.id !== item.id))
    if (schedulingSeriesId === item.id) resetCompose()
    if (detail?.seriesId === item.id) setDetail(null)
    setDeleteSeriesId(null)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="회의" />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">진행 회의</p>
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
                ? '진행 중인 회의가 없습니다. 아래에서 주제, 회의 시간, 멤버를 정한 뒤 날짜를 누르세요.'
                : '완료한 회의가 없습니다.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {boardSeries.map((item) => {
                const rounds = [...item.rounds].sort(
                  (left, right) => left.round - right.round,
                )
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <p className="shrink-0 text-sm font-medium">
                        {item.title}
                      </p>
                      {item.status === 'done' ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatSeriesDateSpan(item) || '일정 없음'}
                        </span>
                      ) : null}
                      <span
                        aria-hidden
                        className="hidden h-4 w-px bg-border sm:block"
                      />
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-950">
                          <span
                            aria-hidden
                            className="size-1.5 rounded-full bg-sky-600"
                          />
                          {item.host.name}
                        </span>
                        {item.members.map((person) => (
                          <span
                            key={person.id}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="size-1.5 rounded-full bg-muted-foreground/50"
                            />
                            {person.name}
                          </span>
                        ))}
                      </div>
                      <span
                        aria-hidden
                        className="hidden h-4 w-px bg-border sm:block"
                      />
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {rounds.map((round, index) => {
                          const gapDays = roundGapDays(rounds, round)
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
                                  ? undefined
                                  : formatRoundGapHint(gapDays)
                              }
                              className={cn(
                                'rounded px-1 py-0.5 font-medium hover:bg-muted',
                                isPendingRound(round) &&
                                  'border border-dashed border-foreground/25 text-muted-foreground',
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
                              {formatRoundListLabel(round)}
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
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
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
              <label className="w-36 space-y-1">
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
              </label>
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
                <div className="flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm">
                  {meetingPersonLabel(schedulingSeries?.host ?? host)} · 나
                </div>
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
                        <div className="flex gap-3 overflow-x-auto pb-1">
                          {departmentGroups.map((group) => (
                            <div
                              key={group.id}
                              className="min-w-[8.5rem] shrink-0"
                            >
                              <p className="mb-1 text-xs font-medium">
                                {group.name}
                              </p>
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
          </div>

          <div>
            <p className="text-sm font-medium">회의실 일정</p>
          </div>

          <RoomScheduleBlock
            rooms={MEETING_ROOMS}
            roomId={selectedRoomId}
            weeks={weeks}
            occupants={occupants}
            composeReady={composeReady}
            durationMinutes={slotDurationMinutes}
            attendees={attendees}
            attendance={EMPTY_ATTENDANCE}
            now={now}
            onSelectRoom={setSelectedRoomId}
            onNeedCompose={showComposeGaps}
            onPickDay={(roomId, dateKey) => setPicker({ roomId, dateKey })}
            onShiftRange={(direction) =>
              setRangeFromKey((current) =>
                shiftMeetingFromKey(current ?? todayKey, direction),
              )
            }
            currentUserId={host.id}
            onRemoveRound={removeRound}
          />
        </CardContent>
      </Card>

      {detailSeries && detailRound ? (
        <MeetingDetailDrawer
          key={`${detailSeries.id}:${detailRound.id}`}
          series={detailSeries}
          round={detailRound}
          uploader={host}
          onClose={() => setDetail(null)}
          onSave={(notes) => {
            const roundId = detailRound.id
            setSeries((prev) =>
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
            )
          }}
          onScheduleNext={() => {
            planNextRound(detailSeries)
            setDetail(null)
          }}
          onBookTime={() => {
            scheduleNextRound(detailSeries)
            setDetail(null)
          }}
          onMarkDone={() => {
            markDone(detailSeries.id)
            setDetail(null)
          }}
          onReopen={() => {
            markInProgress(detailSeries.id)
            setDetail(null)
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
          onBook={(clock) =>
            bookSlot(picker.roomId, picker.dateKey, clock)
          }
        />
      ) : null}

      {deleteSeries ? (
        <MeetingSeriesDeleteDialog
          series={deleteSeries}
          onClose={() => setDeleteSeriesId(null)}
          onConfirm={() => deleteSeriesForever(deleteSeries)}
        />
      ) : null}
    </div>
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
                const canOpen = dayState.available || isPast
                const needsCompose = !composeReady && !isPast
                const reason = formatDayBlockLabel(dayState.blocks)
                return (
                  <td
                    key={`${room.id}:${day.key}`}
                    className={cn(
                      'border border-foreground/30 p-1 align-top',
                      isPast ? 'bg-muted/70' : tone.cell,
                      canOpen || needsCompose
                        ? 'cursor-pointer'
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
                      disabled={!canOpen && !needsCompose}
                      title={
                        isPast
                          ? `${room.name} ${day.month}/${day.day} 지난 회의 보기`
                          : dayState.available
                            ? `${room.name} ${day.month}/${day.day} 9–19시 보기`
                            : needsCompose
                              ? '빠진 항목을 먼저 정하세요'
                              : reason || '이 날은 고를 수 없습니다'
                      }
                      aria-label={`${room.name} ${day.month}/${day.day} ${
                        isPast ? '지난 회의 보기' : '9–19시 보기'
                      }`}
                      className={cn(
                        'flex w-full flex-col items-center justify-center rounded px-1 py-1 text-center',
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
                            canRemoveBookedMeeting(item, { id: currentUserId }) ? (
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
  onClose: () => void
  onSave: (notes: {
    prepMaterials: MeetingPrepFile[]
    content: string
    result: string
  }) => void
  onScheduleNext: () => void
  onBookTime: () => void
  onMarkDone: () => void
  onReopen: () => void
}) {
  const pending = isPendingRound(round)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [prepMaterials, setPrepMaterials] = useState(round.prepMaterials)
  const [content, setContent] = useState(round.content)
  const [result, setResult] = useState(round.result)
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

  function persistNotes(
    notes?: {
      prepMaterials: MeetingPrepFile[]
      content: string
      result: string
    },
  ) {
    onSave(notes ?? { prepMaterials, content, result })
  }

  function closeDrawer() {
    persistNotes()
    onClose()
  }

  function addPrepFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const next = Array.from(fileList).map((file) => ({
      id: newMeetingId(),
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
      uploadedBy: uploader,
    }))
    const updated = [...prepMaterials, ...next]
    setPrepMaterials(updated)
    persistNotes({ prepMaterials: updated, content, result })
  }

  function removePrepFile(fileId: string) {
    const found = prepMaterials.find((file) => file.id === fileId)
    if (!found || !canRemovePrepFile(found, uploader)) return
    if (found.url.startsWith('blob:')) {
      URL.revokeObjectURL(found.url)
    }
    const updated = prepMaterials.filter((file) => file.id !== fileId)
    setPrepMaterials(updated)
    persistNotes({ prepMaterials: updated, content, result })
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="닫기"
        className="absolute inset-0 bg-black/40"
        onClick={closeDrawer}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="meeting-detail-title"
        className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {formatMeetingDuration(series.durationMinutes)}
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
                  addPrepFiles(event.target.files)
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
                          <a
                            href={file.url}
                            download={file.name}
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={`${file.name} 받기`}
                          >
                            <Download className="size-3.5" />
                          </a>
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
          {pending ? null : (
            <>
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  회의 내용
                </h3>
                <Textarea
                  value={content}
                  rows={10}
                  placeholder="회의에서 나온 내용을 빠짐없이 적습니다."
                  aria-label="회의 내용"
                  onChange={(event) => setContent(event.target.value)}
                />
              </section>
              <section className="space-y-2">
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
              </section>
            </>
          )}
        </div>

        {series.status === 'in_progress' ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">
            {pending ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  persistNotes()
                  onBookTime()
                }}
              >
                회의 시간 잡기
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  persistNotes()
                  onScheduleNext()
                }}
              >
                저장하고 다음 회의 진행
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                persistNotes()
                onMarkDone()
              }}
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
              onClick={() => {
                persistNotes()
                onReopen()
              }}
            >
              다시 진행중으로
            </Button>
          </div>
        )}
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
