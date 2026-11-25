export type HolidayInterval = { start: number; end: number }
export type HolidayCompensationChoice = 'cash' | 'leave'
export const HOLIDAY_COMPENSATION_METHODS = { cash: '가산임금 지급', leave: '보상휴가 부여' } as const
export type HolidayConfirmationWork = {
  name: string; department: string | null; grade: string | null; date: string; location: HolidayWork['location']
  intervals: HolidayInterval[]; actualMinutes: number; creditUnits: number; remainingUnits: number; reason: string
  requestedBy?: string; agreementRef?: string | null
}
export type HolidayWorkConfirmation = {
  id: string; work: HolidayConfirmationWork; requestedAt: string; choice: HolidayCompensationChoice | 'correction' | null
  respondedAt: string | null; correctionReason: string | null; signedPath: string | null; signedAt: string | null; allowLeave: boolean
}
export type HolidaySettlement = { id: string; mode: 'cash' | 'leave' | 'overtime'; units: number; amountWon: number | null; paymentMonth: string | null; paidOn: string | null; days: number | null; expires: string | null; note: string; version: number; overtimeMinutes?: number }
export type HolidayOvertimeCredit = {
  id: string; employeeId: string; employeeName: string; departmentId: string | null; departmentName: string | null
  date: string; minutes: number
}
export type HolidayWork = {
  id: string | null; employeeId: string; employeeName: string; departmentName: string | null; date: string
  dayKind: 'rest' | 'holiday'; location: 'office' | 'offsite' | 'mixed'; state: 'unreported' | 'planned' | 'submitted' | 'returned' | 'approved' | 'cancelled'
  version: number; intervals: HolidayInterval[]; plannedIntervals: HolidayInterval[]; reason: string; reviewNote: string | null
  actualMinutes: number | null; nightMinutes: number | null; creditUnits: number | null; remainingUnits: number
  legacySettled: boolean; source: { offsites: { id: string }[]; overtimes?: { id: string }[]; clocks: { date: string; in: string; out: string | null }[] }
  canSubmit: boolean; canReview: boolean; canSettle: boolean; settlements: HolidaySettlement[]
  jobGrade?: string | null
  confirmation?: HolidayWorkConfirmation
}
export type HolidayWorkList = { ready: boolean; rows: HolidayWork[]; isOperations: boolean; policy: { ref: string; date: string } | null; confirmationWorkflow?: boolean; offlineCompensation?: boolean; confirmedSettlement?: boolean }
export const HOLIDAY_STATES = { unreported: '실제 시간 미제출', planned: '예정', submitted: '부서 확인 대기', returned: '보완 요청', approved: '시간 확인 완료', cancelled: '취소' }
export const HOLIDAY_LOCATIONS = { office: '사무실', offsite: '외근', mixed: '사무실·외근' }
export function holidayClock(value: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(value)) return null
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
}
export function holidayTime(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
/** Units are half-minutes: no fractional 1.5x credit is rounded away. */
export function holidayAmount(intervals: HolidayInterval[], kind: 'rest' | 'holiday') {
  if (!intervals.length || intervals.length > 24) return null
  let last = -1, minutes = 0, night = 0
  for (const row of [...intervals].sort((a, b) => a.start - b.start)) {
    if (!Number.isInteger(row.start) || !Number.isInteger(row.end) || row.start < 0 || row.end > 1440 || row.start >= row.end || row.start < last) return null
    last = row.end; minutes += row.end - row.start
    night += Math.max(0, Math.min(row.end, 360) - row.start) + Math.max(0, row.end - Math.max(row.start, 1320))
  }
  const units = (kind === 'holiday' ? Math.min(minutes, 480) * 3 + Math.max(0, minutes - 480) * 4 : minutes * 3) + night
  return { minutes, night, units }
}
export function holidayCredit(units: number) {
  const seconds = Math.max(0, units) * 30
  return [Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}시간` : '', Math.floor(seconds / 60) % 60 ? `${Math.floor(seconds / 60) % 60}분` : '', seconds % 60 ? '30초' : ''].filter(Boolean).join(' ') || '0분'
}
export function holidayPhase(row: HolidayWork, confirmationWorkflow = false) {
  if (row.legacySettled) return '기존 외근·야근 처리 이력'
  if (row.state !== 'approved') return HOLIDAY_STATES[row.state]
  if (confirmationWorkflow && row.remainingUnits > 0) {
    if (!row.confirmation) return '직원 확인 요청 필요'
    if (!row.confirmation.choice) return '직원 제출 대기'
    if (!row.confirmation.signedAt) return '운영지원 확인 대기'
    return row.settlements.length ? '일부 정산 · 잔여 시간 보관' : '운영지원 정산 대기'
  }
  if (row.remainingUnits > 0) return row.settlements.length ? '일부 정산 · 잔여 시간 보관' : '정산 대기 · 시간 보관'
  return row.settlements.some(s => s.mode === 'cash' && !s.paidOn) ? '수당 지급 대기' : '처리 완료'
}

export function isHolidayCompensationPending(row: HolidayWork, today: string) {
  if (row.legacySettled || row.state === 'cancelled') return false
  if (row.state !== 'approved') return row.date <= today || row.state === 'submitted' || row.state === 'returned'
  return row.remainingUnits > 0 || row.settlements.some(settlement => settlement.mode === 'cash' && !settlement.paidOn)
}

export function holidayConfirmedMethod(row: HolidayWork): HolidayCompensationChoice | null {
  const confirmation = row.confirmation
  if (!confirmation?.signedAt || !confirmation.signedPath || row.state !== 'approved' || !row.canSettle) return null
  if (confirmation.choice === 'cash' || (confirmation.choice === 'leave' && confirmation.allowLeave)) return confirmation.choice
  return null
}

export function parsedHolidayIntervals(values: { start: string; end: string }[]): HolidayInterval[] | null {
  const rows = values.map(row => ({ start: holidayClock(row.start), end: holidayClock(row.end) }))
  return rows.some(row => row.start === null || row.end === null) ? null : rows as HolidayInterval[]
}
