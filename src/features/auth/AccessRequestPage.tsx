import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { listDepartments, submitAccessRequest, type Department } from '@/lib/supabase/profiles'
import { personNameError } from '@/lib/company/person-name'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'

export function AccessRequestPage({ onSubmitted }: { onSubmitted?: () => void }) {
  useRenderWatch('AccessRequestPage')
  const { profile, refreshProfile, signOut } = useAuth()
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })

  const departments = departmentsQuery.data ?? emptyList<Department>()

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [departmentId, setDepartmentId] = useState(
    profile?.departmentId ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const liveNameError = displayName.trim()
    ? personNameError(displayName)?.replace('본명', '이름') ?? null
    : null

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              E&J
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">처음 시작하기</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              이름과 부서를 입력해 주세요. 관리자가 확인하고 승인하면
              E&J 업무 화면을 사용할 수 있습니다.
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
            if (!departments.some((department) => department.id === departmentId)) {
              setError('부서를 선택해 주세요.')
              return
            }
            setSubmitting(true)
            try {
              await submitAccessRequest({
                displayName,
                departmentId,
              })
              await refreshProfile()
              onSubmitted?.()
            } catch (err) {
              console.warn('[auth] 접근 신청 실패', {
                message: err instanceof Error ? err.message : String(err),
              })
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
              placeholder="이름을 입력해 주세요"
              disabled={submitting}
              autoComplete="name"
            />
            {liveNameError ? (
              <p className="text-xs text-danger">{liveNameError}</p>
            ) : null}
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">부서</span>
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
          {departmentsQuery.error ? (
            <p className="text-sm text-danger">부서 목록을 불러오지 못했습니다. 새로고침해 주세요.</p>
          ) : null}

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={
              submitting ||
              !displayName.trim() ||
              liveNameError !== null ||
              !departments.some((department) => department.id === departmentId)
            }
          >
            {submitting ? '신청 중...' : '승인 요청'}
          </Button>
        </form>
      </div>
    </div>
  )
}
