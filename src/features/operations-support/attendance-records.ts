import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import { EMPTY_ATTENDANCE, type AttendanceRecord, type AttendanceRecords, type AttendanceStatus } from './monthly-attendance.ts'

const STATUS_RANK: Partial<Record<LeaveRequest['kind'], number>> = {
  annual: 5, official: 4, half: 3, remote: 2, offsite: 1,
}

function leaveStatus(request: LeaveRequest): AttendanceStatus | null {
  if (request.kind === 'annual') return 'annual'
  if (request.kind === 'official') return 'official'
  if (request.kind === 'remote') return 'remote'
  if (request.kind === 'offsite') return 'offsite'
  if (request.kind === 'half') return request.start < '13:00' ? 'half-am' : 'half-pm'
  return null
}

function withNote(record: AttendanceRecord, note: string): AttendanceRecord {
  return note ? { ...record, note: [record.note, note].filter(Boolean).join(' · ') } : record
}

/** 회사 출근 기록과 대기·승인 신청을 월별 근태 칸으로 바꾼다. */
export function buildAttendanceRecords(dates: readonly string[], clocks: readonly { employeeId: string; date: string; clockIn: string }[], leaves: readonly LeaveRequest[]): AttendanceRecords {
  const days = new Set(dates)
  const records: AttendanceRecords = {}
  for (const clock of clocks) {
    if (!days.has(clock.date)) continue
    const day = records[clock.date] ?? {}
    day[clock.employeeId] = { ...EMPTY_ATTENDANCE, status: 'present', start: clock.clockIn }
    records[clock.date] = day
  }
  const grouped = new Map<string, LeaveRequest[]>()
  for (const request of leaves) {
    if (request.status !== 'approved' && request.status !== 'pending') continue
    if (request.kind === 'correction' || request.kind === 'overtime') continue
    for (const date of dates) {
      if (request.from > date || date > request.to) continue
      const key = `${request.employeeId}:${date}`
      grouped.set(key, [...(grouped.get(key) ?? []), request])
    }
  }
  for (const [key, requests] of grouped) {
    const split = key.indexOf(':')
    const employeeId = key.slice(0, split)
    const date = key.slice(split + 1)
    const ranked = requests.filter(request => request.kind !== 'quarter').sort((left, right) =>
      (STATUS_RANK[right.kind] ?? 0) - (STATUS_RANK[left.kind] ?? 0) || Number(right.status === 'approved') - Number(left.status === 'approved'))
    const chosen = ranked[0]
    let record = records[date]?.[employeeId] ?? { ...EMPTY_ATTENDANCE }
    if (chosen) {
      const status = leaveStatus(chosen)
      if (status) record = { ...record, status, note: chosen.status === 'pending' ? '승인 대기' : record.note }
    }
    for (const quarter of requests.filter(request => request.kind === 'quarter')) {
      record = withNote(record, ['반반차', quarter.start && quarter.end ? `${quarter.start}–${quarter.end}` : '', quarter.status === 'pending' ? '승인 대기' : ''].filter(Boolean).join(' '))
    }
    if (record.status === 'unset' && !record.note) continue
    const day = records[date] ?? {}
    day[employeeId] = record
    records[date] = day
  }
  return records
}
