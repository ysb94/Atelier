import { useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/supabase/auth'
import {
  approveMember,
  createDepartment,
  listBrandDirectory,
  listDepartments,
  listManageableProfiles,
  POSITION_OPTIONS,
  rejectMember,
  setMemberDisabled,
  updateDepartment,
  type Profile,
} from '@/lib/supabase/profiles'
import {
  capabilityLabel,
  isCompanyManager,
  WORK_CAPABILITIES,
  WORK_CAPABILITY_LABEL,
  type WorkCapability,
} from '@/lib/company/capabilities'

const STATUS_LABEL: Record<Profile['status'], string> = {
  pending: '승인 대기',
  active: '사용 중',
  rejected: '거절',
  disabled: '정지',
}

function MemberEditor({
  profile,
  departments,
  brands,
  canSetAdmin,
  onDone,
}: {
  profile: Profile
  departments: { id: string; name: string }[]
  brands: { id: string; name: string; nameKo: string }[]
  canSetAdmin: boolean
  onDone: () => void
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? '')
  const [departmentId, setDepartmentId] = useState(profile.departmentId ?? '')
  const [position, setPosition] = useState(profile.position ?? '사원')
  const [capabilities, setCapabilities] = useState<WorkCapability[]>(
    profile.capabilities,
  )
  const [leadBrandIds, setLeadBrandIds] = useState(
    profile.memberships.filter((m) => m.isLead).map((m) => m.brandId),
  )
  const [showStewards, setShowStewards] = useState(
    profile.memberships.some((m) => m.isLead),
  )
  const [isAdmin, setIsAdmin] = useState(profile.isAdmin)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function toggleCapability(value: WorkCapability) {
    setCapabilities((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    )
  }

  function toggleLead(id: string) {
    setLeadBrandIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1">
          <span className="text-xs font-medium">이름</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium">팀</span>
          <Select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            disabled={busy}
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
            disabled={busy}
          >
            {POSITION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium">업무 역량</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {WORK_CAPABILITIES.map((capability) => (
            <label
              key={capability}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={capabilities.includes(capability)}
                onChange={() => toggleCapability(capability)}
                disabled={busy}
              />
              {WORK_CAPABILITY_LABEL[capability]}
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowStewards((prev) => !prev)}
        >
          {showStewards ? '브랜드 책임자 접기' : '브랜드 책임자 (선택)'}
        </button>
        {showStewards ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {brands.map((brand) => (
              <label
                key={brand.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={leadBrandIds.includes(brand.id)}
                  onChange={() => toggleLead(brand.id)}
                  disabled={busy}
                />
                {brand.name} 책임자
              </label>
            ))}
          </div>
        ) : null}
      </div>

      {canSetAdmin ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            disabled={busy}
          />
          관리자 권한
        </label>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await approveMember({
                profileId: profile.id,
                departmentId,
                position,
                capabilities,
                leadBrandIds,
                isAdmin: canSetAdmin ? isAdmin : false,
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
  const { profile: me } = useAuth()
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [newDeptName, setNewDeptName] = useState('')
  const canManageMembers = isCompanyManager({
    status: me?.status,
    isAdmin: me?.isAdmin,
    position: me?.position,
  })

  const profilesQuery = useQuery({
    queryKey: ['manageable-profiles'],
    queryFn: listManageableProfiles,
    enabled: canManageMembers,
  })
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: () => listDepartments(false),
    enabled: canManageMembers,
  })
  const brandsQuery = useQuery({
    queryKey: ['brand-directory'],
    queryFn: listBrandDirectory,
    enabled: canManageMembers,
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
  })

  const brandName = (id: string) =>
    brands.find((b) => b.id === id)?.name ?? id.slice(0, 8)

  if (!canManageMembers) {
    return <Navigate to="/" replace />
  }

  return (
    <div>
      <PageHeader
        title="멤버"
        description="접근 신청을 승인하고 회사 업무 역량을 지정합니다. 브랜드 책임자는 선택 사항입니다."
      />

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
                    {member.isAdmin ? (
                      <Badge variant="muted">관리자</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {member.email}
                    {member.departmentName
                      ? ` · ${member.departmentName}`
                      : ''}
                    {member.position ? ` · ${member.position}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    역량:{' '}
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
                  onClick={() =>
                    setEditingId((prev) =>
                      prev === member.id ? null : member.id,
                    )
                  }
                >
                  {editingId === member.id ? '닫기' : '관리'}
                </Button>
              </div>

              {editingId === member.id ? (
                <MemberEditor
                  profile={member}
                  departments={departments.filter((d) => d.isActive || d.id === member.departmentId)}
                  brands={brands}
                  canSetAdmin={Boolean(me?.isAdmin)}
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

      {me?.isAdmin ? (
        <section className="mt-10 space-y-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">팀 관리</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Flow 조직도 팀을 추가하거나 이름을 바꾸고, 쓰지 않는 팀은 중지할
              수 있습니다.
            </p>
          </div>

          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              createDeptMutation.mutate()
            }}
          >
            <Input
              className="max-w-xs"
              placeholder="새 팀 이름"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
            />
            <Button
              type="submit"
              disabled={!newDeptName.trim() || createDeptMutation.isPending}
            >
              팀 추가
            </Button>
          </form>

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
