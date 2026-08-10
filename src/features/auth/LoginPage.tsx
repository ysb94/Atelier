import { useState } from 'react'
import { useAuth } from '@/lib/supabase/auth'
import { isSupabaseConfigured } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'

const canShowDevLogin =
  import.meta.env.DEV &&
  Boolean(import.meta.env.VITE_DEV_LOGIN_EMAIL) &&
  Boolean(import.meta.env.VITE_DEV_LOGIN_PASSWORD)

export function LoginPage() {
  const { signInWithGoogle, signInAsDev } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<'google' | 'dev' | null>(null)

  const configured = isSupabaseConfigured()

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Atelier
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">로그인</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            사내 상품 운영 시스템입니다. Google 계정으로 로그인한 뒤 팀과
            담당 브랜드를 신청하세요.
          </p>
        </div>

        {!configured ? (
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            Supabase 환경변수가 설정되지 않았습니다. `.env.local`의
            VITE_SUPABASE_URL과 VITE_SUPABASE_PUBLISHABLE_KEY를 확인하세요.
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              type="button"
              className="w-full"
              disabled={submitting !== null}
              onClick={async () => {
                setError(null)
                setSubmitting('google')
                try {
                  await signInWithGoogle()
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : '구글 로그인 중 오류가 발생했습니다.',
                  )
                  setSubmitting(null)
                }
              }}
            >
              {submitting === 'google'
                ? '구글로 이동 중...'
                : 'Google로 로그인'}
            </Button>

            {/* DEV LOGIN — 나중에 이 블록을 제거하세요 */}
            {canShowDevLogin ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={submitting !== null}
                onClick={async () => {
                  setError(null)
                  setSubmitting('dev')
                  try {
                    await signInAsDev()
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : '개발 로그인 중 오류가 발생했습니다.',
                    )
                  } finally {
                    setSubmitting(null)
                  }
                }}
              >
                {submitting === 'dev' ? '개발 로그인 중...' : '개발 로그인'}
              </Button>
            ) : null}

            {error ? (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}

            <p className="text-xs text-muted-foreground">
              처음 로그인하면 팀·직책·담당 브랜드를 신청합니다. 해당 브랜드
              팀장이나 운영진이 승인해야 작업장에 들어갈 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
