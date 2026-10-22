import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/supabase/auth'
import { AuthGate } from '@/features/auth/AuthGate'
import { hasPermission } from '@/lib/company/permissions'
import { submitAccessRequest } from '@/lib/supabase/profiles'
import { MembersPage } from '@/features/settings/MembersPage'
import '@/index.css'
function Probe(){const {profile}=useAuth();return <><p>기존 작업 화면 진입</p><output>{profile?.status} · {profile?.permissionMode}</output><output id="developer-permission">{hasPermission(profile,'preview.use')?'화면 테스트 허용':'화면 테스트 없음'}</output><button onClick={()=>void submitAccessRequest({displayName:'검증 개발자'}).catch(error=>{document.querySelector('#request-result')!.textContent=error.message})}>승인 계정 재신청 시도</button><output id="request-result"/></>}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><BrowserRouter><AuthProvider><AuthGate>{new URLSearchParams(location.search).has('members')?<MembersPage/>:<Probe/>}</AuthGate></AuthProvider></BrowserRouter></QueryClientProvider>)
