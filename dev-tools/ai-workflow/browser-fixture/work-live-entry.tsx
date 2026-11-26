import ReactDOM from 'react-dom/client'
import {BrowserRouter,Routes,Route} from 'react-router-dom'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider} from './work-live-auth'
import {useWorkspaceTabs,WorkspaceTabBar,WorkspaceTabPanels} from '@/components/layout/workspace-tabs'
import {WorkRequestPage} from '@/features/work-requests/WorkRequestPage'
import {WorkRequestHubPage} from '@/features/work-requests/WorkRequestHubPage'
import {DraftEditPage} from '@/features/drafts/DraftEditPage'
import {CompanyDraftsPage} from '@/features/drafts/DraftsPage'
import '@/index.css'

function DraftWorkspaceFixture() {
  const { tabs, activeId, openTab, closeTab } = useWorkspaceTabs()
  return <>
    <WorkspaceTabBar tabs={tabs} activeId={activeId} onOpen={openTab} onClose={closeTab} />
    <WorkspaceTabPanels tabs={tabs} activeId={activeId} onClose={closeTab} />
  </>
}

const draftWorkspace = new URLSearchParams(window.location.search).has('draft-workspace')
ReactDOM.createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}})}><AuthProvider><BrowserRouter><main className="p-6">{draftWorkspace ? <DraftWorkspaceFixture /> : <Routes><Route path="/drafts" element={<CompanyDraftsPage/>}/><Route path="/drafts/:draftId" element={<DraftEditPage/>}/><Route path="/work-requests/:owner" element={<WorkRequestPage/>}/><Route path="*" element={<WorkRequestHubPage/>}/></Routes>}</main></BrowserRouter></AuthProvider></QueryClientProvider>)
