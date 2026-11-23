import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { canReturnFromOffsite, useOffsiteReturn } from '@/features/home/OffsiteStatus'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { readMyOffsiteClockTimes, type OffsiteState } from '@/lib/supabase/offsite-attendance'
import { clockOutLabel, dayClock, koreaDateKey } from './my-attendance'
import { dateLabel, type PersonalRequest } from './personal-requests'

export function OffsiteDetailAttendance({ request, date, userId, requests, canAct }: {
  request: PersonalRequest
  date: string
  userId: string
  requests: readonly PersonalRequest[]
  canAct: boolean
}) {
  const today = koreaDateKey()
  const workDate = request.offsiteContinuous || request.endNextDay ? request.from : date
  const endDate = request.offsiteContinuous ? request.to : request.endNextDay
    ? new Date(Date.parse(`${workDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : workDate
  const startAt = Date.parse(`${workDate}T${request.start}:00+09:00`)
  const endAt = Date.parse(`${endDate}T${request.end}:00+09:00`)
  const canCheckReturn = canAct && request.status === 'approved' && workDate <= today && today <= endDate
  const { enabled, query, returned, returning } = useOffsiteReturn(canCheckReturn)
  const clockQuery = useQuery({
    queryKey: ['attendance-clock-ins', userId, 'offsite-clock-times', workDate],
    ...sharedReadPolicy,
    queryFn: ({ signal }) => readMyOffsiteClockTimes(userId, workDate, signal),
    enabled: workDate <= today,
    refetchInterval: readPollInterval(30_000, workDate <= today && today <= endDate),
  })

  function matchesDetail(state: OffsiteState | undefined) {
    if (!state || !canReturnFromOffsite(state) || state.workDate !== workDate) return false
    if (state.state === 'clocked_out') return Date.parse(state.scheduledEndAt ?? '') === endAt
    const now = Date.parse(state.serverNow)
    return startAt <= now && now < endAt
  }

  const clock = clockQuery.data
  const correction = requests.find(item => item.kind === 'correction' && item.status === 'approved' && item.from === workDate) ?? null
  const checkout = dayClock({ date: workDate, clockIn: '', clockOutAt: clock?.clock_out_at ?? null,
    autoClosedAt: clock?.auto_closed_at, correction, requests: [], future: workDate > today })
  const finished = returned.data?.state === 'returned' && returned.data.workDate === workDate
  const savedReturn = finished ? returned.data?.serverNow : clock?.offsite_returned_at
  const clockStatus = clockQuery.isError ? '조회 실패' : clockQuery.isLoading ? '확인 중…' : '미기록'
  const returnLabel = savedReturn ? clockOutLabel(savedReturn, workDate)
    : clockStatus
  const checkoutLabel = checkout.end ? `${checkout.end}${checkout.corrected ? ' · 승인 정정' : ''}` : clockStatus

  return <section className="space-y-2" aria-label="외근 출퇴근 기록">
    <dl className="personal-request-view">
      <div><dt>사무실 복귀시간</dt><dd>{returnLabel}</dd></div>
      <div><dt>최종 퇴근시간</dt><dd>{checkoutLabel}</dd></div>
    </dl>
    {workDate !== date && <p className="personal-request-helper">{dateLabel(workDate)} 근무일 기록</p>}
    {enabled && !query.isError && matchesDetail(query.data) && <Button type="button" disabled={returning}
      onClick={() => returned.mutate(matchesDetail)}>{returning ? '처리 중…' : '사무실 복귀'}</Button>}
    {enabled && query.isError && <div className="flex flex-wrap items-center gap-2">
      <span role="status" className="text-sm text-warning">외근 상태를 확인하지 못했습니다.</span>
      <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>외근 상태 다시 조회</Button>
    </div>}
    {returned.isError && <p role="alert" className="text-sm text-danger">{returned.error.message}</p>}
  </section>
}
