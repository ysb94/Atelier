import type { PersonalRequest } from '../settings/personal-requests.ts'
import { resolveAttendanceStart, type attendanceStartIndex } from './attendance-start-settings.ts'

export function offsiteWorkdayStart(requests: readonly Pick<PersonalRequest, 'kind' | 'status' | 'from' | 'to' | 'offsiteWorkStart'|'offsiteContinuous'>[], date: string) {
  const starts = new Set(requests.filter(request => request.kind === 'offsite' && request.status === 'approved'
    && request.from === date && (request.to === date || request.offsiteContinuous) && request.offsiteWorkStart).map(request => request.offsiteWorkStart!))
  return starts.size === 1 ? [...starts][0] : null
}

export function resolveWorkdayStart(index: ReturnType<typeof attendanceStartIndex>, employeeId: string, departmentId: string | null, date: string, requests: readonly (PersonalRequest & { employeeId: string })[]) {
  const monthly = resolveAttendanceStart(index, employeeId, departmentId, date.slice(0, 7))
  const start = offsiteWorkdayStart(requests.filter(request => request.employeeId === employeeId), date)
  return start ? { ...monthly, start, configured: true } : monthly
}
