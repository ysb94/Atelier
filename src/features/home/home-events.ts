/** 홈 일정 UI용 모델. 저장소 없이 회의 전 UI 골격만 쓴다. */

export type HomeEventDept = 'planning' | 'design' | 'md' | 'logistics' | 'common'

export type HomeEventStatus = 'ongoing' | 'upcoming' | 'done'

export type HomeEventKind =
  | 'meeting'
  | 'deadline'
  | 'launch'
  | 'sample'
  | 'shipment'
  | 'other'

export type HomeEvent = {
  id: string
  title: string
  dept: HomeEventDept
  owner: string
  kind: HomeEventKind
  status: HomeEventStatus
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD inclusive */
  endDate: string
  note?: string
}

export const HOME_EVENT_DEPT_LABEL: Record<HomeEventDept, string> = {
  planning: '기획',
  design: '디자인',
  md: 'MD',
  logistics: '물류',
  common: '공통',
}

/** 필터 칩·목록용 점 색 */
export const HOME_EVENT_DEPT_DOT: Record<HomeEventDept, string> = {
  planning: 'bg-sky-500',
  design: 'bg-violet-500',
  md: 'bg-amber-500',
  logistics: 'bg-emerald-500',
  common: 'bg-slate-400',
}

/** 달력 막대용 — 연한 배경 + 진한 글자 */
export const HOME_EVENT_DEPT_BAR: Record<HomeEventDept, string> = {
  planning: 'bg-sky-100 text-sky-900 ring-sky-200/80',
  design: 'bg-violet-100 text-violet-900 ring-violet-200/80',
  md: 'bg-amber-100 text-amber-950 ring-amber-200/80',
  logistics: 'bg-emerald-100 text-emerald-900 ring-emerald-200/80',
  common: 'bg-slate-100 text-slate-800 ring-slate-200/80',
}

/** @deprecated 점 색과 동일. 기존 import 호환 */
export const HOME_EVENT_DEPT_COLOR = HOME_EVENT_DEPT_DOT

export const HOME_EVENT_STATUS_LABEL: Record<HomeEventStatus, string> = {
  ongoing: '진행 중',
  upcoming: '예정',
  done: '완료',
}

export const HOME_EVENT_KIND_LABEL: Record<HomeEventKind, string> = {
  meeting: '회의',
  deadline: '마감',
  launch: '출시',
  sample: '샘플',
  shipment: '입고',
  other: '기타',
}

export const HOME_EVENT_DEPTS: HomeEventDept[] = [
  'planning',
  'design',
  'md',
  'logistics',
  'common',
]

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

export function weekdayLabels() {
  return WEEKDAY_LABELS
}

/** 로컬 기준 YYYY-MM-DD */
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isDateInRange(
  dayKey: string,
  startDate: string,
  endDate: string,
): boolean {
  return dayKey >= startDate && dayKey <= endDate
}

