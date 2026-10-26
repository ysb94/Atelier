import { DEFAULT_REMINDER_BASIS, minuteLabel, minuteOf, type ReminderBasis } from './personal-requests.ts'

export const OVERTIME_DURATIONS = [30, 60, 90, 120, 180] as const

export function rangeMinutes(start: string, end: string): number | null {
  const from = minuteOf(start), to = minuteOf(end)
  return from == null || to == null || to <= from ? null : to - from
}

/** 기존 신청과 동일하게 같은 날짜 안의 시각만 반환한다. */
export function endAfterMinutes(start: string, duration: number): string | null {
  const from = minuteOf(start)
  return from == null || !Number.isInteger(duration) || duration <= 0 || from + duration >= 1440
    ? null : minuteLabel(from + duration)
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return [hours ? `${hours}시간` : '', rest || !hours ? `${rest}분` : ''].filter(Boolean).join(' ')
}

export function leaveWorkMinutes(start: string, end: string, basis = DEFAULT_REMINDER_BASIS): number | null {
  const total = rangeMinutes(start, end), from = minuteOf(start), to = minuteOf(end)
  const breakStart = minuteOf(basis.breakStart), breakEnd = minuteOf(basis.breakEnd)
  if (total == null || from == null || to == null || breakStart == null || breakEnd == null) return null
  return total - Math.max(0, Math.min(to, breakEnd) - Math.max(from, breakStart))
}

function moveWorkMinutes(from: number, amount: number, direction: 1 | -1, basis: ReminderBasis) {
  const breakStart = minuteOf(basis.breakStart)!, breakEnd = minuteOf(basis.breakEnd)!
  let time = from, remaining = amount
  while (remaining > 0 && time >= 0 && time <= 1440) {
    const minute = direction === 1 ? time : time - 1
    if (minute < breakStart || minute >= breakEnd) remaining--
    time += direction
  }
  return minuteLabel(time)
}

export function leaveTimePresets(kind: 'half' | 'quarter', basis = DEFAULT_REMINDER_BASIS) {
  const duration = kind === 'half' ? 240 : 120
  const start = minuteOf(basis.start)!, end = minuteOf(basis.end)!
  return [
    { label: kind === 'half' ? '오전 반차' : '출근 후', start: basis.start, end: moveWorkMinutes(start, duration, 1, basis) },
    { label: kind === 'half' ? '오후 반차' : '퇴근 전', start: moveWorkMinutes(end, duration, -1, basis), end: basis.end },
  ]
}
