import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from '@/lib/supabase/auth'
import { AuthGate } from '@/features/auth/AuthGate'
import { submitAccessRequest } from '@/lib/supabase/profiles'
import '@/index.css'
function Probe(){const {profile}=useAuth();return <><p>기존 작업 화면 진입</p><output>{profile?.status} · {profile?.permissionMode}</output><button onClick={()=>void submitAccessRequest({displayName:'검증 개발자',departmentId:'20000000-0000-4000-8000-000000000001'}).catch(error=>{document.querySelector('#request-result')!.textContent=error.message})}>승인 계정 재신청 시도</button><output id="request-result"/></>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><AuthProvider><AuthGate><Probe/></AuthGate></AuthProvider></QueryClientProvider>)
