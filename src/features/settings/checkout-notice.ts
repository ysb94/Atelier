import { previousClock } from '@/features/home/attendance-guidance'
import { clockOutLabel, koreaDateKey, type AttendanceClock } from './my-attendance'
import type { PersonalRequest, RequestForm } from './personal-requests'

export function checkoutNoticeRoute(rows: readonly AttendanceClock[], requests: readonly PersonalRequest[], workDate: string, today: string) {
  const record = rows.find(row => row.date === workDate)
  if (record?.clockOutAt || requests.some(row => row.kind === 'correction' && row.from === workDate && ['pending', 'approved'].includes(row.status))) return 'handled'
  if (!record) return 'missing'
  if (workDate >= today) return 'next-day'
  if (previousClock(rows, today)?.date !== workDate) return 'correction'
  return rows.some(row => row.date === today && row.clockIn) ? 'direct' : 'clock-in'
}

/** 오래된 누락은 기존 정정 신청으로만 제출한다. 실제 출퇴근 기록은 직접 바꾸지 않는다. */
export function checkoutCorrection(workDate: string, clockIn: string, value: string, note: string): RequestForm {
  const end = new Date(value)
  if (!Number.isFinite(end.getTime())) throw new Error('실제 퇴근 날짜와 시각을 입력해 주세요.')
  const endDate = koreaDateKey(end)
  const dayDifference = (Date.parse(`${endDate}T00:00:00+09:00`) - Date.parse(`${workDate}T00:00:00+09:00`)) / 86_400_000
  if (dayDifference !== 0 && dayDifference !== 1) throw new Error('퇴근 날짜는 근무일 또는 그 다음 날로 입력해 주세요.')
  return { kind: 'correction', from: workDate, to: workDate, start: clockIn.slice(0, 5), end: clockOutLabel(end.toISOString()),
    endNextDay: dayDifference === 1, place: '', note: note.trim() }
}
