import { listMeetingInvitations } from '@/lib/supabase/meetings'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { useMeetingNotices } from '@/features/meetings/use-meeting-notices'
import { listMyLeaveUsageNotices, type LeaveUsageNotice } from '@/lib/supabase/leave-usage-notices'
import { listMyLateStatementNotices } from '@/lib/supabase/late-arrival-statements'
import { lateStatementNoticeItems } from '@/features/home/LateStatementReview'
import { leaveNoticeItems } from '@/features/operations-support/leave-usage-notices'
import type { InboxNotification } from '@/lib/inbox/types'
import { emptyList } from '@/lib/utils'
import { requestLabel, type RequestKind } from './personal-requests'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'

type WorkNotice = { event_key: string; entity_id: string; created_at: string; event_type: string; tab: 'approvals'|'overtime'|'my-attendance'; kind: RequestKind; employee_name: string; from_date: string; to_date: string; start_time: string; end_time: string; note: string; decision_note: string|null; action_needed: boolean; status: string; current?: boolean; read_at: string|null }
async function workNotices(): Promise<WorkNotice[]> {
  const { data, error } = await getSupabase().rpc('list_my_home_work_notifications')
  if (error) { console.warn('[my-home-notifications] 업무 알림 조회 실패', error); throw new Error(['PGRST202','42883'].includes(error.code) ? '신청·퇴근 알림 서버 연결 대기: 추가 DB 설정이 필요합니다.' : '업무 알림을 불러오지 못했습니다.') }
  return data ?? []
}
export function useMyHomeNotifications({ coordinator = false, background = false } = {}) {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const enabled = profile?.status === 'active' && session?.user.id === profile.id && !preview?.active
  const meetings = useMeetingNotices({ realtime: coordinator && enabled, background })
  const poll = coordinator && enabled ? 30_000 : false
  const leave = useQuery({ queryKey: ['leave-usage-notices', profile?.id], queryFn: () => listMyLeaveUsageNotices(profile!.id), enabled, refetchInterval: poll, refetchIntervalInBackground: background && coordinator })
  const late = useQuery({ queryKey: ['late-statement-notices', profile?.id], queryFn: listMyLateStatementNotices, enabled, refetchInterval: poll, refetchIntervalInBackground: background && coordinator })
  const work = useQuery({ queryKey: ['my-home-work-notices', profile?.id], queryFn: workNotices, enabled, refetchInterval: poll, refetchIntervalInBackground: background && coordinator, retry: false })
  const cache=useQueryClient()
  useEffect(()=>{
    if(!coordinator||!enabled||!profile?.id)return
    const db=getSupabase()
    const refresh=()=>{void cache.invalidateQueries({queryKey:['my-home-work-notices',profile.id]})}
    const channel=db.channel(`my-home-work:${profile.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'my_home_request_events',filter:`employee_id=eq.${profile.id}`},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'my_home_notification_reads',filter:`reader_id=eq.${profile.id}`},refresh)
      .subscribe(status=>{if(status==='SUBSCRIBED')refresh();else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.warn('[my-home-notifications] 실시간 연결 실패, 30초 조회로 보완',{status})})
    return()=>{void db.removeChannel(channel).catch(error=>console.warn('[my-home-notifications] 실시간 정리 실패',error))}
  },[coordinator,enabled,profile?.id,cache])
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
    const records = leave.data ?? emptyList<LeaveUsageNotice>()
    const leaveItems = leaveNoticeItems(records).map((item, index) => ({ ...item,
      href: `/settings/profile?part=my-attendance&leaveNotice=${item.id}`,
      target: { source: 'leave-notice' as const, entityId: item.id, eventVersion: item.createdAt, tab: 'my-attendance' as const, href: `/settings/profile?part=my-attendance&leaveNotice=${item.id}` },
      action: !records[index].confirmed_at ? { key: `leave:${item.id}`, label: '안내문 본인 확인 필요' } : null,
    }))
    const lateItems = lateStatementNoticeItems(late.data ?? emptyList()).map(item => {
      const url = new URL(item.href, 'https://atelier.local')
      const tab = item.kind === 'late_statement_manager' ? 'approvals' as const : 'my-attendance' as const
      url.searchParams.set('part', tab)
      return { ...item, href: url.pathname+url.search, target: { source: 'late-statement' as const, entityId: url.searchParams.get('lateStatement')!, eventVersion: item.createdAt, tab, href: url.pathname+url.search },
        action: item.kind === 'late_statement_manager' ? { key: `late:${item.id}`, label: '사유서 확인 필요' } : null }
    })
    const workItems = (work.data ?? emptyList<WorkNotice>()).map(item => {
      const href = item.event_type === 'offsite-group' ? `/settings/profile?part=my-attendance&request=${item.entity_id}` : `/settings/profile?part=${item.tab}&workNotice=${encodeURIComponent(item.event_key)}`
      const label = requestLabel(item.kind)
      return { id: item.event_key, kind: item.event_type==='checkout'?'checkout_needed' as const:'personal_request' as const,
        title: item.event_type === 'offsite-group' ? `${item.employee_name}님이 외근을 등록했습니다${item.status === 'cancelled' ? ' · 취소됨' : ''}` : item.event_type === 'checkout' ? `${item.from_date} 퇴근시간 확인 필요` : item.event_type === 'offsite-settlement' ? '외근 후처리 결과' : item.event_type === 'approval' ? `${item.employee_name} · ${label} 승인 요청` : `${label} ${item.status === 'approved' ? '승인' : '반려'}`,
        body: item.event_type==='checkout'?`${item.from_date} · 출근 ${item.start_time}\n${item.note}`:`${item.from_date} ~ ${item.to_date} · ${item.start_time}–${item.end_time}${item.decision_note ? `\n처리 의견: ${item.decision_note}` : ''}`,
        createdAt: item.created_at, readAt: item.read_at, current:item.current!==false, href,
        target: { source: item.event_type==='checkout'?'checkout' as const:'request' as const, entityId: item.entity_id, eventVersion: item.event_key, tab: item.tab, href },
        action: item.action_needed ? { key: `request:${item.entity_id}`, label: item.event_type==='checkout'?'실제 퇴근시간 등록 필요':'승인 처리 필요' } : null,
      }
    })
    return [...meetingItems,...leaveItems,...lateItems,...workItems].sort((a,b) => b.createdAt.localeCompare(a.createdAt))
  }, [enabled, meetings.items, meetings.series, leave.data, late.data, work.data])
  return { items, ready: enabled && meetings.ready && leave.isSuccess && late.isSuccess && work.isSuccess, work: work.data ?? emptyList<WorkNotice>(), error: enabled ? meetings.error ?? leave.error ?? late.error ?? work.error : null }
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
      try {
        if (source === 'meeting') {
          // Match the exact event shown by the drawer, including host notices.
          const data=meetingEvents.data ?? []
          for (const item of (data ?? []) as InboxNotification[]) {
            const url = new URL(item.href,'https://atelier.local')
            if (item.kind !== 'meeting_invitation' || url.searchParams.get('round') !== entityId || item.readAt || item.meeting?.scheduleVersion && String(item.meeting.scheduleVersion) !== version) continue
            const { error: readError } = await getSupabase().rpc('read_meeting_notice_version',{p_id:item.id,p_sent_at:item.createdAt,p_schedule_version:Number(version)})
            if (readError) throw readError
          }
        } else {
          const records = await workNotices()
          for (const item of records.filter(row => row.entity_id === entityId && !row.read_at && ((row.event_type!=='offsite-settlement' && version === `status:${row.status}`) || row.event_key === version))) {
            const { error: readError } = await getSupabase().rpc('read_my_home_work_notification',{p_key:item.event_key})
            if (readError) throw readError
          }
        }
        if (!cancelled) { completed.current=key; setError(null) }
        await Promise.all(['meeting-invitations','my-home-work-notices'].map(name=>cache.invalidateQueries({queryKey:[name,profile?.id]})))
      } catch (failure) {
        console.warn('[my-home-notifications] 상세 열람 읽음 저장 실패',{source,entityId,failure})
        if (!cancelled) setError('읽음 기록을 저장하지 못했습니다. 다시 시도해 주세요.')
      }
    }
    void read()
    return () => { cancelled=true }
  }, [active,cache,displayed,entityId,preview?.active,profile?.id,retry,source,version,meetingEvents.data])
  return { error, retry: () => {completed.current=null;setRetry(value=>value+1)} }
}
