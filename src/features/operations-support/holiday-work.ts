export type HolidayInterval = { start: number; end: number }
export type HolidaySettlement = { id: string; mode: 'cash' | 'leave'; units: number; amountWon: number | null; paymentMonth: string | null; paidOn: string | null; days: number | null; expires: string | null; note: string; version: number }
export type HolidayWork = {
  id: string | null; employeeId: string; employeeName: string; departmentName: string | null; date: string
  dayKind: 'rest' | 'holiday'; location: 'office' | 'offsite' | 'mixed'; state: 'unreported' | 'planned' | 'submitted' | 'returned' | 'approved' | 'cancelled'
  version: number; intervals: HolidayInterval[]; plannedIntervals: HolidayInterval[]; reason: string; reviewNote: string | null
  actualMinutes: number | null; nightMinutes: number | null; creditUnits: number | null; remainingUnits: number
  legacySettled: boolean; source: { offsites: { id: string }[]; overtimes?: { id: string }[]; clocks: { date: string; in: string; out: string | null }[] }
  canSubmit: boolean; canReview: boolean; canSettle: boolean; settlements: HolidaySettlement[]
}
export type HolidayWorkList = { ready: boolean; rows: HolidayWork[]; isOperations: boolean; policy: { ref: string; date: string } | null }
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
export function holidayPhase(row: HolidayWork) {
  if (row.legacySettled) return '기존 외근·야근 처리 이력'
  if (row.state !== 'approved') return HOLIDAY_STATES[row.state]
  if (row.remainingUnits > 0) return row.settlements.length ? '일부 정산 · 잔여 시간 보관' : '정산 대기 · 시간 보관'
  return row.settlements.some(s => s.mode === 'cash' && !s.paidOn) ? '수당 지급 대기' : '처리 완료'
}

export function parsedHolidayIntervals(values: { start: string; end: string }[]): HolidayInterval[] | null {
  const rows = values.map(row => ({ start: holidayClock(row.start), end: holidayClock(row.end) }))
  return rows.some(row => row.start === null || row.end === null) ? null : rows as HolidayInterval[]
}
