import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { listDepartments, submitAccessRequest } from '@/lib/supabase/profiles'
import {
  inferCapabilityFromDepartment,
  uniqueCapabilities,
  WORK_CAPABILITIES,
  WORK_CAPABILITY_LABEL,
  type WorkCapability,
} from '@/lib/company/capabilities'
import { personNameError } from '@/lib/company/person-name'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'

export function AccessRequestPage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'active'],
    queryFn: () => listDepartments(true),
  })

  const departments = useMemo(
    () => departmentsQuery.data ?? [],
    [departmentsQuery.data],
  )

  const [displayName, setDisplayName] = useState(
    profile?.nameConfirmedAt ? (profile.displayName ?? '') : '',
  )
  const [departmentId, setDepartmentId] = useState(
    profile?.departmentId ?? '',
  )
  const [capabilities, setCapabilities] = useState<WorkCapability[]>(
    profile?.capabilities?.length
      ? profile.capabilities
      : uniqueCapabilities(
          [
            inferCapabilityFromDepartment(profile?.departmentName),
          ].filter((value): value is WorkCapability => Boolean(value)),
        ),
  )
  const [requestNote, setRequestNote] = useState(profile?.requestNote ?? '')
  const [sameAsRoster, setSameAsRoster] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const liveNameError = displayName.trim() ? personNameError(displayName) : null

  function toggleCapability(value: WorkCapability) {
    setCapabilities((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value],
    )
  }

  function changeDepartment(nextId: string) {
    setDepartmentId(nextId)
    const dept = departments.find((item) => item.id === nextId)
    const inferred = inferCapabilityFromDepartment(dept?.name)
    if (inferred && capabilities.length === 0) {
      setCapabilities([inferred])
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              E&J
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              접근 신청
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              사내 인사 정보의 본명을 직접 입력하고, 팀과 업무 역량을 알려
              주세요. 직책은 승인할 때 운영지원팀이 정합니다. 담당 브랜드는
              고르지 않습니다.
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
            if (!sameAsRoster) {
              setError('사내 인사 정보와 같은 본명인지 확인해 주세요.')
              return
            }
            setSubmitting(true)
            try {
              await submitAccessRequest({
                displayName,
                departmentId,
                capabilities,
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
            <span className="text-sm font-medium">본명</span>
            <Input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="사내 인사 정보의 본명"
              disabled={submitting}
              autoComplete="name"
            />
            <p className="text-xs text-muted-foreground">
              별명이나 영문 계정명 대신, 한글·영문 등 인사 정보의 본명을
              입력하세요. 2~50자이며 숫자와 이메일은 쓸 수 없습니다.
            </p>
            {liveNameError ? (
              <p className="text-xs text-danger">{liveNameError}</p>
            ) : null}
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={sameAsRoster}
              onChange={(e) => setSameAsRoster(e.target.checked)}
              disabled={submitting}
              required
            />
            <span>사내 인사 정보와 동일한 본명입니다.</span>
          </label>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">팀</span>
            <Select
              required
              value={departmentId}
              onChange={(e) => changeDepartment(e.target.value)}
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">업무 역량</legend>
            <p className="text-xs text-muted-foreground">
              실제로 수정할 영역을 고르세요. 조회는 승인 후 전 브랜드가
              가능합니다. 부서와 다르게 겸무할 수 있습니다.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {WORK_CAPABILITIES.map((capability) => (
                <label
                  key={capability}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    checked={capabilities.includes(capability)}
                    onChange={() => toggleCapability(capability)}
                    disabled={submitting}
                  />
                  {WORK_CAPABILITY_LABEL[capability]}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">남길 말 (선택)</span>
            <Textarea
              rows={3}
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="예: 기획과 물류를 겸합니다."
              disabled={submitting}
            />
          </label>

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
              !sameAsRoster ||
              !displayName.trim() ||
              liveNameError !== null
            }
          >
            {submitting ? '신청 중...' : '승인 요청'}
          </Button>
        </form>
      </div>
    </div>
  )
}
