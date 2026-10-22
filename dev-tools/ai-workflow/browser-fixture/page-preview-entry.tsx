import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { DeveloperPreviewProvider, DeveloperPreviewBar, DeveloperPreviewPage } from '@/components/layout/DeveloperPreview'
import { CompanyBrandScopeProvider } from '@/components/layout/company-brand-scope'
import { BrandScope } from '@/components/layout/brand-context'
import { CompanyHomePage } from '@/features/home/CompanyHomePage'
import { ProfileSettingsPage } from '@/features/settings/ProfileSettingsPage'
import { PermissionSettingsPage } from '@/features/settings/PermissionSettingsPage'
import { BrandSelectPage } from '@/features/brands/BrandSelectPage'
import { AiSettingsPage } from '@/features/settings/AiSettingsPage'
import { MamamIdeaInboxPage } from '@/features/mamam/MamamIdeaInboxPage'
import { UsageCodePage } from '@/features/codes/UsageCodePage'
import { CompanyMeetingsPage } from '@/features/meetings/CompanyMeetingsPage'
import { useAuth } from '@/lib/supabase/auth'
import { useUsagePartnerSettings } from '@/features/codes/useUsagePartnerSettings'
import { useHeaderPreview, useNavigationPreviewProfile } from '@/lib/company/developer-preview-context'
import { companyNavGroupsForProfile } from '@/components/layout/company-workspace-nav'
import { WorkspaceHeaderActions } from '@/components/layout/WorkspaceHeaderActions'
import { ChatWindowPage } from '@/features/chat/ChatWindowPage'
import { chatKeys } from '@/features/chat/use-chat'
import type { ChatRoom, ChatMessage } from '@/lib/inbox/types'
import { SheetTable } from '@/features/data/SheetTable'
import { WorkRequestPage } from '@/features/work-requests/WorkRequestPage'
import type { BrandField } from '@/lib/types'
import { OverlayAuditFixture } from './overlay-audit-fixture'
import '@/index.css'

const brand = { id: '20000000-0000-4000-8000-000000000001', slug: 'fixture', name: '검증 브랜드', color: '#333' } as any
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } })
queryClient.setQueryData<ChatRoom[]>(chatKeys.rooms, [{
  id: 'fixture-room', kind: 'group', name: '검증 대화방', title: '검증 대화방', lastMessage: '동료 메시지', lastAt: null, unread: 0,
  peerProfileId: null, peerName: null, peerPosition: null, members: [], lastKind: 'text', lastIsImage: false, memberCount: 2,
}])
queryClient.setQueryData(chatKeys.messages('fixture-room', 'fixture-user'), {
  pages: [[true, false].map((mine, index): ChatMessage => ({
    id: `fixture-message-${index}`, roomId: 'fixture-room', authorId: mine ? 'fixture-user' : 'other-user', authorName: mine ? '나' : '동료',
    kind: 'text', body: mine ? '본인 메시지' : '동료 메시지', createdAt: `2026-10-20T01:0${index}:00Z`, deletedAt: null,
    replyToMessageId: null, replyTo: null, reactions: [], mine,
  }))], pageParams: [null],
})
queryClient.setQueryData(chatKeys.usage, { usedBytes: 1024, fileCount: 1 })
function HiddenProfile() { const { profile } = useAuth(); return <output data-testid="hidden-profile">{profile?.email}</output> }
function NavigationProbe() {
  const { profile } = useAuth()
  const displayed = useNavigationPreviewProfile(profile)
  const facts = useHeaderPreview()
  return <><output data-testid="navigation">{companyNavGroupsForProfile(displayed).map(group => group.title).join(',')}</output><output data-testid="chat-role">{facts?.chatRole}</output></>
}
function MutationProbe() {
  const state = useUsagePartnerSettings(brand.id, '20000000-0000-4000-8000-000000000002')
  return <button onClick={() => void state.editorsMutation.mutateAsync({ target: '20000000-0000-4000-8000-000000000002', profileIds: [] }).catch(error => { document.querySelector('#guard-result')!.textContent = error.message })}>검증용 저장 시도</button>
}
function DataHeaderLayeringFixture() {
  const columns = Array.from({ length: 14 }, (_, index) => ({
    id: `column-${index}`, label: index === 0 ? 'M번호' : index === 1 ? '상품명' : `상품 항목 ${index}`,
    systemKey: index === 0 ? 'styleNo' : index === 1 ? 'name' : null,
    key: `field-${index}`, owner: 'planning', type: 'text',
  })) as BrandField[]
  return <div data-testid="sheet-layering" className="[&>div]:max-h-[360px]">
    <SheetTable columns={columns} rows={Array.from({ length: 50 }, (_, index) => ({ id: `sku-${index}`, styleNo: `M-${index}`, values: {} }))} showOwnerGroups />
  </div>
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><BrowserRouter>{location.pathname.startsWith('/chat/room/')
  ? <Routes><Route path="/chat/room/:roomId" element={<ChatWindowPage />} /></Routes>
  : <DeveloperPreviewProvider>
  <DeveloperPreviewBar />
  <NavigationProbe />
  <div className="relative z-20 flex shrink-0 items-end border-b border-border bg-muted/40"><WorkspaceHeaderActions /></div>
  <DeveloperPreviewPage><CompanyBrandScopeProvider><BrandScope brand={brand}><Routes>
    <Route path="/" element={<CompanyHomePage />} />
    <Route path="/settings/profile" element={<ProfileSettingsPage />} />
    <Route path="/brands" element={<BrandSelectPage />} />
    <Route path="/settings/ai" element={<AiSettingsPage />} />
    <Route path="/idea-contest" element={<MamamIdeaInboxPage />} />
    <Route path="/meetings" element={<CompanyMeetingsPage />} />
    <Route path="/data/all" element={<DataHeaderLayeringFixture />} />
    <Route path="/settings/permissions" element={<PermissionSettingsPage />} />
    <Route path="/work-requests/:owner" element={<WorkRequestPage />} />
    <Route path="/__overlay-audit" element={<OverlayAuditFixture />} />
    <Route path="/usage-codes" element={<><UsageCodePage /><MutationProbe /><output id="guard-result" /></>} />
  </Routes></BrandScope></CompanyBrandScopeProvider></DeveloperPreviewPage>
  <Routes location="/hidden"><Route path="/hidden" element={<DeveloperPreviewPage><HiddenProfile /></DeveloperPreviewPage>} /></Routes>
</DeveloperPreviewProvider>}</BrowserRouter></QueryClientProvider>)
