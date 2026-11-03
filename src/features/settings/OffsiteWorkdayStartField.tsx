import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import { getMyWorkdayBasis } from '@/lib/supabase/attendance-entry'
import { workdayGuidance } from '@/features/home/attendance-guidance'
import { clockOutLabel, koreaDateKey } from './my-attendance'
import type { PersonalRequest, RequestForm } from './personal-requests'

export function OffsiteWorkdayStartField({ form, requests, onChange }: { form: RequestForm; requests: readonly PersonalRequest[]; onChange: (patch: Partial<RequestForm>) => void }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const basis = useQuery({ queryKey: ['my-workday-basis', userId, form.from, 'offsite-form'], queryFn: () => getMyWorkdayBasis(form.from), enabled: Boolean(userId && form.from), retry: false })
  useEffect(() => { if (basis.error) console.warn('[offsite-workday] 당일 근무 기준 조회 실패', { date: form.from, error: basis.error }) }, [basis.error, form.from])
  const supported = basis.data?.offsiteWorkdayStartSupported === true
  const past = form.from < koreaDateKey()
  const enabled = supported && Boolean(basis.data?.configured) && !past && !basis.isError
  const selected = Boolean(form.offsiteWorkStart)
  const guidance = workdayGuidance(form.from, basis.data ? { ...basis.data, start: form.offsiteWorkStart || basis.data.start } : null, requests.filter(request => request.kind !== 'offsite' && request.kind !== 'overtime'))
  return <section className="space-y-2 rounded-xl border border-border p-3" aria-label="외근일 출근 기준">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={!enabled && !selected} onChange={event => onChange({ offsiteWorkStart: event.target.checked ? basis.data?.start || '' : undefined })} />당일 출근 기준 변경</label>
    <p className="text-xs text-muted-foreground">외근 시작 시각과 별도로, 외근 시작일의 사무실 출근 기준을 변경합니다. 정규 퇴근 기준도 함께 이동합니다.</p>
    {selected && <label className="block text-sm">당일 출근 기준<Select className="mt-1 w-40" aria-label="당일 출근 기준 시각" value={form.offsiteWorkStart} disabled={!enabled} onChange={event => onChange({ offsiteWorkStart: event.target.value })}>{[...new Set([...(basis.data?.startOptions ?? []), form.offsiteWorkStart!])].sort().map(start => <option key={start} value={start}>{start}</option>)}</Select></label>}
    {basis.isPending ? <p role="status" className="text-xs text-muted-foreground">당일 근무 기준 확인 중…</p> : basis.isError ? <p role="alert" className="text-sm text-warning">당일 근무 기준을 불러오지 못했습니다. <button type="button" className="underline" onClick={() => void basis.refetch()}>다시 조회</button></p> : !supported ? <p role="status" className="text-xs text-warning">당일 출근 기준 변경은 서버 적용 대기 중입니다.</p> : past ? <p className="text-xs text-muted-foreground">지난 날짜의 출근 기준은 변경할 수 없습니다.</p> : !basis.data?.configured ? <p className="text-xs text-warning">월별 출근 기준을 먼저 설정해 주세요.</p> : guidance.start != null && guidance.end != null && <p role="status" className="text-sm font-medium">{selected ? '변경 후' : '현재'} 정규 근무 {clockOutLabel(new Date(guidance.start).toISOString())}~{clockOutLabel(new Date(guidance.end).toISOString(), form.from)}</p>}
    {selected && <p className="text-xs text-muted-foreground">해당 날짜의 지각 판단·퇴근 안내·외근 추가 근무 계산에 반영합니다. 외근 취소 시 이 출근 기준 변경도 해제됩니다.</p>}
  </section>
}
