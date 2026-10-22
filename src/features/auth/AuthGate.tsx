import { useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'
import { LoginPage } from './LoginPage'
import { AccessRequestPage } from './AccessRequestPage'
import { LegalNameConfirmationPage } from './LegalNameConfirmationPage'
import { PendingApprovalPage } from './PendingApprovalPage'

/** 조회 실패를 신규 가입으로 취급하지 않는다. 계정 상태 변경은 신청 가능 상태에서만 한다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, session, profile, profileError, refreshProfile, signOut } = useAuth()
  const queryClient = useQueryClient()
  useRenderWatch('AuthGate')
  const [forceEditRequest, setForceEditRequest] = useState(false)

  useEffect(() => {
    queryClient.clear()
    setForceEditRequest(false)
  }, [session?.user.id, queryClient])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        확인 중...
      </div>
    )
  }

  if (!session) return <LoginPage />

  if (profileError) return <div role="alert" className="m-6 space-y-4 rounded-xl border border-border p-6"><p>{profileError}</p><button type="button" className="rounded-lg border px-4 py-2" onClick={() => void refreshProfile()}>계정 다시 불러오기</button><button type="button" className="ml-3 rounded-lg border px-4 py-2" onClick={() => void signOut()}>로그아웃</button></div>

  if (!profile || ((profile.status === 'pending' || profile.status === 'rejected') && (forceEditRequest || profile.requestedAt == null))) {
    return <AccessRequestPage onSubmitted={() => setForceEditRequest(false)} />
  }

  if (profile.status === 'pending') {
    return (
      <PendingApprovalPage
        mode="pending"
        onEditRequest={() => setForceEditRequest(true)}
      />
    )
  }

  if (profile.status === 'rejected') {
    return (
      <PendingApprovalPage
        mode="rejected"
        onEditRequest={() => setForceEditRequest(true)}
      />
    )
  }

  if (profile.status === 'disabled') {
    return <PendingApprovalPage mode="disabled" />
  }

  if (profile.status !== 'active') {
    return <PendingApprovalPage mode="disabled" />
  }

  if (!profile.nameConfirmedAt) {
    return <LegalNameConfirmationPage />
  }

  return children
}
