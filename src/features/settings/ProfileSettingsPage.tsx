import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { useAuth } from '@/lib/supabase/auth'
import {
  listBrandDirectory,
  listDepartments,
  POSITION_OPTIONS,
  updateMyProfile,
} from '@/lib/supabase/profiles'

export function ProfileSettingsPage() {
  const { profile, email, refreshProfile } = useAuth()
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })
  const brandsQuery = useQuery({
    queryKey: ['brand-directory'],
    queryFn: listBrandDirectory,
  })

  const departments = useMemo(
    () => departmentsQuery.data ?? [],
    [departmentsQuery.data],
  )
  const brands = useMemo(() => brandsQuery.data ?? [], [brandsQuery.data])

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [departmentId, setDepartmentId] = useState(profile?.departmentId ?? '')
  const [position, setPosition] = useState(profile?.position ?? '사원')

  useEffect(() => {
    if (!profile) return
    setDisplayName(profile.displayName ?? '')
    setDepartmentId(profile.departmentId ?? '')
    setPosition(profile.position ?? '사원')
  }, [profile])

  const assignedBrands = useMemo(() => {
    if (!profile) return []
    const brandMap = new Map(brands.map((brand) => [brand.id, brand]))
    return profile.memberships
      .map((membership) => brandMap.get(membership.brandId))
      .filter((brand): brand is NonNullable<typeof brand> => Boolean(brand))
  }, [brands, profile])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateMyProfile({
        displayName,
        departmentId,
        position,
      }),
    onSuccess: async () => {
      await refreshProfile()
    },
  })

  const dirty =
    displayName !== (profile?.displayName ?? '') ||
    departmentId !== (profile?.departmentId ?? '') ||
    position !== (profile?.position ?? '사원')

  return (
    <div>
      <PageHeader
        title="내 설정"
        description="작업장에 표시되는 이름, 소속 팀, 직책을 수정합니다."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>프로필</CardTitle>
            <CardDescription>
              변경 사항은 저장 후 사이드바와 멤버 목록에 반영됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                saveMutation.mutate()
              }}
            >
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">이름</span>
                <Input
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="홍길동"
                  disabled={saveMutation.isPending}
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">팀</span>
                  <Select
                    required
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    disabled={
                      saveMutation.isPending || departmentsQuery.isLoading
                    }
                  >
                    <option value="">선택</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </Select>
                </label>

                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">직책</span>
                  <Select
                    required
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    disabled={saveMutation.isPending}
                  >
                    {POSITION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              {saveMutation.isError ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                  {saveMutation.error instanceof Error
                    ? saveMutation.error.message
                    : '저장하지 못했습니다.'}
                </p>
              ) : null}

              {saveMutation.isSuccess && !dirty ? (
                <p className="text-sm text-muted-foreground">저장되었습니다.</p>
              ) : null}

              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={!dirty || saveMutation.isPending}
                >
                  {saveMutation.isPending ? '저장 중...' : '저장'}
                </Button>
                {dirty ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={saveMutation.isPending}
                    onClick={() => {
                      setDisplayName(profile?.displayName ?? '')
                      setDepartmentId(profile?.departmentId ?? '')
                      setPosition(profile?.position ?? '사원')
                    }}
                  >
                    되돌리기
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>계정 정보</CardTitle>
            <CardDescription>로그인 계정과 담당 브랜드입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                이메일
              </div>
              <div className="mt-1">{email ?? profile?.email ?? '—'}</div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                담당 브랜드
              </div>
              {assignedBrands.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {assignedBrands.map((brand) => (
                    <li
                      key={brand.id}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2"
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: brand.color }}
                      />
                      <span>
                        {brand.name}
                        <span className="ml-1 text-muted-foreground">
                          {brand.nameKo}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground">지정된 브랜드 없음</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                담당 브랜드 변경은 멤버 관리자에게 요청해 주세요.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
