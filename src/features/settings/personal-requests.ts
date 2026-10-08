export const REQUEST_KINDS = [
  { id: 'annual', label: '월차/연차', group: '휴가' },
  { id: 'half', label: '반차', group: '휴가' },
  { id: 'quarter', label: '반반차', group: '휴가' },
  { id: 'offsite', label: '외근', group: '근무' },
  { id: 'remote', label: '재택', group: '근무' },
  { id: 'overtime', label: '야근', group: '근무' },
  { id: 'correction', label: '출퇴근 정정', group: '정정' },
] as const
export type RequestKind = typeof REQUEST_KINDS[number]['id']
export type PersonalRequest = {
  id: string; kind: RequestKind; from: string; to: string; start: string; end: string
  place: string; note: string; status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  createdAt: string; decisionNote?: string
}
export type RequestForm = Omit<PersonalRequest, 'id' | 'status' | 'createdAt' | 'decisionNote'>
export type ReminderBasis = { start: string; end: string; breakStart: string; breakEnd: string; before: number }
export const DEFAULT_REMINDER_BASIS: ReminderBasis = { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00', before: 10 }
export function requestLabel(kind: RequestKind) { return REQUEST_KINDS.find(item => item.id === kind)!.label }
export function isFullLeave(kind: RequestKind) { return kind === 'annual' }
export function isPartialLeave(kind: RequestKind) { return kind === 'half' || kind === 'quarter' }
export function isLeaveRequest(kind: RequestKind) { return isFullLeave(kind) || isPartialLeave(kind) }
export function isSavedRequest(kind: RequestKind) { return isLeaveRequest(kind) || kind === 'overtime' }
export function minuteOf(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [h, m] = value.split(':').map(Number)
  return h * 60 + m
}
export function minuteLabel(value: number) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` }
export function dateLabel(date: string) { return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일` }
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00`)
  return !Number.isNaN(date.getTime()) && date.getFullYear() === Number(value.slice(0,4)) && date.getMonth()+1 === Number(value.slice(5,7)) && date.getDate() === Number(value.slice(8,10))
}
function interval(form: RequestForm | PersonalRequest) {
  return [form.from + (isFullLeave(form.kind) ? 'T00:00' : `T${form.start}`), form.to + (isFullLeave(form.kind) ? 'T24:00' : `T${form.end}`)]
}
export function validateRequest(form: RequestForm, requests: PersonalRequest[], basis: ReminderBasis) {
  if (!validDate(form.from) || !validDate(form.to) || form.to < form.from) return '신청 시작일과 종료일을 확인해 주세요.'
  if (!isFullLeave(form.kind)) {
    const start = minuteOf(form.start), end = minuteOf(form.end)
    if (start == null || end == null || end <= start) return '시작·종료 시각을 확인해 주세요. 자정을 넘기는 일정은 날짜별로 나눠 신청해 주세요.'
  }
  if ((isPartialLeave(form.kind) || form.kind === 'correction' || form.kind === 'overtime') && form.from !== form.to) return '이 신청은 날짜별로 작성해 주세요.'
  if (isPartialLeave(form.kind)) {
    const start = minuteOf(form.start)!, end = minuteOf(form.end)!
    const workStart = minuteOf(basis.start), workEnd = minuteOf(basis.end)
    const breakStart = minuteOf(basis.breakStart), breakEnd = minuteOf(basis.breakEnd)
    if (workStart == null || workEnd == null || breakStart == null || breakEnd == null || workEnd <= workStart || breakEnd < breakStart || breakStart < workStart || breakEnd > workEnd) return '알림 미리보기의 근무·휴게 시각을 먼저 확인해 주세요.'
    if (start < workStart || end > workEnd) return '휴가 시간을 미리보기 근무시간 안에서 선택해 주세요.'
    const workMinutes = end - start - Math.max(0, Math.min(end, breakEnd) - Math.max(start, breakStart))
    if (workMinutes !== (form.kind === 'half' ? 240 : 120)) return `${requestLabel(form.kind)}는 시안 기준으로 휴게시간을 제외한 ${form.kind === 'half' ? '4' : '2'}시간을 선택해 주세요.`
  }
  if (form.kind === 'offsite' && !form.place.trim()) return '외근 장소를 입력해 주세요.'
  if ((form.kind === 'overtime' || form.kind === 'correction') && !form.note.trim()) return '신청 사유를 입력해 주세요.'
  if (form.kind !== 'correction') {
    const [from, to] = interval(form)
    const conflict = requests.some(item => {
      if (!['pending','approved'].includes(item.status) || item.kind === 'correction') return false
      const locationWithPartialLeave = (isPartialLeave(form.kind) && ['remote','offsite'].includes(item.kind)) || (isPartialLeave(item.kind) && ['remote','offsite'].includes(form.kind))
      if (locationWithPartialLeave) return false
      const [itemFrom, itemTo] = interval(item)
      // A full-day leave conflicts with any work request. Time intervals use strict boundaries.
      return from < itemTo && to > itemFrom
    })
    if (conflict) return '같은 시간에 대기 중이거나 승인된 신청이 있습니다. 기존 신청을 확인해 주세요.'
  }
  return ''
}
export function reminderPreview(form: RequestForm, basis: ReminderBasis) {
  if (isFullLeave(form.kind)) return ['휴가일에는 출근·퇴근 알림을 보내지 않습니다.']
  if (form.kind === 'correction') return ['기록 정정은 예정 근무 알림을 변경하지 않습니다.']
  let start = minuteOf(basis.start), end = minuteOf(basis.end)
  const leaveStart = minuteOf(form.start), leaveEnd = minuteOf(form.end)
  if (start == null || end == null || end <= start || leaveStart == null || leaveEnd == null || leaveEnd <= leaveStart) return ['근무 기준과 신청 시간을 입력하면 알림을 미리 볼 수 있습니다.']
  if (form.kind === 'overtime') end = Math.max(end, leaveEnd)
  else if (form.kind === 'offsite' || form.kind === 'remote') { start = leaveStart; end = leaveEnd }
  else {
    const breakStart = minuteOf(basis.breakStart), breakEnd = minuteOf(basis.breakEnd)
    if (leaveStart <= start) {
      start = leaveEnd
      if (breakStart != null && breakEnd != null && start >= breakStart && start < breakEnd) start = breakEnd
    }
    if (leaveEnd >= end) {
      end = leaveStart
      if (breakStart != null && breakEnd != null && end > breakStart && end <= breakEnd) end = breakStart
    }
  }
  return [
    `출근 기준 ${minuteLabel(start)} · ${minuteLabel(Math.max(0, start - basis.before))}에 알림`,
    `퇴근 기준 ${minuteLabel(end)} · ${minuteLabel(Math.max(0, end - basis.before))}에 알림`,
    ...(isPartialLeave(form.kind) ? [`휴가 구간 ${form.start}–${form.end}은 출퇴근 누락 판단에서 제외합니다.`] : []),
    '퇴근 예정 시각이 지나도 기록이 없으면 확인 대상으로 표시합니다.',
  ]
}
