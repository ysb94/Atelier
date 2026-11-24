import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { releasePersonalPart } from '@/lib/company/release-access'
import { diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'
import type { InboxNotification } from '@/lib/inbox/types'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { diagnosticQuery } from '@/lib/supabase/diagnostic-query'

export const PERSONAL_WORK_FEEDBACK_PARAM = 'personalWorkFeedback'
export const personalWorkFeedbackKey = (actor?: string) => ['personal-work-feedback-notices', actor] as const
export const personalWorkCardsKey = (actor?: string) => ['personal-work-cards', actor] as const
const detailKey = (actor?: string, id?: string) => [...personalWorkFeedbackKey(actor), 'detail', id] as const
const columns = 'id,card_id,card_revision,round,title,note,requester_name,created_at,read_at,resolved_at'

export type PersonalWorkFeedbackNotice = {
  id: string; card_id: string; card_revision: number; round: number; title: string; note: string | null
  requester_name: string; created_at: string; read_at: string | null; resolved_at: string | null
}
type NoticeList = { available: boolean; rows: PersonalWorkFeedbackNotice[] }

export function personalWorkFeedbackNoticeItem(notice: PersonalWorkFeedbackNotice): InboxNotification {
  const href = `/settings/profile?part=my-work&${PERSONAL_WORK_FEEDBACK_PARAM}=${encodeURIComponent(notice.id)}`
  return {
    id: notice.id, kind: 'personal_work_feedback', title: notice.title,
    body: `${notice.requester_name}님이 ${notice.round}차 피드백을 요청했습니다.`,
    href, createdAt: notice.created_at, readAt: notice.read_at, current: !notice.resolved_at,
    target: { source: 'personal-work-feedback', entityId: notice.card_id, eventVersion: notice.id, tab: 'my-work', href },
    action: notice.resolved_at ? null : { key: `personal-work-feedback:${notice.card_id}`, label: '피드백 필요' },
  }
}

async function listNotices(actor: string, signal: AbortSignal): Promise<NoticeList> {
  try {
    const rows = await diagnosticQuery<PersonalWorkFeedbackNotice[]>('notification', 'list_personal_work_feedback',
      getSupabase().from('personal_work_feedback_notices').select(columns).eq('recipient_id', actor)
        .order('resolved_at', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false })
        .limit(100).abortSignal(signal))
    return { available: true, rows }
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST205' || code === '42P01') return { available: false, rows: [] }
    throw new Error('피드백 알림을 불러오지 못했습니다.', { cause: error })
  }
}

export function usePersonalWorkFeedbackNotices(coordinator = false, background = false) {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const actor = profile?.id
  const active = Boolean(actor && session?.user.id === actor && !preview?.active && releasePersonalPart(profile, 'my-work'))
  const cache = useQueryClient()
  const query = useQuery({
    ...sharedReadPolicy, queryKey: personalWorkFeedbackKey(actor), enabled: active, queryFn: ({ signal }) => listNotices(actor!, signal),
    refetchInterval: readPollInterval(30_000, coordinator && active), refetchIntervalInBackground: coordinator && background,
  })
  const available = query.data?.available === true
  useEffect(() => {
    if (!active || !coordinator || !available || !actor) return
    const db = getSupabase()
    const refresh = () => {
      void cache.invalidateQueries({ queryKey: personalWorkFeedbackKey(actor) })
      void cache.invalidateQueries({ queryKey: personalWorkCardsKey(actor) })
    }
    const channel = db.channel(`personal-work-feedback:${actor}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'personal_work_feedback_notices', filter: `recipient_id=eq.${actor}` }, refresh)
      .subscribe(status => {
        diagnosticRealtime('notification', 'personal_work_feedback_channel', status)
        if (status === 'SUBSCRIBED') refresh()
      })
    return () => { void db.removeChannel(channel).catch(error => startWorkflow('notification', 'personal_work_feedback_unsubscribe').fail(error)) }
  }, [active, actor, available, cache, coordinator])

  return { ready: !active || query.isFetched, rows: active ? query.data?.rows : undefined, error: active ? query.error : null }
}

export function usePersonalWorkFeedbackNoticeDetail(actor: string | undefined, id: string | undefined, active: boolean) {
  const validId = id && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(id)
  return useQuery({
    queryKey: detailKey(actor, id), enabled: Boolean(actor && validId && active), retry: false, staleTime: 0,
    queryFn: ({ signal }) => diagnosticQuery<PersonalWorkFeedbackNotice | null>('notification', 'get_personal_work_feedback',
      getSupabase().from('personal_work_feedback_notices').select(columns).eq('id', id!)
        .eq('recipient_id', actor!).abortSignal(signal).maybeSingle()),
  })
}

export function useReadPersonalWorkFeedbackNotice(actor: string | undefined, notice: PersonalWorkFeedbackNotice | undefined, displayed: boolean) {
  const visible = useNotificationDetailVisibility()
  const preview = usePagePreview()
  const cache = useQueryClient()
  const attempted = useRef('')
  const read = useMutation({
    mutationFn: async (input: { actor: string; id: string; revision: number }) => {
      const readAt = await diagnosticQuery<string | null>('notification', 'read_personal_work_feedback',
        getSupabase().rpc('read_personal_work_feedback_notice', { p_id: input.id, p_revision: input.revision }))
      if (!readAt) throw new Error('이 알림을 확인할 권한이 없습니다.')
      return readAt
    },
    onSuccess: (readAt, input) => {
      cache.setQueryData<PersonalWorkFeedbackNotice | null>(detailKey(input.actor, input.id),
        current => current && { ...current, read_at: readAt })
      cache.setQueryData<NoticeList>(personalWorkFeedbackKey(input.actor), current => current && {
        ...current, rows: current.rows.map(row => row.id === input.id ? { ...row, read_at: readAt } : row),
      })
      void cache.invalidateQueries({ queryKey: personalWorkFeedbackKey(input.actor), exact: true })
    },
  })
  const input = actor && notice && { actor, id: notice.id, revision: notice.card_revision }
  const { mutate } = read
  useEffect(() => {
    if (!displayed || !visible || preview?.active || !actor || !notice || notice.read_at) return
    const key = `${actor}:${notice.id}:${notice.card_revision}`
    if (attempted.current === key) return
    attempted.current = key
    mutate({ actor, id: notice.id, revision: notice.card_revision })
  }, [actor, displayed, mutate, notice, preview?.active, visible])

  return {
    error: read.isError && !notice?.read_at && read.variables?.id === notice?.id,
    retry: () => { if (displayed && visible && !preview?.active && input && !notice?.read_at) mutate(input) },
  }
}
