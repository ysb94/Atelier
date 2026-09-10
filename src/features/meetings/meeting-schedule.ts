/** 회사 회의실 일정 UI용 모델. 저장 없이 화면만 쓴다. */

export const MEETING_WEEKDAY_LABELS = ['월', '화', '수', '목', '금'] as const
export const MEETING_WEEKDAY_COUNT = MEETING_WEEKDAY_LABELS.length
export const DEFAULT_MEETING_VISIBLE_DAYS = MEETING_WEEKDAY_COUNT * 2
export const MEETING_RANGE_STEP_DAYS = MEETING_WEEKDAY_COUNT
export const MEETING_RANGE_JUMP_DAYS = 14
export const MAX_MEETING_VISIBLE_DAYS = MEETING_WEEKDAY_COUNT * 8

export type MeetingRoom = {
  id: string
  name: string
}

/**
 * 회사 회의실.
 * 지금은 2개이고, 여기만 추가하면 일정 탭이 늘어난다.
 */
export const MEETING_ROOMS: MeetingRoom[] = [
  { id: 'room-1', name: '대회의실' },
  { id: 'room-2', name: '소회의실' },
]

type RoomTone = {
  chip: string
  label: string
  cell: string
  line: string
}

const ROOM_TONES: RoomTone[] = [
  {
    chip: 'bg-sky-200 text-sky-950',
    label: 'border-l-[6px] border-l-sky-700 bg-sky-200 text-sky-950',
    cell: 'bg-sky-50',
    line: 'border-sky-200/80',
  },
  {
    chip: 'bg-violet-200 text-violet-950',
    label: 'border-l-[6px] border-l-violet-700 bg-violet-200 text-violet-950',
    cell: 'bg-violet-50',
    line: 'border-violet-200/80',
  },
  {
    chip: 'bg-amber-200 text-amber-950',
    label: 'border-l-[6px] border-l-amber-700 bg-amber-200 text-amber-950',
    cell: 'bg-amber-50',
    line: 'border-amber-200/80',
  },
  {
    chip: 'bg-emerald-200 text-emerald-950',
    label: 'border-l-[6px] border-l-emerald-700 bg-emerald-200 text-emerald-950',
    cell: 'bg-emerald-50',
    line: 'border-emerald-200/80',
  },
  {
    chip: 'bg-rose-200 text-rose-950',
    label: 'border-l-[6px] border-l-rose-700 bg-rose-200 text-rose-950',
    cell: 'bg-rose-50',
    line: 'border-rose-200/80',
  },
]

export type MeetingPerson = {
  id: string
  name: string
  position?: string | null
  departmentId?: string | null
  departmentName?: string | null
}

const POSITION_RANK = ['이사', '팀장', '과장', '대리', '사원']

export type MeetingDepartmentGroup = {
  id: string
  name: string
  members: MeetingPerson[]
}

export type MeetingSeriesStatus = 'in_progress' | 'done'

export type DayQuarterId = 'q1' | 'q2' | 'q3' | 'q4'

export type MeetingRound = {
  id: string
  round: number
  startsAt: string
  roomId: string
  quarterId: DayQuarterId
  prepMaterials: MeetingPrepFile[]
  content: string
  result: string
}

export function emptyRoundNotes(): Pick<
  MeetingRound,
  'prepMaterials' | 'content' | 'result'
> {
  return { prepMaterials: [], content: '', result: '' }
}

export function isPendingRound(round: Pick<MeetingRound, 'startsAt'>): boolean {
  return !round.startsAt
}

export function findPendingRound(
  series: Pick<MeetingSeries, 'rounds'>,
): MeetingRound | null {
  return series.rounds.find((round) => isPendingRound(round)) ?? null
}

export function appendPendingRound(
  series: MeetingSeries,
  id: string,
): MeetingSeries {
  if (findPendingRound(series)) return series
  return {
    ...series,
    rounds: [
      ...series.rounds,
      {
        id,
        round: nextRoundNumber(series),
        startsAt: '',
        roomId: '',
        quarterId: 'q1',
        ...emptyRoundNotes(),
      },
    ],
  }
}

