import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { listDepartmentApprovers } from '@/lib/supabase/department-approvers'
import { useWorkspaceTabActivity } from '@/components/layout/workspace-tab-activity'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { listAttendanceStartReminders,readAttendanceStartReminder } from '@/lib/supabase/attendance-start-reminders'
import { sharedReadPolicy,readPollInterval } from '@/lib/query/shared-read-policy'
import { emptyList } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AttendanceStartReminder } from './attendance-start-reminders'

export const attendanceReminderKey=['attendance-start-reminders'] as const
export function useAttendanceStartReminders(coordinator=false,background=false) {
  const {profile,session}=useAuth(),preview=usePagePreview(),active=useWorkspaceTabActivity()
  const valid=!!profile && profile.id===session?.user.id && profile.status==='active' && !preview?.active
  // Observe the existing assignment cache without adding another polling timer per badge.
  const approvals=useQuery({queryKey:['department-approvers',session?.user.id,profile?.status==='active'],queryFn:listDepartmentApprovers,...sharedReadPolicy,enabled:valid&&active})
  const enabled=valid && approvals.isSuccess && !approvals.error && approvals.data.some(r=>r.approverId===profile!.id||r.substituteId===profile!.id)
  const query=useQuery({queryKey:[...attendanceReminderKey,profile?.id,profile?.companyId],queryFn:listAttendanceStartReminders,...sharedReadPolicy,enabled,
    refetchInterval:q=>q.state.data?.ready===false?false:readPollInterval(30_000,enabled&&coordinator)(q),refetchIntervalInBackground:coordinator&&background})
  const rows=useMemo(()=>{
    if(!enabled||query.error||!query.data)return emptyList<AttendanceStartReminder>()
    const assigned=new Set(approvals.data?.filter(r=>r.approverId===profile?.id||r.substituteId===profile?.id).map(r=>r.departmentId))
    return query.data.rows.filter(row=>assigned.has(row.departmentId))
  },[enabled,query.error,query.data,approvals.data,profile?.id])
  return{...query,rows,ready:!enabled||query.isSuccess}
}

/** Mounted only beside a successfully displayed, authorized month/roster. */
export function AttendanceStartReminderRead({rows,displayed}:{rows:readonly AttendanceStartReminder[];displayed:boolean}) {
  const {profile}=useAuth(),cache=useQueryClient(),attempts=useRef(new Set<string>())
  const visible=useNotificationDetailVisibility()
  const [error,setError]=useState(''),[retry,setRetry]=useState(0)
  const live=useRef(false),actor=useRef(profile?.id)
  actor.current=profile?.id
  useEffect(()=>{live.current=true;return()=>{live.current=false}},[])
  useEffect(()=>{
    if(!displayed||!visible||!profile)return
    const owner=profile.id
    const pending=rows.filter(r=>!r.readAt&&!attempts.current.has(`${profile.id}:${r.id}:${r.version}`))
    if(!pending.length)return
    pending.forEach(r=>attempts.current.add(`${profile.id}:${r.id}:${r.version}`))
    void Promise.all(pending.map(r=>readAttendanceStartReminder(r.id,r.version))).then(()=>{
      if(live.current&&actor.current===owner)setError('')
      return cache.invalidateQueries({queryKey:attendanceReminderKey})
    }).catch(()=>{if(live.current&&actor.current===owner)setError('알림 읽음 저장에 실패했습니다. 다시 시도해 주세요.')})
  },[displayed,visible,rows,profile,cache,retry])
  return error?<p role="alert" className="text-sm text-danger">{error}<Button variant="outline" size="sm" onClick={()=>{attempts.current.clear();setRetry(v=>v+1)}}>읽음 저장 재시도</Button></p>:null
}
