import assert from 'node:assert/strict'
import type { LeaveRequest } from '../../lib/supabase/leave-requests.ts'
import { attendanceStartIndex, type AttendanceStartSetting } from './attendance-start-settings.ts'
import { offsiteExtraHours } from './offsite-extra-hours.ts'

const request: LeaveRequest = { id: 'offsite', kind: 'offsite', status: 'approved', employeeId: 'a', employeeName: '직원', departmentId: 'd', departmentName: '디자인', from: '2026-11-02', to: '2026-11-02', start: '09:00', end: '21:00', note: '', place: '외근지', createdAt: '', decidedAt: null, decidedByName: null }
const setting: AttendanceStartSetting = { id: 'schedule', month: '2026-11', departmentId: 'd', employeeId: null, source: 'department', start: '09:00', grace: 5 }
const lunch = { start: '12:00', end: '13:00' }
const calculate = (change: Partial<LeaveRequest> = {}, settings = [setting], leaves: LeaveRequest[] = [], month = '2026-11') => offsiteExtraHours({ ...request, ...change }, month, attendanceStartIndex(settings), lunch, leaves)
assert.deepEqual(calculate(), { minutes: 180, days: 1, baseline: '09:00–18:00' })
assert.equal(calculate({ start: '10:00' }).minutes, 180, '늦은 외근 시작은 야근에서 차감하지 않음')
assert.equal(calculate({ start: '20:00' }).minutes, 60, '정규 퇴근 이후 시작하면 외근 구간만 계산')
assert.equal(calculate({ end: '18:00' }).minutes, 0)
assert.equal(calculate({ end: '17:00' }).minutes, 0)
assert.deepEqual(calculate({}, [{ ...setting, start: '10:00' }]), { minutes: 120, days: 1, baseline: '10:00–19:00' })
assert.equal(calculate({}, [setting, { ...setting, id: 'individual', employeeId: 'a', source: 'individual', start: '10:00' }]).minutes, 120, '개인 설정 우선')
assert.equal(calculate({}, [{ ...setting, month: '2026-10' }]).baseline, '기준 미설정')
assert.equal(calculate({}, []).minutes, null)
assert.equal(calculate({ end: '03:00', endNextDay: true }).minutes, 540, '다음 날 새벽 종료는 시작 근무일 기준')
assert.deepEqual(calculate({ from: '2026-10-30', to: '2026-11-02' }), { minutes: 180, days: 1, baseline: '09:00–18:00' }, '기간 외근은 선택 월 평일만')
assert.equal(calculate({ from: '2026-11-06', to: '2026-11-09' }).minutes, 360, '금~월 기간은 금·월 2일')
assert.equal(calculate({ from: '2026-11-07', to: '2026-11-07' }).minutes, 660, '토요일 단일 외근은 점심 제외 전체')
assert.equal(calculate({ from: '2026-11-07', to: '2026-11-07', start: '16:00', end: '15:00', endNextDay: true }).minutes, 1320, '휴일 밤샘 외근은 다음 날 점심도 제외')
assert.equal(calculate({ from: '2026-12-25', to: '2026-12-25' }, [], [], '2026-12').minutes, 660, '공휴일 단일 외근')
assert.equal(calculate({ from: '2026-12-24', to: '2026-12-28' }, [{ ...setting, month: '2026-12' }], [], '2026-12').minutes, 360, '기간 외근은 공휴일 제외')
assert.equal(calculate({ status: 'cancelled' }).minutes, null)
assert.equal(calculate({}, [setting], [{ ...request, kind: 'overtime', start: '18:00', end: '23:00' }]).minutes, 180, '별도 야근 승인이 정규 퇴근 기준을 늦추지 않음')
assert.equal(calculate({}, [setting], [{ ...request, kind: 'half', start: '14:00', end: '18:00' }]).minutes, 420, '오후 휴가 반영')
assert.equal(calculate({}, [setting], [{ ...request, kind: 'half', start: '13:00', end: '18:00' }]).minutes, 480, '예정 퇴근이 점심 직전이면 추가 근무에서도 점심 제외')
assert.equal(calculate({}, [setting], [{ ...request, kind: 'half', employeeId: 'other', start: '14:00', end: '18:00' }]).minutes, 180, '다른 직원 휴가 제외')
assert.equal(calculate({}, [setting], [{ ...request, kind: 'half', status: 'cancelled', start: '14:00', end: '18:00' }]).minutes, 180)
console.info('Offsite extra hours: individual/monthly schedule, regular-end overlap, leave, overnight, selected month, weekdays/holidays and cancellation passed')
