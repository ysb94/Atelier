/**
 * 입사 월·일 연차 초기화와 사전 알람일 검증.
 * 실행: npx tsx src/features/operations-support/leave-reset-alarm.verify.ts
 */
import { alarmWasDue, isLeaveAlarmTarget, leaveResetSchedule, nextLeaveResetDate } from './leave-reset-alarm'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(nextLeaveResetDate('2024-03-15', '2026-10-28') === '2027-03-15', '지난 기념일은 다음 해로')
const march = leaveResetSchedule('2024-03-15', '2026-10-28')
assert(march?.alarms.map((alarm) => alarm.date).join(',') === '2026-12-15,2027-02-15,2027-03-01', '3개월·1개월·2주 전')

assert(nextLeaveResetDate('2020-12-01', '2026-10-28') === '2026-12-01', '올해 아직 안 지난 기념일')
const december = leaveResetSchedule('2020-12-01', '2026-10-28')
assert(december?.alarms[0]?.date === '2026-09-01' && alarmWasDue('2026-09-01', '2026-10-28'), '3개월 전은 이미 도래')
assert(december?.alarms[1]?.date === '2026-11-01' && !alarmWasDue('2026-11-01', '2026-10-28'), '1개월 전은 예정')
assert(december?.alarms[2]?.date === '2026-11-17', '2주 전')

assert(nextLeaveResetDate('2020-10-28', '2026-10-28') === '2026-10-28', '초기화 당일을 포함')
assert(nextLeaveResetDate('2026-03-15', '2026-10-28') === '2027-03-15', '입사 당해는 초기화가 아님')
assert(nextLeaveResetDate('2024-02-29', '2026-01-01') === '2026-02-28', '윤일 입사는 평년 2월 말로')
assert(leaveResetSchedule('2020-03-31', '2026-01-01')?.alarms[1]?.date === '2026-02-28', '없는 일은 그 달 말로')
assert(nextLeaveResetDate('날짜 없음', '2026-10-28') == null, '입사일이 없으면 일정을 만들지 않음')
const dueNow = leaveResetSchedule('2025-11-03', '2026-10-28')
const later = leaveResetSchedule('2024-03-15', '2026-10-28')
assert(dueNow != null && isLeaveAlarmTarget(dueNow, '2026-10-28'), '알람일이 지난 직원은 대상')
assert(later != null && !isLeaveAlarmTarget(later, '2026-10-28'), '알람일이 안 된 직원은 대상이 아님')

console.log('leave-reset-alarm.verify ok')
