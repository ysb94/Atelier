import { listMeetingInvitations } from '@/lib/supabase/meetings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { useHeadOfficeSelfService } from '@/lib/company/workforce-management-context'
import { getSupabase } from '@/lib/supabase/client'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useMeetingNotices } from '@/features/meetings/use-meeting-notices'
import { listMyLeaveUsageNotices, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'
import { listMyLateStatementNotices } from '@/lib/supabase/late-arrival-statements'
import { lateStatementNoticeItems } from '@/features/home/LateStatementReview'
import { leaveNoticeItems } from '@/features/operations-support/leave-usage-notices'
import type { InboxNotification } from '@/lib/inbox/types'
import { emptyList } from '@/lib/utils'
import { sharedReadPolicy, readPollInterval } from '@/lib/query/shared-read-policy'
import { requestLabel, type RequestKind } from './personal-requests'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { diagnosticRealtime, startWorkflow, type DiagnosticContext } from '@/lib/diagnostics/workflow-trace'
import { diagnosticQuery } from '@/lib/supabase/diagnostic-query'
import { useDiagnosticGate } from '@/lib/diagnostics/use-diagnostic-gate'
import { useAttendanceStartReminders } from './use-attendance-start-reminders'
import { attendanceStartReminderItems } from './attendance-start-reminders'
import { useVisualWorkflowNotices, visualWorkflowNoticeItem } from '@/features/work-requests/use-visual-workflow-notices'

type WorkNotice = { event_key: string; entity_id: string; created_at: string; event_type: string; tab: 'approvals'|'overtime'|'my-attendance'|'holiday-work'; title?: string; action_key?: string; kind: RequestKind; employee_name: string; from_date: string; to_date: string; start_time: string; end_time: string; note: string; decision_note: string|null; action_needed: boolean; status: string; current?: boolean; read_at: string|null }
async function workNotices(context?: DiagnosticContext): Promise<WorkNotice[]> {
  try {
    try { return await diagnosticQuery<WorkNotice[]>('notification','list_work_notices',getSupabase().rpc('list_my_managed_work_notifications'),context) ?? [] }
    catch (error) {
      const code=(error as Error & {cause?:{code?:string}}).cause?.code
      // Older servers retain the existing endpoint until the additive migration is applied.
      if (code && ['PGRST202','42883'].includes(code)) return await diagnosticQuery<WorkNotice[]>('notification','list_work_notices',getSupabase().rpc('list_my_home_work_notifications'),context) ?? []
      throw error
    }
  }
  catch(error) { const code=(error as Error & {cause?:{code?:string}}).cause?.code;throw new Error(['PGRST202','42883'].includes(code ?? '') ? '신청·퇴근 알림 서버 연결 대기: 추가 DB 설정이 필요합니다.' : '업무 알림을 불러오지 못했습니다.',{cause:error}) }
}
export function useMyHomeNotifications({ coordinator = false, background = false } = {}) {
  const { profile, session } = useAuth()
  const selfService = useHeadOfficeSelfService()
  const preview = usePagePreview()
  const enabled = profile?.status === 'active' && session?.user.id === profile.id && !preview?.active
  useDiagnosticGate('notification','inbox_access',enabled,enabled?'enabled':preview?.active?'preview':!session?'no_session':profile?.status!=='active'?'inactive_employee':'identity_mismatch')
  const meetings = useMeetingNotices({ realtime: coordinator && enabled, background })
  const poll = readPollInterval(30_000, coordinator && enabled)
  const leave = useQuery({ queryKey: ['leave-usage-notices', profile?.id], queryFn: () => listMyLeaveUsageNotices(profile!.id), ...sharedReadPolicy, enabled: enabled && selfService, refetchInterval: poll, refetchIntervalInBackground: background && coordinator })
  const late = useQuery({ queryKey: ['late-statement-notices', profile?.id], queryFn: listMyLateStatementNotices, ...sharedReadPolicy, enabled: enabled && selfService, refetchInterval: poll, refetchIntervalInBackground: background && coordinator })
  const work = useQuery({ queryKey: ['my-home-work-notices', profile?.id], queryFn: () => workNotices(), ...sharedReadPolicy, enabled: enabled && selfService, refetchInterval: poll, refetchIntervalInBackground: background && coordinator })
  const cache=useQueryClient()
  const attendanceReminders=useAttendanceStartReminders(coordinator,background)
  const visual = useVisualWorkflowNotices(coordinator, background)
  // Old servers have no holiday signal table. Keep their existing subscriptions
  // intact; the first holiday event is discovered by the shared 30-second poll.
  const holidaySignals = Boolean(work.data?.some(item=>item.event_type.startsWith('holiday-')))
  useEffect(()=>{
    if(!coordinator||!enabled||!profile?.id||!selfService)return
    const db=getSupabase()
    let disposed=false
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>{void Promise.all(['my-home-work-notices','holiday-work'].map(key=>cache.invalidateQueries({queryKey:[key]})))},150)}
    const channel=db.channel(`my-home-work:${profile.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'my_home_request_events',filter:`employee_id=eq.${profile.id}`},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'my_home_notification_reads',filter:`reader_id=eq.${profile.id}`},refresh)
    if(holidaySignals&&profile.companyId)channel.on('postgres_changes',{event:'*',schema:'public',table:'holiday_work_signals',filter:`company_id=eq.${profile.companyId}`},refresh)
    channel.subscribe(status=>{if(disposed)return;diagnosticRealtime('notification','work_notice_channel',status);if(status==='SUBSCRIBED')refresh()})
    return()=>{disposed=true;clearTimeout(timer);void db.removeChannel(channel).catch(error=>startWorkflow('notification','unsubscribe').fail(error))}
  },[coordinator,enabled,profile?.id,profile?.companyId,cache,holidaySignals,selfService])
  const items = useMemo<InboxNotification[]>(() => {
    if (!enabled) return []
    const meetingItems = meetings.items.map(item => {
      const url = new URL(item.href, 'https://atelier.local')
      const round = url.searchParams.get('round') ?? item.id
      const series=meetings.series?.find(row=>row.id===url.searchParams.get('meeting'))
      // 호스트 결과는 읽음으로 끝나는 안내다. 멤버의 실제 참석 응답만 업무로 남긴다.
      const pending = !item.meeting?.finalized && item.meeting?.role !== 'host' && item.meeting?.status === 'pending'
      return { ...item,current:item.current!==false&&(meetings.series===undefined||Boolean(series&&(item.kind==='meeting_result'||item.kind==='meeting_removed'||series.status!=='done'))), target: { source: 'meeting' as const, entityId: round, eventVersion: item.createdAt, tab: 'meetings' as const, href: item.href }, action: pending ? { key: `meeting:${round}:${item.meeting?.role}`, label: '참석 응답 필요' } : null }
    })
    const records = selfService ? leave.data ?? emptyList<LeaveUsageNotice>() : emptyList<LeaveUsageNotice>()
    const leaveItems = leaveNoticeItems(records).map((item, index) => ({ ...item,
      href: `/settings/profile?part=my-attendance&leaveNotice=${item.id}`,
      target: { source: 'leave-notice' as const, entityId: item.id, eventVersion: item.createdAt, tab: 'my-attendance' as const, href: `/settings/profile?part=my-attendance&leaveNotice=${item.id}` },
      action: !records[index].confirmed_at ? { key: `leave:${item.id}`, label: '안내문 본인 확인 필요' } : null,
    }))
    const lateItems = lateStatementNoticeItems(selfService ? late.data ?? emptyList() : emptyList()).map(item => {
      const url = new URL(item.href, 'https://atelier.local')
      const tab = item.kind === 'late_statement_manager' ? 'approvals' as const : 'my-attendance' as const
      url.searchParams.set('part', tab)
      return { ...item, href: url.pathname+url.search, target: { source: 'late-statement' as const, entityId: url.searchParams.get('lateStatement')!, eventVersion: item.createdAt, tab, href: url.pathname+url.search },
        action: item.kind === 'late_statement_manager' ? { key: `late:${item.id}`, label: '사유서 확인 필요' } : null }
    })
    const workItems = (selfService ? work.data ?? emptyList<WorkNotice>() : emptyList<WorkNotice>()).map(item => {
      const holiday = item.event_type.startsWith('holiday-')
      const holidayPath = item.tab === 'holiday-work' ? '/operations-support?part=attendance&attendanceView=holiday' : `/settings/profile?part=${item.tab}`
      const href = holiday ? `${holidayPath}&holidayWork=${item.entity_id}&holidayMonth=${item.from_date.slice(0,7)}&holidayEvent=${encodeURIComponent(item.event_key)}` : item.event_type === 'offsite-group' ? `/settings/profile?part=my-attendance&request=${item.entity_id}` : `/settings/profile?part=${item.tab}&workNotice=${encodeURIComponent(item.event_key)}`
      const label = requestLabel(item.kind)
      return { id: item.event_key, kind: item.event_type==='checkout'?'checkout_needed' as const:'personal_request' as const,
        title: holiday ? item.title ?? '주말·공휴일 근무 안내' : item.event_type === 'offsite-group' ? `${item.employee_name}님이 외근을 등록했습니다${item.status === 'cancelled' ? ' · 취소됨' : ''}` : item.event_type === 'checkout' ? `${item.from_date} 퇴근시간 확인 필요` : item.event_type === 'offsite-settlement' ? '외근 후처리 결과' : item.event_type === 'approval' ? `${item.employee_name} · ${label} 승인 요청` : `${label} ${item.status === 'approved' ? '승인' : '반려'}`,
        body: holiday ? item.note : item.event_type==='checkout'?`${item.from_date} · 출근 ${item.start_time}\n${item.note}`:`${item.from_date} ~ ${item.to_date} · ${item.start_time}–${item.end_time}${item.decision_note ? `\n처리 의견: ${item.decision_note}` : ''}`,
        createdAt: item.created_at, readAt: item.read_at, current:item.current!==false, href,
        target: { source: item.event_type==='checkout'?'checkout' as const:'request' as const, entityId: item.entity_id, eventVersion: item.event_key, tab: item.tab, href },
        action: item.action_needed ? { key: item.action_key ?? `request:${item.entity_id}`, label: holiday ? item.tab==='approvals'?'실제 시간 확인 필요':item.tab==='holiday-work'?'보상 처리 필요':'실제 시간 보완 필요' : item.event_type==='checkout'?'실제 퇴근시간 등록 필요':'승인 처리 필요' } : null,
      }
    })
    return [...meetingItems,...leaveItems,...lateItems,...workItems,...attendanceStartReminderItems(attendanceReminders.rows),...(visual.rows?.map(visualWorkflowNoticeItem) ?? [])].sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  }, [enabled, meetings.items, meetings.series, leave.data, late.data, work.data, selfService,attendanceReminders.rows,visual.rows])
  return { items, ready: enabled && meetings.ready && (!selfService || (leave.isSuccess && late.isSuccess && work.isSuccess)), work: selfService ? work.data ?? emptyList<WorkNotice>() : emptyList<WorkNotice>(), error: enabled ? meetings.error ?? attendanceReminders.error ?? (selfService ? leave.error ?? late.error ?? work.error : null) : null }
}

export function useReadMyHomeNotification(source: 'meeting'|'request'|'checkout', entityId: string|undefined, version: string|undefined, displayed: boolean) {
  const { profile } = useAuth()
  const preview = usePagePreview()
  const active = useNotificationDetailVisibility()
  const cache = useQueryClient()
  const meetingEvents=useQuery({queryKey:['meeting-invitations',profile?.id],queryFn:listMeetingInvitations,enabled:false})
  const completed = useRef<string|null>(null)
  const [error,setError] = useState<string|null>(null)
  const [retry,setRetry] = useState(0)
  useEffect(() => {
    if (!displayed || !active || preview?.active || !entityId || !version || !profile?.id) return
    if(source==='meeting'&&!meetingEvents.data)return
    const key = `${profile.id}:${source}:${entityId}:${version}`
    if (completed.current === key) return
    let cancelled = false
    async function read() {
      const trace=startWorkflow('notification','read_detail',{source})
      trace.step('match_displayed_version')
      let count=0
      try {
        if (source === 'meeting') {
          // Match the exact event shown by the drawer, including host notices.
          const data=meetingEvents.data ?? []
          for (const item of (data ?? []) as InboxNotification[]) {
            const url = new URL(item.href,'https://atelier.local')
            if (item.kind !== 'meeting_invitation' || url.searchParams.get('round') !== entityId || item.readAt || item.meeting?.scheduleVersion && String(item.meeting.scheduleVersion) !== version) continue
            await trace.run('save_read',context=>diagnosticQuery('notification','read_meeting_notice',getSupabase().rpc('read_meeting_notice_version',{p_id:item.id,p_sent_at:item.createdAt,p_schedule_version:Number(version)}),context))
            count++
          }
        } else {
          const records = await trace.run('load_current_events',context=>workNotices(context))
          for (const item of records.filter(row => row.entity_id === entityId && !row.read_at && ((row.event_type!=='offsite-settlement' && !row.event_type.startsWith('holiday-') && version === `status:${row.status}`) || row.event_key === version))) {
            await trace.run('save_read',context=>diagnosticQuery('notification','read_work_notice',getSupabase().rpc('read_my_home_work_notification',{p_key:item.event_key}),context))
            count++
          }
        }
        if (!cancelled) { completed.current=key; setError(null) }
        await trace.run('refresh_queries',()=>Promise.all(['meeting-invitations','my-home-work-notices'].map(name=>cache.invalidateQueries({queryKey:[name,profile?.id]}))),{writeOutcome:count?'committed':'not_changed'})
        trace.done({count,state:count?'read_saved':'no_current_unread'})
      } catch (failure) {
        trace.fail(failure)
        if (!cancelled) setError('읽음 기록을 저장하지 못했습니다. 다시 시도해 주세요.')
      }
    }
    void read()
    return () => { cancelled=true }
  }, [active,cache,displayed,entityId,preview?.active,profile?.id,retry,source,version,meetingEvents.data])
  return { error, retry: () => {completed.current=null;setRetry(value=>value+1)} }
}