export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`
}

export function formatDateLabel(key: string): string {
  const date = parseDateKey(key)
  return `${date.getMonth() + 1}/${date.getDate()}(${WEEKDAY_LABELS[date.getDay()]})`
}

export function formatRangeLabel(startDate: string, endDate: string): string {
  if (startDate === endDate) return formatDateLabel(startDate)
  return `${formatDateLabel(startDate)} – ${formatDateLabel(endDate)}`
}

export type CalendarCell = {
  date: Date
  key: string
  inCurrentMonth: boolean
}

/** 일요일 시작 6주 그리드 */
export function buildMonthGrid(month: Date): CalendarCell[] {
  const first = startOfMonth(month)
  const start = addDays(first, -first.getDay())
  const cells: CalendarCell[] = []
  for (let i = 0; i < 42; i += 1) {
    const date = addDays(start, i)
    cells.push({
      date,
      key: toDateKey(date),
      inCurrentMonth: date.getMonth() === month.getMonth(),
    })
  }
  return cells
}

export function splitWeeks(cells: CalendarCell[]): CalendarCell[][] {
  const weeks: CalendarCell[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

function weekHasVisibleEvents(week: CalendarCell[], events: HomeEvent[]): boolean {
  const weekStart = week[0].key
  const weekEnd = week[6].key
  return events.some(
    (event) => event.startDate <= weekEnd && event.endDate >= weekStart,
  )
}

/**
 * 앞뒤로 이번 달도 아니고 일정도 없는 주 줄은 버린다.
 * 최소 4주는 남긴다.
 */
export function trimCalendarWeeks(
  weeks: CalendarCell[][],
  events: HomeEvent[],
): CalendarCell[][] {
  if (weeks.length <= 4) return weeks

  let start = 0
  let end = weeks.length - 1

  while (
    end - start >= 4 &&
    weeks[start].every((cell) => !cell.inCurrentMonth) &&
    !weekHasVisibleEvents(weeks[start], events)
  ) {
    start += 1
  }

  while (
    end - start >= 4 &&
    weeks[end].every((cell) => !cell.inCurrentMonth) &&
    !weekHasVisibleEvents(weeks[end], events)
  ) {
    end -= 1
  }

  return weeks.slice(start, end + 1)
}

export type WeekEventBar = {
  event: HomeEvent
  /** 0–6 */
  startCol: number
  /** 1–7 */
  span: number
  lane: number
  /** 이 주 구간이 일정 시작일인지 (제목 표시용) */
  showTitle: boolean
  continuesBefore: boolean
  continuesAfter: boolean
}

export type WeekEventLayout = {
  bars: WeekEventBar[]
  /** 날짜 키 → 보이는 레인 초과로 숨겨진 일정 수 */
  overflowByDay: Record<string, number>
  laneCount: number
}

/**
 * 한 주(7일) 안에서 여러 날 일정을 이어지는 막대로 배치한다.
 * 주가 바뀌면 막대가 끊기지만, 같은 주 안에서는 이어진다.
 */
export function layoutWeekEventBars(
  week: CalendarCell[],
  events: HomeEvent[],
  maxLanes: number,
): WeekEventLayout {
  const weekStart = week[0].key
  const weekEnd = week[6].key
  const colByKey = new Map(week.map((cell, index) => [cell.key, index]))

  const intersecting = events
    .filter((event) => event.startDate <= weekEnd && event.endDate >= weekStart)
    .sort((a, b) => {
      const start = a.startDate.localeCompare(b.startDate)
      if (start !== 0) return start
      const duration =
        b.endDate.localeCompare(b.startDate) - a.endDate.localeCompare(a.startDate)
      if (duration !== 0) return duration
      return a.title.localeCompare(b.title, 'ko')
    })

  const laneEnds: string[] = []
  const bars: WeekEventBar[] = []
  const hiddenIdsByDay: Record<string, Set<string>> = {}

  for (const cell of week) {
    hiddenIdsByDay[cell.key] = new Set()
  }

  for (const event of intersecting) {
    const segStart = event.startDate > weekStart ? event.startDate : weekStart
    const segEnd = event.endDate < weekEnd ? event.endDate : weekEnd
    const startCol = colByKey.get(segStart)
    const endCol = colByKey.get(segEnd)
    if (startCol == null || endCol == null) continue

    const span = endCol - startCol + 1
    let lane = 0
    while (lane < laneEnds.length && laneEnds[lane] >= segStart) {
      lane += 1
    }

    if (lane >= maxLanes) {
      for (let col = startCol; col <= endCol; col += 1) {
        hiddenIdsByDay[week[col].key].add(event.id)
      }
      continue
    }

    if (lane === laneEnds.length) laneEnds.push(segEnd)
    else laneEnds[lane] = segEnd

    bars.push({
      event,
      startCol,
      span,
      lane,
      showTitle: true,
      continuesBefore: event.startDate < weekStart,
      continuesAfter: event.endDate > weekEnd,
    })
  }

  const overflowByDay: Record<string, number> = {}
  for (const cell of week) {
    overflowByDay[cell.key] = hiddenIdsByDay[cell.key].size
  }

  return {
    bars,
    overflowByDay,
    laneCount: Math.max(laneEnds.length, 1),
  }
}

export function deriveEventStatus(
  event: Pick<HomeEvent, 'startDate' | 'endDate'>,
  todayKey: string,
): HomeEventStatus {
  if (event.endDate < todayKey) return 'done'
  if (event.startDate > todayKey) return 'upcoming'
  return 'ongoing'
}

export function withLiveStatus(
  events: HomeEvent[],
  todayKey: string,
): HomeEvent[] {
  return events.map((event) => ({
    ...event,
    status: deriveEventStatus(event, todayKey),
  }))
}

function offsetKey(base: Date, days: number): string {
  return toDateKey(addDays(base, days))
}

/**
 * 오늘 기준으로 상대 날짜를 쓰는 예시 일정.
 * 회의 후 실제 저장소로 바꿀 때 이 배열만 교체하면 된다.
 */
export function createSampleHomeEvents(today = new Date()): HomeEvent[] {
  const todayKey = toDateKey(today)
  const raw: Omit<HomeEvent, 'status'>[] = [
    {
      id: 'sample-1',
      title: '26SS 기획 리뷰',
      dept: 'planning',
      owner: '김기획',
      kind: 'meeting',
      startDate: offsetKey(today, -2),
      endDate: offsetKey(today, 1),
      note: '시즌 라인업 1차 확정',
    },
    {
      id: 'sample-2',
      title: '원단 샘플 입고',
      dept: 'design',
      owner: '이디자인',
      kind: 'sample',
      startDate: todayKey,
      endDate: todayKey,
      note: '트렌치 원단 3종',
    },
    {
      id: 'sample-3',
      title: 'MD 판매가 조율',
      dept: 'md',
      owner: '박MD',
      kind: 'deadline',
      startDate: offsetKey(today, 2),
      endDate: offsetKey(today, 4),
    },
    {
      id: 'sample-4',
      title: '중국 공장 1차 입고',
      dept: 'logistics',
      owner: '최물류',
      kind: 'shipment',
      startDate: offsetKey(today, 5),
      endDate: offsetKey(today, 7),
    },
    {
      id: 'sample-5',
      title: '브랜드 주간 회의',
      dept: 'common',
      owner: '전팀',
      kind: 'meeting',
      startDate: offsetKey(today, 3),
      endDate: offsetKey(today, 3),
    },
    {
      id: 'sample-6',
      title: '출시 확정 후보 검토',
      dept: 'planning',
      owner: '김기획',
      kind: 'launch',
      startDate: offsetKey(today, -5),
      endDate: offsetKey(today, -1),
    },
    {
      id: 'sample-7',
      title: '룩북 촬영 준비',
      dept: 'design',
      owner: '정스타일',
      kind: 'other',
      startDate: offsetKey(today, 8),
      endDate: offsetKey(today, 10),
    },
    {
      id: 'sample-8',
      title: '온라인몰 런칭 마감',
      dept: 'md',
      owner: '박MD',
      kind: 'deadline',
      startDate: offsetKey(today, 12),
      endDate: offsetKey(today, 12),
    },
  ]

  return withLiveStatus(
    raw.map((event) => ({ ...event, status: 'upcoming' })),
    todayKey,
  )
}

export function listOwners(events: HomeEvent[]): string[] {
  return Array.from(new Set(events.map((e) => e.owner))).sort((a, b) =>
    a.localeCompare(b, 'ko'),
  )
}

export function eventsOnDay(events: HomeEvent[], dayKey: string): HomeEvent[] {
  return events.filter((event) =>
    isDateInRange(dayKey, event.startDate, event.endDate),
  )
}

export function ongoingEvents(
  events: HomeEvent[],
  _todayKey: string,
): HomeEvent[] {
  return events
    .filter((event) => event.status === 'ongoing')
    .sort(
      (a, b) =>
        a.endDate.localeCompare(b.endDate) ||
        a.title.localeCompare(b.title, 'ko'),
    )
}

export function upcomingEvents(
  events: HomeEvent[],
  todayKey: string,
  limit = 6,
): HomeEvent[] {
  return events
    .filter((event) => event.startDate > todayKey)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'ko'))
    .slice(0, limit)
}
