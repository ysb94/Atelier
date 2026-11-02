import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/supabase/auth'
import { cancelWorkRequest } from '@/lib/supabase/work-requests'
import { isClosedStatus, type WorkRequestRecord } from './work-request-types'

export function WorkRequestCancellation({request, canManage=false, disabled=false}: {request: WorkRequestRecord; canManage?: boolean; disabled?: boolean}) {
  const {profile,session}=useAuth()
  const actor=profile?.id
  const actorRef=useRef(actor);actorRef.current=actor
  const client=useQueryClient()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const inFlight=useRef(false)
  const command=useRef<{key:string;id:string}|null>(null)
  useEffect(()=>{setError('');command.current=null},[actor,request.id,request.revision])
  const own=profile?.status==='active' && session?.user.id===actor && request.requesterId===actor
  const closed=isClosedStatus(request.status)
  const pending=request.cancellation?.state==='requested' && !closed
  const immediate=['requested','reviewing'].includes(request.status) || request.kind==='internal'
  async function act(action: 'request'|'approve'|'reject') {
    if(inFlight.current || disabled || !actor || session?.user.id!==actor)return
    const text=action==='approve'?'취소 요청을 수락하고 업무를 취소할까요?':action==='reject'?'취소 요청을 반려하고 기존 업무를 유지할까요?':immediate?'이 작업 요청을 바로 취소할까요?':'담당 부서에 취소 요청을 보낼까요? 수락 전까지 업무 상태는 유지됩니다.'
    if(!window.confirm(text))return
    const key=`${actor}:${request.id}:${request.revision}:${action}`
    if(command.current?.key!==key)command.current={key,id:crypto.randomUUID()}
    inFlight.current=true;setBusy(true);setError('')
    try {
      await cancelWorkRequest(request,action,command.current.id)
      await Promise.all([client.invalidateQueries({queryKey:['work-requests',actor]}),client.invalidateQueries({queryKey:['department-work',actor]})])
    } catch(failure) {
      console.warn('[work-requests] 취소 처리 실패',{requestId:request.id,action,error:failure})
      if(actorRef.current===actor)setError(failure instanceof Error?failure.message:'취소 처리에 실패했습니다. 다시 시도해 주세요.')
      // A concurrent assignment must be re-read rather than silently changing a cancel into a request.
      await Promise.all([client.invalidateQueries({queryKey:['work-requests',actor]}),client.invalidateQueries({queryKey:['department-work',actor]})])
    } finally {inFlight.current=false;setBusy(false)}
  }
  if(!own && !pending)return null
  return <div className="flex flex-wrap items-center gap-2">
    {pending ? <><Badge variant="warning">취소 요청 중</Badge>{canManage ? <><Button size="sm" disabled={busy||disabled} onClick={()=>void act('approve')}>취소 수락</Button><Button size="sm" variant="outline" disabled={busy||disabled} onClick={()=>void act('reject')}>취소 반려</Button></> : null}</> : own&&!closed ? <Button size="sm" variant="outline" disabled={busy||disabled} onClick={()=>void act('request')}>{busy?'처리 중...':immediate?'취소':'취소 요청'}</Button> : null}
    {own&&request.cancellation?.state==='rejected'&&!closed ? <span className="text-xs text-muted-foreground">취소 요청 반려 · 기존 업무 유지</span> : null}
    {error ? <p role="alert" className="basis-full text-xs text-danger">{error}</p> : null}
  </div>
}
