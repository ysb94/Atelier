import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { listWorkRequests } from '@/lib/supabase/work-requests'
import { WORK_REQUEST_CONFIG, WORK_REQUEST_OWNERS } from './work-request-form-config'
import { STATUS_META, type WorkRequestRecord } from './work-request-types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useRenderWatch } from '@/lib/diagnostics'
import { emptyList } from '@/lib/utils'
import { useEffect } from 'react'
import { getSupabase } from '@/lib/supabase/client'

export function WorkRequestHubPage() {
  useRenderWatch('WorkRequestHubPage')
  const {profile,session}=useAuth()
  const query=useQuery({queryKey:['work-requests',profile?.id,'hub'],queryFn:()=>listWorkRequests(profile!.id),enabled:profile?.status==='active'&&session?.user.id===profile.id,retry:false})
  const actorId=profile?.id,reload=query.refetch
  useEffect(()=>{
    if(!actorId||session?.user.id!==actorId)return
    let timer:ReturnType<typeof setTimeout>|undefined
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>void reload(),100)}
    const channel=getSupabase().channel(`work-hub:${actorId}`).on('postgres_changes',{event:'*',schema:'public',table:'work_requests'},refresh).on('postgres_changes',{event:'INSERT',schema:'public',table:'work_request_messages'},refresh).subscribe(status=>{if(status==='SUBSCRIBED')refresh();if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('[work-requests] 내 업무 실시간 연결 실패',{status})})
    window.addEventListener('online',refresh)
    return()=>{clearTimeout(timer);window.removeEventListener('online',refresh);void getSupabase().removeChannel(channel)}
  },[actorId,session?.user.id,reload])
  const requests=session?.user.id===profile?.id ? query.data?.requests??emptyList<WorkRequestRecord>() : emptyList<WorkRequestRecord>()
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold">작업 요청</h2><p className="text-sm text-muted-foreground">보낸 요청과 배정받은 업무를 확인하고 다른 부서에 요청합니다.</p></div>
    <div className="grid gap-3 sm:grid-cols-4">{WORK_REQUEST_OWNERS.map(owner=><Link key={owner} className="rounded-xl border border-border bg-card p-4 text-sm font-medium text-primary shadow-sm" to={`/work-requests/${owner}?mode=new`}>{WORK_REQUEST_CONFIG[owner].label}에 요청하기</Link>)}</div>
    {query.error?<p role="alert" className="text-sm text-danger">{query.error.message}<button className="ml-2 underline" onClick={()=>void query.refetch()}>다시 조회</button></p>:query.isPending?<p role="status">업무를 불러오는 중...</p>:null}
    {(['sent','assigned'] as const).map(section=>{
      const rows=requests.filter(request=>section==='sent'?request.requesterId===profile?.id:request.assignee===profile?.id||request.collaborators.includes(profile?.id??''))
      return <Card key={section}><CardContent className="p-4"><h3 className="mb-3 font-medium">{section==='sent'?'보낸 요청':'배정받은 업무'} · {rows.length}</h3>{rows.length?rows.map(request=><Link key={request.id} className="flex items-center justify-between gap-3 border-t border-border py-3 text-sm" to={`/work-requests/${request.owner}?requestId=${request.id}`}><span>{request.values.title}<small className="ml-2 text-muted-foreground">{WORK_REQUEST_CONFIG[request.owner].label}</small></span><Badge variant={request.status==='completed'?'success':'muted'}>{STATUS_META[request.status].label}</Badge></Link>):<p className="text-sm text-muted-foreground">등록된 업무가 없습니다.</p>}</CardContent></Card>
    })}
  </div>
}
