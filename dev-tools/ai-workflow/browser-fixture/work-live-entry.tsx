import ReactDOM from 'react-dom/client'
import {BrowserRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider} from './work-live-auth'
import {WorkRequestPage} from '@/features/work-requests/WorkRequestPage'
import {WorkRequestHubPage} from '@/features/work-requests/WorkRequestHubPage'
import {DraftEditPage} from '@/features/drafts/DraftEditPage'
import '@/index.css'
ReactDOM.createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><AuthProvider><BrowserRouter><main className="p-6"><Routes><Route path="/drafts/:draftId" element={<DraftEditPage/>}/><Route path="/work-requests/:owner" element={<WorkRequestPage/>}/><Route path="*" element={<WorkRequestHubPage/>}/></Routes></main></BrowserRouter></AuthProvider></QueryClientProvider>)
