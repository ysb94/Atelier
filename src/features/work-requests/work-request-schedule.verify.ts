/**
 * 작업 요청 일정표 배치·드래그 스냅 검증.
 * 실행: npx tsx src/features/work-requests/work-request-schedule.verify.ts
 */
import {
  assignDefaultRange,
  assignFromDrop,
  completionRequestDate,
  dateInRange,
  calendarDayDifference,
  currentWorkElapsedMs,
  dateIndexAtPoint,
  flushWorkTime,
  formatSlashDate,
  formatWorkDuration,
  isPlanOverdue,
  layoutTimelineRequests,
  resizePlannedRange,
  shiftPlannedRange,
  snapDays,
  startWorkTime,
  toCalendarDate,
} from './work-request-schedule'
import type { WorkRequestRecord } from './work-request-types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(formatWorkDuration(30_000) === '30초', '초 단위')
assert(formatWorkDuration(90_000) === '1분 30초', '분 단위')
assert(formatWorkDuration(3_720_000) === '1시간 2분', '시간 단위')
assert(formatSlashDate('2026-08-29') === '8/29', '완료표 날짜는 8/29')
assert(
  currentWorkElapsedMs(
    { accumulatedMs: 60_000, mountedAt: 1_000 },
    31_000,
  ) === 90_000,
  '장착 중이면 누적+현재 구간',
)
const started = startWorkTime({}, 'm1', 'r1', 1000)
const flushed = flushWorkTime(started, 'm1', 'r1', 31_000)
assert(flushed['m1:r1']?.accumulatedMs === 30_000, '빼면 구간이 누적됨')
assert(flushed['m1:r1']?.mountedAt == null, '빼면 장착 시각 해제')

assert(snapDays(64) === 1, '하루 너비는 1일')
assert(snapDays(32) === 1, '절반 이상은 1일로 반올림')
assert(snapDays(20) === 0, '절반 미만은 0일')
assert(snapDays(-70) === -1, '왼쪽 이동도 스냅')

const shifted = shiftPlannedRange('2026-09-10', '2026-09-12', 2)
assert(shifted.plannedStart === '2026-09-12', '좌우 이동 시작일 유지 간격')
assert(shifted.plannedEnd === '2026-09-14', '좌우 이동 종료일 유지 간격')
const rowMove = shiftPlannedRange('2026-09-10', '2026-09-12', 0)
assert(rowMove.plannedStart === '2026-09-10', '행 이동만 하면 시작일 유지')
assert(rowMove.plannedEnd === '2026-09-12', '행 이동만 하면 종료일 유지')

const resizedEnd = resizePlannedRange('2026-09-10', '2026-09-12', 'end', 1)
assert(resizedEnd.plannedStart === '2026-09-10', '끝단 조정은 시작일 유지')
assert(resizedEnd.plannedEnd === '2026-09-13', '끝단 조정은 종료일 변경')

const resizedMin = resizePlannedRange('2026-09-10', '2026-09-12', 'end', -10)
assert(resizedMin.plannedStart === '2026-09-10', '최소 1일 시작 유지')
assert(resizedMin.plannedEnd === '2026-09-10', '최소 1일로 축소')

const resizedStart = resizePlannedRange('2026-09-10', '2026-09-14', 'start', 2)
assert(resizedStart.plannedStart === '2026-09-12', '시작 끝단 조정')
assert(resizedStart.plannedEnd === '2026-09-14', '시작 끝단은 종료일 유지')

const dropped = assignFromDrop('2026-09-08')
assert(dropped.plannedStart === '2026-09-08', '드롭은 당일 시작')
assert(dropped.plannedEnd === '2026-09-08', '드롭은 기본 1일')

const ranged = assignDefaultRange(
  { confirmedDueDate: '2026-09-14', values: { dueDate: '2026-09-10' } },
  '2026-09-07',
)
assert(ranged.plannedStart === '2026-09-07', '클릭 배정은 오늘부터')
assert(ranged.plannedEnd === '2026-09-14', '클릭 배정은 확정 마감까지')

const overdueRange = assignDefaultRange(
  { confirmedDueDate: '2026-09-01', values: { dueDate: '' } },
  '2026-09-07',
)
assert(overdueRange.plannedStart === '2026-09-07', '지난 마감은 오늘 시작')
assert(overdueRange.plannedEnd === '2026-09-07', '지난 마감은 오늘 하루')

assert(dateInRange('2026-09-08T12:00:00.000Z', '2026-09-01', '2026-09-10'), '기간 안')
assert(!dateInRange('2026-08-31', '2026-09-01', '2026-09-10'), '기간 전')
assert(
  completionRequestDate({
    completionRequestedAt: '2026-09-04T10:00:00.000Z',
    completedAt: '2026-09-05T16:20:00.000Z',
    updatedAt: '2026-09-05T16:20:00.000Z',
  } as WorkRequestRecord) === '2026-09-04',
  '완료일은 마지막 완료 요청일',
)

assert(!isPlanOverdue('2026-09-10', '2026-09-12'), '마감 이내는 초과 아님')
assert(isPlanOverdue('2026-09-14', '2026-09-12'), '마감 다음날은 초과')

const start = toCalendarDate('2026-09-01')
const overlapping: WorkRequestRecord[] = [
  {
    id: 'a',
    owner: 'design',
    brandId: '',
    brandDecidedAt: '',
    brandDecidedBy: '',
    values: {
      title: 'A',
      requester: '가',
      requesterPosition: '사원',
      deadlineType: 'preferred',
      dueDate: '2026-09-10',
      scheduleReason: '',
      referenceFiles: [],
      blocks: [],
    },
    requesterDepartment: '물류',
    status: 'inProgress',
    managerPriority: 'normal',
    assignee: 'm1',
    assignedBy: 'lead',
    assignedAt: '2026-09-01T00:00:00.000Z',
    collaborators: [],
    confirmedDueDate: '2026-09-10',
    plannedStart: '2026-09-02',
    plannedEnd: '2026-09-05',
    messages: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: '',
    completionRequestedAt: '',
    completionRejectCount: 0,
  },
  {
    id: 'b',
    owner: 'design',
    brandId: '',
    brandDecidedAt: '',
    brandDecidedBy: '',
    values: {
      title: 'B',
      requester: '나',
      requesterPosition: '사원',
      deadlineType: 'preferred',
      dueDate: '2026-09-10',
      scheduleReason: '',
      referenceFiles: [],
      blocks: [],
    },
    requesterDepartment: '물류',
    status: 'inProgress',
    managerPriority: 'normal',
    assignee: 'm1',
    assignedBy: 'lead',
    assignedAt: '2026-09-01T00:00:00.000Z',
    collaborators: [],
    confirmedDueDate: '2026-09-10',
    plannedStart: '2026-09-03',
    plannedEnd: '2026-09-06',
    messages: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    completedAt: '',
    completionRequestedAt: '',
    completionRejectCount: 0,
  },
]

const layout = layoutTimelineRequests(overlapping, start, 20)
assert(layout.laneCount === 2, '겹치는 업무는 다른 레인')
assert(
  layout.placements.some((item) => item.request.id === 'a' && item.lane === 0),
  '첫 업무는 0번 레인',
)
assert(
  layout.placements.some((item) => item.request.id === 'b' && item.lane === 1),
  '겹치는 둘째 업무는 1번 레인',
)

assert(dateIndexAtPoint(64, 0, start, 10) === 1, '64px는 둘째 칸')
assert(
  calendarDayDifference(toCalendarDate('2026-09-03'), start) === 2,
  '날짜 차이 계산',
)

console.log('work-request-schedule.verify ok')
