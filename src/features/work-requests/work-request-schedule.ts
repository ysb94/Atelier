import type { WorkRequestRecord } from './work-request-types'

export const TIMELINE_DAY_WIDTH = 64
export const DRAG_THRESHOLD = 6

export function dateFromToday(days: number): string {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + days)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

export function dateTimeFromToday(days: number, hour: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 20, 0, 0)
  return date.toISOString()
}

export function formatDate(value: string): string {
  if (!value) return '미정'
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(`${value}T00:00:00`))
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function formatCompactDate(value: string): string {
  if (!value) return '미정'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'short',
    day: 'numeric',
  }).format(date)
}

export function formatSlashDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function deadlineLabel(value: string): {
  label: string
  variant: 'outline' | 'warning' | 'danger' | 'muted'
} {
  if (!value) return { label: '마감 미정', variant: 'muted' }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${value}T00:00:00`)
  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return { label: `${Math.abs(days)}일 초과`, variant: 'danger' }
  if (days === 0) return { label: '오늘 마감', variant: 'danger' }
  if (days <= 3) return { label: `${days}일 남음`, variant: 'warning' }
  return { label: `${days}일 남음`, variant: 'outline' }
}

export function requestDueDate(request: WorkRequestRecord): string {
  return request.confirmedDueDate || request.values.dueDate
}

export function toCalendarDate(value: string | Date): Date {
  const date =
    typeof value === 'string'
      ? new Date(value.includes('T') ? value : `${value}T00:00:00`)
      : new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function addCalendarDays(value: Date, days: number): Date {
  const date = new Date(value)
  date.setDate(date.getDate() + days)
  return date
}

export function calendarDayNumber(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
}

export function calendarDayDifference(left: Date, right: Date): number {
  return Math.round(
    (calendarDayNumber(left) - calendarDayNumber(right)) / 86_400_000,
  )
}

export function isSameCalendarDate(left: Date, right: Date): boolean {
  return calendarDayNumber(left) === calendarDayNumber(right)
}

export function completionRequestDate(request: WorkRequestRecord): string {
  return (
    request.completionRequestedAt ||
    request.completedAt ||
    request.updatedAt
  ).slice(0, 10)
}

export function dateInRange(
  value: string,
  from: string,
  to: string,
): boolean {
  const date = value.slice(0, 10)
  if (!date) return false
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

export function formatIsoDate(value: Date): string {
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-')
}

export function requestPlannedRange(request: WorkRequestRecord): {
  start: string
  end: string
} {
  const fallback = requestDueDate(request) || formatIsoDate(toCalendarDate(new Date()))
  return {
    start: request.plannedStart || fallback,
    end: request.plannedEnd || request.plannedStart || fallback,
  }
}

export function compareRequestsByDeadline(
  left: WorkRequestRecord,
  right: WorkRequestRecord,
): number {
  const leftDueDate = requestDueDate(left)
  const rightDueDate = requestDueDate(right)
  if (!leftDueDate && rightDueDate) return 1
  if (leftDueDate && !rightDueDate) return -1
  const dueDateOrder = leftDueDate.localeCompare(rightDueDate)
  return dueDateOrder || left.createdAt.localeCompare(right.createdAt)
}

export function buildTeamTimelineDates(requests: WorkRequestRecord[]): Date[] {
  const today = toCalendarDate(new Date())
  let firstDate = today
  let lastDate = addCalendarDays(today, 27)

  if (requests.length > 0) {
    const starts = requests.map((request) =>
      toCalendarDate(requestPlannedRange(request).start),
    )
    const ends = requests.map((request) => {
      const range = requestPlannedRange(request)
      const due = request.confirmedDueDate
      const end = toCalendarDate(range.end)
      return due
        ? new Date(Math.max(end.getTime(), toCalendarDate(due).getTime()))
        : end
    })
    firstDate = addCalendarDays(
      new Date(Math.min(...starts.map((date) => date.getTime()), today.getTime())),
      -1,
    )
    const latest = addCalendarDays(
      new Date(Math.max(...ends.map((date) => date.getTime()))),
      1,
    )
    lastDate = new Date(
      Math.max(latest.getTime(), addCalendarDays(firstDate, 27).getTime()),
    )
  }

  const dateCount = calendarDayDifference(lastDate, firstDate) + 1
  return Array.from({ length: dateCount }, (_, index) =>
    addCalendarDays(firstDate, index),
  )
}

export type TimelineRequestPlacement = {
  request: WorkRequestRecord
  lane: number
  startIndex: number
  endIndex: number
}

export function layoutTimelineRequests(
  requests: WorkRequestRecord[],
  timelineStart: Date,
  timelineDayCount: number,
): {
  placements: TimelineRequestPlacement[]
  laneCount: number
} {
  const ordered = [...requests].sort((left, right) => {
    const leftStart = toCalendarDate(requestPlannedRange(left).start)
    const rightStart = toCalendarDate(requestPlannedRange(right).start)
    return (
      calendarDayDifference(leftStart, rightStart) ||
      compareRequestsByDeadline(left, right)
    )
  })
  const laneEnds: number[] = []
  const placements = ordered.map((request) => {
    const range = requestPlannedRange(request)
    const start = toCalendarDate(range.start)
    const end = toCalendarDate(range.end)
    const startIndex = Math.max(
      0,
      Math.min(
        timelineDayCount - 1,
        calendarDayDifference(start, timelineStart),
      ),
    )
    const endIndex = Math.max(
      startIndex,
      Math.min(timelineDayCount - 1, calendarDayDifference(end, timelineStart)),
    )
    let lane = laneEnds.findIndex((laneEnd) => laneEnd < startIndex)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = endIndex
    return { request, lane, startIndex, endIndex }
  })

  return { placements, laneCount: Math.max(1, laneEnds.length) }
}

export function snapDays(deltaPx: number, dayWidth = TIMELINE_DAY_WIDTH): number {
  return Math.round(deltaPx / dayWidth)
}

export function shiftPlannedRange(
  start: string,
  end: string,
  days: number,
): { plannedStart: string; plannedEnd: string } {
  return {
    plannedStart: formatIsoDate(addCalendarDays(toCalendarDate(start), days)),
    plannedEnd: formatIsoDate(addCalendarDays(toCalendarDate(end), days)),
  }
}

export function resizePlannedRange(
  start: string,
  end: string,
  edge: 'start' | 'end',
  days: number,
): { plannedStart: string; plannedEnd: string } {
  const startDate = toCalendarDate(start)
  const endDate = toCalendarDate(end)
  if (edge === 'start') {
    const nextStart = addCalendarDays(startDate, days)
    if (calendarDayDifference(endDate, nextStart) < 0) {
      return {
        plannedStart: formatIsoDate(endDate),
        plannedEnd: formatIsoDate(endDate),
      }
    }
    return {
      plannedStart: formatIsoDate(nextStart),
      plannedEnd: formatIsoDate(endDate),
    }
  }
  const nextEnd = addCalendarDays(endDate, days)
  if (calendarDayDifference(nextEnd, startDate) < 0) {
    return {
      plannedStart: formatIsoDate(startDate),
      plannedEnd: formatIsoDate(startDate),
    }
  }
  return {
    plannedStart: formatIsoDate(startDate),
    plannedEnd: formatIsoDate(nextEnd),
  }
}

export function assignFromDrop(dropDate: string): {
  plannedStart: string
  plannedEnd: string
} {
  return { plannedStart: dropDate, plannedEnd: dropDate }
}

export function assignDefaultRange(
  request: Pick<WorkRequestRecord, 'confirmedDueDate'> & {
    values: Pick<WorkRequestRecord['values'], 'dueDate'>
  },
  today = formatIsoDate(toCalendarDate(new Date())),
): { plannedStart: string; plannedEnd: string } {
  const due = request.confirmedDueDate || request.values.dueDate
  if (!due || due < today) {
    return { plannedStart: today, plannedEnd: today }
  }
  return { plannedStart: today, plannedEnd: due }
}

export function isPlanOverdue(
  plannedEnd: string,
  confirmedDueDate: string,
): boolean {
  if (!plannedEnd || !confirmedDueDate) return false
  return (
    calendarDayDifference(
      toCalendarDate(plannedEnd),
      toCalendarDate(confirmedDueDate),
    ) > 0
  )
}

export type WorkTimeLog = {
  accumulatedMs: number
  mountedAt: number | null
}

export function workTimeKey(memberId: string, requestId: string) {
  return `${memberId}:${requestId}`
}

export function currentWorkElapsedMs(
  log: WorkTimeLog | undefined,
  now: number,
): number {
  if (!log) return 0
  return log.accumulatedMs + (log.mountedAt ? Math.max(0, now - log.mountedAt) : 0)
}

export function formatWorkDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}시간 ${minutes}분`
  if (minutes > 0) return `${minutes}분 ${seconds}초`
  return `${seconds}초`
}

export function flushWorkTime(
  store: Record<string, WorkTimeLog>,
  memberId: string,
  requestId: string,
  now: number,
): Record<string, WorkTimeLog> {
  const key = workTimeKey(memberId, requestId)
  const log = store[key]
  if (!log?.mountedAt) return store
  return {
    ...store,
    [key]: {
      accumulatedMs: log.accumulatedMs + Math.max(0, now - log.mountedAt),
      mountedAt: null,
    },
  }
}

export function startWorkTime(
  store: Record<string, WorkTimeLog>,
  memberId: string,
  requestId: string,
  now: number,
): Record<string, WorkTimeLog> {
  const key = workTimeKey(memberId, requestId)
  const previous = store[key] ?? { accumulatedMs: 0, mountedAt: null }
  return {
    ...store,
    [key]: {
      accumulatedMs: previous.accumulatedMs,
      mountedAt: now,
    },
  }
}

export function dateIndexAtPoint(
  clientX: number,
  rowLeft: number,
  _timelineStart: Date,
  timelineDayCount: number,
  dayWidth = TIMELINE_DAY_WIDTH,
): number {
  const index = Math.floor((clientX - rowLeft) / dayWidth)
  return Math.max(0, Math.min(timelineDayCount - 1, index))
}
