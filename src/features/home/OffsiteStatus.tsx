import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useLeaveRequests } from '@/features/operations-support/use-leave-requests'
import { clockOutLabel, koreaDateKey } from '@/features/settings/my-attendance'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { readImpersonationState } from '@/lib/supabase/impersonation'

type OffsiteState = {
  state: 'inactive' | 'scheduled' | 'offsite' | 'returned' | 'clocked_out'
  workDate: string | null; scheduledStartAt: string | null; scheduledEndAt: string | null; serverNow: string
}

async function offsiteAction(action: 'my_offsite_attendance' | 'return_from_offsite'): Promise<OffsiteState> {
  const { data, error } = await getSupabase().rpc(action)
  if (error) {
    console.warn('[offsite-attendance] 외근 상태 요청 실패', { action, error })
    throw new Error(error.code === 'PGRST202' ? '외근 자동 처리 연결 대기' : error.message)
  }
  return data as OffsiteState
}

export function OffsiteStatus() {
  const { session, profile } = useAuth()
  const preview = usePagePreview()
  const active = useWorkspaceTabActivity()
  const leave = useLeaveRequests()
  const cache = useQueryClient()
  const userId = session?.user.id
  const today = koreaDateKey()
  const hasOffsite = leave.requests.some(request => request.kind === 'offsite' && request.status === 'approved' && request.from <= today && request.to >= today)
  const enabled = Boolean(userId && profile?.status === 'active' && active && !preview?.active && !readImpersonationState())
  const key = ['my-offsite-attendance', userId, today]
  const query = useQuery({ queryKey: key, queryFn: () => offsiteAction('my_offsite_attendance'), enabled, refetchInterval: enabled ? 30_000 : false, retry: false })
  const returned = useMutation({ mutationFn: () => offsiteAction('return_from_offsite'), onSuccess: async data => {
    cache.setQueryData(key, data)
    await Promise.all(['attendance-clock-ins', 'attendance-presence', 'company-attendance-spans', 'company-deferred-clock-outs'].map(part => cache.invalidateQueries({ queryKey: [part] })))
  } })
  if (!enabled) return null
  if (query.error) return hasOffsite ? <span role="status" className="text-warning">{query.error instanceof Error ? query.error.message : '외근 상태 조회 실패'}</span> : null
  const current = query.data
  if (!current || current.state === 'inactive' || current.state === 'returned') return null
  const end = current.scheduledEndAt ? clockOutLabel(current.scheduledEndAt, current.workDate ?? undefined) : ''
  return <div className="flex items-center gap-2" role="group" aria-label="외근 상태">
    <span className="hidden text-muted-foreground sm:inline">{current.state === 'clocked_out' ? `${end} 외근 자동 퇴근` : `${current.state === 'offsite' ? '외근 중' : '외근 예정'}${end ? ` · ${end} 자동 퇴근 예정` : ''}`}</span>
    {(current.state === 'offsite' || current.state === 'clocked_out') && <Button type="button" size="sm" variant="outline" disabled={returned.isPending} onClick={() => returned.mutate()}>{returned.isPending ? '처리 중…' : '사무실 복귀'}</Button>}
    {returned.error && <span role="alert" className="text-danger">{returned.error instanceof Error ? returned.error.message : '복귀 처리 실패'}</span>}
  </div>
}

export function OffsiteConnectionNotice() {
  const { session, profile } = useAuth()
  const preview = usePagePreview()
  const userId = session?.user.id
  const enabled = Boolean(userId && profile?.status === 'active' && !preview?.active && !readImpersonationState())
  const query = useQuery({ queryKey: ['my-offsite-attendance', userId, koreaDateKey()], queryFn: () => offsiteAction('my_offsite_attendance'), enabled, retry: false })
  if (!enabled) return null
  if (query.isPending) return <p role="status" className="personal-request-helper">외근 자동 출퇴근 연결 상태 확인 중…</p>
  if (query.error) return <p role="alert" className="personal-request-error">외근 자동 출퇴근 연결 대기 또는 조회 실패입니다. 연결 전에는 외근을 등록해도 자동 처리되지 않습니다.</p>
  return <p className="personal-request-helper">외근 시작·종료 시각에 자동 출퇴근합니다. 여러 날 신청은 평일에만 자동 처리하며 주말·공휴일 외근은 날짜별로 등록해 주세요.</p>
}
