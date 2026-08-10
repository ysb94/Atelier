import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrandLayout } from '@/components/layout/BrandLayout'
import { BrandSelectPage } from '@/features/brands/BrandSelectPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { AccessRequestPage } from '@/features/auth/AccessRequestPage'
import { PendingApprovalPage } from '@/features/auth/PendingApprovalPage'
import { AuthProvider, useAuth } from '@/lib/supabase/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

/**
 * 세션 → 프로필 상태 순으로 게이트를 연다.
 * 데이터 접근 차단은 DB RLS가 담당하고, 여기는 화면만 나눈다.
 */
function AuthGate() {
  const { ready, session, profile } = useAuth()
  const [forceEditRequest, setForceEditRequest] = useState(false)

  useEffect(() => {
    queryClient.clear()
    setForceEditRequest(false)
  }, [session?.user.id])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        확인 중...
      </div>
    )
  }

  if (!session) return <LoginPage />

  // 프로필 행이 아직 없으면(트리거 지연) 신청 화면으로 보낸다.
  if (!profile || forceEditRequest || profile.requestedAt == null) {
    return <AccessRequestPage />
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

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BrandSelectPage />} />
        <Route path="/b/:brandSlug/*" element={<BrandLayout />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </QueryClientProvider>
  )
}
