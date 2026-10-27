import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { listOrgChartMembers } from '@/lib/supabase/profiles'
import { useBasicWorkAccess } from '@/lib/supabase/basic-work-access'
import { comparison, deleteWorkRequest, listWorkRequests, saveWorkRequestChange, setActiveWorkRequest } from '@/lib/supabase/work-requests'
import { emptyList } from '@/lib/utils'
import type { WorkRequestOwner } from './work-request-form-config'
import type { LocalTeamMember, WorkRequestRecord } from './work-request-types'
import type { WorkTimeLog } from './work-request-schedule'

export function useWorkRequests(owner: WorkRequestOwner) {
  const { profile, session }=useAuth()
  const actorId=profile?.id??''
  const active=Boolean(actorId && profile?.status==='active' && session?.user.id===actorId)
  const actorRef=useRef(actorId);actorRef.current=actorId
  const queryClient=useQueryClient()
  const access=useBasicWorkAccess()
  const query=useQuery({queryKey:['work-requests',actorId,owner],queryFn:()=>listWorkRequests(actorId,owner),enabled:active,retry:false})
  const directory=useQuery({queryKey:['orgChartMembers',actorId],queryFn:listOrgChartMembers,enabled:active,retry:false})
  const [requests,setLocal]=useState<WorkRequestRecord[]>([])
  const [error,setError]=useState<string|null>(null)
  const [saving,setSaving]=useState(false)
  const requestsRef=useRef(requests)
  const queue=useRef(Promise.resolve())
  const pending=useRef(0)
  const lastSaveError=useRef<unknown>(null)
  const revisions=useRef(new Map<string,number>())
  const [currentWorkByMember,setLocalCurrent]=useState<Record<string,string>>({})
  const [workTimeByKey,setWorkTimeByKey]=useState<Record<string,WorkTimeLog>>({})
  const refresh=useCallback(()=>queryClient.invalidateQueries({queryKey:['work-requests',actorId]}),[queryClient,actorId])
  useEffect(()=>{requestsRef.current=[];setLocal([]);revisions.current.clear();setLocalCurrent({});setWorkTimeByKey({});setError(null)},[actorId,owner])
  useEffect(()=>{
    if(!active || !query.data || pending.current)return
    requestsRef.current=query.data.requests;setLocal(query.data.requests)
    for(const request of query.data.requests)if(request.revision)revisions.current.set(request.id,request.revision)
    const current:Record<string,string>={},times:Record<string,WorkTimeLog>={}
    for(const timer of query.data.timers){if(timer.mountedAt)current[timer.profileId]=timer.requestId;times[timer.profileId+':'+timer.requestId]={accumulatedMs:timer.accumulatedMs,mountedAt:timer.mountedAt?Date.parse(timer.mountedAt):null}}
    setLocalCurrent(current);setWorkTimeByKey(times)
  },[query.data,active])
  useEffect(()=>{
    if(!active)return
    let timer:ReturnType<typeof setTimeout>|undefined
    const signal=()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(),100)}
    const channel=getSupabase().channel(`work-requests:${actorId}:${owner}`).on('postgres_changes',{event:'*',schema:'public',table:'work_requests'},signal).on('postgres_changes',{event:'INSERT',schema:'public',table:'work_request_messages'},signal).on('postgres_changes',{event:'*',schema:'public',table:'work_request_time_entries'},signal).subscribe(status=>{if(status==='SUBSCRIBED')signal();if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('[work-requests] 실시간 연결 실패',{owner,status})})
    const reconnect=()=>void refresh();window.addEventListener('online',reconnect)
    return()=>{clearTimeout(timer);window.removeEventListener('online',reconnect);void getSupabase().removeChannel(channel)}
  },[active,actorId,owner,refresh])
  const enqueue=useCallback((task:()=>Promise<void>)=>{
    const actor=actorId;pending.current++;setSaving(true);setError(null);lastSaveError.current=null
    queue.current=queue.current.then(async()=>{if(actorRef.current!==actor)throw new Error('계정이 바뀌어 저장을 중단했습니다.');await task()}).catch(async(failure:unknown)=>{lastSaveError.current=failure;console.warn('[work-requests] 업무 저장 실패',failure);if(actorRef.current===actor){setError(failure instanceof Error?failure.message:'저장하지 못했습니다.');try{const restored=await listWorkRequests(actor,owner);if(actorRef.current===actor){requestsRef.current=restored.requests;setLocal(restored.requests);for(const request of restored.requests)if(request.revision)revisions.current.set(request.id,request.revision)}}catch(reloadError){console.warn('[work-requests] 저장 실패 후 재조회 실패',reloadError)}}}).finally(async()=>{pending.current--;if(actorRef.current===actor&&!pending.current){await refresh();setSaving(false)}})
  },[actorId,owner,refresh])
  const setRequests=useCallback((update:SetStateAction<WorkRequestRecord[]>)=>{
    if(!active)throw new Error('직원 세션을 확인해 주세요.')
    const before=requestsRef.current
    const next=typeof update==='function'?update(before):update
    requestsRef.current=next;setLocal(next)
    enqueue(async()=>{
      for(const request of next){const old=before.find(item=>item.id===request.id);if(!old||comparison(old)!==comparison(request)){const revision=await saveWorkRequestChange(old,request,revisions.current.get(request.id));revisions.current.set(request.id,revision)}}
      for(const request of before)if(!next.some(item=>item.id===request.id))await deleteWorkRequest(request,revisions.current.get(request.id))
    })
  },[active,enqueue])
  const setCurrentWorkByMember=useCallback((update:SetStateAction<Record<string,string>>)=>{
    setLocalCurrent(current=>{const next=typeof update==='function'?update(current):update;return next})
    // Persist only the signed-in worker's active task; no client-supplied colleague timer is accepted.
    enqueue(async()=>{const snapshot=await listWorkRequests(actorId,owner);const current:Record<string,string>={};for(const timer of snapshot.timers)if(timer.mountedAt)current[timer.profileId]=timer.requestId;const next=typeof update==='function'?update(current):update;await setActiveWorkRequest(next[actorId]??null)})
  },[enqueue,actorId,owner])
  const members=directory.data??emptyList<NonNullable<typeof directory.data>[number]>()
  const teamMembers:LocalTeamMember[]=members.filter(member=>member.departmentId===({planning:'ced99f89-ea80-4eeb-8f03-272bf72f5db1',design:'7ac8b7a8-7f12-4f3e-a371-d2dac7e492f1',md:'919b2c44-afb6-4d7e-a5b8-b7203df9cef9',logistics:'c5d4cfca-97ce-4ca7-b30a-6beed842cf1e'}[owner])).map(member=>({id:member.id,name:member.displayName||'직원',position:member.position??'',isSelf:member.id===actorId}))
  return {requests:active?(saving?requests:query.data?.requests??requests):emptyList<WorkRequestRecord>(),setRequests,currentWorkByMember,workTimeByKey,setCurrentWorkByMember,setWorkTimeByKey,teamMembers,canManage:Boolean(access.access?.manageOwners.includes(owner)),managerAvailable:query.data?.managerAvailable??false,loading:query.isPending||access.isPending,loadError:query.error?.message??directory.error?.message??access.error?.message??null,error:error??query.error?.message??directory.error?.message??access.error?.message??null,saving,waitForSaves:()=>queue.current.then(()=>lastSaveError.current===null),retry:()=>{setError(null);return refresh()}}
}
