import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import { cleanupMeetingFiles, confirmCompanyMeeting, deleteCompanyMeeting, listCompanyMeetings, listMeetingCalendar, listMeetingRooms, saveCompanyMeeting } from '@/lib/supabase/meetings'
import { type MeetingSeries, seriesToDrafts } from './meeting-schedule'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { diagnosticOperation, startWorkflow, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { useDiagnosticGate } from '@/lib/diagnostics/use-diagnostic-gate'

/** 실제 저장과 화면 테스트를 분리한다. 실패·충돌 시 입력 화면을 유지한다. */
export function useCompanyMeetings(from:string,to:string) {
  const {profile}=useAuth(),preview=usePagePreview(),active=useWorkspaceTabActivity()
  const real=preview?.realProfile ?? profile,simulating=Boolean(preview?.active)
  const cache=useQueryClient()
  const key=useMemo(()=>['company-meetings',real?.id,real?.companyId],[real?.id,real?.companyId])
  const enabled=Boolean(real?.status==='active' && active)
  useDiagnosticGate('meeting','screen_access',enabled,enabled?'enabled':!active?'inactive_tab':'inactive_employee')
  const query=useQuery({queryKey:key,queryFn:listCompanyMeetings,...sharedReadPolicy,enabled,refetchInterval:readPollInterval(15_000,active&&!simulating)})
  const roomsQuery=useQuery({queryKey:['meeting-rooms',real?.companyId],queryFn:listMeetingRooms,enabled})
  const calendarKey=useMemo(()=>['meeting-calendar',real?.id,real?.companyId,from,to],[real?.id,real?.companyId,from,to])
  const calendar=useQuery({queryKey:calendarKey,queryFn:()=>listMeetingCalendar(from,to),...sharedReadPolicy,enabled,refetchInterval:readPollInterval(15_000,active&&!simulating)})
  const [simulation,setSimulation]=useState<MeetingSeries[]|null>(null)
  const [error,setError]=useState<string|null>(null),[saving,setSaving]=useState(false)
  const tail=useRef<Promise<unknown>>(Promise.resolve())
  const mode=useRef(simulating);mode.current=simulating
  const simulationRef=useRef(simulation);simulationRef.current=simulation
  const account=useRef(real?.id);account.current=real?.id
  useEffect(()=>{
    if(enabled && !simulating) void cleanupMeetingFiles().catch(error=>console.warn('[meetings] 남은 회의 파일 정리 재시도 실패',{error}))
  },[enabled,simulating,real?.id])
  useEffect(()=>{if(!simulating){setSimulation(null);simulationRef.current=null}},[simulating])
  useEffect(()=>{setSimulation(null);simulationRef.current=null;setError(null)},[real?.id])
  const series=simulating?(simulation ?? query.data ?? emptyList<MeetingSeries>()):(query.data ?? emptyList<MeetingSeries>())
  const seriesRef=useRef(series);seriesRef.current=series
  async function refresh() {
    await Promise.all([cache.invalidateQueries({queryKey:key}),cache.invalidateQueries({queryKey:['meeting-calendar']}),cache.invalidateQueries({queryKey:['meeting-rooms']}),cache.invalidateQueries({queryKey:['meeting-invitations']})])
  }
  function setSeries(update:(previous:MeetingSeries[])=>MeetingSeries[],expected?:{id:string;revision:number;confirmRound?:string}):Promise<boolean> {
    const simulationMode=simulating,owner=real?.id
    const trace=startWorkflow('meeting',expected?.confirmRound?'confirm':'save')
    trace.step('queued')
    const task=async()=>{
      if(account.current!==owner || mode.current!==simulationMode) {trace.block('identity_changed');return false}
      setSaving(true);setError(null)
      try{
        trace.step('validate_revision')
        const before=simulationMode?(simulationRef.current ?? seriesRef.current):(cache.getQueryData<MeetingSeries[]>(key) ?? [])
        if(!simulationMode && expected && before.find(item=>item.id===expected.id)?.revision!==expected.revision) {
          throw new Error('다른 사람이 회의를 수정했습니다. 입력 내용을 보관한 뒤 닫고 다시 열어 주세요.')
        }
        const after=update(before)
        if(simulationMode){simulationRef.current=after;setSimulation(after);trace.done({state:'preview'});return true}
        for(const previous of before) if(!after.some(item=>item.id===previous.id)) await trace.run('delete_series',context=>deleteCompanyMeeting(previous,context))
        for(const next of after) {
          const previous=before.find(item=>item.id===next.id)
          if(expected?.id===next.id && expected.confirmRound) await trace.run('confirm_round',context=>confirmCompanyMeeting(next,previous?.revision ?? 0,expected.confirmRound!,context))
          else if(!previous || JSON.stringify(previous)!==JSON.stringify(next)) await trace.run('save_series',context=>saveCompanyMeeting(next,previous?.revision ?? 0,context))
        }
        await trace.run('refresh_queries',refresh,{writeOutcome:'committed'})
        trace.done({writeOutcome:'committed'})
        return true
      }catch(cause){
        trace.fail(cause)
        setError(cause instanceof Error?cause.message:'회의를 저장하지 못했습니다.')
        // 충돌 후 낡은 회차를 다시 덮어쓰지 않게 원본만 재조회한다. 입력 폼은 유지한다.
        await diagnosticOperation('meeting','refresh_after_failure',child=>child.run('refresh_queries',refresh),trace.context())
        return false
      }finally{setSaving(false)}
    }
    const pending=tail.current.then(task,task)
    tail.current=pending
    return pending
  }
  async function perform(action:(context:DiagnosticContext)=>Promise<unknown>) {
    const trace=startWorkflow('meeting','action')
    if(simulating) {trace.block('preview');return false}
    setSaving(true);setError(null)
    try {await trace.run('execute',action);await trace.run('refresh_queries',refresh,{writeOutcome:'committed'});trace.done({writeOutcome:'committed'});return true}
    catch(cause){trace.fail(cause);setError(cause instanceof Error?cause.message:'회의 작업에 실패했습니다.');await diagnosticOperation('meeting','refresh_after_failure',child=>child.run('refresh_queries',refresh),trace.context());return false}
    finally{setSaving(false)}
  }
  const bookings=useMemo(()=>{
    const own=seriesToDrafts(series),ids=new Set(own.map(item=>item.id))
    return [...own,...(calendar.data ?? emptyList()).filter(item=>!ids.has(item.id))]
  },[series,calendar.data])
  return {series,setSeries,perform,rooms:roomsQuery.data ?? emptyList(),bookings,saving,error:error ?? query.error?.message ?? roomsQuery.error?.message ?? calendar.error?.message,
    loading:query.isPending||roomsQuery.isPending||calendar.isPending,simulating,refresh,
    currentRevision:(id:string)=>cache.getQueryData<MeetingSeries[]>(key)?.find(item=>item.id===id)?.revision ?? 0}
}
