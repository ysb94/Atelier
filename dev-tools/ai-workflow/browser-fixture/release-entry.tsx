import {createRoot} from 'react-dom/client'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {BrowserRouter,Route,Routes} from 'react-router-dom'
import {CompanyLayout} from '@/components/layout/CompanyLayout'
import {AuthProvider,releaseFixture} from './release-auth'
import '@/index.css'
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}})
releaseFixture.refresh=()=>{
  for(const key of ['department-approvers','personal-work-cards','personal-work-feedback-notices'])void client.invalidateQueries({queryKey:[key]})
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><AuthProvider><BrowserRouter><Routes><Route path="/*" element={<CompanyLayout/>}/></Routes></BrowserRouter></AuthProvider></QueryClientProvider>)
