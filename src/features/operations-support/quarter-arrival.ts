import type { PersonalRequest } from '../settings/personal-requests.ts'

export type ArrivalInterval = { start: string; end: string }
type QuarterRequest = Pick<PersonalRequest, 'kind' | 'status' | 'from' | 'to' | 'start' | 'end'>

export function approvedQuarterIntervals(requests: readonly QuarterRequest[], date: string): ArrivalInterval[] {
  return requests.filter(r => r.kind === 'quarter' && r.status === 'approved' && r.from <= date && date <= r.to)
    .map(({ start, end }) => ({ start, end }))
}

function minutes(value: string) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const [hour, minute, second = 0] = value.split(':').map(Number)
  return hour < 24 && minute < 60 && second < 60 ? hour * 60 + minute + second / 60 : null
}

/** 출근 기준부터 이어지는 승인 반반차만 제외한다. 근무 시작/퇴근 계산 기준은 바꾸지 않는다. */
export function quarterArrivalStart(start: string, intervals: readonly ArrivalInterval[], lunch?: ArrivalInterval): string {
  let cursor = minutes(start)
  if (cursor == null || intervals.length === 0) return start
  const ranges = [...intervals, ...(lunch ? [lunch] : [])].flatMap(interval => {
    const from = minutes(interval.start), to = minutes(interval.end)
    return from != null && to != null && to > from ? [{ from, to, end: interval.end }] : []
  }).sort((a, b) => a.from - b.from || a.to - b.to)
  let result = start
  for (const range of ranges) {
    if (range.from <= cursor && cursor < range.to) { cursor = range.to; result = range.end }
  }
  return result.slice(0, 5)
}
