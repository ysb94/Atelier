import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import type { ChinaAssigneeWorkload } from '@/lib/supabase/china-assigned-work-orders'
import {
  addChinaWorkAssignee,
  CHINA_DEPARTMENT_ID,
  removeChinaWorkAssignee,
  type ChinaWorkAssignee,
} from '@/lib/supabase/china-work-assignees'
import { emptyList } from '@/lib/utils'

function workLeft(workload?: ChinaAssigneeWorkload) {
  if (!workload) return null
  return { open: workload.sampleOpen + workload.materialOpen, resting: workload.sampleResting + workload.materialResting }
}

export function ChinaAssigneeManager({
  assignees,
  mode,
  workloads,
  onClose,
}: {
  assignees: readonly ChinaWorkAssignee[]
  mode: 'add' | 'manage'
  workloads: ReadonlyMap<string, ChinaAssigneeWorkload>
  onClose: () => void
}) {
  useRenderWatch('ChinaAssigneeManager')
  const queryClient = useQueryClient()
  const membersQuery = useQuery({
    queryKey: ['org-chart-members'],
    queryFn: () => listOrgChartMembers(),
  })
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['china-work-assignees'] }),
    queryClient.invalidateQueries({ queryKey: ['china-work-screen'] }),
  ])
  const add = useMutation({ mutationFn: addChinaWorkAssignee, onSuccess: refresh })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const remaining = workLeft(workloads.get(id))
      if (!remaining || remaining.open || remaining.resting) {
        throw new Error('담당 작업을 모두 재배정하고 0 / 0이 된 뒤 삭제할 수 있습니다.')
      }
      await removeChinaWorkAssignee(id)
    },
    onSettled: refresh,
  })
  const pending = add.isPending || remove.isPending
  const error = add.error ?? remove.error
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const byId = new Map(members.map(member => [member.id, member]))
  const selected = new Set(assignees.map(row => row.profileId))
  const candidates = members.filter(member => member.departmentId === CHINA_DEPARTMENT_ID && !selected.has(member.id))
    .sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '', 'ko'))

  useEffect(() => {
    if (membersQuery.error) console.warn('[china-assignees] 중국팀 목록 조회 실패', { code: 'query' })
  }, [membersQuery.error])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !pending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, pending])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="닫기" className="absolute inset-0 bg-black/40" onClick={onClose} disabled={pending} />
      <div role="dialog" aria-modal="true" aria-labelledby="china-assignee-title" className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 id="china-assignee-title" className="text-base font-semibold">{mode === 'add' ? '담당자 추가' : '담당자 삭제 관리'}</h2>
          {mode === 'manage' && <p className="mt-1 text-sm text-muted-foreground">담당 작업이 남아 있으면 먼저 재배정해 주세요.</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {membersQuery.isLoading && <p className="py-4 text-sm text-muted-foreground">중국팀 목록을 불러오는 중...</p>}
          {membersQuery.isError && <p role="alert" className="py-4 text-sm text-danger">중국팀 목록을 불러오지 못했습니다.</p>}
          {mode === 'add' ? (
            <ul className="divide-y divide-border">
              {candidates.map(member => (
                <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">{member.displayName?.trim() || '이름 미등록'}</span>
                  <Button type="button" size="sm" disabled={pending} onClick={() => add.mutate(member.id)}>추가</Button>
                </li>
              ))}
              {membersQuery.isSuccess && !candidates.length && <li className="py-4 text-sm text-muted-foreground">추가할 직원이 없습니다.</li>}
            </ul>
          ) : (
            <ul className="divide-y divide-border">
              {assignees.map(({ profileId }) => {
                const name = byId.get(profileId)?.displayName?.trim() || '이름을 찾을 수 없음'
                const workload = workLeft(workloads.get(profileId))
                const removable = workload?.open === 0 && workload.resting === 0
                return (
                  <li key={profileId} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{name}</span>
                      {!removable && <p className="text-xs text-muted-foreground">{workload
                        ? [workload.open > 0 && `진행 중 ${workload.open}건`, workload.resting > 0 && `완료 대기 ${workload.resting}건`].filter(Boolean).join(' · ')
                        : '남은 업무를 확인할 수 없습니다.'}</p>}
                    </div>
                    {workload && <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title="진행 중 / 완료 대기">{workload.open} / {workload.resting}</span>}
                    <span title={removable ? `${name} 삭제` : '담당 업무가 0 / 0일 때 삭제할 수 있습니다.'}>
                      <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`${name} 삭제`}
                        disabled={pending || !removable} onClick={() => remove.mutate(profileId)}><Trash2 className="size-4" /></Button>
                    </span>
                  </li>
                )
              })}
              {!assignees.length && <li className="py-4 text-sm text-muted-foreground">등록된 담당자가 없습니다.</li>}
            </ul>
          )}
        </div>
        {error && <p role="alert" className="px-5 pb-2 text-sm text-danger">{error.message}</p>}
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>닫기</Button>
        </div>
      </div>
    </div>
  )
}
