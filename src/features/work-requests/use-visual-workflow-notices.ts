import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { diagnosticOperation, diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'
import { useNotificationDetailVisibility } from '@/lib/inbox/use-notification-visibility'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { listMyVisualWorkflowNotices, readVisualWorkflowNotices } from '@/lib/supabase/visual-category-workflow'
import type { InboxNotification } from '@/lib/inbox/types'
import { VISUAL_CATEGORY_STATES, type VisualWorkflowNotice } from './visual-category-workflow'
import { VISUAL_REVIEW_PARAM } from './work-request-navigation'

const noticeLabels: Record<VisualWorkflowNotice['kind'], string> = {
  assignment: VISUAL_CATEGORY_STATES.assignment,
  middle_review: VISUAL_CATEGORY_STATES.middle_review,
  supervisor_review: VISUAL_CATEGORY_STATES.supervisor_review,
  requester_review: '총괄 검수 통과 · 결과 확인 요청',
  supervisor_revision: VISUAL_CATEGORY_STATES.supervisor_revision,
  middle_revision: VISUAL_CATEGORY_STATES.middle_revision,
  receipt: '총괄 접수 확인 필요',
  registered: '새 요청 등록',
  working: '새 작업 배정',
  rework: '수정 작업 배정',
}

export const visualWorkflowNoticesKey = (actor?: string) => ['visual-workflow-notices', actor]

export function visualWorkflowNoticeItem(row: VisualWorkflowNotice): InboxNotification {
  const params = new URLSearchParams({ requestId: row.requestId })
  if (row.categoryId) params.set('visualTab', row.categoryId)
  if (row.personal) params.set(VISUAL_REVIEW_PARAM, '1')
  const href = (row.personal ? '/settings/profile' : '/work-requests/design') + '?' + params.toString()
  const label = noticeLabels[row.kind]
  return {
    id: row.id, kind: 'visual_workflow', title: [row.title, row.categoryLabel].filter(Boolean).join(' · '),
    body: label, href, createdAt: row.createdAt, readAt: row.readAt, current: row.current,
    target: { source: 'visual-workflow', entityId: row.requestId, eventVersion: row.id, tab: 'work', href },
    action: row.current && row.kind !== 'registered' ? { key: 'visual:' + row.requestId + ':' + row.categoryId, label: '처리 필요' } : null,
  }
}

export function useVisualWorkflowNotices(coordinator = false, background = false, enabled = true) {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const actor = profile?.id
  const active = enabled && profile?.status === 'active' && session?.user.id === actor && !preview?.active
  const cache = useQueryClient()
  const query = useQuery({
    ...sharedReadPolicy, queryKey: visualWorkflowNoticesKey(actor), queryFn: listMyVisualWorkflowNotices, enabled: active,
    staleTime: state => state.state.data?.available === false ? Infinity : sharedReadPolicy.staleTime,
    refetchInterval: state => state.state.data?.available === false ? false : readPollInterval(30_000, coordinator && active)(state),
    refetchIntervalInBackground: background && coordinator,
  })
  const available = query.data?.available === true
  useEffect(() => {
    if (!active || !actor || !coordinator || !available) return
    const db = getSupabase()
    let timer: ReturnType<typeof setTimeout> | undefined
    let disposed = false
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => { void cache.invalidateQueries({ queryKey: visualWorkflowNoticesKey(actor) }) }, 150)
    }
    const channel = db.channel('visual-workflow-notices:' + actor)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visual_workflow_notices', filter: 'recipient_id=eq.' + actor }, refresh)
      .subscribe(status => {
        if (disposed) return
        diagnosticRealtime('notification', 'visual_workflow_notice_channel', status)
        if (status === 'SUBSCRIBED') refresh()
      })
    window.addEventListener('online', refresh)
    return () => {
      disposed = true
      clearTimeout(timer)
      window.removeEventListener('online', refresh)
      void db.removeChannel(channel).catch(error => startWorkflow('notification', 'visual_workflow_notice_unsubscribe').fail(error))
    }
  }, [active, actor, available, cache, coordinator])
  return { available, rows: active ? query.data?.rows : undefined, error: active ? query.error : null }
}

export function useReadVisualWorkflowNotices(request: string, category: string, revision: number | undefined, displayed: boolean) {
  const { profile } = useAuth()
  const visible = useNotificationDetailVisibility()
  const notices = useVisualWorkflowNotices(false, false, displayed && visible)
  const cache = useQueryClient()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const attempted = useRef('')
  const ids = notices.rows?.filter(row => row.current && !row.readAt && row.requestId === request
    && (!row.categoryId || row.categoryId === category) && row.version <= (revision ?? 0)).slice(0, 40).map(row => row.id).join(',') ?? ''
  const actor = profile?.id

  useEffect(() => {
    if (!displayed || !visible || !actor || !revision || !ids) return
    const key = [actor, ids, retry].join(':')
    if (attempted.current === key) return
    attempted.current = key
    let current = true
    void diagnosticOperation('notification', 'visual_workflow_detail_seen', async trace => {
      trace.step('match_displayed_version')
      await trace.run('save_read', context => readVisualWorkflowNotices(request, category, revision, ids.split(','), context))
      await trace.run('refresh_queries', () => cache.invalidateQueries({ queryKey: visualWorkflowNoticesKey(actor) }), { writeOutcome: 'committed' })
    }).then(() => { if (current) setError(false) }, () => { if (current) setError(true) })
    return () => { current = false }
  }, [actor, cache, category, displayed, ids, request, retry, revision, visible])

  return { error, retry: () => { setError(false); setRetry(value => value + 1) } }
}
