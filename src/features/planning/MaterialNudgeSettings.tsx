import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { listDepartments, listOrgChartMembers, type Department, type OrgChartMember } from '@/lib/supabase/profiles'
import { listMaterialNudgeRecipients, saveMaterialNudgeRecipients } from '@/lib/supabase/material-nudge-recipients'
import { cn, emptyList } from '@/lib/utils'

const MAX_NUDGE_RECIPIENTS = 10

export function MaterialNudgeSettings({
  recipientIds,
  onClose,
}: {
  recipientIds: readonly string[]
  onClose: () => void
}) {
  useRenderWatch('MaterialNudgeSettings')
  const queryClient = useQueryClient()
  const membersQuery = useQuery({ queryKey: ['org-chart-members'], queryFn: () => listOrgChartMembers() })
  const departmentsQuery = useQuery({ queryKey: ['departments', 'active'], queryFn: () => listDepartments(true) })
  const [expectedIds, setExpectedIds] = useState(recipientIds)
  const [selected, setSelected] = useState(() => new Set(recipientIds))
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const latest = useMutation({
    mutationFn: listMaterialNudgeRecipients,
    onSuccess: ids => {
      queryClient.setQueryData(['material-nudge-recipients'], ids)
      setExpectedIds(ids)
      setSelected(new Set(ids))
      setNeedsRefresh(false)
    },
  })
  const save = useMutation({
    mutationFn: () => saveMaterialNudgeRecipients([...selected], expectedIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['material-nudge-recipients'] })
      onClose()
    },
    onError: error => {
      if ((error.cause as { code?: string } | undefined)?.code !== '40001') return
      setNotice('')
      setNeedsRefresh(true)
      latest.mutate()
    },
  })
  const conflict = (save.error?.cause as { code?: string } | undefined)?.code === '40001'
  const busy = save.isPending || latest.isPending
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const departments = departmentsQuery.data ?? emptyList<Department>()
  const groups = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('ko')
    const names = new Map(departments.map(department => [department.id, department.name]))
    const grouped = new Map<string, { name: string; people: OrgChartMember[] }>()
    for (const member of members) {
      const departmentName = member.departmentId ? names.get(member.departmentId) : undefined
      const key = !member.departmentId ? 'unassigned' : departmentName ? member.departmentId : 'unknown'
      const name = departmentName ?? (member.departmentId ? '부서 미확인' : '부서 없음')
      if (keyword && ![member.displayName, member.position, member.jobGrade, name].join(' ').toLocaleLowerCase('ko').includes(keyword)) continue
      const group = grouped.get(key) ?? { name, people: [] }
      group.people.push(member)
      grouped.set(key, group)
    }
    return [...grouped].sort(([leftKey, left], [rightKey, right]) =>
      Number(!names.has(leftKey)) - Number(!names.has(rightKey)) || left.name.localeCompare(right.name, 'ko'),
    ).map(([key, group]) => ({
      key,
      name: group.name,
      people: group.people.sort((left, right) => (left.displayName ?? '').localeCompare(right.displayName ?? '', 'ko')),
    }))
  }, [departments, members, search])

  function toggle(id: string) {
    if (!selected.has(id) && selected.size >= MAX_NUDGE_RECIPIENTS) {
      setNotice('알림 받을 사람은 10명까지 지정할 수 있습니다.')
      return
    }
    setNotice('')
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="조르기 설정 닫기" className="absolute inset-0 bg-foreground/30" disabled={busy} onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="material-nudge-title" className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 id="material-nudge-title" className="text-base font-semibold">조르기 설정</h2>
          <p className="mt-1 text-sm text-muted-foreground">조르기를 눌렀을 때 알림을 받을 사람을 지정합니다.</p>
        </div>
        <div className="border-b border-border px-5 py-3">
          <Input aria-label="알림 받을 사람 검색" placeholder="이름 또는 부서 검색" className="max-w-sm" value={search} onChange={event => setSearch(event.target.value)} />
          <p className="mt-2 text-xs text-muted-foreground">받는 사람 {selected.size}명</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3 sm:px-5">
          {(membersQuery.isLoading || departmentsQuery.isLoading) && <p className="py-4 text-sm text-muted-foreground">직원 목록을 불러오는 중…</p>}
          {membersQuery.isError && <p role="alert" className="py-4 text-sm text-danger">직원 목록을 불러오지 못했습니다.</p>}
          {departmentsQuery.isError && <p role="status" className="pb-2 text-xs text-muted-foreground">부서 이름을 불러오지 못했습니다.</p>}
          {!departmentsQuery.isLoading && groups.length > 0 && <div role="group" aria-label="부서별 직원 목록" className="flex min-w-max divide-x divide-border">
            {groups.map(group => <section key={group.key} aria-label={group.name} className="w-40 shrink-0 px-2">
              <h3 className="sticky top-0 z-10 bg-card px-2 py-2 text-xs font-semibold">{group.name}</h3>
              <ul className="space-y-0.5">
                {group.people.map(member => {
                  const name = member.displayName?.trim() || '이름 미등록'
                  const title = [member.position, member.jobGrade].filter(Boolean).join(' · ')
                  const checked = selected.has(member.id)
                  return (
                    <li key={member.id}>
                      <label className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary',
                        checked ? 'bg-primary/10 text-primary' : 'hover:bg-muted')}>
                        <input type="checkbox" className="size-4 shrink-0 accent-primary" checked={checked} disabled={busy || needsRefresh}
                          aria-label={`${name} 알림 받기`} onChange={() => toggle(member.id)} />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-sm font-medium">{name}</span>
                          {title && <span className="block break-words text-xs text-muted-foreground">{title}</span>}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>)}
          </div>}
          {membersQuery.isSuccess && !departmentsQuery.isLoading && !groups.length && <p className="py-4 text-sm text-muted-foreground">검색한 직원이 없습니다.</p>}
        </div>
        {latest.isPending && <p role="status" className="px-5 pb-2 text-sm">다른 직원이 설정을 변경했습니다. 최신 수신자를 불러오는 중입니다.</p>}
        {latest.isError && needsRefresh && <div className="flex items-center gap-2 px-5 pb-2 text-sm">
          <p role="alert" className="text-danger">최신 수신자를 불러오지 못했습니다.</p>
          <Button type="button" size="sm" variant="outline" onClick={() => latest.mutate()}>다시 불러오기</Button>
        </div>}
        {conflict && !needsRefresh && <p role="status" className="px-5 pb-2 text-sm">다른 직원이 저장한 최신 수신자를 불러왔습니다. 확인한 뒤 다시 선택해 주세요.</p>}
        {(notice || (save.error && !conflict)) && <p role="alert" className="px-5 pb-2 text-sm text-danger">{notice || save.error?.message}</p>}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>취소</Button>
          <Button type="button" disabled={busy || needsRefresh || !membersQuery.isSuccess} onClick={() => save.mutate()}>저장</Button>
        </div>
      </div>
    </div>
  )
}
