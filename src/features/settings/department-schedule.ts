import { attendanceMonthDates, validAttendanceMonth } from './my-attendance'

export const DEPARTMENT_ABSENCE_LABELS = { annual: '연차', half: '반차', quarter: '반반차', offsite: '외근', official: '공가' } as const
export type DepartmentAbsenceKind = keyof typeof DEPARTMENT_ABSENCE_LABELS
export type DepartmentAbsence = {
  id: string; employeeId: string; name: string; kind: DepartmentAbsenceKind
  from: string; to: string; start: string; end: string; endNextDay: boolean; continuous: boolean
}
export type DepartmentDayAbsence = DepartmentAbsence & { date: string; time: string }
const DAY = 86_400_000

export function departmentScheduleMonth(month: string) {
  if (!validAttendanceMonth(month)) return null
  const dates = attendanceMonthDates(month)
  return { from: dates[0], to: dates[dates.length - 1] }
}

/** Display only the part occupying this day. End-at-midnight does not occupy the next day. */
export function departmentAbsenceTime(row: DepartmentAbsence, date: string): string | null {
  if (row.kind === 'annual' || row.kind === 'official') return row.from <= date && date <= row.to ? '종일' : null
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.end)) return null
  if (row.kind === 'offsite' && (row.continuous || row.endNextDay)) {
    const start = Date.parse(`${row.from}T${row.start}:00Z`), end = Date.parse(`${row.to}T${row.end}:00Z`) + (row.endNextDay ? DAY : 0)
    const lower = Date.parse(`${date}T00:00:00Z`), upper = lower + DAY
    if (end <= start || start >= upper || end <= lower) return null
    return `${start <= lower ? '00:00' : row.start}–${end >= upper ? '24:00' : row.end}`
  }
  return row.from <= date && date <= row.to && row.start < row.end ? `${row.start}–${row.end}` : null
}

/** Bounded to the displayed month; independent of the length of a saved offsite period. */
export function departmentAbsenceIndex(rows: readonly DepartmentAbsence[], month: string, search = '') {
  const result = new Map<string, DepartmentDayAbsence[]>(), window = departmentScheduleMonth(month)
  if (!window) return result
  const text = search.trim().toLocaleLowerCase(), seen = new Set<string>()
  const dates = attendanceMonthDates(month)
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    if (text && !`${row.name} ${DEPARTMENT_ABSENCE_LABELS[row.kind]} ${row.start} ${row.end}`.toLocaleLowerCase().includes(text)) continue
    for (const date of dates) {
      const time = departmentAbsenceTime(row, date)
      if (time == null) continue
      const values = result.get(date) ?? []
      values.push({ ...row, date, time }); result.set(date, values)
    }
  }
  for (const values of result.values()) values.sort((a, b) => (a.time === '종일' ? '00:00' : a.time).localeCompare(b.time === '종일' ? '00:00' : b.time) || a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
  return result
}
