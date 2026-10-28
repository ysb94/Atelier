import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { useAuth } from '@/lib/supabase/auth'
import { setAttendanceExemption } from '@/lib/supabase/attendance-exemptions'
import { useRenderWatch } from '@/lib/diagnostics'
import { memberLabel } from './OpsStat'
import type { useOpsDirectory } from './ops-directory'

export function AttendanceExemptionsPanel({ directory }: { directory: ReturnType<typeof useOpsDirectory> }) {
  useRenderWatch('AttendanceExemptionsPanel')
  const { profile } = useAuth()
  const cache = useQueryClient()
  const canEdit = canEditOrgAssignment(profile)
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const excluded = useMemo(() => directory.members.filter(member => member.attendanceExempt), [directory.members])
  const available = useMemo(() => directory.members.filter(member => !member.attendanceExempt), [directory.members])
  const needle = search.trim().toLocaleLowerCase('ko')
  const matches = available.filter(member => needle && memberLabel(member.displayName).toLocaleLowerCase('ko').includes(needle))
  const mutation = useMutation({
    mutationFn: ({ id, exempt }: { id: string; exempt: boolean }) => setAttendanceExemption(id, exempt),
    onSuccess: async (_, { exempt }) => {
      if (exempt) setSearch('')
      setError(null)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['orgChartMembers'] }),
        cache.invalidateQueries({ queryKey: ['my-attendance-exemption'] }),
      ])
    },
    onError: cause => setError(cause instanceof Error ? cause.message : '출퇴근 제외자를 저장하지 못했습니다.'),
  })
  function save(id: string, exempt: boolean) {
    if (!canEdit || directory.loading || directory.error || mutation.isPending) return
    setError(null); mutation.mutate({ id, exempt })
  }
  return <Card><CardContent className="space-y-4 p-4">
    <div><h2 className="text-base font-semibold">출퇴근 시간 제외자</h2>
      <p className="mt-1 text-sm text-muted-foreground">여기에 등록된 직원은 출퇴근 확인·지각·결근·퇴근 미처리 관리에서 제외됩니다. 직책과 관계없이 지정하며 기존 기록은 삭제하지 않습니다.</p>
      <p className="mt-1 text-xs text-muted-foreground">제외를 해제하면 기존 출퇴근 기록과 현재 근무 기준으로 다시 관리합니다.</p>
    </div>
    {directory.error ? <div role="alert"><p className="text-sm text-danger">직원과 제외자 목록을 불러오지 못했습니다.</p><Button variant="outline" onClick={directory.refetch}>다시 확인</Button></div> : null}
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    {canEdit ? <div className="space-y-2">
      <FilterBar><Input aria-label="추가할 직원 이름 검색" placeholder="추가할 직원 이름 검색" value={search} onChange={event => setSearch(event.target.value)} className="max-w-80" /></FilterBar>
      {needle && !directory.loading && !directory.error ? <div className="max-h-60 overflow-y-auto rounded-xl border border-border" aria-label="추가할 직원 검색 결과">
        {matches.length ? matches.map(member => <div key={member.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-b-0">
          <div className="min-w-0"><p className="break-words text-sm font-medium">{memberLabel(member.displayName)}</p><p className="text-xs text-muted-foreground">{directory.departmentName(member.departmentId)}</p></div>
          <Button size="sm" disabled={mutation.isPending} aria-label={`${memberLabel(member.displayName)} 제외자 추가`} onClick={() => save(member.id, true)}>추가</Button>
        </div>) : <p role="status" className="px-3 py-3 text-sm text-muted-foreground">추가할 직원이 없습니다. 이미 제외된 직원은 검색에 표시되지 않습니다.</p>}
      </div> : null}
    </div> : null}
    {directory.loading ? <p role="status">불러오는 중…</p> : !directory.error ? <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr><th className="px-3 py-2">이름</th><th className="px-3 py-2">부서</th><th className="px-3 py-2">관리</th></tr></thead>
        <tbody>{excluded.length ? excluded.map(member => <tr key={member.id} className="border-t border-border"><td className="px-3 py-2 font-medium">{memberLabel(member.displayName)}</td><td className="px-3 py-2">{directory.departmentName(member.departmentId)}</td><td className="px-3 py-2">{canEdit ? <Button variant="outline" size="sm" disabled={mutation.isPending} aria-label={`${memberLabel(member.displayName)} 제외 해제`} onClick={() => save(member.id, false)}>제외 해제</Button> : '조회 전용'}</td></tr>) : <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">등록된 제외자가 없습니다.</td></tr>}</tbody>
      </table></div> : null}
  </CardContent></Card>
}
