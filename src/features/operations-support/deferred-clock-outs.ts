import { clockOutLabel, koreaDateKey } from '../settings/my-attendance.ts'

export type DeferredClockOut = {
  employeeId: string
  date: string
  clockIn: string
  clockOutAt: string | null
  reportedAt: string | null
  autoClosedAt?: string | null
  workConfirmedAt?: string | null
}

export type DeferredClockOutView = {
  key: string
  employeeId: string
  date: string
  clockIn: string
  clockOutText: string
  reportedDate: string
  reportedText: string
  totalCount: number
  automatic: boolean
  pending: boolean
  lastConfirmedText: string
}

/** 다음 출근 때 입력한 퇴근만 고르고, 누적은 월과 상관없이 같은 사람의 전체 횟수다. */
export function deferredClockOutViews(rows: readonly DeferredClockOut[], month: string): DeferredClockOutView[] {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const eventAt = row.reportedAt ?? row.autoClosedAt
    if (!eventAt || Number.isNaN(Date.parse(eventAt))) continue
    totals.set(row.employeeId, (totals.get(row.employeeId) ?? 0) + 1)
  }
  return rows.flatMap(row => {
    const eventAt = row.reportedAt ?? row.autoClosedAt
    if (row.date.slice(0, 7) !== month || !eventAt) return []
    const reported = new Date(eventAt)
    if (Number.isNaN(reported.getTime())) return []
    const reportedDate = koreaDateKey(reported)
    const reportedTime = clockOutLabel(eventAt)
    return [{
      key: `${row.employeeId}:${row.date}`,
      employeeId: row.employeeId,
      date: row.date,
      clockIn: row.clockIn.slice(0, 5),
      clockOutText: clockOutLabel(row.clockOutAt, row.date) || '—',
      reportedDate,
      reportedText: reportedTime ? `${reportedDate.slice(5).replace('-', '.')} ${reportedTime}` : reportedDate,
      totalCount: totals.get(row.employeeId) ?? 0,
      automatic: Boolean(row.autoClosedAt),
      pending: Boolean(row.autoClosedAt && !row.clockOutAt),
      lastConfirmedText: clockOutLabel(row.workConfirmedAt ?? null, row.date) || '확인 없음',
    }]
  }).sort((left, right) => right.totalCount - left.totalCount || right.date.localeCompare(left.date) || left.employeeId.localeCompare(right.employeeId))
}
