import assert from 'node:assert/strict'
import { fetchAttendancePages } from './attendance-pagination.ts'

const source = Array.from({ length: 1023 }, (_, index) => index)
const calls: number[] = []
const complete = await fetchAttendancePages(async (from, to) => {
  calls.push(from)
  return { data: source.slice(from, to + 1), error: null }
})
assert.deepEqual(calls, [0, 500, 1000])
assert.deepEqual(complete.rows, source, '1,000행을 넘는 회사 월별 기록도 빠짐없이 읽음')
const failed = await fetchAttendancePages(async from => from === 0
  ? { data: source.slice(0, 500), error: null }
  : { data: null, error: { message: '조회 실패' } })
assert.deepEqual(failed.rows, [], '두 번째 페이지가 실패하면 일부 합계를 반환하지 않음')
assert.equal(failed.error?.message, '조회 실패')
console.log('attendance-pagination.verify ok')
