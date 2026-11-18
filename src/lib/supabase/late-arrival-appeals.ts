import { useQuery, type QueryClient } from '@tanstack/react-query'
import type { InboxNotification } from '@/lib/inbox/types'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from './auth'
import { getSupabase } from './client'
import { diagnosticQuery } from './diagnostic-query'

export const lateAppealsQueryKey = ['late-arrival-appeals'] as const

export type LateArrivalAppeal = {
  id: string
  employee_name: string | null
  work_date: string
  baseline: string
  actual: string
  minutes: number
  reason: string
  created_at: string
  status: 'pending' | 'corrected' | 'kept'
  review_note: string | null
  reviewed_at: string | null
  can_review: boolean
  revision: string | null
  event_key: string | null
  read_at: string | null
}

async function listLateAppeals(id?: string) {
  try {
    const rows = await diagnosticQuery<LateArrivalAppeal[]>('leave', 'list_late_appeals', getSupabase().rpc('list_late_arrival_appeals', { p_id: id ?? null }))
    return { supported: true, rows: rows ?? [] }
  } catch (error) {
    const code = (error as Error & { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST202' || code === '42883') return { supported: false, rows: [] as LateArrivalAppeal[] }
    throw error
  }
}

export function useLateAppeals(enabled: boolean, id?: string, poll: number | false = false, background = false) {
  const { profile, session } = useAuth()
  const actor = session?.user.id
  const allowed = enabled && profile?.status === 'active' && actor === profile.id
  return useQuery({
    queryKey: [...lateAppealsQueryKey, actor, id ?? null],
    queryFn: () => listLateAppeals(id),
    ...sharedReadPolicy,
    enabled: allowed,
    refetchInterval: poll === false ? false : readPollInterval(poll, allowed),
    refetchIntervalInBackground: background,
  })
}

export function lateAppealNoticeItems(rows: readonly LateArrivalAppeal[]): InboxNotification[] {
  return rows.flatMap(row => {
    if (!row.event_key) return []
    const reviewing = row.can_review
    const pending = reviewing && row.status === 'pending'
    const href = `/settings/profile?part=my-attendance&lateAppeal=${row.id}`
    return [{
      id: row.event_key,
      kind: 'late_appeal',
      title: reviewing ? `${row.employee_name || '직원'} · 지각 이의신청` : '지각 이의신청 처리 결과',
      body: reviewing ? `${row.work_date} · 지각 ${row.minutes}분` : `${row.work_date} · ${row.status === 'corrected' ? '지각 제외' : '기존 판정 유지'}`,
      href,
      createdAt: reviewing ? row.created_at : row.reviewed_at ?? row.created_at,
      readAt: row.read_at,
      current: !reviewing || pending,
      target: { source: 'late-appeal', entityId: row.id, eventVersion: row.event_key, tab: 'my-attendance', href },
      action: pending ? { key: row.event_key, label: '이의신청 처리 필요' } : null,
    }]
  })
}

export async function submitLateAppeal(date: string, reason: string) {
  await diagnosticQuery<string>('leave', 'submit_late_appeal', getSupabase().rpc('submit_late_arrival_appeal', { p_date: date, p_reason: reason }))
}

export async function readLateAppeal(id: string, eventKey: string) {
  await diagnosticQuery('notification', 'read_late_appeal', getSupabase().rpc('read_late_arrival_appeal', { p_id: id, p_event_key: eventKey }))
}

export async function reviewLateAppeal(row: LateArrivalAppeal, exclude: boolean, note: string) {
  await diagnosticQuery('leave', 'review_late_appeal', getSupabase().rpc('review_late_arrival_appeal', {
    p_id: row.id, p_exclude: exclude, p_note: note, p_revision: row.revision,
  }))
}

export async function refreshLateAppeals(cache: QueryClient, reviewed = false) {
  const keys = reviewed ? [...lateAppealsQueryKey, 'attendance-incident-adjustments', 'late-arrival-cumulative', 'late-arrival-statements'] : lateAppealsQueryKey
  await Promise.all(keys.map(key => cache.invalidateQueries({ queryKey: [key] })))
}
