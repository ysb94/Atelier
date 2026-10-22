import { useState } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { submitAccessRequest } from '@/lib/supabase/profiles'
import { personNameError } from '@/lib/company/person-name'
import { useRenderWatch } from '@/lib/diagnostics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AccessRequestPage({ onSubmitted }: { onSubmitted?: () => void }) {
  useRenderWatch('AccessRequestPage')
  const { profile, refreshProfile, signOut } = useAuth()
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const liveNameError = displayName.trim()
    ? personNameError(displayName)
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
              본명을 입력해 승인 요청해 주세요. 소속 부서는 승인 담당자가 정합니다.
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
            <span className="text-sm font-medium">본명</span>
            <Input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="사내 인사 정보의 본명"
              disabled={submitting}
              autoComplete="name"
            />
            {liveNameError ? (
              <p className="text-xs text-danger">{liveNameError}</p>
            ) : null}
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
