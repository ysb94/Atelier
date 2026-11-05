import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useRenderWatch } from '@/lib/diagnostics'
import { listOrgChartMembers, type OrgChartMember } from '@/lib/supabase/profiles'
import {
  addChinaWorkAssignee,
  CHINA_DEPARTMENT_ID,
  moveChinaWorkAssignee,
  removeChinaWorkAssignee,
  type ChinaWorkAssignee,
} from '@/lib/supabase/china-work-assignees'
import { emptyList } from '@/lib/utils'

export function ChinaAssigneeManager({
  assignees,
  onClose,
}: {
  assignees: readonly ChinaWorkAssignee[]
  onClose: () => void
}) {
  useRenderWatch('ChinaAssigneeManager')
  const queryClient = useQueryClient()
  const membersQuery = useQuery({
    queryKey: ['org-chart-members'],
    queryFn: () => listOrgChartMembers(),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['china-work-assignees'] })
  const add = useMutation({ mutationFn: addChinaWorkAssignee, onSuccess: refresh })
  const remove = useMutation({ mutationFn: removeChinaWorkAssignee, onSuccess: refresh })
  const move = useMutation({
    mutationFn: (input: { profileId: string; direction: 'up' | 'down' }) => moveChinaWorkAssignee(input.profileId, input.direction),
    onSuccess: refresh,
  })
  const pending = add.isPending || remove.isPending || move.isPending
  const error = add.error ?? remove.error ?? move.error
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const byId = new Map(members.map(member => [member.id, member]))
  const selected = new Set(assignees.map(row => row.profileId))
  const chinaMembers = members.filter(member => member.departmentId === CHINA_DEPARTMENT_ID)
    .sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '', 'ko'))
  const rows = [
    ...assignees.map(row => ({ id: row.profileId, member: byId.get(row.profileId) ?? null, selected: true })),
    ...chinaMembers.filter(member => !selected.has(member.id)).map(member => ({ id: member.id, member, selected: false })),
  ]

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
      <div role="dialog" aria-modal="true" aria-labelledby="china-assignee-title" className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 id="china-assignee-title" className="text-base font-semibold">중국팀 담당자</h2>
          <p className="mt-1 text-sm text-muted-foreground">재직 중인 중국팀에서 작업지시서 탭을 추가하거나 빼세요.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {membersQuery.isLoading ? <p className="py-6 text-sm text-muted-foreground">중국팀 목록을 불러오는 중...</p> : null}
          {membersQuery.isError ? <p className="py-6 text-sm text-danger">중국팀 목록을 불러오지 못했습니다.</p> : null}
          {membersQuery.isSuccess && rows.length === 0 ? <p className="py-6 text-sm text-muted-foreground">재직 중인 중국팀 직원이 없습니다.</p> : null}
          <ul className="divide-y divide-border">
            {rows.map(row => {
              const selectedIndex = assignees.findIndex(item => item.profileId === row.id)
              const name = row.member?.displayName?.trim() || '이름을 찾을 수 없음'
              return (
                <li key={row.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{name}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.member?.position?.trim() || (row.member ? '중국팀' : '중국팀에서 빠짐')}</p>
                  </div>
                  {row.selected ? (
                    <div className="flex shrink-0 gap-1">
                      <Button type="button" size="sm" variant="outline" disabled={pending || selectedIndex <= 0} onClick={() => move.mutate({ profileId: row.id, direction: 'up' })}>위로</Button>
                      <Button type="button" size="sm" variant="outline" disabled={pending || selectedIndex < 0 || selectedIndex >= assignees.length - 1} onClick={() => move.mutate({ profileId: row.id, direction: 'down' })}>아래로</Button>
                      <Button type="button" size="sm" variant="danger" disabled={pending} onClick={() => remove.mutate(row.id)}>빼기</Button>
                    </div>
                  ) : (
                    <Button type="button" size="sm" disabled={pending || !row.member} onClick={() => add.mutate(row.id)}>추가</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
        {error ? <p className="px-5 text-sm text-danger">{error.message}</p> : null}
        <div className="flex justify-end border-t border-border px-5 py-3">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>닫기</Button>
        </div>
      </div>
    </div>
  )
}
