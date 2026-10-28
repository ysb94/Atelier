import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
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
  const [selected, setSelected] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const excluded = useMemo(() => directory.members.filter(member => member.attendanceExempt), [directory.members])
  const available = useMemo(() => directory.members.filter(member => !member.attendanceExempt), [directory.members])
  const visible = excluded.filter(member => `${memberLabel(member.displayName)} ${directory.departmentName(member.departmentId)}`.toLocaleLowerCase('ko').includes(search.trim().toLocaleLowerCase('ko')))
  const mutation = useMutation({
    mutationFn: ({ id, exempt }: { id: string; exempt: boolean }) => setAttendanceExemption(id, exempt),
    onSuccess: async () => {
      setSelected(''); setError(null)
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
    <FilterBar>
      <Input aria-label="제외자 검색" placeholder="이름·부서 검색" value={search} onChange={event => setSearch(event.target.value)} className="max-w-64" />
      {canEdit ? <><Select aria-label="출퇴근 제외 직원 선택" value={selected} onChange={event => setSelected(event.target.value)} disabled={directory.loading || Boolean(directory.error) || mutation.isPending} className="max-w-80">
        <option value="">추가할 직원 선택</option>
        {available.map(member => <option key={member.id} value={member.id}>{memberLabel(member.displayName)} · {directory.departmentName(member.departmentId)}</option>)}
      </Select><Button disabled={!selected || mutation.isPending || directory.loading || Boolean(directory.error)} onClick={() => save(selected, true)}>제외자 추가</Button></> : null}
    </FilterBar>
    {directory.loading ? <p role="status">불러오는 중…</p> : !directory.error ? <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-left text-sm"><thead className="bg-primary text-primary-foreground"><tr><th className="px-3 py-2">이름</th><th className="px-3 py-2">부서</th><th className="px-3 py-2">관리</th></tr></thead>
        <tbody>{visible.length ? visible.map(member => <tr key={member.id} className="border-t border-border"><td className="px-3 py-2 font-medium">{memberLabel(member.displayName)}</td><td className="px-3 py-2">{directory.departmentName(member.departmentId)}</td><td className="px-3 py-2">{canEdit ? <Button variant="outline" size="sm" disabled={mutation.isPending} aria-label={`${memberLabel(member.displayName)} 제외 해제`} onClick={() => save(member.id, false)}>제외 해제</Button> : '조회 전용'}</td></tr>) : <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">{search.trim() ? '검색 결과가 없습니다.' : '등록된 제외자가 없습니다.'}</td></tr>}</tbody>
      </table></div> : null}
  </CardContent></Card>
}
