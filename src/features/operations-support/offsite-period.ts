import type { PersonalRequest } from '../settings/personal-requests.ts'

export function offsiteEnd(request: Pick<PersonalRequest, 'to'|'end'|'endNextDay'>) {
  return Date.parse(`${request.to}T${request.end}:00+09:00`) + (request.endNextDay ? 86_400_000 : 0)
}
export function offsitePhase(request: PersonalRequest, now: number) {
  if (request.status === 'cancelled') return 'cancelled'
  if (request.status !== 'approved') return 'other'
  if (Date.parse(`${request.from}T${request.start}:00+09:00`) > now) return 'planned'
  return offsiteEnd(request) <= now ? 'ended' : 'ongoing'
}
export const OFFSITE_PHASE_LABEL = { planned: '예정', ongoing: '진행 중', ended: '종료', cancelled: '취소', other: '확인 필요' } as const
