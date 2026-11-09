import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Plus, PackagePlus, Search, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { BrandAvatar } from '@/components/brand/BrandAvatar'
import { useCompanyBrandScope } from '@/components/layout/company-brand-scope'
import { UNASSIGNED_DRAFT_BRAND, type DraftBrandScope } from '@/lib/drafts/company-draft'
import { PageHeader } from '@/components/layout/PageHeader'
import { useReleaseAccess } from '@/components/layout/release-access-context'
import { WorkspaceTabOverlay } from '@/components/layout/workspace-tab-overlay'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { StatusPill } from '@/components/ui/status-pill'
import { useAuth } from '@/lib/supabase/auth'
import { useRenderWatch } from '@/lib/diagnostics'
import { DraftBrandScopeBar } from '@/features/drafts/DraftBrandScopeBar'
import { releaseHref } from '@/lib/company/release-access'
import { MATERIAL_REQUESTS_PATH, materialNudgeTarget } from '@/lib/workspace/material-request-navigation'

import { MaterialRequestDialog, type MaterialRequest } from './MaterialRequestDialog'
import { MaterialNudgeSettings } from './MaterialNudgeSettings'
import { MaterialNudgeConfirm } from './MaterialNudgeDialog'
import { MaterialNudgeDetailDialog, MaterialNudgeRequestList } from './MaterialNudgeWorkspace'
import { elapsedMaterialRequestDays as elapsedDays } from './material-request-days'
import { materialRequestError, useMaterialRequests } from './useMaterialRequests'
import { readMaterialDetail } from '@/lib/supabase/material-requests'
import { listMaterialNudgeRecipients } from '@/lib/supabase/material-nudge-recipients'
import { emptyList } from '@/lib/utils'

const blank = (ownerId: string): MaterialRequest => ({
  id: crypto.randomUUID(), ownerId, status: '요청예정', draftStage: 'writing', rounds: [], brandId: '', title: '',
  blocks: [{ id: crypto.randomUUID(), type: 'text', text: '' }],
})

function requestText(request: MaterialRequest) {
  return request.blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join(' ')
}

function titlePriority(request: MaterialRequest) {
  if (request.status === '요청중' && !request.rounds.at(-1)?.shippedAt) return 0
  if (request.status === '요청예정') return request.draftStage === 'ready' ? 1 : 2
  return 3
}

const requestDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', year: '2-digit', month: '2-digit', day: '2-digit',
})
const shippingDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
})
const satisfactionScores = Array.from({ length: 10 }, (_, index) => index + 1)

const requestTabs = [
  { value: 'mine', label: 'ALL', mine: true, status: null },
  { value: 'mine-requested', label: '요청중', mine: true, status: '요청중' },
  { value: 'mine-planned', label: '요청예정', mine: true, status: '요청예정' },
  { value: 'mine-completed', label: '완료', mine: true, status: '완료' },
  { value: 'all-requested', label: 'ALL 요청중', mine: false, status: '요청중' },
  { value: 'all-planned', label: 'ALL 요청예정', mine: false, status: '요청예정' },
] as const

export function MaterialRequestsPage() {
  const {session,profile}=useAuth()
  const { profile: navigationProfile, materialNudgeViewer } = useReleaseAccess()
  const accountId = session?.user.id ?? ''
  const companyId = profile?.companyId ?? ''
  const planning = releaseHref(navigationProfile, MATERIAL_REQUESTS_PATH) !== null
  return <MaterialRequestsSurface key={`${companyId}:${accountId}`} accountId={accountId}
    designerName={profile?.displayName?.trim() || '이름 미등록'} planning={planning} viewer={materialNudgeViewer} />
}

function MaterialRequestsSurface({ accountId, designerName, planning, viewer }: {
  accountId: string
  designerName: string
  planning: boolean
  viewer: boolean
}) {
  const [params, setParams] = useSearchParams()
  const target = viewer ? materialNudgeTarget(params) : null
  const showReceived = viewer && (!planning || params.get('view') === 'received' || target?.scope === 'request')
  function setReceived(received: boolean) {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (received) next.set('view', 'received')
      else next.delete('view')
      return next
    }, { replace: true })
  }
  return <>
    {showReceived ? <MaterialNudgeRequestList accountId={accountId} paused={Boolean(target)}
      onBack={planning ? () => setReceived(false) : undefined} />
      : planning ? <MaterialRequestsBoard accountId={accountId} designerName={designerName}
        onShowReceived={viewer ? () => setReceived(true) : undefined} />
        : <p role="status" className="text-sm text-muted-foreground">자재요청을 볼 수 있는 권한이 없습니다.</p>}
    {target && <WorkspaceTabOverlay>
      <MaterialNudgeDetailDialog key={`${target.scope}:${target.id}`} accountId={accountId} target={target}
        onClose={() => setParams(previous => {
          const next = new URLSearchParams(previous)
          next.delete('nudge')
          next.delete('request')
          if (planning && target.scope === 'request') next.set('view', 'received')
          return next
        }, { replace: true })} />
    </WorkspaceTabOverlay>}
  </>
}

