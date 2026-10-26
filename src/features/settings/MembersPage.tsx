import { useMemo, useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'
import {
  approveMember,
  todayDateKey,
  createDepartment,
  listBrandDirectory,
  listDepartments,
  listManageableProfiles,
  listPersonnelTitles,
  type PersonnelTitle,
  rejectMember,
  setMemberDisabled,
  updateDepartment,
  type Profile,
} from '@/lib/supabase/profiles'
import {
  canEditOrgAssignment,
  canManagePersonnel,
  canViewMembers,
  capabilityLabel,
} from '@/lib/company/capabilities'
import { personNameError } from '@/lib/company/person-name'

const emptyTitles: PersonnelTitle[] = []

function withCurrent(options: string[], current: string) {
  if (current && !options.includes(current)) return [current, ...options]
  return options
}

const STATUS_LABEL: Record<Profile['status'], string> = {
  pending: '승인 대기',
  active: '사용 중',
  rejected: '거절',
  disabled: '정지',
}

function departmentCreateErrorText(error: unknown) {
  if (error instanceof Error && error.message === '부서 이름을 입력하세요.') {
    return error.message
  }
  return '부서를 저장하지 못했습니다. 이름을 확인한 뒤 다시 시도해 주세요.'
}

function MemberEditor({
  profile,
  departments,
  brands: _brands,
  duties,
  grades,
  canEditAssignment,
  onDone,
}: {
  profile: Profile
  departments: { id: string; name: string }[]
  brands: { id: string; name: string; nameKo: string }[]
  duties: string[]
  grades: string[]
  canEditAssignment: boolean
  onDone: () => void
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [departmentId, setDepartmentId] = useState(profile.departmentId ?? '')
  const [position, setPosition] = useState(profile.position ?? '')
  const [jobGrade, setJobGrade] = useState(profile.jobGrade ?? '')
  const [hireDate, setHireDate] = useState(profile.hireDate ?? '')
  const capabilities = profile.capabilities
  const leadBrandIds = profile.memberships.filter(member => member.isLead).map(member => member.brandId)
  const isAdmin = profile.isAdmin
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameError = personNameError(displayName)

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">본명</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
          />
          <p className="text-xs text-muted-foreground">
            사내 명단의 본명과 같은지 확인한 뒤 저장하세요.
          </p>
          {nameError ? <p className="text-xs text-danger">{nameError}</p> : null}
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">팀</span>
          <Select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            disabled={busy || !canEditAssignment}
          >
            <option value="">선택</option>
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
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={busy || !canEditAssignment}
          >
            <option value="">미설정</option>
            {withCurrent(duties, position).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">직급</span>
          <Select
            value={jobGrade}
            onChange={(e) => setJobGrade(e.target.value)}
            disabled={busy || !canEditAssignment}
          >
            <option value="">미설정</option>
            {withCurrent(grades, jobGrade).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
          {canEditAssignment ? null : (
            <p className="text-xs text-muted-foreground">
              부서와 직책·직급은 개발자와 운영지원팀만 바꿉니다.
            </p>
          )}
        </label>
        {profile.status === 'pending' ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium">입사일</span>
            <Input
              type="date"
              aria-label="입사일"
              value={hireDate}
              min="1950-01-01"
              max={todayDateKey()}
              onChange={(event) => setHireDate(event.target.value)}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">
              비워 두면 없음입니다. 승인 후 수정은 조직도에서 합니다.
            </p>
          </label>
        ) : null}
      </div>

      <p className="rounded-lg border border-border bg-card p-3 text-sm">기능 권한·브랜드 책임·시스템 운영 담당은 <Link className="text-primary underline" to="/settings/permissions">권한·담당자 설정</Link>에서 지정합니다. 직책과 직급을 바꿔도 지정 권한은 바뀌지 않습니다.</p>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || nameError !== null}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await approveMember({
                profileId: profile.id,
                departmentId,
                position,
                jobGrade,
                ...(profile.status === 'pending' ? { hireDate: hireDate || null } : {}),
                capabilities,
                leadBrandIds,
                isAdmin,
                displayName,
              })
              onDone()
            } catch (err) {
              setError(
                err instanceof Error ? err.message : '승인에 실패했습니다.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          {profile.status === 'pending' ? '승인' : '저장'}
        </Button>
        {profile.status === 'pending' ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await rejectMember(profile.id)
                onDone()
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : '거절에 실패했습니다.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            거절
          </Button>
        ) : null}
        {profile.status === 'active' || profile.status === 'disabled' ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await setMemberDisabled(
                  profile.id,
                  profile.status !== 'disabled',
                )
                onDone()
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : '상태 변경에 실패했습니다.',
                )
              } finally {
                setBusy(false)
              }
            }}
          >
            {profile.status === 'disabled' ? '정지 해제' : '정지'}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function MembersPage() {
  useRenderWatch('MembersPage')
  const { profile: me } = useAuth()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [newDeptName, setNewDeptName] = useState('')
  const canManageMembers = canManagePersonnel(me)
  const canEditAssignment = canEditOrgAssignment(me)
  const canViewMemberList = canViewMembers(me)

  const profilesQuery = useQuery({
    queryKey: ['manageable-profiles'],
    queryFn: listManageableProfiles,
    enabled: canViewMemberList,
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: () => listDepartments(false),
    enabled: canViewMemberList,
  })
  const brandsQuery = useQuery({
    queryKey: ['brand-directory'],
    queryFn: listBrandDirectory,
    enabled: canViewMemberList,
  })
  const titlesQuery = useQuery({
    queryKey: ['personnelTitles'],
    queryFn: listPersonnelTitles,
    enabled: canViewMemberList,
  })

  const profiles = useMemo(
    () => profilesQuery.data ?? [],
    [profilesQuery.data],
  )
  const departments = useMemo(
    () => departmentsQuery.data ?? [],
    [departmentsQuery.data],
  )
  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data])
  const titles = useMemo(
    () => titlesQuery.data ?? emptyTitles,
    [titlesQuery.data],
  )
  const duties = titles
    .filter((title) => title.kind === 'duty')
    .map((title) => title.name)
  const grades = titles
    .filter((title) => title.kind === 'grade')
    .map((title) => title.name)

  const visible = useMemo(() => {
    const others = profiles.filter((p) => p.id !== me?.id)
    if (filter === 'pending') {
      return others.filter(
        (p) => p.status === 'pending' && p.requestedAt != null,
      )
    }
    return others
  }, [profiles, me?.id, filter])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['manageable-profiles'] })
    await queryClient.invalidateQueries({ queryKey: ['departments'] })
  }

  const createDeptMutation = useMutation({
    mutationFn: () => createDepartment(newDeptName),
    onSuccess: async () => {
      setNewDeptName('')
      await invalidate()
    },
    onError: (error) => {
      console.warn('[members] 부서 저장 실패', {
        message: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const brandName = (id: string) =>
    brands.find((b) => b.id === id)?.name ?? id.slice(0, 8)

  if (!canViewMemberList) {
    return <Navigate to="/" replace />
  }

  return (
    <div>
      <PageHeader
        title="멤버"
        description="접근 신청을 승인하고 본명과 회사 업무 역량을 확인합니다. 본명은 사내 명단과 같아야 합니다."
      />

      {!canManageMembers && <p className="mb-4 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">조회 전용 · 멤버 정보는 조회할 수 있습니다. 변경·승인은 기존 업무 권한을 따릅니다.</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={filter === 'pending' ? 'default' : 'outline'}
          onClick={() => setFilter('pending')}
        >
          승인 대기
        </Button>
        <Button
          type="button"
          size="sm"
          variant={filter === 'all' ? 'default' : 'outline'}
          onClick={() => setFilter('all')}
        >
          전체
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void profilesQuery.refetch()}
        >
          새로고침
        </Button>
      </div>

      {profilesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-sm text-muted-foreground">
          {filter === 'pending'
            ? '대기 중인 신청이 없습니다.'
            : '관리할 멤버가 없습니다.'}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((member) => (
            <div
              key={member.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {member.displayName || member.email}
                    </p>
                    <Badge
                      variant={
                        member.status === 'active'
                          ? 'outline'
                          : member.status === 'pending'
                            ? 'muted'
                            : 'danger'
                      }
                    >
                      {STATUS_LABEL[member.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {member.email}
                    {member.departmentName
                      ? ` · ${member.departmentName}`
                      : ''}
                    {member.position
                      ? ` · ${member.position}`
                      : member.status === 'pending'
                        ? ' · 직책 미정'
                        : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    이전 등록 정보(권한 아님):{' '}
                    {member.capabilities.length === 0
                      ? '-'
                      : member.capabilities.map(capabilityLabel).join(', ')}
                    {member.memberships.some((m) => m.isLead)
                      ? ` · 책임자 ${member.memberships
                          .filter((m) => m.isLead)
                          .map((m) => brandName(m.brandId))
                          .join(', ')}`
                      : ''}
                  </p>
                  {member.requestNote ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      남긴 말: {member.requestNote}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canManageMembers}
                  onClick={() =>
                    setEditingId((prev) =>
                      prev === member.id ? null : member.id,
                    )
                  }
                >
                  {editingId === member.id ? '닫기' : '관리'}
                </Button>
              </div>

              {editingId === member.id && canManageMembers ? (
                <MemberEditor
                  profile={member}
                  departments={departments.filter((d) => d.isActive || d.id === member.departmentId)}
                  brands={brands}
                  duties={duties}
                  grades={grades}
                  canEditAssignment={canEditAssignment}
                  onDone={async () => {
                    setEditingId(null)
                    await invalidate()
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canEditAssignment ? (
        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">회사 부서 추가</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              새 부서 이름을 입력하고 저장하면 아래 목록에 표시됩니다.
            </p>
          </div>

          <div>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!newDeptName.trim() || createDeptMutation.isPending) return
                createDeptMutation.mutate()
              }}
            >
              <Input
                className="max-w-xs"
                placeholder="새 부서 이름"
                aria-label="회사 부서 추가"
                value={newDeptName}
                aria-invalid={createDeptMutation.isError || undefined}
                aria-describedby={
                  createDeptMutation.isError ? 'new-department-error' : undefined
                }
                onChange={(e) => {
                  setNewDeptName(e.target.value)
                  if (createDeptMutation.isError) createDeptMutation.reset()
                }}
              />
              <Button
                type="submit"
                disabled={!newDeptName.trim() || createDeptMutation.isPending}
              >
                저장
              </Button>
            </form>
            {createDeptMutation.isError ? (
              <p
                id="new-department-error"
                role="alert"
                className="mt-2 text-sm text-danger"
              >
                {departmentCreateErrorText(createDeptMutation.error)}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            {departments.map((dept, index) => (
              <div
                key={dept.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2"
              >
                <Input
                  className="max-w-xs"
                  defaultValue={dept.name}
                  onBlur={async (event) => {
                    const next = event.target.value.trim()
                    if (!next || next === dept.name) return
                    await updateDepartment(dept.id, { name: next })
                    await invalidate()
                  }}
                />
                <Badge variant={dept.isActive ? 'outline' : 'muted'}>
                  {dept.isActive ? '사용 중' : '중지'}
                </Badge>
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={async () => {
                      const prev = departments[index - 1]
                      if (!prev) return
                      await updateDepartment(dept.id, {
                        sortOrder: prev.sortOrder,
                      })
                      await updateDepartment(prev.id, {
                        sortOrder: dept.sortOrder,
                      })
                      await invalidate()
                    }}
                  >
                    위로
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={index === departments.length - 1}
                    onClick={async () => {
                      const next = departments[index + 1]
                      if (!next) return
                      await updateDepartment(dept.id, {
                        sortOrder: next.sortOrder,
                      })
                      await updateDepartment(next.id, {
                        sortOrder: dept.sortOrder,
                      })
                      await invalidate()
                    }}
                  >
                    아래로
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await updateDepartment(dept.id, {
                        isActive: !dept.isActive,
                      })
                      await invalidate()
                    }}
                  >
                    {dept.isActive ? '중지' : '사용'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
