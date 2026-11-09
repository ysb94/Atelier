import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { listWorkRequests } from '@/lib/supabase/work-requests'
import { isWorkRequestOwner, WORK_REQUEST_CONFIG, WORK_REQUEST_DEPARTMENT_IDS, WORK_REQUEST_OWNERS } from './work-request-form-config'
import { STATUS_META, type WorkRequestRecord } from './work-request-types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useEffect } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { WorkRequestCancellation } from './WorkRequestCancellation'
import { WorkRequestForm } from './WorkRequestPage'
import { buildPersonalWorkRequestSearch, buildWorkRequestSearch, parseWorkRequestView, PERSONAL_WORK_OWNER_PARAM, WORK_REQUEST_VIEW_PARAMS } from './work-request-navigation'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'

export function WorkRequestHubPage() {
  useRenderWatch('WorkRequestHubPage')
  const {profile,session}=useAuth()
  const tabActive = useWorkspaceTabActivity()
  const [searchParams, setSearchParams] = useSearchParams()
  const view = parseWorkRequestView(searchParams).view
  const ownerParam = searchParams.get(PERSONAL_WORK_OWNER_PARAM) ?? ''
  const owner = view.kind !== 'list' && isWorkRequestOwner(ownerParam) ? ownerParam : null
  const formOpen = Boolean(owner && (view.kind === 'new' || view.kind === 'edit'))
  const canRequest = profile?.status === 'active' && session?.user.id === profile.id
  const destinations = WORK_REQUEST_OWNERS.filter(target => target === 'design' && WORK_REQUEST_DEPARTMENT_IDS[target] !== profile?.departmentId)
  const query=useQuery({queryKey:['work-requests',profile?.id,'hub'],queryFn:()=>listWorkRequests(profile!.id),enabled:canRequest,retry:false})
  useEffect(() => {
    if (!tabActive || owner || !WORK_REQUEST_VIEW_PARAMS.some(key => searchParams.has(key))) return
    setSearchParams(new URLSearchParams(buildWorkRequestSearch(searchParams, { kind: 'list' })), { replace: true })
  }, [owner, searchParams, setSearchParams, tabActive])
  const actorId=profile?.id,reload=query.refetch
  useEffect(()=>{
    if(!actorId||session?.user.id!==actorId)return
    let timer:ReturnType<typeof setTimeout>|undefined
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>void reload(),100)}
    const channel=getSupabase().channel(`work-hub:${actorId}`).on('postgres_changes',{event:'*',schema:'public',table:'work_requests'},refresh).on('postgres_changes',{event:'INSERT',schema:'public',table:'work_request_messages'},refresh).subscribe(status=>{if(status==='SUBSCRIBED')refresh();if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('[work-requests] 내 업무 실시간 연결 실패',{status})})
    window.addEventListener('online',refresh)
    return()=>{clearTimeout(timer);window.removeEventListener('online',refresh);void getSupabase().removeChannel(channel)}
  },[actorId,session?.user.id,reload])
  const requests = (canRequest ? query.data?.requests : undefined) ?? emptyList<WorkRequestRecord>()
  return (
    <div className="space-y-5">
      {!formOpen && <>
        <div>
          <h2 className="text-lg font-semibold">작업 요청</h2>
          <p className="text-sm text-muted-foreground">다른 부서에 요청을 보내고 배정받은 업무를 확인합니다. 내 부서의 자체 업무는 부서 업무 화면에서 등록합니다.</p>
        </div>
        {canRequest && (
          <div className="grid gap-3 sm:grid-cols-4">
            {destinations.map(target => (
              <Link key={target} className="rounded-xl border border-border bg-card p-4 text-sm font-medium text-primary shadow-sm"
                to={buildPersonalWorkRequestSearch(searchParams, target, { kind: 'new' })}>
                {WORK_REQUEST_CONFIG[target].label}에 요청하기
              </Link>
            ))}
          </div>
        )}
        {query.error ? <p role="alert" className="text-sm text-danger">{query.error.message}<button type="button" className="ml-2 underline" onClick={() => void query.refetch()}>다시 조회</button></p>
          : query.isPending ? <p role="status">업무를 불러오는 중...</p> : null}
        {(['sent', 'assigned'] as const).map(section => {
          const sent = section === 'sent'
          const rows = requests.filter(request => sent
            ? request.kind !== 'internal' && request.requesterId === actorId
            : request.assignee === actorId || request.collaborators.includes(actorId ?? ''))
          return (
            <Card key={section}>
              <CardContent className="p-4">
                <h3 className="mb-3 font-medium">{sent ? '보낸 요청' : '배정받은 업무'} · {rows.length}</h3>
                {rows.length ? rows.map(request => (
                  <div key={request.id} className="flex flex-wrap items-center gap-3 border-t border-border py-3 text-sm">
                    <Link className="flex min-w-0 flex-1 items-center justify-between gap-3"
                      to={buildPersonalWorkRequestSearch(searchParams, request.owner, { kind: 'detail', requestId: request.id })}>
                      <span className="break-words">{request.values.title}<small className="ml-2 text-muted-foreground">{WORK_REQUEST_CONFIG[request.owner].label}</small></span>
                      <Badge variant={request.status === 'completed' ? 'success' : 'muted'}>{STATUS_META[request.status].label}</Badge>
                    </Link>
                    {sent ? <WorkRequestCancellation request={request} />
                      : request.cancellation?.state === 'requested' && !['completed', 'cancelled', 'rejected'].includes(request.status) ? <Badge variant="warning">취소 요청 중</Badge> : null}
                  </div>
                )) : <p className="text-sm text-muted-foreground">등록된 업무가 없습니다.</p>}
              </CardContent>
            </Card>
          )
        })}
      </>}
      {owner && <WorkRequestForm key={`${actorId ?? 'guest'}:${owner}`} owner={owner} surface="personal" />}
    </div>
  )
}
