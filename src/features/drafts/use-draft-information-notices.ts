import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RELEASE_VISUAL_ID } from '@/lib/company/release-access'
import { usePagePreview } from '@/lib/company/page-preview-context'
import { diagnosticRealtime, startWorkflow } from '@/lib/diagnostics/workflow-trace'
import type { InboxNotification } from '@/lib/inbox/types'
import { readPollInterval, sharedReadPolicy } from '@/lib/query/shared-read-policy'
import { useAuth } from '@/lib/supabase/auth'
import { getSupabase } from '@/lib/supabase/client'
import { diagnosticQuery } from '@/lib/supabase/diagnostic-query'
import type { DraftInformationField } from '@/lib/drafts/color-spec'

export const DRAFT_INFORMATION_NOTICE_PARAM = 'draftInformationNotice'
export const DRAFT_INFORMATION_NOTICE_FIELDS = {
  size: '사이즈', weight: '무게', sizeNote: '사이즈 메모', fabric: '패브릭', coating: '코팅', specDoc: '스펙 문서',
} as const
export const DRAFT_INFORMATION_NOTICE_STATUS = { confirmed: '확정', reopened: '확정 해제', changed: '내용 수정' } as const

type ValueKey = keyof typeof DRAFT_INFORMATION_NOTICE_FIELDS
export type DraftInformationNotice = {
  id: string; draft_id: string; draft_no: string; draft_name: string; field: DraftInformationField
  changes: { color: string | null; status: keyof typeof DRAFT_INFORMATION_NOTICE_STATUS; fields: ValueKey[] }[]
  created_at: string; read_at: string | null
}
type NoticeDetail = DraftInformationNotice & { saved_values: Partial<Record<ValueKey, string>>[] }
type NoticeList = { available: boolean; rows: DraftInformationNotice[] }
const noticeKey = (actor?: string) => ['draft-information-notices', actor] as const
const columns = 'id,draft_id,draft_no,draft_name,field,changes,created_at,read_at'

export function draftInformationNoticeItem(row: DraftInformationNotice): InboxNotification {
  const href = `/settings/profile?part=work&${DRAFT_INFORMATION_NOTICE_PARAM}=${encodeURIComponent(row.id)}`
  const status = row.changes[0].status
  const summary = row.changes.every(change => change.status === status) ? DRAFT_INFORMATION_NOTICE_STATUS[status] : '변경'
  const color = row.changes[0].color
  return {
    id: row.id, kind: 'draft_information', title: `${row.draft_no} ${row.draft_name}`.trim(),
    body: `${DRAFT_INFORMATION_NOTICE_FIELDS[row.field]} ${summary}${color ? ` · ${color}${row.changes.length > 1 ? ` 외 ${row.changes.length - 1}개 컬러` : ''}` : ''}`,
    href, createdAt: row.created_at, readAt: row.read_at, action: null,
    target: { source: 'draft-information', entityId: row.draft_id, eventVersion: row.id, tab: 'work', href },
  }
}

async function listNotices(signal: AbortSignal): Promise<NoticeList> {
  try {
    const rows = await diagnosticQuery<DraftInformationNotice[]>('notification', 'list_draft_information_notices',
      getSupabase().from('draft_information_notices').select(columns)
        .order('created_at', { ascending: false }).limit(100).abortSignal(signal))
    return { available: true, rows }
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code
    if (code === 'PGRST205' || code === '42P01') return { available: false, rows: [] }
    throw error
  }
}

export function useDraftInformationNotices(coordinator = false, background = false) {
  const { profile, session } = useAuth()
  const preview = usePagePreview()
  const actor = profile?.id
  const active = profile?.status === 'active' && profile.departmentId === RELEASE_VISUAL_ID && session?.user.id === actor && !preview?.active
  const cache = useQueryClient()
  const query = useQuery({
    ...sharedReadPolicy, queryKey: noticeKey(actor), enabled: active, queryFn: ({ signal }) => listNotices(signal),
    refetchInterval: readPollInterval(30_000, coordinator && active), refetchIntervalInBackground: background && coordinator,
  })
  const available = query.data?.available === true
  useEffect(() => {
    if (!active || !coordinator || !available || !actor) return
    const db = getSupabase()
    const refresh = () => { void cache.invalidateQueries({ queryKey: noticeKey(actor) }) }
    const channel = db.channel(`draft-information-notices:${actor}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_information_notices', filter: `recipient_id=eq.${actor}` }, refresh)
      .subscribe(status => {
        diagnosticRealtime('notification', 'draft_information_notice_channel', status)
        if (status === 'SUBSCRIBED') refresh()
      })
    window.addEventListener('online', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      void db.removeChannel(channel).catch(error => startWorkflow('notification', 'draft_information_notice_unsubscribe').fail(error))
    }
  }, [active, actor, available, cache, coordinator])

  return { active, actor, available, ready: !active || query.isFetched, rows: active ? query.data?.rows : undefined, error: active ? query.error : null }
}

export async function readDraftInformationNotice(id: string) {
  const readAt = await diagnosticQuery<string | null>('notification', 'read_draft_information_notice',
    getSupabase().rpc('read_draft_information_notice', { p_id: id }))
  if (!readAt) throw new Error('이 알림을 확인할 권한이 없습니다.')
  return readAt
}

export const draftInformationNoticeDetailKey = (actor?: string, id?: string) => [...noticeKey(actor), 'detail', id] as const

export function useDraftInformationNoticeDetail(actor: string | undefined, id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: draftInformationNoticeDetailKey(actor, id), enabled: enabled && Boolean(id),
    staleTime: 0, retry: false, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => diagnosticQuery<NoticeDetail | null>('notification', 'get_draft_information_notice',
      getSupabase().from('draft_information_notices').select(`${columns},saved_values`)
        .eq('id', id!).abortSignal(signal).maybeSingle()),
  })
}

export function updateDraftInformationNoticeRead(cache: ReturnType<typeof useQueryClient>, actor: string, id: string, readAt: string) {
  cache.setQueryData<NoticeDetail>(draftInformationNoticeDetailKey(actor, id), current => current && ({ ...current, read_at: readAt }))
  cache.setQueryData<NoticeList>(noticeKey(actor), current => current &&
    ({ ...current, rows: current.rows.map(row => row.id === id ? { ...row, read_at: readAt } : row) }))
  void cache.invalidateQueries({ queryKey: noticeKey(actor), exact: true })
}
