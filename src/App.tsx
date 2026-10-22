import { AuthGate } from '@/features/auth/AuthGate'
import { AccessIpRecorder } from '@/features/auth/AccessIpRecorder'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrandLayout } from '@/components/layout/BrandLayout'
import { CompanyLayout } from '@/components/layout/CompanyLayout'
import { ChatWindowPage } from '@/features/chat/ChatWindowPage'
import { AuthProvider } from '@/lib/supabase/auth'
import {
  exposeDiagnosticsSwitch,
  installPerfWatch,
  installQueryWatch,
} from '@/lib/diagnostics'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      // 엑셀 등 다른 창을 오갈 때마다 열린 탭 전체가 재조회되면 원장 재매칭이 연쇄되어
      // 화면이 멈춘다. 데이터 갱신은 저장 뒤 invalidate 와 화면 진입 시 stale 재조회로 충분하다.
      refetchOnWindowFocus: false,
    },
  },
})

// 콘솔 진단: 개발 모드는 항상, 배포는 콘솔에서 atelierDebug.on() 후 새로고침.
exposeDiagnosticsSwitch()
installPerfWatch()
installQueryWatch(queryClient)

/**
 * 세션 → 프로필 상태 순으로 게이트를 연다.
 * 데이터 접근 차단은 DB RLS가 담당하고, 여기는 화면만 나눈다.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AccessIpRecorder />
        <AuthGate><BrowserRouter><Routes>
          <Route path="/chat/room/:roomId" element={<ChatWindowPage />} />
          <Route path="/b/:brandSlug/*" element={<BrandLayout />} />
          <Route path="/*" element={<CompanyLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></BrowserRouter></AuthGate>
      </AuthProvider>
    </QueryClientProvider>
  )
}
