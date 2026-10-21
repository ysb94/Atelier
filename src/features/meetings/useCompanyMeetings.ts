import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { emptyList } from '@/lib/utils'
import { cleanupMeetingFiles, confirmCompanyMeeting, deleteCompanyMeeting, listCompanyMeetings, listMeetingCalendar, listMeetingRooms, saveCompanyMeeting } from '@/lib/supabase/meetings'
import { type MeetingSeries, seriesToDrafts } from './meeting-schedule'

/** 실제 저장과 화면 테스트를 분리한다. 실패·충돌 시 입력 화면을 유지한다. */
export function useCompanyMeetings(from:string,to:string) {
  const {profile}=useAuth(),preview=usePagePreview(),active=useWorkspaceTabActivity()
  const real=preview?.realProfile ?? profile,simulating=Boolean(preview?.active)
  const cache=useQueryClient()
  const key=useMemo(()=>['company-meetings',real?.id,real?.companyId],[real?.id,real?.companyId])
  const enabled=Boolean(real?.status==='active' && active)
  const query=useQuery({queryKey:key,queryFn:listCompanyMeetings,enabled,refetchInterval:active&&!simulating?15000:false})
  const roomsQuery=useQuery({queryKey:['meeting-rooms',real?.companyId],queryFn:listMeetingRooms,enabled})
  const calendarKey=useMemo(()=>['meeting-calendar',real?.id,real?.companyId,from,to],[real?.id,real?.companyId,from,to])
  const calendar=useQuery({queryKey:calendarKey,queryFn:()=>listMeetingCalendar(from,to),enabled,refetchInterval:active&&!simulating?15000:false})
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
    const task=async()=>{
      if(account.current!==owner || mode.current!==simulationMode) return false
      setSaving(true);setError(null)
      try{
        const before=simulationMode?(simulationRef.current ?? seriesRef.current):(cache.getQueryData<MeetingSeries[]>(key) ?? [])
        if(!simulationMode && expected && before.find(item=>item.id===expected.id)?.revision!==expected.revision) {
          throw new Error('다른 사람이 회의를 수정했습니다. 입력 내용을 보관한 뒤 닫고 다시 열어 주세요.')
        }
        const after=update(before)
        if(simulationMode){simulationRef.current=after;setSimulation(after);return true}
        for(const previous of before) if(!after.some(item=>item.id===previous.id)) await deleteCompanyMeeting(previous)
        for(const next of after) {
          const previous=before.find(item=>item.id===next.id)
          if(expected?.id===next.id && expected.confirmRound) await confirmCompanyMeeting(next,previous?.revision ?? 0,expected.confirmRound)
          else if(!previous || JSON.stringify(previous)!==JSON.stringify(next)) await saveCompanyMeeting(next,previous?.revision ?? 0)
        }
        await refresh()
        return true
      }catch(cause){
        console.warn('[meetings] 회의 저장 실패',{error:cause})
        setError(cause instanceof Error?cause.message:'회의를 저장하지 못했습니다.')
        // 충돌 후 낡은 회차를 다시 덮어쓰지 않게 원본만 재조회한다. 입력 폼은 유지한다.
        await refresh()
        return false
      }finally{setSaving(false)}
    }
    const pending=tail.current.then(task,task)
    tail.current=pending
    return pending
  }
  async function perform(action:()=>Promise<void>) {
    if(simulating) return false
    setSaving(true);setError(null)
    try {await action();await refresh();return true}
    catch(cause){console.warn('[meetings] 회의 작업 실패',{error:cause});setError(cause instanceof Error?cause.message:'회의 작업에 실패했습니다.');await refresh();return false}
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
