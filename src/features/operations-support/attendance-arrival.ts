import type { PersonalRequest } from '../settings/personal-requests.ts'

export type ArrivalInterval = { start: string; end: string }
type ArrivalRequest = Pick<PersonalRequest, 'kind' | 'status' | 'from' | 'to' | 'start' | 'end'>
export type ArrivalClock = { clockIn: string; clockInSource?: string | null }

const DEFAULT_LUNCH: ArrivalInterval = { start: '12:00', end: '13:00' }

export function isMorningHalf(start: string, lunch = DEFAULT_LUNCH): boolean {
  const from = minutes(start), lunchEnd = minutes(lunch.end)
  return from != null && lunchEnd != null && from < lunchEnd
}

export function approvedArrivalIntervals(requests: readonly ArrivalRequest[], date: string, lunch = DEFAULT_LUNCH): ArrivalInterval[] {
  return requests.filter(r => r.status === 'approved' && r.from <= date && date <= r.to &&
    (r.kind === 'quarter' || (r.kind === 'half' && isMorningHalf(r.start, lunch))))
    .map(({ start, end }) => ({ start, end }))
}

/** 서버는 신청 시작 시각에 찍힌 자동 출근에만 이 출처를 부여한다. 승인된 정정은 별도 출처를 사용한다. */
export function scheduledOffsiteArrival(clock?: ArrivalClock): string | undefined {
  return clock?.clockInSource === 'offsite' ? clock.clockIn : undefined
}

function minutes(value: string) {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const [hour, minute, second = 0] = value.split(':').map(Number)
  return hour < 24 && minute < 60 && second < 60 ? hour * 60 + minute + second / 60 : null
}

/** 지각 판단에만 사용하는 기준이다. 근무 및 퇴근 시각과 분리한다. */
export function adjustedArrivalStart(start: string, intervals: readonly ArrivalInterval[], lunch = DEFAULT_LUNCH, offsiteStart?: string): string {
  let cursor = minutes(start)
  if (cursor == null) return start
  let result = start
  if (intervals.length > 0) {
    const ranges = [...intervals, lunch].flatMap(interval => {
      const from = minutes(interval.start), to = minutes(interval.end)
      return from != null && to != null && to > from ? [{ from, to, end: interval.end }] : []
    }).sort((a, b) => a.from - b.from || a.to - b.to)
    for (const range of ranges) {
      if (range.from <= cursor && cursor < range.to) { cursor = range.to; result = range.end }
    }
  }
  const offsite = offsiteStart ? minutes(offsiteStart) : null
  return offsiteStart && offsite != null && offsite > cursor ? offsiteStart : result
}

export function attendanceArrivalStart(start: string, requests: readonly ArrivalRequest[], date: string, lunch?: ArrivalInterval, clock?: ArrivalClock): string {
  return adjustedArrivalStart(start, approvedArrivalIntervals(requests, date, lunch), lunch, scheduledOffsiteArrival(clock))
}
