import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Users,
  Network,
  Search,
  Settings2,
  SlidersHorizontal,
  ChevronDown,
  Pencil,
  CircleAlert,
  Check,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { useRenderWatch } from '@/lib/diagnostics'
import { canEditOrgAssignment } from '@/lib/company/capabilities'
import { personInitials } from '@/lib/company/person-name'
import { useAuth } from '@/lib/supabase/auth'
import {
  deletePersonnelTitle,
  listDepartments,
  listOrgChartMembers,
  listPersonnelTitles,
  renamePersonnelTitle,
  createPersonnelTitle,
  updateOrgAssignment,
  type Department,
  type OrgChartMember,
  type PersonnelTitle,
  type PersonnelTitleKind,
} from '@/lib/supabase/profiles'
import { cn, emptyList, formatNumber } from '@/lib/utils'

const TEAM_TONES = [
  'bg-[#f1e7d6] text-[#7a5a2b]',
  'bg-[#e1ece4] text-[#2f6b4f]',
  'bg-[#e3e7f2] text-[#3d4a78]',
  'bg-[#f3e1e0] text-[#9a3f3c]',
  'bg-[#ebe3f1] text-[#5d4a7a]',
  'bg-[#dfecee] text-[#2d6470]',
] as const
const UNASSIGNED_TONE = 'bg-muted text-muted-foreground'
type OrgView = 'chart' | 'members' | 'titles'
type TeamGroup = {
  id: string
  name: string
  tone: string
  members: OrgChartMember[]
}

function titleOrder(name: string | null, order: ReadonlyMap<string, number>) {
  const key = name?.trim()
  return key ? order.get(key) ?? 900 : 1000
}
function memberName(member: OrgChartMember) {
  return member.displayName?.trim() || '이름 없음'
}
function compareMembers(
  left: OrgChartMember,
  right: OrgChartMember,
  dutyOrder: ReadonlyMap<string, number>,
  gradeOrder: ReadonlyMap<string, number>,
) {
  return (
    titleOrder(left.position, dutyOrder) -
      titleOrder(right.position, dutyOrder) ||
    titleOrder(left.jobGrade, gradeOrder) -
      titleOrder(right.jobGrade, gradeOrder) ||
    memberName(left).localeCompare(memberName(right), 'ko')
  )
}

