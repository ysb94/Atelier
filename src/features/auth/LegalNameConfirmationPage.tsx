import { useState } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { confirmMyProfileName } from '@/lib/supabase/profiles'
import { personNameError } from '@/lib/company/person-name'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function LegalNameConfirmationPage() {
  const { profile, refreshProfile, signOut } = useAuth()
  const [name, setName] = useState('')
  const [sameAsRoster, setSameAsRoster] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const liveError = name.trim() ? personNameError(name) : null
  const canSubmit = Boolean(name.trim()) && !liveError && sameAsRoster && !submitting

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              E&J
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">본명 확인</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              회사 화면으로 들어가기 전에 사내 인사 정보와 같은 본명을 한 번
              직접 입력해 주세요. 확인한 뒤에는 본인이 바꿀 수 없고, 개명이나
              오타는 운영지원팀 또는 관리자에게 요청합니다.
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
              await confirmMyProfileName(name)
              await refreshProfile()
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : '본명을 저장하지 못했습니다.',
              )
            } finally {
              setSubmitting(false)
            }
          }}
        >
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <p className="text-xs text-muted-foreground">현재 등록된 이름</p>
            <p className="mt-1 font-medium">
              {profile?.displayName?.trim() || '등록된 이름 없음'}
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">본명</span>
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="사내 인사 정보의 본명"
              disabled={submitting}
              autoComplete="name"
            />
            <p className="text-xs text-muted-foreground">
              별명이나 영문 계정명 대신, 한글·영문 등 인사 정보의 본명을
              입력하세요. 2~50자이며 숫자와 이메일은 쓸 수 없습니다.
            </p>
            {liveError ? (
              <p className="text-xs text-danger">{liveError}</p>
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

          {error ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting ? '저장 중...' : '본명 확인'}
          </Button>
        </form>
      </div>
    </div>
  )
}
