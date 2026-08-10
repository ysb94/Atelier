import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import {
  listBrandDirectory,
  listDepartments,
  POSITION_OPTIONS,
  submitAccessRequest,
} from '@/lib/supabase/profiles'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'

export function AccessRequestPage() {
  const { profile, refreshProfile, signOut } = useAuth()
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

  const [displayName, setDisplayName] = useState(
    profile?.displayName ?? '',
  )
  const [departmentId, setDepartmentId] = useState(
    profile?.departmentId ?? '',
  )
  const [position, setPosition] = useState(profile?.position ?? '사원')
  const [brandIds, setBrandIds] = useState<string[]>(
    profile?.memberships.map((m) => m.brandId) ?? [],
  )
  const [requestNote, setRequestNote] = useState(profile?.requestNote ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function toggleBrand(id: string) {
    setBrandIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              Atelier
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              접근 신청
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              소속 팀과 담당 브랜드를 알려 주세요. 해당 브랜드 팀장이나
              운영진이 승인하면 작업장에 들어갈 수 있습니다.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
            로그아웃
          </Button>
        </div>

        <form
          className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
          onSubmit={async (event) => {
            event.preventDefault()
            setError(null)
            setSubmitting(true)
            try {
              await submitAccessRequest({
                displayName,
                departmentId,
                position,
                brandIds,
                requestNote,
              })
              await refreshProfile()
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : '신청을 저장하지 못했습니다.',
              )
            } finally {
              setSubmitting(false)
            }
          }}
        >
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">이름</span>
            <Input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="홍길동"
              disabled={submitting}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">팀</span>
              <Select
                required
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                disabled={submitting || departmentsQuery.isLoading}
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
                disabled={submitting}
              >
                {POSITION_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">담당 브랜드</legend>
            <p className="text-xs text-muted-foreground">
              실제로 일할 브랜드를 모두 고르세요.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {brands.map((brand) => {
                const checked = brandIds.includes(brand.id)
                return (
                  <label
                    key={brand.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBrand(brand.id)}
                      disabled={submitting}
                    />
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
                  </label>
                )
              })}
            </div>
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">남길 말 (선택)</span>
            <Textarea
              rows={3}
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="예: ATELIER MD로 합류했습니다."
              disabled={submitting}
            />
          </label>

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? '신청 중...' : '승인 요청'}
          </Button>
        </form>
      </div>
    </div>
  )
}