export function formatRoundListLabel(
  round: Pick<MeetingRound, 'round' | 'startsAt'>,
): string {
  if (isPendingRound(round)) return '다음 차 예정'
  return `${formatRoundLabel(round.round)} 회의`
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function calendarDaysBetween(
  fromStartsAt: string,
  toStartsAt: string,
): number | null {
  const fromKey = dateKeyFromDateTime(fromStartsAt)
  const toKey = dateKeyFromDateTime(toStartsAt)
  if (!fromKey || !toKey) return null
  return Math.round(
    (parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) /
      MS_PER_DAY,
  )
}

export function formatRoundGapLabel(days: number): string {
  if (days > 0) return `+${days}일`
  if (days < 0) return `${days}일`
  return '+0일'
}

export function formatRoundGapHint(days: number): string {
  if (days === 0) return '이전 차보다 같은 날'
  if (days > 0) return `이전 차보다 ${days}일 뒤`
  return `이전 차보다 ${Math.abs(days)}일 앞`
}

export function roundGapDays(
  rounds: readonly Pick<MeetingRound, 'round' | 'startsAt'>[],
  current: Pick<MeetingRound, 'round' | 'startsAt'>,
): number | null {
  if (isPendingRound(current)) return null
  const previous = rounds
    .filter(
      (round) => !isPendingRound(round) && round.round < current.round,
    )
    .reduce<Pick<MeetingRound, 'round' | 'startsAt'> | null>(
      (best, round) =>
        !best || round.round > best.round ? round : best,
      null,
    )
  if (!previous) return null
  return calendarDaysBetween(previous.startsAt, current.startsAt)
}

export const MEETING_DURATION_MINUTES = [30, 60, 90, 120, 180] as const

export const DEFAULT_MEETING_DURATION_MINUTES = 60

export type MeetingDurationMinutes = (typeof MEETING_DURATION_MINUTES)[number]

export type MeetingPrepFile = {
  id: string
  name: string
  size: number
  type: string
  url: string
  uploadedBy: MeetingPerson
}

export function canRemovePrepFile(
  file: Pick<MeetingPrepFile, 'uploadedBy'>,
  actor: Pick<MeetingPerson, 'id'>,
): boolean {
  return file.uploadedBy.id === actor.id
}

export type MeetingComposeGaps = {
  title: boolean
  duration: boolean
  members: boolean
}

export function meetingComposeGaps(input: {
  title: string
  durationMinutes: number | null
  memberCount: number
  requireMembers?: boolean
}): MeetingComposeGaps {
  return {
    title: input.title.trim().length === 0,
    duration: input.durationMinutes == null,
    members: (input.requireMembers ?? true) && input.memberCount === 0,
  }
}

export function isMeetingComposeReady(gaps: MeetingComposeGaps): boolean {
  return !gaps.title && !gaps.duration && !gaps.members
}

export function formatMeetingComposeGaps(gaps: MeetingComposeGaps): string {
  const missing: string[] = []
  if (gaps.title) missing.push('주제')
  if (gaps.duration) missing.push('회의 시간')
  if (gaps.members) missing.push('멤버')
  if (missing.length === 0) return ''
  if (missing.length === 1) {
    if (gaps.duration) return '회의 시간을 선택하세요.'
    if (gaps.title) return '주제를 입력하세요.'
    return '멤버를 추가하세요.'
  }
  return `아직 안 정한 항목: ${missing.join(', ')}`
}

export function groupPrepMaterialsByUploader(
  files: readonly MeetingPrepFile[],
): { person: MeetingPerson; files: MeetingPrepFile[] }[] {
  const groups: { person: MeetingPerson; files: MeetingPrepFile[] }[] = []
  const indexByPerson = new Map<string, number>()
  for (const file of files) {
    const existing = indexByPerson.get(file.uploadedBy.id)
    if (existing == null) {
      indexByPerson.set(file.uploadedBy.id, groups.length)
      groups.push({ person: file.uploadedBy, files: [file] })
      continue
    }
    groups[existing].files.push(file)
  }
  return groups
}

export type MeetingSeries = {
  id: string
  title: string
  host: MeetingPerson
  members: MeetingPerson[]
  status: MeetingSeriesStatus
  durationMinutes: number
  rounds: MeetingRound[]
}

export type MeetingDraft = {
  id: string
  title: string
  startsAt: string
  roomId: string
  host: MeetingPerson
  members: MeetingPerson[]
  seriesId: string
  round: number
  quarterId: DayQuarterId
  durationMinutes: number
}

export type MeetingDay = {
  key: string
  month: number
  day: number
  weekday: string
  isWeekend: boolean
  isToday: boolean
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export function dateKeyFromDateTime(value: string): string {
  return value.slice(0, 10)
}

export function timeFromDateTime(value: string): string {
  return value.slice(11, 16)
}

export function combineDateTime(dateKey: string, time: string): string {
  return `${dateKey}T${time || '09:00'}`
}

export function formatMeetingTime(value: string): string {
  const time = timeFromDateTime(value)
  return time || '시간 미정'
}

export function meetingRoomName(roomId: string): string {
  return MEETING_ROOMS.find((room) => room.id === roomId)?.name ?? roomId
}

export function meetingRoomTone(roomId: string): RoomTone {
  const index = MEETING_ROOMS.findIndex((room) => room.id === roomId)
  return ROOM_TONES[(index < 0 ? 0 : index) % ROOM_TONES.length]
}

export function meetingRoomChipClass(roomId: string): string {
  return meetingRoomTone(roomId).chip
}

const MEETING_CHIP_TONES = [
  'bg-sky-200 text-sky-950',
  'bg-amber-200 text-amber-950',
  'bg-emerald-200 text-emerald-950',
  'bg-violet-200 text-violet-950',
  'bg-rose-200 text-rose-950',
] as const

function meetingChipToneIndex(seriesId: string): number {
  let hash = 0
  for (let index = 0; index < seriesId.length; index += 1) {
    hash = (hash * 31 + seriesId.charCodeAt(index)) >>> 0
  }
  return hash % MEETING_CHIP_TONES.length
}

export function meetingEntryChipClass(
  seriesId: string,
  takenIndexes: readonly number[] = [],
): string {
  let index = meetingChipToneIndex(seriesId)
  const taken = new Set(takenIndexes)
  if (taken.has(index) && taken.size < MEETING_CHIP_TONES.length) {
    const start = index
    do {
      index = (index + 1) % MEETING_CHIP_TONES.length
    } while (taken.has(index) && index !== start)
  }
  return MEETING_CHIP_TONES[index]
}

export function assignMeetingChipClasses(
  items: readonly Pick<MeetingDraft, 'id' | 'seriesId'>[],
): Map<string, string> {
  const classes = new Map<string, string>()
  const taken: number[] = []
  for (const item of items) {
    const tone = meetingEntryChipClass(item.seriesId, taken)
    const index = MEETING_CHIP_TONES.indexOf(
      tone as (typeof MEETING_CHIP_TONES)[number],
    )
    if (index >= 0) taken.push(index)
    classes.set(item.id, tone)
  }
  return classes
}

export function formatRoundLabel(round: number): string {
  return `${round}차`
}

export function formatMeetingDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}분`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}

export function nextRoundNumber(series: Pick<MeetingSeries, 'rounds'>): number {
  if (series.rounds.length === 0) return 1
  return Math.max(...series.rounds.map((row) => row.round)) + 1
}

export function currentRoundNumber(series: Pick<MeetingSeries, 'rounds'>): number {
  if (series.rounds.length === 0) return 0
  return Math.max(...series.rounds.map((row) => row.round))
}

export function latestRound(
  series: Pick<MeetingSeries, 'rounds'>,
): MeetingRound | null {
  if (series.rounds.length === 0) return null
  return series.rounds.reduce((best, row) =>
    row.round > best.round ? row : best,
  )
}

export function preferredDetailRound(
  series: Pick<MeetingSeries, 'rounds'>,
): MeetingRound | null {
  return findPendingRound(series) ?? latestRound(series)
}

export function canRemoveBookedMeeting(
  item: Pick<MeetingDraft, 'host'>,
  actor: Pick<MeetingPerson, 'id'>,
): boolean {
  return item.host.id === actor.id
}

export function canDeleteMeetingSeries(
  series: Pick<MeetingSeries, 'host'>,
  actor: Pick<MeetingPerson, 'id'>,
  isAdmin: boolean,
): boolean {
  return isAdmin || series.host.id === actor.id
}

export type MeetingSeriesDeleteImpact = {
  rounds: number
  scheduled: number
  files: number
  notes: number
}

export function meetingSeriesDeleteImpact(
  series: Pick<MeetingSeries, 'rounds'>,
): MeetingSeriesDeleteImpact {
  let files = 0
  let notes = 0
  let scheduled = 0
  for (const round of series.rounds) {
    files += round.prepMaterials.length
    if (round.content.trim() || round.result.trim()) notes += 1
    if (!isPendingRound(round)) scheduled += 1
  }
  return {
    rounds: series.rounds.length,
    scheduled,
    files,
    notes,
  }
}

export function revokeMeetingSeriesFiles(
  series: Pick<MeetingSeries, 'rounds'>,
) {
  for (const round of series.rounds) {
    for (const file of round.prepMaterials) {
      if (file.url.startsWith('blob:')) URL.revokeObjectURL(file.url)
    }
  }
}

export function meetingDeleteConfirmPhrase(title: string): string {
  return title.trim() || '이 회의건을 삭제합니다'
}

export function chunkMeetingDays(
  days: readonly MeetingDay[],
  size = MEETING_RANGE_STEP_DAYS,
): MeetingDay[][] {
  const chunks: MeetingDay[][] = []
  for (let offset = 0; offset < days.length; offset += size) {
    chunks.push(days.slice(offset, offset + size))
  }
  return chunks
}

export function filterSeriesByStatus(
  series: readonly MeetingSeries[],
  status: MeetingSeriesStatus,
): MeetingSeries[] {
  return series.filter((item) => item.status === status)
}

export function isMeetingParticipant(
  series: Pick<MeetingSeries, 'host' | 'members'>,
  actor: Pick<MeetingPerson, 'id'>,
): boolean {
  return (
    series.host.id === actor.id ||
    series.members.some((person) => person.id === actor.id)
  )
}

export function filterSeriesForViewer(
  series: readonly MeetingSeries[],
  actor: Pick<MeetingPerson, 'id'>,
  isAdmin: boolean,
): MeetingSeries[] {
  if (isAdmin) return [...series]
  return series.filter((item) => isMeetingParticipant(item, actor))
}

export function seriesToDrafts(
  series: readonly MeetingSeries[],
): MeetingDraft[] {
  const drafts: MeetingDraft[] = []
  for (const item of series) {
    for (const round of item.rounds) {
      if (isPendingRound(round)) continue
      drafts.push({
        id: round.id,
        title: item.title,
        startsAt: round.startsAt,
        roomId: round.roomId,
        host: item.host,
        members: item.members,
        seriesId: item.id,
        round: round.round,
        quarterId: round.quarterId,
        durationMinutes: item.durationMinutes,
      })
    }
  }
  return drafts
}

export function roomDayKey(roomId: string, dateKey: string): string {
  return `${roomId}:${dateKey}`
}

export function shiftMeetingFromKey(fromKey: string, direction: number): string {
  return toDateKey(
    addDays(parseDateKey(fromKey), direction * MEETING_RANGE_JUMP_DAYS),
  )
}

export function startOfMeetingWeek(fromKey: string): Date {
  const date = parseDateKey(fromKey)
  const weekday = date.getDay()
  if (weekday === 6) return addDays(date, 2)
  if (weekday === 0) return addDays(date, 1)
  return addDays(date, 1 - weekday)
}

export function listMeetingDays(
  fromKey: string,
  count: number,
  todayKey = fromKey,
): MeetingDay[] {
  const days: MeetingDay[] = []
  let cursor = startOfMeetingWeek(fromKey)
  while (days.length < count) {
    const weekday = cursor.getDay()
    if (weekday !== 0 && weekday !== 6) {
      days.push({
        key: toDateKey(cursor),
        month: cursor.getMonth() + 1,
        day: cursor.getDate(),
        weekday: WEEKDAY_LABELS[weekday],
        isWeekend: false,
        isToday: toDateKey(cursor) === todayKey,
      })
    }
    cursor = addDays(cursor, 1)
  }
  return days
}

export function formatMeetingRangeLabel(days: MeetingDay[]): string {
  if (days.length === 0) return ''
  const first = days[0]
  const last = days[days.length - 1]
  return `${first.month}/${first.day} – ${last.month}/${last.day}`
}

export function seriesDateSpan(
  series: Pick<MeetingSeries, 'rounds'>,
): { fromKey: string; toKey: string } | null {
  const keys = series.rounds
    .filter((round) => !isPendingRound(round))
    .map((round) => dateKeyFromDateTime(round.startsAt))
    .filter(Boolean)
    .sort()
  if (keys.length === 0) return null
  return { fromKey: keys[0], toKey: keys[keys.length - 1] }
}

export function formatSeriesDateSpan(
  series: Pick<MeetingSeries, 'rounds'>,
): string {
  const span = seriesDateSpan(series)
  if (!span) return ''
  const from = parseDateKey(span.fromKey)
  const to = parseDateKey(span.toKey)
  const fromLabel = `${from.getMonth() + 1}/${from.getDate()}`
  const toLabel = `${to.getMonth() + 1}/${to.getDate()}`
  if (span.fromKey === span.toKey) return fromLabel
  return `${fromLabel} – ${toLabel}`
}

export function visibleDaysToCover(
  fromKey: string,
  targetKey: string,
  currentCount: number,
): number {
  const start = startOfMeetingWeek(fromKey)
  if (parseDateKey(targetKey).getTime() < start.getTime()) return currentCount
  let needed = 0
  let cursor = start
  while (toDateKey(cursor) <= targetKey) {
    const weekday = cursor.getDay()
    if (weekday !== 0 && weekday !== 6) needed += 1
    cursor = addDays(cursor, 1)
  }
  if (needed <= currentCount) return currentCount
  const stepped =
    Math.ceil(needed / MEETING_RANGE_STEP_DAYS) * MEETING_RANGE_STEP_DAYS
  return Math.min(
    MAX_MEETING_VISIBLE_DAYS,
    Math.max(DEFAULT_MEETING_VISIBLE_DAYS, stepped),
  )
}

export function meetingPersonLabel(person: MeetingPerson): string {
  const position = person.position?.trim()
  return position ? `${person.name} · ${position}` : person.name
}

export function formatMeetingAttendees(
  meeting: Pick<MeetingDraft, 'host' | 'members'>,
): string {
  if (meeting.members.length === 0) return meeting.host.name
  return `${meeting.host.name} 외 ${meeting.members.length}명`
}

export function profileToMeetingPerson(profile: {
  id: string
  displayName: string | null
  email?: string | null
  position?: string | null
  departmentId?: string | null
  departmentName?: string | null
}): MeetingPerson {
  return {
    id: profile.id,
    name: profile.displayName?.trim() || profile.email?.trim() || '이름 없음',
    position: profile.position,
    departmentId: profile.departmentId,
    departmentName: profile.departmentName,
  }
}

export function meetingPositionRank(position?: string | null): number {
  const index = POSITION_RANK.indexOf((position ?? '').trim())
  return index === -1 ? POSITION_RANK.length : index
}

function sortMeetingPeople(people: MeetingPerson[]): MeetingPerson[] {
  return [...people].sort((left, right) => {
    const rank =
      meetingPositionRank(left.position) - meetingPositionRank(right.position)
    if (rank !== 0) return rank
    return left.name.localeCompare(right.name, 'ko')
  })
}

export function groupMeetingMembersByDepartment(
  people: readonly MeetingPerson[],
  hostId: string,
  departments: readonly { id: string; name: string; sortOrder: number }[],
): MeetingDepartmentGroup[] {
  const byKey = new Map<string, MeetingPerson[]>()
  for (const person of people) {
    if (person.id === hostId) continue
    const key = person.departmentId || person.departmentName || '__none__'
    const list = byKey.get(key)
    if (list) list.push(person)
    else byKey.set(key, [person])
  }

  const groups: MeetingDepartmentGroup[] = []
  const used = new Set<string>()
  const ordered = [...departments].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  )
  for (const department of ordered) {
    const members = sortMeetingPeople(
      byKey.get(department.id) ?? byKey.get(department.name) ?? [],
    )
    if (members.length === 0) continue
    groups.push({
      id: department.id,
      name: department.name,
      members,
    })
    for (const member of members) used.add(member.id)
  }

  const leftovers = new Map<string, MeetingPerson[]>()
  for (const person of people) {
    if (person.id === hostId || used.has(person.id)) continue
    const name = person.departmentName?.trim() || '소속 없음'
    const list = leftovers.get(name)
    if (list) list.push(person)
    else leftovers.set(name, [person])
  }
  for (const [name, list] of leftovers) {
    groups.push({ id: `name:${name}`, name, members: sortMeetingPeople(list) })
  }
  return groups
}

export function addableMeetingMembers(
  directory: readonly MeetingPerson[],
  hostId: string,
  selectedIds: readonly string[],
  query: string,
  limit = 8,
): MeetingPerson[] {
  const needle = query.trim().toLowerCase()
  const selected = new Set(selectedIds)
  const matched = directory.filter((person) => {
    if (person.id === hostId || selected.has(person.id)) return false
    if (!needle) return true
    const hay = [
      person.name,
      person.position ?? '',
      person.departmentName ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(needle)
  })
  return matched.slice(0, limit)
}

export function groupMeetingsByRoomDay(
  items: readonly MeetingDraft[],
): Map<string, MeetingDraft[]> {
  const grouped = new Map<string, MeetingDraft[]>()
  for (const item of items) {
    const dateKey = dateKeyFromDateTime(item.startsAt)
    if (!dateKey || !item.roomId) continue
    const key = roomDayKey(item.roomId, dateKey)
    const list = grouped.get(key)
    if (list) list.push(item)
    else grouped.set(key, [item])
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => left.startsAt.localeCompare(right.startsAt))
  }
  return grouped
}
