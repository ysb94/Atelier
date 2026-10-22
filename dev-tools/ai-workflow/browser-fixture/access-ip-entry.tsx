import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/supabase/auth'
import { AccessIpRecorder } from '@/features/auth/AccessIpRecorder'
import { AuthGate } from '@/features/auth/AuthGate'
import { AccessIpRecordsPage } from '@/features/settings/AccessIpRecordsPage'
import { useMyClockIn } from '@/features/home/use-my-clock-in'
import '@/index.css'
function Probe() {
  const { profile } = useAuth()
  const clock = useMyClockIn()
  const [result, setResult] = useState('')
  const [, rerender] = useState(0)
  return <><p>기존 로그인 상태: {profile?.status}</p><button onClick={() => rerender(n => n + 1)}>다시 렌더</button><button onClick={() => void clock.clockIn().then(() => setResult('기존 출근 저장 성공'))}>기존 출근 요청</button><output>{result}</output><AccessIpRecordsPage /></>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><BrowserRouter><AuthProvider><AccessIpRecorder /><AuthGate><Probe /></AuthGate></AuthProvider></BrowserRouter></QueryClientProvider>)