function MaterialRequestsBoard({accountId, designerName, onShowReceived}: {accountId:string; designerName:string; onShowReceived?: () => void}) {
  useRenderWatch('MaterialRequestsPage')
  const { brands } = useCompanyBrandScope()
  const [brandScope, setBrandScope] = useState<DraftBrandScope>('all')
  const { requests: rows, query, mutation } = useMaterialRequests('planning')
  const [form,setForm]=useState<MaterialRequest|null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState('')
  const writing = useRef(false)
  const [now, setNow] = useState(Date.now)
  const [search,setSearch]=useState(''),[notice,setNotice]=useState('')
  const [view,setView]=useState<(typeof requestTabs)[number]['value']>('mine')
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [nudgePreview, setNudgePreview] = useState<{ id: string; title: string; revision: number; recipients: readonly string[] } | null>(null)
  const nudgeQuery = useQuery({ queryKey: ['material-nudge-recipients'], queryFn: listMaterialNudgeRecipients })
  const nudgeRecipients = nudgeQuery.data ?? emptyList<string>()
  const trackingElapsedDays = rows.some(row => row.status === '요청중' && !row.rounds.at(-1)?.shippedAt)
  useEffect(() => {
    if (!trackingElapsedDays) return
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [trackingElapsedDays])
  const matchesTab = (row:MaterialRequest, tab:(typeof requestTabs)[number]) =>
    (!tab.mine || row.ownerId === accountId) && (!tab.status || row.status === tab.status)
  const selectedTab = requestTabs.find(tab => tab.value === view) ?? requestTabs[0]
  const selectedBrand = brands.find(brand => brand.slug === brandScope)
  const scopedRows = rows.filter(row => {
    if (brandScope === UNASSIGNED_DRAFT_BRAND) return !row.brandId
    return !selectedBrand || row.brandId === selectedBrand.id
  })
  const visibleRows = scopedRows.filter(row => matchesTab(row, selectedTab))
  const brandById = new Map(brands.map(brand => [brand.id, brand]))
  const searchTerm = search.trim().toLowerCase()
  const filtered = visibleRows.filter(row =>
    [row.title, row.searchText ?? requestText(row), brandById.get(row.brandId)?.name ?? '브랜드 미정']
      .some(value => value.toLowerCase().includes(searchTerm)),
  )
  if (view === 'mine') filtered.sort((left, right) => titlePriority(left) - titlePriority(right))
  const countRows = (items: MaterialRequest[]) => ({
    total: items.length,
    pending: items.filter(row => row.status === '요청예정').length,
    scheduled: items.filter(row => row.status === '요청중').length,
  })
  const startRequest = () => {
    setSaveError('')
    setForm({ ...blank(accountId), ownerName: designerName, brandId: selectedBrand?.id ?? '' })
  }

  function closeForm() {
    setForm(null)
  }

  async function openForm(row: MaterialRequest) {
    if (loadingDetail) return
    setError('')
    setSaveError('')
    setLoadingDetail(true)
    try {
      const detail = await readMaterialDetail('planning', row.id)
      setForm(detail.draftStage === 'not-started'
        ? { ...detail, blocks: [{ id: crypto.randomUUID(), type: 'text', text: '' }] }
        : detail)
    } catch (cause) {
      setError(materialRequestError(cause, '요청 내용을 불러오지 못했습니다. 다시 열어 주세요.'))
    } finally { setLoadingDetail(false) }
  }

  async function save(value: MaterialRequest, stage: 'writing' | 'ready' = 'writing') {
    if (writing.current) return
    writing.current = true
    setSaveError('')
    setNotice('')
    try {
      await mutation.mutateAsync({ action: 'save', request: value, stage })
      setNotice(stage === 'writing' ? '작성 중으로 임시 저장했습니다.' : '요청 예정으로 저장했습니다.')
      closeForm()
    } catch (cause) {
      setSaveError(materialRequestError(cause, '저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.'))
    } finally { writing.current = false }
  }

  async function updateRequest(request: MaterialRequest, action: 'send' | 'receive' | 'rate' | 'delete', score?: number) {
    if (writing.current) return
    writing.current = true
    setError('')
    try {
      await mutation.mutateAsync({ action, request, round: request.rounds.at(-1)?.number, score })
      setNow(Date.now())
    } catch (cause) {
      setError(materialRequestError(cause, '요청을 처리하지 못했습니다. 목록에서 상태를 확인해 주세요.'))
    } finally { writing.current = false }
  }
  return (
    <div className="space-y-3">
      <PageHeader title="자재요청" description="원단과 부자재 요청을 브랜드별로 확인합니다." />
      <DraftBrandScopeBar brandScope={brandScope} onSelect={setBrandScope}
        allScopeCounts={countRows(rows)}
        brandCards={brands.map(brand => ({ brand, ...countRows(rows.filter(row => row.brandId === brand.id)) }))}
        unassignedScopeCounts={countRows(rows.filter(row => !row.brandId))}
        countLabels={['예정', '요청중']} showUnassigned
        trailing={<div className="flex flex-wrap gap-2">
          {onShowReceived && <Button type="button" size="sm" variant="outline" onClick={onShowReceived}>받은 조르기</Button>}
          <Button type="button" size="sm" variant="outline" disabled={!nudgeQuery.isSuccess} onClick={() => setNudgeOpen(true)}>조르기 설정</Button>
        </div>} />

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border">
        <div className="flex min-w-0 items-center overflow-x-auto">
          <span className="shrink-0 border-r border-border px-4 text-sm font-medium">디자이너 {designerName}</span>
          <FilterTabs
            tabs={requestTabs.map(tab => ({ value: tab.value, label: tab.label, count: scopedRows.filter(row => matchesTab(row, tab)).length }))}
            value={view} onChange={setView} ariaLabel="자재 요청 범위 및 상태" variant="underline"
            className="shrink-0 border-b-0 pl-2 [&>button:nth-child(2)]:text-primary [&>button:nth-child(3)]:text-blue-800 [&>button:nth-child(5)]:border-l [&>button:nth-child(5)]:border-l-border [&>button:nth-child(5)]:text-primary [&>button:nth-child(6)]:text-blue-800"
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <label className="relative">
            <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="자재 요청 검색" placeholder="요청 검색" className="h-8 w-32 pl-7" value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          <Button size="sm" variant="outline" disabled={query.isFetching || mutation.isPending} onClick={() => void query.refetch()}>새로 조회</Button>
          <Button size="sm" disabled={!query.isSuccess || loadingDetail || mutation.isPending} onClick={startRequest}><Plus size={16} />자재 요청</Button>
        </div>
      </div>

      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {loadingDetail && <p role="status" className="text-sm text-muted-foreground">요청 내용을 불러오는 중…</p>}
      {(error || query.isError) && <div role="alert" className="flex items-center gap-2 text-sm text-danger">
        {error || materialRequestError(query.error, '자재요청 목록을 불러오지 못했습니다.')}
      </div>}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-sm" aria-label="자재 요청 목록">
            <colgroup><col className="w-[11%]" /><col className="w-[7%]" /><col className="w-[19%]" /><col className="w-[48%]" /><col className="w-[15%]" /></colgroup>
            <thead className="bg-primary text-primary-foreground">
              <tr>
                {['요청자 / Brand', '담당자', '요청사항', 'HISTORY', '조르기!'].map(label => (
                  <th key={label} scope="col" className="px-3 py-3 text-center font-medium last:bg-blue-800">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(row => {
                const brand = brandById.get(row.brandId)
                const editable = row.ownerId === accountId
                const priority = titlePriority(row)
                return (
                  <tr key={row.id} className="divide-x divide-border">
                    <td className="px-3 py-4 text-center">
                      <BrandAvatar brand={brand ?? { name: '미정', color: 'gray', logoUrl: null }} className="mx-auto size-8 rounded-full text-[10px]" />
                      <p className="mt-2 text-xs">요청자 · {editable ? designerName : row.ownerName || '—'}</p>
                    </td>
                    <td className="px-3 py-4 text-center text-xs text-muted-foreground">{row.rounds.at(-1)?.assigneeName ?? '미배정'}</td>
                    <th scope="row" className="px-3 py-4 text-left font-medium">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`break-words ${priority === 0 ? 'text-primary' : priority === 1 ? 'text-blue-800' : 'text-foreground'}`}>{row.title}</p>
                        </div>
                        {editable && <Button type="button" size="icon" variant="outline" className="size-7 shrink-0" aria-label={`${row.title} 열기`} disabled={loadingDetail || mutation.isPending} onClick={() => void openForm(row)}><SquareArrowOutUpRight size={14} /></Button>}
                      </div>
                    </th>
                    <td className="space-y-2 px-3 py-4">
                        {row.rounds.map((round, index) => {
                          const current = editable && index === row.rounds.length - 1
                          const days = elapsedDays(round.requestedAt, round.shippedAt ?? now)
                          return (
                            <div key={index} className="flex flex-wrap items-center gap-y-2 border-b border-border pb-2 text-xs">
                              <div className="flex items-center gap-2 whitespace-nowrap border-r border-border pr-3">
                                <span>{requestDate.format(round.requestedAt).replace(/\s/g, '').replace(/\.$/, '')} {index + 1}차 요청 전송</span>
                                <span className={`font-semibold tabular-nums ${round.shippedAt ? 'text-foreground' : 'text-primary'}`}>
                                  {round.shippedAt ? '' : '+'}{days}days
                                </span>
                              </div>
                              <div className="flex items-center gap-2 border-r border-border px-3">
                                {round.shippedAt ? <span className="whitespace-nowrap">{shippingDate.format(round.shippedAt)} 발송</span>
                                  : <span className="text-muted-foreground">중국 발송 대기</span>}
                              </div>
                              <div className="flex items-center gap-2 pl-3">
                                {round.satisfaction !== undefined ? <StatusPill tone={round.satisfaction === 10 ? 'success' : 'muted'}>만족도 {round.satisfaction}/10</StatusPill>
                                  : current && round.received ? (
                                    <Select aria-label={`${index + 1}차 만족도`} className="h-8 w-auto" value="" disabled={mutation.isPending} onChange={event => void updateRequest(row, 'rate', Number(event.target.value))}>
                                      <option value="" disabled>만족도</option>
                                      {satisfactionScores.map(score => <option key={score} value={score}>{score}점</option>)}
                                    </Select>
                                  ) : current && round.shippedAt && <Button type="button" size="sm" variant="outline" disabled={mutation.isPending} onClick={() => void updateRequest(row, 'receive')}>수령 확인</Button>}
                                {row.status === '완료' && index === row.rounds.length - 1 && <StatusPill tone="muted">완료</StatusPill>}
                              </div>
                              {current && row.status === '요청예정' && row.draftStage !== 'ready' && (
                                <Button type="button" size="sm" className="ml-auto" disabled={loadingDetail || mutation.isPending} onClick={() => void openForm(row)}>{index + 2}차 요청 작성</Button>
                              )}
                            </div>
                          )
                        })}
                        {editable && row.status === '요청예정' && row.draftStage === 'ready' && (
                          <Button type="button" size="sm" disabled={mutation.isPending} onClick={() => void updateRequest(row, 'send')}>
                            {row.rounds.length + 1}차 요청 전송
                          </Button>
                        )}
                    </td>
                    <td className="px-3 py-4">
                      <div className="flex items-center justify-center gap-2">
                        <Button type="button" size="sm" aria-haspopup="dialog"
                          disabled={!editable || row.status === '완료' || row.revision === undefined || !nudgeQuery.isSuccess || !nudgeRecipients.length || mutation.isPending}
                          title={nudgeQuery.isSuccess && !nudgeRecipients.length ? '조르기 설정에서 알림 받을 사람을 지정해 주세요.' : undefined}
                          onClick={() => {
                            if (row.revision === undefined) return
                            setNotice('')
                            setNudgePreview({ id: row.id, title: row.title, revision: row.revision, recipients: nudgeRecipients })
                          }}>
                          조르기
                        </Button>
                        {editable && row.rounds.length === 0 && <Button type="button" size="icon" variant="ghost" className="size-8" aria-label={`${row.title} 삭제`} disabled={mutation.isPending} onClick={() => void updateRequest(row, 'delete')}><Trash2 size={14} /></Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!filtered.length && <tr><td colSpan={5} className="px-6 py-12 text-center">
                <PackagePlus size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="font-medium">{query.isPending ? '자재요청을 불러오는 중…' : query.isError ? '조회 결과를 표시할 수 없습니다.' : visibleRows.length ? '검색 결과가 없습니다.' : '이 탭에 표시할 자재요청이 없습니다.'}</p>
              </td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {form && <WorkspaceTabOverlay><MaterialRequestDialog initial={form} brands={brands}
        roundNumber={form.status === '요청예정' && form.rounds.length ? form.rounds.length + 1 : undefined}
        saving={mutation.isPending} saveError={saveError} onClose={closeForm} onSave={(value, stage) => void save(value, stage)} /></WorkspaceTabOverlay>}
      {nudgeOpen && nudgeQuery.isSuccess && <WorkspaceTabOverlay>
        <MaterialNudgeSettings recipientIds={nudgeRecipients} onClose={() => setNudgeOpen(false)} />
      </WorkspaceTabOverlay>}
      {nudgePreview && <WorkspaceTabOverlay>
        <MaterialNudgeConfirm request={nudgePreview} recipients={nudgePreview.recipients}
          onClose={() => setNudgePreview(null)} onSent={count => {
            setNudgePreview(null)
            setNotice(`${count}명에게 조르기 알림을 보냈습니다.`)
          }} />
      </WorkspaceTabOverlay>}
    </div>
  )
}
