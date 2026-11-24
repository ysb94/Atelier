import { useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FilterBar } from '@/components/ui/filter-bar'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import type { PermissionDirectory } from '@/lib/supabase/permission-grants'
import { cn } from '@/lib/utils'
import { buildPermissionGrantRows } from './permission-matrix-model'
import { usePermissionMatrixSources } from './permission-matrix-sources'

type Props = {
  directory?: PermissionDirectory
  loading: boolean
  failed: boolean
  refreshing: boolean
  onRefresh: () => void
}

const NO_DEPARTMENT = '부서 없음'
const sectionStatus = {
  loading: '불러오는 중…',
  unavailable: '현재 계정의 조회 범위에서 확인할 수 없습니다.',
  error: '설정을 불러오지 못했습니다.',
}

export function PermissionMatrix({ directory, loading, failed, refreshing, onRefresh }: Props) {
  useRenderWatch('PermissionMatrix')
  const { profile } = useAuth()
  const configuration = usePermissionMatrixSources(profile, directory)
  const [staffSearch, setStaffSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [assignmentSearch, setAssignmentSearch] = useState('')
  const [assignedOnly, setAssignedOnly] = useState(false)

  const staff = useMemo(() => (directory?.profiles ?? [])
    .filter(person => person.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.department.localeCompare(b.department, 'ko') || a.id.localeCompare(b.id)), [directory])
  const departments = useMemo(() => [...new Set(staff.map(person => person.department || NO_DEPARTMENT))]
    .sort((a, b) => a.localeCompare(b, 'ko')), [staff])
  const staffKeyword = staffSearch.trim().toLocaleLowerCase('ko')
  const members = staff.filter(person => (!department || (person.department || NO_DEPARTMENT) === department)
    && [person.name, person.department, person.position].join(' ').toLocaleLowerCase('ko').includes(staffKeyword))
  const grantRows = useMemo(() => directory ? buildPermissionGrantRows(directory) : [], [directory])
  const memberIds = new Set(members.map(person => person.id))
  const assignmentKeyword = assignmentSearch.trim().toLocaleLowerCase('ko')
  const sections = [{ id: 'grants', label: '기능별 권한', rows: grantRows }, ...configuration]
    .map(section => ({ ...section, rows: section.rows
      .filter(row => [section.label, row.label, row.scope].join(' ').toLocaleLowerCase('ko').includes(assignmentKeyword)
        && (!assignedOnly || row.memberIds.some(id => memberIds.has(id))))
      .map(row => ({ ...row, assigned: new Set(row.memberIds) })) }))
    .filter(section => section.rows.length || section.status && (!assignmentKeyword || section.label.toLocaleLowerCase('ko').includes(assignmentKeyword)))

  if (failed || !directory && !loading) return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4 text-sm">
    <span>권한 목록을 불러오지 못했습니다.</span><Button variant="outline" size="sm" onClick={onRefresh}>다시 불러오기</Button>
  </div>
  if (!directory) return <p role="status" className="p-4 text-sm text-muted-foreground">권한과 담당자 설정을 불러오는 중…</p>
  if (directory.canManageAll === false) return <p role="status" className="p-4 text-sm text-muted-foreground">회사 전체 권한 지정 관리 계정에서 볼 수 있습니다.</p>

  function refresh() {
    onRefresh()
    for (const section of configuration) section.retry?.()
  }

  return <section aria-label="권한·담당자 한눈에 보기" className="space-y-3">
    <FilterBar className="mb-0">
      <Input aria-label="직원 이름 검색" placeholder="직원 이름 검색" value={staffSearch} onChange={event => setStaffSearch(event.target.value)} className="h-9 w-full sm:w-40" />
      <Select aria-label="직원 부서 필터" value={department} onChange={event => setDepartment(event.target.value)} className="h-9 w-full sm:w-36">
        <option value="">전체 부서</option>
        {departments.map(name => <option key={name} value={name}>{name}</option>)}
      </Select>
      <Input aria-label="권한·담당 검색" placeholder="권한·담당 검색" value={assignmentSearch} onChange={event => setAssignmentSearch(event.target.value)} className="h-9 w-full sm:w-52" />
      <label className="flex items-center gap-2 px-1 text-sm"><input type="checkbox" checked={assignedOnly} onChange={event => setAssignedOnly(event.target.checked)} />지정된 항목만</label>
      <Button variant="outline" size="sm" className="self-end sm:ml-auto" disabled={refreshing || configuration.some(section => section.status === 'loading')} onClick={refresh}>
        <RefreshCw className="size-4" />새로고침
      </Button>
    </FilterBar>
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span>{members.length}명 표시{members.length !== staff.length && ` · 전체 ${staff.length}명`}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />지정됨</span>
      {directory.activation === 'pending' && <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border border-warning" />적용 대기</span>}
      <span>빈칸은 미지정</span>
    </div>
    <Card className="overflow-hidden">
      {!members.length || !sections.length ? <p role="status" className="px-5 py-8 text-center text-sm text-muted-foreground">
        {!members.length ? '조건에 맞는 재직 직원이 없습니다.' : '조건에 맞는 권한·담당 설정이 없습니다.'}
      </p> : <div role="region" aria-label="권한 표 스크롤" tabIndex={0} className="max-h-[65dvh] overflow-auto">
        <table aria-label="직원별 권한과 업무 담당 현황" className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead><tr>
            <th scope="col" className="sticky left-0 top-0 z-30 w-44 min-w-44 border-b border-r border-primary-foreground/20 bg-primary px-3 py-2 text-left font-semibold text-primary-foreground sm:w-60 sm:min-w-60">권한·업무 담당</th>
            {members.map(person => <th key={person.id} scope="col" title={[person.name, person.department, person.position].filter(Boolean).join(' · ')} className="sticky top-0 z-20 min-w-20 border-b border-r border-primary-foreground/20 bg-primary px-2 py-2 text-center font-semibold text-primary-foreground">
              <span className="block whitespace-nowrap">{person.name}</span><span className="mt-0.5 block whitespace-nowrap text-[10px] font-normal opacity-80">{person.department || NO_DEPARTMENT}</span>
            </th>)}
          </tr></thead>
          {sections.map(section => <tbody key={section.id}>
            <tr>
              <th scope="rowgroup" className="sticky left-0 z-10 border-b border-r border-border bg-muted px-3 py-2 text-left font-semibold">{section.label}</th>
              <td colSpan={members.length} className="border-b border-border bg-muted px-3 py-2 text-muted-foreground">
                {section.status && <span role={section.status === 'error' ? 'alert' : 'status'}>{sectionStatus[section.status]}</span>}
              </td>
            </tr>
            {section.rows.map(row => <tr key={row.id} className="group">
              <th scope="row" className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-2 text-left font-medium group-hover:bg-muted">
                <span className="block">{row.label}</span>
                {row.scope && <span className="mt-0.5 block font-normal text-muted-foreground">{row.scope}</span>}
              </th>
              {members.map(person => {
                const assigned = row.assigned.has(person.id)
                const status = assigned ? row.pending ? '적용 대기' : '지정됨' : '미지정'
                return <td key={person.id} title={assigned ? `${person.name} · ${row.label} · ${status}` : undefined} className="border-b border-r border-border/50 text-center group-hover:bg-muted/60">
                  {assigned && <span aria-hidden="true" className={cn('inline-block size-2.5 rounded-full align-middle', row.pending ? 'border border-warning' : 'bg-primary')} />}
                  <span className="sr-only">{status}</span>
                </td>
              })}
            </tr>)}
          </tbody>)}
        </table>
      </div>}
    </Card>
  </section>
}
