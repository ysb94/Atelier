import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAttendanceEntry } from '@/features/home/attendance-entry-context'
import { useRenderWatch } from '@/lib/diagnostics'
import { useAuth } from '@/lib/supabase/auth'
import { listCompanyMeetings, listMeetingRooms } from '@/lib/supabase/meetings'
import { emptyList } from '@/lib/utils'
import type { MeetingRoom, MeetingSeries } from './meeting-schedule'
import { MEETING_REMINDER_LEAD_MS, meetingNoticeDue, meetingNoticeStorageKey, upcomingMeetingNotices, type MeetingStartNotice } from './meeting-start-reminders'

/** 라우트·KeepAlive 탭 밖에서 한 번만 실행한다. 실제 로그인 계정의 기존 조회 권한을 사용한다. */
export function MeetingStartReminder() {
  useRenderWatch('MeetingStartReminder')
  const { profile } = useAuth()
  const entry = useAttendanceEntry()
  const enabled = profile?.status === 'active'
  const meetings = useQuery({
    queryKey: ['company-meetings', profile?.id, profile?.companyId], queryFn: listCompanyMeetings,
    enabled, refetchInterval: enabled ? 30_000 : false,
  })
  const rooms = useQuery({ queryKey: ['meeting-rooms', profile?.companyId], queryFn: listMeetingRooms, enabled })
  const notices = useMemo(() => upcomingMeetingNotices(meetings.data ?? emptyList<MeetingSeries>(), profile?.id ?? ''), [meetings.data, profile?.id])
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!enabled) return
    const current = Date.now()
    const next = notices.flatMap(notice => [notice.startsAtMs - MEETING_REMINDER_LEAD_MS, notice.startsAtMs]).filter(time => time > current)
    // 30분 경계와 시작 순간에는 정확히 갱신하고, 나머지는 30초 단위로 남은 시간을 갱신한다.
    const delay = Math.min(30_000, ...next.map(time => time - current))
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(10, delay))
    return () => window.clearTimeout(timer)
  }, [enabled, notices, now])
  const refresh = meetings.refetch
  useEffect(() => {
    if (!enabled) return
    const visible = () => {
      if (document.visibilityState !== 'visible') return
      // 이 조회만 갱신한다. 전역 window focus 재조회는 켜지 않는다.
      void refresh().then(() => setNow(Date.now())).catch(error => console.warn('[meetings] 복귀 후 시작 알림 조회 실패', { error }))
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', visible)
    return () => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible) }
  }, [enabled, refresh])
  useEffect(() => {
    if (meetings.error) console.warn('[meetings] 시작 알림 일정 조회 실패', { error: meetings.error })
    if (rooms.error) console.warn('[meetings] 시작 알림 회의실 조회 실패', { error: rooms.error })
  }, [meetings.error, rooms.error])
  if (!enabled || !profile?.companyId || meetings.isError || !meetings.data || (entry && (entry.phase !== 'ready' || entry.checkoutOpen))) return null
  return <MeetingReminderConfirmation key={`${profile.companyId}:${profile.id}`} companyId={profile.companyId} personId={profile.id}
    notices={notices} rooms={rooms.data ?? emptyList<MeetingRoom>()} now={now} />
}

function MeetingReminderConfirmation({ companyId, personId, notices, rooms, now }: {
  companyId: string; personId: string; notices: MeetingStartNotice[]; rooms: MeetingRoom[]; now: number
}) {
  const navigate = useNavigate()
  const [confirmed, setConfirmed] = useState<Record<string, string>>({})
  const [, refreshStorage] = useState(0)
  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key?.startsWith(`atelier:meeting-start-confirmed:${companyId}:${personId}:`) || event.key === null) refreshStorage(value => value + 1)
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [companyId, personId])
  const stored = (() => {
    const values: Record<string, string | null> = {}
    try {
      for (const notice of notices) values[notice.roundId] = localStorage.getItem(meetingNoticeStorageKey(companyId, personId, notice.roundId))
    } catch (error) { console.warn('[meetings] 시작 알림 확인 상태 조회 실패', { error }) }
    return values
  })()
  const due = notices.filter(notice => meetingNoticeDue(notice, now) && confirmed[notice.roundId] !== notice.token && stored[notice.roundId] !== notice.token)
  function confirm(notice: MeetingStartNotice) {
    setConfirmed(previous => ({ ...previous, [notice.roundId]: notice.token }))
    try { localStorage.setItem(meetingNoticeStorageKey(companyId, personId, notice.roundId), notice.token) }
    catch (error) { console.warn('[meetings] 시작 알림 확인 상태 저장 실패', { error }) }
  }
  if (!due.length) return null
  return <aside role="dialog" aria-modal="false" aria-label="회의 시작 전 확인" className="fixed bottom-6 right-4 z-50 max-h-[min(32rem,75dvh)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-4 text-foreground shadow-sm">
    <h2 className="text-base font-semibold" aria-live="polite">회의 시작 전 확인{due.length > 1 ? ` · ${due.length}건` : ''}</h2>
    <p className="mt-1 text-xs text-muted-foreground">시작 30분 전부터 안내합니다. 회의 일정을 확인해 주세요.</p>
    <div className="mt-3 grid gap-4">{due.map(notice => <section key={notice.roundId} aria-label={notice.title} className="border-t border-border pt-3">
      <p className="break-words text-sm font-semibold">{notice.title} · {notice.round}차</p>
      <p className="mt-1 text-sm text-primary">{Math.ceil((notice.startsAtMs - now) / 60_000)}분 후 시작 · 내 역할: {notice.role}</p>
      <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">일정</dt><dd>{notice.startsAt.replace('T', ' ')} (한국 시간)</dd>
        <dt className="text-muted-foreground">회의실</dt><dd className="break-words">{rooms.find(room => room.id === notice.roomId)?.name ?? '회의에서 확인'}</dd>
        <dt className="text-muted-foreground">소요 시간</dt><dd>{notice.durationMinutes}분</dd>
      </dl>
      <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => { confirm(notice); navigate(notice.href) }}>확인하고 회의 보기</Button><Button size="sm" onClick={() => confirm(notice)}>확인</Button></div>
    </section>)}</div>
  </aside>
}