export function OrgChartPage() {
  useRenderWatch('OrgChartPage')
  const { profile } = useAuth()
  const queryClient = useQueryClient()
  const canEdit = canEditOrgAssignment(profile)
  const [view, setView] = useState<OrgView>('chart')
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const membersQuery = useQuery({
    queryKey: ['orgChartMembers'],
    queryFn: () => listOrgChartMembers(),
  })
  const titlesQuery = useQuery({
    queryKey: ['personnelTitles'],
    queryFn: () => listPersonnelTitles(),
  })
  const departments = departmentsQuery.data ?? emptyList<Department>()
  const members = membersQuery.data ?? emptyList<OrgChartMember>()
  const titles = titlesQuery.data ?? emptyList<PersonnelTitle>()

  useEffect(() => {
    if (departmentsQuery.error)
      console.warn('[org-chart] 부서 목록 조회 실패', departmentsQuery.error)
  }, [departmentsQuery.error])
  useEffect(() => {
    if (membersQuery.error)
      console.warn('[org-chart] 직원 목록 조회 실패', membersQuery.error)
  }, [membersQuery.error])
  useEffect(() => {
    if (titlesQuery.error)
      console.warn('[org-chart] 직책·직급 목록 조회 실패', titlesQuery.error)
  }, [titlesQuery.error])

  const departmentNames = useMemo(
    () => new Map(departments.map((dept) => [dept.id, dept.name])),
    [departments],
  )
  const departmentName = (id: string | null) =>
    (id && departmentNames.get(id)) || '소속 없음'
  const duties = useMemo(
    () => titles.filter((t) => t.kind === 'duty'),
    [titles],
  )
  const grades = useMemo(
    () => titles.filter((t) => t.kind === 'grade'),
    [titles],
  )
  const dutyOrder = useMemo(
    () => new Map(duties.map((t) => [t.name, t.sortOrder])),
    [duties],
  )
  const gradeOrder = useMemo(
    () => new Map(grades.map((t) => [t.name, t.sortOrder])),
    [grades],
  )
  const { staffed, empty, unsetMembers } = useMemo(() => {
    const activeIds = new Set(departments.map((dept) => dept.id))
    const byDepartment = new Map<string, OrgChartMember[]>()
    const unassigned: OrgChartMember[] = []
    const unset: OrgChartMember[] = []
    for (const member of members) {
      const hasDepartment =
        member.departmentId && activeIds.has(member.departmentId)
      if (hasDepartment && member.departmentId) {
        const list = byDepartment.get(member.departmentId) ?? []
        list.push(member)
        byDepartment.set(member.departmentId, list)
      } else unassigned.push(member)
      if (
        !hasDepartment ||
        (!member.position?.trim() && !member.jobGrade?.trim())
      )
        unset.push(member)
    }
    const teams: TeamGroup[] = departments.map((dept, index) => ({
      id: dept.id,
      name: dept.name,
      tone: TEAM_TONES[index % TEAM_TONES.length] ?? UNASSIGNED_TONE,
      members: (byDepartment.get(dept.id) ?? []).sort((a, b) =>
        compareMembers(a, b, dutyOrder, gradeOrder),
      ),
    }))
    const populated = teams.filter((team) => team.members.length > 0)
    if (unassigned.length)
      populated.push({
        id: 'unassigned',
        name: '소속 없음',
        tone: UNASSIGNED_TONE,
        members: unassigned.sort((a, b) =>
          compareMembers(a, b, dutyOrder, gradeOrder),
        ),
      })
    return {
      staffed: populated,
      empty: teams.filter((team) => team.members.length === 0),
      unsetMembers: unset,
    }
  }, [departments, members, dutyOrder, gradeOrder])

  const needle = search.trim().toLocaleLowerCase('ko')
  const { visibleTeams, visibleEmpty, visibleMembers } = useMemo(() => {
    const matches = (member: OrgChartMember, teamName: string) =>
      [memberName(member), member.position, member.jobGrade, teamName]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ko')
        .includes(needle)
    const filteredTeams = staffed
      .filter(
        (team) => departmentFilter === 'all' || departmentFilter === team.id,
      )
      .map((team) => ({
        ...team,
        members: team.members.filter((member) => matches(member, team.name)),
      }))
      .filter((team) => team.members.length > 0)
    return {
      visibleTeams: filteredTeams,
      visibleEmpty: empty.filter(
        (team) =>
          (departmentFilter === 'all' || departmentFilter === team.id) &&
          team.name.toLocaleLowerCase('ko').includes(needle),
      ),
      visibleMembers: filteredTeams
        .flatMap((team) => team.members)
        .sort((a, b) => compareMembers(a, b, dutyOrder, gradeOrder)),
    }
  }, [staffed, empty, departmentFilter, needle, dutyOrder, gradeOrder])
  const editingMember =
    members.find((member) => member.id === editingId) ?? null
  const activeView = canEdit ? view : 'chart'
  const loading =
    departmentsQuery.isPending ||
    membersQuery.isPending ||
    titlesQuery.isPending
  const directoryError = departmentsQuery.error || membersQuery.error
  const hasFilter = Boolean(needle) || departmentFilter !== 'all'
  async function refreshAssignments() {
    setEditingId(null)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['orgChartMembers'] }),
      queryClient.invalidateQueries({ queryKey: ['personnelTitles'] }),
    ])
  }
  function clearFilters() {
    setSearch('')
    setDepartmentFilter('all')
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="조직도"
        description="E&J의 부서와 직원 배치를 한눈에 확인합니다."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <OrgStat
          icon={<Users className="size-4" />}
          label="전체 직원"
          value={
            loading || membersQuery.isError
              ? '—'
              : `${formatNumber(members.length)}명`
          }
          detail="재직 중인 직원"
        />
        <OrgStat
          icon={<Network className="size-4" />}
          label="직원이 있는 부서"
          value={
            loading || directoryError
              ? '—'
              : `${formatNumber(
                  staffed.filter((t) => t.id !== 'unassigned').length,
                )}개`
          }
          detail={`전체 ${formatNumber(departments.length)}개 부서`}
        />
        <OrgStat
          icon={<SlidersHorizontal className="size-4" />}
          label="설정 확인"
          value={
            loading || directoryError
              ? '—'
              : `${formatNumber(unsetMembers.length)}명`
          }
          detail="소속 또는 직책·직급 확인"
          className="col-span-2 sm:col-span-1"
        />
      </div>

      {canEdit ? (
        <nav
          aria-label="조직도 보기 방식"
          className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/60 p-1"
        >
          {(
            [
              { id: 'chart', label: '조직도', icon: Network },
              { id: 'members', label: '직원 배치', icon: Users },
              { id: 'titles', label: '직책·직급 설정', icon: Settings2 },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={activeView === item.id}
              onClick={() => setView(item.id)}
              className={cn(
                'flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                activeView === item.id
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </button>
          ))}
          <span className="ml-auto hidden items-center px-3 text-xs text-muted-foreground lg:flex">
            수정 권한 · 개발자 / 운영지원팀
          </span>
        </nav>
      ) : null}

      {directoryError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/5 p-4 text-sm"
        >
          <span className="flex items-center gap-2 text-danger">
            <CircleAlert className="size-4" />
            조직 정보를 불러오지 못했습니다.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void departmentsQuery.refetch()
              void membersQuery.refetch()
            }}
          >
            다시 불러오기
          </Button>
        </div>
      ) : null}
      {titlesQuery.error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm"
        >
          <span>
            직책·직급 목록을 불러오지 못했습니다. 설정은 목록을 불러온 뒤 변경할
            수 있습니다.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void titlesQuery.refetch()
            }}
          >
            목록 다시 불러오기
          </Button>
        </div>
      ) : null}

      {activeView !== 'titles' ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            />
            <Input
              aria-label="직원·부서 검색"
              placeholder="이름, 부서, 직책으로 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 rounded-lg pl-10 pr-10"
            />
            {search ? (
              <button
                type="button"
                aria-label="검색어 지우기"
                onClick={() => setSearch('')}
                className="absolute top-2 right-2 rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" />
              </button>
            ) : null}
          </div>
          <Select
            aria-label="부서 필터"
            value={departmentFilter}
            onChange={(event) => setDepartmentFilter(event.target.value)}
            className="h-10 rounded-lg sm:w-48"
          >
            <option value="all">전체 부서</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
            {staffed.some((team) => team.id === 'unassigned') ? (
              <option value="unassigned">소속 없음</option>
            ) : null}
          </Select>
          <p
            aria-live="polite"
            className="text-xs text-muted-foreground sm:ml-auto"
          >
            {loading
              ? '불러오는 중…'
              : directoryError
              ? '조회를 다시 시도해 주세요'
              : `직원 ${formatNumber(visibleMembers.length)}명${
                  hasFilter ? ' 검색됨' : ''
                }`}
          </p>
        </div>
      ) : null}

      {activeView === 'chart' ? (
        <section
          aria-label="부서별 조직도"
          className="overflow-hidden rounded-2xl border border-border bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/25 px-5 py-5 sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Building2 className="size-6" />
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">E&J</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  회사 공통 조직 · 부서별 직원 현황
                </p>
              </div>
            </div>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
              {canEdit
                ? '직원을 선택하면 배치를 수정할 수 있습니다'
                : '재직 중인 직원의 소속과 직책을 확인합니다'}
            </span>
          </header>
          <div className="p-4 sm:p-6">
            {loading ? (
              <TeamSkeletons />
            ) : directoryError ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                조직 정보를 불러오면 부서별 직원이 표시됩니다.
              </p>
            ) : visibleTeams.length || visibleEmpty.length ? (
              <>
                {visibleTeams.length ? (
                  <ul className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {visibleTeams.map((team) => (
                      <TeamCard
                        key={team.id}
                        team={team}
                        onEdit={
                          canEdit && !titlesQuery.isError
                            ? setEditingId
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                ) : null}
                {visibleEmpty.length ? (
                  <details
                    className={cn(
                      'group rounded-xl border border-dashed border-border bg-muted/20',
                      visibleTeams.length > 0 && 'mt-5',
                    )}
                    open={hasFilter || undefined}
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
                      <Building2 className="size-4 text-muted-foreground" />
                      직원이 없는 부서
                      <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {formatNumber(visibleEmpty.length)}
                      </span>
                      <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                    </summary>
                    <ul className="flex flex-wrap gap-2 border-t border-border/60 px-4 py-4">
                      {visibleEmpty.map((team) => (
                        <li
                          key={team.id}
                          className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
                        >
                          {team.name}
                          <span className="ml-3 text-muted-foreground/60">
                            0명
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Search className="size-7 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {hasFilter
                    ? '검색 조건에 맞는 직원이나 부서가 없습니다.'
                    : '등록된 부서와 직원이 없습니다.'}
                </p>
                {hasFilter ? (
                  <Button size="sm" variant="outline" onClick={clearFilters}>
                    검색 초기화
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </section>
      ) : activeView === 'members' ? (
        <div className="space-y-4">
          {!loading && !directoryError ? (
            <AssignmentStatus
              members={unsetMembers}
              onEdit={!titlesQuery.isError ? setEditingId : undefined}
            />
          ) : null}
          <MemberAssignmentTable
            loading={loading}
            members={directoryError ? [] : visibleMembers}
            departments={departments}
            duties={duties}
            grades={grades}
            departmentName={departmentName}
            onSaved={refreshAssignments}
            canChange={!directoryError && !titlesQuery.isError}
            filtered={hasFilter}
          />
        </div>
      ) : (
        <section className="space-y-4">
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <h2 className="text-base font-semibold">직책과 직급 관리</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              직책은 맡은 역할, 직급은 회사 내 등급입니다. 직원에게 적용할
              항목을 관리합니다.
            </p>
          </div>
          {!titlesQuery.isError ? (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <TitleCatalog
                kind="duty"
                title="직책"
                titles={duties}
                loading={titlesQuery.isPending}
                canEdit={canEdit && !titlesQuery.isError}
                onChanged={refreshAssignments}
              />
              <TitleCatalog
                kind="grade"
                title="직급"
                titles={grades}
                loading={titlesQuery.isPending}
                canEdit={canEdit && !titlesQuery.isError}
                onChanged={refreshAssignments}
              />
            </div>
          ) : null}
        </section>
      )}

      {canEdit && editingMember ? (
        <AssignmentEditor
          key={editingMember.id}
          member={editingMember}
          departments={departments}
          duties={duties}
          grades={grades}
          onClose={() => setEditingId(null)}
          onSaved={refreshAssignments}
        />
      ) : null}
    </div>
  )
}

function OrgStat({
  icon,
  label,
  value,
  detail,
  className,
}: {
  icon: ReactNode
  label: string
  value: string
  detail: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-4 sm:px-5',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="break-keep">{label}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function TeamCard({
  team,
  onEdit,
}: {
  team: TeamGroup
  onEdit?: (memberId: string) => void
}) {
  return (
    <li className="min-w-0">
      <article className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex items-center gap-3 border-b border-border/70 bg-muted/20 px-4 py-4">
          <span
            aria-hidden
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold',
              team.tone,
            )}
          >
            {team.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <h3 className="min-w-0 flex-1 text-sm font-semibold">{team.name}</h3>
          <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground ring-1 ring-border">
            {formatNumber(team.members.length)}명
          </span>
        </header>
        <ul className="divide-y divide-border/60 px-3 py-1">
          {team.members.map((member) => {
            const content = (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    team.tone,
                  )}
                >
                  {personInitials(member.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {memberName(member)}
                  </span>
                  <TitlePills duty={member.position} grade={member.jobGrade} />
                </span>
                {onEdit ? (
                  <Pencil className="size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground" />
                ) : null}
              </>
            )
            return (
              <li key={member.id}>
                {onEdit ? (
                  <button
                    type="button"
                    aria-label={`${memberName(member)} 배치 수정`}
                    onClick={() => onEdit(member.id)}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-2 py-3">
                    {content}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </article>
    </li>
  )
}

function TitlePills({
  duty,
  grade,
}: {
  duty: string | null
  grade: string | null
}) {
  const dutyLabel = duty?.trim(),
    gradeLabel = grade?.trim()
  if (!dutyLabel && !gradeLabel)
    return (
      <span className="mt-1 block text-xs text-muted-foreground">
        직책·직급 미설정
      </span>
    )
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {dutyLabel ? (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground">
          {dutyLabel}
        </span>
      ) : null}
      {gradeLabel ? (
        <span className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {gradeLabel}
        </span>
      ) : null}
    </span>
  )
}

function TeamSkeletons() {
  return (
    <ul
      aria-label="조직도 불러오는 중"
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
    >
      {[0, 1, 2].map((key) => (
        <li
          key={key}
          className="animate-pulse rounded-xl border border-border p-4"
        >
          <div className="flex items-center gap-3">
            <span className="size-10 rounded-xl bg-muted" />
            <span className="h-3 w-24 rounded bg-muted" />
          </div>
          <div className="mt-5 space-y-4 border-t border-border pt-4">
            <span className="block h-4 w-32 rounded bg-muted" />
            <span className="block h-4 w-24 rounded bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  )
}

function AssignmentStatus({
  members,
  onEdit,
}: {
  members: OrgChartMember[]
  onEdit?: (id: string) => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3',
        members.length
          ? 'border-warning/25 bg-warning/5'
          : 'border-success/15 bg-success/5',
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {members.length ? (
          <CircleAlert className="size-4 text-warning" />
        ) : (
          <Check className="size-4 text-success" />
        )}
        {members.length
          ? `배치 확인이 필요한 직원 ${formatNumber(members.length)}명`
          : '배치 확인이 필요한 직원이 없습니다'}
      </div>
      {members.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {members.map((member) => (
            <Button
              key={member.id}
              variant="outline"
              size="sm"
              disabled={!onEdit}
              onClick={() => onEdit?.(member.id)}
            >
              {memberName(member)}
              <Pencil className="size-3" />
            </Button>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        소속 부서가 없거나 직책과 직급이 모두 비어 있는 직원을 확인합니다.
      </p>
    </div>
  )
}

function departmentChoices(
  departments: Department[],
  member: OrgChartMember,
  departmentName: (departmentId: string | null) => string,
) {
  const options = departments.map((dept) => ({
    value: dept.id,
    label: dept.name,
  }))
  if (
    member.departmentId &&
    !options.some((option) => option.value === member.departmentId)
  ) {
    return [
      {
        value: member.departmentId,
        label: departmentName(member.departmentId),
      },
      ...options,
    ]
  }
  return options
}

function titleChoices(titles: PersonnelTitle[], current: string | null) {
  return optionsWithCurrent(titles, current?.trim() ?? '').map((name) => ({
    value: name,
    label: name,
  }))
}

function MemberAssignmentTable({
  loading,
  members,
  departments,
  duties,
  grades,
  departmentName,
  onSaved,
  canChange,
  filtered,
}: {
  loading: boolean
  members: OrgChartMember[]
  departments: Department[]
  duties: PersonnelTitle[]
  grades: PersonnelTitle[]
  departmentName: (departmentId: string | null) => string
  onSaved: () => Promise<void>
  canChange: boolean
  filtered: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: (input: {
      memberId: string
      departmentId: string | null
      position: string | null
      jobGrade: string | null
    }) =>
      updateOrgAssignment(input.memberId, {
        departmentId: input.departmentId,
        position: input.position,
        jobGrade: input.jobGrade,
      }),
    onSuccess: async () => {
      setError(null)
      await onSaved()
    },
    onError: (err) => {
      console.warn('[org-chart] 직원 배치 저장 실패', err)
      setError(err instanceof Error ? err.message : '저장하지 못했습니다.')
    },
  })

  function commit(
    member: OrgChartMember,
    field: 'department' | 'duty' | 'grade',
    value: string,
  ) {
    const departmentId = member.departmentId ?? ''
    const position = member.position?.trim() ?? ''
    const jobGrade = member.jobGrade?.trim() ?? ''
    const nextDepartment = field === 'department' ? value : departmentId
    const nextPosition = field === 'duty' ? value : position
    const nextGrade = field === 'grade' ? value : jobGrade
    if (
      nextDepartment === departmentId &&
      nextPosition === position &&
      nextGrade === jobGrade
    ) {
      return
    }
    setError(null)
    mutation.mutate({
      memberId: member.id,
      departmentId: nextDepartment || null,
      position: nextPosition || null,
      jobGrade: nextGrade || null,
    })
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="px-5 pt-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          직원 배치
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {members.length}명
          </span>
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          부서·직책·직급을 선택하면 바로 저장됩니다. 직책과 직급은 각각 설정할
          수 있습니다.
        </p>
        {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-y border-border bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">이름</th>
              <th className="px-4 py-2.5 font-medium">부서</th>
              <th className="px-4 py-2.5 font-medium">직책</th>
              <th className="px-4 py-2.5 font-medium">직급</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  불러오는 중...
                </td>
              </tr>
            ) : members.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  {filtered
                    ? '검색 조건에 맞는 직원이 없습니다.'
                    : '표시할 직원이 없습니다.'}
                </td>
              </tr>
            ) : (
              members.map((member) => (
                <tr
                  key={member.id}
                  className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/25"
                >
                  <td className="px-4 py-3 font-medium">
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
                      >
                        {personInitials(member.displayName)}
                      </span>
                      {memberName(member)}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <AssignmentSelect
                      label={`${memberName(member)} 부서`}
                      value={member.departmentId ?? ''}
                      disabled={mutation.isPending || !canChange}
                      options={departmentChoices(
                        departments,
                        member,
                        departmentName,
                      )}
                      onChange={(value) => commit(member, 'department', value)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <AssignmentSelect
                      label={`${memberName(member)} 직책`}
                      value={member.position?.trim() ?? ''}
                      disabled={mutation.isPending || !canChange}
                      options={titleChoices(duties, member.position)}
                      onChange={(value) => commit(member, 'duty', value)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <AssignmentSelect
                      label={`${memberName(member)} 직급`}
                      value={member.jobGrade?.trim() ?? ''}
                      disabled={mutation.isPending || !canChange}
                      options={titleChoices(grades, member.jobGrade)}
                      onChange={(value) => commit(member, 'grade', value)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  )
}

function AssignmentSelect({
  label,
  value,
  disabled,
  options,
  onChange,
}: {
  label: string
  value: string
  disabled: boolean
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      disabled={disabled}
      className="h-9 w-full cursor-pointer border-border/60 bg-card px-3 hover:border-foreground/25 focus-visible:border-foreground/25 disabled:cursor-wait disabled:opacity-50"
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">미설정</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}

function AssignmentEditor({
  member,
  departments,
  duties,
  grades,
  onClose,
  onSaved,
}: {
  member: OrgChartMember
  departments: Department[]
  duties: PersonnelTitle[]
  grades: PersonnelTitle[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => {
      dialog?.close()
    }
  }, [])
  const [departmentId, setDepartmentId] = useState(member.departmentId ?? '')
  const [position, setPosition] = useState(member.position ?? '')
  const [jobGrade, setJobGrade] = useState(member.jobGrade ?? '')
  const mutation = useMutation({
    mutationFn: () =>
      updateOrgAssignment(member.id, {
        departmentId: departmentId || null,
        position: position || null,
        jobGrade: jobGrade || null,
      }),
    onSuccess: () => {
      void onSaved()
    },
    onError: (error) => {
      console.warn('[org-chart] 부서·직책 저장 실패', {
        profileId: member.id,
        message: error instanceof Error ? error.message : String(error),
      })
    },
  })
  const errorMessage =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="org-assignment-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!mutation.isPending) onClose()
      }}
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/35 backdrop:backdrop-blur-sm"
    >
      <form
        className="p-6"
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="org-assignment-title" className="text-lg font-semibold">
              {memberName(member)} 배치 수정
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              소속 부서와 맡은 역할을 설정합니다.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="배치 수정 닫기"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium">부서</span>
            <Select
              className="w-full"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              disabled={mutation.isPending}
            >
              <option value="">소속 없음</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">직책</span>
            <Select
              className="w-full"
              value={position}
              onChange={(event) => setPosition(event.target.value)}
              disabled={mutation.isPending}
            >
              <option value="">미설정</option>
              {optionsWithCurrent(duties, position).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium">직급</span>
            <Select
              className="w-full"
              value={jobGrade}
              onChange={(event) => setJobGrade(event.target.value)}
              disabled={mutation.isPending}
            >
              <option value="">미설정</option>
              {optionsWithCurrent(grades, jobGrade).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {errorMessage ? (
          <p className="mt-3 text-sm text-danger">{errorMessage}</p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            취소
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? '저장 중...' : '저장'}
          </Button>
        </div>
      </form>
    </dialog>
  )
}

function optionsWithCurrent(titles: PersonnelTitle[], current: string) {
  const names = titles.map((title) => title.name)
  if (current && !names.includes(current)) return [current, ...names]
  return names
}

function TitleCatalog({
  kind,
  title,
  titles,
  loading,
  canEdit,
  onChanged,
}: {
  kind: PersonnelTitleKind
  title: string
  titles: PersonnelTitle[]
  loading: boolean
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const label = kind === 'duty' ? '직책' : '직급'
  const createMutation = useMutation({
    mutationFn: () => createPersonnelTitle(kind, draft),
    onSuccess: async () => {
      setDraft('')
      setError(null)
      await onChanged()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : `${label}을 추가하지 못했습니다.`,
      )
    },
  })
  const renameMutation = useMutation({
    mutationFn: () => renamePersonnelTitle(renamingId ?? '', renameDraft),
    onSuccess: async () => {
      setRenamingId(null)
      setRenameDraft('')
      setError(null)
      await onChanged()
    },
    onError: (err) => {
      setError(
        err instanceof Error
          ? err.message
          : `${label} 이름을 바꾸지 못했습니다.`,
      )
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePersonnelTitle(id),
    onSuccess: async () => {
      setError(null)
      await onChanged()
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : `${label}을 지우지 못했습니다.`,
      )
    },
  })
  const busy =
    createMutation.isPending ||
    renameMutation.isPending ||
    deleteMutation.isPending

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {title}
        <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {titles.length}개
        </span>
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {kind === 'duty'
          ? '대표이사, 팀장 등 직원이 맡은 역할입니다.'
          : '부장, 대리, 사원 등 회사 내 등급입니다.'}
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-muted-foreground">불러오는 중...</p>
      ) : titles.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          등록된 {label}이 없습니다.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border/60 border-y border-border/60">
          {titles.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2.5">
              {renamingId === item.id ? (
                <Input
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  disabled={busy}
                  aria-label={`${item.name} 이름`}
                />
              ) : (
                <span className="min-w-0 flex-1 text-sm">{item.name}</span>
              )}
              {canEdit ? (
                renamingId === item.id ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      disabled={busy || !renameDraft.trim()}
                      onClick={() => renameMutation.mutate()}
                    >
                      저장
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setRenamingId(null)}
                    >
                      취소
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(item.id)
                        setRenameDraft(item.name)
                        setError(null)
                      }}
                    >
                      수정
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => deleteMutation.mutate(item.id)}
                    >
                      삭제
                    </Button>
                  </>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <Input
            value={draft}
            placeholder={`${label} 추가`}
            onChange={(event) => setDraft(event.target.value)}
            disabled={busy}
            aria-label={`${label} 추가`}
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
            추가
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          목록을 불러온 뒤 항목을 변경할 수 있습니다.
        </p>
      )}
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </article>
  )
}
