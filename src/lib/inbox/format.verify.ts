/**
 * 채팅 목록 시간.
 * 실행: npx tsx src/lib/inbox/format.verify.ts
 */
import { formatChatClock, formatChatDateLabel, formatChatListTime } from './format'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.parse('2026-09-30T01:00:00.000Z')

assert(
  formatChatListTime('2026-09-30T07:01:00.000Z', now) === '오후 04:01',
  '같은 날은 오후 시:분',
)
assert(
  formatChatListTime('2026-09-29T15:30:00.000Z', now) === '오전 12:30',
  '자정 직후도 같은 날',
)
assert(
  formatChatListTime('2026-09-30T03:00:00.000Z', now) === '오후 12:00',
  '정오',
)
assert(
  formatChatListTime('2026-09-30T00:00:00.000Z', now) === '오전 09:00',
  '오전은 두 자리',
)
assert(
  formatChatListTime('2026-09-29T14:00:00.000Z', now) === '어제',
  '전날',
)
assert(
  formatChatListTime('2026-08-31T06:00:00.000Z', Date.parse('2026-09-01T01:00:00.000Z')) ===
    '어제',
  '월이 바뀌는 전날',
)
assert(
  formatChatListTime('2026-09-28T01:00:00.000Z', now) === '2026-09-28',
  '그 이전은 날짜',
)
assert(formatChatListTime('not-a-date', now) === '', '잘못된 시각')
assert(formatChatClock('2026-09-30T07:01:00.000Z') === '오후 04:01', '말풍선 시각')
assert(formatChatClock('not-a-date') === '', '잘못된 말풍선 시각')
assert(
  formatChatDateLabel('2026-09-30T07:01:00.000Z') === '2026-09-30 (수)',
  '날짜 구분',
)
assert(formatChatDateLabel('not-a-date') === '', '잘못된 날짜 구분')

console.log('format.verify ok')
